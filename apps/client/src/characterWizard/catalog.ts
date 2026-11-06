import type { GameIconName } from '../ui/gameIcons.ts';
import { itemArt } from '../art/itemArt.ts';
import type { Ability, Kit } from './types.ts';

export const ABILITIES: Ability[] = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
export const ABILITY_LABELS: Record<Ability, string> = {
  strength: 'Сила', dexterity: 'Ловкость', constitution: 'Телосложение', intelligence: 'Интеллект', wisdom: 'Мудрость', charisma: 'Харизма',
};
export const ABILITY_SHORT: Record<Ability, string> = { strength: 'СИЛ', dexterity: 'ЛОВ', constitution: 'ТЕЛ', intelligence: 'ИНТ', wisdom: 'МДР', charisma: 'ХАР' };
export const ABILITY_HINTS: Record<Ability, string> = {
  strength: 'удары в ближнем бою, атлетика, переноска тяжестей',
  dexterity: 'луки и лёгкое оружие, защита (КД), инициатива, скрытность',
  constitution: 'хиты и стойкость — нужна всем',
  intelligence: 'магия волшебника, знания, расследование',
  wisdom: 'внимательность и чутьё; магия жреца, друида, следопыта',
  charisma: 'убеждение и обман; магия барда, чародея, колдуна, паладина',
};
export const DAMAGE_LABELS: Record<string, string> = { acid: 'кислота', lightning: 'электричество', fire: 'огонь', poison: 'яд', cold: 'холод' };

