export type Option = readonly [value: string, label: string];

export const ABILITIES: readonly Option[] = [
  ['strength', 'Сила'], ['dexterity', 'Ловкость'], ['constitution', 'Телосложение'],
  ['intelligence', 'Интеллект'], ['wisdom', 'Мудрость'], ['charisma', 'Харизма'],
];

export const DAMAGE_TYPES: readonly Option[] = [
  ['acid', 'кислота'], ['bludgeoning', 'дробящий'], ['cold', 'холод'], ['fire', 'огонь'], ['force', 'силовое поле'],
  ['lightning', 'электричество'], ['necrotic', 'некротический'], ['piercing', 'колющий'], ['poison', 'яд'],
  ['psychic', 'психический'], ['radiant', 'излучение'], ['slashing', 'рубящий'], ['thunder', 'звук'],
];

export const CONDITIONS: readonly Option[] = [
  ['blinded', 'ослеплён'], ['charmed', 'очарован'], ['deafened', 'оглох'], ['frightened', 'испуган'],
  ['grappled', 'схвачен'], ['incapacitated', 'недееспособен'], ['invisible', 'невидим'], ['paralyzed', 'парализован'],
  ['petrified', 'окаменел'], ['poisoned', 'отравлен'], ['prone', 'сбит с ног'], ['restrained', 'опутан'],
  ['stunned', 'ошеломлён'], ['unconscious', 'без сознания'], ['exhaustion', 'истощение'],
];

export const SCHOOLS: readonly Option[] = [
  ['abjuration', 'ограждение'], ['conjuration', 'вызов'], ['divination', 'прорицание'], ['enchantment', 'очарование'],
  ['evocation', 'воплощение'], ['illusion', 'иллюзия'], ['necromancy', 'некромантия'], ['transmutation', 'преобразование'],
];

export const CLASSES: readonly Option[] = [
  ['bard', 'бард'], ['cleric', 'жрец'], ['druid', 'друид'], ['paladin', 'паладин'], ['ranger', 'следопыт'],
  ['sorcerer', 'чародей'], ['warlock', 'колдун'], ['wizard', 'волшебник'],
];

export const CREATURE_TYPES: readonly Option[] = [
  ['aberration', 'аберрация'], ['beast', 'зверь'], ['celestial', 'небожитель'], ['construct', 'конструкт'],
  ['dragon', 'дракон'], ['elemental', 'элементаль'], ['fey', 'фея'], ['fiend', 'исчадие'], ['giant', 'великан'],
  ['humanoid', 'гуманоид'], ['monstrosity', 'чудовище'], ['ooze', 'слизь'], ['plant', 'растение'], ['undead', 'нежить'],
];

export const SIZES: readonly Option[] = [
  ['tiny', 'крошечный'], ['small', 'маленький'], ['medium', 'средний'], ['large', 'большой'], ['huge', 'огромный'], ['gargantuan', 'громадный'],
];

export const SKILLS: readonly Option[] = [
  ['acrobatics', 'Акробатика'], ['animal-handling', 'Уход за животными'], ['arcana', 'Магия'], ['athletics', 'Атлетика'],
  ['deception', 'Обман'], ['history', 'История'], ['insight', 'Проницательность'], ['intimidation', 'Запугивание'],
  ['investigation', 'Анализ'], ['medicine', 'Медицина'], ['nature', 'Природа'], ['perception', 'Восприятие'],
  ['performance', 'Выступление'], ['persuasion', 'Убеждение'], ['religion', 'Религия'], ['sleight-of-hand', 'Ловкость рук'],
  ['stealth', 'Скрытность'], ['survival', 'Выживание'],
];

export const TAGS: readonly Option[] = [
  ['damage', 'урон'], ['healing', 'лечение'], ['control', 'контроль'], ['buff', 'усиление'], ['protection', 'защита'],
  ['movement', 'передвижение'], ['summon', 'призыв'], ['scouting', 'разведка'], ['social', 'общение'], ['utility', 'полезное'],
];

