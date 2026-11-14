import { cantripDiceMultiplier, deriveSpellMechanics, mergeSpellMechanics, type EffectiveSpellMechanics } from '../../../../packages/domain/spells/spell-mechanics.ts';
import {
  aidPerSlot, hitPointPool, projectileCount, projectileRule, singleTarget, spellRiders, targetLimit, tempHpPerSlot,
  type HitPointPool, type ProjectileRule, type SpellRider,
} from '../../../../packages/domain/spells/spell-riders.ts';
import { spellTargetRules } from '../../../../packages/domain/spells/spell-targets.ts';
import { spellShape, spellSummon, type SpellShape, type SpellSummon } from '../../../../packages/domain/spells/summons.ts';
import { durationRoundsOf, templateCastPlan } from '../../../../packages/domain/spells/spell-template-engine.ts';
import { srdTemplateOf } from '../../../../packages/domain/spells/srd-spell-templates.ts';
import { findSrdSpell, srdSpells, type SrdSpell } from '../rules/srd-data.ts';

// The ready-made effects of the old text path, kept as the baseline the tables were checked against.
const OLD_EFFECTS: Readonly<Record<string, { code: string; rounds: number; self?: boolean; parameters?: Record<string, unknown> }>> = {
  invisibility: { code: 'invisible', rounds: 600, parameters: { endsOnAttack: true } },
  'greater-invisibility': { code: 'invisible', rounds: 10 },
  'see-invisibility': { code: 'see_invisibility', rounds: 600, self: true },
  'true-seeing': { code: 'truesight', rounds: 600, parameters: { feet: 120 } },
  guidance: { code: 'guidance', rounds: 10 },
  resistance: { code: 'resistance_die', rounds: 10 },
  'true-strike': { code: 'true_strike', rounds: 2, self: true },
  barkskin: { code: 'barkskin', rounds: 600 },
  longstrider: { code: 'longstrider', rounds: 600 },
  'spider-climb': { code: 'spider_climb', rounds: 600 },
  'expeditious-retreat': { code: 'expeditious', rounds: 100, self: true },
  blur: { code: 'blurred', rounds: 10, self: true },
  'protection-from-energy': { code: 'energy_ward', rounds: 600 },
  stoneskin: { code: 'stoneskin', rounds: 600 },
  'death-ward': { code: 'death_ward', rounds: 4800 },
  'mirror-image': { code: 'mirror_images', rounds: 10, self: true, parameters: { images: 3 } },
  shillelagh: { code: 'shillelagh', rounds: 10, self: true },
  'magic-weapon': { code: 'magic_weapon', rounds: 600 },
  'warding-bond': { code: 'warding_bond', rounds: 600 },
  'beacon-of-hope': { code: 'beacon_of_hope', rounds: 10 },
  darkvision: { code: 'darkvision_spell', rounds: 4800 },
};

export const TEXT_AID_SPELLS: ReadonlyMap<string, string> = new Map([['spare-the-dying', 'stabilize'], ['revivify', 'revive'], ['raise-dead', 'revive'], ['greater-restoration', 'greater-restoration']]);
const CHARACTER_LEVELS = [1, 5, 11, 17];

type Signature = Record<string, unknown>;

const sorted = (value: Record<string, unknown> | undefined) => JSON.stringify(Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b))));
const onSelf = (range: string | null | undefined) => /^self/i.test(String(range ?? '').trim());

const summonView = (rule: SpellSummon | null) => (rule ? [`summon:${rule.kind}:${[...rule.forms].sort().join(',')}:${rule.concentration}`] : []);
const shapeView = (rule: SpellShape | null) => (rule ? [`shape:${rule.kind}:${rule.maxCr}:${rule.maxSize}`] : []);

const norm = (formula: string | null | undefined) => (formula ? formula.replace(/\s+/g, '').replace(/к/g, 'd').toLowerCase() : null);

