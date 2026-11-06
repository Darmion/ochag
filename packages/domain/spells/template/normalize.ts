import { OUTCOMES, SKILL_OR_NONE, isObject } from './internal.ts';
import { ABILITIES, AREA_AFFECTS, AREA_ORIGINS, AREA_SHAPES, CASTING_TIMES, CHECK_KINDS, COMMAND_COSTS, COMMAND_DOES, COMMAND_LIMITS, COMMAND_WHEN, CREATURE_TYPES, DAMAGE_TYPES, DISMISS, DURATION_KINDS, OBJECT_FILTERS, OBJECT_KINDS, type Option, PARAM_CHOOSERS, PARAM_KINDS, PREFER, PURPOSES, RANGE_KINDS, REACTION_TRIGGERS, SCALING_PER, SCALING_WHAT, SIDES, SIZES, SKILLS, TAGS, TARGETING_KINDS, TIMES, WHEN, WHO } from './options.ts';
import { EFFECT_CATALOG, EFFECT_KINDS, type EffectKind } from './effect-catalog.ts';
import { type Action, type Check, type Effect, type Outcome, SPELL_TEMPLATE_VERSION, type SpellTemplate } from './types.ts';

let idCounter = 0;
export function newId(prefix = 'x'): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function emptyCheck(): Check {
  return {
    kind: 'none', attackRange: 'ranged', attackCount: 1, ability: 'dexterity', dc: 'spell', dcValue: 13, skill: 'none',
    roller: 'target', advantageIf: [], autoFailIf: [], contestMine: 'athletics', contestTheirs: 'athletics', threshold: 11, hpFormula: '5к8',
  };
}

export function emptyAction(name = 'Действие'): Action {
  return { id: newId('a'), name, when: 'cast', times: 'each', timesCount: 1, who: 'targets', whoMax: 1, check: emptyCheck(), successHalf: false, outcomes: {} };
}

export function emptyEffect(kind: EffectKind): Effect {
  const values: Record<string, unknown> = {};
  for (const field of EFFECT_CATALOG[kind].fields) values[field.key] = Array.isArray(field.default) ? [...field.default] : field.default;
  return { id: newId('e'), kind, values, actions: [] };
}

export function emptyTemplate(): SpellTemplate {
  return {
    schemaVersion: SPELL_TEMPLATE_VERSION,
    passport: { name: '', nameEn: '', level: 1, school: 'evocation', classes: [], description: '', higherLevel: '', tags: [], element: '', art: '' },
    casting: {
      time: 'action', minutes: 1, trigger: 'hit', triggerFeet: 60, triggerText: '', ritual: false,
      verbal: true, somatic: true, material: false, materialText: '', materialCost: 0, materialConsumed: false,
      range: 'feet', rangeValue: 60, rangeText: '', needsSight: true,
    },
    duration: { kind: 'instant', value: 1, text: '', concentration: false, dismiss: 'none', stacks: false },
    targeting: {
      kind: 'creatures',
      count: 1, countMode: 'exact', side: 'any', includeSelf: false, distinct: true, maxApartFeet: 0,
      typeMode: 'any', types: [], maxSize: '', maxHp: 0, maxInt: 0, seesCaster: false, hearsCaster: false, understands: false,
      shape: 'sphere', sizeFeet: 20, widthFeet: 5, heightFeet: 0, origin: 'point', affects: 'all', chosenMax: 0, aroundCorners: false,
      hops: 1, hopFeet: 30, repeats: false,
      objectKind: 'weapon', objectOwner: 'self', objectFilter: 'any', maxWeight: 0,
      segments: 10, segmentFeet: 10, wallHeight: 10, wallThickness: 1, wallShape: 'straight',
    },
    options: { modes: [], params: [] },
    actions: [],
    commands: [],
    scaling: [],
    ending: {
      duration: true, concentration: true, casterDown: false, distanceFeet: 0, targetActs: false, targetDamaged: false,
      targetSaves: false, dismissed: true, recast: false, afterUses: 0, dispellable: true, onEnd: [],
    },
    hints: { purpose: 'other', prefer: 'weakest-enemy', avoidAllies: true, logPhrase: '', sound: '' },
    origin: { srd: '', reviewed: true },
  };
}

const allowed = (list: readonly Option[]) => new Set(list.map(([value]) => value));

function pickString(value: unknown, fallback: string, max = 2000): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback;
}
function pickNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
const ART_ASSET = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ART_PATH = /^[a-z0-9][a-z0-9_\-/]{2,199}$/;
export const isArtAsset = (art: string) => ART_ASSET.test(art);
function pickArt(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (ART_ASSET.test(text)) return text.toLowerCase();
  return ART_PATH.test(text) && !text.includes('..') && !text.includes('//') ? text : '';
}

