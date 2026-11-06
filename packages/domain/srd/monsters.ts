export type MonsterSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
export type MonsterAbility = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
export type MonsterDamageType =
  | 'acid' | 'bludgeoning' | 'cold' | 'fire' | 'force' | 'lightning' | 'necrotic'
  | 'piercing' | 'poison' | 'psychic' | 'radiant' | 'slashing' | 'thunder';

export type MonsterAttack = {
  name: string;
  kind: 'melee' | 'ranged';
  ability: 'strength' | 'dexterity';
  toHit: number;
  reach?: number;
  range?: [number, number];
  damage: string | null;
  average?: number;
  type?: MonsterDamageType;
  versatile?: string;
  extra?: { damage: string; average: number; type: MonsterDamageType };
  quirk?: true;
  note?: string;
};

export type SrdMonster = {
  index: string;
  name: string;
  nameRu: string;
  size: MonsterSize;
  type: string;
  alignment: string;
  ac: number;
  acNote?: string;
  hp: number;
  hitDice: string;
  speed: number;
  speedNote?: string;
  abilities: [number, number, number, number, number, number];
  saves?: Partial<Record<MonsterAbility, number>>;
  skills?: Record<string, number>;
  vulnerable?: MonsterDamageType[];
  resistant?: MonsterDamageType[];
  immune?: MonsterDamageType[];
  conditionImmunities?: string;
  darkvision?: number;
  senses?: string;
  passive: number;
  languages: string;
  cr: number;
  multiattack?: { count: number; text: string };
  attacks: MonsterAttack[];
  traits?: Array<[string, string]>;
  actions?: Array<[string, string]>;
  reactions?: Array<[string, string]>;
  spellcasting?: { ability: MonsterAbility; slots: number[]; spells: string[]; text: string };
};

