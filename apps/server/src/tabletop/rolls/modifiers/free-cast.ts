import { hasFeat } from '../../../../../../packages/domain/character/feats.ts';
import { classFeaturesFor, mysticArcanumLevels, classLevelOf, spellPicks } from '../../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../../packages/domain/character/classes.ts';
import { reject } from '../../shared.ts';

export function canRitualCast(character: any): boolean {
  return characterClassLevels(character).classes.some(entry => ['wizard', 'cleric', 'druid', 'bard'].includes(entry.id)) || hasFeat(character.sheet_extra, 'ritual-caster');
}

export type FreeCast = 'arcanum' | 'mastery' | 'signature';

export function freeCastRule(
  character: any, characterSpellId: string, spellName: string, level: number, free: FreeCast,
): { resource: string | null; recharge: 'short' | 'long'; label: string } {
  const classes = characterClassLevels(character).classes;
  const has = (id: string) => classFeaturesFor(classes).some(feature => feature.id === id);
  if (free === 'arcanum') {
    if (!has('mystic-arcanum')) reject(400, `«Мистический арканум» — у колдуна с 11-го уровня; у «${character.name}» его нет.`);
    const levels = mysticArcanumLevels(classLevelOf(classes, 'warlock', character.level));
    if (!levels.includes(level)) reject(400, `«Мистический арканум» — заклинания ${levels.join(', ')} уровня; «${spellName}» — ${level === 0 ? 'заговор' : `${level} уровня`}.`);
    return { resource: `Мистический арканум: ${level} ур.`, recharge: 'long', label: 'мистический арканум' };
  }
  const picks = spellPicks(character.sheet_extra);
  if (free === 'mastery') {
    if (!has('spell-mastery')) reject(400, `«Мастерство заклинаний» — у волшебника с 18-го уровня; у «${character.name}» его нет.`);
    if (!picks.mastery.includes(characterSpellId)) reject(400, `«${spellName}» не выбрано для «Мастерства заклинаний» — выберите в «Умениях».`);
    return { resource: null, recharge: 'long', label: 'мастерство заклинаний' };
  }
  if (!has('signature-spells')) reject(400, `«Фирменные заклинания» — у волшебника 20-го уровня; у «${character.name}» их нет.`);
  if (!picks.signature.includes(characterSpellId)) reject(400, `«${spellName}» не выбрано фирменным — выберите в «Умениях».`);
  return { resource: `Фирменное: ${spellName}`.slice(0, 100), recharge: 'short', label: 'фирменное заклинание' };
}
