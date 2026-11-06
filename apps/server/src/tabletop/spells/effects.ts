import { type ExpiresAt, type SpellRider, tempHpPerSlot, aidPerSlot } from '../../../../../packages/domain/spells/spell-riders.ts';
import { spellSaveDc, spellAttackBonus, durationRounds } from '../../../../../packages/domain/spells/spell-mechanics.ts';
import { ownRollState } from '../rolls/modifiers.ts';
import { removeCondition, conditionImmunity, addCondition, loadConditionState } from '../../rules/conditions.ts';
import { durationRoundsOf } from '../../../../../packages/domain/spells/spell-template-engine.ts';
import { CONDITION_LABELS } from '../../../../../packages/domain/combat/conditions.ts';
import { averageDamage } from '../auto-turn/planner.ts';
import { pushAway } from '../scene/movement.ts';
import { parseFormula, rollDice } from '../../../../../packages/domain/dice/dice.ts';
import { rollDie, insertRoll } from '../rolls/dice.ts';
import { applyHpChange } from '../combat/hp.ts';
import { darkOnesBlessing } from '../../rules/class-features.ts';
import type { TableContext } from '../context.ts';
import type { Queryable } from '../../db.ts';
import type { CastSpellParams } from '../shared.ts';
import type { CastBody } from './cast.ts';
import type { CastSetup } from './prepare.ts';
import type { CastDice } from './cast-dice.ts';
import type { CastAim } from './aim.ts';

export type CastLog = {
  tempGiven: string[];
  hpChanges: Array<{ characterId: string; mode: 'damage' | 'heal'; change: any }>;
  spellBlessings: Array<{ characterId: string; name: string; value: number }>;
  pushed: boolean;
};

