export type MonsterSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
export type MonsterAbility = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
export type MonsterDamageType =
  | 'acid' | 'bludgeoning' | 'cold' | 'fire' | 'force' | 'lightning' | 'necrotic'
  | 'piercing' | 'poison' | 'psychic' | 'radiant' | 'slashing' | 'thunder';

// «nonmagical» stands for bludgeoning, piercing and slashing damage from nonmagical attacks.
export type MonsterDefense = MonsterDamageType | 'nonmagical';

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
  resistant?: MonsterDefense[];
  immune?: MonsterDefense[];
  defenseNote?: string;
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
  legendary?: { actions: number; resistances?: number; options: Array<{ name: string; cost: number; text: string }> };
  spellcasting?: { ability: MonsterAbility; slots: number[]; spells: string[]; slotless?: string[]; text: string };
  modName?: string;
};

export const PACK_TACTICS: [string, string] = ['Тактика стаи', 'Совершает с преимуществом броски атаки по существу, если в пределах 5 фт. от этого существа находится хотя бы один дееспособный союзник.'];
export const KEEN_SMELL: [string, string] = ['Тонкий нюх', 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на обоняние.'];
export const KEEN_HEARING_SMELL: [string, string] = ['Тонкий слух и нюх', 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на слух или обоняние.'];
export const NIMBLE_ESCAPE: [string, string] = ['Ловкий побег', 'Может в каждый свой ход совершать бонусным действием Отход или Засаду (спрятаться).'];
export const SUNLIGHT_SENSITIVITY: [string, string] = ['Чувствительность к солнцу', 'На солнечном свету совершает с помехой броски атаки и проверки Мудрости (Восприятие), полагающиеся на зрение.'];
export const DARK_DEVOTION: [string, string] = ['Тёмная преданность', 'Совершает с преимуществом спасброски от очарования и испуга.'];
export const PARRY = (bonus: number): [string, string] => ['Парирование', `Добавляет +${bonus} к КД против одной рукопашной атаки, которая попала бы по нему. Для этого он должен видеть атакующего и держать рукопашное оружие.`];
export const UNDEAD_SPEECH = 'понимает языки, которые знал при жизни, но не говорит';
export const PRONE_BITE = (dc: number) => `Если цель — существо, она должна преуспеть в спасброске Силы со СЛ ${dc}, иначе сбита с ног.`;
export const KEEN_HEARING: [string, string] = ['Тонкий слух', 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на слух.'];
export const KEEN_SIGHT: [string, string] = ['Острое зрение', 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на зрение.'];
export const KEEN_HEARING_SIGHT: [string, string] = ['Тонкий слух и острое зрение', 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на слух или зрение.'];
export const AMPHIBIOUS: [string, string] = ['Амфибия', 'Может дышать и воздухом, и под водой.'];
export const WATER_BREATHING: [string, string] = ['Подводное дыхание', 'Может дышать только под водой.'];
export const CHARGE = (what: string, distance: number, extra: string, average: number, dc: number): [string, string] => [
  'Натиск', `Если ${what} переместился по прямой хотя бы на ${distance} фт. к цели и в тот же ход попал по ней тараном, цель получает дополнительно ${average} (${extra}) дробящего урона. Если цель — существо, она должна преуспеть в спасброске Силы со СЛ ${dc}, иначе сбита с ног.`,
];

export const MAGIC_RESISTANCE: [string, string] = ['Сопротивление магии', 'Совершает с преимуществом спасброски от заклинаний и других магических эффектов.'];
export const MAGIC_WEAPONS: [string, string] = ['Магическое оружие', 'Его атаки оружием магические.'];
export const LEGENDARY_RESISTANCE: [string, string] = ['Легендарное сопротивление (3/день)', 'Если проваливает спасбросок, может вместо этого преуспеть.'];
export const DEVILS_SIGHT: [string, string] = ['Дьявольское зрение', 'Магическая тьма не мешает его тёмному зрению.'];
export const SPIDER_CLIMB: [string, string] = ['Паучье лазание', 'Лазает по сложным поверхностям, в том числе вниз головой по потолку, без проверок характеристик.'];
export const WEB_SENSE: [string, string] = ['Чувство паутины', 'Касаясь паутины, знает точное местоположение любого другого существа, касающегося той же паутины.'];
export const WEB_WALKER: [string, string] = ['Хождение по паутине', 'Игнорирует ограничения перемещения, вызванные паутиной.'];
export const FLYBY: [string, string] = ['Пролёт', 'Вылетая из досягаемости врага, не провоцирует атак.'];
export const SURE_FOOTED: [string, string] = ['Устойчивый', 'Совершает с преимуществом спасброски Силы и Ловкости от эффектов, сбивающих с ног.'];
export const ECHOLOCATION: [string, string] = ['Эхолокация', 'Не может пользоваться слепым зрением, пока оглох.'];
export const FEY_ANCESTRY: [string, string] = ['Наследие фей', 'Совершает с преимуществом спасброски от очарования, и магия не может его усыпить.'];
export const KEEN_SIGHT_SMELL: [string, string] = ['Тонкое зрение и нюх', 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на зрение или обоняние.'];
export const KEEN_SENSES: [string, string] = ['Обострённые чувства', 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на зрение, слух или обоняние.'];
export const IMMUTABLE_FORM: [string, string] = ['Неизменный облик', 'Иммунитет к любым заклинаниям и эффектам, которые изменили бы его облик.'];
export const SIEGE_MONSTER: [string, string] = ['Осадное чудовище', 'Наносит двойной урон предметам и строениям.'];
export const AMORPHOUS: [string, string] = ['Аморфный', 'Проходит сквозь проёмы шириной всего 1 дюйм, не протискиваясь.'];
export const INCORPOREAL_MOVEMENT: [string, string] = [
  'Бестелесное перемещение', 'Проходит сквозь других существ и предметы, как по труднопроходимой местности. Если заканчивает ход внутри предмета, получает 5 (1d10) урона силовым полем.',
];
export const UNDEAD_FORTITUDE: [string, string] = [
  'Стойкость нежити', 'Если урон опускает хиты зомби до 0, он совершает спасбросок Телосложения со СЛ 5 + полученный урон, если только урон не излучением и не от критического попадания. При успехе у зомби остаётся 1 хит.',
];
export const STONE_CAMOUFLAGE: [string, string] = ['Каменный камуфляж', 'Совершает с преимуществом проверки Ловкости (Скрытность), чтобы спрятаться на каменистой местности.'];