export const CASTING_TIMES: readonly Option[] = [
  ['action', 'действие'], ['bonus', 'бонусное действие'], ['reaction', 'реакция'], ['1m', '1 минута'], ['10m', '10 минут'],
  ['1h', '1 час'], ['8h', '8 часов'], ['12h', '12 часов'], ['24h', '24 часа'], ['custom', 'своё (минут)'],
];

export const REACTION_TRIGGERS: readonly Option[] = [
  ['hit', 'по вам попали атакой'], ['attacked', 'вас атакуют'], ['damaged', 'вы получаете урон'], ['falling', 'вы падаете'],
  ['spell-nearby', 'существо рядом творит заклинание'], ['leaves-reach', 'существо уходит от вас'], ['custom', 'своё (текст)'],
];

export const RANGE_KINDS: readonly Option[] = [
  ['self', 'на себя'], ['touch', 'касание'], ['feet', 'футы'], ['miles', 'мили'], ['sight', 'в пределах видимости'],
  ['unlimited', 'без ограничений'], ['special', 'особая'],
];

export const DURATION_KINDS: readonly Option[] = [
  ['instant', 'мгновенно'], ['rounds', 'раунды'], ['minutes', 'минуты'], ['hours', 'часы'], ['days', 'дни'],
  ['until-dispelled', 'пока не рассеют'], ['until-triggered', 'пока не сработает'], ['special', 'особая'],
];

export const DISMISS: readonly Option[] = [
  ['none', 'нельзя'], ['free', 'без действия'], ['bonus', 'бонусным действием'], ['action', 'действием'],
];

export const TARGETING_KINDS: readonly Option[] = [
  ['self', 'на себя'], ['creatures', 'существа'], ['area', 'область'], ['chain', 'цепочка'], ['object', 'предмет'],
  ['place', 'место'], ['wall', 'стена'], ['none', 'без цели'],
];

export const SIDES: readonly Option[] = [
  ['any', 'любые'], ['allies', 'союзники'], ['enemies', 'враги'], ['willing', 'согласные'],
];

export const AREA_SHAPES: readonly Option[] = [
  ['sphere', 'сфера'], ['cube', 'куб'], ['cone', 'конус'], ['line', 'линия'], ['cylinder', 'цилиндр'], ['square', 'квадрат клеток'],
];

export const AREA_ORIGINS: readonly Option[] = [
  ['self', 'от себя'], ['point', 'точка в дальности'], ['creature', 'на существе (движется с ним)'],
];

export const AREA_AFFECTS: readonly Option[] = [
  ['all', 'всех'], ['all-but-self', 'всех, кроме себя'], ['enemies', 'только врагов'], ['allies', 'только союзников'], ['chosen', 'выбранных внутри'],
];

export const OBJECT_KINDS: readonly Option[] = [
  ['weapon', 'оружие'], ['armor', 'доспех'], ['door', 'дверь или замок'], ['item', 'любой предмет'],
];

export const OBJECT_FILTERS: readonly Option[] = [
  ['any', 'любое'], ['nonmagical', 'немагическое'], ['melee', 'рукопашное'], ['club-staff', 'дубинка или посох'],
];

export const WHEN: readonly Option[] = [
  ['cast', 'при сотворении'], ['target-turn-start', 'в начале хода цели'], ['target-turn-end', 'в конце хода цели'],
  ['caster-turn-start', 'в начале хода заклинателя'], ['zone-enter-or-start', 'существо впервые за ход входит в зону или начинает в ней ход'],
  ['zone-enter', 'существо впервые за ход входит в зону'],
  ['zone-start', 'существо начинает ход в зоне'], ['zone-end', 'существо заканчивает ход в зоне'],
  ['caster-hits', 'заклинатель попадает по цели атакой'], ['target-hit', 'по цели попадают атакой'],
  ['target-damaged', 'цель получает урон'], ['target-acts', 'цель атакует или творит заклинание'],
  ['command', 'командой (раздел Ж)'], ['spell-end', 'при окончании заклинания'],
];

