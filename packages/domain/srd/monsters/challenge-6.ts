import {
  DEVILS_SIGHT, FEY_ANCESTRY, MAGIC_RESISTANCE, MAGIC_WEAPONS, SPIDER_CLIMB, STONE_CAMOUFLAGE, SUNLIGHT_SENSITIVITY, WEB_WALKER,
  type SrdMonster,
} from './shared.ts';

export const MONSTERS_CHALLENGE_6: SrdMonster[] = [
  {
    index: 'assassin', name: 'Assassin', nameRu: 'Убийца', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое не-доброе',
    ac: 15, acNote: 'проклёпанный кожаный доспех', hp: 78, hitDice: '12d8+24', speed: 30, abilities: [11, 16, 14, 13, 11, 10],
    saves: { dexterity: 6, intelligence: 4 }, skills: { acrobatics: 6, deception: 3, perception: 3, stealth: 9 },
    resistant: ['poison'],
    passive: 13, languages: 'Воровской жаргон и любые два языка', cr: 8,
    traits: [
      ['Убийство', 'В свой первый ход совершает с преимуществом атаки по любому существу, которое ещё не действовало. Любое попадание по застигнутому врасплох существу — критическое.'],
      ['Увёртливость', 'Если эффект позволяет совершить спасбросок Ловкости, чтобы получить только половину урона, при успехе убийца не получает урона, а при провале получает половину.'],
      ['Скрытая атака (1/ход)', 'Наносит дополнительно 13 (4d6) урона, попав атакой оружием, если совершал атаку с преимуществом или если в пределах 5 фт. от цели есть дееспособный союзник убийцы, а атака не с помехой.'],
    ],
    multiattack: { count: 2, text: 'Совершает две атаки коротким мечом.' },
    attacks: [
      { name: 'Короткий меч', kind: 'melee', ability: 'dexterity', toHit: 6, reach: 5, damage: '1d6+3', average: 6, type: 'piercing', note: 'Цель совершает спасбросок Телосложения со СЛ 15, получая 24 (7d6) урона ядом при провале или половину при успехе.' },
      { name: 'Лёгкий арбалет', kind: 'ranged', ability: 'dexterity', toHit: 6, range: [80, 320], damage: '1d8+3', average: 7, type: 'piercing', note: 'Цель совершает спасбросок Телосложения со СЛ 15, получая 24 (7d6) урона ядом при провале или половину при успехе.' },
    ],
  },
  {
    index: 'chain-devil', name: 'Chain Devil', nameRu: 'Цепной дьявол', size: 'medium', type: 'исчадие (дьявол)', alignment: 'законно-злой',
    ac: 16, acNote: 'природный доспех', hp: 85, hitDice: '10d8+40', speed: 30, abilities: [18, 15, 18, 11, 12, 14],
    saves: { constitution: 7, wisdom: 4, charisma: 5 },
    resistant: ['cold', 'nonmagical'], immune: ['fire', 'poison'], defenseNote: 'Сопротивление: посеребрённое оружие пробивает.', conditionImmunities: 'отравление',
    darkvision: 120, passive: 11, languages: 'Инфернальный, телепатия 120 фт.', cr: 8,
    traits: [DEVILS_SIGHT, MAGIC_RESISTANCE],
    multiattack: { count: 2, text: 'Совершает две атаки цепями.' },
    attacks: [
      { name: 'Цепь', kind: 'melee', ability: 'strength', toHit: 8, reach: 10, damage: '2d6+4', average: 11, type: 'slashing', quirk: true, note: 'Цель схвачена (СЛ высвобождения 14), если дьявол уже никого не держит. Пока захват длится, цель опутана и получает 7 (2d6) колющего урона в начале каждого своего хода.' },
    ],
    actions: [
      ['Оживление цепей (перезаряжается после короткого или долгого отдыха)', 'До четырёх цепей, которые дьявол видит в пределах 60 фт. и которые никто не несёт и не носит, магически покрываются острыми шипами и оживают под его властью. Каждая оживлённая цепь — предмет с КД 20, 20 хитами, сопротивлением колющему урону и иммунитетом к психическому урону и урону звуком. Применяя в свой ход Мультиатаку, дьявол может каждой оживлённой цепью совершить одну дополнительную атаку цепью. Оживлённая цепь может держать одно существо, но тогда не атакует. Цепь снова становится неживой, если её хиты падают до 0 или если дьявол недееспособен или умирает.'],
    ],
    reactions: [
      ['Тревожащая маска', 'Когда видимое дьяволом существо начинает ход в пределах 30 фт. от него, дьявол может создать иллюзию, будто он выглядит как один из умерших близких этого существа или его заклятый враг. Если существо видит дьявола, оно должно преуспеть в спасброске Мудрости со СЛ 14, иначе испугано до конца своего хода.'],
    ],
  },
  {
    index: 'chimera', name: 'Chimera', nameRu: 'Химера', size: 'large', type: 'чудовище', alignment: 'хаотично-злой',
    ac: 14, acNote: 'природный доспех', hp: 114, hitDice: '12d10+48', speed: 30, speedNote: 'летая 60 фт.', abilities: [19, 11, 19, 3, 14, 10],
    skills: { perception: 8 },
    darkvision: 60, passive: 18, languages: 'понимает Драконий, но не говорит на нём', cr: 6,
    multiattack: { count: 3, text: 'Совершает три атаки: одну укусом, одну рогами и одну когтями. Когда доступно Огненное дыхание, может применить его вместо укуса или рогов.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '2d6+4', average: 11, type: 'piercing' },
      { name: 'Рога', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '1d12+4', average: 10, type: 'bludgeoning' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '2d6+4', average: 11, type: 'slashing' },
    ],
    actions: [
      ['Огненное дыхание (перезарядка 5–6)', 'Драконья голова выдыхает огонь 15-футовым конусом. Каждое существо в нём совершает спасбросок Ловкости со СЛ 15, получая 31 (7d8) урона огнём при провале или половину при успехе.'],
    ],
  },
  {
    index: 'cloaker', name: 'Cloaker', nameRu: 'Плащевик', size: 'large', type: 'аберрация', alignment: 'хаотично-нейтральный',
    ac: 14, acNote: 'природный доспех', hp: 78, hitDice: '12d10+12', speed: 10, speedNote: 'летая 40 фт.', abilities: [17, 15, 12, 13, 12, 14],
    skills: { stealth: 5 },
    darkvision: 60, passive: 11, languages: 'Глубинная речь, Подземный', cr: 8,
    traits: [
      ['Перенос урона', 'Пока прицеплен к существу, получает только половину нанесённого ему урона (с округлением вниз), а вторую половину получает это существо.'],
      ['Обманчивый вид', 'Пока плащевик неподвижен и не показывает брюхо, его не отличить от тёмного кожаного плаща.'],
      ['Чувствительность к свету', 'При ярком свете совершает с помехой броски атаки и проверки Мудрости (Восприятие), полагающиеся на зрение.'],
    ],
    multiattack: { count: 2, text: 'Совершает две атаки: одну укусом и одну хвостом.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d6+3', average: 10, type: 'piercing', note: 'Если цель Большого размера или меньше, плащевик прицепляется к ней. Если он атаковал с преимуществом, то прицепляется к голове: пока он так держится, цель ослеплена и не может дышать. Прицепившись, плащевик совершает эту атаку только против цели, но с преимуществом. Отцепиться сам он может, потратив 5 фт. перемещения. Любое существо, в том числе цель, может действием отцепить его успешной проверкой Силы со СЛ 16.' },
      { name: 'Хвост', kind: 'melee', ability: 'strength', toHit: 6, reach: 10, damage: '1d8+3', average: 7, type: 'slashing' },
    ],
    actions: [
      ['Стон', 'Каждое существо в пределах 60 фт., слышащее стон и не являющееся аберрацией, должно преуспеть в спасброске Мудрости со СЛ 13, иначе испугано до конца следующего хода плащевика. Преуспевшее существо 24 часа невосприимчиво к стону этого плащевика.'],
      ['Фантазмы (перезаряжается после короткого или долгого отдыха)', 'Если плащевик не на ярком свету, он магически создаёт три иллюзорные копии себя. Копии перемещаются вместе с ним и повторяют его действия, меняясь местами так, что нельзя понять, какой плащевик настоящий. На ярком свету копии исчезают. Пока есть хоть одна копия, существо, атакующее плащевика или накладывающее на него вредное заклинание, случайным броском определяет, попадает ли цель в него или в копию. Эта магия не действует на тех, кто не видит или полагается не на зрение. У копии КД и спасброски плащевика. Если атака попадает по копии или копия проваливает спасбросок от эффекта с уроном, она исчезает.'],
    ],
  },
  {
    index: 'drider', name: 'Drider', nameRu: 'Драйдер', size: 'large', type: 'чудовище', alignment: 'хаотично-злой',
    ac: 19, acNote: 'природный доспех', hp: 123, hitDice: '13d10+52', speed: 30, speedNote: 'лазая 30 фт.', abilities: [16, 16, 18, 13, 14, 12],
    skills: { perception: 5, stealth: 9 },
    darkvision: 120, passive: 15, languages: 'Эльфийский, Подземный', cr: 6,
    traits: [FEY_ANCESTRY, SPIDER_CLIMB, SUNLIGHT_SENSITIVITY, WEB_WALKER],
    multiattack: { count: 3, text: 'Совершает три атаки длинным мечом или три длинным луком. Одну из них может заменить атакой укусом.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '1d4', average: 2, type: 'piercing', extra: { damage: '2d8', average: 9, type: 'poison' } },
      { name: 'Длинный меч', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '1d8+3', average: 7, type: 'slashing', versatile: '1d10+3' },
      { name: 'Длинный лук', kind: 'ranged', ability: 'dexterity', toHit: 6, range: [150, 600], damage: '1d8+3', average: 7, type: 'piercing', extra: { damage: '1d8', average: 4, type: 'poison' } },
    ],
    spellcasting: {
      ability: 'wisdom', slots: [],
      spells: ['dancing-lights', 'darkness', 'faerie-fire'],
      slotless: ['dancing-lights', 'darkness', 'faerie-fire'],
      text: 'Врождённая базовая характеристика — Мудрость (СЛ спасброска 13). Может накладывать следующие заклинания, не нуждаясь в материальных компонентах: неограниченно — пляшущие огоньки; 1/день каждое — тьма, огонь фей.',
    },
  },
  {
    index: 'frost-giant', name: 'Frost Giant', nameRu: 'Ледяной великан', size: 'huge', type: 'великан', alignment: 'нейтрально-злой',
    ac: 15, acNote: 'лоскутный доспех', hp: 138, hitDice: '12d12+60', speed: 40, abilities: [23, 9, 21, 9, 10, 12],
    saves: { constitution: 8, wisdom: 3, charisma: 4 }, skills: { athletics: 9, perception: 3 },
    immune: ['cold'],
    passive: 13, languages: 'Великаний', cr: 8,
    multiattack: { count: 2, text: 'Совершает две атаки секирой.' },
    attacks: [
      { name: 'Секира', kind: 'melee', ability: 'strength', toHit: 9, reach: 10, damage: '3d12+6', average: 25, type: 'slashing' },
      { name: 'Камень', kind: 'ranged', ability: 'strength', toHit: 9, range: [60, 240], damage: '4d10+6', average: 28, type: 'bludgeoning' },
    ],
  },
  {
    index: 'giant-ape', name: 'Giant Ape', nameRu: 'Гигантская обезьяна', size: 'huge', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 157, hitDice: '15d12+60', speed: 40, speedNote: 'лазая 40 фт.', abilities: [23, 14, 18, 7, 12, 7],
    skills: { athletics: 9, perception: 4 },
    passive: 14, languages: '—', cr: 7,
    multiattack: { count: 2, text: 'Совершает две атаки кулаками.' },
    attacks: [
      { name: 'Кулак', kind: 'melee', ability: 'strength', toHit: 9, reach: 10, damage: '3d10+6', average: 22, type: 'bludgeoning' },
      { name: 'Камень', kind: 'ranged', ability: 'strength', toHit: 9, range: [50, 100], damage: '7d6+6', average: 30, type: 'bludgeoning' },
    ],
  },
  {
    index: 'hezrou', name: 'Hezrou', nameRu: 'Хезроу', size: 'large', type: 'исчадие (демон)', alignment: 'хаотично-злой',
    ac: 16, acNote: 'природный доспех', hp: 136, hitDice: '13d10+65', speed: 30, abilities: [19, 17, 20, 5, 12, 13],
    saves: { strength: 7, constitution: 8, wisdom: 4 },
    resistant: ['cold', 'fire', 'lightning', 'nonmagical'], immune: ['poison'], conditionImmunities: 'отравление',
    darkvision: 120, passive: 11, languages: 'Бездны, телепатия 120 фт.', cr: 8,
    traits: [
      MAGIC_RESISTANCE,
      ['Смрад', 'Существо, начинающее ход в пределах 10 фт. от хезроу, должно преуспеть в спасброске Телосложения со СЛ 14, иначе отравлено до начала своего следующего хода. Преуспевшее существо 24 часа невосприимчиво к смраду этого хезроу.'],
    ],
    multiattack: { count: 3, text: 'Совершает три атаки: одну укусом и две когтями.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '2d10+4', average: 15, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '2d6+4', average: 11, type: 'slashing' },
    ],
  },
  {
    index: 'hydra', name: 'Hydra', nameRu: 'Гидра', size: 'huge', type: 'чудовище', alignment: 'без мировоззрения',
    ac: 15, acNote: 'природный доспех', hp: 172, hitDice: '15d12+75', speed: 30, speedNote: 'плавая 30 фт.', abilities: [20, 12, 20, 2, 10, 7],
    skills: { perception: 6 },
    darkvision: 60, passive: 16, languages: '—', cr: 8,
    traits: [
      ['Задержка дыхания', 'Может задерживать дыхание на 1 час.'],
      ['Много голов', 'У гидры пять голов. Пока голов больше одной, она совершает с преимуществом спасброски от глухоты, испуга, оглушения, ослепления, очарования и потери сознания. Каждый раз, получая за один ход 25 урона или больше, гидра теряет одну голову; когда умирают все головы, умирает и она. В конце своего хода гидра отращивает по две головы за каждую погибшую с прошлого хода, если с прошлого хода не получала урон огнём, и восстанавливает 10 хитов за каждую отросшую голову.'],
      ['Бдительные головы', 'За каждую голову сверх первой получает дополнительную реакцию — только для атак при возможности.'],
      ['Бдительный', 'Пока гидра спит, хотя бы одна её голова бодрствует.'],
    ],
    multiattack: { count: 5, text: 'Совершает столько атак укусом, сколько у неё голов (в начале — пять).' },
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'strength', toHit: 8, reach: 10, damage: '1d10+5', average: 10, type: 'piercing' }],
  },
  {
    index: 'invisible-stalker', name: 'Invisible Stalker', nameRu: 'Невидимый охотник', size: 'medium', type: 'элементаль', alignment: 'нейтральный',
    ac: 14, hp: 104, hitDice: '16d8+32', speed: 50, speedNote: 'летая 50 фт. (парит)', abilities: [16, 19, 14, 10, 15, 11],
    skills: { perception: 8, stealth: 10 },
    resistant: ['nonmagical'], immune: ['poison'], conditionImmunities: 'бессознательность, захват, истощение, окаменение, опутанность, отравление, паралич, сбит с ног',
    darkvision: 60, passive: 18, languages: 'Ауран; понимает Общий, но не говорит на нём', cr: 6,
    traits: [
      ['Невидимость', 'Охотник невидим.'],
      ['Безупречный следопыт', 'Призвавший даёт охотнику добычу. Пока они на одном плане существования, охотник знает направление и расстояние до неё. Знает он и где находится призвавший.'],
    ],
    multiattack: { count: 2, text: 'Совершает две атаки ударом.' },
    attacks: [{ name: 'Удар', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d6+3', average: 10, type: 'bludgeoning' }],
  },
  {
    index: 'mammoth', name: 'Mammoth', nameRu: 'Мамонт', size: 'huge', type: 'зверь', alignment: 'без мировоззрения',
    ac: 13, acNote: 'природный доспех', hp: 126, hitDice: '11d12+55', speed: 40, abilities: [24, 9, 21, 3, 11, 6],
    passive: 10, languages: '—', cr: 6,
    traits: [
      ['Топчущий натиск', 'Если мамонт переместился по прямой хотя бы на 20 фт. к существу и в тот же ход попал по нему боданием, цель должна преуспеть в спасброске Силы со СЛ 18, иначе сбита с ног. По сбитой с ног цели мамонт может бонусным действием атаковать топотом.'],
    ],
    attacks: [
      { name: 'Бодание', kind: 'melee', ability: 'strength', toHit: 10, reach: 10, damage: '4d8+7', average: 25, type: 'piercing' },
      { name: 'Топот', kind: 'melee', ability: 'strength', toHit: 10, reach: 5, damage: '4d10+7', average: 29, type: 'bludgeoning' },
    ],
  },
  {
    index: 'medusa', name: 'Medusa', nameRu: 'Медуза', size: 'medium', type: 'чудовище', alignment: 'законно-злой',
    ac: 15, acNote: 'природный доспех', hp: 127, hitDice: '17d8+51', speed: 30, abilities: [10, 15, 16, 12, 13, 15],
    skills: { deception: 5, insight: 4, perception: 4, stealth: 5 },
    darkvision: 60, passive: 14, languages: 'Общий', cr: 6,
    traits: [
      ['Окаменяющий взгляд', 'Когда существо, видящее глаза медузы, начинает ход в пределах 30 фт. от неё, медуза может заставить его совершить спасбросок Телосложения со СЛ 14, если сама не недееспособна и видит существо. Если спасбросок провален на 5 и больше, существо мгновенно окаменевает. При обычном провале оно начинает превращаться в камень и опутано; в конце своего следующего хода оно повторяет спасбросок, окаменевая при провале или освобождаясь при успехе. Окаменение длится, пока существо не освободит заклинание высшее восстановление или другая магия. Если существо не застигнуто врасплох, оно может в начале хода отвести глаза и не делать спасбросок; тогда до начала своего следующего хода оно не видит медузу, а взглянув на неё раньше, сразу совершает спасбросок. Если медуза видит своё отражение на гладкой поверхности в пределах 30 фт. при ярком свете, проклятие обращает её взгляд на неё саму.'],
    ],
    multiattack: { count: 3, text: 'Совершает три рукопашные атаки: одну змеиными волосами и две коротким мечом. Или совершает две дальнобойные атаки длинным луком.' },
    attacks: [
      { name: 'Змеиные волосы', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, damage: '1d4+2', average: 4, type: 'piercing', extra: { damage: '4d6', average: 14, type: 'poison' } },
      { name: 'Короткий меч', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, damage: '1d6+2', average: 5, type: 'piercing' },
      { name: 'Длинный лук', kind: 'ranged', ability: 'dexterity', toHit: 5, range: [150, 600], damage: '1d8+2', average: 6, type: 'piercing', extra: { damage: '2d6', average: 7, type: 'poison' } },
    ],
  },
  {
    index: 'oni', name: 'Oni', nameRu: 'Они', size: 'large', type: 'великан', alignment: 'законно-злой',
    ac: 16, acNote: 'кольчуга', hp: 110, hitDice: '13d10+39', speed: 30, speedNote: 'летая 30 фт.', abilities: [19, 11, 16, 14, 12, 15],
    saves: { dexterity: 3, constitution: 6, wisdom: 4, charisma: 5 }, skills: { arcana: 5, deception: 8, perception: 4 },
    darkvision: 60, passive: 14, languages: 'Общий, Великаний', cr: 7,
    traits: [MAGIC_WEAPONS, ['Регенерация', 'В начале своего хода восстанавливает 10 хитов, если у него есть хотя бы 1 хит.']],
    multiattack: { count: 2, text: 'Совершает две атаки когтями или две атаки глефой.' },
    attacks: [
      { name: 'Коготь', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '1d8+4', average: 8, type: 'slashing', note: 'Только в облике они.' },
      { name: 'Глефа', kind: 'melee', ability: 'strength', toHit: 7, reach: 10, damage: '2d10+4', average: 15, type: 'slashing', note: 'Или 9 (1d10 + 4) рубящего урона в Маленьком или Среднем облике.' },
    ],
    actions: [
      ['Смена облика', 'Магически превращается в Маленького или Среднего гуманоида, в Большого великана или возвращается в свой истинный облик. Характеристики, кроме размера, во всех обликах одинаковы. Превращается только глефа: она уменьшается, чтобы ею можно было сражаться в облике гуманоида. После смерти они возвращается в истинный облик, а глефа — к обычному размеру.'],
    ],
    spellcasting: {
      ability: 'charisma', slots: [],
      spells: ['darkness', 'invisibility', 'charm-person', 'cone-of-cold', 'gaseous-form', 'sleep'],
      slotless: ['darkness', 'invisibility', 'charm-person', 'cone-of-cold', 'gaseous-form', 'sleep'],
      text: 'Врождённая базовая характеристика — Харизма (СЛ спасброска 13). Может накладывать следующие заклинания, не нуждаясь в материальных компонентах: неограниченно — тьма, невидимость; 1/день каждое — очарование личности, конус холода, газообразная форма, усыпление.',
    },
  },
  {
    index: 'shield-guardian', name: 'Shield Guardian', nameRu: 'Щитовой страж', size: 'large', type: 'конструкт', alignment: 'без мировоззрения',
    ac: 17, acNote: 'природный доспех', hp: 142, hitDice: '15d10+60', speed: 30, abilities: [18, 8, 18, 7, 10, 3],
    immune: ['poison'], conditionImmunities: 'испуг, истощение, отравление, очарование, паралич',
    darkvision: 60, senses: 'слепое зрение 10 фт.', passive: 10, languages: 'понимает приказы на любом языке, но не говорит', cr: 7,
    traits: [
      ['Связь', 'Страж магически связан с амулетом. Пока они на одном плане существования, носящий амулет может телепатически позвать стража к себе, а страж знает расстояние и направление до амулета. Если страж в пределах 60 фт. от носящего амулет, половина любого урона, который тот получает (с округлением вверх), переходит на стража.'],
      ['Регенерация', 'В начале своего хода восстанавливает 10 хитов, если у него есть хотя бы 1 хит.'],
      ['Хранение заклинания', 'Заклинатель, носящий амулет стража, может заставить стража хранить одно заклинание 4-го круга или ниже: для этого он накладывает заклинание на стража. Заклинание не действует, а хранится в страже. По приказу носящего амулет или в заранее оговорённой ситуации страж накладывает хранимое заклинание с параметрами, заданными исходным заклинателем, без компонентов. Когда заклинание наложено или сохранено новое, прежнее пропадает.'],
    ],
    multiattack: { count: 2, text: 'Совершает две атаки кулаками.' },
    attacks: [{ name: 'Кулак', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '2d6+4', average: 11, type: 'bludgeoning' }],
    reactions: [['Щит', 'Когда существо атакует носящего амулет стража, страж даёт ему бонус +2 к КД, если находится в пределах 5 фт. от него.']],
  },
  {
    index: 'spirit-naga', name: 'Spirit Naga', nameRu: 'Духовная нага', size: 'large', type: 'чудовище', alignment: 'хаотично-злой',
    ac: 15, acNote: 'природный доспех', hp: 75, hitDice: '10d10+20', speed: 40, abilities: [18, 17, 14, 16, 15, 16],
    saves: { dexterity: 6, constitution: 5, wisdom: 5, charisma: 6 },
    immune: ['poison'], conditionImmunities: 'отравление, очарование',
    darkvision: 60, passive: 12, languages: 'Бездны, Общий', cr: 8,
    traits: [['Омоложение', 'Умерев, нага через 1d6 дней оживает со всеми хитами. Помешать этому может только заклинание исполнение желаний.']],
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 7, reach: 10, damage: '1d6+4', average: 7, type: 'piercing', note: 'Цель совершает спасбросок Телосложения со СЛ 13, получая 31 (7d8) урона ядом при провале или половину при успехе.' },
    ],
    spellcasting: {
      ability: 'intelligence', slots: [4, 3, 3, 3, 2],
      spells: ['mage-hand', 'minor-illusion', 'ray-of-frost', 'charm-person', 'detect-magic', 'sleep', 'detect-thoughts', 'hold-person', 'lightning-bolt', 'water-breathing', 'blight', 'dimension-door', 'dominate-person'],
      text: 'Заклинатель 10-го уровня, базовая характеристика — Интеллект (СЛ спасброска 14, +6 к попаданию заклинаниями). Подготовлены заклинания волшебника: заговоры — волшебная рука, малая иллюзия, луч холода; 1-й круг (4 ячейки) — очарование личности, обнаружение магии, усыпление; 2-й круг (3 ячейки) — обнаружение мыслей, удержание личности; 3-й круг (3 ячейки) — молния, подводное дыхание; 4-й круг (3 ячейки) — усыхание, переносящая дверь; 5-й круг (2 ячейки) — подчинение личности.',
    },
  },
  {
    index: 'stone-giant', name: 'Stone Giant', nameRu: 'Каменный великан', size: 'huge', type: 'великан', alignment: 'нейтральный',
    ac: 17, acNote: 'природный доспех', hp: 126, hitDice: '11d12+55', speed: 40, abilities: [23, 15, 20, 10, 12, 9],
    saves: { dexterity: 5, constitution: 8, wisdom: 4 }, skills: { athletics: 12, perception: 4 },
    darkvision: 60, passive: 14, languages: 'Великаний', cr: 7,
    traits: [STONE_CAMOUFLAGE],
    multiattack: { count: 2, text: 'Совершает две атаки палицей.' },
    attacks: [
      { name: 'Палица', kind: 'melee', ability: 'strength', toHit: 9, reach: 15, damage: '3d8+6', average: 19, type: 'bludgeoning' },
      { name: 'Камень', kind: 'ranged', ability: 'strength', toHit: 9, range: [60, 240], damage: '4d10+6', average: 28, type: 'bludgeoning', note: 'Если цель — существо, она должна преуспеть в спасброске Силы со СЛ 17, иначе сбита с ног.' },
    ],
    reactions: [
      ['Ловля камней', 'Если в великана бросают камень или похожий предмет, он может успешным спасброском Ловкости со СЛ 10 поймать снаряд и не получить от него дробящего урона.'],
    ],
  },
  {
    index: 'tyrannosaurus-rex', name: 'Tyrannosaurus Rex', nameRu: 'Тираннозавр', size: 'huge', type: 'зверь', alignment: 'без мировоззрения',
    ac: 13, acNote: 'природный доспех', hp: 136, hitDice: '13d12+52', speed: 50, abilities: [25, 10, 19, 2, 12, 9],
    skills: { perception: 4 },
    passive: 14, languages: '—', cr: 8,
    multiattack: { count: 2, text: 'Совершает две атаки: одну укусом и одну хвостом. Обе по одной цели совершать не может.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 10, reach: 10, damage: '4d12+7', average: 33, type: 'piercing', note: 'Если цель — существо Среднего размера или меньше, она схвачена (СЛ высвобождения 17). Пока захват длится, цель опутана, а тираннозавр не может кусать другую цель.' },
      { name: 'Хвост', kind: 'melee', ability: 'strength', toHit: 10, reach: 10, damage: '3d8+7', average: 20, type: 'bludgeoning' },
    ],
  },
  {
    index: 'vrock', name: 'Vrock', nameRu: 'Врок', size: 'large', type: 'исчадие (демон)', alignment: 'хаотично-злой',
    ac: 15, acNote: 'природный доспех', hp: 104, hitDice: '11d10+44', speed: 40, speedNote: 'летая 60 фт.', abilities: [17, 15, 18, 8, 13, 8],
    saves: { dexterity: 5, wisdom: 4, charisma: 2 },
    resistant: ['cold', 'fire', 'lightning', 'nonmagical'], immune: ['poison'], conditionImmunities: 'отравление',
    darkvision: 120, passive: 11, languages: 'Бездны, телепатия 120 фт.', cr: 6,
    traits: [MAGIC_RESISTANCE],
    multiattack: { count: 2, text: 'Совершает две атаки: одну клювом и одну когтями.' },
    attacks: [
      { name: 'Клюв', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d6+3', average: 10, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d10+3', average: 14, type: 'slashing' },
    ],
    actions: [
      ['Споры (перезарядка 6)', 'Из врока расходится облако ядовитых спор радиусом 15 фт.; споры огибают углы. Каждое существо в этой области должно преуспеть в спасброске Телосложения со СЛ 14, иначе отравлено. Отравленная так цель получает 5 (1d10) урона ядом в начале каждого своего хода. Она повторяет спасбросок в конце каждого своего хода, заканчивая эффект при успехе. Эффект заканчивается и если вылить на цель флакон святой воды.'],
      ['Оглушающий визг (1/день)', 'Издаёт жуткий визг. Каждое существо в пределах 20 фт., слышащее его и не являющееся демоном, должно преуспеть в спасброске Телосложения со СЛ 14, иначе ошеломлено до конца следующего хода врока.'],
    ],
  },
];
