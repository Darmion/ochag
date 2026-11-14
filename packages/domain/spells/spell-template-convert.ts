import {
  CLASSES, applySuggestion, emptyAction, emptyEffect, emptyTemplate, normalizeTemplate, primaryOutcome,
  type Action, type Effect, type EffectKind, type SpellTemplate,
} from './spell-template.ts';
import { suggestTemplate } from './spell-template-suggest.ts';
import { spellShape, spellSummon } from './summons.ts';
import { spellTargetRules } from './spell-targets.ts';
import { aidPerSlot, hitPointPool, projectileRule, singleTarget, targetLimit, tempHpPerSlot } from './spell-riders.ts';
import { deriveSpellMechanics } from './spell-mechanics.ts';

export type SrdSpellSource = {
  index: string; name: string; level: number; school: string; classes?: string[] | null;
  castingTime?: string | null; range?: string | null; duration?: string | null; components?: string[] | string | null;
  material?: string | null; concentration?: boolean; ritual?: boolean; desc: string; higherLevel?: string | null;
};
export type RussianText = { name?: string | null; desc?: string | null; higherLevel?: string | null } | null | undefined;

const PRESET_OF: Readonly<Record<string, string>> = {
  sanctuary: 'sanctuary', 'protection-from-evil-and-good': 'protection-from-evil', heroism: 'heroism', 'mirror-image': 'mirror-images',
  'death-ward': 'death-ward', 'hypnotic-pattern': 'stupor', darkness: 'darkness', daylight: 'daylight', blur: 'blur', 'true-strike': 'true-strike',
  guidance: 'guidance', resistance: 'resistance-die', 'expeditious-retreat': 'expeditious', stoneskin: 'stoneskin', 'warding-bond': 'warding-bond',
  'beacon-of-hope': 'beacon-of-hope', haste: 'haste', slow: 'slow', sleep: 'sleep',
  'spare-the-dying': 'stabilize', revivify: 'revive', 'raise-dead': 'revive', 'greater-restoration': 'greater-restoration',
  bless: 'bless', bane: 'bane', light: 'light', 'faerie-fire': 'faerie-fire',
  barkskin: 'barkskin', longstrider: 'longstrider', darkvision: 'darkvision', 'spider-climb': 'spider-climb', 'protection-from-energy': 'energy-ward',
};
const PRESET_KEEPS_SAVE = new Set(['stupor', 'slow', 'bane', 'faerie-fire']);
const PRESET_LASTS: Readonly<Record<string, string>> = { 'true-strike': 'caster-next-end' };
const GM_ONLY = new Set(['hallow']);
const SCALING_FIXES: Readonly<Record<string, string>> = { 'arcane-hand': '2к8' };
const ZONE_COMMANDS: Readonly<Record<string, { name: string; feet: number }>> = { moonbeam: { name: 'Сдвинуть луч', feet: 60 } };
function zoneOf(values: Record<string, unknown>, inner: Action): Action {
  const holder = emptyAction('Зона');
  holder.who = 'area';
  holder.outcomes = { always: [{ ...effect('zone', values), actions: [inner] }] };
  return holder;
}
const ZONE_BUILDS: Readonly<Record<string, () => Action[]>> = {
  'spike-growth': () => {
    const thorns = emptyAction('Шипы');
    thorns.when = 'zone-enter';
    thorns.who = 'entering';
    thorns.outcomes = { always: [effect('damage', { formula: '2к4', damageType: 'piercing' })] };
    return [zoneOf({ difficult: true }, thorns)];
  },
  web: () => {
    const strands = emptyAction('Липкие нити');
    strands.when = 'zone-enter-or-start';
    strands.who = 'entering';
    strands.check = { ...strands.check, kind: 'save', ability: 'dexterity' };
    strands.outcomes = { fail: [effect('condition', { code: 'restrained' })] };
    return [zoneOf({ difficult: true, obscured: 'light' }, strands)];
  },
};
const ZONE_FIXES: Readonly<Record<string, { zone: Record<string, unknown>; fail: () => Effect[] }>> = {
  'sleet-storm': { zone: { difficult: true, obscured: 'heavy' }, fail: () => [effect('condition', { code: 'prone' })] },
  'spirit-guardians': { zone: { shapeFrom: 'own', shape: 'sphere', sizeFeet: 15, follows: true, spares: true, difficult: true }, fail: () => [] },
  cloudkill: { zone: { drift: 10, obscured: 'heavy' }, fail: () => [] },
  'zone-of-truth': { zone: {}, fail: () => [effect('message', { audience: 'gm', text: 'Провалил спасбросок в «Области истины»: не может сознательно лгать, пока в зоне.' })] },
};
const PRESET_ON_CASTER = new Set(['true-strike']);