const PACK_TACTICS: [string, string] = ['Тактика стаи', 'Совершает с преимуществом броски атаки по существу, если в пределах 5 фт. от этого существа находится хотя бы один дееспособный союзник.'];
const KEEN_SMELL: [string, string] = ['Тонкий нюх', 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на обоняние.'];
const KEEN_HEARING_SMELL: [string, string] = ['Тонкий слух и нюх', 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на слух или обоняние.'];
const NIMBLE_ESCAPE: [string, string] = ['Ловкий побег', 'Может в каждый свой ход совершать бонусным действием Отход или Засаду (спрятаться).'];
const SUNLIGHT_SENSITIVITY: [string, string] = ['Чувствительность к солнцу', 'На солнечном свету совершает с помехой броски атаки и проверки Мудрости (Восприятие), полагающиеся на зрение.'];
const DARK_DEVOTION: [string, string] = ['Тёмная преданность', 'Совершает с преимуществом спасброски от очарования и испуга.'];
const PARRY = (bonus: number): [string, string] => ['Парирование', `Добавляет +${bonus} к КД против одной рукопашной атаки, которая попала бы по нему. Для этого он должен видеть атакующего и держать рукопашное оружие.`];
const UNDEAD_SPEECH = 'понимает языки, которые знал при жизни, но не говорит';
const PRONE_BITE = (dc: number) => `Если цель — существо, она должна преуспеть в спасброске Силы со СЛ ${dc}, иначе сбита с ног.`;
const KEEN_HEARING: [string, string] = ['Тонкий слух', 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на слух.'];
const KEEN_SIGHT: [string, string] = ['Острое зрение', 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на зрение.'];
const KEEN_HEARING_SIGHT: [string, string] = ['Тонкий слух и острое зрение', 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на слух или зрение.'];
const AMPHIBIOUS: [string, string] = ['Амфибия', 'Может дышать и воздухом, и под водой.'];
const WATER_BREATHING: [string, string] = ['Подводное дыхание', 'Может дышать только под водой.'];
const CHARGE = (what: string, distance: number, extra: string, average: number, dc: number): [string, string] => [
  'Натиск', `Если ${what} переместился по прямой хотя бы на ${distance} фт. к цели и в тот же ход попал по ней тараном, цель получает дополнительно ${average} (${extra}) дробящего урона. Если цель — существо, она должна преуспеть в спасброске Силы со СЛ ${dc}, иначе сбита с ног.`,
];

export const SRD_MONSTERS: SrdMonster[] = [
  {
    index: 'commoner', name: 'Commoner', nameRu: 'Простолюдин', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое мировоззрение',
    ac: 10, hp: 4, hitDice: '1d8', speed: 30, abilities: [10, 10, 10, 10, 10, 10],
    passive: 10, languages: 'любой один язык (обычно Общий)', cr: 0,
    attacks: [{ name: 'Дубинка', kind: 'melee', ability: 'strength', toHit: 2, reach: 5, damage: '1d4', average: 2, type: 'bludgeoning' }],
  },
  {
    index: 'bat', name: 'Bat', nameRu: 'Летучая мышь', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 1, hitDice: '1d4-1', speed: 5, speedNote: 'летая 30 фт.', abilities: [2, 15, 8, 2, 12, 4],
    senses: 'слепое зрение 60 фт.', passive: 11, languages: '—', cr: 0,
    traits: [['Эхолокация', 'Не может пользоваться слепым зрением, пока оглох.'], KEEN_HEARING],
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 0, reach: 5, damage: '1d1', average: 1, type: 'piercing', quirk: true }],
  },
  {
    index: 'cat', name: 'Cat', nameRu: 'Кошка', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 2, hitDice: '1d4', speed: 40, speedNote: 'лазая 30 фт.', abilities: [3, 15, 10, 3, 12, 7],
    skills: { perception: 3, stealth: 4 }, passive: 13, languages: '—', cr: 0,
    traits: [KEEN_SMELL],
    attacks: [{ name: 'Когти', kind: 'melee', ability: 'dexterity', toHit: 0, reach: 5, damage: '1d1', average: 1, type: 'slashing', quirk: true }],
  },
  {
    index: 'crab', name: 'Crab', nameRu: 'Краб', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 11, acNote: 'природный доспех', hp: 2, hitDice: '1d4', speed: 20, speedNote: 'плавая 20 фт.', abilities: [2, 11, 10, 1, 8, 2],
    skills: { stealth: 2 }, senses: 'слепое зрение 30 фт.', passive: 9, languages: '—', cr: 0,
    traits: [AMPHIBIOUS],
    attacks: [{ name: 'Клешня', kind: 'melee', ability: 'dexterity', toHit: 0, reach: 5, damage: '1d1', average: 1, type: 'bludgeoning', quirk: true }],
  },
  {
    index: 'frog', name: 'Frog', nameRu: 'Лягушка', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 11, hp: 1, hitDice: '1d4-1', speed: 20, speedNote: 'плавая 20 фт.', abilities: [1, 13, 8, 1, 8, 3],
    skills: { perception: 1, stealth: 3 }, darkvision: 30, passive: 11, languages: '—', cr: 0,
    traits: [AMPHIBIOUS, ['Прыжок с места', 'Прыгает в длину до 10 фт. и в высоту до 5 фт. — с разбега и без.']],
    attacks: [],
  },
  {
    index: 'hawk', name: 'Hawk', nameRu: 'Ястреб', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 13, hp: 1, hitDice: '1d4-1', speed: 10, speedNote: 'летая 60 фт.', abilities: [5, 16, 8, 2, 14, 6],
    skills: { perception: 4 }, passive: 14, languages: '—', cr: 0,
    traits: [KEEN_SIGHT],
    attacks: [{ name: 'Когти', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, damage: '1d1', average: 1, type: 'slashing' }],
  },
  {
    index: 'lizard', name: 'Lizard', nameRu: 'Ящерица', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 10, hp: 2, hitDice: '1d4', speed: 20, speedNote: 'лазая 20 фт.', abilities: [2, 11, 10, 1, 8, 3],
    darkvision: 30, passive: 9, languages: '—', cr: 0,
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 0, reach: 5, damage: '1d1', average: 1, type: 'piercing', quirk: true }],
  },
  {
    index: 'octopus', name: 'Octopus', nameRu: 'Осьминог', size: 'small', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 3, hitDice: '1d6', speed: 5, speedNote: 'плавая 30 фт.', abilities: [4, 15, 11, 3, 10, 4],
    skills: { perception: 2, stealth: 4 }, darkvision: 30, passive: 12, languages: '—', cr: 0,
    traits: [
      ['Задержка дыхания', 'Вне воды может задерживать дыхание на 30 минут.'],
      ['Подводная маскировка', 'Совершает с преимуществом проверки Ловкости (Скрытность) под водой.'],
      WATER_BREATHING,
    ],
    actions: [['Чернильное облако (перезаряжается после короткого или долгого отдыха)', 'Под водой выпускает чернила: сфера радиусом 5 фт. вокруг сильно заслонена на 1 минуту (сильное течение рассеивает раньше). Затем бонусным действием может совершить Рывок.']],
    attacks: [{
      name: 'Щупальца', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d1', average: 1, type: 'bludgeoning',
      note: 'Цель схвачена (СЛ высвобождения 10). Пока она схвачена, осьминог не может бить щупальцами другую цель.',
    }],
  },
  {
    index: 'owl', name: 'Owl', nameRu: 'Сова', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 11, hp: 1, hitDice: '1d4-1', speed: 5, speedNote: 'летая 60 фт.', abilities: [3, 13, 8, 2, 12, 7],
    skills: { perception: 3, stealth: 3 }, darkvision: 120, passive: 13, languages: '—', cr: 0,
    traits: [['Пролёт', 'Вылетая из досягаемости врага, не провоцирует атак.'], KEEN_HEARING_SIGHT],
    attacks: [{ name: 'Когти', kind: 'melee', ability: 'dexterity', toHit: 3, reach: 5, damage: '1d1', average: 1, type: 'slashing' }],
  },
  {
    index: 'quipper', name: 'Quipper', nameRu: 'Квиппер', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 13, hp: 1, hitDice: '1d4-1', speed: 0, speedNote: 'плавая 40 фт.', abilities: [2, 16, 9, 1, 7, 2],
    darkvision: 60, passive: 8, languages: '—', cr: 0,
    traits: [['Кровавое бешенство', 'Совершает с преимуществом рукопашные атаки по существу, у которого меньше максимума хитов.'], WATER_BREATHING],
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, damage: '1d1', average: 1, type: 'piercing' }],
  },
  {
    index: 'rat', name: 'Rat', nameRu: 'Крыса', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 10, hp: 1, hitDice: '1d4-1', speed: 20, abilities: [2, 11, 9, 2, 10, 4],
    darkvision: 30, passive: 10, languages: '—', cr: 0,
    traits: [KEEN_SMELL],
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 0, reach: 5, damage: '1d1', average: 1, type: 'piercing', quirk: true }],
  },
  {
    index: 'raven', name: 'Raven', nameRu: 'Ворон', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 1, hitDice: '1d4-1', speed: 10, speedNote: 'летая 50 фт.', abilities: [2, 14, 8, 2, 12, 6],
    skills: { perception: 3 }, passive: 13, languages: '—', cr: 0,
    traits: [['Подражание', 'Подражает простым звукам, что слышал: шёпоту, плачу младенца, писку зверька. Распознать подделку — проверка Мудрости (Проницательность) со СЛ 10.']],
    attacks: [{ name: 'Клюв', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d1', average: 1, type: 'piercing' }],
  },
  {
    index: 'sea-horse', name: 'Sea Horse', nameRu: 'Морской конёк', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 11, hp: 1, hitDice: '1d4-1', speed: 0, speedNote: 'плавая 20 фт.', abilities: [1, 12, 8, 1, 10, 2],
    passive: 10, languages: '—', cr: 0,
    traits: [WATER_BREATHING],
    attacks: [],
  },
  {
    index: 'spider', name: 'Spider', nameRu: 'Паук', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 1, hitDice: '1d4-1', speed: 20, speedNote: 'лазая 20 фт.', abilities: [2, 14, 8, 1, 10, 2],
    skills: { stealth: 4 }, darkvision: 30, passive: 10, languages: '—', cr: 0,
    traits: [
      ['Паучье лазание', 'Лазает по сложным поверхностям, в том числе вниз головой по потолку, без проверок характеристик.'],
      ['Чувство паутины', 'Касаясь паутины, знает, где находится любое существо, касающееся той же паутины.'],
      ['Хождение по паутине', 'Не стеснён паутиной.'],
    ],
    attacks: [{
      name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d1', average: 1, type: 'piercing',
      note: 'Цель должна преуспеть в спасброске Телосложения со СЛ 9, иначе получает 2 (1d4) урона ядом.',
    }],
  },
  {
    index: 'weasel', name: 'Weasel', nameRu: 'Ласка', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 13, hp: 1, hitDice: '1d4-1', speed: 30, abilities: [3, 16, 8, 2, 12, 3],
    skills: { perception: 3, stealth: 5 }, passive: 13, languages: '—', cr: 0,
    traits: [KEEN_HEARING_SMELL],
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, damage: '1d1', average: 1, type: 'piercing' }],
  },
  {
    index: 'poisonous-snake', name: 'Poisonous Snake', nameRu: 'Ядовитая змея', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 13, hp: 2, hitDice: '1d4', speed: 30, speedNote: 'плавая 30 фт.', abilities: [2, 16, 11, 1, 10, 3],
    senses: 'слепое зрение 10 фт.', passive: 10, languages: '—', cr: 0.125,
    attacks: [{
      name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, damage: '1d1', average: 1, type: 'piercing',
      note: 'Цель должна совершить спасбросок Телосложения со СЛ 10: провал — 5 (2d4) урона ядом, успех — половина.',
    }],
  },
  {
    index: 'pony', name: 'Pony', nameRu: 'Пони', size: 'medium', type: 'зверь', alignment: 'без мировоззрения',
    ac: 10, hp: 11, hitDice: '2d8+2', speed: 40, abilities: [15, 10, 13, 2, 11, 7],
    passive: 10, languages: '—', cr: 0.125,
    attacks: [{ name: 'Копыта', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '2d4+2', average: 7, type: 'bludgeoning' }],
  },
  {
    index: 'camel', name: 'Camel', nameRu: 'Верблюд', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 9, hp: 15, hitDice: '2d10+4', speed: 50, abilities: [16, 8, 14, 2, 8, 5],
    passive: 9, languages: '—', cr: 0.125,
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d4', average: 2, type: 'bludgeoning' }],
  },
  {
    index: 'bandit', name: 'Bandit', nameRu: 'Бандит', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое не-законное',
    ac: 12, acNote: 'кожаный доспех', hp: 11, hitDice: '2d8+2', speed: 30, abilities: [11, 12, 12, 10, 10, 10],
    passive: 10, languages: 'любой один язык (обычно Общий)', cr: 0.125,
    attacks: [
      { name: 'Скимитар', kind: 'melee', ability: 'dexterity', toHit: 3, reach: 5, damage: '1d6+1', average: 4, type: 'slashing' },
      { name: 'Лёгкий арбалет', kind: 'ranged', ability: 'dexterity', toHit: 3, range: [80, 320], damage: '1d8+1', average: 5, type: 'piercing' },
    ],
  },
  {
    index: 'cultist', name: 'Cultist', nameRu: 'Культист', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое не-доброе',
    ac: 12, acNote: 'кожаный доспех', hp: 9, hitDice: '2d8', speed: 30, abilities: [11, 12, 10, 10, 11, 10],
    skills: { deception: 2, religion: 2 }, passive: 10, languages: 'любой один язык (обычно Общий)', cr: 0.125,
    traits: [DARK_DEVOTION],
    attacks: [{ name: 'Скимитар', kind: 'melee', ability: 'dexterity', toHit: 3, reach: 5, damage: '1d6+1', average: 4, type: 'slashing' }],
  },
  {
    index: 'guard', name: 'Guard', nameRu: 'Стражник', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое мировоззрение',
    ac: 16, acNote: 'кольчужная рубаха, щит', hp: 11, hitDice: '2d8+2', speed: 30, abilities: [13, 12, 12, 10, 11, 10],
    skills: { perception: 2 }, passive: 12, languages: 'любой один язык (обычно Общий)', cr: 0.125,
    attacks: [{ name: 'Копьё', kind: 'melee', ability: 'strength', toHit: 3, reach: 5, range: [20, 60], damage: '1d6+1', average: 4, type: 'piercing', versatile: '1d8+1' }],
  },
  {
    index: 'kobold', name: 'Kobold', nameRu: 'Кобольд', size: 'small', type: 'гуманоид (кобольд)', alignment: 'законно-злой',
    ac: 12, hp: 5, hitDice: '2d6-2', speed: 30, abilities: [7, 15, 9, 8, 7, 8],
    darkvision: 60, passive: 8, languages: 'Общий, Драконий', cr: 0.125,
    traits: [SUNLIGHT_SENSITIVITY, PACK_TACTICS],
    attacks: [
      { name: 'Кинжал', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d4+2', average: 4, type: 'piercing' },
      { name: 'Праща', kind: 'ranged', ability: 'dexterity', toHit: 4, range: [30, 120], damage: '1d4+2', average: 4, type: 'bludgeoning' },
    ],
  },
  {
    index: 'giant-rat', name: 'Giant Rat', nameRu: 'Гигантская крыса', size: 'small', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 7, hitDice: '2d6', speed: 30, abilities: [7, 15, 11, 2, 10, 4],
    darkvision: 60, passive: 10, languages: '—', cr: 0.125,
    traits: [KEEN_SMELL, PACK_TACTICS],
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d4+2', average: 4, type: 'piercing' }],
  },
  {
    index: 'stirge', name: 'Stirge', nameRu: 'Стирж', size: 'tiny', type: 'зверь', alignment: 'без мировоззрения',
    ac: 14, acNote: 'природный доспех', hp: 2, hitDice: '1d4', speed: 10, speedNote: 'летая 40 фт.', abilities: [4, 16, 11, 2, 8, 6],
    darkvision: 60, passive: 9, languages: '—', cr: 0.125,
    attacks: [{
      name: 'Высасывание крови', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, damage: '1d4+3', average: 5, type: 'piercing',
      note: 'Стирж прицепляется к цели. Пока он прицеплен, он не атакует, а в начале каждого его хода цель теряет 5 (1d4 + 3) хитов от потери крови. Стирж отцепляется, потратив 5 фт. перемещения, — после того как высосет 10 хитов или цель умрёт. Существо, в том числе цель, может действием отцепить его.',
    }],
  },
  {
    index: 'mastiff', name: 'Mastiff', nameRu: 'Мастиф', size: 'medium', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 5, hitDice: '1d8+1', speed: 40, abilities: [13, 14, 12, 3, 12, 7],
    skills: { perception: 3 }, passive: 13, languages: '—', cr: 0.125,
    traits: [KEEN_HEARING_SMELL],
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'strength', toHit: 3, reach: 5, damage: '1d6+1', average: 4, type: 'piercing', note: PRONE_BITE(11) }],
  },
  {
    index: 'goblin', name: 'Goblin', nameRu: 'Гоблин', size: 'small', type: 'гуманоид (гоблиноид)', alignment: 'нейтрально-злой',
    ac: 15, acNote: 'кожаный доспех, щит', hp: 7, hitDice: '2d6', speed: 30, abilities: [8, 14, 10, 10, 8, 8],
    skills: { stealth: 6 }, darkvision: 60, passive: 9, languages: 'Общий, Гоблинский', cr: 0.25,
    traits: [NIMBLE_ESCAPE],
    attacks: [
      { name: 'Скимитар', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'slashing' },
      { name: 'Короткий лук', kind: 'ranged', ability: 'dexterity', toHit: 4, range: [80, 320], damage: '1d6+2', average: 5, type: 'piercing' },
    ],
  },
  {
    index: 'skeleton', name: 'Skeleton', nameRu: 'Скелет', size: 'medium', type: 'нежить', alignment: 'законно-злой',
    ac: 13, acNote: 'обрывки доспеха', hp: 13, hitDice: '2d8+4', speed: 30, abilities: [10, 14, 15, 6, 8, 5],
    vulnerable: ['bludgeoning'], immune: ['poison'], conditionImmunities: 'истощение, отравление',
    darkvision: 60, passive: 9, languages: UNDEAD_SPEECH, cr: 0.25,
    attacks: [
      { name: 'Короткий меч', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'piercing' },
      { name: 'Короткий лук', kind: 'ranged', ability: 'dexterity', toHit: 4, range: [80, 320], damage: '1d6+2', average: 5, type: 'piercing' },
    ],
  },
  {
    index: 'zombie', name: 'Zombie', nameRu: 'Зомби', size: 'medium', type: 'нежить', alignment: 'нейтрально-злой',
    ac: 8, hp: 22, hitDice: '3d8+9', speed: 20, abilities: [13, 6, 16, 3, 6, 5],
    saves: { wisdom: 0 }, immune: ['poison'], conditionImmunities: 'отравление',
    darkvision: 60, passive: 8, languages: UNDEAD_SPEECH, cr: 0.25,
    traits: [['Стойкость нежити', 'Если урон опускает хиты зомби до 0, он совершает спасбросок Телосложения со СЛ 5 + полученный урон, если только урон не излучением и не от критического попадания. При успехе у зомби остаётся 1 хит.']],
    attacks: [{ name: 'Удар', kind: 'melee', ability: 'strength', toHit: 3, reach: 5, damage: '1d6+1', average: 4, type: 'bludgeoning' }],
  },
  {
    index: 'wolf', name: 'Wolf', nameRu: 'Волк', size: 'medium', type: 'зверь', alignment: 'без мировоззрения',
    ac: 13, acNote: 'природный доспех', hp: 11, hitDice: '2d8+2', speed: 40, abilities: [12, 15, 12, 3, 12, 6],
    skills: { perception: 3, stealth: 4 }, passive: 13, languages: '—', cr: 0.25,
    traits: [KEEN_HEARING_SMELL, PACK_TACTICS],
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '2d4+2', average: 7, type: 'piercing', note: PRONE_BITE(11) }],
  },
  {
    index: 'acolyte', name: 'Acolyte', nameRu: 'Послушник', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое мировоззрение',
    ac: 10, hp: 9, hitDice: '2d8', speed: 30, abilities: [10, 10, 10, 10, 14, 11],
    skills: { medicine: 4, religion: 2 }, passive: 12, languages: 'любой один язык (обычно Общий)', cr: 0.25,
    attacks: [{ name: 'Дубинка', kind: 'melee', ability: 'strength', toHit: 2, reach: 5, damage: '1d4', average: 2, type: 'bludgeoning' }],
    spellcasting: {
      ability: 'wisdom', slots: [3],
      spells: ['light', 'sacred-flame', 'thaumaturgy', 'bless', 'cure-wounds', 'sanctuary'],
      text: 'Заклинатель 1-го уровня, базовая характеристика — Мудрость (СЛ спасброска 12, +4 к попаданию заклинаниями). Подготовлены заклинания жреца: заговоры — свет, священное пламя, чудотворство; 1-й круг (3 ячейки) — благословение, лечение ран, убежище.',
    },
  },
  {
    index: 'boar', name: 'Boar', nameRu: 'Кабан', size: 'medium', type: 'зверь', alignment: 'без мировоззрения',
    ac: 11, acNote: 'природный доспех', hp: 11, hitDice: '2d8+2', speed: 40, abilities: [13, 11, 12, 2, 9, 5],
    passive: 9, languages: '—', cr: 0.25,
    traits: [
      ['Натиск', 'Если кабан переместился по прямой хотя бы на 20 фт. к цели и в тот же ход попал по ней клыком, цель получает дополнительно 3 (1d6) рубящего урона. Если цель — существо, она должна преуспеть в спасброске Силы со СЛ 11, иначе сбита с ног.'],
      ['Неутомимый (восстанавливается после короткого или долгого отдыха)', 'Если кабан получает не больше 7 урона и это опустило бы его хиты до 0, вместо этого у него остаётся 1 хит.'],
    ],
    attacks: [{ name: 'Клык', kind: 'melee', ability: 'strength', toHit: 3, reach: 5, damage: '1d6+1', average: 4, type: 'slashing' }],
  },
  {
    index: 'panther', name: 'Panther', nameRu: 'Пантера', size: 'medium', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 13, hitDice: '3d8', speed: 50, speedNote: 'лазая 40 фт.', abilities: [14, 15, 10, 3, 14, 7],
    skills: { perception: 4, stealth: 6 }, passive: 14, languages: '—', cr: 0.25,
    traits: [
      KEEN_SMELL,
      ['Прыжок', 'Если пантера переместилась по прямой хотя бы на 20 фт. к существу и в тот же ход попала по нему когтем, цель должна преуспеть в спасброске Силы со СЛ 12, иначе сбита с ног. По сбитой цели пантера может бонусным действием атаковать укусом.'],
    ],
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'piercing' },
      { name: 'Коготь', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d4+2', average: 4, type: 'slashing' },
    ],
  },
  {
    index: 'elk', name: 'Elk', nameRu: 'Лось', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 10, hp: 13, hitDice: '2d10+2', speed: 50, abilities: [16, 10, 12, 2, 10, 6],
    passive: 10, languages: '—', cr: 0.25,
    traits: [CHARGE('лось', 20, '2d6', 7, 13)],
    attacks: [
      { name: 'Таран', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d6+3', average: 6, type: 'bludgeoning' },
      { name: 'Копыта', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '2d4+3', average: 8, type: 'bludgeoning', note: 'Только по лежащему существу.' },
    ],
  },
  {
    index: 'warhorse', name: 'Warhorse', nameRu: 'Боевой конь', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 11, hp: 19, hitDice: '3d10+3', speed: 60, abilities: [18, 12, 13, 2, 12, 7],
    passive: 11, languages: '—', cr: 0.5,
    traits: [['Топчущий натиск', 'Если конь переместился по прямой хотя бы на 20 фт. к существу и в тот же ход попал по нему копытами, цель должна преуспеть в спасброске Силы со СЛ 14, иначе сбита с ног. По сбитой с ног цели конь может бонусным действием ещё раз ударить копытами.']],
    attacks: [{ name: 'Копыта', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d6+4', average: 11, type: 'bludgeoning' }],
  },
  {
    index: 'black-bear', name: 'Black Bear', nameRu: 'Чёрный медведь', size: 'medium', type: 'зверь', alignment: 'без мировоззрения',
    ac: 11, acNote: 'природный доспех', hp: 19, hitDice: '3d8+6', speed: 40, speedNote: 'лазая 30 фт.', abilities: [15, 10, 14, 2, 12, 7],
    skills: { perception: 3 }, passive: 13, languages: '—', cr: 0.5,
    traits: [KEEN_SMELL],
    multiattack: { count: 2, text: 'Совершает две атаки: одну укусом и одну когтями.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '2d4+2', average: 7, type: 'slashing' },
    ],
  },
  {
    index: 'ape', name: 'Ape', nameRu: 'Обезьяна', size: 'medium', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 19, hitDice: '3d8+6', speed: 30, speedNote: 'лазая 30 фт.', abilities: [16, 14, 14, 6, 12, 7],
    skills: { athletics: 5, perception: 3 }, passive: 13, languages: '—', cr: 0.5,
    multiattack: { count: 2, text: 'Совершает две атаки кулаками.' },
    attacks: [
      { name: 'Кулак', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d6+3', average: 6, type: 'bludgeoning' },
      { name: 'Камень', kind: 'ranged', ability: 'strength', toHit: 5, range: [25, 50], damage: '1d6+3', average: 6, type: 'bludgeoning' },
    ],
  },
  {
    index: 'orc', name: 'Orc', nameRu: 'Орк', size: 'medium', type: 'гуманоид (орк)', alignment: 'хаотично-злой',
    ac: 13, acNote: 'шкурный доспех', hp: 15, hitDice: '2d8+6', speed: 30, abilities: [16, 12, 16, 7, 11, 10],
    skills: { intimidation: 2 }, darkvision: 60, passive: 10, languages: 'Общий, Орочий', cr: 0.5,
    traits: [['Агрессивный', 'Бонусным действием может переместиться на расстояние не больше своей скорости к видимому враждебному существу.']],
    attacks: [
      { name: 'Секира', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d12+3', average: 9, type: 'slashing' },
      { name: 'Метательное копьё', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, range: [30, 120], damage: '1d6+3', average: 6, type: 'piercing' },
    ],
  },
  {
    index: 'hobgoblin', name: 'Hobgoblin', nameRu: 'Хобгоблин', size: 'medium', type: 'гуманоид (гоблиноид)', alignment: 'законно-злой',
    ac: 18, acNote: 'кольчуга, щит', hp: 11, hitDice: '2d8+2', speed: 30, abilities: [13, 12, 12, 10, 10, 9],
    darkvision: 60, passive: 10, languages: 'Общий, Гоблинский', cr: 0.5,
    traits: [['Воинское превосходство', 'Раз в ход наносит дополнительно 7 (2d6) урона существу, по которому попал атакой оружием, если в пределах 5 фт. от этого существа есть дееспособный союзник хобгоблина.']],
    attacks: [
      { name: 'Длинный меч', kind: 'melee', ability: 'strength', toHit: 3, reach: 5, damage: '1d8+1', average: 5, type: 'slashing', versatile: '1d10+1' },
      { name: 'Длинный лук', kind: 'ranged', ability: 'dexterity', toHit: 3, range: [150, 600], damage: '1d8+1', average: 5, type: 'piercing' },
    ],
  },
  {
    index: 'gnoll', name: 'Gnoll', nameRu: 'Гнолл', size: 'medium', type: 'гуманоид (гнолл)', alignment: 'хаотично-злой',
    ac: 15, acNote: 'шкурный доспех, щит', hp: 22, hitDice: '5d8', speed: 30, abilities: [14, 12, 11, 6, 10, 7],
    darkvision: 60, passive: 10, languages: 'Гноллий', cr: 0.5,
    traits: [['Буйство', 'Когда гнолл в свой ход опускает хиты существа до 0 рукопашной атакой, он может бонусным действием переместиться на половину скорости и атаковать укусом.']],
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d4+2', average: 4, type: 'piercing' },
      { name: 'Копьё', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, range: [20, 60], damage: '1d6+2', average: 5, type: 'piercing', versatile: '1d8+2' },
      { name: 'Длинный лук', kind: 'ranged', ability: 'dexterity', toHit: 3, range: [150, 600], damage: '1d8+1', average: 5, type: 'piercing' },
    ],
  },
  {
    index: 'thug', name: 'Thug', nameRu: 'Головорез', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое не-доброе',
    ac: 11, acNote: 'кожаный доспех', hp: 32, hitDice: '5d8+10', speed: 30, abilities: [15, 11, 14, 10, 10, 11],
    skills: { intimidation: 2 }, passive: 10, languages: 'любой один язык (обычно Общий)', cr: 0.5,
    traits: [PACK_TACTICS],
    multiattack: { count: 2, text: 'Совершает две рукопашные атаки.' },
    attacks: [
      { name: 'Булава', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'bludgeoning' },
      { name: 'Тяжёлый арбалет', kind: 'ranged', ability: 'dexterity', toHit: 2, range: [100, 400], damage: '1d10', average: 5, type: 'piercing' },
    ],
  },
  {
    index: 'worg', name: 'Worg', nameRu: 'Ворг', size: 'large', type: 'чудовище', alignment: 'нейтрально-злой',
    ac: 13, acNote: 'природный доспех', hp: 26, hitDice: '4d10+4', speed: 50, abilities: [16, 13, 13, 7, 11, 8],
    skills: { perception: 4 }, darkvision: 60, passive: 14, languages: 'Гоблинский, Воргов', cr: 0.5,
    traits: [KEEN_HEARING_SMELL],
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '2d6+3', average: 10, type: 'piercing', note: PRONE_BITE(13) }],
  },
  {
    index: 'scout', name: 'Scout', nameRu: 'Разведчик', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое мировоззрение',
    ac: 13, acNote: 'кожаный доспех', hp: 16, hitDice: '3d8+3', speed: 30, abilities: [11, 14, 12, 11, 13, 11],
    skills: { nature: 4, perception: 5, stealth: 6, survival: 5 }, passive: 15, languages: 'любой один язык (обычно Общий)', cr: 0.5,
    traits: [['Тонкий слух и зрение', 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на слух или зрение.']],
    multiattack: { count: 2, text: 'Совершает две рукопашные или две дальнобойные атаки.' },
    attacks: [
      { name: 'Короткий меч', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'piercing' },
      { name: 'Длинный лук', kind: 'ranged', ability: 'dexterity', toHit: 4, range: [150, 600], damage: '1d8+2', average: 6, type: 'piercing' },
    ],
  },
  {
    index: 'lizardfolk', name: 'Lizardfolk', nameRu: 'Людоящер', size: 'medium', type: 'гуманоид (людоящер)', alignment: 'нейтральный',
    ac: 15, acNote: 'природный доспех, щит', hp: 22, hitDice: '4d8+4', speed: 30, speedNote: 'плавая 30 фт.', abilities: [15, 10, 13, 7, 12, 7],
    skills: { perception: 3, stealth: 4, survival: 5 }, passive: 13, languages: 'Драконий', cr: 0.5,
    traits: [['Задержка дыхания', 'Может задерживать дыхание на 15 минут.']],
    multiattack: { count: 2, text: 'Совершает две рукопашные атаки, каждую — другим оружием.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'piercing' },
      { name: 'Тяжёлая дубина', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'bludgeoning' },
      { name: 'Метательное копьё', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, range: [30, 120], damage: '1d6+2', average: 5, type: 'piercing' },
      { name: 'Шипастый щит', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'piercing' },
    ],
  },
  {
    index: 'crocodile', name: 'Crocodile', nameRu: 'Крокодил', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, acNote: 'природный доспех', hp: 19, hitDice: '3d10+3', speed: 20, speedNote: 'плавая 30 фт.', abilities: [15, 10, 13, 2, 10, 5],
    skills: { stealth: 2 }, passive: 10, languages: '—', cr: 0.5,
    traits: [['Задержка дыхания', 'Может задерживать дыхание на 15 минут.']],
    attacks: [{
      name: 'Укус', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d10+2', average: 7, type: 'piercing',
      note: 'Цель схвачена (СЛ высвобождения 12). Пока она схвачена, она опутана, а крокодил не может кусать другую цель.',
    }],
  },
  {
    index: 'bugbear', name: 'Bugbear', nameRu: 'Багбир', size: 'medium', type: 'гуманоид (гоблиноид)', alignment: 'хаотично-злой',
    ac: 16, acNote: 'шкурный доспех, щит', hp: 27, hitDice: '5d8+5', speed: 30, abilities: [15, 14, 13, 8, 11, 9],
    skills: { stealth: 6, survival: 2 }, darkvision: 60, passive: 10, languages: 'Общий, Гоблинский', cr: 1,
    traits: [
      ['Громила', 'Рукопашное оружие наносит одну дополнительную кость урона (уже учтено в атаках).'],
      ['Внезапная атака', 'Если багбир застал существо врасплох и попал по нему атакой в первом раунде боя, цель получает дополнительно 7 (2d6) урона.'],
    ],
    attacks: [
      { name: 'Моргенштерн', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '2d8+2', average: 11, type: 'piercing' },
      { name: 'Метательное копьё (вблизи)', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '2d6+2', average: 9, type: 'piercing' },
      { name: 'Метательное копьё (бросок)', kind: 'ranged', ability: 'strength', toHit: 4, range: [30, 120], damage: '1d6+2', average: 5, type: 'piercing' },
    ],
  },
  {
    index: 'ghoul', name: 'Ghoul', nameRu: 'Упырь', size: 'medium', type: 'нежить', alignment: 'хаотично-злой',
    ac: 12, hp: 22, hitDice: '5d8', speed: 30, abilities: [13, 15, 10, 7, 10, 6],
    immune: ['poison'], conditionImmunities: 'истощение, отравление, очарование',
    darkvision: 60, passive: 10, languages: 'Общий', cr: 1,
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 2, reach: 5, damage: '2d6+2', average: 9, type: 'piercing', quirk: true },
      {
        name: 'Когти', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '2d4+2', average: 7, type: 'slashing',
        note: 'Если цель — существо, но не эльф и не нежить, она должна преуспеть в спасброске Телосложения со СЛ 10, иначе парализована на 1 минуту. Она повторяет спасбросок в конце каждого своего хода, при успехе эффект заканчивается.',
      },
    ],
  },
  {
    index: 'dire-wolf', name: 'Dire Wolf', nameRu: 'Лютоволк', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 14, acNote: 'природный доспех', hp: 37, hitDice: '5d10+10', speed: 50, abilities: [17, 15, 15, 3, 12, 7],
    skills: { perception: 3, stealth: 4 }, passive: 13, languages: '—', cr: 1,
    traits: [KEEN_HEARING_SMELL, PACK_TACTICS],
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '2d6+3', average: 10, type: 'piercing', note: PRONE_BITE(13) }],
  },
  {
    index: 'giant-spider', name: 'Giant Spider', nameRu: 'Гигантский паук', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 14, acNote: 'природный доспех', hp: 26, hitDice: '4d10+4', speed: 30, speedNote: 'лазая 30 фт.', abilities: [14, 16, 12, 2, 11, 4],
    skills: { stealth: 7 }, darkvision: 60, senses: 'слепое зрение 10 фт.', passive: 10, languages: '—', cr: 1,
    traits: [
      ['Паучье лазание', 'Лазает по сложным поверхностям, в том числе вниз головой по потолку, без проверок характеристик.'],
      ['Чувство паутины', 'Касаясь паутины, знает точное местоположение любого другого существа, касающегося той же паутины.'],
      ['Хождение по паутине', 'Игнорирует ограничения перемещения, вызванные паутиной.'],
    ],
    attacks: [
      {
        name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, damage: '1d8+3', average: 7, type: 'piercing',
        note: 'Цель совершает спасбросок Телосложения со СЛ 11, получая 9 (2d8) урона ядом при провале или половину при успехе. Если яд опускает хиты цели до 0, она стабилизирована, но отравлена на 1 час, даже восстановив хиты, и парализована, пока отравлена.',
      },
      {
        name: 'Паутина (перезарядка 5–6)', kind: 'ranged', ability: 'dexterity', toHit: 5, range: [30, 60], damage: null,
        note: 'Цель опутана паутиной. Действием опутанная цель может совершить проверку Силы со СЛ 12 и при успехе освободиться. У паутины КД 10, 5 хитов, уязвимость к огню и иммунитет к дробящему урону, яду и психической энергии.',
      },
    ],
  },
  {
    index: 'brown-bear', name: 'Brown Bear', nameRu: 'Бурый медведь', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 11, acNote: 'природный доспех', hp: 34, hitDice: '4d10+12', speed: 40, speedNote: 'лазая 30 фт.', abilities: [19, 10, 16, 2, 13, 7],
    skills: { perception: 3 }, passive: 13, languages: '—', cr: 1,
    traits: [KEEN_SMELL],
    multiattack: { count: 2, text: 'Совершает две атаки: одну укусом и одну когтями.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '1d8+4', average: 8, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d6+4', average: 11, type: 'slashing' },
    ],
  },
  {
    index: 'animated-armor', name: 'Animated Armor', nameRu: 'Оживлённые доспехи', size: 'medium', type: 'конструкт', alignment: 'без мировоззрения',
    ac: 18, acNote: 'природный доспех', hp: 33, hitDice: '6d8+6', speed: 25, abilities: [14, 11, 13, 1, 3, 1],
    immune: ['poison', 'psychic'], conditionImmunities: 'глухота, испуг, истощение, окаменение, ослепление, отравление, очарование, паралич',
    senses: 'слепое зрение 60 фт. (за его пределами слеп)', passive: 6, languages: '—', cr: 1,
    traits: [
      ['Уязвимость к антимагии', 'В области антимагического поля недееспособны. Под действием рассеивания магии должны преуспеть в спасброске Телосложения против СЛ заклинания, иначе теряют сознание на 1 минуту.'],
      ['Обманчивый вид', 'Пока доспехи неподвижны, их не отличить от обычных доспехов.'],
    ],
    multiattack: { count: 2, text: 'Совершают две рукопашные атаки.' },
    attacks: [{ name: 'Удар', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'bludgeoning' }],
  },
  {
    index: 'goblin-boss', name: 'Goblin Boss', nameRu: 'Гоблин-вожак', size: 'small', type: 'гуманоид (гоблиноид)', alignment: 'нейтрально-злой',
    ac: 17, acNote: 'кольчужная рубаха, щит', hp: 21, hitDice: '6d6', speed: 30, abilities: [10, 14, 10, 10, 8, 10],
    skills: { stealth: 6 }, darkvision: 60, passive: 9, languages: 'Общий, Гоблинский', cr: 1,
    traits: [NIMBLE_ESCAPE],
    multiattack: { count: 2, text: 'Совершает две атаки скимитаром; вторая — с помехой.' },
    attacks: [
      { name: 'Скимитар', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'slashing' },
      { name: 'Метательное копьё', kind: 'melee', ability: 'strength', toHit: 2, reach: 5, range: [30, 120], damage: '1d6', average: 3, type: 'piercing' },
    ],
    reactions: [['Перенаправление атаки', 'Когда видимое существо атакует вожака, он выбирает другого гоблина в пределах 5 фт. от себя: они меняются местами, и целью становится тот гоблин.']],
  },
  {
    index: 'spy', name: 'Spy', nameRu: 'Шпион', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое мировоззрение',
    ac: 12, hp: 27, hitDice: '6d8', speed: 30, abilities: [10, 15, 10, 12, 14, 16],
    skills: { deception: 5, insight: 4, investigation: 5, perception: 6, persuasion: 5, 'sleight-of-hand': 4, stealth: 4 },
    passive: 16, languages: 'любые два языка', cr: 1,
    traits: [
      ['Хитрое действие', 'В каждый свой ход может бонусным действием совершить Рывок, Отход или Засаду.'],
      ['Скрытая атака (1/ход)', 'Наносит дополнительно 7 (2d6) урона, попав атакой оружием, если совершал атаку с преимуществом или если в пределах 5 фт. от цели есть дееспособный союзник шпиона и атака не с помехой.'],
    ],
    multiattack: { count: 2, text: 'Совершает две рукопашные атаки.' },
    attacks: [
      { name: 'Короткий меч', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'piercing' },
      { name: 'Ручной арбалет', kind: 'ranged', ability: 'dexterity', toHit: 4, range: [30, 120], damage: '1d6+2', average: 5, type: 'piercing' },
    ],
  },
  {
    index: 'giant-eagle', name: 'Giant Eagle', nameRu: 'Гигантский орёл', size: 'large', type: 'зверь', alignment: 'нейтрально-добрый',
    ac: 13, hp: 26, hitDice: '4d10+4', speed: 10, speedNote: 'летая 80 фт.', abilities: [16, 17, 13, 8, 14, 10],
    skills: { perception: 4 }, passive: 14, languages: 'гигантских орлов; понимает Общий и Ауран, но не говорит на них', cr: 1,
    traits: [KEEN_SIGHT],
    multiattack: { count: 2, text: 'Совершает две атаки: одну клювом и одну когтями.' },
    attacks: [
      { name: 'Клюв', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, damage: '1d6+3', average: 6, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, damage: '2d6+3', average: 10, type: 'slashing' },
    ],
  },
  {
    index: 'giant-elk', name: 'Giant Elk', nameRu: 'Гигантский лось', size: 'huge', type: 'зверь', alignment: 'нейтрально-добрый',
    ac: 14, acNote: 'природный доспех', hp: 42, hitDice: '5d12+10', speed: 60, abilities: [19, 16, 14, 7, 14, 10],
    skills: { perception: 4 }, passive: 14, languages: 'гигантских лосей; понимает Общий, Эльфийский и Сильван, но не говорит на них', cr: 2,
    traits: [CHARGE('лось', 20, '2d6', 7, 14)],
    attacks: [
      { name: 'Таран', kind: 'melee', ability: 'strength', toHit: 6, reach: 10, damage: '2d6+4', average: 11, type: 'bludgeoning' },
      { name: 'Копыта', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '4d8+4', average: 22, type: 'bludgeoning', note: 'Только по лежащему существу.' },
    ],
  },
  {
    index: 'polar-bear', name: 'Polar Bear', nameRu: 'Белый медведь', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, acNote: 'природный доспех', hp: 42, hitDice: '5d10+15', speed: 40, speedNote: 'плавая 30 фт.', abilities: [20, 10, 16, 2, 13, 7],
    skills: { perception: 3 }, passive: 13, languages: '—', cr: 2,
    traits: [KEEN_SMELL],
    multiattack: { count: 2, text: 'Совершает две атаки: одну укусом и одну когтями.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '1d8+5', average: 9, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '2d6+5', average: 12, type: 'slashing' },
    ],
  },
  {
    index: 'saber-toothed-tiger', name: 'Saber-Toothed Tiger', nameRu: 'Саблезубый тигр', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 52, hitDice: '7d10+14', speed: 40, abilities: [18, 14, 15, 3, 12, 8],
    skills: { perception: 3, stealth: 6 }, passive: 13, languages: '—', cr: 2,
    traits: [
      KEEN_SMELL,
      ['Наскок', 'Если тигр переместился по прямой хотя бы на 20 фт. к существу и в тот же ход попал по нему когтями, цель должна преуспеть в спасброске Силы со СЛ 14, иначе сбита с ног. По сбитой с ног цели тигр может бонусным действием укусить.'],
    ],
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '1d10+5', average: 10, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d6+5', average: 12, type: 'slashing' },
    ],
  },
  {
    index: 'ogre', name: 'Ogre', nameRu: 'Огр', size: 'large', type: 'великан', alignment: 'хаотично-злой',
    ac: 11, acNote: 'шкурный доспех', hp: 59, hitDice: '7d10+21', speed: 40, abilities: [19, 8, 16, 5, 7, 7],
    darkvision: 60, passive: 8, languages: 'Общий, Великаний', cr: 2,
    attacks: [
      { name: 'Палица', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d8+4', average: 13, type: 'bludgeoning' },
      { name: 'Метательное копьё', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, range: [30, 120], damage: '2d6+4', average: 11, type: 'piercing' },
    ],
  },
  {
    index: 'bandit-captain', name: 'Bandit Captain', nameRu: 'Капитан бандитов', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое не-законное',
    ac: 15, acNote: 'проклёпанный кожаный доспех', hp: 65, hitDice: '10d8+20', speed: 30, abilities: [15, 16, 14, 14, 11, 14],
    saves: { strength: 4, dexterity: 5, wisdom: 2 }, skills: { athletics: 4, deception: 4 }, passive: 10, languages: 'любые два языка', cr: 2,
    multiattack: { count: 3, text: 'Совершает три рукопашные атаки: две скимитаром и одну кинжалом. Или две дальнобойные атаки кинжалами.' },
    attacks: [
      { name: 'Скимитар', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, damage: '1d6+3', average: 6, type: 'slashing' },
      { name: 'Кинжал', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, range: [20, 60], damage: '1d4+3', average: 5, type: 'piercing' },
    ],
    reactions: [PARRY(2)],
  },
  {
    index: 'cult-fanatic', name: 'Cult Fanatic', nameRu: 'Фанатик культа', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое не-доброе',
    ac: 13, acNote: 'кожаный доспех', hp: 33, hitDice: '6d8+6', speed: 30, abilities: [11, 14, 12, 10, 13, 14],
    skills: { deception: 4, persuasion: 4, religion: 2 }, passive: 11, languages: 'любой один язык (обычно Общий)', cr: 2,
    traits: [DARK_DEVOTION],
    multiattack: { count: 2, text: 'Совершает две рукопашные атаки.' },
    attacks: [{ name: 'Кинжал', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, range: [20, 60], damage: '1d4+2', average: 4, type: 'piercing' }],
    spellcasting: {
      ability: 'wisdom', slots: [4, 3],
      spells: ['light', 'sacred-flame', 'thaumaturgy', 'command', 'inflict-wounds', 'shield-of-faith', 'hold-person', 'spiritual-weapon'],
      text: 'Заклинатель 4-го уровня, базовая характеристика — Мудрость (СЛ спасброска 11, +3 к попаданию заклинаниями). Подготовлены заклинания жреца: заговоры — свет, священное пламя, чудотворство; 1-й круг (4 ячейки) — приказ, нанесение ран, щит веры; 2-й круг (3 ячейки) — удержание личности, божественное оружие.',
    },
  },
  {
    index: 'gelatinous-cube', name: 'Gelatinous Cube', nameRu: 'Желатиновый куб', size: 'large', type: 'слизь', alignment: 'без мировоззрения',
    ac: 6, hp: 84, hitDice: '8d10+40', speed: 15, abilities: [14, 3, 20, 1, 6, 1],
    conditionImmunities: 'глухота, испуг, истощение, ослепление, очарование, сбит с ног',
    senses: 'слепое зрение 60 фт. (за его пределами слеп)', passive: 8, languages: '—', cr: 2,
    traits: [
      ['Кубическая слизь', 'Заполняет всё своё пространство. Другие существа могут войти в него, но тогда их поглощает куб, и они совершают с помехой спасбросок Ловкости. Внутри куба видны существа и предметы. Внутри может быть одно существо Большого размера или до четырёх Среднего и меньше.'],
      ['Прозрачный', 'Даже на виду куб замечают проверкой Мудрости (Восприятие) со СЛ 15, если он не двигался и не атаковал. Существо, вошедшее в пространство куба, не зная о нём, застигнуто врасплох.'],
    ],
    attacks: [{ name: 'Ложноножка', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '3d6', average: 10, type: 'acid' }],
    actions: [['Поглощение', 'Куб перемещается на расстояние не больше своей скорости; при этом может входить в пространство Большого существа и меньше. Существо, в чьё пространство он вошёл, совершает спасбросок Ловкости со СЛ 12. При успехе может отступить на 5 фт. в сторону. При провале поглощено: получает 10 (3d6) урона кислотой, опутано, не может дышать и в начале каждого хода куба получает 21 (6d6) урона кислотой. Действием можно проверкой Силы со СЛ 12 вытащить существо или предмет из куба; вытащивший получает 10 (3d6) урона кислотой.']],
  },
  {
    index: 'ghast', name: 'Ghast', nameRu: 'Вурдалак', size: 'medium', type: 'нежить', alignment: 'хаотично-злой',
    ac: 13, hp: 36, hitDice: '8d8', speed: 30, abilities: [16, 17, 10, 11, 10, 8],
    resistant: ['necrotic'], immune: ['poison'], conditionImmunities: 'истощение, отравление, очарование',
    darkvision: 60, passive: 10, languages: 'Общий', cr: 2,
    traits: [
      ['Смрад', 'Существо, начавшее ход в пределах 5 фт. от вурдалака, совершает спасбросок Телосложения со СЛ 10, иначе отравлено до начала своего следующего хода. Преуспевшее невосприимчиво к смраду этого вурдалака 24 часа.'],
      ['Противостояние изгнанию', 'Вурдалак и упыри в пределах 30 фт. от него совершают с преимуществом спасброски от эффектов, изгоняющих нежить.'],
    ],
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 3, reach: 5, damage: '2d8+3', average: 12, type: 'piercing', quirk: true },
      {
        name: 'Когти', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, damage: '2d6+3', average: 10, type: 'slashing',
        note: 'Если цель — существо, но не нежить, она должна преуспеть в спасброске Телосложения со СЛ 10, иначе парализована на 1 минуту. Она повторяет спасбросок в конце каждого своего хода, при успехе эффект заканчивается.',
      },
    ],
  },
  {
    index: 'mimic', name: 'Mimic', nameRu: 'Мимик', size: 'medium', type: 'чудовище (перевёртыш)', alignment: 'нейтральный',
    ac: 12, acNote: 'природный доспех', hp: 58, hitDice: '9d8+18', speed: 15, abilities: [17, 12, 15, 5, 13, 8],
    skills: { stealth: 5 }, immune: ['acid'], conditionImmunities: 'сбит с ног', darkvision: 60, passive: 11, languages: '—', cr: 2,
    traits: [
      ['Перевёртыш', 'Действием принимает облик предмета или возвращается в свой. Характеристики в обоих обликах одинаковы. Снаряжение не превращается. После смерти возвращается в свой облик.'],
      ['Липкость (только в облике предмета)', 'Прилипает ко всему, что касается его. Существо Огромного размера и меньше, прилипшее к мимику, схвачено (СЛ высвобождения 13). Проверки на высвобождение — с помехой.'],
      ['Обманчивый вид (только в облике предмета)', 'Пока мимик неподвижен, его не отличить от обычного предмета.'],
      ['Хватка', 'Совершает с преимуществом броски атаки по существу, которое держит схваченным.'],
    ],
    attacks: [
      { name: 'Ложноножка', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d8+3', average: 7, type: 'bludgeoning', note: 'В облике предмета цель прилипает к мимику.' },
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d8+3', average: 7, type: 'piercing', extra: { damage: '1d8', average: 4, type: 'acid' } },
    ],
  },
  {
    index: 'berserker', name: 'Berserker', nameRu: 'Берсерк', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое хаотичное',
    ac: 13, acNote: 'шкурный доспех', hp: 67, hitDice: '9d8+27', speed: 30, abilities: [16, 12, 17, 9, 11, 9],
    passive: 10, languages: 'любой один язык (обычно Общий)', cr: 2,
    traits: [['Безрассудство', 'В начале своего хода может получить преимущество на все броски рукопашных атак оружием в этот ход, но до начала его следующего хода броски атак по нему тоже совершаются с преимуществом.']],
    attacks: [{ name: 'Секира', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d12+3', average: 9, type: 'slashing' }],
  },
  {
    index: 'owlbear', name: 'Owlbear', nameRu: 'Совомедведь', size: 'large', type: 'чудовище', alignment: 'без мировоззрения',
    ac: 13, acNote: 'природный доспех', hp: 59, hitDice: '7d10+21', speed: 40, abilities: [20, 12, 17, 3, 12, 7],
    skills: { perception: 3 }, darkvision: 60, passive: 13, languages: '—', cr: 3,
    traits: [['Тонкое зрение и нюх', 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на зрение или обоняние.']],
    multiattack: { count: 2, text: 'Совершает две атаки: одну клювом и одну когтями.' },
    attacks: [
      { name: 'Клюв', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '1d10+5', average: 10, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '2d8+5', average: 14, type: 'slashing' },
    ],
  },
  {
    index: 'minotaur', name: 'Minotaur', nameRu: 'Минотавр', size: 'large', type: 'чудовище', alignment: 'хаотично-злой',
    ac: 14, acNote: 'природный доспех', hp: 76, hitDice: '9d10+27', speed: 40, abilities: [18, 11, 16, 6, 16, 9],
    skills: { perception: 7 }, darkvision: 60, passive: 17, languages: 'Бездны', cr: 3,
    traits: [
      ['Натиск', 'Если минотавр переместился по прямой хотя бы на 10 фт. к цели и в тот же ход попал по ней рогами, цель получает дополнительно 9 (2d8) колющего урона. Если цель — существо, она должна преуспеть в спасброске Силы со СЛ 14, иначе отброшена на 10 фт. и сбита с ног.'],
      ['Память лабиринта', 'Всегда помнит любой путь, которым прошёл.'],
      ['Безрассудство', 'В начале своего хода может получить преимущество на все броски рукопашных атак оружием в этот ход, но до начала его следующего хода броски атак по нему тоже совершаются с преимуществом.'],
    ],
    attacks: [
      { name: 'Секира', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d12+4', average: 17, type: 'slashing' },
      { name: 'Рога', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d8+4', average: 13, type: 'piercing' },
    ],
  },
  {
    index: 'veteran', name: 'Veteran', nameRu: 'Ветеран', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое мировоззрение',
    ac: 17, acNote: 'наборный доспех', hp: 58, hitDice: '9d8+18', speed: 30, abilities: [16, 13, 14, 10, 11, 10],
    skills: { athletics: 5, perception: 2 }, passive: 12, languages: 'любой один язык (обычно Общий)', cr: 3,
    multiattack: { count: 3, text: 'Совершает две атаки длинным мечом. Если в руке короткий меч, может также атаковать им.' },
    attacks: [
      { name: 'Длинный меч', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d8+3', average: 7, type: 'slashing', versatile: '1d10+3' },
      { name: 'Короткий меч', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d6+3', average: 6, type: 'piercing' },
      { name: 'Тяжёлый арбалет', kind: 'ranged', ability: 'dexterity', toHit: 3, range: [100, 400], damage: '1d10+1', average: 6, type: 'piercing' },
    ],
  },
  {
    index: 'knight', name: 'Knight', nameRu: 'Рыцарь', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое мировоззрение',
    ac: 18, acNote: 'латы', hp: 52, hitDice: '8d8+16', speed: 30, abilities: [16, 11, 14, 11, 11, 15],
    saves: { constitution: 4, wisdom: 2 }, passive: 10, languages: 'любой один язык (обычно Общий)', cr: 3,
    traits: [['Храбрость', 'Совершает с преимуществом спасброски от испуга.']],
    multiattack: { count: 2, text: 'Совершает две рукопашные атаки.' },
    attacks: [
      { name: 'Двуручный меч', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '2d6+3', average: 10, type: 'slashing' },
      { name: 'Тяжёлый арбалет', kind: 'ranged', ability: 'dexterity', toHit: 2, range: [100, 400], damage: '1d10', average: 5, type: 'piercing' },
    ],
    actions: [['Лидерство (восстанавливается после короткого или долгого отдыха)', 'На 1 минуту рыцарь может особым приказом или предупреждением воодушевить невраждебных существ в пределах 30 фт., которые видят и слышат его: они добавляют к броскам атаки и спасброскам 1d4. Эффект заканчивается, если рыцарь недееспособен.']],
    reactions: [PARRY(2)],
  },
  {
    index: 'giant-scorpion', name: 'Giant Scorpion', nameRu: 'Гигантский скорпион', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 15, acNote: 'природный доспех', hp: 52, hitDice: '7d10+14', speed: 40, abilities: [15, 13, 15, 1, 9, 3],
    senses: 'слепое зрение 60 фт.', passive: 9, languages: '—', cr: 3,
    multiattack: { count: 3, text: 'Совершает три атаки: две клешнями и одну жалом.' },
    attacks: [
      { name: 'Клешня', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d8+2', average: 6, type: 'bludgeoning', note: 'Цель схвачена (СЛ высвобождения 12). У скорпиона две клешни, каждая держит одну цель.' },
      { name: 'Жало', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d10+2', average: 7, type: 'piercing', note: 'Цель совершает спасбросок Телосложения со СЛ 12, получая 22 (4d10) урона ядом при провале или половину при успехе.' },
    ],
  },
  {
    index: 'manticore', name: 'Manticore', nameRu: 'Мантикора', size: 'large', type: 'чудовище', alignment: 'законно-злой',
    ac: 14, acNote: 'природный доспех', hp: 68, hitDice: '8d10+24', speed: 30, speedNote: 'летая 50 фт.', abilities: [17, 16, 17, 7, 12, 8],
    darkvision: 60, passive: 11, languages: 'Общий', cr: 3,
    traits: [['Отрастающие шипы', 'В хвосте 24 шипа. Израсходованные отрастают за долгий отдых.']],
    multiattack: { count: 3, text: 'Совершает три атаки: одну укусом и две когтями, или три — хвостовыми шипами.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d8+3', average: 7, type: 'piercing' },
      { name: 'Коготь', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d6+3', average: 6, type: 'slashing' },
      { name: 'Хвостовой шип', kind: 'ranged', ability: 'dexterity', toHit: 5, range: [100, 200], damage: '1d8+3', average: 7, type: 'piercing' },
    ],
  },
  {
    index: 'red-dragon-wyrmling', name: 'Red Dragon Wyrmling', nameRu: 'Вирмлинг красного дракона', size: 'medium', type: 'дракон', alignment: 'хаотично-злой',
    ac: 17, acNote: 'природный доспех', hp: 75, hitDice: '10d8+30', speed: 30, speedNote: 'лазая 30 фт., летая 60 фт.', abilities: [19, 10, 17, 12, 11, 15],
    saves: { dexterity: 2, constitution: 5, wisdom: 2, charisma: 4 }, skills: { perception: 4, stealth: 2 },
    immune: ['fire'], darkvision: 60, senses: 'слепое зрение 10 фт.', passive: 14, languages: 'Драконий', cr: 4,
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '1d10+4', average: 9, type: 'piercing', extra: { damage: '1d6', average: 3, type: 'fire' } }],
    actions: [['Огненное дыхание (перезарядка 5–6)', 'Дракон выдыхает огонь 15-футовым конусом. Каждое существо в нём совершает спасбросок Ловкости со СЛ 13, получая 24 (7d6) урона огнём при провале или половину при успехе.']],
  },
  {
    index: 'ettin', name: 'Ettin', nameRu: 'Эттин', size: 'large', type: 'великан', alignment: 'хаотично-злой',
    ac: 12, acNote: 'природный доспех', hp: 85, hitDice: '10d10+30', speed: 40, abilities: [21, 8, 17, 6, 10, 8],
    skills: { perception: 4 }, darkvision: 60, passive: 14, languages: 'Великаний, Орочий', cr: 4,
    traits: [
      ['Две головы', 'Совершает с преимуществом проверки Мудрости (Восприятие) и спасброски от глухоты, испуга, оглушения, ослепления, очарования и потери сознания.'],
      ['Бдительный', 'Пока одна голова спит, другая бодрствует.'],
    ],
    multiattack: { count: 2, text: 'Совершает две атаки: одну боевым топором и одну моргенштерном.' },
    attacks: [
      { name: 'Боевой топор', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '2d8+5', average: 14, type: 'slashing' },
      { name: 'Моргенштерн', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '2d8+5', average: 14, type: 'piercing' },
    ],
  },
  {
    index: 'troll', name: 'Troll', nameRu: 'Тролль', size: 'large', type: 'великан', alignment: 'хаотично-злой',
    ac: 15, acNote: 'природный доспех', hp: 84, hitDice: '8d10+40', speed: 30, abilities: [18, 13, 20, 7, 9, 7],
    skills: { perception: 2 }, darkvision: 60, passive: 12, languages: 'Великаний', cr: 5,
    traits: [
      KEEN_SMELL,
      ['Регенерация', 'В начале своего хода восстанавливает 10 хитов. Если тролль получил урон кислотой или огнём, эта способность не действует в начале его следующего хода. Тролль умирает, только если начинает ход с 0 хитов и не регенерирует.'],
    ],
    multiattack: { count: 3, text: 'Совершает три атаки: одну укусом и две когтями.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '1d6+4', average: 7, type: 'piercing' },
      { name: 'Коготь', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '2d6+4', average: 11, type: 'slashing' },
    ],
  },
  {
    index: 'hill-giant', name: 'Hill Giant', nameRu: 'Холмовой великан', size: 'huge', type: 'великан', alignment: 'хаотично-злой',
    ac: 13, acNote: 'природный доспех', hp: 105, hitDice: '10d12+40', speed: 40, abilities: [21, 8, 19, 5, 9, 6],
    skills: { perception: 2 }, passive: 12, languages: 'Великаний', cr: 5,
    multiattack: { count: 2, text: 'Совершает две атаки палицей.' },
    attacks: [
      { name: 'Палица', kind: 'melee', ability: 'strength', toHit: 8, reach: 10, damage: '3d8+5', average: 18, type: 'bludgeoning' },
      { name: 'Камень', kind: 'ranged', ability: 'strength', toHit: 8, range: [60, 240], damage: '3d10+5', average: 21, type: 'bludgeoning' },
    ],
  },
  {
    index: 'gladiator', name: 'Gladiator', nameRu: 'Гладиатор', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое мировоззрение',
    ac: 16, acNote: 'проклёпанный кожаный доспех, щит', hp: 112, hitDice: '15d8+45', speed: 30, abilities: [18, 15, 16, 10, 12, 15],
    saves: { strength: 7, dexterity: 5, constitution: 6 }, skills: { athletics: 10, intimidation: 5 }, passive: 11, languages: 'любой один язык (обычно Общий)', cr: 5,
    traits: [
      ['Храбрость', 'Совершает с преимуществом спасброски от испуга.'],
      ['Громила', 'Рукопашное оружие наносит одну дополнительную кость урона (уже учтено в атаках).'],
    ],
    multiattack: { count: 3, text: 'Совершает три рукопашные атаки или две дальнобойные.' },
    attacks: [
      { name: 'Копьё', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, range: [20, 60], damage: '2d6+4', average: 11, type: 'piercing', versatile: '2d8+4' },
      { name: 'Удар щитом', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '2d4+4', average: 9, type: 'bludgeoning', note: 'Если цель — существо Среднего размера или меньше, она должна преуспеть в спасброске Силы со СЛ 15, иначе сбита с ног.' },
    ],
    reactions: [PARRY(3)],
  },
  {
    index: 'mage', name: 'Mage', nameRu: 'Маг', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое мировоззрение',
    ac: 12, acNote: '15 с доспехами мага', hp: 40, hitDice: '9d8', speed: 30, abilities: [9, 14, 11, 17, 12, 11],
    saves: { intelligence: 6, wisdom: 4 }, skills: { arcana: 6, history: 6 }, passive: 11, languages: 'любые четыре языка', cr: 6,
    attacks: [{ name: 'Кинжал', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, range: [20, 60], damage: '1d4+2', average: 4, type: 'piercing' }],
    spellcasting: {
      ability: 'intelligence', slots: [4, 3, 3, 3, 1],
      spells: [
        'fire-bolt', 'light', 'mage-hand', 'prestidigitation',
        'detect-magic', 'mage-armor', 'magic-missile', 'shield',
        'misty-step', 'suggestion',
        'counterspell', 'fireball', 'fly',
        'greater-invisibility', 'ice-storm',
        'cone-of-cold',
      ],
      text: 'Заклинатель 9-го уровня, базовая характеристика — Интеллект (СЛ спасброска 14, +6 к попаданию заклинаниями). Подготовлены заклинания волшебника: заговоры — огненный снаряд, свет, волшебная рука, фокусы; 1-й круг (4 ячейки) — обнаружение магии, доспехи мага, волшебная стрела, щит; 2-й (3) — туманный шаг, внушение; 3-й (3) — контрзаклинание, огненный шар, полёт; 4-й (3) — высшая невидимость, град; 5-й (1) — конус холода.',
    },
  },
  {
    index: 'wyvern', name: 'Wyvern', nameRu: 'Виверна', size: 'large', type: 'дракон', alignment: 'без мировоззрения',
    ac: 13, acNote: 'природный доспех', hp: 110, hitDice: '13d10+39', speed: 20, speedNote: 'летая 80 фт.', abilities: [19, 10, 16, 5, 12, 6],
    skills: { perception: 4 }, darkvision: 60, passive: 14, languages: '—', cr: 6,
    multiattack: { count: 2, text: 'Совершает две атаки: одну укусом и одну жалом. В полёте может вместо одной из них атаковать когтями.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 7, reach: 10, damage: '2d6+4', average: 11, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '2d8+4', average: 13, type: 'slashing' },
      { name: 'Жало', kind: 'melee', ability: 'strength', toHit: 7, reach: 10, damage: '2d6+4', average: 11, type: 'piercing', note: 'Цель совершает спасбросок Телосложения со СЛ 15, получая 24 (7d6) урона ядом при провале или половину при успехе.' },
    ],
  },
  {
    index: 'young-green-dragon', name: 'Young Green Dragon', nameRu: 'Молодой зелёный дракон', size: 'large', type: 'дракон', alignment: 'законно-злой',
    ac: 18, acNote: 'природный доспех', hp: 136, hitDice: '16d10+48', speed: 40, speedNote: 'летая 80 фт., плавая 40 фт.', abilities: [19, 12, 17, 16, 13, 15],
    saves: { dexterity: 4, constitution: 6, wisdom: 4, charisma: 5 }, skills: { deception: 5, perception: 7, stealth: 4 },
    immune: ['poison'], conditionImmunities: 'отравление', darkvision: 120, senses: 'слепое зрение 30 фт.', passive: 17, languages: 'Общий, Драконий', cr: 8,
    traits: [['Амфибия', 'Может дышать и воздухом, и водой.']],
    multiattack: { count: 3, text: 'Совершает три атаки: одну укусом и две когтями.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 7, reach: 10, damage: '2d10+4', average: 15, type: 'piercing', extra: { damage: '2d6', average: 7, type: 'poison' } },
      { name: 'Коготь', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '2d6+4', average: 11, type: 'slashing' },
    ],
    actions: [['Ядовитое дыхание (перезарядка 5–6)', 'Дракон выдыхает ядовитый газ 30-футовым конусом. Каждое существо в нём совершает спасбросок Телосложения со СЛ 14, получая 42 (12d6) урона ядом при провале или половину при успехе.']],
  },
  {
    index: 'young-red-dragon', name: 'Young Red Dragon', nameRu: 'Молодой красный дракон', size: 'large', type: 'дракон', alignment: 'хаотично-злой',
    ac: 18, acNote: 'природный доспех', hp: 178, hitDice: '17d10+85', speed: 40, speedNote: 'лазая 40 фт., летая 80 фт.', abilities: [23, 10, 21, 14, 11, 19],
    saves: { dexterity: 4, constitution: 9, wisdom: 4, charisma: 8 }, skills: { perception: 8, stealth: 4 },
    immune: ['fire'], darkvision: 120, senses: 'слепое зрение 30 фт.', passive: 18, languages: 'Общий, Драконий', cr: 10,
    multiattack: { count: 3, text: 'Совершает три атаки: одну укусом и две когтями.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 10, reach: 10, damage: '2d10+6', average: 17, type: 'piercing', extra: { damage: '1d6', average: 3, type: 'fire' } },
      { name: 'Коготь', kind: 'melee', ability: 'strength', toHit: 10, reach: 5, damage: '2d6+6', average: 13, type: 'slashing' },
    ],
    actions: [['Огненное дыхание (перезарядка 5–6)', 'Дракон выдыхает огонь 30-футовым конусом. Каждое существо в нём совершает спасбросок Ловкости со СЛ 17, получая 56 (16d6) урона огнём при провале или половину при успехе.']],
  },
];
