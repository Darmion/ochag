import type { Queryable } from '../../../db.ts';
import { CONDITION_LABELS } from '../../../../../../packages/domain/combat/conditions.ts';
import { abilityModifier } from '../../../../../../packages/domain/dice/dice.ts';
import { hasTokens, parseExpression, rollExpression, type Expression } from '../../../../../../packages/domain/dice/expression.ts';
import { templateFormula } from '../../../../../../packages/domain/spells/spell-template-engine.ts';
import { describeEffect, type Action, type Effect, type Outcome, type Scaling, type SpellTemplate } from '../../../../../../packages/domain/spells/spell-template.ts';
import { addCondition, conditionImmunity, loadConditionState } from '../../../rules/conditions.ts';
import { applyHpChange } from '../../combat/hp.ts';
import type { TableContext } from '../../context.ts';
import { rollSaveAgainst, rollCheckFor } from '../../rolls/checks.ts';
import { insertRoll, rollDie } from '../../rolls/dice.ts';
import { pushAway } from '../../scene/movement.ts';
import { creatureTypeOf } from '../rules.ts';

const ABILITY_KEYS = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' } as const;
const ABILITY_SHORT: Record<string, string> = { strength: 'СИЛ', dexterity: 'ЛОВ', constitution: 'ТЕЛ', intelligence: 'ИНТ', wisdom: 'МДР', charisma: 'ХАР' };
const DAMAGE_RU: Record<string, string> = {
  acid: 'кислота', bludgeoning: 'дробящий', cold: 'холод', fire: 'огонь', force: 'силовое поле', lightning: 'электричество',
  necrotic: 'некротический', piercing: 'колющий', poison: 'яд', psychic: 'психический', radiant: 'излучение', slashing: 'рубящий', thunder: 'звук',
};
const MOD_KINDS = new Set(['ac', 'speed', 'attack-rolls', 'checks', 'defense', 'extra-action', 'restrict', 'senses', 'extra-damage']);
const LASTS: Record<string, ['caster' | 'target', 'start' | 'end']> = {
  'caster-next-start': ['caster', 'start'], 'caster-next-end': ['caster', 'end'], 'target-next-start': ['target', 'start'], 'target-next-end': ['target', 'end'],
};

export type SpellRun = {
  campaignId: string; userId: string; sceneId: string | null;
  casterId: string; casterName: string;
  spellName: string; spellLevel: number; slotLevel: number; characterLevel: number;
  dc: number; attackBonus: number; castingModifier: number; proficiency: number; abilities: Record<string, number>;
  concentration: boolean; durationRounds: number | null; param: string | null; hidden: boolean;
  scaling: Scaling[];
};

export type RunTarget = { id: string; name: string };
export type RunLine = { characterId: string; name: string; text: string };
export type RunReport = {
  lines: RunLine[];
  manual: string[];
  hpChanges: Array<{ characterId: string; mode: 'damage' | 'heal'; change: any }>;
  changed: Set<string>;
  messages: Array<{ audience: string; text: string; targetIds: string[] }>;
  moved: boolean;
};

export const emptyReport = (): RunReport => ({ lines: [], manual: [], hpChanges: [], changed: new Set(), messages: [], moved: false });

export function spellRunTemplate(run: SpellRun): SpellTemplate {
  return { passport: { level: run.spellLevel }, scaling: run.scaling } as unknown as SpellTemplate;
}

function expressionOf(run: SpellRun, formula: string, what: Scaling['what'], refs: string[]): { expression: Expression; text: string } | null {
  const resolved = templateFormula(spellRunTemplate(run), formula, what, refs, run.slotLevel, run.characterLevel);
  if (!resolved) return null;
  const text = resolved.replace(/@mod\b/g, String(run.castingModifier)).replace(/\+-/g, '-');
  const parsed = parseExpression(text);
  if (!parsed.ok) return null;
  return { expression: parsed.expression, text };
}