export const RACE_INFO: Record<string, { icon: GameIconName; tagline: string }> = {
  human: { icon: 'raceHuman', tagline: 'Многогранные и упорные — хороши в любом классе.' },
  elf: { icon: 'raceElf', tagline: 'Изящные долгожители: зоркие, ловкие, не спят, а медитируют.' },
  dwarf: { icon: 'pickaxe', tagline: 'Крепкие и стойкие мастера камня и стали; яд им почти не страшен.' },
  halfling: { icon: 'clover', tagline: 'Маленькие, ловкие и на редкость везучие.' },
  dragonborn: { icon: 'raceDragonborn', tagline: 'Потомки драконов: дыхание стихии и сопротивление ей.' },
  gnome: { icon: 'raceGnome', tagline: 'Любопытные изобретатели, хитрые против чужой магии.' },
  'half-elf': { icon: 'raceHalfElf', tagline: 'Обаятельные и гибкие: ещё +1 к двум характеристикам на выбор.' },
  'half-orc': { icon: 'raceHalfOrc', tagline: 'Свирепые бойцы: встают с 1 хитом и бьют больнее на крите.' },
  tiefling: { icon: 'horns', tagline: 'Наследники адского пламени: огонь не страшен, есть своя магия.' },
  custom: { icon: 'raceCustom', tagline: 'Раса не из справочника: назовите её сами, +2 и +1 — к любым характеристикам. Черты — по договорённости с мастером.' },
};
export type ClassInfo = { icon: GameIconName; tagline: string; role: string; difficulty: 'просто' | 'средне' | 'сложнее'; order: Ability[]; skills: string[] };
export const CLASS_INFO: Record<string, ClassInfo> = {
  barbarian: { icon: 'axe', tagline: 'Неистовый воин: в ярости бьёт сильнее и держит удары.', role: 'ближний бой, много хитов', difficulty: 'просто', order: ['strength', 'constitution', 'dexterity', 'wisdom', 'charisma', 'intelligence'], skills: ['athletics', 'perception', 'survival', 'intimidation'] },
  bard: { icon: 'classBard', tagline: 'Музыкант и мастер слова: вдохновляет союзников и колдует.', role: 'поддержка, магия, разговоры', difficulty: 'средне', order: ['charisma', 'dexterity', 'constitution', 'wisdom', 'intelligence', 'strength'], skills: ['persuasion', 'deception', 'performance', 'insight', 'perception'] },
  cleric: { icon: 'classCleric', tagline: 'Служитель бога: лечит, защищает и изгоняет нежить.', role: 'лечение и поддержка', difficulty: 'средне', order: ['wisdom', 'constitution', 'strength', 'dexterity', 'charisma', 'intelligence'], skills: ['insight', 'medicine', 'persuasion', 'religion'] },
  druid: { icon: 'classDruid', tagline: 'Хранитель природы: магия стихий и облик зверя.', role: 'магия, превращения', difficulty: 'сложнее', order: ['wisdom', 'constitution', 'dexterity', 'intelligence', 'charisma', 'strength'], skills: ['perception', 'nature', 'medicine', 'survival'] },
  fighter: { icon: 'classFighter', tagline: 'Мастер оружия и доспехов — самый простой в освоении.', role: 'ближний или дальний бой', difficulty: 'просто', order: ['strength', 'constitution', 'dexterity', 'wisdom', 'charisma', 'intelligence'], skills: ['athletics', 'perception', 'intimidation', 'survival'] },
  monk: { icon: 'yinYang', tagline: 'Мастер рукопашной: быстрые удары и сила ци.', role: 'ближний бой, подвижность', difficulty: 'средне', order: ['dexterity', 'wisdom', 'constitution', 'strength', 'intelligence', 'charisma'], skills: ['acrobatics', 'insight', 'stealth', 'athletics'] },
  paladin: { icon: 'classPaladin', tagline: 'Святой воин: тяжёлые доспехи, божественная кара и лечение руками.', role: 'ближний бой, защита союзников', difficulty: 'средне', order: ['strength', 'charisma', 'constitution', 'wisdom', 'dexterity', 'intelligence'], skills: ['athletics', 'persuasion', 'insight', 'intimidation'] },
  ranger: { icon: 'classRanger', tagline: 'Следопыт и охотник: лук, выживание и немного магии.', role: 'дальний бой, разведка', difficulty: 'средне', order: ['dexterity', 'wisdom', 'constitution', 'strength', 'intelligence', 'charisma'], skills: ['perception', 'stealth', 'survival', 'nature'] },
  rogue: { icon: 'dagger', tagline: 'Ловкач и плут: скрытая атака, замки и ловушки.', role: 'скрытность, удар из тени', difficulty: 'просто', order: ['dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma', 'strength'], skills: ['stealth', 'perception', 'sleight-of-hand', 'deception', 'acrobatics', 'investigation'] },
  sorcerer: { icon: 'classSorcerer', tagline: 'Прирождённый маг: сила в крови, заклинания меняются метамагией.', role: 'разрушительная магия', difficulty: 'сложнее', order: ['charisma', 'constitution', 'dexterity', 'wisdom', 'intelligence', 'strength'], skills: ['persuasion', 'deception', 'arcana', 'insight'] },
  warlock: { icon: 'classWarlock', tagline: 'Договор с могущественным покровителем: мистический заряд и воззвания.', role: 'магия на расстоянии', difficulty: 'средне', order: ['charisma', 'constitution', 'dexterity', 'wisdom', 'intelligence', 'strength'], skills: ['deception', 'arcana', 'intimidation', 'investigation'] },
  wizard: { icon: 'classWizard', tagline: 'Учёный маг: больше всех заклинаний, но хрупок.', role: 'магия на любой случай', difficulty: 'сложнее', order: ['intelligence', 'constitution', 'dexterity', 'wisdom', 'charisma', 'strength'], skills: ['arcana', 'investigation', 'history', 'insight'] },
};
export const NAMES: Record<string, string[]> = {
  human: ['Алексан', 'Мирра', 'Тарен', 'Велена', 'Гордей', 'Ирис'],
  elf: ['Лиэна', 'Аэлин', 'Тирион', 'Сильвиэль', 'Ривал', 'Элора'],
  dwarf: ['Торин', 'Брунгильда', 'Дургар', 'Хельга', 'Балин', 'Видгерд'],
  halfling: ['Пиппа', 'Милло', 'Розалинда', 'Бодо', 'Лила', 'Тобиас'],
  dragonborn: ['Аржан', 'Кава', 'Мехен', 'Сора', 'Насаар', 'Тива'],
  gnome: ['Фиббл', 'Нимни', 'Боддинок', 'Карамель', 'Зук', 'Тинкс'],
  'half-elf': ['Каэлен', 'Сиана', 'Лорен', 'Вэйл', 'Эйра', 'Таллис'],
  'half-orc': ['Грум', 'Шара', 'Дренк', 'Кансиф', 'Утга', 'Хольг'],
  tiefling: ['Акменос', 'Нирея', 'Дамакос', 'Криелла', 'Мордай', 'Орианна'],
};

export const mod = (score: number) => Math.floor((score - 10) / 2);
export const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));
export const bonusText = (bonuses: Partial<Record<Ability, number>>) => Object.entries(bonuses).map(([ability, value]) => `${ABILITY_SHORT[ability as Ability]} +${value}`).join(', ');

export function kitArt(kit: Kit) {
  return [...new Set([...kit.weaponNames, ...(kit.ammo ? [kit.ammo.name] : [])])].filter(name => itemArt(name));
}

export function toggle(list: string[], value: string, limit: number) {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
  else if (list.length < limit) list.push(value);
}

export function randomHeroName(race: string, current: string, roll = Math.random) {
  const list = NAMES[race] ?? NAMES.human!;
  const options = list.filter(name => name !== current);
  return options[Math.floor(roll() * options.length)] ?? list[0]!;
}
