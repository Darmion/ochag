import type { SpellArea } from '../map/area-placement.ts';
import type { EffectiveSpellMechanics, SpellAbility, SpellDamageType } from './spell-mechanics.ts';
import type { ExpiresAt, HitPointPool, ProjectileRule, SpellRider } from './spell-riders.ts';
import { beasts, type SpellShape, type SpellSummon } from './summons.ts';
import type { MonsterSize } from '../srd/monsters.ts';
import { describeAction, describeEffect, EFFECT_CATALOG, parseTemplateFormula, primaryOutcome, type Action, type Effect, type Outcome, type Scaling, type SpellTemplate } from './spell-template.ts';

export type TemplateCode = { code: string; parameters: Record<string, unknown>; lasts?: string };

export type CastPlan = {
  mechanics: EffectiveSpellMechanics;
  riders: SpellRider[];
  projectiles: ProjectileRule | null;
  targetLimit: number | null;
  single: boolean;
  area: SpellArea | null;
  cylinderFeet: number | null;
  pool: HitPointPool | null;
  mods: Array<{ kind: string; values: Record<string, unknown> }>;
  conditions: Array<{ code: string; values: Record<string, unknown> }>;
  codes: TemplateCode[];
  removals: Array<Record<string, unknown>>;
  weapon: Record<string, unknown> | null;
  wall: Record<string, unknown> | null;
  teleportFeet: number | null;
  messages: Array<{ audience: string; text: string }>;
  followUps: { mainId: string | null; outcomes: Partial<Record<Outcome, Effect[]>>; actions: Action[]; timed: Action[]; zone: ZonePlan | null };
  manual: string[];
  rules: { only: string[]; excluded: string[]; mustSee: boolean };
  needsTarget: boolean;
  mainWho: string | null;
  restore: RestorePreset | null;
  summon: SpellSummon | null;
  shape: SpellShape | null;
};

const SUMMON_KINDS: Readonly<Record<string, SpellSummon['kind']>> = { familiar: 'familiar', steed: 'steed', conjure: 'conjure-animals' };

export type ZonePlan = {
  actions: Action[]; difficult: boolean; follows: boolean; spares: boolean; drift: number;
  shape: string; sizeFeet: number; heightFeet: number;
};

export type RestorePreset = 'stabilize' | 'revive' | 'greater-restoration';
const RESTORE_PRESETS: ReadonlySet<string> = new Set<RestorePreset>(['stabilize', 'revive', 'greater-restoration']);

export function engineFormula(text: string, context: { slotLevel: number; characterLevel: number }): { formula: string; approximated: boolean } | null {
  const terms = parseTemplateFormula(text);
  if (!terms) return null;
  const dice = terms.filter(term => term.dice && term.sign > 0);
  const main = dice[0];
  let count = 0;
  let constant = 0;
  let approximated = false;
  const tokens: string[] = [];
  for (const term of terms) {
    if (term.dice) {
      if (main && term.sides === main.sides && term.sign > 0) count += term.dice;
      else { constant += term.sign * term.dice * (term.sides + 1) / 2; approximated = true; }
    } else if (term.variable) {
      const value = term.variable === 'уровень' || term.variable === 'level' ? context.characterLevel
        : term.variable === 'круг' || term.variable === 'slot' ? context.slotLevel : null;
      if (value !== null) constant += term.sign * value;
      else tokens.push(`${term.sign < 0 ? '-' : '+'}@${term.variable}`);
    } else constant += term.sign * term.value;
  }
  const rounded = Math.trunc(constant);
  if (!main) return { formula: `1d1${rounded - 1 >= 0 ? '+' : ''}${rounded - 1}${tokens.join('')}`, approximated };
  return { formula: `${count}d${main.sides}${rounded ? `${rounded > 0 ? '+' : ''}${rounded}` : ''}${tokens.join('')}`, approximated };
}

const LASTS_TO_EXPIRES: Readonly<Record<string, ExpiresAt>> = {
  'caster-next-start': 'caster-start', 'caster-next-end': 'caster-end', 'target-next-start': 'target-start', 'target-next-end': 'target-end',
};