function effect(kind: EffectKind, values: Record<string, unknown> = {}): Effect {
  const made = emptyEffect(kind);
  Object.assign(made.values, values);
  return made;
}

const EFFECTS_OF: Readonly<Record<string, () => Effect[]>> = {
  invisibility: () => [effect('invisible', { breaks: 'attack-or-spell' })],
  'greater-invisibility': () => [effect('invisible', { breaks: 'never' })],
  'see-invisibility': () => [effect('senses', { sense: 'see-invisible' })],
  'true-seeing': () => [effect('senses', { sense: 'truesight', feet: 120 })],
  shillelagh: () => [effect('weapon', { bonus: 0, die: '8', castingAbility: true, magical: true })],
  'magic-weapon': () => [effect('weapon', { bonus: 1, magical: true })],
  'misty-step': () => [effect('move', { mode: 'teleport', feet: 30, who: 'self' })],
  heal: () => [effect('heal', { formula: '70' }), effect('remove', { what: 'conditions', conditions: ['blinded', 'deafened'], kinds: ['disease'] })],
  'protection-from-poison': () => [effect('remove', { what: 'poison' }), effect('defense', { mode: 'resistance', types: ['poison'] })],
  'remove-curse': () => [effect('remove', { what: 'curse' })],
};
// Spells whose text gave the wrong effect: theirs replace what the text suggested («Защита от яда» read as poisoning).
const EFFECTS_REPLACE = new Set(['heal', 'protection-from-poison']);
const HEAL_PER_SLOT: Readonly<Record<string, string>> = { heal: '10' };
const WEAPON_TARGET: Readonly<Record<string, { owner: 'self' | 'target'; filter: string; steps?: Array<[number, string]> }>> = {
  shillelagh: { owner: 'self', filter: 'club-staff' },
  'magic-weapon': { owner: 'target', filter: 'nonmagical', steps: [[4, '2'], [6, '3']] },
};

function mainAction(t: SpellTemplate, name: string): Action {
  if (!t.actions.length) {
    const made = emptyAction(name);
    made.who = t.targeting.kind === 'self' || t.casting.range === 'self' ? 'caster' : t.targeting.kind === 'area' ? 'area' : 'targets';
    t.actions.push(made);
  }
  return t.actions[0]!;
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 600 ? `${flat.slice(0, 597).trimEnd()}…` : flat;
}