function pickOption(value: unknown, list: readonly Option[], fallback: string): string {
  return typeof value === 'string' && allowed(list).has(value) ? value : fallback;
}
function pickOptions(value: unknown, list: readonly Option[]): string[] {
  const ok = allowed(list);
  return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && ok.has(entry)))] : [];
}
function pickStrings(value: unknown, max = 40): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.slice(0, 200)).slice(0, max) : [];
}
function pickId(value: unknown, prefix: string): string {
  return typeof value === 'string' && /^[a-z0-9]{1,40}$/i.test(value) ? value : newId(prefix);
}

const MAX_DEPTH = 3;

function normalizeEffect(raw: unknown, depth: number): Effect | null {
  if (!isObject(raw) || typeof raw.kind !== 'string' || !(EFFECT_KINDS as readonly string[]).includes(raw.kind)) return null;
  const kind = raw.kind as EffectKind;
  const spec = EFFECT_CATALOG[kind];
  const source = isObject(raw.values) ? raw.values : {};
  const values: Record<string, unknown> = {};
  for (const field of spec.fields) {
    const value = source[field.key];
    if (field.type === 'number') values[field.key] = pickNumber(value, Number(field.default), -1000, 100000);
    else if (field.type === 'bool') values[field.key] = pickBool(value, Boolean(field.default));
    else if (field.type === 'select') values[field.key] = pickOption(value, field.options ?? [], String(field.default));
    else if (field.type === 'multi') values[field.key] = Array.isArray(value) ? pickOptions(value, field.options ?? []) : [...(field.default as string[])];
    else values[field.key] = pickString(value, String(field.default ?? ''), field.type === 'text' ? 2000 : 120);
  }
  const actions = spec.nested && depth < MAX_DEPTH && Array.isArray(raw.actions)
    ? raw.actions.map(action => normalizeAction(action, depth + 1)).filter((action): action is Action => action !== null).slice(0, 10)
    : [];
  return { id: pickId(raw.id, 'e'), kind, values, actions };
}

function normalizeCheck(raw: unknown): Check {
  const base = emptyCheck();
  const source = isObject(raw) ? raw : {};
  return {
    kind: pickOption(source.kind, CHECK_KINDS, 'none') as Check['kind'],
    attackRange: source.attackRange === 'melee' ? 'melee' : 'ranged',
    attackCount: pickNumber(source.attackCount, 1, 1, 20),
    ability: pickOption(source.ability, ABILITIES, base.ability),
    dc: source.dc === 'fixed' ? 'fixed' : 'spell',
    dcValue: pickNumber(source.dcValue, base.dcValue, 1, 40),
    skill: pickOption(source.skill, SKILL_OR_NONE, 'none'),
    roller: source.roller === 'caster' ? 'caster' : 'target',
    advantageIf: pickStrings(source.advantageIf, 10),
    autoFailIf: pickStrings(source.autoFailIf, 10),
    contestMine: pickOption(source.contestMine, SKILLS, base.contestMine),
    contestTheirs: pickOption(source.contestTheirs, SKILLS, base.contestTheirs),
    threshold: pickNumber(source.threshold, base.threshold, 1, 30),
    hpFormula: pickString(source.hpFormula, base.hpFormula, 120),
  };
}

function normalizeAction(raw: unknown, depth = 0): Action | null {
  if (!isObject(raw)) return null;
  const base = emptyAction();
  const outcomes: Partial<Record<Outcome, Effect[]>> = {};
  const source = isObject(raw.outcomes) ? raw.outcomes : {};
  for (const outcome of OUTCOMES) {
    const list = source[outcome];
    if (!Array.isArray(list)) continue;
    const effects = list.map(effect => normalizeEffect(effect, depth)).filter((effect): effect is Effect => effect !== null).slice(0, 20);
    if (effects.length) outcomes[outcome] = effects;
  }
  return {
    id: pickId(raw.id, 'a'),
    name: pickString(raw.name, base.name, 100) || base.name,
    when: pickOption(raw.when, WHEN, 'cast'),
    times: pickOption(raw.times, TIMES, 'each'),
    timesCount: pickNumber(raw.timesCount, 1, 1, 100),
    who: pickOption(raw.who, WHO, 'targets'),
    whoMax: pickNumber(raw.whoMax, 1, 1, 100),
    check: normalizeCheck(raw.check),
    successHalf: pickBool(raw.successHalf, false),
    outcomes,
  };
}

function normalizeActions(raw: unknown, depth = 0): Action[] {
  return Array.isArray(raw) ? raw.map(action => normalizeAction(action, depth)).filter((action): action is Action => action !== null).slice(0, 30) : [];
}