async function rollFormula(q: Queryable, run: SpellRun, label: string, targetId: string | null, found: { expression: Expression; text: string }, critical: boolean, outcome: Record<string, unknown> | null) {
  const expression = critical
    ? { terms: found.expression.terms.map(term => (term.kind === 'dice' ? { ...term, count: term.count * 2 } : term)) }
    : found.expression;
  const context = { ...Object.fromEntries(Object.entries(ABILITY_KEYS).map(([ability, key]) => [key, run.abilities[ability] ?? 0])), prof: run.proficiency };
  const rolled = rollExpression(expression, rollDie, hasTokens(expression) ? context : {});
  if (!rolled.ok) return null;
  await insertRoll(q, run.campaignId, run.userId, targetId, label.slice(0, 100), found.text, rolled.dice, rolled.modifier, rolled.total, run.hidden, rolled.groups, outcome);
  return Math.max(0, rolled.total);
}

async function currentTurnIds(q: Queryable, run: SpellRun) {
  if (!run.sceneId) return new Set<string>();
  return new Set((await q.query(
    'SELECT character_id FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND is_current AND character_id IS NOT NULL', [run.campaignId, run.sceneId],
  )).rows.map(row => row.character_id as string));
}

async function untilOf(q: Queryable, run: SpellRun, lasts: string, rounds: number, targetId: string) {
  const rule = LASTS[lasts];
  if (rule) {
    const of = rule[0] === 'caster' ? run.casterId : targetId;
    return { expires: { at: rule[1], of, skip: rule[1] === 'end' && (await currentTurnIds(q, run)).has(of) ? 1 : 0 } };
  }
  if (lasts === 'rounds') return { remainingRounds: rounds, durationRounds: rounds };
  if (run.concentration) return { concentrationOf: run.casterId };
  return run.durationRounds ? { remainingRounds: run.durationRounds, durationRounds: run.durationRounds } : {};
}