export function srdSpellTemplate(spell: SrdSpellSource, ru?: RussianText): SpellTemplate {
  let t = emptyTemplate();
  const classes = (spell.classes ?? []).map(name => name.toLowerCase()).filter(name => CLASSES.some(([key]) => key === name));
  t.passport = {
    ...t.passport,
    name: (ru?.name || spell.name).slice(0, 200), nameEn: spell.name.slice(0, 200), level: spell.level,
    school: spell.school.toLowerCase(), classes,
    description: ru?.desc || spell.desc, higherLevel: ru?.higherLevel || spell.higherLevel || '',
  };
  const suggestions = suggestTemplate({
    description: spell.desc, higherLevel: spell.higherLevel ?? '', level: spell.level,
    castingTime: spell.castingTime, range: spell.range, duration: spell.duration, components: spell.components,
    material: spell.material, concentration: spell.concentration, ritual: spell.ritual,
  });
  for (const suggestion of suggestions) t = applySuggestion(t, suggestion);
  const rules = spellTargetRules(spell.desc);
  t.casting = { ...t.casting, needsSight: rules.mustSee };
  t.targeting = rules.only ? { ...t.targeting, typeMode: 'only', types: [rules.only] }
    : rules.excluded.length ? { ...t.targeting, typeMode: 'except', types: [...rules.excluded] }
    : { ...t.targeting, typeMode: 'any', types: [] };
  const text = { desc: spell.desc, higherLevel: spell.higherLevel ?? null, range: spell.range ?? null };
  const limit = targetLimit(text, spell.level);
  const shots = projectileRule(text);
  if (t.targeting.kind === 'creatures') {
    if (/^self/i.test((spell.range ?? '').trim())) t.targeting = { ...t.targeting, kind: 'self' };
    else if (shots) {
      t.targeting = { ...t.targeting, countMode: 'any' };
      t.scaling = t.scaling.filter(rule => rule.what !== 'targets');
      if (shots.byLevel && !t.scaling.some(rule => rule.what === 'projectiles')) {
        t.scaling.push({ id: 's-shots', what: 'projectiles', per: 'cantrip', ref: '', amount: '1', steps: [] });
      }
    } else if (limit !== null) t.targeting = { ...t.targeting, count: limit, countMode: 'up-to' };
    else if (!singleTarget(text, spell.level, spell.level) && !hitPointPool(text)) t.targeting = { ...t.targeting, countMode: 'any' };
  } else if (t.targeting.kind === 'area' && limit !== null) {
    t.targeting = { ...t.targeting, affects: 'chosen', chosenMax: limit };
  }
  const derived = deriveSpellMechanics({ ...spell, duration: spell.duration ?? '' });
  for (const action of t.actions) {
    if (action.when === 'cast' && action.check.kind === 'save' && derived.save && derived.halfOnSave) action.successHalf = true;
  }
  if (t.targeting.kind === 'creatures' && /\b(?:one|an) additional (?:creature|target|humanoid|beast)\b/i.test(spell.higherLevel ?? '') && !t.scaling.some(rule => rule.what === 'targets')) {
    t.scaling.push({ id: 's-targets', what: 'targets', per: 'slot', ref: '', amount: '1', steps: [] });
  }
  const growth = [['temp-hp', tempHpPerSlot(spell.higherLevel)], ['max-hp', aidPerSlot(spell.higherLevel)]] as const;
  for (const [kind, perSlot] of growth) {
    if (perSlot <= 0) continue;
    const found = t.actions.flatMap(action => Object.values(action.outcomes).flatMap(list => list ?? [])).find(entry => entry.kind === kind);
    const what = kind === 'temp-hp' ? 'temp-hp' : 'bonus';
    if (found && !t.scaling.some(rule => rule.what === what)) t.scaling.push({ id: `s-${kind}`, what, per: 'slot', ref: found.id, amount: String(perSlot), steps: [] });
  }

  const preset = PRESET_OF[spell.index];
  const effects = EFFECTS_OF[spell.index];
  const summon = spellSummon(spell.index);
  const shape = spellShape(spell.index);
  if (preset || effects || summon || shape) {
    const action = mainAction(t, 'Эффект');
    if (preset && !PRESET_KEEPS_SAVE.has(preset)) {
      action.check = emptyAction().check;
      action.successHalf = false;
      const all = Object.values(action.outcomes).flatMap(list => list ?? []);
      action.outcomes = { always: all };
    }
    const outcome = primaryOutcome(action);
    const special: Effect[] = preset ? [effect('preset', { preset, ...(PRESET_LASTS[preset] ? { lasts: PRESET_LASTS[preset] } : {}) })]
      : effects ? effects()
      : summon ? [effect('summon', {
        rules: summon.kind === 'conjure-animals' ? 'conjure' : summon.kind,
        creatures: summon.forms.join(', ').slice(0, 1500), creatureType: 'beast', maxCr: summon.kind === 'conjure-animals' ? 2 : 0,
        count: 1, vanish: summon.concentration ? ['zero-hp', 'concentration'] : ['zero-hp'],
      })]
      : [effect('shape', {
        ...(shape!.maxCr !== null ? { limit: 'fixed', maxCr: shape!.maxCr } : { limit: 'target-level' }),
        consent: shape!.kind === 'animal-shapes' ? 'willing' : 'any', maxSize: shape!.maxSize ?? '',
      })];
    if (preset && PRESET_ON_CASTER.has(preset)) action.who = 'caster';
    const kept = EFFECTS_REPLACE.has(spell.index) ? [] : (action.outcomes[outcome] ?? []).filter(entry => !preset || entry.kind === 'damage' || entry.kind === 'heal' || (PRESET_KEEPS_SAVE.has(preset) && entry.kind === 'condition'));
    action.outcomes = { ...action.outcomes, [outcome]: [...kept, ...special] };
    if (effects && effects().some(entry => entry.kind === 'move' && entry.values.mode === 'teleport')) t.targeting = { ...t.targeting, kind: 'place' };
    const healed = HEAL_PER_SLOT[spell.index] ? special.find(entry => entry.kind === 'heal') : undefined;
    if (healed) t.scaling = [...t.scaling.filter(rule => rule.what !== 'healing'), { id: 's-heal', what: 'healing', per: 'slot', ref: healed.id, amount: HEAL_PER_SLOT[spell.index]!, steps: [] }];
    const weapon = WEAPON_TARGET[spell.index];
    if (weapon) {
      t.targeting = { ...t.targeting, objectOwner: weapon.owner, objectFilter: weapon.filter };
      const made = special.find(entry => entry.kind === 'weapon');
      if (made && weapon.steps) t.scaling.push({ id: 's-weapon', what: 'bonus', per: 'steps', ref: made.id, amount: '', steps: weapon.steps });
    }
    if (spell.index === 'protection-from-energy') {
      t.options.params = [{ id: 'p-energy', key: 'стихия', label: 'Стихия', kind: 'damage-type', options: ['acid', 'cold', 'fire', 'lightning', 'thunder'], chooser: 'caster' }];
    }
  }
  if (GM_ONLY.has(spell.index)) t.actions = [];
  if (SCALING_FIXES[spell.index]) t.scaling = t.scaling.map(rule => (rule.what === 'damage' ? { ...rule, amount: SCALING_FIXES[spell.index]! } : rule));
  if (!t.actions.some(action => Object.values(action.outcomes).some(list => list?.length))) {
    const action = mainAction(t, 'Эффект');
    action.outcomes = { ...action.outcomes, [primaryOutcome(action)]: [effect('special', { text: excerpt(t.passport.description) })] };
  }
  if (ZONE_BUILDS[spell.index]) t.actions = ZONE_BUILDS[spell.index]!();
  const fix = ZONE_FIXES[spell.index];
  const zone = fix ? t.actions.flatMap(action => Object.values(action.outcomes).flatMap(list => list ?? [])).find(entry => entry.kind === 'zone') : undefined;
  if (fix && zone) {
    Object.assign(zone.values, fix.zone);
    for (const inner of zone.actions) if (inner.check.kind === 'save' && !inner.outcomes.fail?.length) inner.outcomes = { ...inner.outcomes, fail: fix.fail() };
  }
  const move = ZONE_COMMANDS[spell.index];
  if (move && !t.commands.length) t.commands = [{ id: 'c-move', name: move.name, cost: 'action', when: 'after-cast', does: 'move-zone', feet: move.feet, actionId: '', limit: 'turn', limitCount: 1 }];
  t.origin = { srd: spell.index, reviewed: false };
  return stableIds(normalizeTemplate(t));
}

