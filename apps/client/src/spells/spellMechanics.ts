import { conditionInfo } from '../rules/conditions';
import { DAMAGE_TYPES } from '../rules/objectRules';

export type SpellMechanicsView = {
  attack: 'melee' | 'ranged' | null;
  save: string | null;
  halfOnSave: boolean;
  damageFormula: string | null;
  damageType: string | null;
  healingFormula: string | null;
  upcastFormula: string | null;
  condition: string | null;
  conditionRounds: number | null;
  repeatSave: 'end' | 'start' | null;
  cantripScaling: boolean;
};

const ABILITY_SHORT: Record<string, string> = {
  strength: 'СИЛ', dexterity: 'ЛОВ', constitution: 'ТЕЛ', intelligence: 'ИНТ', wisdom: 'МДР', charisma: 'ХАР',
};

export function describeSpellMechanics(mechanics: SpellMechanicsView | null | undefined): string {
  if (!mechanics) return '';
  const parts: string[] = [];
  if (mechanics.attack) parts.push(mechanics.attack === 'ranged' ? 'атака дальнобойная' : 'атака рукопашная');
  if (mechanics.save) parts.push(`спасбросок ${ABILITY_SHORT[mechanics.save] ?? mechanics.save}${mechanics.halfOnSave ? ', половина' : ''}`);
  if (mechanics.damageFormula) {
    const type = DAMAGE_TYPES.find(entry => entry.id === mechanics.damageType)?.label;
    parts.push(`${mechanics.damageFormula}${type ? ` ${type}` : ''}${mechanics.cantripScaling ? ' (растёт с уровнем)' : ''}`);
  }
  if (mechanics.healingFormula) parts.push(`лечение ${mechanics.healingFormula.replace('@mod', 'мод.')}`);
  if (mechanics.condition) {
    parts.push(`${conditionInfo(mechanics.condition).label.toLowerCase()}${mechanics.conditionRounds ? `, ${mechanics.conditionRounds} ход.` : ''}${mechanics.repeatSave ? ', повтор спасброска' : ''}`);
  }
  return parts.join(' · ');
}

export function spellNeedsTargets(mechanics: SpellMechanicsView | null | undefined) {
  return Boolean(mechanics && (mechanics.attack || mechanics.save || mechanics.damageFormula || mechanics.healingFormula || mechanics.condition));
}
