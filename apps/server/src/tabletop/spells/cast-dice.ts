import { proficiencyOf, abilityModifier, rollDice } from '../../../../../packages/domain/dice/dice.ts';
import { sheetContext } from '../scene/placements.ts';
import { announceTime, advanceWorldTime } from '../../campaign/world-time.ts';
import { resolveSpellFormula, applyUpcast } from './rules.ts';
import { cantripDiceMultiplier } from '../../../../../packages/domain/spells/spell-mechanics.ts';
import { rollDie } from '../rolls/dice.ts';
import { classFeaturesFor, OVERCHANNEL_MAX_LEVEL, knownAncestry, empowerDice } from '../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { reject, type CastSpellParams } from '../shared.ts';
import { DRAGON_ANCESTRIES } from '../../../../../packages/domain/srd/heroes.ts';
import { hasFeat } from '../../../../../packages/domain/character/feats.ts';
import { factionBonusOf } from '../../campaign/factions.ts';
import type { TableContext } from '../context.ts';
import type { Queryable } from '../../db.ts';
import type { CastBody } from './cast.ts';
import type { CastSetup } from './prepare.ts';

export async function castDice(ctx: TableContext, q: Queryable, params: CastSpellParams, body: CastBody, setup: CastSetup) {
  const { feature } = ctx;
  const { campaignId, characterId } = params;
  const { character, level, damageFormula, healingFormula, mechanics, upcastFormula, spellSchool, ritual, legacy, empowered, extraLevels, effectiveLevel } = setup;

  const proficiencyBonus = proficiencyOf(character);
  const context = sheetContext(character, proficiencyBonus);

  if (ritual) announceTime(feature, campaignId, await advanceWorldTime(q, campaignId, 10));
  const castingAbility: string = legacy ? 'charisma' : character.spellcasting_ability ??
    (['intelligence', 'wisdom', 'charisma'] as const).reduce((best, ability) => (character[ability] > character[best] ? ability : best), 'intelligence' as string);
  const castingModifier = abilityModifier(character[castingAbility]);
  const castingToken = ({ strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' } as Record<string, string>)[castingAbility]!;
  const withCasting = (formula: string | null) => (formula ? formula.replace(/@mod\b/g, `@${castingToken}`) : null);

  const scaled = (resolved: ReturnType<typeof resolveSpellFormula>) => {
    if (!resolved || level !== 0 || !mechanics.cantripScaling) return resolved;
    const multiplier = cantripDiceMultiplier(character.level ?? null);
    if (multiplier === 1) return resolved;
    const parsed = { ...resolved.parsed, count: resolved.parsed.count * multiplier };
    const mod = parsed.modifier;
    return { ...resolved, parsed, formula: `${parsed.count}d${parsed.sides}${mod ? (mod > 0 ? `+${mod}` : String(mod)) : ''}` };
  };

  const resolvedDamage = scaled(resolveSpellFormula(withCasting(damageFormula), 'Формула урона', context));
  const resolvedHealing = scaled(resolveSpellFormula(withCasting(healingFormula), 'Формула лечения', context));
  const maxDie = (sides: number) => sides;
  const rollSpellDice = (resolved: NonNullable<typeof resolvedDamage>, critical = false, die: (sides: number) => number = rollDie) => {
    const base = rollDice(resolved.parsed, die);
    const final = applyUpcast(base, resolved.parsed, resolved.formula, upcastFormula, extraLevels, die);
    if (!critical) return final;
    const count = Number(/^(\d+)d/.exec(final.formula)?.[1] ?? resolved.parsed.count);
    const extra = rollDice({ count, sides: resolved.parsed.sides, modifier: 0 }, die);
    const mod = final.modifier;
    return { results: [...final.results, ...extra.results], total: final.total + extra.total, modifier: mod, formula: `${count * 2}d${resolved.parsed.sides}${mod ? (mod > 0 ? `+${mod}` : String(mod)) : ''}` };
  };

  const overchannel = body.overchannel === true;
  if (overchannel) {
    if (!classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'overchannel')) {
      reject(400, `«Сверхзаряд» — у волшебника Школы Воплощения с 14-го уровня; у «${character.name}» его нет.`);
    }
    if (level < 1 || effectiveLevel > OVERCHANNEL_MAX_LEVEL) reject(400, '«Сверхзаряд» — только для заклинаний 1–5 уровня.');
    if (!resolvedDamage) reject(400, '«Сверхзаряд» — для заклинаний с уроном.');
  }

  let empowerLeft = empowered ? Math.max(1, abilityModifier(character.charisma)) : 0;
  let empowerRerolled = 0;
  const ancestor = DRAGON_ANCESTRIES.find(entry => entry.id === knownAncestry(character.sheet_extra)[0]);
  const casterFeatures = classFeaturesFor(characterClassLevels(character).classes);
  const affinityBonus = ancestor && mechanics.damageType === ancestor.damage && casterFeatures.some(feature => feature.id === 'elemental-affinity')
    ? Math.max(0, abilityModifier(character.charisma)) : 0;
  const evocationBonus = /evocation|воплощени/i.test(spellSchool) && casterFeatures.some(feature => feature.id === 'empowered-evocation')
    ? Math.max(0, abilityModifier(character.intelligence)) : 0;
  let affinity = affinityBonus + evocationBonus;
  let affinityAdded = 0;
  const rollEmpowered = (resolved: NonNullable<typeof resolvedDamage>, critical = false) => {
    const rolled = withAffinity(rollSpellDice(resolved, critical, overchannel ? maxDie : rollDie));
    if (empowerLeft <= 0) return rolled;
    const sides = resolved.parsed.sides;
    const done = empowerDice(rolled.results, sides, empowerLeft, () => rollDie(sides));
    empowerLeft = done.left;
    if (!done.rerolled) return rolled;
    empowerRerolled += done.rerolled;
    return { ...rolled, results: done.results, total: rolled.total + done.results.reduce((sum, value) => sum + value, 0) - rolled.results.reduce((sum, value) => sum + value, 0) };
  };
  const adept = Boolean(mechanics.damageType) && hasFeat(character.sheet_extra, `elemental-adept-${mechanics.damageType}`);
  let adeptRaised = 0;
  const rollAdeptDice = (resolved: NonNullable<typeof resolvedDamage>, critical = false) => {
    const rolled = rollEmpowered(resolved, critical);
    const ones = adept ? rolled.results.filter(value => value === 1).length : 0;
    if (!ones) return rolled;
    adeptRaised += ones;
    return { ...rolled, results: rolled.results.map(value => (value === 1 ? 2 : value)), total: rolled.total + ones };
  };
  const factionDamage = resolvedDamage ? await factionBonusOf(q, campaignId, characterId, 'damage') : { value: 0, reasons: [] };
  const rollDamageDice = (resolved: NonNullable<typeof resolvedDamage>, critical = false) => {
    const rolled = rollAdeptDice(resolved, critical);
    if (!factionDamage.value) return rolled;
    const value = factionDamage.value;
    return { ...rolled, total: Math.max(0, rolled.total + value), modifier: rolled.modifier + value, formula: `${rolled.formula}${value > 0 ? '+' : ''}${value}`.slice(0, 20) };
  };

  function withAffinity<R extends { total: number; modifier: number; formula: string }>(rolled: R): R {
    if (affinity <= 0) return rolled;
    const bonus = affinity;
    affinity = 0;
    affinityAdded = bonus;
    return { ...rolled, total: rolled.total + bonus, modifier: rolled.modifier + bonus, formula: `${rolled.formula}+${bonus}`.slice(0, 20) };
  }

  return {
    proficiencyBonus, castingAbility, castingModifier, resolvedDamage, resolvedHealing, maxDie,
    rollSpellDice, overchannel, affinityBonus, evocationBonus, adept, factionDamage, rollDamageDice,
    get empowerRerolled() { return empowerRerolled; },
    get adeptRaised() { return adeptRaised; },
    get affinityAdded() { return affinityAdded; },
  };
}

export type CastDice = Awaited<ReturnType<typeof castDice>>;
