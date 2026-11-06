import { isFormulaShapeValid } from '../../../../packages/domain/dice/formula.ts';
import { parseFormula } from '../../../../packages/domain/dice/dice.ts';
import { deriveSpellMechanics, mergeSpellMechanics, SPELL_ABILITIES, SPELL_CONDITIONS, SPELL_DAMAGE_TYPES } from '../../../../packages/domain/spells/spell-mechanics.ts';
import { projectileRule, singleTarget, spellRiders, targetLimit } from '../../../../packages/domain/spells/spell-riders.ts';
import { aimedSpellArea } from '../../../../packages/domain/map/area-placement.ts';
import { CONJURE_OPTIONS, shapeForms, spellShape, spellSummon } from '../../../../packages/domain/spells/summons.ts';
import { findMonster, type SrdMonster } from '../../../../packages/domain/world/bestiary.ts';

import { reject } from '../characters/sheet/shared.ts';

export const TARGETED_SPELLS = new Set([
  'guidance', 'resistance', 'true-strike', 'barkskin', 'longstrider', 'protection-from-energy', 'stoneskin', 'death-ward',
  'spare-the-dying', 'revivify', 'greater-restoration', 'invisibility', 'greater-invisibility', 'true-seeing',
  'magic-weapon', 'warding-bond', 'beacon-of-hope', 'darkvision', 'raise-dead',
]);

export const formView = (beast: SrdMonster) => ({ index: beast.index, name: beast.nameRu, nameEn: beast.name, cr: beast.cr, size: beast.size });

export function summonView(index: string | null | undefined) {
  const rule = spellSummon(index);
  if (!rule) return null;
  return {
    kind: rule.kind, concentration: rule.concentration,
    forms: rule.forms.map(form => findMonster(form)).filter((beast): beast is SrdMonster => Boolean(beast)).map(formView),
    options: rule.kind === 'conjure-animals' ? CONJURE_OPTIONS : null,
  };
}
export function shapeView(index: string | null | undefined) {
  const rule = spellShape(index);
  return rule ? { kind: rule.kind, maxCr: rule.maxCr, forms: shapeForms(rule).map(formView) } : null;
}

export const MECHANICS_COLUMNS = ['attack_kind', 'save_ability', 'half_on_save', 'damage_type', 'condition_code', 'condition_rounds', 'condition_repeat', 'creates_zone'] as const;
export const mechanicsBody = {
  attackKind: { oneOf: [{ type: 'string', enum: ['none', 'melee', 'ranged'] }, { type: 'null' }] },
  saveAbility: { oneOf: [{ type: 'string', enum: ['none', ...SPELL_ABILITIES] }, { type: 'null' }] },
  halfOnSave: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
  damageType: { oneOf: [{ type: 'string', enum: [...SPELL_DAMAGE_TYPES] }, { type: 'null' }] },
  conditionCode: { oneOf: [{ type: 'string', enum: ['none', ...SPELL_CONDITIONS] }, { type: 'null' }] },
  conditionRounds: { oneOf: [{ type: 'integer', minimum: 1, maximum: 1000 }, { type: 'null' }] },
  conditionRepeat: { oneOf: [{ type: 'string', enum: ['none', 'end', 'start'] }, { type: 'null' }] },
  createsZone: { type: 'boolean' },
};
export const MECHANICS_FIELDS: Record<string, typeof MECHANICS_COLUMNS[number]> = {
  attackKind: 'attack_kind', saveAbility: 'save_ability', halfOnSave: 'half_on_save', damageType: 'damage_type',
  conditionCode: 'condition_code', conditionRounds: 'condition_rounds', conditionRepeat: 'condition_repeat',
  createsZone: 'creates_zone',
};

export function mechanicsAssignments(body: Record<string, unknown>, firstParam: number) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [field, column] of Object.entries(MECHANICS_FIELDS)) {
    if (body[field] === undefined) continue;
    values.push(body[field]);
    sets.push(`${column} = $${firstParam + values.length - 1}`);
  }
  return { sets, values };
}

export function overridesView(row: any) {
  if (!row) return null;
  return {
    attackKind: row.attack_kind ?? null, saveAbility: row.save_ability ?? null, halfOnSave: row.half_on_save ?? null,
    damageType: row.damage_type ?? null, conditionCode: row.condition_code ?? null,
    conditionRounds: row.condition_rounds ?? null, conditionRepeat: row.condition_repeat ?? null,
    createsZone: row.creates_zone === true,
  };
}

export function srdEffective(spell: any, row: any) {
  return mergeSpellMechanics(deriveSpellMechanics(spell), row ?? null);
}

export function textMechanics(spell: any) {
  const riders = spellRiders(spell?.desc).map(rider => rider.kind);
  const single = spell ? singleTarget(spell, spell.level ?? 0, spell.level ?? 0) : false;
  return {
    projectiles: projectileRule(spell),
    riders,
    targetLimit: targetLimit(spell ?? {}, spell?.level ?? 0),
    singleTarget: single,
    area: spell ? aimedSpellArea(spell, { attack: Boolean(spell.desc && deriveSpellMechanics(spell).attack), single, riders }) : null,
    summon: summonView(spell?.index),
    shape: shapeView(spell?.index),
    element: spell?.index === 'protection-from-energy' ? ['acid', 'cold', 'fire', 'lightning', 'thunder'] : null,
    needsTarget: TARGETED_SPELLS.has(spell?.index),
    teleport: spell?.index === 'misty-step' ? { rangeFeet: 30 } : null,
  };
}

export function validateSpellFormula(value: unknown, label: string): void {
  if (value === null || value === undefined) return;
  if (typeof value !== 'string' || !isFormulaShapeValid(value)) {
    reject(400, `${label}: формула должна быть в виде NdM с необязательными членами через + или -: число или переменная @str/@dex/@con/@int/@wis/@cha/@prof, например 8d6 или 1d8+@wis.`);
  }
}

export function validateUpcastFormula(value: unknown): void {
  if (value === null || value === undefined) return;
  if (typeof value !== 'string') reject(400, 'Формула повышения ячейки должна быть строкой.');
  const parsed = parseFormula(value as string);
  if (!parsed || parsed.modifier !== 0) {
    reject(400, 'Формула повышения ячейки: голое NdM без модификатора и без переменных — количество дополнительных костей на ячейку выше базового уровня, например 1d6.');
  }
}