export const TIMES: readonly Option[] = [
  ['each', 'каждый раз'], ['turn', 'раз за ход'], ['round', 'раз за раунд'], ['spell', 'раз за заклинание'], ['count', 'N раз'],
];

export const WHO: readonly Option[] = [
  ['targets', 'цели заклинания'], ['caster', 'заклинатель'], ['area', 'все в области'], ['entering', 'вошедший в зону'],
  ['attacker', 'атакующий'], ['attack-target', 'цель атаки'], ['chosen', 'выбранные'],
];

export const CHECK_KINDS: readonly Option[] = [
  ['none', 'нет — срабатывает само'], ['attack', 'атака заклинанием'], ['save', 'спасбросок'],
  ['ability', 'проверка характеристики'], ['contest', 'состязание'], ['caster-d20', 'бросок к20 заклинателя'],
  ['hp-threshold', 'сравнение хитов'],
];

export const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  always: 'всегда', hit: 'попадание', miss: 'промах', crit: 'крит', fail: 'провал', success: 'успех', met: 'вышло', unmet: 'не вышло',
};

export const COMMAND_COSTS: readonly Option[] = [
  ['action', 'действие'], ['bonus', 'бонусное действие'], ['reaction', 'реакция'], ['free', 'без действия'], ['movement', 'часть движения'],
];

export const COMMAND_WHEN: readonly Option[] = [
  ['own-turn', 'в свой ход'], ['after-cast', 'со следующего хода'], ['always', 'всегда'],
];

export const COMMAND_DOES: readonly Option[] = [
  ['move-zone', 'сдвинуть зону'], ['move-summon', 'сдвинуть призванное'], ['run-action', 'выполнить действие'],
  ['switch-mode', 'сменить режим'], ['transfer', 'перенести на другую цель'], ['end', 'закончить заклинание'],
];

export const COMMAND_LIMITS: readonly Option[] = [
  ['turn', 'раз за ход'], ['round', 'раз за раунд'], ['count', 'N раз'], ['none', 'без ограничения'],
];

export const SCALING_WHAT: readonly Option[] = [
  ['damage', 'урон'], ['healing', 'лечение'], ['temp-hp', 'временные хиты'], ['targets', 'число целей'],
  ['projectiles', 'лучи и снаряды'], ['hops', 'перескоки цепочки'], ['area', 'размер области'],
  ['duration', 'длительность'], ['summons', 'призыв'], ['threshold', 'порог хитов'], ['bonus', 'бонус'],
];

export const SCALING_PER: readonly Option[] = [
  ['slot', 'за каждый круг выше'], ['two-slots', 'за каждые два круга выше'], ['steps', 'ступенями по кругу ячейки'],
  ['cantrip', 'заговор: на 5, 11 и 17 уровне'],
];

export const PARAM_KINDS: readonly Option[] = [
  ['damage-type', 'вид урона'], ['ability', 'характеристика'], ['condition', 'состояние'], ['creature', 'существо из бестиария'],
  ['choice', 'свой список'], ['number', 'число'], ['text', 'слово или фраза'],
];

export const PARAM_CHOOSERS: readonly Option[] = [
  ['caster', 'заклинатель при сотворении'], ['target', 'цель'], ['gm', 'мастер'],
];

export const PURPOSES: readonly Option[] = [
  ['damage-single', 'урон по одной цели'], ['damage-area', 'урон по области'], ['control', 'контроль'], ['healing', 'лечение'],
  ['buff', 'усиление союзника'], ['self-defense', 'защита себя'], ['movement', 'передвижение'], ['summon', 'призыв'],
  ['scouting', 'разведка'], ['other', 'прочее'],
];

export const PREFER: readonly Option[] = [
  ['weakest-enemy', 'слабейший враг'], ['strongest-enemy', 'сильнейший враг'], ['hurt-ally', 'раненый союзник'],
  ['strongest-ally', 'сильнейший союзник'], ['self', 'себя'],
];