export function normalizeTemplate(raw: unknown): SpellTemplate {
  const base = emptyTemplate();
  const t = isObject(raw) ? raw : {};
  const passport = isObject(t.passport) ? t.passport : {};
  const casting = isObject(t.casting) ? t.casting : {};
  const duration = isObject(t.duration) ? t.duration : {};
  const targeting = isObject(t.targeting) ? t.targeting : {};
  const options = isObject(t.options) ? t.options : {};
  const ending = isObject(t.ending) ? t.ending : {};
  const origin = isObject(t.origin) ? t.origin : {};
  const hints = isObject(t.hints) ? t.hints : {};
  const b = base.targeting;
  return {
    schemaVersion: SPELL_TEMPLATE_VERSION,
    passport: {
      name: pickString(passport.name, '', 200).trim(),
      nameEn: pickString(passport.nameEn, '', 200).trim(),
      level: pickNumber(passport.level, base.passport.level, 0, 9),
      school: pickString(passport.school, base.passport.school, 100) || base.passport.school,
      classes: pickStrings(passport.classes, 20),
      description: pickString(passport.description, '', 20000),
      higherLevel: pickString(passport.higherLevel, '', 5000),
      tags: pickOptions(passport.tags, TAGS),
      element: pickOption(passport.element, [['', '—'], ...DAMAGE_TYPES], ''),
      art: pickArt(passport.art),
    },
    casting: {
      time: pickOption(casting.time, CASTING_TIMES, base.casting.time),
      minutes: pickNumber(casting.minutes, 1, 1, 100000),
      trigger: pickOption(casting.trigger, REACTION_TRIGGERS, base.casting.trigger),
      triggerFeet: pickNumber(casting.triggerFeet, base.casting.triggerFeet, 0, 10000),
      triggerText: pickString(casting.triggerText, '', 300),
      ritual: pickBool(casting.ritual, false),
      verbal: pickBool(casting.verbal, true),
      somatic: pickBool(casting.somatic, true),
      material: pickBool(casting.material, false),
      materialText: pickString(casting.materialText, '', 500),
      materialCost: pickNumber(casting.materialCost, 0, 0, 1_000_000),
      materialConsumed: pickBool(casting.materialConsumed, false),
      range: pickOption(casting.range, RANGE_KINDS, base.casting.range),
      rangeValue: pickNumber(casting.rangeValue, base.casting.rangeValue, 0, 100000),
      rangeText: pickString(casting.rangeText, '', 200),
      needsSight: pickBool(casting.needsSight, true),
    },
    duration: {
      kind: pickOption(duration.kind, DURATION_KINDS, base.duration.kind),
      value: pickNumber(duration.value, 1, 1, 100000),
      text: pickString(duration.text, '', 200),
      concentration: pickBool(duration.concentration, false),
      dismiss: pickOption(duration.dismiss, DISMISS, 'none'),
      stacks: pickBool(duration.stacks, false),
    },
    targeting: {
      kind: pickOption(targeting.kind, TARGETING_KINDS, b.kind),
      count: pickNumber(targeting.count, b.count, 1, 100),
      countMode: targeting.countMode === 'up-to' ? 'up-to' : 'exact',
      side: pickOption(targeting.side, SIDES, b.side),
      includeSelf: pickBool(targeting.includeSelf, b.includeSelf),
      distinct: pickBool(targeting.distinct, b.distinct),
      maxApartFeet: pickNumber(targeting.maxApartFeet, 0, 0, 10000),
      typeMode: targeting.typeMode === 'only' || targeting.typeMode === 'except' ? targeting.typeMode : 'any',
      types: pickOptions(targeting.types, CREATURE_TYPES),
      maxSize: pickOption(targeting.maxSize, [['', '—'], ...SIZES], ''),
      maxHp: pickNumber(targeting.maxHp, 0, 0, 100000),
      maxInt: pickNumber(targeting.maxInt, 0, 0, 30),
      seesCaster: pickBool(targeting.seesCaster, false),
      hearsCaster: pickBool(targeting.hearsCaster, false),
      understands: pickBool(targeting.understands, false),
      shape: pickOption(targeting.shape, AREA_SHAPES, b.shape),
      sizeFeet: pickNumber(targeting.sizeFeet, b.sizeFeet, 5, 10000),
      widthFeet: pickNumber(targeting.widthFeet, b.widthFeet, 5, 1000),
      heightFeet: pickNumber(targeting.heightFeet, 0, 0, 10000),
      origin: pickOption(targeting.origin, AREA_ORIGINS, b.origin),
      affects: pickOption(targeting.affects, AREA_AFFECTS, b.affects),
      chosenMax: pickNumber(targeting.chosenMax, 0, 0, 100),
      aroundCorners: pickBool(targeting.aroundCorners, false),
      hops: pickNumber(targeting.hops, b.hops, 1, 20),
      hopFeet: pickNumber(targeting.hopFeet, b.hopFeet, 5, 1000),
      repeats: pickBool(targeting.repeats, false),
      objectKind: pickOption(targeting.objectKind, OBJECT_KINDS, b.objectKind),
      objectOwner: targeting.objectOwner === 'target' ? 'target' : 'self',
      objectFilter: pickOption(targeting.objectFilter, OBJECT_FILTERS, b.objectFilter),
      maxWeight: pickNumber(targeting.maxWeight, 0, 0, 100000),
      segments: pickNumber(targeting.segments, b.segments, 1, 100),
      segmentFeet: pickNumber(targeting.segmentFeet, b.segmentFeet, 5, 100),
      wallHeight: pickNumber(targeting.wallHeight, b.wallHeight, 1, 1000),
      wallThickness: pickNumber(targeting.wallThickness, b.wallThickness, 0, 100),
      wallShape: pickOption(targeting.wallShape, [['straight', 'прямая'], ['bent', 'изогнутая'], ['ring', 'кольцо']], 'straight'),
    },
    options: {
      modes: Array.isArray(options.modes)
        ? options.modes.filter(isObject).slice(0, 12).map(mode => ({ id: pickId(mode.id, 'm'), name: pickString(mode.name, 'Режим', 100) || 'Режим', actions: normalizeActions(mode.actions) }))
        : [],
      params: Array.isArray(options.params)
        ? options.params.filter(isObject).slice(0, 8).map(param => ({
            id: pickId(param.id, 'p'),
            key: pickString(param.key, 'параметр', 40).replace(/[{}\s]/g, '') || 'параметр',
            label: pickString(param.label, '', 100),
            kind: pickOption(param.kind, PARAM_KINDS, 'choice'),
            options: pickStrings(param.options, 30),
            chooser: pickOption(param.chooser, PARAM_CHOOSERS, 'caster'),
          }))
        : [],
    },
    actions: normalizeActions(t.actions),
    commands: Array.isArray(t.commands)
      ? t.commands.filter(isObject).slice(0, 8).map(command => ({
          id: pickId(command.id, 'c'),
          name: pickString(command.name, 'Команда', 100) || 'Команда',
          cost: pickOption(command.cost, COMMAND_COSTS, 'action'),
          when: pickOption(command.when, COMMAND_WHEN, 'after-cast'),
          does: pickOption(command.does, COMMAND_DOES, 'run-action'),
          feet: pickNumber(command.feet, 30, 0, 10000),
          actionId: pickString(command.actionId, '', 40),
          limit: pickOption(command.limit, COMMAND_LIMITS, 'turn'),
          limitCount: pickNumber(command.limitCount, 1, 1, 100),
        }))
      : [],
    scaling: Array.isArray(t.scaling)
      ? t.scaling.filter(isObject).slice(0, 12).map(rule => ({
          id: pickId(rule.id, 's'),
          what: pickOption(rule.what, SCALING_WHAT, 'damage'),
          per: pickOption(rule.per, SCALING_PER, 'slot'),
          ref: pickString(rule.ref, '', 40),
          amount: pickString(rule.amount, '', 120),
          steps: Array.isArray(rule.steps)
            ? rule.steps.filter(step => Array.isArray(step) && step.length === 2).slice(0, 10)
                .map(step => [pickNumber((step as unknown[])[0], 1, 0, 20), pickString((step as unknown[])[1], '', 120)] as [number, string])
            : [],
        }))
      : [],
    ending: {
      duration: pickBool(ending.duration, true),
      concentration: pickBool(ending.concentration, true),
      casterDown: pickBool(ending.casterDown, false),
      distanceFeet: pickNumber(ending.distanceFeet, 0, 0, 100000),
      targetActs: pickBool(ending.targetActs, false),
      targetDamaged: pickBool(ending.targetDamaged, false),
      targetSaves: pickBool(ending.targetSaves, false),
      dismissed: pickBool(ending.dismissed, true),
      recast: pickBool(ending.recast, false),
      afterUses: pickNumber(ending.afterUses, 0, 0, 1000),
      dispellable: pickBool(ending.dispellable, true),
      onEnd: normalizeActions(ending.onEnd),
    },
    hints: {
      purpose: pickOption(hints.purpose, PURPOSES, 'other'),
      prefer: pickOption(hints.prefer, PREFER, 'weakest-enemy'),
      avoidAllies: pickBool(hints.avoidAllies, true),
      logPhrase: pickString(hints.logPhrase, '', 300),
      sound: pickString(hints.sound, '', 200),
    },
    origin: {
      srd: /^[a-z0-9-]{1,64}$/.test(String(origin.srd ?? '')) ? String(origin.srd) : '',
      reviewed: pickBool(origin.reviewed, true),
    },
  };
}