const PRESET_RIDERS: Readonly<Record<string, SpellRider[]>> = {
  sanctuary: [{ kind: 'sanctuary' }], 'protection-from-evil': [{ kind: 'protected_from_evil' }], heroism: [{ kind: 'heroism' }],
  stupor: [{ kind: 'stupor' }], haste: [{ kind: 'hasted' }], slow: [{ kind: 'slow_spell' }],
  darkness: [{ kind: 'darkness', radius: 15, dispelsLight: 2 }],
  daylight: [{ kind: 'dispel_darkness', upTo: 3 }, { kind: 'light', bright: 60, dim: 60, replaces: false }],
  light: [{ kind: 'light', bright: 20, dim: 20, replaces: true }],
  'faerie-fire': [{ kind: 'light', bright: 0, dim: 10, replaces: false }, { kind: 'outlined' }],
  bless: [{ kind: 'blessed', die: 4 }], bane: [{ kind: 'baned', die: 4 }],
};
const PRESET_CODES: Readonly<Record<string, TemplateCode>> = {
  'mirror-images': { code: 'mirror_images', parameters: { images: 3 } }, 'death-ward': { code: 'death_ward', parameters: {} },
  blur: { code: 'blurred', parameters: {} }, 'true-strike': { code: 'true_strike', parameters: {} }, guidance: { code: 'guidance', parameters: {} },
  'resistance-die': { code: 'resistance_die', parameters: {} }, expeditious: { code: 'expeditious', parameters: {} },
  stoneskin: { code: 'stoneskin', parameters: {} }, 'warding-bond': { code: 'warding_bond', parameters: {} },
  'beacon-of-hope': { code: 'beacon_of_hope', parameters: {} },
  barkskin: { code: 'barkskin', parameters: {} }, longstrider: { code: 'longstrider', parameters: {} },
  darkvision: { code: 'darkvision_spell', parameters: {} }, 'spider-climb': { code: 'spider_climb', parameters: {} },
  'energy-ward': { code: 'energy_ward', parameters: {} },
};

export const TIMED_WHEN = ['target-turn-start', 'target-turn-end', 'caster-turn-start'] as const;

export function templateFormula(t: SpellTemplate, formula: string, what: Scaling['what'], refs: string[], slotLevel: number, characterLevel: number): string | null {
  const level = Math.max(t.passport.level, slotLevel);
  const rule = t.scaling.find(entry => entry.what === what && (!entry.ref || refs.includes(entry.ref)));
  return engineFormula(grow(formula, rule, level - t.passport.level, Math.max(1, characterLevel), level), { slotLevel: level, characterLevel: Math.max(1, characterLevel) })?.formula ?? null;
}

const AREA_SHAPE: Readonly<Record<string, SpellArea['shape']>> = { sphere: 'circle', cylinder: 'circle', cube: 'square', square: 'square', cone: 'cone', line: 'line' };

function scaledBy(rule: Scaling, levels: number, characterLevel: number): number {
  if (rule.per === 'cantrip') return characterLevel >= 17 ? 3 : characterLevel >= 11 ? 2 : characterLevel >= 5 ? 1 : 0;
  if (rule.per === 'two-slots') return Math.floor(levels / 2);
  return levels;
}

function stepValue(rule: Scaling, slotLevel: number): string | null {
  const reached = rule.steps.filter(([slot]) => slot <= slotLevel).sort((a, b) => a[0] - b[0]);
  return reached.length ? reached[reached.length - 1]![1] : null;
}

function grow(formula: string, rule: Scaling | undefined, levels: number, characterLevel: number, slotLevel: number): string {
  if (!rule) return formula;
  if (rule.per === 'steps') return stepValue(rule, slotLevel) ?? formula;
  const times = scaledBy(rule, levels, characterLevel);
  if (!times) return formula;
  const add = parseTemplateFormula(rule.amount);
  if (!add) return formula;
  return `${formula} ${Array.from({ length: times }, () => `+ ${rule.amount}`).join(' ')}`;
}

export function durationRoundsOf(t: SpellTemplate): number | null {
  const d = t.duration;
  return d.kind === 'rounds' ? d.value : d.kind === 'minutes' ? d.value * 10 : d.kind === 'hours' ? d.value * 600 : d.kind === 'days' ? d.value * 14_400 : null;
}

