import type { ClassId } from '../character/classes.ts';

export type HeroAbility = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
export type Trait = [string, string];

export type Subrace = {
  id: string; nameRu: string; bonuses: Partial<Record<HeroAbility, number>>; traits: Trait[];
  hpPerLevel?: number; weapons?: string[]; wizardCantrip?: boolean; extraLanguage?: boolean;
};

export type Race = {
  id: string; nameRu: string; size: 'small' | 'medium'; speed: number;
  bonuses: Partial<Record<HeroAbility, number>>;
  flexibleBonuses?: number;
  darkvision?: number; resistances?: string[]; skills?: string[]; skillChoices?: number;
  weapons?: string[]; languages: string; traits: Trait[]; subraces: Subrace[];
  ancestry?: true;
  racialCantrip?: { index: string; ability: HeroAbility };
  custom?: true;
};

export const DRAGON_ANCESTRIES: Array<{ id: string; nameRu: string; damage: string; breath: string; save: HeroAbility }> = [
  { id: 'black', nameRu: 'Чёрный', damage: 'acid', breath: 'линия 5 × 30 фт.', save: 'dexterity' },
  { id: 'blue', nameRu: 'Синий', damage: 'lightning', breath: 'линия 5 × 30 фт.', save: 'dexterity' },
  { id: 'brass', nameRu: 'Латунный', damage: 'fire', breath: 'линия 5 × 30 фт.', save: 'dexterity' },
  { id: 'bronze', nameRu: 'Бронзовый', damage: 'lightning', breath: 'линия 5 × 30 фт.', save: 'dexterity' },
  { id: 'copper', nameRu: 'Медный', damage: 'acid', breath: 'линия 5 × 30 фт.', save: 'dexterity' },
  { id: 'gold', nameRu: 'Золотой', damage: 'fire', breath: 'конус 15 фт.', save: 'dexterity' },
  { id: 'green', nameRu: 'Зелёный', damage: 'poison', breath: 'конус 15 фт.', save: 'constitution' },
  { id: 'red', nameRu: 'Красный', damage: 'fire', breath: 'конус 15 фт.', save: 'dexterity' },
  { id: 'silver', nameRu: 'Серебряный', damage: 'cold', breath: 'конус 15 фт.', save: 'constitution' },
  { id: 'white', nameRu: 'Белый', damage: 'cold', breath: 'конус 15 фт.', save: 'constitution' },
];

const DARKVISION: Trait = ['Тёмное зрение', 'В тусклом свете в пределах 60 фт. видит как при ярком, в темноте — как при тусклом (только оттенки серого).'];
const FEY_ANCESTRY: Trait = ['Наследие фей', 'Преимущество на спасброски от очарования; магия не может усыпить.'];