function grown(formula: string | null, upcast: string | null, extra: number): string | null {
  const base = norm(formula);
  if (!base || !upcast || extra <= 0) return base;
  const head = /^(\d+)d(\d+)(.*)$/.exec(base);
  const more = /^(\d+)d(\d+)$/.exec(norm(upcast) ?? '');
  if (!head || !more || head[2] !== more[2]) return `${base}|+${upcast}×${extra}`;
  return `${Number(head[1]) + Number(more[1]) * extra}d${head[2]}${head[3]}`;
}

function cantrip(formula: string | null, scaling: boolean, level: number, characterLevel: number): string | null {
  if (!formula || level !== 0 || !scaling) return formula;
  const head = /^(\d+)(d.*)$/.exec(formula);
  return head ? `${Number(head[1]) * cantripDiceMultiplier(characterLevel)}${head[2]}` : formula;
}

function average(formula: string): number {
  return [...formula.replace(/\s+/g, '').replace(/к/g, 'd').matchAll(/([+-]?)(\d+)(?:d(\d+))?/g)]
    .reduce((sum, [, sign, count, sides]) => sum + (sign === '-' ? -1 : 1) * (sides ? Number(count) * (Number(sides) + 1) / 2 : Number(count)), 0);
}

function riderView(riders: SpellRider[], extraTempHp: number, extraAid: number) {
  return riders.map(rider => {
    if (rider.kind === 'temp_hp') return { kind: 'temp_hp', average: average(rider.dice) + rider.perSlot + extraTempHp };
    if (rider.kind === 'aid') return { kind: 'aid', bonus: rider.bonus + extraAid };
    return rider;
  }).map(rider => JSON.stringify(rider)).sort();
}

function poolView(pool: HitPointPool | null, extra: number) {
  return pool ? grown(pool.dice, pool.perSlot, extra) : null;
}

function projectileView(rule: ProjectileRule | null, slotLevel: number, characterLevel: number) {
  return rule ? projectileCount(rule, slotLevel, characterLevel) : null;
}

function mechanicsView(m: EffectiveSpellMechanics, level: number, slotLevel: number, characterLevel: number, upcast: string | null) {
  const extra = Math.max(0, slotLevel - level);
  return {
    attack: m.attack, save: m.save, halfOnSave: m.save ? m.halfOnSave : false,
    damage: cantrip(grown(m.damageFormula, upcast, extra), m.cantripScaling, level, characterLevel),
    damageType: m.damageFormula ? m.damageType : null,
    healing: cantrip(grown(m.healingFormula, upcast, extra), m.cantripScaling, level, characterLevel),
    condition: m.condition, conditionRounds: m.condition ? m.conditionRounds : null, repeatSave: m.condition ? m.repeatSave : null,
    createsZone: m.createsZone,
  };
}

export function textSignature(spell: SrdSpell, slotLevel: number, characterLevel: number): Signature {
  const text = { desc: spell.desc, higherLevel: spell.higherLevel ?? null };
  let m = mergeSpellMechanics(deriveSpellMechanics(spell as Parameters<typeof deriveSpellMechanics>[0]), null);
  const riders = spellRiders(spell.desc);
  const pool = hitPointPool(text);
  if (pool) m = { ...m, condition: null };
  if (riders.some(rider => rider.kind === 'sanctuary')) m = { ...m, save: null };
  if (riders.some(rider => rider.kind === 'light') && /target an object held or worn by a hostile creature/i.test(spell.desc)) m = { ...m, save: null };
  const extra = Math.max(0, slotLevel - spell.level);
  const rules = spellTargetRules(spell.desc);
  const special = [
    ...(OLD_EFFECTS[spell.index] ? [`effect:${OLD_EFFECTS[spell.index]!.code}:${sorted(OLD_EFFECTS[spell.index]!.parameters)}:${OLD_EFFECTS[spell.index]!.self === true || onSelf(spell.range)}:${OLD_EFFECTS[spell.index]!.rounds}`] : []),
    ...(TEXT_AID_SPELLS.has(spell.index) ? [`restore:${TEXT_AID_SPELLS.get(spell.index)}`] : []),
    ...(spell.index === 'misty-step' ? ['teleport'] : []),
    ...summonView(spellSummon(spell.index)),
    ...shapeView(spellShape(spell.index)),
  ];
  return {
    ...mechanicsView(m, spell.level, slotLevel, characterLevel, m.upcastFormula),
    riders: riderView(riders, tempHpPerSlot(spell.higherLevel) * extra, aidPerSlot(spell.higherLevel) * extra),
    projectiles: projectileView(projectileRule(text), slotLevel, characterLevel),
    pool: poolView(pool, extra),
    limit: targetLimit(text, slotLevel),
    single: singleTarget({ ...text, range: spell.range ?? null }, spell.level, slotLevel),
    element: spell.index === 'protection-from-energy',
    weapon: spell.index === 'shillelagh' ? { filter: 'club-staff', bonus: 0 }
      : spell.index === 'magic-weapon' ? { filter: 'nonmagical', bonus: slotLevel >= 6 ? 3 : slotLevel >= 4 ? 2 : 1 } : null,
    rules: { only: rules.only ? [rules.only] : [], excluded: [...rules.excluded].sort(), mustSee: rules.mustSee },
    special,
  };
}