export function templateCastPlan(t: SpellTemplate, options: { slotLevel: number; characterLevel: number; mode?: string | null }): CastPlan {
  const slotLevel = Math.max(t.passport.level, options.slotLevel);
  const levels = Math.max(0, slotLevel - t.passport.level);
  const characterLevel = Math.max(1, options.characterLevel);
  const context = { slotLevel, characterLevel };
  const manual: string[] = [];
  const mode = t.options.modes.find(entry => entry.id === options.mode || entry.name === options.mode) ?? t.options.modes[0] ?? null;
  const actions = [...t.actions, ...(mode?.actions ?? [])];
  const ruleFor = (what: Scaling['what'], ref: string) => t.scaling.find(rule => rule.what === what && (!rule.ref || rule.ref === ref));
  const ruleOf = (what: Scaling['what']) => t.scaling.find(rule => rule.what === what);

  let main = actions.find(action => action.when === 'cast') ?? null;
  let createsZone = false;
  let zonePlan: CastPlan['followUps']['zone'] = null;
  const zone = main ? (main.outcomes[primaryOutcome(main)] ?? []).find(effect => effect.kind === 'zone') : undefined;
  if (main && zone) {
    const inner = zone.actions.find(action => action.when.startsWith('zone-')) ?? zone.actions[0];
    if (inner) {
      createsZone = true;
      zonePlan = {
        actions: [...zone.actions], difficult: zone.values.difficult === true, follows: zone.values.follows === true,
        spares: zone.values.spares === true, drift: Math.max(0, Number(zone.values.drift ?? 0)),
        shape: String(zone.values.shape ?? 'sphere'), sizeFeet: Number(zone.values.sizeFeet ?? 20), heightFeet: Number(zone.values.heightFeet ?? 0),
      };
      for (const other of (main.outcomes[primaryOutcome(main)] ?? []).filter(effect => effect !== zone)) manual.push(`«${main.name}»: ${describeEffect(other)}`);
      const traits = ['darkness', 'silence'].filter(key => zone.values[key] === true);
      if (traits.length || (zone.values.obscured ?? 'none') !== 'none' || Number(zone.values.lightFeet ?? 0) > 0) manual.push(`«${main.name}»: ${describeEffect({ ...zone, values: { ...zone.values, difficult: false } })}`);
      main = inner;
    }
  }
  const followUps: CastPlan['followUps'] = { mainId: main?.id ?? null, outcomes: {}, actions: [], timed: [], zone: zonePlan };
  for (const action of actions) {
    if (action === main || (zone && action.outcomes[primaryOutcome(action)]?.includes(zone))) continue;
    if (action.when === 'cast') followUps.actions.push(action);
    else if ((TIMED_WHEN as readonly string[]).includes(action.when)) followUps.timed.push(action);
    else if (action.when === 'spell-end') continue;
    else if (action.when === 'command' && t.commands.some(command => command.does === 'run-action' && command.actionId === action.id)) continue;
    else manual.push(describeAction(action));
  }

  const primary = main ? primaryOutcome(main) : 'always';
  const effects: Effect[] = main ? main.outcomes[primary] ?? [] : [];
  if (main) {
    for (const [outcome, list] of Object.entries(main.outcomes) as Array<[Outcome, Effect[] | undefined]>) {
      if (outcome === primary || !list?.length) continue;
      followUps.outcomes[outcome] = [...list];
    }
  }

  const mechanics: EffectiveSpellMechanics = {
    attack: main?.check.kind === 'attack' ? main.check.attackRange : null,
    save: main?.check.kind === 'save' ? main.check.ability as SpellAbility : null,
    halfOnSave: Boolean(main?.successHalf),
    damageFormula: null, damageType: null, healingFormula: null, upcastFormula: null,
    condition: null, conditionRounds: null, repeatSave: null,
    cantripScaling: false,
    createsZone,
  };
  if (main && (main.check.kind === 'ability' || main.check.kind === 'contest' || main.check.kind === 'caster-d20' || main.check.kind === 'hp-threshold')) {
    manual.push(`«${main.name}»: проверка — ${describeAction(main)}`);
  }

  const plan: CastPlan = {
    mechanics, riders: [], projectiles: null, targetLimit: null, single: false, area: null, cylinderFeet: null, pool: null,
    mods: [], conditions: [], codes: [], removals: [], weapon: null, wall: null, teleportFeet: null, messages: [], followUps, manual,
    rules: {
      only: t.targeting.typeMode === 'only' ? t.targeting.types : [],
      excluded: t.targeting.typeMode === 'except' ? t.targeting.types : [],
      mustSee: t.casting.needsSight,
    },
    needsTarget: t.targeting.kind === 'creatures' || t.targeting.kind === 'chain' || (t.targeting.kind === 'object' && t.targeting.objectOwner === 'target'),
    mainWho: main?.who ?? null,
    restore: null,
    summon: null,
    shape: null,
  };

  const g = t.targeting;
  if (g.kind === 'area') {
    plan.area = { shape: AREA_SHAPE[g.shape] ?? 'circle', sizeFeet: g.sizeFeet + (ruleOf('area') ? scaledBy(ruleOf('area')!, levels, characterLevel) * Number(ruleOf('area')!.amount || 0) : 0), widthFeet: g.shape === 'line' ? g.widthFeet : null, fromSelf: g.origin === 'self' || g.shape === 'cone' || g.shape === 'line' };
    if (g.shape === 'cylinder' && g.heightFeet) plan.cylinderFeet = g.heightFeet;
    if (g.affects === 'chosen' && g.chosenMax > 0) plan.targetLimit = g.chosenMax;
  }
  if (g.kind === 'wall') {
    plan.area = { shape: 'line', sizeFeet: Math.max(5, Math.max(1, g.segments) * Math.max(5, g.segmentFeet)), widthFeet: 5, fromSelf: false };
  }
  if (g.kind === 'creatures' || g.kind === 'chain') {
    const more = ruleOf('targets');
    const count = g.count + (more ? scaledBy(more, levels, characterLevel) * Number(more.amount || 1) : 0) + (g.kind === 'chain' ? g.hops : 0);
    plan.single = count === 1 && !g.includeSelf && g.countMode !== 'any';
    if (g.countMode !== 'any' && (count > 1 || g.countMode === 'up-to')) plan.targetLimit = count;
  }

  if (main && (main.check.attackCount > 1 || ruleOf('projectiles')?.per === 'cantrip')) {
    const more = ruleOf('projectiles');
    plan.projectiles = { base: main.check.attackCount, noun: main.check.kind === 'attack' ? 'ray' : 'dart', perSlotFrom: more && more.per === 'slot' ? t.passport.level : null, byLevel: null };
    if (more && more.per === 'cantrip') plan.projectiles.byLevel = [[5, main.check.attackCount + 1], [11, main.check.attackCount + 2], [17, main.check.attackCount + 3]];
  }

  let conditionTaken = false;
  const later = (effect: Effect) => { (followUps.outcomes[primary] ??= []).push(effect); };
  for (const effect of effects) {
    const v = effect.values;
    const lasts = String(v.lasts ?? 'spell');
    const expires = LASTS_TO_EXPIRES[lasts];
    switch (effect.kind) {
      case 'damage': {
        if (mechanics.damageFormula) { later(effect); break; }
        const rule = ruleFor('damage', effect.id) ?? ruleFor('damage', main?.id ?? '');
        const resolved = engineFormula(grow(String(v.formula ?? ''), rule, levels, characterLevel, slotLevel), context);
        if (!resolved) { manual.push(describeEffect(effect)); break; }
        mechanics.damageFormula = resolved.formula;
        mechanics.damageType = (v.damageType === 'param' || v.damageType === 'weapon' ? null : String(v.damageType)) as SpellDamageType | null;
        if (rule?.per === 'cantrip') {
          mechanics.damageFormula = engineFormula(String(v.formula ?? ''), context)?.formula ?? resolved.formula;
          mechanics.cantripScaling = true;
        }
        if (resolved.approximated) manual.push(`Урон «${v.formula}»: кости разных видов — в бою вторая группа считается средним.`);
        if (v.split === 'split') manual.push('Урон делится между целями — разделите вручную.');
        break;
      }
      case 'heal': {
        if (mechanics.healingFormula) { later(effect); break; }
        const resolved = engineFormula(grow(String(v.formula ?? ''), ruleFor('healing', effect.id) ?? ruleFor('healing', main?.id ?? ''), levels, characterLevel, slotLevel), context);
        if (resolved) mechanics.healingFormula = resolved.formula;
        else manual.push(describeEffect(effect));
        break;
      }
      case 'temp-hp': {
        const resolved = engineFormula(grow(String(v.formula ?? ''), ruleFor('temp-hp', effect.id), levels, characterLevel, slotLevel), context);
        if (v.eachTurn === true) manual.push(`${describeEffect(effect)} — каждый ход, вручную`);
        else if (resolved) plan.riders.push({ kind: 'temp_hp', dice: resolved.formula, perSlot: 0 });
        break;
      }
      case 'max-hp': {
        const bonus = Math.round(Number(engineAverage(grow(String(v.formula ?? '0'), ruleFor('bonus', effect.id), levels, characterLevel, slotLevel), context)));
        if (bonus > 0) plan.riders.push({ kind: 'aid', bonus });
        break;
      }
      case 'condition': {
        const code = String(v.code);
        const durationKind = String(v.duration);
        const fitsMechanics = !conditionTaken && code !== 'exhaustion' && v.endsOnDamage !== true
          && (durationKind === 'spell' || durationKind === 'rounds' || durationKind === 'until-save') && v.repeatSave !== 'damaged';
        if (fitsMechanics) {
          conditionTaken = true;
          mechanics.condition = code;
          mechanics.conditionRounds = durationKind === 'rounds' ? Number(v.rounds ?? 1) : durationRoundsOf(t);
          mechanics.repeatSave = v.repeatSave === 'start' || v.repeatSave === 'end' ? v.repeatSave : null;
        } else plan.conditions.push({ code, values: { ...v } });
        break;
      }
      case 'ac':
        if (v.mode === 'plus' && lasts === 'spell') plan.riders.push({ kind: 'ac_bonus', bonus: Number(v.value ?? 0) });
        else if (v.mode === 'base' && lasts === 'spell') plan.riders.push({ kind: 'mage_armor', base: Number(v.value ?? 13) });
        else plan.mods.push({ kind: 'ac', values: { ...v } });
        break;
      case 'speed':
        if (v.mode === 'fly') plan.riders.push({ kind: 'flying', feet: Number(v.feet ?? 30) });
        else if (v.mode === 'minus' && expires) plan.riders.push({ kind: 'slowed', feet: Number(v.feet ?? 10), expires });
        else if (v.mode === 'climb') plan.codes.push({ code: 'spider_climb', parameters: { feet: Number(v.feet ?? 0) } });
        else if (v.mode === 'swim') manual.push(describeEffect(effect));
        else plan.mods.push({ kind: 'speed', values: { ...v } });
        break;
      case 'attack-rolls':
        if (v.whose === 'against' && v.mode === 'advantage' && v.scope === 'first' && expires) plan.riders.push({ kind: 'guided', expires });
        else if (v.whose === 'own' && v.mode === 'disadvantage' && v.scope === 'first' && expires) plan.riders.push({ kind: 'mocked', expires });
        else if (v.scope === 'vs-caster') manual.push(describeEffect(effect));
        else plan.mods.push({ kind: 'attack-rolls', values: { ...v } });
        break;
      case 'checks':
      case 'defense':
      case 'extra-action':
        plan.mods.push({ kind: effect.kind, values: { ...v } });
        break;
      case 'restrict': {
        const what = (v.what as string[] | undefined) ?? [];
        if (what.includes('no-reactions') && expires) plan.riders.push({ kind: 'no_reactions', expires });
        if (what.includes('no-healing') && expires) plan.riders.push({ kind: 'no_healing', expires });
        if (what.includes('no-approach')) manual.push('Не может приближаться к заклинателю — следите вручную.');
        const rest = what.filter(entry => !(expires && (entry === 'no-reactions' || entry === 'no-healing')) && entry !== 'no-approach');
        if (rest.length) plan.mods.push({ kind: 'restrict', values: { ...v, what: rest } });
        break;
      }
      case 'extra-damage':
        if (v.against === 'target' && (v.on === 'weapon' || v.on === 'any')) {
          const resolved = engineFormula(String(v.formula ?? ''), context);
          if (resolved) plan.riders.push({ kind: 'marked', dice: resolved.formula });
        } else plan.mods.push({ kind: 'extra-damage', values: { ...v } });
        break;
      case 'senses':
        if (v.sense === 'light') plan.riders.push({ kind: 'light', bright: Number(v.feet ?? 20), dim: Number(v.dimFeet ?? 20), replaces: t.ending.recast });
        else if (v.sense === 'truesight') plan.codes.push({ code: 'truesight', parameters: { feet: Number(v.feet ?? 60) } });
        else if (v.sense === 'see-invisible') plan.codes.push({ code: 'see_invisibility', parameters: {} });
        else plan.mods.push({ kind: 'senses', values: { ...v } });
        break;
      case 'invisible':
        plan.codes.push({ code: 'invisible', parameters: v.breaks === 'never' ? {} : { endsOnAttack: true } });
        break;
      case 'move':
        if (v.mode === 'push') plan.riders.push({ kind: 'push', feet: Number(v.feet ?? 10) });
        else if (v.mode === 'teleport' && v.who === 'self' && g.kind === 'place') plan.teleportFeet = Number(v.feet ?? 30);
        else if (v.mode === 'pull') later(effect);
        else manual.push(describeEffect(effect));
        break;
      case 'remove':
        if (v.what === 'spells') plan.riders.push({ kind: 'dispel', upTo: Number(v.upTo ?? 3) });
        else if (v.what === 'one-condition') plan.riders.push({ kind: 'restore', conditions: (v.conditions as string[]) ?? [], kinds: (v.kinds as string[] | undefined) ?? [] });
        else plan.removals.push({ ...v });
        break;
      case 'weapon': {
        const rule = ruleFor('bonus', effect.id);
        plan.weapon = { ...v, ...(rule ? { bonus: Math.round(engineAverage(grow(String(v.bonus ?? 0), rule, levels, characterLevel, slotLevel), context)) } : {}) };
        if (String(v.extraFormula ?? '').trim()) manual.push(`Добавочный урон оружия ${v.extraFormula} — пока вручную.`);
        break;
      }
      case 'summon': {
        const kind = SUMMON_KINDS[String(v.rules ?? 'plain')];
        if (!kind) { manual.push(`«${main?.name ?? 'Действие'}»: ${describeEffect(effect)} — пока вручную`); break; }
        const named = String(v.creatures ?? '').split(',').map(entry => entry.trim()).filter(Boolean);
        const forms = named.length ? named : beasts().filter(beast => beast.cr <= Number(v.maxCr ?? 0)).map(beast => beast.index);
        plan.summon = { kind, forms, concentration: Array.isArray(v.vanish) && v.vanish.includes('concentration') };
        break;
      }
      case 'shape':
        plan.shape = {
          kind: v.consent === 'willing' ? 'animal-shapes' : 'polymorph',
          maxCr: v.limit === 'fixed' ? Number(v.maxCr ?? 0) : null,
          maxSize: v.maxSize ? String(v.maxSize) as MonsterSize : null,
        };
        break;
      case 'pool':
        if (v.mode === 'hp-pool') {
          const rule = ruleOf('threshold');
          plan.pool = { dice: engineFormula(String(v.formula ?? '5к8'), context)?.formula ?? '5d8', perSlot: rule && rule.per === 'slot' ? engineFormula(rule.amount, context)?.formula ?? null : null };
        } else manual.push(describeEffect(effect));
        break;
      case 'preset': {
        const preset = String(v.preset);
        if (preset === 'sleep') plan.pool = { dice: '5d8', perSlot: '2d8' };
        else if (PRESET_RIDERS[preset]) plan.riders.push(...PRESET_RIDERS[preset]!);
        else if (PRESET_CODES[preset]) plan.codes.push({ ...PRESET_CODES[preset]!, ...(v.lasts && v.lasts !== 'spell' ? { lasts: String(v.lasts) } : {}) });
        else if (RESTORE_PRESETS.has(preset)) plan.restore = preset as RestorePreset;
        break;
      }
      case 'message':
        plan.messages.push({ audience: String(v.audience ?? 'all'), text: String(v.text ?? '') });
        break;
      case 'wall':
        if (g.kind === 'wall' && !plan.wall) {
          plan.wall = { ...v };
          if (String(v.damageFormula ?? '').trim()) manual.push(`Стена: урон ${v.damageFormula} при проходе — вручную.`);
        } else manual.push(describeEffect(effect));
        break;
      default:
        manual.push(`«${main?.name ?? 'Действие'}»: ${describeEffect(effect)}${EFFECT_CATALOG[effect.kind].support === 'no' ? '' : ' — пока вручную'}`);
    }
  }
  if (plan.projectiles || plan.pool) plan.single = false;
  return plan;
}

export function engineAverage(text: string, context: { slotLevel: number; characterLevel: number }): number {
  const terms = parseTemplateFormula(text);
  if (!terms) return 0;
  return terms.reduce((sum, term) => sum + term.sign * (term.dice ? term.dice * (term.sides + 1) / 2
    : term.variable === 'уровень' || term.variable === 'level' ? context.characterLevel
    : term.variable === 'круг' || term.variable === 'slot' ? context.slotLevel : term.variable ? 0 : term.value), 0);
}
