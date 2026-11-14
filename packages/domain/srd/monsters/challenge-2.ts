import {
  AMORPHOUS, AMPHIBIOUS, INCORPOREAL_MOVEMENT, KEEN_SIGHT, KEEN_SMELL, SPIDER_CLIMB, STONE_CAMOUFLAGE, UNDEAD_FORTITUDE,
  WATER_BREATHING, WEB_SENSE, WEB_WALKER, type SrdMonster,
} from './shared.ts';

export const MONSTERS_CHALLENGE_2: SrdMonster[] = [
  {
    index: 'ankheg', name: 'Ankheg', nameRu: 'Анхег', size: 'large', type: 'чудовище', alignment: 'без мировоззрения',
    ac: 14, acNote: 'природный доспех; 11, пока сбит с ног', hp: 39, hitDice: '6d10+6', speed: 30, speedNote: 'копая 10 фт.', abilities: [17, 11, 13, 1, 13, 6],
    darkvision: 60, senses: 'чувство вибрации 60 фт.', passive: 11, languages: '—', cr: 2,
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '2d6+3', average: 10, type: 'slashing', extra: { damage: '1d6', average: 3, type: 'acid' }, note: 'Если цель — существо Большого размера или меньше, она схвачена (СЛ высвобождения 13). Пока захват длится, анхег кусает только схваченное существо и делает это с преимуществом.' },
    ],
    actions: [
      ['Кислотный плевок (перезарядка 6)', 'Если никого не держит, плюёт кислотой линией длиной 30 фт. и шириной 5 фт. Каждое существо на линии совершает спасбросок Ловкости со СЛ 13, получая 10 (3d6) урона кислотой при провале или половину при успехе.'],
    ],
  },
  {
    index: 'awakened-tree', name: 'Awakened Tree', nameRu: 'Пробуждённое дерево', size: 'huge', type: 'растение', alignment: 'без мировоззрения',
    ac: 13, acNote: 'природный доспех', hp: 59, hitDice: '7d12+14', speed: 20, abilities: [19, 6, 15, 10, 10, 7],
    vulnerable: ['fire'], resistant: ['bludgeoning', 'piercing'],
    passive: 10, languages: 'один язык, известный его создателю', cr: 2,
    traits: [['Обманчивый вид', 'Пока дерево неподвижно, его не отличить от обычного дерева.']],
    attacks: [{ name: 'Удар', kind: 'melee', ability: 'strength', toHit: 6, reach: 10, damage: '3d6+4', average: 14, type: 'bludgeoning' }],
  },
  {
    index: 'azer', name: 'Azer', nameRu: 'Азер', size: 'medium', type: 'элементаль', alignment: 'законно-нейтральный',
    ac: 17, acNote: 'природный доспех, щит', hp: 39, hitDice: '6d8+12', speed: 30, abilities: [17, 12, 15, 12, 13, 10],
    saves: { constitution: 4 },
    immune: ['fire', 'poison'], conditionImmunities: 'отравление',
    passive: 11, languages: 'Игнан', cr: 2,
    traits: [
      ['Раскалённое тело', 'Существо, которое касается азера или попадает по нему рукопашной атакой, находясь в пределах 5 фт., получает 5 (1d10) урона огнём.'],
      ['Раскалённое оружие', 'Попадая металлическим рукопашным оружием, наносит дополнительно 3 (1d6) урона огнём (учтено в атаке).'],
      ['Свечение', 'Испускает яркий свет в радиусе 10 фт. и тусклый — ещё на 10 фт.'],
    ],
    attacks: [
      { name: 'Боевой молот', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d8+3', average: 7, type: 'bludgeoning', versatile: '1d10+3', extra: { damage: '1d6', average: 3, type: 'fire' } },
    ],
  },
  {
    index: 'centaur', name: 'Centaur', nameRu: 'Кентавр', size: 'large', type: 'чудовище', alignment: 'нейтрально-добрый',
    ac: 12, hp: 45, hitDice: '6d10+12', speed: 50, abilities: [18, 14, 14, 9, 13, 11],
    skills: { athletics: 6, perception: 3, survival: 3 },
    passive: 13, languages: 'Эльфийский, Сильван', cr: 2,
    traits: [
      ['Натиск', 'Если кентавр переместился по прямой хотя бы на 30 фт. к цели и в тот же ход попал по ней пикой, цель получает дополнительно 10 (3d6) колющего урона.'],
    ],
    multiattack: { count: 2, text: 'Совершает две атаки: одну пикой и одну копытами или две длинным луком.' },
    attacks: [
      { name: 'Пика', kind: 'melee', ability: 'strength', toHit: 6, reach: 10, damage: '1d10+4', average: 9, type: 'piercing' },
      { name: 'Копыта', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d6+4', average: 11, type: 'bludgeoning' },
      { name: 'Длинный лук', kind: 'ranged', ability: 'dexterity', toHit: 4, range: [150, 600], damage: '1d8+2', average: 6, type: 'piercing' },
    ],
  },
  {
    index: 'druid', name: 'Druid', nameRu: 'Друид', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое мировоззрение',
    ac: 11, acNote: '16 с дубовой корой', hp: 27, hitDice: '5d8+5', speed: 30, abilities: [10, 12, 13, 12, 15, 11],
    skills: { medicine: 4, nature: 3, perception: 4 },
    passive: 14, languages: 'Друидический и любые два языка', cr: 2,
    attacks: [
      { name: 'Боевой посох', kind: 'melee', ability: 'strength', toHit: 2, reach: 5, damage: '1d6', average: 3, type: 'bludgeoning', versatile: '1d8', note: 'Или 6 (1d8 + 2) дробящего урона под заклинанием «дубинка».' },
    ],
    spellcasting: {
      ability: 'wisdom', slots: [4, 3],
      spells: ['druidcraft', 'produce-flame', 'shillelagh', 'entangle', 'longstrider', 'speak-with-animals', 'thunderwave', 'animal-messenger', 'barkskin'],
      text: 'Заклинатель 4-го уровня, базовая характеристика — Мудрость (СЛ спасброска 12, +4 к попаданию заклинаниями). Подготовлены заклинания друида: заговоры — искусство друидов, сотворение пламени, дубинка; 1-й круг (4 ячейки) — опутывание, скороход, разговор с животными, волна грома; 2-й круг (3 ячейки) — почтовое животное, дубовая кора.',
    },
  },
  {
    index: 'ettercap', name: 'Ettercap', nameRu: 'Эттеркап', size: 'medium', type: 'чудовище', alignment: 'нейтрально-злой',
    ac: 13, acNote: 'природный доспех', hp: 44, hitDice: '8d8+8', speed: 30, speedNote: 'лазая 30 фт.', abilities: [14, 15, 13, 7, 12, 8],
    skills: { perception: 3, stealth: 4, survival: 3 },
    darkvision: 60, passive: 13, languages: '—', cr: 2,
    traits: [SPIDER_CLIMB, WEB_SENSE, WEB_WALKER],
    multiattack: { count: 2, text: 'Совершает две атаки: одну укусом и одну когтями.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d8+2', average: 6, type: 'piercing', extra: { damage: '1d8', average: 4, type: 'poison' }, note: 'Цель должна преуспеть в спасброске Телосложения со СЛ 11, иначе отравлена на 1 минуту. Она повторяет спасбросок в конце каждого своего хода, заканчивая эффект при успехе.' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '2d4+2', average: 7, type: 'slashing' },
      { name: 'Паутина (перезарядка 5–6)', kind: 'ranged', ability: 'dexterity', toHit: 4, range: [30, 60], damage: null, note: 'Существо опутано паутиной. Опутанное существо может действием совершить проверку Силы со СЛ 11, освобождаясь при успехе. Эффект заканчивается, если паутину уничтожить: у неё КД 10, 5 хитов, уязвимость к огню и иммунитет к дробящему урону.' },
    ],
  },
  {
    index: 'gargoyle', name: 'Gargoyle', nameRu: 'Горгулья', size: 'medium', type: 'элементаль', alignment: 'хаотично-злой',
    ac: 15, acNote: 'природный доспех', hp: 52, hitDice: '7d8+21', speed: 30, speedNote: 'летая 60 фт.', abilities: [15, 11, 16, 6, 11, 7],
    resistant: ['nonmagical'], immune: ['poison'], defenseNote: 'Сопротивление: адамантиновое оружие пробивает.', conditionImmunities: 'истощение, окаменение, отравление',
    darkvision: 60, passive: 10, languages: 'Терран', cr: 2,
    traits: [['Обманчивый вид', 'Пока горгулья неподвижна, её не отличить от неживой статуи.']],
    multiattack: { count: 2, text: 'Совершает две атаки: одну укусом и одну когтями.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'slashing' },
    ],
  },
  {
    index: 'giant-boar', name: 'Giant Boar', nameRu: 'Гигантский кабан', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, acNote: 'природный доспех', hp: 42, hitDice: '5d10+15', speed: 40, abilities: [17, 10, 16, 2, 7, 5],
    passive: 8, languages: '—', cr: 2,
    traits: [
      ['Натиск', 'Если кабан переместился по прямой хотя бы на 20 фт. к цели и в тот же ход попал по ней клыком, цель получает дополнительно 7 (2d6) рубящего урона. Если цель — существо, она должна преуспеть в спасброске Силы со СЛ 13, иначе сбита с ног.'],
      ['Неутомимый (перезаряжается после короткого или долгого отдыха)', 'Если кабан получает не больше 10 урона и это опустило бы его хиты до 0, вместо этого у него остаётся 1 хит.'],
    ],
    attacks: [{ name: 'Клык', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '2d6+3', average: 10, type: 'slashing' }],
  },
  {
    index: 'giant-constrictor-snake', name: 'Giant Constrictor Snake', nameRu: 'Гигантский удав', size: 'huge', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 60, hitDice: '8d12+8', speed: 30, speedNote: 'плавая 30 фт.', abilities: [19, 14, 12, 1, 10, 3],
    skills: { perception: 2 },
    senses: 'слепое зрение 10 фт.', passive: 12, languages: '—', cr: 2,
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 6, reach: 10, damage: '2d6+4', average: 11, type: 'piercing' },
      { name: 'Сдавливание', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d8+4', average: 13, type: 'bludgeoning', note: 'Цель схвачена (СЛ высвобождения 16). Пока захват длится, цель опутана, а удав не может сдавливать другую цель.' },
    ],
  },
  {
    index: 'gibbering-mouther', name: 'Gibbering Mouther', nameRu: 'Ревун', size: 'medium', type: 'аберрация', alignment: 'нейтральный',
    ac: 9, hp: 67, hitDice: '9d8+27', speed: 10, speedNote: 'плавая 10 фт.', abilities: [10, 8, 16, 3, 10, 6],
    conditionImmunities: 'сбит с ног',
    darkvision: 60, passive: 10, languages: '—', cr: 2,
    traits: [
      ['Чуждая земля', 'Земля в радиусе 10 фт. вокруг ревуна становится вязкой, как тесто, и труднопроходимой. Существо, начинающее ход в этой области, должно преуспеть в спасброске Силы со СЛ 10, иначе его скорость до начала его следующего хода равна 0.'],
      ['Бормотание', 'Пока ревун видит хоть одно существо и не недееспособен, он бессвязно бормочет. Каждое существо, начинающее ход в пределах 20 фт. от него и слышащее бормотание, совершает спасбросок Мудрости со СЛ 10. При провале оно до начала своего следующего хода не может совершать реакции и бросает d8, чтобы узнать, что делает в этот ход: 1–4 — ничего; 5–6 — не совершает ни действия, ни бонусного действия и тратит всё перемещение на движение в случайную сторону; 7–8 — атакует в ближнем бою случайное существо в пределах досягаемости или, если не может, ничего не делает.'],
    ],
    multiattack: { count: 2, text: 'Совершает одну атаку укусами и, если может, применяет Слепящий плевок.' },
    attacks: [
      { name: 'Укусы', kind: 'melee', ability: 'strength', toHit: 2, reach: 5, damage: '5d6', average: 17, type: 'piercing', note: 'Если цель Среднего размера или меньше, она должна преуспеть в спасброске Силы со СЛ 10, иначе сбита с ног. Если этот урон убивает цель, ревун её поглощает.' },
    ],
    actions: [
      ['Слепящий плевок (перезарядка 5–6)', 'Плюёт комком едкой слизи в видимую точку в пределах 15 фт. При ударе комок взрывается слепящей вспышкой. Каждое существо в пределах 5 фт. от вспышки должно преуспеть в спасброске Ловкости со СЛ 13, иначе ослеплено до конца следующего хода ревуна.'],
    ],
  },
  {
    index: 'grick', name: 'Grick', nameRu: 'Грик', size: 'medium', type: 'чудовище', alignment: 'нейтральный',
    ac: 14, acNote: 'природный доспех', hp: 27, hitDice: '6d8', speed: 30, speedNote: 'лазая 30 фт.', abilities: [14, 14, 11, 3, 14, 5],
    resistant: ['nonmagical'],
    darkvision: 60, passive: 12, languages: '—', cr: 2,
    traits: [STONE_CAMOUFLAGE],
    multiattack: { count: 2, text: 'Совершает одну атаку щупальцами. Если она попала, может атаковать клювом ту же цель.' },
    attacks: [
      { name: 'Щупальца', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '2d6+2', average: 9, type: 'slashing' },
      { name: 'Клюв', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'piercing' },
    ],
  },
  {
    index: 'griffon', name: 'Griffon', nameRu: 'Грифон', size: 'large', type: 'чудовище', alignment: 'без мировоззрения',
    ac: 12, hp: 59, hitDice: '7d10+21', speed: 30, speedNote: 'летая 80 фт.', abilities: [18, 15, 16, 2, 13, 8],
    skills: { perception: 5 },
    darkvision: 60, passive: 15, languages: '—', cr: 2,
    traits: [KEEN_SIGHT],
    multiattack: { count: 2, text: 'Совершает две атаки: одну клювом и одну когтями.' },
    attacks: [
      { name: 'Клюв', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '1d8+4', average: 8, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d6+4', average: 11, type: 'slashing' },
    ],
  },
  {
    index: 'hunter-shark', name: 'Hunter Shark', nameRu: 'Охотничья акула', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 45, hitDice: '6d10+12', speed: 0, speedNote: 'плавая 40 фт.', abilities: [18, 13, 15, 1, 10, 4],
    skills: { perception: 2 },
    darkvision: 30, passive: 12, languages: '—', cr: 2,
    traits: [['Кровавое бешенство', 'Совершает с преимуществом рукопашные атаки по существу, у которого меньше максимума хитов.'], WATER_BREATHING],
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d8+4', average: 13, type: 'piercing' }],
  },
  {
    index: 'merrow', name: 'Merrow', nameRu: 'Мерроу', size: 'large', type: 'чудовище', alignment: 'хаотично-злой',
    ac: 13, acNote: 'природный доспех', hp: 45, hitDice: '6d10+12', speed: 10, speedNote: 'плавая 40 фт.', abilities: [18, 10, 15, 8, 10, 9],
    darkvision: 60, passive: 10, languages: 'Бездны, Акван', cr: 2,
    traits: [AMPHIBIOUS],
    multiattack: { count: 2, text: 'Совершает две атаки: одну укусом и одну когтями или гарпуном.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '1d8+4', average: 8, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d4+4', average: 9, type: 'slashing' },
      { name: 'Гарпун', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, range: [20, 60], damage: '2d6+4', average: 11, type: 'piercing', note: 'Если цель — существо Огромного размера или меньше, она должна выиграть состязание Силы с мерроу, иначе её подтягивает к мерроу на расстояние до 20 фт.' },
    ],
  },
  {
    index: 'minotaur-skeleton', name: 'Minotaur Skeleton', nameRu: 'Скелет минотавра', size: 'large', type: 'нежить', alignment: 'законно-злой',
    ac: 12, acNote: 'природный доспех', hp: 67, hitDice: '9d10+18', speed: 40, abilities: [18, 11, 15, 6, 8, 5],
    vulnerable: ['bludgeoning'], immune: ['poison'], conditionImmunities: 'истощение, отравление',
    darkvision: 60, passive: 9, languages: 'понимает язык Бездны, но не говорит на нём', cr: 2,
    traits: [
      ['Натиск', 'Если скелет переместился по прямой хотя бы на 10 фт. к цели и в тот же ход попал по ней боданием, цель получает дополнительно 9 (2d8) колющего урона. Если цель — существо, она должна преуспеть в спасброске Силы со СЛ 14, иначе её отталкивает на расстояние до 10 фт. и сбивает с ног.'],
    ],
    attacks: [
      { name: 'Секира', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d12+4', average: 17, type: 'slashing' },
      { name: 'Бодание', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d8+4', average: 13, type: 'piercing' },
    ],
  },
  {
    index: 'ochre-jelly', name: 'Ochre Jelly', nameRu: 'Охряная слизь', size: 'large', type: 'слизь', alignment: 'без мировоззрения',
    ac: 8, hp: 45, hitDice: '6d10+12', speed: 10, speedNote: 'лазая 10 фт.', abilities: [15, 6, 14, 2, 6, 1],
    resistant: ['acid'], immune: ['lightning', 'slashing'], conditionImmunities: 'испуг, истощение, ослепление, очарование, сбит с ног',
    senses: 'слепое зрение 60 фт. (за его пределами слеп)', passive: 8, languages: '—', cr: 2,
    traits: [AMORPHOUS, SPIDER_CLIMB],
    attacks: [
      { name: 'Ложноножка', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '2d6+2', average: 9, type: 'bludgeoning', extra: { damage: '1d6', average: 3, type: 'acid' } },
    ],
    reactions: [
      ['Разделение', 'Когда слизь Среднего размера или крупнее получает урон электричеством или рубящий урон, а хитов у неё не меньше 10, она делится на две новые. У каждой половина хитов исходной (с округлением вниз), и каждая на размер меньше исходной.'],
    ],
  },
  {
    index: 'ogre-zombie', name: 'Ogre Zombie', nameRu: 'Зомби-огр', size: 'large', type: 'нежить', alignment: 'нейтрально-злой',
    ac: 8, hp: 85, hitDice: '9d10+36', speed: 30, abilities: [19, 6, 18, 3, 6, 5],
    saves: { wisdom: 0 },
    immune: ['poison'], conditionImmunities: 'отравление',
    darkvision: 60, passive: 8, languages: 'понимает Общий и Великаний, но не говорит', cr: 2,
    traits: [UNDEAD_FORTITUDE],
    attacks: [
      { name: 'Моргенштерн', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d8+4', average: 13, type: 'bludgeoning' },
    ],
  },
  {
    index: 'pegasus', name: 'Pegasus', nameRu: 'Пегас', size: 'large', type: 'небожитель', alignment: 'хаотично-добрый',
    ac: 12, hp: 59, hitDice: '7d10+21', speed: 60, speedNote: 'летая 90 фт.', abilities: [18, 15, 16, 10, 15, 13],
    saves: { dexterity: 4, wisdom: 4, charisma: 3 }, skills: { perception: 6 },
    passive: 16, languages: 'понимает Небесный, Общий, Эльфийский и Сильван, но не говорит', cr: 2,
    attacks: [{ name: 'Копыта', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d6+4', average: 11, type: 'bludgeoning' }],
  },
  {
    index: 'plesiosaurus', name: 'Plesiosaurus', nameRu: 'Плезиозавр', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 13, acNote: 'природный доспех', hp: 68, hitDice: '8d10+24', speed: 20, speedNote: 'плавая 40 фт.', abilities: [18, 15, 16, 2, 12, 5],
    skills: { perception: 3, stealth: 4 },
    passive: 13, languages: '—', cr: 2,
    traits: [['Задержка дыхания', 'Может задерживать дыхание на 1 час.']],
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'strength', toHit: 6, reach: 10, damage: '3d6+4', average: 14, type: 'piercing' }],
  },
  {
    index: 'priest', name: 'Priest', nameRu: 'Священник', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое мировоззрение',
    ac: 13, acNote: 'кольчужная рубаха', hp: 27, hitDice: '5d8+5', speed: 25, abilities: [10, 10, 12, 13, 16, 13],
    skills: { medicine: 7, persuasion: 3, religion: 3 },
    passive: 13, languages: 'любые два языка', cr: 2,
    traits: [
      ['Божественное превосходство', 'Бонусным действием может потратить ячейку заклинаний, чтобы до конца хода его рукопашные атаки оружием при попадании магически наносили дополнительно 10 (3d6) урона излучением. За ячейку 2-го круга и выше урон растёт на 1d6 за каждый круг выше 1-го.'],
    ],
    attacks: [{ name: 'Булава', kind: 'melee', ability: 'strength', toHit: 2, reach: 5, damage: '1d6', average: 3, type: 'bludgeoning' }],
    spellcasting: {
      ability: 'wisdom', slots: [4, 3, 2],
      spells: ['light', 'sacred-flame', 'thaumaturgy', 'cure-wounds', 'guiding-bolt', 'sanctuary', 'lesser-restoration', 'spiritual-weapon', 'dispel-magic', 'spirit-guardians'],
      text: 'Заклинатель 5-го уровня, базовая характеристика — Мудрость (СЛ спасброска 13, +5 к попаданию заклинаниями). Подготовлены заклинания жреца: заговоры — свет, священное пламя, чудотворство; 1-й круг (4 ячейки) — лечение ран, направляющий снаряд, убежище; 2-й круг (3 ячейки) — малое восстановление, божественное оружие; 3-й круг (2 ячейки) — рассеивание магии, духовные стражи.',
    },
  },
  {
    index: 'rhinoceros', name: 'Rhinoceros', nameRu: 'Носорог', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 11, acNote: 'природный доспех', hp: 45, hitDice: '6d10+12', speed: 40, abilities: [21, 8, 15, 2, 12, 6],
    passive: 11, languages: '—', cr: 2,
    traits: [
      ['Натиск', 'Если носорог переместился по прямой хотя бы на 20 фт. к цели и в тот же ход попал по ней боданием, цель получает дополнительно 9 (2d8) дробящего урона. Если цель — существо, она должна преуспеть в спасброске Силы со СЛ 15, иначе сбита с ног.'],
    ],
    attacks: [{ name: 'Бодание', kind: 'melee', ability: 'strength', toHit: 7, reach: 5, damage: '2d8+5', average: 14, type: 'bludgeoning' }],
  },
  {
    index: 'rug-of-smothering', name: 'Rug of Smothering', nameRu: 'Удушающий ковёр', size: 'large', type: 'конструкт', alignment: 'без мировоззрения',
    ac: 12, hp: 33, hitDice: '6d10', speed: 10, abilities: [17, 14, 10, 1, 3, 1],
    immune: ['poison', 'psychic'], conditionImmunities: 'испуг, окаменение, ослепление, отравление, очарование, паралич',
    senses: 'слепое зрение 60 фт. (за его пределами слеп)', passive: 6, languages: '—', cr: 2,
    traits: [
      ['Уязвимость к антимагии', 'В области антимагического поля недееспособен. Под действием рассеивания магии должен преуспеть в спасброске Телосложения против СЛ заклинания, иначе теряет сознание на 1 минуту.'],
      ['Перенос урона', 'Пока держит существо схваченным, получает только половину нанесённого ему урона, а вторую половину получает схваченное существо.'],
      ['Обманчивый вид', 'Пока ковёр неподвижен, его не отличить от обычного ковра.'],
    ],
    attacks: [
      { name: 'Удушение', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: null, note: 'Существо схвачено (СЛ высвобождения 13). Пока захват длится, цель опутана, ослеплена и может задохнуться, а ковёр не может душить другую цель. Кроме того, в начале каждого хода цели она получает 10 (2d6 + 3) дробящего урона.' },
    ],
  },
  {
    index: 'sea-hag', name: 'Sea Hag', nameRu: 'Морская карга', size: 'medium', type: 'фея', alignment: 'хаотично-злой',
    ac: 14, acNote: 'природный доспех', hp: 52, hitDice: '7d8+21', speed: 30, speedNote: 'плавая 40 фт.', abilities: [16, 13, 16, 12, 12, 13],
    darkvision: 60, passive: 11, languages: 'Акван, Общий, Великаний', cr: 2,
    traits: [
      AMPHIBIOUS,
      ['Ужасающий облик', 'Гуманоид, начинающий ход в пределах 30 фт. от карги и видящий её истинный облик, совершает спасбросок Мудрости со СЛ 11; при провале он испуган на 1 минуту. Существо повторяет спасбросок в конце каждого своего хода — с помехой, если видит каргу, — заканчивая эффект при успехе. После успеха или конца эффекта существо 24 часа невосприимчиво к Ужасающему облику этой карги. Если цель не застигнута врасплох и облик открылся не внезапно, она может отвести глаза и не делать первый спасбросок; тогда до начала своего следующего хода она совершает с помехой атаки по карге.'],
    ],
    attacks: [{ name: 'Когти', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '2d6+3', average: 10, type: 'slashing' }],
    actions: [
      ['Смертельный взгляд', 'Выбирает испуганное существо, которое видит в пределах 30 фт. Если цель видит каргу, она должна преуспеть в спасброске Мудрости со СЛ 11 от этой магии, иначе её хиты падают до 0.'],
      ['Иллюзорный облик', 'Окутывает себя и всё, что несёт и носит, магической иллюзией: выглядит уродливым существом своего роста и человеческого сложения. Эффект заканчивается, если карга бонусным действием снимет его или умрёт. Иллюзия не выдерживает ощупывания: карга может казаться без когтей, но коснувшийся её руки их почувствует. Иначе распознать маскировку можно, действием осмотрев иллюзию и преуспев в проверке Интеллекта (Анализ) со СЛ 16.'],
    ],
  },
  {
    index: 'swarm-of-poisonous-snakes', name: 'Swarm of Poisonous Snakes', nameRu: 'Рой ядовитых змей', size: 'medium', type: 'рой Крошечных зверей', alignment: 'без мировоззрения',
    ac: 14, hp: 36, hitDice: '8d8', speed: 30, speedNote: 'плавая 30 фт.', abilities: [8, 18, 11, 1, 10, 3],
    resistant: ['bludgeoning', 'piercing', 'slashing'], conditionImmunities: 'захват, испуг, окаменение, опутанность, очарование, ошеломление, паралич, сбит с ног',
    senses: 'слепое зрение 10 фт.', passive: 10, languages: '—', cr: 2,
    traits: [
      ['Рой', 'Может занимать пространство другого существа и наоборот и проходит сквозь любой проём, достаточный для Крошечной змеи. Не может восстанавливать хиты и получать временные хиты.'],
    ],
    attacks: [
      { name: 'Укусы', kind: 'melee', ability: 'dexterity', toHit: 6, reach: 0, damage: '2d6', average: 7, type: 'piercing', note: 'Или 3 (1d6) колющего урона, если у роя осталась половина хитов или меньше. Цель совершает спасбросок Телосложения со СЛ 10, получая 14 (4d6) урона ядом при провале или половину при успехе.' },
    ],
  },
  {
    index: 'wererat-human', name: 'Wererat, Human Form', nameRu: 'Веркрыса (облик человека)', size: 'medium', type: 'гуманоид (человек)', alignment: 'законно-злой',
    ac: 12, hp: 33, hitDice: '6d8+6', speed: 30, abilities: [10, 15, 12, 11, 10, 8],
    skills: { perception: 2, stealth: 4 },
    immune: ['nonmagical'], defenseNote: 'Иммунитет: посеребрённое оружие пробивает.',
    passive: 12, languages: 'Общий', cr: 2,
    traits: [
      ['Перевёртыш', 'Действием превращается в гибрид крысы и человека или в гигантскую крысу либо возвращается в свой истинный облик гуманоида. Характеристики, кроме размера, во всех обликах одинаковы. Снаряжение не превращается. После смерти возвращается в истинный облик.'],
      KEEN_SMELL,
    ],
    multiattack: { count: 2, text: 'Совершает две атаки коротким мечом или две ручным арбалетом.' },
    attacks: [
      { name: 'Короткий меч', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'piercing' },
      { name: 'Ручной арбалет', kind: 'ranged', ability: 'dexterity', toHit: 4, range: [30, 120], damage: '1d6+2', average: 5, type: 'piercing' },
    ],
  },
  {
    index: 'wererat-hybrid', name: 'Wererat, Hybrid Form', nameRu: 'Веркрыса (гибрид)', size: 'medium', type: 'гуманоид (человек)', alignment: 'законно-злой',
    ac: 12, acNote: 'природный доспех', hp: 33, hitDice: '6d8+6', speed: 30, abilities: [10, 15, 12, 11, 10, 8],
    skills: { perception: 2, stealth: 4 },
    immune: ['nonmagical'], defenseNote: 'Иммунитет: посеребрённое оружие пробивает.',
    passive: 12, languages: 'Общий', cr: 2,
    traits: [
      ['Перевёртыш', 'Действием превращается в гибрид крысы и человека или в гигантскую крысу либо возвращается в свой истинный облик гуманоида. Характеристики, кроме размера, во всех обликах одинаковы. Снаряжение не превращается. После смерти возвращается в истинный облик.'],
      KEEN_SMELL,
    ],
    multiattack: { count: 2, text: 'Совершает две атаки: одну укусом и одну коротким мечом или две коротким мечом.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d4+2', average: 4, type: 'piercing', note: 'Если цель — гуманоид, она должна преуспеть в спасброске Телосложения со СЛ 11, иначе проклята ликантропией веркрысы.' },
      { name: 'Короткий меч', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'piercing' },
      { name: 'Ручной арбалет', kind: 'ranged', ability: 'dexterity', toHit: 4, range: [30, 120], damage: '1d6+2', average: 5, type: 'piercing' },
    ],
  },
  {
    index: 'wererat-rat', name: 'Wererat, Rat Form', nameRu: 'Веркрыса (облик крысы)', size: 'medium', type: 'гуманоид (человек)', alignment: 'законно-злой',
    ac: 12, acNote: 'природный доспех', hp: 33, hitDice: '6d8+6', speed: 30, abilities: [10, 15, 12, 11, 10, 8],
    skills: { perception: 2, stealth: 4 },
    immune: ['nonmagical'], defenseNote: 'Иммунитет: посеребрённое оружие пробивает.',
    darkvision: 60, passive: 12, languages: '—', cr: 2,
    traits: [
      ['Перевёртыш', 'Действием превращается в гибрид крысы и человека или в гигантскую крысу либо возвращается в свой истинный облик гуманоида. Характеристики, кроме размера, во всех обликах одинаковы. Снаряжение не превращается. После смерти возвращается в истинный облик.'],
      KEEN_SMELL,
    ],
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d4+2', average: 4, type: 'piercing', note: 'Если цель — гуманоид, она должна преуспеть в спасброске Телосложения со СЛ 11, иначе проклята ликантропией веркрысы.' },
    ],
  },
  {
    index: 'will-o-wisp', name: 'Will-o\'-Wisp', nameRu: 'Блуждающий огонёк', size: 'tiny', type: 'нежить', alignment: 'хаотично-злой',
    ac: 19, hp: 22, hitDice: '9d4', speed: 0, speedNote: 'летая 50 фт. (парит)', abilities: [1, 28, 10, 13, 14, 11],
    resistant: ['acid', 'cold', 'fire', 'necrotic', 'thunder', 'nonmagical'], immune: ['lightning', 'poison'], conditionImmunities: 'бессознательность, захват, истощение, опутанность, отравление, паралич, сбит с ног',
    darkvision: 120, passive: 12, languages: 'языки, которые знал при жизни', cr: 2,
    traits: [
      ['Поглощение жизни', 'Бонусным действием выбирает видимое существо в пределах 5 фт., у которого 0 хитов, но оно ещё живо. Цель должна преуспеть в спасброске Телосложения со СЛ 10 от этой магии, иначе умирает. Если она умирает, огонёк восстанавливает 10 (3d6) хитов.'],
      ['Эфемерный', 'Не может ничего носить и нести.'],
      INCORPOREAL_MOVEMENT,
      ['Переменное свечение', 'Испускает яркий свет в радиусе от 5 до 20 фт. и тусклый — ещё на столько же. Бонусным действием меняет радиус.'],
    ],
    attacks: [
      { name: 'Разряд', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '2d8', average: 9, type: 'lightning', quirk: true },
    ],
    actions: [
      ['Невидимость', 'Огонёк вместе со своим светом магически становится невидимым, пока не атакует, не применит Поглощение жизни или пока не прервётся его концентрация (как на заклинании).'],
    ],
  },
];