export async function castEffects(ctx: TableContext, q: Queryable, userId: string, params: CastSpellParams, body: CastBody, setup: CastSetup, dice: CastDice, aim: CastAim, log: CastLog) {
  const { campaignId, characterId } = params;
  const { sceneId, targetIds, hidden } = body;
  const { tempGiven, hpChanges, spellBlessings } = log;
  const { character, spellRange, spellName, concentration, spellDuration, mechanics, spellTemplate, castPlan, legacy, riders, spellText, lasting, effectiveLevel, extraLevels } = setup;
  const { proficiencyBonus, castingModifier, castingAbility, adept } = dice;
  const { wardedOff } = aim;

  const currentIds = new Set(sceneId
    ? (await q.query('SELECT character_id FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND is_current AND character_id IS NOT NULL', [campaignId, sceneId])).rows.map(row => row.character_id as string)
    : []);
  const expiresOf = (rule: ExpiresAt, targetId: string) => {
    const [who, at] = rule.split('-') as ['caster' | 'target', 'start' | 'end'];
    const of = who === 'caster' ? characterId : targetId;
    return { at, of, skip: at === 'end' && currentIds.has(of) ? 1 : 0 };
  };

  const dc = (legacy ? null : character.spell_save_dc_override) ?? spellSaveDc(proficiencyBonus ?? 0, castingModifier);
  const attackBonus = (legacy ? null : character.spell_attack_override) ?? spellAttackBonus(proficiencyBonus ?? 0, castingModifier);
  const results: Array<Record<string, unknown>> = [];
  for (const entry of wardedOff) results.push({ characterId: entry.id, name: entry.name, sanctuary: true });
  const own = await ownRollState(q, campaignId, characterId);

  let previousConcentration: string | null = null;
  if (concentration) {
    previousConcentration = (
      await q.query(
        `SELECT parameters->>'spellName' AS spell_name FROM character_effects
             WHERE campaign_id=$1 AND character_id=$2 AND effect_code='concentration' AND active`,
        [campaignId, characterId],
      )
    ).rows[0]?.spell_name ?? null;
    await removeCondition(q, campaignId, characterId, 'concentration');
  }
  const held = concentration ? { concentrationOf: characterId } : {};

  const lightRider = riders.find((rider): rider is Extract<SpellRider, { kind: 'light' }> => rider.kind === 'light') ?? null;
  const selfLight = Boolean(lightRider) && /^(self|на себя)/i.test((spellRange ?? '').trim());
  const shedLight = async (holderId: string) => {
    if (!lightRider) return;
    const rounds = durationRounds(spellDuration);
    const until = concentration ? held : rounds ? { remainingRounds: lasting(rounds), durationRounds: lasting(rounds) } : {};
    const parameters = JSON.stringify({
      source: 'spell', sourceCharacterId: characterId, sourceName: spellName, spellName, spellLevel: effectiveLevel,
      bright: lightRider.bright, dim: lightRider.dim, ...until,
    });
    const updated = await q.query(
      `UPDATE character_effects SET parameters=$4::jsonb WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='spell_light' AND parameters->>'sourceName'=$3 RETURNING id`,
      [campaignId, holderId, spellName, parameters],
    );
    if (!updated.rows.length) {
      await q.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'spell_light',$3::jsonb)`, [campaignId, holderId, parameters]);
    }
  };
  const darknessRider = riders.find((rider): rider is Extract<SpellRider, { kind: 'darkness' }> => rider.kind === 'darkness') ?? null;
  const dawnRider = riders.find((rider): rider is Extract<SpellRider, { kind: 'dispel_darkness' }> => rider.kind === 'dispel_darkness') ?? null;
  const spreadDarkness = async (holderId: string) => {
    if (!darknessRider) return;
    const rounds = durationRounds(spellDuration);
    const until = concentration ? held : rounds ? { remainingRounds: lasting(rounds), durationRounds: lasting(rounds) } : {};
    const parameters = JSON.stringify({
      source: 'spell', sourceCharacterId: characterId, sourceName: spellName, spellName, spellLevel: effectiveLevel, radius: darknessRider.radius, ...until,
    });
    const updated = await q.query(
      `UPDATE character_effects SET parameters=$4::jsonb WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='spell_darkness' AND parameters->>'sourceName'=$3 RETURNING id`,
      [campaignId, holderId, spellName, parameters],
    );
    if (!updated.rows.length) {
      await q.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'spell_darkness',$3::jsonb)`, [campaignId, holderId, parameters]);
    }
  };
  if (lightRider?.replaces) {
    await q.query(
      `DELETE FROM character_effects WHERE campaign_id=$1 AND active AND effect_code='spell_light' AND parameters->>'sourceCharacterId'=$2 AND parameters->>'sourceName'=$3`,
      [campaignId, characterId, spellName],
    );
  }

  const putCondition = async (targetId: string) => {
    if (!mechanics.condition) return false;
    if (await conditionImmunity(q, campaignId, targetId, mechanics.condition, characterId)) return false;
    await addCondition(q, campaignId, targetId, mechanics.condition, {
      source: 'apply', sourceCharacterId: characterId, sourceName: spellName, spellLevel: effectiveLevel, ...held,
      ...(mechanics.conditionRounds ? { remainingRounds: lasting(mechanics.conditionRounds), durationRounds: lasting(mechanics.conditionRounds) } : {}),
      ...(mechanics.save ? { save: { ability: mechanics.save, dc } } : {}),
      ...(mechanics.save && mechanics.repeatSave ? { repeatSave: mechanics.repeatSave } : {}),
    });
    return true;
  };
  const templateRounds = spellTemplate ? durationRoundsOf(spellTemplate) : null;
  const LASTS: Record<string, ExpiresAt> = { 'caster-next-start': 'caster-start', 'caster-next-end': 'caster-end', 'target-next-start': 'target-start', 'target-next-end': 'target-end' };
  const templateUntil = (lasts: string, rounds: number, targetId: string) => {
    if (LASTS[lasts]) return { expires: expiresOf(LASTS[lasts]!, targetId) };
    if (lasts === 'rounds') return { remainingRounds: lasting(rounds), durationRounds: lasting(rounds) };
    if (concentration) return held;
    return templateRounds ? { remainingRounds: lasting(templateRounds), durationRounds: lasting(templateRounds) } : {};
  };
  const applyTemplateEffects = async (target: { id: string; name: string }) => {
    const applied: string[] = [];
    if (!castPlan) return applied;
    const base = { source: 'spell', sourceCharacterId: characterId, sourceName: spellName, spellName, spellLevel: effectiveLevel };
    for (const [slot, mod] of castPlan.mods.entries()) {
      await q.query(
        `DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='spell_mod' AND parameters->>'sourceName'=$3 AND parameters->>'slot'=$4`,
        [campaignId, target.id, spellName, String(slot)],
      );
      await q.query(
        `INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'spell_mod',$3::jsonb)`,
        [campaignId, target.id, JSON.stringify({ ...base, kind: mod.kind, values: mod.values, slot: String(slot), ...templateUntil(String(mod.values.lasts ?? 'spell'), Number(mod.values.lastsRounds ?? 1), target.id) })],
      );
      applied.push(mod.kind);
    }
    for (const condition of castPlan.conditions) {
      const v = condition.values;
      if (condition.code === 'exhaustion') {
        const state = await loadConditionState(q, campaignId, target.id);
        const next = Math.min(6, state.exhaustion + Math.max(1, Number(v.levels ?? 1)));
        await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code LIKE 'exhaustion\\_%'`, [campaignId, target.id]);
        await addCondition(q, campaignId, target.id, `exhaustion_${next}`, { source: 'spell', sourceName: spellName });
        applied.push(`истощение ${next}`);
        continue;
      }
      const duration = String(v.duration ?? 'spell');
      const repeat = v.repeatSave === 'start' || v.repeatSave === 'end' ? v.repeatSave : v.repeatSave === 'damaged' ? 'end' : null;
      const saveAbility = mechanics.save ?? spellTemplate!.actions.find(action => action.check.kind === 'save')?.check.ability ?? 'wisdom';
      const placed = await addCondition(q, campaignId, target.id, condition.code, {
        ...base, ...(v.fromCaster === false ? { sourceCharacterId: undefined } : {}),
        ...templateUntil(duration === 'until-save' ? 'spell' : duration, Number(v.rounds ?? 1), target.id),
        ...(repeat ? { save: { ability: saveAbility, dc }, repeatSave: repeat } : {}),
        ...(v.endsOnDamage === true ? { endsOnDamage: true } : {}),
      });
      if (placed) applied.push(CONDITION_LABELS[condition.code] ?? condition.code);
    }
    for (const code of castPlan.codes) {
      const aimedAt = (targetIds ?? []).find(id => id !== characterId);
      await addCondition(q, campaignId, target.id, code.code, {
        ...base, ...code.parameters, ...templateUntil('spell', 1, target.id),
        ...(code.code === 'true_strike' && aimedAt ? { targetId: aimedAt } : {}),
      });
      applied.push(code.code);
    }
    for (const removal of castPlan.removals) {
      const what = String(removal.what);
      if (what === 'conditions') {
        for (const code of (removal.conditions as string[] | undefined) ?? []) if (await removeCondition(q, campaignId, target.id, code)) applied.push(`снято: ${CONDITION_LABELS[code] ?? code}`);
      } else if (what === 'poison' || what === 'petrified') {
        if (await removeCondition(q, campaignId, target.id, what === 'poison' ? 'poisoned' : 'petrified')) applied.push(what === 'poison' ? 'яд снят' : 'окаменение снято');
      } else if (what === 'exhaustion') {
        const state = await loadConditionState(q, campaignId, target.id);
        if (state.exhaustion > 0) {
          const left = Math.max(0, state.exhaustion - Math.max(1, Number(removal.levels ?? 1)));
          await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code LIKE 'exhaustion\\_%'`, [campaignId, target.id]);
          if (left) await addCondition(q, campaignId, target.id, `exhaustion_${left}`, { source: 'spell', sourceName: spellName });
          applied.push(`истощение: ${state.exhaustion} → ${left}`);
        }
      } else if (what === 'stabilize' || what === 'revive') {
        const state = await loadConditionState(q, campaignId, target.id);
        const row = (await q.query('SELECT hp_current FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, target.id])).rows[0];
        if (what === 'stabilize' && !state.codes.has('dead') && Number(row?.hp_current ?? 1) === 0) {
          await addCondition(q, campaignId, target.id, 'stable', { source: 'spell', sourceName: spellName });
          await q.query('UPDATE characters SET death_successes=0, death_failures=0, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, target.id]);
          applied.push('стабилен');
        }
        if (what === 'revive' && state.codes.has('dead')) {
          for (const code of ['dead', 'unconscious', 'stable']) await removeCondition(q, campaignId, target.id, code);
          await q.query('UPDATE characters SET hp_current=GREATEST(hp_current, $3), death_successes=0, death_failures=0, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, target.id, Math.max(1, Number(removal.hp ?? 1))]);
          applied.push(`снова жив: ${Math.max(1, Number(removal.hp ?? 1))} хит.`);
        }
      }
    }
    if (castPlan.weapon) {
      const w = castPlan.weapon;
      const owner = spellTemplate!.targeting.objectOwner === 'self' ? characterId : target.id;
      const filter = spellTemplate!.targeting.objectFilter;
      const weapons = (await q.query(`SELECT id, name, srd_index, damage_formula, COALESCE(attack_bonus, 0) AS attack_bonus, weapon_kind FROM character_weapons WHERE campaign_id=$1 AND character_id=$2`, [campaignId, owner])).rows as any[];
      const chosen = weapons
        .filter(entry => entry.name !== 'Безоружный удар')
        .filter(entry => filter !== 'nonmagical' || Number(entry.attack_bonus) === 0)
        .filter(entry => filter !== 'melee' || entry.weapon_kind !== 'ranged')
        .filter(entry => filter !== 'club-staff' || entry.srd_index === 'club' || entry.srd_index === 'quarterstaff' || /дубин|посох|club|quarterstaff/i.test(entry.name))
        .sort((a, b) => averageDamage(b.damage_formula) - averageDamage(a.damage_formula))[0];
      if (!chosen) applied.push('подходящего оружия нет');
      else {
        const until = templateUntil(String(w.lasts ?? 'spell'), Number(w.lastsRounds ?? 1), owner);
        if (Number(w.bonus ?? 0) > 0) await addCondition(q, campaignId, owner, 'magic_weapon', { ...base, weaponId: chosen.id, weaponName: chosen.name, bonus: Number(w.bonus), ...until });
        if (w.castingAbility === true || (w.die && w.die !== 'none')) {
          await addCondition(q, campaignId, owner, 'shillelagh', { ...base, weaponId: chosen.id, weaponName: chosen.name, ability: w.castingAbility === true ? castingAbility : null, die: w.die && w.die !== 'none' ? Number(w.die) : null, ...until });
        }
        applied.push(`«${chosen.name}»${Number(w.bonus ?? 0) > 0 ? ` +${w.bonus}` : ''}`);
      }
    }
    return applied;
  };
  const applyRiders = async (target: { id: string; name: string; kind?: string }) => {
    const applied: string[] = [];
    if (lightRider && !selfLight) {
      await shedLight(target.id);
      applied.push('светится');
    }
    if (darknessRider) {
      await spreadDarkness(target.id);
      applied.push('окутан тьмой');
    }
    if (target.kind === 'object') return applied;
    for (const rider of riders) {
      if (rider.kind === 'light' || rider.kind === 'darkness' || rider.kind === 'dispel_darkness') continue;
      if (rider.kind === 'push') {
        const moved = sceneId ? await pushAway(q, campaignId, sceneId, characterId, target.id, rider.feet) : 0;
        if (moved > 0) {
          log.pushed = true;
          applied.push(`отброшен на ${moved} фт.`);
        }
        continue;
      }
      if (rider.kind === 'temp_hp') {
        const parsed = parseFormula(rider.dice);
        if (!parsed) continue;
        const rolled = rollDice(parsed, rollDie);
        const value = Math.max(0, rolled.total) + tempHpPerSlot(spellText.higherLevel) * Math.max(0, extraLevels);
        await q.query('UPDATE characters SET hp_temp = GREATEST(hp_temp, $3), revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, target.id, value]);
        await insertRoll(q, campaignId, userId, characterId, `${spellName}: временные хиты — ${target.name}`.slice(0, 100), rider.dice.slice(0, 20), rolled.results, parsed.modifier, value, hidden ?? false);
        tempGiven.push(target.id);
        applied.push(`временные хиты ${value}`);
        continue;
      }
      if (rider.kind === 'restore') {
        for (const code of ['paralyzed', 'blinded', 'poisoned', 'deafened'].filter(entry => rider.conditions.includes(entry))) {
          if (await removeCondition(q, campaignId, target.id, code)) {
            applied.push(`снято: ${CONDITION_LABELS[code] ?? code}`);
            break;
          }
        }
        continue;
      }
      if (rider.kind === 'dispel') {
        const spells = (
          await q.query(`SELECT id, effect_code, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND parameters ? 'spellLevel'`, [campaignId, target.id])
        ).rows as Array<{ id: string; effect_code: string; parameters: any }>;
        for (const effect of spells) {
          const spellLevelOn = Number(effect.parameters.spellLevel ?? 0);
          let ends = spellLevelOn <= Math.max(rider.upTo, effectiveLevel);
          if (!ends) {
            const die = rollDie(20);
            ends = die + castingModifier >= 10 + spellLevelOn;
            await insertRoll(q, campaignId, userId, characterId, `${spellName}: проверка против ${spellLevelOn} ур. — ${target.name}`.slice(0, 100), `1d20${castingModifier >= 0 ? '+' : ''}${castingModifier}`, [die], castingModifier, die + castingModifier, hidden ?? false);
          }
          if (!ends) continue;
          const gone = await q.query('DELETE FROM character_effects WHERE id=$1 RETURNING id', [effect.id]);
          if (!gone.rows.length) continue;
          if (effect.parameters.concentrationOf) await removeCondition(q, campaignId, effect.parameters.concentrationOf, 'concentration');
          const what = `рассеяно: ${effect.parameters.sourceName ?? CONDITION_LABELS[effect.effect_code] ?? effect.effect_code}`;
          if (!applied.includes(what)) applied.push(what);
        }
        continue;
      }
      if (rider.kind === 'aid') {
        const bonus = rider.bonus + aidPerSlot(spellText.higherLevel) * Math.max(0, extraLevels);
        const before = Number((await q.query(`SELECT parameters->>'bonus' AS bonus FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='aid' AND active`, [campaignId, target.id])).rows[0]?.bonus ?? 0);
        const delta = Math.max(0, bonus - before);
        if (delta > 0) {
          await q.query('UPDATE characters SET hp_max = hp_max + $3, hp_current = hp_current + $3, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, target.id, delta]);
        }
        await addCondition(q, campaignId, target.id, 'aid', { source: 'spell', sourceCharacterId: characterId, sourceName: spellName, bonus: Math.max(bonus, before) });
        tempGiven.push(target.id);
        applied.push(`хиты +${delta}`);
        continue;
      }
      const extra: Record<string, unknown> = rider.kind === 'slowed' ? { feet: rider.feet }
        : rider.kind === 'blessed' || rider.kind === 'baned' ? { die: rider.die }
        : rider.kind === 'marked' ? { dice: rider.dice }
        : rider.kind === 'heroism' ? { temp: Math.max(0, castingModifier) }
        : rider.kind === 'ac_bonus' ? { bonus: rider.bonus }
        : rider.kind === 'sanctuary' ? { dc }
        : rider.kind === 'mage_armor' ? { base: rider.base }
        : rider.kind === 'flying' ? { feet: rider.feet }
        : rider.kind === 'slow_spell' ? { save: { ability: 'wisdom', dc }, repeatSave: 'end' }
        : rider.kind === 'stupor' ? { endsOnDamage: true } : {};
      if (rider.kind === 'stupor') {
        await addCondition(q, campaignId, target.id, 'incapacitated', { source: 'spell', sourceCharacterId: characterId, sourceName: spellName, spellLevel: effectiveLevel, endsOnDamage: true, ...held });
        await q.query(
          `UPDATE character_effects SET parameters = parameters || '{"endsOnDamage": true}'::jsonb WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='charmed' AND parameters->>'sourceName' = $3`,
          [campaignId, target.id, spellName],
        );
      }
      const plainRounds = rider.kind === 'mage_armor' ? null : durationRounds(spellDuration);
      const rounds = plainRounds ? lasting(plainRounds) : plainRounds;
      const until = 'expires' in rider ? { expires: expiresOf(rider.expires, target.id) }
        : concentration ? held : rounds ? { remainingRounds: rounds, durationRounds: rounds } : {};
      if (rider.kind === 'heroism') await removeCondition(q, campaignId, target.id, 'frightened');
      await addCondition(q, campaignId, target.id, rider.kind, { source: 'spell', sourceCharacterId: characterId, sourceName: spellName, spellLevel: effectiveLevel, ...extra, ...until });
      applied.push(rider.kind);
    }
    if (castPlan) applied.push(...await applyTemplateEffects(target));
    return applied;
  };

  const sharedTargets: Array<{ id: string; name: string; applied: number; dropped: boolean }> = [];
  const hurt = async (target: { id: string; name: string }, amount: number, critical: boolean) => {
    const change = await applyHpChange(ctx, q, campaignId, userId, target.id, { mode: 'damage', amount, damageType: mechanics.damageType, critical, ignoreResistance: adept, sourceId: characterId, magical: true });
    hpChanges.push({ characterId: target.id, mode: 'damage', change: { ...change, critical } });
    if (change.dropped) {
      const blessing = await darkOnesBlessing(q, campaignId, characterId, target.id);
      if (blessing) spellBlessings.push(blessing);
    }
    sharedTargets.push({ id: target.id, name: target.name, applied: change.applied, dropped: change.dropped });
    return change;
  };

  return {
    dc, attackBonus, results, own, previousConcentration, held, lightRider, selfLight, shedLight,
    darknessRider, dawnRider, putCondition, applyRiders, sharedTargets, hurt,
  };
}

export type CastEffects = Awaited<ReturnType<typeof castEffects>>;