async function armorClassOf(q: Queryable, campaignId: string, characterId: string) {
  return Number((await q.query('SELECT armor_class FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0]?.armor_class ?? 10);
}

type Checked = { outcome: Outcome; critical: boolean; text: string };

async function check(ctx: TableContext, q: Queryable, run: SpellRun, action: Action, target: RunTarget): Promise<Checked> {
  const c = action.check;
  const title = action.name || run.spellName;
  if (c.kind === 'attack') {
    const natural = rollDie(20);
    const total = natural + run.attackBonus;
    const ac = await armorClassOf(q, run.campaignId, target.id);
    const critical = natural === 20;
    const hit = critical || (natural !== 1 && total >= ac);
    await insertRoll(q, run.campaignId, run.userId, run.casterId, `Атака: ${title} — ${target.name}`.slice(0, 100), `1d20+${run.attackBonus}`, [natural], run.attackBonus, total, run.hidden, null,
      { kind: 'attack', target: { id: target.id, name: target.name }, hit, critical, ac });
    const outcome: Outcome = critical && action.outcomes.crit?.length ? 'crit' : hit ? 'hit' : 'miss';
    return { outcome, critical, text: critical ? `атака ${total}, крит — попадание` : hit ? `атака ${total} — попадание` : `атака ${total} — промах` };
  }
  if (c.kind === 'save') {
    const dc = c.dc === 'fixed' ? c.dcValue : run.dc;
    const saved = await rollSaveAgainst(ctx, q, run.campaignId, run.userId, target.id, c.ability, dc,
      `Спасбросок ${ABILITY_SHORT[c.ability] ?? c.ability} (СЛ ${dc}), ${title} — ${target.name}`, run.hidden, null, [], { magic: true });
    return {
      outcome: saved.success ? 'success' : 'fail', critical: false,
      text: saved.success ? `спасбросок ${saved.total} — успех` : saved.autoFail ? `спасбросок ${saved.total}, автопровал` : `спасбросок ${saved.total} — провал`,
    };
  }
  if (c.kind === 'ability') {
    const dc = c.dc === 'fixed' ? c.dcValue : run.dc;
    const roller = c.roller === 'caster' ? { id: run.casterId, name: run.casterName } : target;
    let total: number;
    if (c.skill) {
      total = (await rollCheckFor(ctx, q, run.campaignId, run.userId, roller.id, 'skill', c.skill, `Проверка (СЛ ${dc}), ${title} — ${roller.name}`, run.hidden, true, dc)).total;
    } else {
      const row = (await q.query(`SELECT ${c.ability} AS score FROM characters WHERE campaign_id=$1 AND id=$2`, [run.campaignId, roller.id])).rows[0];
      const modifier = abilityModifier(Number(row?.score ?? 10));
      const natural = rollDie(20);
      total = natural + modifier;
      await insertRoll(q, run.campaignId, run.userId, roller.id, `Проверка ${ABILITY_SHORT[c.ability] ?? c.ability} (СЛ ${dc}), ${title} — ${roller.name}`.slice(0, 100), `1d20${modifier >= 0 ? '+' : ''}${modifier}`, [natural], modifier, total, run.hidden, null, null);
    }
    const success = total >= dc;
    return { outcome: success ? 'success' : 'fail', critical: false, text: success ? `проверка ${total} против СЛ ${dc} — успех` : `проверка ${total} против СЛ ${dc} — провал` };
  }
  if (c.kind === 'contest') {
    const mine = await rollCheckFor(ctx, q, run.campaignId, run.userId, run.casterId, 'skill', c.contestMine || 'athletics', `Состязание, ${title} — ${run.casterName}`, run.hidden);
    const theirs = await rollCheckFor(ctx, q, run.campaignId, run.userId, target.id, 'skill', c.contestTheirs || 'athletics', `Состязание, ${title} — ${target.name}`, run.hidden);
    const won = mine.total >= theirs.total;
    return { outcome: won ? 'met' : 'unmet', critical: false, text: won ? `состязание ${mine.total} против ${theirs.total} — вышло` : `состязание ${mine.total} против ${theirs.total} — не вышло` };
  }
  if (c.kind === 'caster-d20') {
    const natural = rollDie(20);
    await insertRoll(q, run.campaignId, run.userId, run.casterId, `${title}: к20 (не меньше ${c.threshold})`.slice(0, 100), '1d20', [natural], 0, natural, run.hidden, null, null);
    const met = natural >= c.threshold;
    return { outcome: met ? 'met' : 'unmet', critical: false, text: met ? `к20 — ${natural}, вышло` : `к20 — ${natural}, не вышло` };
  }
  if (c.kind === 'hp-threshold') {
    const hp = Number((await q.query('SELECT hp_current FROM characters WHERE campaign_id=$1 AND id=$2', [run.campaignId, target.id])).rows[0]?.hp_current ?? 0);
    const found = c.hpFormula ? expressionOf(run, c.hpFormula, 'threshold', [action.id]) : null;
    const limit = found ? (await rollFormula(q, run, `${title}: порог хитов`, null, found, false, null)) ?? c.threshold : c.threshold;
    const met = hp <= limit;
    return { outcome: met ? 'met' : 'unmet', critical: false, text: met ? `хитов ${hp}, порог ${limit} — вышло` : `хитов ${hp}, порог ${limit} — не вышло` };
  }
  return { outcome: 'always', critical: false, text: '' };
}

export async function applyEffect(
  ctx: TableContext, q: Queryable, run: SpellRun, action: Action | null, target: RunTarget, effect: Effect,
  options: { half?: boolean; critical?: boolean } = {}, report: RunReport,
): Promise<string | null> {
  const v = effect.values;
  const title = action?.name || run.spellName;
  const base = { source: 'spell', sourceCharacterId: run.casterId, sourceName: run.spellName, spellName: run.spellName, spellLevel: run.slotLevel };
  switch (effect.kind) {
    case 'damage': {
      const found = expressionOf(run, String(v.formula ?? ''), 'damage', [effect.id, action?.id ?? '']);
      if (!found) break;
      const damageType = v.damageType === 'param' ? run.param : v.damageType === 'weapon' ? null : String(v.damageType ?? '') || null;
      let amount = await rollFormula(q, run, `Урон: ${title} — ${target.name}`, target.id, found, options.critical === true,
        { kind: 'damage', target: { id: target.id, name: target.name }, damageType });
      if (amount === null) break;
      if (options.half) amount = Math.floor(amount / 2);
      const change = await applyHpChange(ctx, q, run.campaignId, run.userId, target.id, {
        mode: 'damage', amount, damageType, critical: options.critical === true, sourceId: run.casterId, magical: v.magical !== false,
      });
      report.hpChanges.push({ characterId: target.id, mode: 'damage', change });
      const type = damageType ? DAMAGE_RU[damageType] ?? damageType : null;
      if (change.blocked === 'immune') return type ? `иммунитет (${type})` : 'иммунитет';
      return type ? `${change.applied} урона (${type})` : `${change.applied} урона`;
    }
    case 'heal': {
      if (v.notUndead !== false) {
        const kind = await creatureTypeOf(q, run.campaignId, target.id);
        if (kind === 'undead' || kind === 'construct') return 'лечение не действует';
      }
      const found = expressionOf(run, String(v.formula ?? ''), 'healing', [effect.id, action?.id ?? '']);
      if (!found) break;
      const amount = await rollFormula(q, run, `Лечение: ${title} — ${target.name}`, target.id, found, false, { kind: 'heal', target: { id: target.id, name: target.name } });
      if (amount === null) break;
      const change = await applyHpChange(ctx, q, run.campaignId, run.userId, target.id, { mode: 'heal', amount, damageType: null, critical: false, sourceId: run.casterId });
      report.hpChanges.push({ characterId: target.id, mode: 'heal', change });
      return `+${change.applied} хит.`;
    }
    case 'temp-hp': {
      const found = expressionOf(run, String(v.formula ?? ''), 'temp-hp', [effect.id, action?.id ?? '']);
      if (!found) break;
      const amount = await rollFormula(q, run, `Временные хиты: ${title} — ${target.name}`, target.id, found, false, null);
      if (amount === null) break;
      await q.query('UPDATE characters SET hp_temp=GREATEST(hp_temp, $3), revision=revision+1 WHERE campaign_id=$1 AND id=$2', [run.campaignId, target.id, amount]);
      report.changed.add(target.id);
      return `${amount} врем. хитов`;
    }
    case 'condition': {
      const code = String(v.code ?? '');
      if (!code) break;
      if (code === 'exhaustion') {
        const state = await loadConditionState(q, run.campaignId, target.id);
        const next = Math.min(6, state.exhaustion + Math.max(1, Number(v.levels ?? 1)));
        await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code LIKE 'exhaustion\\_%'`, [run.campaignId, target.id]);
        await addCondition(q, run.campaignId, target.id, `exhaustion_${next}`, { source: 'spell', sourceName: run.spellName });
        report.changed.add(target.id);
        return `истощение ${next}`;
      }
      if (await conditionImmunity(q, run.campaignId, target.id, code, run.casterId)) return `иммунитет: ${CONDITION_LABELS[code] ?? code}`;
      const duration = String(v.duration ?? 'spell');
      const repeat = v.repeatSave === 'start' || v.repeatSave === 'end' ? v.repeatSave : v.repeatSave === 'damaged' ? 'end' : null;
      const saveAbility = action?.check.kind === 'save' ? action.check.ability : 'wisdom';
      const placed = await addCondition(q, run.campaignId, target.id, code, {
        ...base, ...(v.fromCaster === false ? { sourceCharacterId: undefined } : {}),
        ...(await untilOf(q, run, duration === 'until-save' ? 'spell' : duration, Number(v.rounds ?? 1), target.id)),
        ...(repeat ? { save: { ability: saveAbility, dc: run.dc }, repeatSave: repeat } : {}),
        ...(v.endsOnDamage === true ? { endsOnDamage: true } : {}),
      });
      report.changed.add(target.id);
      return placed ? CONDITION_LABELS[code] ?? code : null;
    }
    case 'move': {
      const mode = String(v.mode ?? 'push');
      if ((mode === 'push' || mode === 'pull') && run.sceneId) {
        const moved = await pushAway(
          q, run.campaignId, run.sceneId, run.casterId, target.id, Number(v.feet ?? 10), mode === 'pull',
          (id, feet) => ctx.featureApi.fall(q, run.campaignId, run.userId, id, feet, run.hidden),
        );
        if (moved.feet > 0) report.moved = true;
        if (moved.feet <= 0) return mode === 'pull' ? 'не притянуть: путь занят' : 'не оттолкнуть: путь занят';
        if (moved.drop) return mode === 'pull' ? `притянут на ${moved.feet} фт. и падает с уступа (${moved.drop} фт.)` : `отброшен на ${moved.feet} фт. и падает с уступа (${moved.drop} фт.)`;
        return mode === 'pull' ? `притянут на ${moved.feet} фт.` : `отброшен на ${moved.feet} фт.`;
      }
      break;
    }
    case 'invisible':
      await addCondition(q, run.campaignId, target.id, 'invisible', { ...base, ...(await untilOf(q, run, 'spell', 1, target.id)), ...(v.breaks === 'never' ? {} : { endsOnAttack: true }) });
      report.changed.add(target.id);
      return CONDITION_LABELS.invisible ?? 'невидим';
    case 'message':
      if (String(v.text ?? '').trim()) report.messages.push({ audience: String(v.audience ?? 'all'), text: String(v.text), targetIds: [target.id] });
      return null;
    default:
      if (MOD_KINDS.has(effect.kind)) {
        await q.query(
          `INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'spell_mod',$3::jsonb)`,
          [run.campaignId, target.id, JSON.stringify({
            ...base, kind: effect.kind, values: { ...v, ...(effect.kind === 'defense' && run.param ? { paramValue: run.param } : {}) }, slot: `run:${effect.id}`,
            ...(await untilOf(q, run, String(v.lasts ?? 'spell'), Number(v.lastsRounds ?? 1), target.id)),
          })],
        );
        report.changed.add(target.id);
        return describeEffect(effect);
      }
  }
  report.manual.push(`«${title}» — ${target.name}: ${describeEffect(effect)}`);
  return null;
}

export async function applyEffects(
  ctx: TableContext, q: Queryable, run: SpellRun, action: Action | null, target: RunTarget, effects: Effect[],
  options: { half?: boolean; critical?: boolean }, report: RunReport, lead = '', halved: Effect[] = [],
) {
  const parts: string[] = [];
  for (const effect of halved) {
    const text = await applyEffect(ctx, q, run, action, target, effect, { ...options, half: true }, report);
    if (text) parts.push(`${text} (половина)`);
  }
  for (const effect of effects) {
    const text = await applyEffect(ctx, q, run, action, target, effect, options, report);
    if (text) parts.push(text);
  }
  const text = [lead, parts.join(', ')].filter(Boolean).join(': ');
  if (text) report.lines.push({ characterId: target.id, name: target.name, text: action?.name ? `${action.name} — ${text}` : text });
}

export async function runAction(ctx: TableContext, q: Queryable, run: SpellRun, action: Action, targets: RunTarget[], report: RunReport = emptyReport()) {
  for (const target of targets) {
    const checked = await check(ctx, q, run, action, target);
    const effects = action.outcomes[checked.outcome] ?? (checked.outcome === 'crit' ? action.outcomes.hit ?? [] : []);
    const halved = checked.outcome === 'success' && action.successHalf ? (action.outcomes.fail ?? []).filter(effect => effect.kind === 'damage') : [];
    const lead = checked.text && !effects.length && !halved.length ? `${checked.text}; без последствий` : checked.text;
    await applyEffects(ctx, q, run, action, target, effects, { critical: checked.critical }, report, lead, halved);
  }
  return report;
}
