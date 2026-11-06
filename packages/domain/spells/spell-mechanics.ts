export const SPELL_ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;
export type SpellAbility = typeof SPELL_ABILITIES[number];

export const SPELL_DAMAGE_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
] as const;
export type SpellDamageType = typeof SPELL_DAMAGE_TYPES[number];

export const SPELL_CONDITIONS = [
  'blinded', 'charmed', 'deafened', 'frightened', 'incapacitated', 'paralyzed',
  'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
] as const;

export type SpellMechanics = {
  attack: 'melee' | 'ranged' | null;
  save: SpellAbility | null;
  halfOnSave: boolean;
  damageFormula: string | null;
  damageType: SpellDamageType | null;
  healingFormula: string | null;
  healingAddsModifier: boolean;
  condition: string | null;
  conditionRounds: number | null;
  repeatSave: 'end' | null;
  cantripScaling: boolean;
  upcastFormula: string | null;
};

const ABILITY = '(strength|dexterity|constitution|intelligence|wisdom|charisma)';
const TYPES = `(${SPELL_DAMAGE_TYPES.join('|')})`;

export function durationRounds(duration: string): number | null {
  const match = /(\d+)\s*(round|minute|hour|day|раунд|минут|час|дн|день|сут)/i.exec(duration);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const per = /^(round|раунд)/.test(unit) ? 1 : /^(minute|минут)/.test(unit) ? 10 : /^(hour|час)/.test(unit) ? 600 : 14400;
  return Math.min(1000, amount * per);
}

export function deriveSpellMechanics(spell: { level: number; duration: string; desc: string; higherLevel?: string | null }): SpellMechanics {
  const text = spell.desc.replace(/\s+/g, ' ');
  const upcastMatch = /increases by (\d+d\d+) for each slot level above/i.exec(spell.higherLevel ?? '');

  const attackMatch = /make an? (ranged|melee) spell attack/i.exec(text);
  const saveMatch = new RegExp(`(?:make|makes|making|succeed on|succeeds on|succeeding on|fail|fails|failing) (?:an? )?${ABILITY} saving throws?`, 'i').exec(text);
  const damageMatch = new RegExp(`(\\d+d\\d+(?:\\s*\\+\\s*\\d+)?)\\s+${TYPES}\\s+damage`, 'i').exec(text);
  const healingMatch = /regains? (?:a number of )?hit points equal to (\d+d\d+)( \+ your spellcasting ability modifier)?/i.exec(text);
  const conditionMatch = new RegExp(
    `(?:(?:or be|or become|is(?: either)?|be|becomes?) (${SPELL_CONDITIONS.join('|')})|knocked (prone)|falls? (unconscious))\\b`, 'i',
  ).exec(text);
  const removes = /end either one disease or one condition/i.test(text);
  const condition = conditionMatch && !removes ? (conditionMatch[1] ?? conditionMatch[2] ?? conditionMatch[3])!.toLowerCase() : null;

  return {
    attack: attackMatch ? (attackMatch[1]!.toLowerCase() as 'melee' | 'ranged') : null,
    save: !attackMatch && saveMatch ? (saveMatch[1]!.toLowerCase() as SpellAbility) : null,
    halfOnSave: /half as much damage/i.test(text),
    damageFormula: damageMatch ? damageMatch[1]!.replace(/\s+/g, '') : null,
    damageType: damageMatch ? (damageMatch[2]!.toLowerCase() as SpellDamageType) : null,
    healingFormula: healingMatch ? healingMatch[1]! : null,
    healingAddsModifier: Boolean(healingMatch?.[2]),
    condition,
    conditionRounds: condition ? durationRounds(spell.duration) : null,
    repeatSave: condition && /at the end of each of its turns[^.]*saving throw/i.test(text) ? 'end' : null,
    cantripScaling: spell.level === 0 && /damage increases by \d+d\d+ when you reach 5th level/i.test(text),
    upcastFormula: upcastMatch ? upcastMatch[1]! : null,
  };
}

export function cantripDiceMultiplier(characterLevel: number | null): number {
  const level = characterLevel ?? 1;
  return level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
}

export function spellSaveDc(proficiencyBonus: number, abilityModifier: number) {
  return 8 + proficiencyBonus + abilityModifier;
}

export function spellAttackBonus(proficiencyBonus: number, abilityModifier: number) {
  return proficiencyBonus + abilityModifier;
}

export type SpellMechanicsOverrides = {
  damage_formula?: string | null;
  healing_formula?: string | null;
  upcast_formula?: string | null;
  attack_kind?: string | null;
  save_ability?: string | null;
  half_on_save?: boolean | null;
  damage_type?: string | null;
  condition_code?: string | null;
  condition_rounds?: number | null;
  condition_repeat?: string | null;
  creates_zone?: boolean;
};

export type EffectiveSpellMechanics = {
  attack: 'melee' | 'ranged' | null;
  save: SpellAbility | null;
  halfOnSave: boolean;
  damageFormula: string | null;
  damageType: SpellDamageType | null;
  healingFormula: string | null;
  upcastFormula: string | null;
  condition: string | null;
  conditionRounds: number | null;
  repeatSave: 'end' | 'start' | null;
  cantripScaling: boolean;
  createsZone: boolean;
};

export function mergeSpellMechanics(derived: SpellMechanics | null, overrides: SpellMechanicsOverrides | null | undefined): EffectiveSpellMechanics {
  const o = overrides ?? {};
  const pick = <T>(override: string | null | undefined, fallback: T | null): T | null =>
    override === undefined || override === null ? fallback : override === 'none' ? null : (override as T);
  const derivedHealing = derived?.healingFormula ? `${derived.healingFormula}${derived.healingAddsModifier ? '+@mod' : ''}` : null;
  return {
    attack: pick(o.attack_kind, derived?.attack ?? null),
    save: pick(o.save_ability, derived?.save ?? null),
    halfOnSave: o.half_on_save ?? derived?.halfOnSave ?? false,
    damageFormula: o.damage_formula ?? derived?.damageFormula ?? null,
    damageType: (o.damage_type as SpellDamageType | null | undefined) ?? derived?.damageType ?? null,
    healingFormula: o.healing_formula ?? derivedHealing,
    upcastFormula: o.upcast_formula ?? derived?.upcastFormula ?? null,
    condition: pick(o.condition_code, derived?.condition ?? null),
    conditionRounds: o.condition_rounds ?? derived?.conditionRounds ?? null,
    repeatSave: pick(o.condition_repeat, derived?.repeatSave ?? null),
    cantripScaling: derived?.cantripScaling ?? false,
    createsZone: o.creates_zone ?? false,
  };
}

export function spellRangeFeet(range: string | null | undefined): number | null {
  const text = (range ?? '').trim().toLowerCase();
  if (/^(touch|касание)/.test(text)) return 5;
  if (/^(self|на себя|sight|unlimited|special)/.test(text)) return null;
  const miles = /(\d+)\s*(?:mile|миль|мил)/.exec(text);
  if (miles) return Number(miles[1]) * 5280;
  const feet = /(\d+)\s*(?:feet|foot|фут)/.exec(text);
  return feet ? Number(feet[1]) : null;
}
