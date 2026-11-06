export const ABILITIES = [
  ['strength', 'Сила'], ['dexterity', 'Ловкость'], ['constitution', 'Телосложение'],
  ['intelligence', 'Интеллект'], ['wisdom', 'Мудрость'], ['charisma', 'Харизма'],
] as const;

export const ADVANTAGE = [
  { id: 'none', label: 'Обычный бросок', short: '—', rule: 'Один бросок к20.' },
  { id: 'adv', label: 'С преимуществом', short: '▲', rule: 'Два броска к20, берётся больший.' },
  { id: 'disadv', label: 'С помехой', short: '▼', rule: 'Два броска к20, берётся меньший.' },
] as const;
export type AdvantageId = typeof ADVANTAGE[number]['id'];

export const RIDER_TEXT: Record<string, string> = {
  slowed: 'скорость цели меньше', no_reactions: 'цель без реакций', no_healing: 'цель не лечится',
  guided: 'следующая атака по цели — с преимуществом', mocked: 'следующая атака цели — с помехой',
  blessed: '+к4 к атакам и спасброскам', baned: '−к4 к атакам и спасброскам', marked: '+1d6 к вашим попаданиям оружием',
  outlined: 'атаки по задетым — с преимуществом', push: 'отбрасывает',
  temp_hp: 'временные хиты', heroism: 'не испуган, временные хиты каждый ход', ac_bonus: '+КД',
  sanctuary: 'атакующий сначала спасбросок Мудрости', aid: 'максимум хитов выше', mage_armor: 'КД 13 + Ловкость',
  dispel: 'заклинания на цели кончаются', restore: 'снимает паралич, слепоту, яд или глухоту',
};