export const SRD_RACES: Race[] = [
  {
    id: 'dwarf', nameRu: 'Дварф', size: 'medium', speed: 25, bonuses: { constitution: 2 }, darkvision: 60, resistances: ['poison'],
    weapons: ['battleaxe', 'handaxe', 'light-hammer', 'warhammer'], languages: 'Общий, Дварфский',
    traits: [
      DARKVISION,
      ['Дварфская стойкость', 'Преимущество на спасброски от яда, сопротивление урону ядом.'],
      ['Дварфская боевая тренировка', 'Владение боевым топором, ручным топором, лёгким и боевым молотами.'],
      ['Владение инструментами', 'Инструменты кузнеца, пивовара или каменщика — на выбор.'],
      ['Знание камня', 'Удвоенный бонус мастерства к проверкам Интеллекта (История), связанным с каменной кладкой.'],
      ['Скорость', 'Тяжёлые доспехи не снижают скорость.'],
    ],
    subraces: [{ id: 'hill', nameRu: 'Холмовой дварф', bonuses: { wisdom: 1 }, hpPerLevel: 1, traits: [['Дварфская выносливость', 'Максимум хитов больше на 1 за каждый уровень.']] }],
  },
  {
    id: 'elf', nameRu: 'Эльф', size: 'medium', speed: 30, bonuses: { dexterity: 2 }, darkvision: 60, skills: ['perception'], languages: 'Общий, Эльфийский',
    traits: [DARKVISION, ['Обострённые чувства', 'Владение навыком Внимательность.'], FEY_ANCESTRY, ['Транс', 'Вместо сна — 4 часа медитации.']],
    subraces: [{
      id: 'high', nameRu: 'Высший эльф', bonuses: { intelligence: 1 }, weapons: ['longsword', 'shortsword', 'shortbow', 'longbow'], wizardCantrip: true, extraLanguage: true,
      traits: [
        ['Эльфийская боевая тренировка', 'Владение длинным и коротким мечами, коротким и длинным луками.'],
        ['Заговор', 'Один заговор волшебника на выбор; базовая характеристика — Интеллект.'],
        ['Дополнительный язык', 'Ещё один язык на выбор.'],
      ],
    }],
  },
  {
    id: 'halfling', nameRu: 'Полурослик', size: 'small', speed: 25, bonuses: { dexterity: 2 }, languages: 'Общий, Язык полуросликов',
    traits: [
      ['Везучий', 'Выпала 1 на к20 при атаке, проверке или спасброске — перебросьте и используйте новый результат.'],
      ['Храбрый', 'Преимущество на спасброски от испуга.'],
      ['Проворство полуросликов', 'Может проходить сквозь пространство существа, которое хотя бы на размер больше.'],
    ],
    subraces: [{ id: 'lightfoot', nameRu: 'Легконогий полурослик', bonuses: { charisma: 1 }, traits: [['Естественная скрытность', 'Может пытаться спрятаться, даже когда его заслоняет лишь существо хотя бы на размер больше.']] }],
  },
  {
    id: 'human', nameRu: 'Человек', size: 'medium', speed: 30,
    bonuses: { strength: 1, dexterity: 1, constitution: 1, intelligence: 1, wisdom: 1, charisma: 1 }, languages: 'Общий и ещё один на выбор',
    traits: [['Разносторонность', '+1 ко всем характеристикам.']], subraces: [],
  },
  {
    id: 'dragonborn', nameRu: 'Драконорождённый', size: 'medium', speed: 30, bonuses: { strength: 2, charisma: 1 }, ancestry: true, languages: 'Общий, Драконий',
    traits: [
      ['Драконье происхождение', 'Тип дракона-предка задаёт оружие дыхания и сопротивление.'],
      ['Оружие дыхания', 'Действием: область по происхождению, спасбросок (СЛ 8 + модификатор Телосложения + бонус мастерства), 2к6 урона, при успехе — половина. Восстанавливается после короткого или долгого отдыха.'],
      ['Сопротивление урону', 'Сопротивление урону типа своего происхождения.'],
    ],
    subraces: [],
  },
  {
    id: 'gnome', nameRu: 'Гном', size: 'small', speed: 25, bonuses: { intelligence: 2 }, darkvision: 60, languages: 'Общий, Гномий',
    traits: [DARKVISION, ['Гномья хитрость', 'Преимущество на спасброски Интеллекта, Мудрости и Харизмы против магии.']],
    subraces: [{
      id: 'rock', nameRu: 'Скальный гном', bonuses: { constitution: 1 },
      traits: [
        ['Знания ремесленника', 'Удвоенный бонус мастерства к проверкам Интеллекта (История) о магических предметах, алхимии и технике.'],
        ['Жестянщик', 'Владение инструментами ремесленника; может мастерить крошечные механизмы.'],
      ],
    }],
  },
  {
    id: 'half-elf', nameRu: 'Полуэльф', size: 'medium', speed: 30, bonuses: { charisma: 2 }, flexibleBonuses: 2, darkvision: 60, skillChoices: 2,
    languages: 'Общий, Эльфийский и ещё один на выбор',
    traits: [DARKVISION, FEY_ANCESTRY, ['Универсальность навыков', 'Владение двумя навыками на выбор.'], ['Гибкость', '+1 к двум характеристикам на выбор, кроме Харизмы.']],
    subraces: [],
  },
  {
    id: 'half-orc', nameRu: 'Полуорк', size: 'medium', speed: 30, bonuses: { strength: 2, constitution: 1 }, darkvision: 60, skills: ['intimidation'], languages: 'Общий, Орочий',
    traits: [
      DARKVISION,
      ['Угрожающий вид', 'Владение навыком Запугивание.'],
      ['Неумолимая стойкость', 'Если хиты опускаются до 0, но вы не умерли, у вас остаётся 1 хит. Раз до долгого отдыха.'],
      ['Свирепые атаки', 'При критическом попадании рукопашным оружием — ещё одна кость урона оружия.'],
    ],
    subraces: [],
  },
  {
    id: 'tiefling', nameRu: 'Тифлинг', size: 'medium', speed: 30, bonuses: { charisma: 2, intelligence: 1 }, darkvision: 60, resistances: ['fire'], languages: 'Общий, Инфернальный',
    racialCantrip: { index: 'thaumaturgy', ability: 'charisma' },
    traits: [
      DARKVISION,
      ['Адское сопротивление', 'Сопротивление урону огнём.'],
      ['Дьявольское наследие', 'Знает заговор чудотворство; с 3-го уровня — адское возмездие, с 5-го — тьма (раз до долгого отдыха). Базовая характеристика — Харизма.'],
    ],
    subraces: [],
  },
  {
    id: 'custom', nameRu: 'Своя раса', size: 'medium', speed: 30, bonuses: {}, custom: true,
    languages: 'Общий и ещё один на выбор',
    traits: [['Своё происхождение', 'Раса не из SRD: название, черты и языки — по договорённости с мастером; +2 к одной характеристике и +1 к другой.']],
    subraces: [],
  },
];

