import {
  CLASSES, applySuggestion, emptyAction, emptyEffect, emptyTemplate, normalizeTemplate, primaryOutcome,
  type Action, type Effect, type EffectKind, type SpellTemplate,
} from './spell-template.ts';
import { suggestTemplate } from './spell-template-suggest.ts';
import { spellShape, spellSummon } from './summons.ts';

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
};
const PRESET_KEEPS_SAVE = new Set(['stupor', 'slow']);

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
  darkvision: () => [effect('senses', { sense: 'darkvision', feet: 60 })],
  barkskin: () => [effect('ac', { mode: 'floor', value: 16 })],
  longstrider: () => [effect('speed', { mode: 'plus', feet: 10 })],
  'protection-from-energy': () => [effect('defense', { mode: 'resistance', types: ['param'] })],
  shillelagh: () => [effect('weapon', { bonus: 0, die: '8', castingAbility: true, magical: true })],
  'magic-weapon': () => [effect('weapon', { bonus: 1, magical: true })],
  'misty-step': () => [effect('move', { mode: 'teleport', feet: 30, who: 'self' })],
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
    const special: Effect[] = preset ? [effect('preset', { preset })]
      : effects ? effects()
      : summon ? [effect('summon', {
        creatures: summon.forms.join(', ').slice(0, 1500), creatureType: 'beast', maxCr: summon.kind === 'conjure-animals' ? 2 : 0,
        count: 1, vanish: summon.concentration ? ['zero-hp', 'concentration'] : ['zero-hp'],
      })]
      : [effect('shape', shape!.maxCr !== null ? { limit: 'fixed', maxCr: shape!.maxCr } : { limit: 'target-level' })];
    const kept = (action.outcomes[outcome] ?? []).filter(entry => !preset || entry.kind === 'damage' || entry.kind === 'heal');
    action.outcomes = { ...action.outcomes, [outcome]: [...kept, ...special] };
    if (spell.index === 'protection-from-energy') {
      t.options.params = [{ id: 'p-energy', key: 'стихия', label: 'Стихия', kind: 'damage-type', options: ['acid', 'cold', 'fire', 'lightning', 'thunder'], chooser: 'caster' }];
    }
  }
  if (!t.actions.some(action => Object.values(action.outcomes).some(list => list?.length))) {
    const action = mainAction(t, 'Эффект');
    action.outcomes = { ...action.outcomes, [primaryOutcome(action)]: [effect('special', { text: excerpt(t.passport.description) })] };
  }
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