export function stableIds(t: SpellTemplate): SpellTemplate {
  const renamed = new Map<string, string>();
  const counters = { a: 0, e: 0 };
  const walk = (actions: Action[]) => {
    for (const action of actions) {
      const id = `a${++counters.a}`;
      renamed.set(action.id, id);
      action.id = id;
      for (const list of Object.values(action.outcomes)) {
        for (const item of list ?? []) {
          const effectId = `e${++counters.e}`;
          renamed.set(item.id, effectId);
          item.id = effectId;
          walk(item.actions);
        }
      }
    }
  };
  walk(t.actions);
  t.options.modes.forEach((mode, index) => { mode.id = `m${index + 1}`; walk(mode.actions); });
  walk(t.ending.onEnd);
  t.options.params.forEach((param, index) => { param.id = `p${index + 1}`; });
  t.scaling.forEach((rule, index) => { rule.id = `s${index + 1}`; rule.ref = renamed.get(rule.ref) ?? rule.ref; });
  t.commands.forEach((command, index) => { command.id = `c${index + 1}`; command.actionId = renamed.get(command.actionId) ?? command.actionId; });
  return t;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function diffObject(value: Record<string, unknown>, base: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => !same(entry, base[key])));
}
function compactAction(action: Action): Record<string, unknown> {
  const { outcomes, ...rest } = action;
  const base = emptyAction() as unknown as Record<string, unknown>;
  const head = diffObject(rest as unknown as Record<string, unknown>, base);
  head.id = action.id;
  head.name = action.name;
  if (head.check) head.check = diffObject(action.check as unknown as Record<string, unknown>, base.check as Record<string, unknown>);
  const kept: Record<string, unknown> = {};
  for (const [outcome, list] of Object.entries(outcomes)) {
    kept[outcome] = (list ?? []).map(item => ({
      id: item.id, kind: item.kind,
      values: diffObject(item.values, emptyEffect(item.kind).values),
      ...(item.actions.length ? { actions: item.actions.map(compactAction) } : {}),
    }));
  }
  return { ...head, outcomes: kept };
}
export function compactTemplate(t: SpellTemplate): Record<string, unknown> {
  const base = emptyTemplate();
  const out: Record<string, unknown> = {};
  for (const key of ['passport', 'casting', 'duration', 'targeting', 'hints', 'origin'] as const) {
    const diff = diffObject(t[key] as unknown as Record<string, unknown>, base[key] as unknown as Record<string, unknown>);
    if (Object.keys(diff).length) out[key] = diff;
  }
  const { onEnd, ...ending } = t.ending;
  const endingDiff = diffObject(ending as unknown as Record<string, unknown>, base.ending as unknown as Record<string, unknown>);
  if (onEnd.length) endingDiff.onEnd = onEnd.map(compactAction);
  if (Object.keys(endingDiff).length) out.ending = endingDiff;
  if (t.options.modes.length || t.options.params.length) {
    out.options = { modes: t.options.modes.map(mode => ({ ...mode, actions: mode.actions.map(compactAction) })), params: t.options.params };
  }
  if (t.actions.length) out.actions = t.actions.map(compactAction);
  if (t.commands.length) out.commands = t.commands;
  if (t.scaling.length) out.scaling = t.scaling;
  return out;
}