export type WeaponGroup = 'simple' | 'martial';
export type ArmorGroup = 'light' | 'medium' | 'heavy' | 'shield';

export type Kit = {
  id: string; nameRu: string;
  weapons: string[];
  armor?: string;
  shield?: boolean;
  gear: string[];
  ammo?: { name: string; count: number; gear: string };
};

export type HeroClass = {
  id: ClassId;
  saves: HeroAbility[];
  skills: { count: number; from: string[] | 'any' };
  armor: ArmorGroup[];
  weapons: { groups: WeaponGroup[]; extra?: string[] };
  unarmored?: HeroAbility;
  caster?: { ability: HeroAbility; list: string; cantrips: number; spells: number | 'prepared' | 'spellbook' };
  subclass?: { nameRu: string; traits: Trait[]; heavyArmor?: true; alwaysPrepared?: string[]; hpPerLevel?: number; unarmoredBase?: number; ancestry?: true };
  fightingStyle?: true;
  expertise?: number;
  features: Trait[];
  resources: Array<{ name: string; max: (mods: Record<HeroAbility, number>) => number; recharge: 'short' | 'long' }>;
  kits: Kit[];
};

export const EXPLORER_PACK = ['backpack', 'bedroll', 'tinderbox', 'torch', 'rations-1-day', 'waterskin', 'rope-hempen-50-feet'];