export function templateSignature(spell: SrdSpell, slotLevel: number, characterLevel: number): Signature | null {
  const template = srdTemplateOf(spell.index);
  if (!template) return null;
  const plan = templateCastPlan(template, { slotLevel, characterLevel, mode: null });
  let m = plan.mechanics;
  if (plan.pool) m = { ...m, condition: null };
  if (plan.riders.some(rider => rider.kind === 'sanctuary')) m = { ...m, save: null };
  const extra = Math.max(0, slotLevel - spell.level);
  const f = plan.followUps;
  const special = [
    ...plan.manual.map(text => `manual:${text}`),
    ...plan.messages.map(message => `message:${message.audience}`),
    ...Object.keys(f.outcomes).map(outcome => `outcome:${outcome}`),
    ...f.actions.map(action => `action:${action.name}`),
    ...f.timed.map(action => `timed:${action.name}`),
    ...(f.zone && !m.createsZone ? ['zone'] : []),
    ...plan.mods.map(mod => `mod:${mod.kind}`),
    ...plan.conditions.map(condition => `condition:${condition.code}`),
    ...plan.codes.map(code => `effect:${code.code}:${sorted(code.parameters)}:${plan.mainWho === 'caster' || template.targeting.kind === 'self' || onSelf(spell.range)}:${code.lasts ?? durationRoundsOf(template)}`),
    ...plan.removals.map(() => 'removal'),
    ...(plan.weapon && Number(plan.weapon.bonus ?? 0) > 0 ? [`effect:magic_weapon:{}:${template.targeting.objectOwner === 'self'}:${durationRoundsOf(template)}`] : []),
    ...(plan.weapon && (plan.weapon.castingAbility === true || (plan.weapon.die && plan.weapon.die !== 'none')) ? [`effect:shillelagh:{}:${template.targeting.objectOwner === 'self'}:${durationRoundsOf(template)}`] : []),
    ...(plan.wall ? ['wall'] : []),
    ...(plan.restore ? [`restore:${plan.restore}`] : []),
    ...summonView(plan.summon),
    ...shapeView(plan.shape),
    ...(plan.teleportFeet ? ['teleport'] : []),
    ...(template.options.modes.length ? ['modes'] : []),
    ...(template.options.params.some(param => param.kind !== 'damage-type') ? ['params'] : []),
    ...(template.commands.length ? ['commands'] : []),
    ...(template.ending.onEnd.length ? ['on-end'] : []),
  ];
  return {
    ...mechanicsView(m, spell.level, slotLevel, characterLevel, null),
    riders: riderView(plan.riders, 0, 0),
    projectiles: projectileView(plan.projectiles, slotLevel, characterLevel),
    pool: poolView(plan.pool, extra),
    limit: plan.targetLimit,
    single: plan.single,
    element: template.options.params.some(param => param.kind === 'damage-type'),
    weapon: plan.weapon ? { filter: template.targeting.objectFilter, bonus: Number(plan.weapon.bonus ?? 0) } : null,
    rules: { only: [...plan.rules.only].sort(), excluded: [...plan.rules.excluded].sort(), mustSee: plan.rules.mustSee },
    special,
  };
}