export type LegacyCustomSpell = {
  name: string; level: number; school: string | null; desc?: string | null; description?: string | null; higherLevel?: string | null; higher_level?: string | null;
  castingTime?: string | null; range?: string | null; duration?: string | null; components?: string | null; material?: string | null;
  concentration?: boolean | null; ritual?: boolean | null;
  attackKind?: string | null; saveAbility?: string | null; halfOnSave?: boolean | null;
  damageFormula?: string | null; damageType?: string | null; healingFormula?: string | null; upcastFormula?: string | null;
  conditionCode?: string | null; conditionRounds?: number | null; conditionRepeat?: string | null; createsZone?: boolean | null;
};

const formulaRu = (value: string) => value.replace(/\s+/g, ' ').replace(/(\d)\s*d\s*(\d)/gi, '$1к$2').trim();

export function legacySpellTemplate(spell: LegacyCustomSpell): SpellTemplate {
  let t = emptyTemplate();
  const description = spell.desc ?? spell.description ?? '';
  t.passport = {
    ...t.passport, name: spell.name.slice(0, 200), level: spell.level, school: String(spell.school ?? 'evocation').toLowerCase(),
    description, higherLevel: spell.higherLevel ?? spell.higher_level ?? '',
  };
  const meta = suggestTemplate({
    description: '', level: spell.level, castingTime: spell.castingTime, range: spell.range, duration: spell.duration,
    components: spell.components, material: spell.material, concentration: spell.concentration ?? undefined, ritual: spell.ritual ?? undefined,
  });
  for (const suggestion of meta) t = applySuggestion(t, suggestion);
  if (description.trim()) {
    for (const suggestion of suggestTemplate({ description, level: spell.level })) {
      if (suggestion.path.startsWith('targeting.')) t = applySuggestion(t, suggestion);
    }
  }

  const attack = spell.attackKind === 'melee' || spell.attackKind === 'ranged' ? spell.attackKind : null;
  const save = spell.saveAbility && spell.saveAbility !== 'none' ? spell.saveAbility : null;
  const hasMechanics = Boolean(attack || save || spell.damageFormula || spell.healingFormula || (spell.conditionCode && spell.conditionCode !== 'none'));
  if (hasMechanics) {
    const action = emptyAction(attack ? 'Атака' : save ? 'Спасбросок' : spell.healingFormula ? 'Лечение' : 'Эффект');
    if (attack) action.check = { ...action.check, kind: 'attack', attackRange: attack };
    else if (save) action.check = { ...action.check, kind: 'save', ability: save };
    action.successHalf = Boolean(save && spell.halfOnSave);
    const outcome = primaryOutcome(action);
    const list: Effect[] = [];
    if (spell.damageFormula) list.push(effect('damage', { formula: formulaRu(spell.damageFormula), damageType: spell.damageType || 'force' }));
    if (spell.healingFormula) list.push(effect('heal', { formula: formulaRu(spell.healingFormula) }));
    if (spell.conditionCode && spell.conditionCode !== 'none') {
      list.push(effect('condition', {
        code: spell.conditionCode,
        ...(spell.conditionRounds ? { duration: 'rounds', rounds: spell.conditionRounds } : {}),
        ...(spell.conditionRepeat === 'end' || spell.conditionRepeat === 'start' ? { repeatSave: spell.conditionRepeat } : {}),
      }));
    }
    action.outcomes = { [outcome]: list };
    if (spell.createsZone) {
      const inner = { ...action, when: 'zone-enter-or-start', who: 'entering', times: 'turn' };
      const holder = emptyAction('Зона');
      const zone = t.targeting.kind === 'area' ? effect('zone') : effect('zone', { shapeFrom: 'own', shape: 'sphere', sizeFeet: 20 });
      holder.outcomes = { always: [{ ...zone, actions: [inner] }] };
      t.actions = [holder];
    } else {
      t.actions = [action];
    }
    if (spell.damageType) t.passport.element = spell.damageType;
    if (spell.upcastFormula) {
      t.scaling = [{ id: 's-upcast', what: spell.damageFormula ? 'damage' : 'healing', per: 'slot', ref: '', amount: formulaRu(spell.upcastFormula), steps: [] }];
    }
  }
  t.origin = { srd: '', reviewed: true };
  return normalizeTemplate(t);
}