export const SRD_CLASSES: HeroClass[] = [
  {
    id: 'barbarian', saves: ['strength', 'constitution'],
    skills: { count: 2, from: ['animal-handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'] },
    armor: ['light', 'medium', 'shield'], weapons: { groups: ['simple', 'martial'] }, unarmored: 'constitution',
    features: [
      ['Ярость', 'Бонусным действием на 1 минуту: преимущество на проверки и спасброски Силы, +2 к урону рукопашным оружием на Силе, сопротивление дробящему, колющему и рубящему урону. Дважды до долгого отдыха.'],
      ['Защита без доспехов', 'Без доспехов КД = 10 + модификатор Ловкости + модификатор Телосложения; щит можно.'],
    ],
    resources: [{ name: 'Ярость', max: () => 2, recharge: 'long' }],
    kits: [
      { id: 'greataxe', nameRu: 'Секира, ручной топор, метательные копья', weapons: ['greataxe', 'handaxe', 'javelin'], gear: [] },
      { id: 'battleaxe', nameRu: 'Боевой топор и щит, метательные копья', weapons: ['battleaxe', 'javelin'], shield: true, gear: [] },
    ],
  },
  {
    id: 'bard', saves: ['dexterity', 'charisma'], skills: { count: 3, from: 'any' }, armor: ['light'],
    weapons: { groups: ['simple'], extra: ['crossbow-hand', 'longsword', 'rapier', 'shortsword'] },
    caster: { ability: 'charisma', list: 'Bard', cantrips: 2, spells: 4 },
    features: [
      ['Использование заклинаний', 'Харизма; 2 заговора, 4 известных заклинания, 2 ячейки 1-го круга.'],
      ['Вдохновение барда', 'Бонусным действием даёт союзнику к6 к одной проверке, атаке или спасброску. Раз на модификатор Харизмы (не меньше раза) до долгого отдыха.'],
    ],
    resources: [{ name: 'Вдохновение барда', max: mods => Math.max(1, mods.charisma), recharge: 'long' }],
    kits: [
      { id: 'rapier', nameRu: 'Рапира, кинжал, кожаный доспех', weapons: ['rapier', 'dagger'], armor: 'leather-armor', gear: [] },
      { id: 'longsword', nameRu: 'Длинный меч, кинжал, кожаный доспех', weapons: ['longsword', 'dagger'], armor: 'leather-armor', gear: [] },
    ],
  },
  {
    id: 'cleric', saves: ['wisdom', 'charisma'], skills: { count: 2, from: ['history', 'insight', 'medicine', 'persuasion', 'religion'] },
    armor: ['light', 'medium', 'shield'], weapons: { groups: ['simple'] },
    caster: { ability: 'wisdom', list: 'Cleric', cantrips: 3, spells: 'prepared' },
    subclass: {
      nameRu: 'Домен Жизни', heavyArmor: true, alwaysPrepared: ['bless', 'cure-wounds'],
      traits: [
        ['Домен Жизни', 'Владение тяжёлыми доспехами. Благословение и лечение ран всегда подготовлены.'],
        ['Последователь жизни', 'Лечащее заклинание 1-го круга и выше восстанавливает ещё 2 + круг заклинания хитов.'],
      ],
    },
    features: [['Использование заклинаний', 'Мудрость; 3 заговора; готовит заклинаний: модификатор Мудрости + уровень; 2 ячейки 1-го круга.']],
    resources: [],
    kits: [
      { id: 'scale', nameRu: 'Булава, чешуйчатый доспех, щит, лёгкий арбалет', weapons: ['mace', 'crossbow-light'], armor: 'scale-mail', shield: true, gear: ['holy-symbol-amulet'], ammo: { name: 'Болты', count: 20, gear: 'crossbow-bolts-20' } },
      { id: 'chain', nameRu: 'Булава, кольчуга, щит', weapons: ['mace'], armor: 'chain-mail', shield: true, gear: ['holy-symbol-amulet'] },
    ],
  },
  {
    id: 'druid', saves: ['intelligence', 'wisdom'],
    skills: { count: 2, from: ['arcana', 'animal-handling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'] },
    armor: ['light', 'medium', 'shield'], weapons: { groups: [], extra: ['club', 'dagger', 'dart', 'javelin', 'mace', 'quarterstaff', 'scimitar', 'sickle', 'sling', 'spear'] },
    caster: { ability: 'wisdom', list: 'Druid', cantrips: 2, spells: 'prepared' },
    features: [
      ['Друидический', 'Тайный язык друидов.'],
      ['Использование заклинаний', 'Мудрость; 2 заговора; готовит заклинаний: модификатор Мудрости + уровень; 2 ячейки 1-го круга. Не носит металлических доспехов и щитов.'],
    ],
    resources: [],
    kits: [
      { id: 'scimitar', nameRu: 'Скимитар, деревянный щит, кожаный доспех', weapons: ['scimitar'], armor: 'leather-armor', shield: true, gear: ['druidic-focus-sprig'] },
      { id: 'staff', nameRu: 'Боевой посох, праща, кожаный доспех', weapons: ['quarterstaff', 'sling'], armor: 'leather-armor', gear: ['druidic-focus-sprig'], ammo: { name: 'Снаряды для пращи', count: 20, gear: 'sling-bullets-20' } },
    ],
  },
  {
    id: 'fighter', saves: ['strength', 'constitution'],
    skills: { count: 2, from: ['acrobatics', 'animal-handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'] },
    armor: ['light', 'medium', 'heavy', 'shield'], weapons: { groups: ['simple', 'martial'] }, fightingStyle: true,
    features: [['Второе дыхание', 'Бонусным действием восстанавливает 1к10 + уровень воина хитов. Раз до короткого отдыха.']],
    resources: [{ name: 'Второе дыхание', max: () => 1, recharge: 'short' }],
    kits: [
      { id: 'knight', nameRu: 'Кольчуга, длинный меч и щит, лёгкий арбалет', weapons: ['longsword', 'crossbow-light'], armor: 'chain-mail', shield: true, gear: [], ammo: { name: 'Болты', count: 20, gear: 'crossbow-bolts-20' } },
      { id: 'archer', nameRu: 'Кожаный доспех, длинный лук, два коротких меча', weapons: ['longbow', 'shortsword'], armor: 'leather-armor', gear: [], ammo: { name: 'Стрелы', count: 20, gear: 'arrows-20' } },
    ],
  },
  {
    id: 'monk', saves: ['strength', 'dexterity'], skills: { count: 2, from: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'] },
    armor: [], weapons: { groups: ['simple'], extra: ['shortsword'] }, unarmored: 'wisdom',
    features: [
      ['Защита без доспехов', 'Без доспехов и щита КД = 10 + модификатор Ловкости + модификатор Мудрости.'],
      ['Боевые искусства', 'Безоружный удар и монашеское оружие: Ловкость вместо Силы, урон к4; после атаки действием — безоружный удар бонусным действием.'],
    ],
    resources: [],
    kits: [
      { id: 'shortsword', nameRu: 'Короткий меч и дротики', weapons: ['shortsword', 'dart'], gear: [] },
      { id: 'spear', nameRu: 'Копьё и дротики', weapons: ['spear', 'dart'], gear: [] },
    ],
  },
  {
    id: 'paladin', saves: ['wisdom', 'charisma'], skills: { count: 2, from: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'] },
    armor: ['light', 'medium', 'heavy', 'shield'], weapons: { groups: ['simple', 'martial'] },
    features: [
      ['Божественное чувство', 'Действием чувствует небожителей, исчадий и нежить в 60 фт. Раз на 1 + модификатор Харизмы до долгого отдыха.'],
      ['Наложение рук', 'Запас лечения 5 × уровень паладина хитов до долгого отдыха; 5 хитов из запаса снимают болезнь или яд.'],
    ],
    resources: [
      { name: 'Божественное чувство', max: mods => Math.max(1, 1 + mods.charisma), recharge: 'long' },
      { name: 'Наложение рук', max: () => 5, recharge: 'long' },
    ],
    kits: [
      { id: 'sword', nameRu: 'Кольчуга, длинный меч и щит, метательные копья', weapons: ['longsword', 'javelin'], armor: 'chain-mail', shield: true, gear: ['holy-symbol-amulet'] },
      { id: 'greatsword', nameRu: 'Кольчуга, двуручный меч, метательные копья', weapons: ['greatsword', 'javelin'], armor: 'chain-mail', gear: ['holy-symbol-amulet'] },
    ],
  },
  {
    id: 'ranger', saves: ['strength', 'dexterity'],
    skills: { count: 3, from: ['animal-handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'] },
    armor: ['light', 'medium', 'shield'], weapons: { groups: ['simple', 'martial'] },
    features: [
      ['Избранный враг', 'Тип врагов на выбор: преимущество на проверки Мудрости (Выживание), чтобы их выследить, и Интеллекта — чтобы вспомнить о них; ещё один язык.'],
      ['Исследователь природы', 'Избранная местность: удвоенный бонус мастерства к проверкам Интеллекта и Мудрости о ней, отряд не сбивается с пути.'],
    ],
    resources: [],
    kits: [
      { id: 'scale', nameRu: 'Чешуйчатый доспех, два коротких меча, длинный лук', weapons: ['shortsword', 'longbow'], armor: 'scale-mail', gear: [], ammo: { name: 'Стрелы', count: 20, gear: 'arrows-20' } },
      { id: 'leather', nameRu: 'Кожаный доспех, короткий меч, длинный лук', weapons: ['shortsword', 'longbow'], armor: 'leather-armor', gear: [], ammo: { name: 'Стрелы', count: 20, gear: 'arrows-20' } },
    ],
  },
  {
    id: 'rogue', saves: ['dexterity', 'intelligence'],
    skills: { count: 4, from: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight-of-hand', 'stealth'] },
    armor: ['light'], weapons: { groups: ['simple'], extra: ['crossbow-hand', 'longsword', 'rapier', 'shortsword'] }, expertise: 2,
    features: [
      ['Компетентность', 'Удвоенный бонус мастерства к двум навыкам, которыми владеете.'],
      ['Скрытая атака', 'Раз в ход +1к6 урона по цели, если атака с преимуществом или рядом с целью ваш дееспособный союзник (фехтовальное или дальнобойное оружие).'],
      ['Воровской жаргон', 'Тайный язык и знаки плутов.'],
    ],
    resources: [],
    kits: [
      { id: 'rapier', nameRu: 'Рапира, короткий лук, кожаный доспех, кинжалы', weapons: ['rapier', 'shortbow', 'dagger'], armor: 'leather-armor', gear: ['thieves-tools'], ammo: { name: 'Стрелы', count: 20, gear: 'arrows-20' } },
      { id: 'shortsword', nameRu: 'Короткий меч, кинжалы, кожаный доспех', weapons: ['shortsword', 'dagger'], armor: 'leather-armor', gear: ['thieves-tools'] },
    ],
  },
  {
    id: 'sorcerer', saves: ['constitution', 'charisma'], skills: { count: 2, from: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'] },
    armor: [], weapons: { groups: [], extra: ['dagger', 'dart', 'sling', 'quarterstaff', 'crossbow-light'] },
    caster: { ability: 'charisma', list: 'Sorcerer', cantrips: 4, spells: 2 },
    subclass: {
      nameRu: 'Драконья кровь', hpPerLevel: 1, unarmoredBase: 13, ancestry: true,
      traits: [
        ['Драконий предок', 'Тип дракона-предка; знаете Драконий язык.'],
        ['Драконья устойчивость', 'Максимум хитов больше на 1 за уровень; без доспехов КД = 13 + модификатор Ловкости.'],
      ],
    },
    features: [['Использование заклинаний', 'Харизма; 4 заговора, 2 известных заклинания, 2 ячейки 1-го круга.']],
    resources: [],
    kits: [
      { id: 'crossbow', nameRu: 'Лёгкий арбалет, кинжалы, мешочек с компонентами', weapons: ['crossbow-light', 'dagger'], gear: ['component-pouch'], ammo: { name: 'Болты', count: 20, gear: 'crossbow-bolts-20' } },
      { id: 'staff', nameRu: 'Боевой посох, кинжалы, магическая фокусировка', weapons: ['quarterstaff', 'dagger'], gear: ['arcane-focus-crystal'] },
    ],
  },
  {
    id: 'warlock', saves: ['wisdom', 'charisma'],
    skills: { count: 2, from: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'] },
    armor: ['light'], weapons: { groups: ['simple'] },
    caster: { ability: 'charisma', list: 'Warlock', cantrips: 2, spells: 2 },
    subclass: {
      nameRu: 'Покровитель — Исчадие',
      traits: [['Тёмное благословение', 'Опустив хиты враждебного существа до 0, получаете временные хиты: модификатор Харизмы + уровень колдуна (не меньше 1).']],
    },
    features: [['Магия договора', 'Харизма; 2 заговора, 2 известных заклинания, 1 ячейка 1-го круга — восстанавливается после короткого отдыха.']],
    resources: [],
    kits: [
      { id: 'crossbow', nameRu: 'Лёгкий арбалет, кожаный доспех, кинжалы', weapons: ['crossbow-light', 'dagger'], armor: 'leather-armor', gear: ['component-pouch'], ammo: { name: 'Болты', count: 20, gear: 'crossbow-bolts-20' } },
      { id: 'staff', nameRu: 'Боевой посох, кожаный доспех, кинжалы', weapons: ['quarterstaff', 'dagger'], armor: 'leather-armor', gear: ['arcane-focus-crystal'] },
    ],
  },
  {
    id: 'wizard', saves: ['intelligence', 'wisdom'], skills: { count: 2, from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'] },
    armor: [], weapons: { groups: [], extra: ['dagger', 'dart', 'sling', 'quarterstaff', 'crossbow-light'] },
    caster: { ability: 'intelligence', list: 'Wizard', cantrips: 3, spells: 'spellbook' },
    features: [
      ['Использование заклинаний', 'Интеллект; 3 заговора, книга заклинаний с 6 заклинаниями 1-го круга; готовит модификатор Интеллекта + уровень; 2 ячейки 1-го круга.'],
      ['Арканное восстановление', 'Раз в день после короткого отдыха восстанавливает ячейки суммарного круга не выше половины уровня волшебника (с округлением вверх).'],
    ],
    resources: [{ name: 'Арканное восстановление', max: () => 1, recharge: 'long' }],
    kits: [
      { id: 'staff', nameRu: 'Боевой посох, книга заклинаний, мешочек с компонентами', weapons: ['quarterstaff'], gear: ['spellbook', 'component-pouch'] },
      { id: 'dagger', nameRu: 'Кинжал, книга заклинаний, магическая фокусировка', weapons: ['dagger'], gear: ['spellbook', 'arcane-focus-crystal'] },
    ],
  },
];

export const FIGHTING_STYLES: Array<{ id: string; nameRu: string; text: string }> = [
  { id: 'defense', nameRu: 'Оборона', text: 'В доспехах +1 к КД.' },
  { id: 'archery', nameRu: 'Стрельба', text: '+2 к броскам атаки дальнобойным оружием.' },
  { id: 'dueling', nameRu: 'Дуэлянт', text: '+2 к урону оружием в одной руке, если другая свободна.' },
  { id: 'great-weapon', nameRu: 'Сражение большим оружием', text: 'Двуручным или универсальным оружием в двух руках: выпавшие 1 и 2 на костях урона можно перебросить.' },
  { id: 'protection', nameRu: 'Защита', text: 'Со щитом реакцией создаёт помеху атаке по союзнику рядом.' },
  { id: 'two-weapon', nameRu: 'Сражение двумя оружиями', text: 'Атака вторым оружием добавляет модификатор характеристики к урону.' },
];

export type Background = { id: string; nameRu: string; skills: string[] | null; gp: number; gear: string[]; traits: Trait[]; languages?: number; tools?: string };

export const SRD_BACKGROUNDS: Background[] = [
  {
    id: 'acolyte', nameRu: 'Послушник', skills: ['insight', 'religion'], gp: 15, gear: ['holy-symbol-amulet', 'clothes-common'], languages: 2,
    traits: [
      ['Послушник', 'Служили в храме. Владение Проницательностью и Религией, два языка на выбор.'],
      ['Приют для верующих', 'Вы и спутники можете рассчитывать на бесплатное лечение и кров в храмах своей веры.'],
    ],
  },
  {
    id: 'soldier', nameRu: 'Солдат', skills: ['athletics', 'intimidation'], gp: 10, gear: ['clothes-common'], tools: 'игровой набор на выбор, сухопутный транспорт',
    traits: [
      ['Солдат', 'Годы в войске, ополчении или страже. Владение Атлетикой и Запугиванием.'],
      ['Походная выучка', 'Вы знаете, как устроены лагерь и караул: где стоят посты, у кого спросить приказ и как раздобыть паёк.'],
    ],
  },
  {
    id: 'sage', nameRu: 'Мудрец', skills: ['arcana', 'history'], gp: 10, gear: ['ink-1-ounce-bottle', 'paper-one-sheet', 'clothes-common'], languages: 2,
    traits: [
      ['Мудрец', 'Годы над книгами и свитками. Владение Магией и Историей, два языка на выбор.'],
      ['Книжная память', 'Если вы не знаете ответа, то обычно знаете, в какой библиотеке, архиве или у какого учёного его искать.'],
    ],
  },
  {
    id: 'criminal', nameRu: 'Преступник', skills: ['deception', 'stealth'], gp: 15, gear: ['crowbar', 'clothes-common'], tools: 'воровские инструменты, игровой набор на выбор',
    traits: [
      ['Преступник', 'Жили не в ладу с законом. Владение Обманом и Скрытностью.'],
      ['Тёмные знакомства', 'В любом большом городе вы найдёте скупщика, контрабандиста или того, кто без лишних вопросов передаст весточку.'],
    ],
  },
  {
    id: 'folk-hero', nameRu: 'Народный заступник', skills: ['animal-handling', 'survival'], gp: 10, gear: ['shovel', 'clothes-common'], tools: 'инструменты ремесленника на выбор, сухопутный транспорт',
    traits: [
      ['Народный заступник', 'Простой человек, однажды вставший за своих. Владение Уходом за животными и Выживанием.'],
      ['Слава в округе', 'В родных краях о вас рассказывают истории: простые люди охотнее верят вам и делятся слухами.'],
    ],
  },
  {
    id: 'noble', nameRu: 'Знатный', skills: ['history', 'persuasion'], gp: 25, gear: ['clothes-fine'], languages: 1, tools: 'игровой набор на выбор',
    traits: [
      ['Знатный', 'Род с гербом, землями и долгами. Владение Историей и Убеждением, один язык на выбор.'],
      ['Голубая кровь', 'Вас принимают при дворах и в домах знати, а слуги и стража говорят с вами почтительно.'],
    ],
  },
  {
    id: 'hermit', nameRu: 'Отшельник', skills: ['medicine', 'religion'], gp: 5, gear: ['herbalism-kit', 'blanket', 'clothes-common'], languages: 1, tools: 'набор травника',
    traits: [
      ['Отшельник', 'Долго жили вдали от людей. Владение Медициной и Религией, один язык на выбор.'],
      ['Тайна уединения', 'В уединении вам открылось нечто важное: истина, тайна или знамение. Что именно, решите с мастером.'],
    ],
  },
  {
    id: 'outlander', nameRu: 'Странник', skills: ['athletics', 'survival'], gp: 10, gear: ['hunting-trap', 'clothes-traveler'], languages: 1, tools: 'музыкальный инструмент на выбор',
    traits: [
      ['Странник', 'Выросли в глуши, вдали от городов. Владение Атлетикой и Выживанием, один язык на выбор.'],
      ['Чутьё дороги', 'Вы помните местность, по которой прошли, и в дикой земле обычно находите воду и пищу для себя и спутников.'],
    ],
  },
  {
    id: 'entertainer', nameRu: 'Артист', skills: ['acrobatics', 'performance'], gp: 15, gear: ['disguise-kit', 'clothes-fine'], tools: 'набор для грима, музыкальный инструмент на выбор',
    traits: [
      ['Артист', 'Сцена, площадь и таверна — ваш дом. Владение Акробатикой и Выступлением.'],
      ['Любимец публики', 'Где можно выступить, там вам найдутся ночлег и ужин за представление.'],
    ],
  },
  {
    id: 'artisan', nameRu: 'Ремесленник', skills: ['insight', 'persuasion'], gp: 15, gear: ['clothes-traveler'], languages: 1, tools: 'инструменты ремесленника на выбор',
    traits: [
      ['Ремесленник', 'Мастер своего дела и член цеха. Владение Проницательностью и Убеждением, один язык на выбор.'],
      ['Цеховые связи', 'Мастера вашего ремесла помогут советом, работой или кровом, а цех заступится за вас перед властями.'],
    ],
  },
  {
    id: 'sailor', nameRu: 'Моряк', skills: ['athletics', 'perception'], gp: 10, gear: ['rope-silk-50-feet', 'clothes-common'], tools: 'навигационные инструменты, водный транспорт',
    traits: [
      ['Моряк', 'Годы на палубе. Владение Атлетикой и Восприятием.'],
      ['Попутный корабль', 'Вы договоритесь о бесплатном месте на судне для себя и спутников — за работу на палубе.'],
    ],
  },
  {
    id: 'urchin', nameRu: 'Беспризорник', skills: ['sleight-of-hand', 'stealth'], gp: 10, gear: ['clothes-common'], tools: 'воровские инструменты, набор для грима',
    traits: [
      ['Беспризорник', 'Выросли на улице, сами по себе. Владение Ловкостью рук и Скрытностью.'],
      ['Городские тропы', 'Вы знаете проходы, крыши и дворы, по которым через город выходит вдвое быстрее.'],
    ],
  },
  {
    id: 'charlatan', nameRu: 'Шарлатан', skills: ['deception', 'sleight-of-hand'], gp: 15, gear: ['disguise-kit', 'clothes-fine'], tools: 'набор для грима',
    traits: [
      ['Шарлатан', 'Жили обманом и ловкостью. Владение Обманом и Ловкостью рук.'],
      ['Чужое имя', 'У вас есть второе имя с бумагами, знакомыми и прошлым. Его можно носить, пока никто не станет копать глубже.'],
    ],
  },
  {
    id: 'healer', nameRu: 'Лекарь', skills: ['medicine', 'insight'], gp: 10, gear: ['healers-kit', 'clothes-common'], tools: 'набор травника',
    traits: [
      ['Лекарь', 'Лечили людей в деревне, городе или при войске. Владение Медициной и Проницательностью.'],
      ['Благодарные пациенты', 'В знакомых краях всегда найдётся тот, кого вы выходили, — он приютит вас или поможет.'],
    ],
  },
  {
    id: 'investigator', nameRu: 'Следователь', skills: ['investigation', 'insight'], gp: 10, gear: ['lantern-hooded', 'clothes-common'], languages: 1,
    traits: [
      ['Следователь', 'Распутывали чужие тайны за плату или по долгу службы. Владение Анализом и Проницательностью, один язык на выбор.'],
      ['Свой в страже', 'Стражники и судейские охотно делятся с вами сведениями о делах и подозреваемых.'],
    ],
  },
  { id: 'custom', nameRu: 'Своя предыстория', skills: null, gp: 10, gear: ['clothes-common'], traits: [['Предыстория', 'Своя: два навыка на выбор, остальное — с мастером.']] },
];

export const ARMOR: Record<string, { group: ArmorGroup; base: number; dexCap: number | null }> = {
  'padded-armor': { group: 'light', base: 11, dexCap: null },
  'leather-armor': { group: 'light', base: 11, dexCap: null },
  'studded-leather-armor': { group: 'light', base: 12, dexCap: null },
  'hide-armor': { group: 'medium', base: 12, dexCap: 2 },
  'chain-shirt': { group: 'medium', base: 13, dexCap: 2 },
  'scale-mail': { group: 'medium', base: 14, dexCap: 2 },
  breastplate: { group: 'medium', base: 14, dexCap: 2 },
  'half-plate-armor': { group: 'medium', base: 15, dexCap: 2 },
  'ring-mail': { group: 'heavy', base: 14, dexCap: 0 },
  'chain-mail': { group: 'heavy', base: 16, dexCap: 0 },
  'splint-armor': { group: 'heavy', base: 17, dexCap: 0 },
  'plate-armor': { group: 'heavy', base: 18, dexCap: 0 },
};

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_BUDGET = 27;