export type ParityResult = {
  index: string; same: boolean; zone: boolean;
  differences: Array<{ field: string; slotLevel: number; characterLevel: number; text: unknown; template: unknown }>;
};

// Zones whose tables were checked by hand: the text cast them as one blast, the table keeps the zone and its move command.
export const ZONES_CHECKED: ReadonlySet<string> = new Set(['moonbeam', 'sleet-storm', 'zone-of-truth', 'spirit-guardians', 'cloudkill', 'spike-growth', 'web']);

// Text misreadings: "can't be charmed" as a charm on the warded creature; one of Hallow's options as the whole spell;
// the grasping hand's 2d6 as the clenched fist's growth (a cast at a higher slot failed on mixed dice); "neutralize the poison"
// as poisoning; Heal's 70 hit points and the diseases it ends, and the curses Remove Curse ends, the text never cast at all.
const TEXT_ERRORS: Readonly<Record<string, readonly string[]>> = {
  'protection-from-evil-and-good': ['condition', 'conditionRounds'],
  hallow: ['save', 'condition', 'conditionRounds'],
  'arcane-hand': ['damage'],
  web: ['damage', 'damageType'],
  'protection-from-poison': ['condition', 'conditionRounds', 'special'],
  heal: ['healing', 'special'],
  'remove-curse': ['special'],
};

// Differences where the table is the stricter reading of the rules, accepted when a spell moves to its table.
function accepted(field: string, text: Signature, template: Signature, spell: SrdSpell, slotLevel: number): boolean {
  if (TEXT_ERRORS[spell.index]?.includes(field)) return true;
  if (ZONES_CHECKED.has(spell.index) && ['createsZone', 'condition', 'conditionRounds'].includes(field)) return true;
  if (field === 'special') {
    const own = (template.special as string[]).filter(entry => !entry.startsWith('manual:') && !(ZONES_CHECKED.has(spell.index) && (entry === 'commands' || entry.startsWith('message:'))));
    const old = (text.special as string[]).map(entry => entry.replace(/:true:2$/, ':true:caster-next-end'));
    return JSON.stringify(own) === JSON.stringify(old);
  }
  if (field === 'limit') return text.limit === null && typeof template.limit === 'number' && slotLevel > spell.level && text.projectiles === null && template.projectiles === null;
  if (field === 'conditionRounds') return typeof text.conditionRounds === 'number' && typeof template.conditionRounds === 'number' && text.conditionRounds >= 1000 && template.conditionRounds >= 1000;
  return false;
}

export function srdParity(index: string): ParityResult {
  const spell = findSrdSpell(index);
  const differences: ParityResult['differences'] = [];
  if (!spell) return { index, same: false, zone: false, differences: [{ field: 'spell', slotLevel: 0, characterLevel: 0, text: null, template: null }] };
  let zone = false;
  const slots = spell.level === 0 ? [0] : Array.from({ length: 10 - spell.level }, (_, step) => spell.level + step);
  for (const slotLevel of slots) {
    for (const characterLevel of CHARACTER_LEVELS) {
      const text = textSignature(spell, slotLevel, characterLevel);
      const template = templateSignature(spell, slotLevel, characterLevel);
      if (!template) return { index, same: false, zone: false, differences: [{ field: 'template', slotLevel, characterLevel, text: null, template: null }] };
      zone ||= text.createsZone === true || template.createsZone === true;
      for (const field of Object.keys(text)) {
        if (JSON.stringify(text[field]) === JSON.stringify(template[field]) || accepted(field, text, template, spell, slotLevel)) continue;
        if (!differences.some(entry => entry.field === field)) differences.push({ field, slotLevel, characterLevel, text: text[field], template: template[field] });
      }
    }
  }
  return { index, same: differences.length === 0, zone, differences };
}

export function movesToTable(result: ParityResult): boolean {
  return result.same && (!result.zone || ZONES_CHECKED.has(result.index));
}

export function srdParityAll(): ParityResult[] {
  return srdSpells.map(spell => srdParity(spell.index));
}
