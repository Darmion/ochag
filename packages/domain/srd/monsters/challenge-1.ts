import {
  AMORPHOUS, AMPHIBIOUS, DEVILS_SIGHT, ECHOLOCATION, INCORPOREAL_MOVEMENT, KEEN_SIGHT, KEEN_SIGHT_SMELL, KEEN_SMELL, MAGIC_RESISTANCE,
  PACK_TACTICS, SPIDER_CLIMB, STONE_CAMOUFLAGE, SUNLIGHT_SENSITIVITY, SURE_FOOTED, WATER_BREATHING, WEB_SENSE, WEB_WALKER, CHARGE,
  type SrdMonster,
} from './shared.ts';

export const MONSTERS_CHALLENGE_1: SrdMonster[] = [
  {
    index: 'cockatrice', name: 'Cockatrice', nameRu: 'Кокатрис', size: 'small', type: 'чудовище', alignment: 'без мировоззрения',
    ac: 11, hp: 27, hitDice: '6d6+6', speed: 20, speedNote: 'летая 40 фт.', abilities: [6, 12, 12, 2, 13, 5],
    darkvision: 60, passive: 11, languages: '—', cr: 0.5,
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'dexterity', toHit: 3, reach: 5, damage: '1d4+1', average: 3, type: 'piercing', note: 'Цель должна преуспеть в спасброске Телосложения со СЛ 11 от магического окаменения. При провале она начинает превращаться в камень и опутана; в конце своего следующего хода она повторяет спасбросок. При успехе эффект заканчивается, при провале цель окаменевает на 24 часа.' },
    ],
  },
  {
    index: 'darkmantle', name: 'Darkmantle', nameRu: 'Тёмная мантия', size: 'small', type: 'чудовище', alignment: 'без мировоззрения',
    ac: 11, hp: 22, hitDice: '5d6+5', speed: 10, speedNote: 'летая 30 фт.', abilities: [16, 12, 13, 2, 10, 5],
    skills: { stealth: 3 },
    senses: 'слепое зрение 60 фт.', passive: 10, languages: '—', cr: 0.5,
    traits: [ECHOLOCATION, ['Обманчивый вид', 'Пока мантия неподвижна, её не отличить от сталактита, сталагмита или другого каменного нароста пещеры.']],
    attacks: [
      { name: 'Сокрушение', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d6+3', average: 6, type: 'bludgeoning', note: 'Мантия прицепляется к цели. Если цель Среднего размера или меньше, а мантия атаковала с преимуществом, она обволакивает голову цели: пока мантия так держится, цель ослеплена и не может дышать. Прицепившись, мантия атакует только эту цель, но с преимуществом; её скорость становится 0, она не получает бонусов к скорости и перемещается вместе с целью. Существо может действием отцепить мантию успешной проверкой Силы со СЛ 13. В свой ход мантия может отцепиться сама, потратив 5 фт. перемещения.' },
    ],
    actions: [
      ['Аура тьмы (1/день)', 'Из мантии расходится магическая тьма радиусом 15 фт.; она перемещается вместе с мантией и огибает углы. Тьма держится, пока мантия сохраняет концентрацию, до 10 минут (как на заклинании). Тёмное зрение её не пронзает, обычный свет не освещает. Если часть тьмы пересекается со светом от заклинания 2-го круга или ниже, это заклинание рассеивается.'],
    ],
  },
  {
    index: 'death-dog', name: 'Death Dog', nameRu: 'Пёс смерти', size: 'medium', type: 'чудовище', alignment: 'нейтрально-злой',
    ac: 12, hp: 39, hitDice: '6d8+12', speed: 40, abilities: [15, 14, 14, 3, 13, 6],
    skills: { perception: 5, stealth: 4 },
    darkvision: 120, passive: 15, languages: '—', cr: 1,
    traits: [
      ['Две головы', 'Совершает с преимуществом проверки Мудрости (Восприятие) и спасброски от глухоты, испуга, оглушения, ослепления, очарования и потери сознания.'],
    ],
    multiattack: { count: 2, text: 'Совершает две атаки укусом.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'piercing', note: 'Если цель — существо, она должна преуспеть в спасброске Телосложения со СЛ 12 от болезни, иначе отравлена, пока болезнь не вылечат. Каждые 24 часа существо повторяет спасбросок; при провале его максимум хитов уменьшается на 5 (1d10) до излечения. Если максимум хитов падает до 0, существо умирает.' },
    ],
  },
  {
    index: 'deep-gnome-svirfneblin', name: 'Deep Gnome (Svirfneblin)', nameRu: 'Глубинный гном (свирфнеблин)', size: 'small', type: 'гуманоид (гном)', alignment: 'нейтрально-добрый',
    ac: 15, acNote: 'кольчужная рубаха', hp: 16, hitDice: '3d6+6', speed: 20, abilities: [15, 14, 14, 12, 10, 9],
    skills: { investigation: 3, perception: 2, stealth: 4 },
    darkvision: 120, passive: 12, languages: 'Гномий, Терран, Подземный', cr: 0.5,
    traits: [STONE_CAMOUFLAGE, ['Гномья хитрость', 'Совершает с преимуществом спасброски Интеллекта, Мудрости и Харизмы от магии.']],
    attacks: [
      { name: 'Боевая кирка', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d8+2', average: 6, type: 'piercing' },
      { name: 'Отравленный дротик', kind: 'ranged', ability: 'dexterity', toHit: 4, range: [30, 120], damage: '1d4+2', average: 4, type: 'piercing', note: 'Цель должна преуспеть в спасброске Телосложения со СЛ 12, иначе отравлена на 1 минуту. Она повторяет спасбросок в конце каждого своего хода, заканчивая эффект при успехе.' },
    ],
    spellcasting: {
      ability: 'intelligence', slots: [],
      spells: ['nondetection', 'blindness-deafness', 'blur', 'disguise-self'],
      slotless: ['nondetection', 'blindness-deafness', 'blur', 'disguise-self'],
      text: 'Врождённая базовая характеристика — Интеллект (СЛ спасброска 11). Может накладывать следующие заклинания, не нуждаясь в материальных компонентах: неограниченно — необнаружимость (только на себя); 1/день каждое — глухота/слепота, размытый образ, маскировка.',
    },
  },
  {
    index: 'dryad', name: 'Dryad', nameRu: 'Дриада', size: 'medium', type: 'фея', alignment: 'нейтральный',
    ac: 11, acNote: '16 с дубовой корой', hp: 22, hitDice: '5d8', speed: 30, abilities: [10, 12, 11, 14, 15, 18],
    skills: { perception: 4, stealth: 5 },
    darkvision: 60, passive: 14, languages: 'Эльфийский, Сильван', cr: 1,
    traits: [
      MAGIC_RESISTANCE,
      ['Речь зверей и растений', 'Общается со зверями и растениями, как если бы у них был общий язык.'],
      ['Древесный шаг', 'Раз в свой ход может потратить 10 фт. перемещения, чтобы магически войти в живое дерево в пределах досягаемости и выйти из другого живого дерева в пределах 60 фт. от первого — в незанятом пространстве в пределах 5 фт. от него. Оба дерева должны быть Большими или крупнее.'],
    ],
    attacks: [
      { name: 'Дубинка', kind: 'melee', ability: 'strength', toHit: 2, reach: 5, damage: '1d4', average: 2, type: 'bludgeoning', note: 'Или 8 (1d8 + 4) дробящего урона под заклинанием «дубинка».' },
    ],
    actions: [
      ['Чары фей', 'Выбирает гуманоида или зверя, которого видит в пределах 30 фт. Если цель видит дриаду, она должна преуспеть в спасброске Мудрости со СЛ 14, иначе магически очарована. Очарованная цель считает дриаду надёжным другом, которого надо слушать и оберегать; она не под контролем дриады, но истолковывает её просьбы и поступки как можно благосклоннее. Каждый раз, когда дриада или её союзники вредят цели, та повторяет спасбросок, заканчивая эффект при успехе. Иначе эффект длится 24 часа или пока дриада не умрёт, не окажется на другом плане или не закончит его бонусным действием. Преуспевшая цель невосприимчива к чарам этой дриады 24 часа. Одновременно дриада держит очарованными не больше одного гуманоида и трёх зверей.'],
    ],
    spellcasting: {
      ability: 'charisma', slots: [],
      spells: ['druidcraft', 'entangle', 'goodberry', 'barkskin', 'pass-without-trace', 'shillelagh'],
      slotless: ['druidcraft', 'entangle', 'goodberry', 'barkskin', 'pass-without-trace', 'shillelagh'],
      text: 'Врождённая базовая характеристика — Харизма (СЛ спасброска 14). Может накладывать следующие заклинания, не нуждаясь в материальных компонентах: неограниченно — искусство друидов; 3/день каждое — опутывание, чудо-ягоды; 1/день каждое — дубовая кора, бесследное передвижение, дубинка.',
    },
  },
  {
    index: 'duergar', name: 'Duergar', nameRu: 'Дуэргар', size: 'medium', type: 'гуманоид (дварф)', alignment: 'законно-злой',
    ac: 16, acNote: 'чешуйчатый доспех, щит', hp: 26, hitDice: '4d8+8', speed: 25, abilities: [14, 11, 14, 11, 10, 9],
    resistant: ['poison'],
    darkvision: 120, passive: 10, languages: 'Дварфийский, Подземный', cr: 1,
    traits: [
      ['Стойкость дуэргара', 'Совершает с преимуществом спасброски от яда, заклинаний и иллюзий, а также от очарования и паралича.'],
      SUNLIGHT_SENSITIVITY,
    ],
    attacks: [
      { name: 'Боевая кирка', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d8+2', average: 6, type: 'piercing', note: 'Или 11 (2d8 + 2) колющего урона в увеличенном виде.' },
      { name: 'Метательное копьё', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, range: [30, 120], damage: '1d6+2', average: 5, type: 'piercing', note: 'Или 9 (2d6 + 2) колющего урона в увеличенном виде.' },
    ],
    actions: [
      ['Увеличение (перезаряжается после короткого или долгого отдыха)', 'На 1 минуту магически увеличивается вместе со всем, что несёт и носит. Увеличенный дуэргар Большой, удваивает кости урона атак оружием на Силе (учтено в атаках) и совершает с преимуществом проверки и спасброски Силы. Если для Большого размера не хватает места, вырастает настолько, насколько позволяет пространство.'],
      ['Невидимость (перезаряжается после короткого или долгого отдыха)', 'Магически становится невидимым, пока не атакует, не наложит заклинание, не применит Увеличение или пока не прервётся его концентрация, до 1 часа (как на заклинании). Всё, что он несёт и носит, невидимо вместе с ним.'],
    ],
  },
  {
    index: 'dust-mephit', name: 'Dust Mephit', nameRu: 'Пылевой мефит', size: 'small', type: 'элементаль', alignment: 'нейтрально-злой',
    ac: 12, hp: 17, hitDice: '5d6', speed: 30, speedNote: 'летая 30 фт.', abilities: [5, 14, 10, 9, 11, 10],
    skills: { perception: 2, stealth: 4 },
    vulnerable: ['fire'], immune: ['poison'], conditionImmunities: 'отравление',
    darkvision: 60, passive: 12, languages: 'Ауран, Терран', cr: 0.5,
    traits: [
      ['Предсмертный взрыв', 'Умирая, мефит взрывается облаком пыли. Каждое существо в пределах 5 фт. должно преуспеть в спасброске Телосложения со СЛ 10, иначе ослеплено на 1 минуту. Ослеплённое существо повторяет спасбросок в каждый свой ход, заканчивая эффект при успехе.'],
    ],
    attacks: [{ name: 'Когти', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d4+2', average: 4, type: 'slashing' }],
    actions: [
      ['Слепящее дыхание (перезарядка 6)', 'Выдыхает 15-футовый конус слепящей пыли. Каждое существо в нём должно преуспеть в спасброске Ловкости со СЛ 10, иначе ослеплено на 1 минуту. Существо повторяет спасбросок в конце каждого своего хода, заканчивая эффект при успехе.'],
    ],
    spellcasting: {
      ability: 'charisma', slots: [],
      spells: ['sleep'],
      slotless: ['sleep'],
      text: 'Врождённая базовая характеристика — Харизма (СЛ спасброска 10). Может накладывать следующие заклинания, не нуждаясь в материальных компонентах: 1/день — усыпление.',
    },
  },
  {
    index: 'giant-goat', name: 'Giant Goat', nameRu: 'Гигантский козёл', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 11, hp: 19, hitDice: '3d10+3', speed: 40, abilities: [17, 11, 12, 3, 12, 6],
    passive: 11, languages: '—', cr: 0.5,
    traits: [CHARGE('козёл', 20, '2d4', 5, 13), SURE_FOOTED],
    attacks: [{ name: 'Таран', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '2d4+3', average: 8, type: 'bludgeoning' }],
  },
  {
    index: 'giant-hyena', name: 'Giant Hyena', nameRu: 'Гигантская гиена', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 45, hitDice: '6d10+12', speed: 50, abilities: [16, 14, 14, 2, 12, 7],
    skills: { perception: 3 },
    passive: 13, languages: '—', cr: 1,
    traits: [
      ['Буйство', 'Когда гиена в свой ход опускает хиты существа до 0 рукопашной атакой, она может бонусным действием переместиться на половину скорости и атаковать укусом.'],
    ],
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '2d6+3', average: 10, type: 'piercing' }],
  },
  {
    index: 'giant-octopus', name: 'Giant Octopus', nameRu: 'Гигантский осьминог', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 11, hp: 52, hitDice: '8d10+8', speed: 10, speedNote: 'плавая 60 фт.', abilities: [17, 13, 13, 4, 10, 4],
    skills: { perception: 4, stealth: 5 },
    darkvision: 60, passive: 14, languages: '—', cr: 1,
    traits: [
      ['Задержка дыхания', 'Вне воды может задерживать дыхание на 1 час.'],
      ['Подводная маскировка', 'Совершает с преимуществом проверки Ловкости (Скрытность) под водой.'],
      WATER_BREATHING,
    ],
    attacks: [
      { name: 'Щупальца', kind: 'melee', ability: 'strength', toHit: 5, reach: 15, damage: '2d6+3', average: 10, type: 'bludgeoning', note: 'Если цель — существо, она схвачена (СЛ высвобождения 16). Пока захват длится, цель опутана, а осьминог не может бить щупальцами другую цель.' },
    ],
    actions: [
      ['Чернильное облако (перезаряжается после короткого или долгого отдыха)', 'Под водой выпускает чернила: облако радиусом 20 фт. вокруг сильно заслонено на 1 минуту (сильное течение рассеивает раньше). Затем бонусным действием может совершить Рывок.'],
    ],
  },
  {
    index: 'giant-sea-horse', name: 'Giant Sea Horse', nameRu: 'Гигантский морской конёк', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 13, acNote: 'природный доспех', hp: 16, hitDice: '3d10', speed: 0, speedNote: 'плавая 40 фт.', abilities: [12, 15, 11, 2, 12, 5],
    passive: 11, languages: '—', cr: 0.5,
    traits: [CHARGE('конёк', 20, '2d6', 7, 11), WATER_BREATHING],
    attacks: [{ name: 'Таран', kind: 'melee', ability: 'strength', toHit: 3, reach: 5, damage: '1d6+1', average: 4, type: 'bludgeoning' }],
  },
  {
    index: 'giant-toad', name: 'Giant Toad', nameRu: 'Гигантская жаба', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 11, hp: 39, hitDice: '6d10+6', speed: 20, speedNote: 'плавая 40 фт.', abilities: [15, 13, 13, 2, 10, 3],
    darkvision: 30, passive: 10, languages: '—', cr: 1,
    traits: [AMPHIBIOUS, ['Прыжок с места', 'Прыгает в длину до 20 фт. и в высоту до 10 фт. — с разбега и без.']],
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d10+2', average: 7, type: 'piercing', extra: { damage: '1d10', average: 5, type: 'poison' }, note: 'Цель схвачена (СЛ высвобождения 13). Пока захват длится, цель опутана, а жаба не может кусать другую цель.' },
    ],
    actions: [
      ['Проглатывание', 'Атакует укусом схваченную ею цель Среднего размера или меньше. При попадании цель проглочена, а захват заканчивается. Проглоченная цель ослеплена и опутана, у неё полное укрытие от атак и других эффектов снаружи жабы, и в начале каждого хода жабы она получает 10 (3d6) урона кислотой. Жаба может держать в себе только одну цель. Если жаба умирает, проглоченное существо больше не опутано ею и может выбраться из трупа, потратив 5 фт. перемещения; выбирается оно сбитым с ног.'],
    ],
  },
  {
    index: 'giant-vulture', name: 'Giant Vulture', nameRu: 'Гигантский стервятник', size: 'large', type: 'зверь', alignment: 'нейтрально-злой',
    ac: 10, hp: 22, hitDice: '3d10+6', speed: 10, speedNote: 'летая 60 фт.', abilities: [15, 10, 15, 6, 12, 7],
    skills: { perception: 3 },
    passive: 13, languages: 'понимает Общий, но не говорит на нём', cr: 1,
    traits: [KEEN_SIGHT_SMELL, PACK_TACTICS],
    multiattack: { count: 2, text: 'Совершает две атаки: одну клювом и одну когтями.' },
    attacks: [
      { name: 'Клюв', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '2d4+2', average: 7, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '2d6+2', average: 9, type: 'slashing' },
    ],
  },
  {
    index: 'giant-wasp', name: 'Giant Wasp', nameRu: 'Гигантская оса', size: 'medium', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 13, hitDice: '3d8', speed: 10, speedNote: 'летая 50 фт., плавая 50 фт.', abilities: [10, 14, 10, 1, 10, 3],
    passive: 10, languages: '—', cr: 0.5,
    attacks: [
      { name: 'Жало', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d6+2', average: 5, type: 'piercing', note: 'Цель совершает спасбросок Телосложения со СЛ 11, получая 10 (3d6) урона ядом при провале или половину при успехе. Если урон ядом опускает хиты цели до 0, она стабилизирована, но отравлена на 1 час, даже если восстановит хиты, и, пока отравлена так, парализована.' },
    ],
  },
  {
    index: 'gray-ooze', name: 'Gray Ooze', nameRu: 'Серая слизь', size: 'medium', type: 'слизь', alignment: 'без мировоззрения',
    ac: 8, hp: 22, hitDice: '3d8+9', speed: 10, speedNote: 'лазая 10 фт.', abilities: [12, 6, 16, 1, 6, 2],
    skills: { stealth: 2 },
    resistant: ['acid', 'cold', 'fire'], conditionImmunities: 'глухота, испуг, истощение, ослепление, очарование, сбит с ног',
    senses: 'слепое зрение 60 фт. (за его пределами слеп)', passive: 8, languages: '—', cr: 0.5,
    traits: [
      AMORPHOUS,
      ['Разъедание металла', 'Немагическое металлическое оружие, попавшее по слизи, разъедается: после нанесения урона получает постоянный штраф −1 к броскам урона, который накапливается. Если штраф доходит до −5, оружие разрушается. Немагические металлические боеприпасы, попавшие по слизи, разрушаются после нанесения урона. За 1 раунд слизь проедает немагический металл толщиной 2 дюйма.'],
      ['Обманчивый вид', 'Пока слизь неподвижна, её не отличить от маслянистой лужи или мокрого камня.'],
    ],
    attacks: [
      { name: 'Ложноножка', kind: 'melee', ability: 'strength', toHit: 3, reach: 5, damage: '1d6+1', average: 4, type: 'bludgeoning', extra: { damage: '2d6', average: 7, type: 'acid' }, note: 'Если на цели немагический металлический доспех, он частично разъедается и получает постоянный штраф −1 к КД, который накапливается. Доспех разрушается, если штраф опускает его КД до 10.' },
    ],
  },
  {
    index: 'harpy', name: 'Harpy', nameRu: 'Гарпия', size: 'medium', type: 'чудовище', alignment: 'хаотично-злой',
    ac: 11, hp: 38, hitDice: '7d8+7', speed: 20, speedNote: 'летая 40 фт.', abilities: [12, 13, 12, 7, 10, 13],
    passive: 10, languages: 'Общий', cr: 1,
    multiattack: { count: 2, text: 'Совершает две атаки: одну когтями и одну дубинкой.' },
    attacks: [
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 3, reach: 5, damage: '2d4+1', average: 6, type: 'slashing' },
      { name: 'Дубинка', kind: 'melee', ability: 'strength', toHit: 3, reach: 5, damage: '1d4+1', average: 3, type: 'bludgeoning' },
    ],
    actions: [
      ['Манящая песня', 'Гарпия поёт магическую мелодию. Каждый гуманоид и великан в пределах 300 фт., слышащий песню, должен преуспеть в спасброске Мудрости со СЛ 11, иначе очарован, пока песня не закончится. Чтобы петь дальше, гарпия в следующие ходы тратит бонусное действие; остановиться может когда угодно. Песня заканчивается, если гарпия недееспособна. Очарованная цель недееспособна и не слышит песен других гарпий. Если она дальше 5 фт. от гарпии, то в свой ход идёт к ней кратчайшим путём, не избегая атак, но перед входом в опасную местность (лаву, яму) и всякий раз, получая урон не от гарпии, повторяет спасбросок. Также она повторяет его в конце каждого своего хода. При успехе эффект на неё заканчивается, и 24 часа песня этой гарпии на неё не действует.'],
    ],
  },
  {
    index: 'hippogriff', name: 'Hippogriff', nameRu: 'Гиппогриф', size: 'large', type: 'чудовище', alignment: 'без мировоззрения',
    ac: 11, hp: 19, hitDice: '3d10+3', speed: 40, speedNote: 'летая 60 фт.', abilities: [17, 13, 13, 2, 12, 8],
    skills: { perception: 5 },
    passive: 15, languages: '—', cr: 1,
    traits: [KEEN_SIGHT],
    multiattack: { count: 2, text: 'Совершает две атаки: одну клювом и одну когтями.' },
    attacks: [
      { name: 'Клюв', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d10+3', average: 8, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '2d6+3', average: 10, type: 'slashing' },
    ],
  },
  {
    index: 'ice-mephit', name: 'Ice Mephit', nameRu: 'Ледяной мефит', size: 'small', type: 'элементаль', alignment: 'нейтрально-злой',
    ac: 11, hp: 21, hitDice: '6d6', speed: 30, speedNote: 'летая 30 фт.', abilities: [7, 13, 10, 9, 11, 12],
    skills: { perception: 2, stealth: 3 },
    vulnerable: ['bludgeoning', 'fire'], immune: ['cold', 'poison'], conditionImmunities: 'отравление',
    darkvision: 60, passive: 12, languages: 'Акван, Ауран', cr: 0.5,
    traits: [
      ['Предсмертный взрыв', 'Умирая, мефит разлетается острыми осколками льда. Каждое существо в пределах 5 фт. совершает спасбросок Ловкости со СЛ 10, получая 4 (1d8) рубящего урона при провале или половину при успехе.'],
      ['Обманчивый вид', 'Пока мефит неподвижен, его не отличить от обычного куска льда.'],
    ],
    attacks: [
      { name: 'Когти', kind: 'melee', ability: 'dexterity', toHit: 3, reach: 5, damage: '1d4+1', average: 3, type: 'slashing', extra: { damage: '1d4', average: 2, type: 'cold' } },
    ],
    actions: [
      ['Морозное дыхание (перезарядка 6)', 'Выдыхает 15-футовый конус холодного воздуха. Каждое существо в нём совершает спасбросок Ловкости со СЛ 10, получая 5 (2d4) урона холодом при провале или половину при успехе.'],
    ],
    spellcasting: {
      ability: 'charisma', slots: [],
      spells: ['fog-cloud'],
      slotless: ['fog-cloud'],
      text: 'Врождённая базовая характеристика — Харизма (). Может накладывать следующие заклинания, не нуждаясь в материальных компонентах: 1/день — туманное облако.',
    },
  },
  {
    index: 'imp', name: 'Imp', nameRu: 'Бес', size: 'tiny', type: 'исчадие (дьявол)', alignment: 'законно-злой',
    ac: 13, hp: 10, hitDice: '3d4+3', speed: 20, speedNote: 'летая 40 фт.', abilities: [6, 17, 13, 11, 12, 14],
    skills: { deception: 4, insight: 3, persuasion: 4, stealth: 5 },
    resistant: ['cold', 'nonmagical'], immune: ['fire', 'poison'], defenseNote: 'Сопротивление: посеребрённое оружие пробивает.', conditionImmunities: 'отравление',
    darkvision: 120, passive: 11, languages: 'Инфернальный, Общий', cr: 1,
    traits: [
      ['Перевёртыш', 'Действием превращается в зверя, похожего на крысу (скорость 20 фт.), ворона (20 фт., летая 60 фт.) или паука (20 фт., лазая 20 фт.), или возвращается в свой истинный облик. Характеристики во всех обликах одинаковы, кроме указанных скоростей. Снаряжение не превращается. После смерти возвращается в истинный облик.'],
      DEVILS_SIGHT,
      MAGIC_RESISTANCE,
    ],
    attacks: [
      { name: 'Жало', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, damage: '1d4+3', average: 5, type: 'piercing', note: 'В облике зверя — укус. Цель совершает спасбросок Телосложения со СЛ 11, получая 10 (3d6) урона ядом при провале или половину при успехе.' },
    ],
    actions: [
      ['Невидимость', 'Магически становится невидимым, пока не атакует или пока не прервётся его концентрация (как на заклинании). Всё, что он несёт и носит, невидимо вместе с ним.'],
    ],
  },
  {
    index: 'lion', name: 'Lion', nameRu: 'Лев', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 26, hitDice: '4d10+4', speed: 50, abilities: [17, 15, 13, 3, 12, 8],
    skills: { perception: 3, stealth: 6 },
    passive: 13, languages: '—', cr: 1,
    traits: [
      KEEN_SMELL,
      PACK_TACTICS,
      ['Наскок', 'Если лев переместился по прямой хотя бы на 20 фт. к существу и в тот же ход попал по нему когтем, цель должна преуспеть в спасброске Силы со СЛ 13, иначе сбита с ног. По сбитой с ног цели лев может бонусным действием атаковать укусом.'],
      ['Прыжок с разбега', 'С разбега в 10 фт. прыгает в длину до 25 фт.'],
    ],
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d8+3', average: 7, type: 'piercing' },
      { name: 'Коготь', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d6+3', average: 6, type: 'slashing' },
    ],
  },
  {
    index: 'magma-mephit', name: 'Magma Mephit', nameRu: 'Магмовый мефит', size: 'small', type: 'элементаль', alignment: 'нейтрально-злой',
    ac: 11, hp: 22, hitDice: '5d6+5', speed: 30, speedNote: 'летая 30 фт.', abilities: [8, 12, 12, 7, 10, 10],
    skills: { stealth: 3 },
    vulnerable: ['cold'], immune: ['fire', 'poison'], conditionImmunities: 'отравление',
    darkvision: 60, passive: 10, languages: 'Игнан, Терран', cr: 0.5,
    traits: [
      ['Предсмертный взрыв', 'Умирая, мефит взрывается брызгами лавы. Каждое существо в пределах 5 фт. совершает спасбросок Ловкости со СЛ 11, получая 7 (2d6) урона огнём при провале или половину при успехе.'],
      ['Обманчивый вид', 'Пока мефит неподвижен, его не отличить от обычной кучки магмы.'],
    ],
    attacks: [
      { name: 'Когти', kind: 'melee', ability: 'dexterity', toHit: 3, reach: 5, damage: '1d4+1', average: 3, type: 'slashing', extra: { damage: '1d4', average: 2, type: 'fire' } },
    ],
    actions: [
      ['Огненное дыхание (перезарядка 6)', 'Выдыхает 15-футовый конус огня. Каждое существо в нём совершает спасбросок Ловкости со СЛ 11, получая 7 (2d6) урона огнём при провале или половину при успехе.'],
    ],
    spellcasting: {
      ability: 'charisma', slots: [],
      spells: ['heat-metal'],
      slotless: ['heat-metal'],
      text: 'Врождённая базовая характеристика — Харизма (СЛ спасброска 10). Может накладывать следующие заклинания, не нуждаясь в материальных компонентах: 1/день — раскалённый металл.',
    },
  },
  {
    index: 'magmin', name: 'Magmin', nameRu: 'Магмин', size: 'small', type: 'элементаль', alignment: 'хаотично-нейтральный',
    ac: 14, acNote: 'природный доспех', hp: 9, hitDice: '2d6+2', speed: 30, abilities: [7, 15, 12, 8, 11, 10],
    resistant: ['nonmagical'], immune: ['fire'],
    darkvision: 60, passive: 10, languages: 'Игнан', cr: 0.5,
    traits: [
      ['Предсмертный взрыв', 'Умирая, магмин взрывается огнём и магмой. Каждое существо в пределах 10 фт. совершает спасбросок Ловкости со СЛ 11, получая 7 (2d6) урона огнём при провале или половину при успехе. Горючие предметы в этой области, которые никто не несёт и не носит, загораются.'],
      ['Пылающее свечение', 'Бонусным действием вспыхивает или гасит пламя. Пока горит, испускает яркий свет в радиусе 10 фт. и тусклый — ещё на 10 фт.'],
    ],
    attacks: [
      { name: 'Касание', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '2d6', average: 7, type: 'fire', note: 'Если цель — существо или горючий предмет, она загорается. Пока кто-нибудь действием не потушит огонь, цель получает 3 (1d6) урона огнём в конце каждого своего хода.' },
    ],
  },
  {
    index: 'quasit', name: 'Quasit', nameRu: 'Квазит', size: 'tiny', type: 'исчадие (демон)', alignment: 'хаотично-злой',
    ac: 13, hp: 7, hitDice: '3d4', speed: 40, abilities: [5, 17, 10, 7, 10, 10],
    skills: { stealth: 5 },
    resistant: ['cold', 'fire', 'lightning', 'nonmagical'], immune: ['poison'], conditionImmunities: 'отравление',
    darkvision: 120, passive: 10, languages: 'Бездны, Общий', cr: 1,
    traits: [
      ['Перевёртыш', 'Действием превращается в зверя, похожего на летучую мышь (скорость 10 фт., летая 40 фт.), сороконожку (40 фт., лазая 40 фт.) или жабу (40 фт., плавая 40 фт.), или возвращается в свой истинный облик. Характеристики во всех обликах одинаковы, кроме указанных скоростей. Снаряжение не превращается. После смерти возвращается в истинный облик.'],
      MAGIC_RESISTANCE,
    ],
    attacks: [
      { name: 'Коготь', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '1d4+3', average: 5, type: 'piercing', quirk: true, note: 'В облике зверя — укус. Цель должна преуспеть в спасброске Телосложения со СЛ 10, иначе получает 5 (2d4) урона ядом и отравлена на 1 минуту. Она повторяет спасбросок в конце каждого своего хода, заканчивая эффект при успехе.' },
    ],
    actions: [
      ['Испуг (1/день)', 'Одно существо на выбор квазита в пределах 20 фт. должно преуспеть в спасброске Мудрости со СЛ 10, иначе испугано на 1 минуту. Цель повторяет спасбросок в конце каждого своего хода — с помехой, если видит квазита, — заканчивая эффект при успехе.'],
      ['Невидимость', 'Магически становится невидимым, пока не атакует, не применит Испуг или пока не прервётся его концентрация (как на заклинании). Всё, что он несёт и носит, невидимо вместе с ним.'],
    ],
  },
  {
    index: 'reef-shark', name: 'Reef Shark', nameRu: 'Рифовая акула', size: 'medium', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, acNote: 'природный доспех', hp: 22, hitDice: '4d8+4', speed: 0, speedNote: 'плавая 40 фт.', abilities: [14, 13, 13, 1, 10, 4],
    skills: { perception: 2 },
    senses: 'слепое зрение 30 фт.', passive: 12, languages: '—', cr: 0.5,
    traits: [PACK_TACTICS, WATER_BREATHING],
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'strength', toHit: 4, reach: 5, damage: '1d8+2', average: 6, type: 'piercing' }],
  },
  {
    index: 'rust-monster', name: 'Rust Monster', nameRu: 'Ржавник', size: 'medium', type: 'чудовище', alignment: 'без мировоззрения',
    ac: 14, acNote: 'природный доспех', hp: 27, hitDice: '5d8+5', speed: 40, abilities: [13, 12, 13, 2, 13, 6],
    darkvision: 60, passive: 11, languages: '—', cr: 0.5,
    traits: [
      ['Нюх на железо', 'По запаху точно определяет, где находится железо в пределах 30 фт.'],
      ['Разъедание металла', 'Немагическое металлическое оружие, попавшее по существу, ржавеет: после нанесения урона получает постоянный штраф −1 к броскам урона, который накапливается. Если штраф доходит до −5, оружие разрушается. Немагические металлические боеприпасы, попавшие по существу, разрушаются после нанесения урона.'],
    ],
    attacks: [{ name: 'Укус', kind: 'melee', ability: 'strength', toHit: 3, reach: 5, damage: '1d8+1', average: 5, type: 'piercing' }],
    actions: [
      ['Усики', 'Разъедает немагический предмет из чёрного металла, который видит в пределах 5 фт. Если предмет никто не несёт и не носит, касание уничтожает его кусок размером с 1-футовый куб. Если предмет несёт или носит существо, оно может уклониться от касания успешным спасброском Ловкости со СЛ 11. Металлический доспех или щит при касании получает постоянный штраф −1 к КД, который накапливается: доспех с КД 10 и щит с бонусом +0 разрушаются. Металлическое оружие в руках ржавеет, как описано в «Разъедании металла».'],
    ],
  },
  {
    index: 'sahuagin', name: 'Sahuagin', nameRu: 'Сахуагин', size: 'medium', type: 'гуманоид (сахуагин)', alignment: 'законно-злой',
    ac: 12, acNote: 'природный доспех', hp: 22, hitDice: '4d8+4', speed: 30, speedNote: 'плавая 40 фт.', abilities: [13, 11, 12, 12, 13, 9],
    skills: { perception: 5 },
    darkvision: 120, passive: 15, languages: 'Сахуагинский', cr: 0.5,
    traits: [
      ['Кровавое бешенство', 'Совершает с преимуществом рукопашные атаки по существу, у которого меньше максимума хитов.'],
      ['Ограниченная амфибийность', 'Дышит и воздухом, и водой, но должен хотя бы раз в 4 часа погружаться в воду, иначе задохнётся.'],
      ['Телепатия акул', 'Магически отдаёт приказы любой акуле в пределах 120 фт. с помощью ограниченной телепатии.'],
    ],
    multiattack: { count: 2, text: 'Совершает две рукопашные атаки: одну укусом и одну когтями или копьём.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 3, reach: 5, damage: '1d4+1', average: 3, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 3, reach: 5, damage: '1d4+1', average: 3, type: 'slashing' },
      { name: 'Копьё', kind: 'melee', ability: 'strength', toHit: 3, reach: 5, range: [20, 60], damage: '1d6+1', average: 4, type: 'piercing', versatile: '1d8+1' },
    ],
  },
  {
    index: 'satyr', name: 'Satyr', nameRu: 'Сатир', size: 'medium', type: 'фея', alignment: 'хаотично-нейтральный',
    ac: 14, acNote: 'кожаный доспех', hp: 31, hitDice: '7d8', speed: 40, abilities: [12, 16, 11, 12, 10, 14],
    skills: { perception: 2, performance: 6, stealth: 5 },
    passive: 12, languages: 'Общий, Эльфийский, Сильван', cr: 0.5,
    traits: [MAGIC_RESISTANCE],
    attacks: [
      { name: 'Таран', kind: 'melee', ability: 'strength', toHit: 3, reach: 5, damage: '2d4+1', average: 6, type: 'bludgeoning' },
      { name: 'Короткий меч', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 5, damage: '1d6+3', average: 6, type: 'piercing' },
      { name: 'Короткий лук', kind: 'ranged', ability: 'dexterity', toHit: 5, range: [80, 320], damage: '1d6+3', average: 6, type: 'piercing' },
    ],
  },
  {
    index: 'shadow', name: 'Shadow', nameRu: 'Тень', size: 'medium', type: 'нежить', alignment: 'хаотично-злой',
    ac: 12, hp: 16, hitDice: '3d8+3', speed: 40, abilities: [6, 14, 13, 6, 10, 8],
    skills: { stealth: 4 },
    vulnerable: ['radiant'], resistant: ['acid', 'cold', 'fire', 'lightning', 'thunder', 'nonmagical'], immune: ['necrotic', 'poison'], conditionImmunities: 'захват, испуг, истощение, окаменение, опутанность, отравление, паралич, сбит с ног',
    darkvision: 60, passive: 10, languages: '—', cr: 0.5,
    traits: [
      AMORPHOUS,
      ['Теневая скрытность', 'При тусклом свете или в темноте может бонусным действием совершать Засаду. Её бонус Скрытности тогда +6.'],
      ['Слабость на солнце', 'На солнечном свету совершает с помехой броски атаки, проверки характеристик и спасброски.'],
    ],
    attacks: [
      { name: 'Высасывание силы', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '2d6+2', average: 9, type: 'necrotic', note: 'Сила цели уменьшается на 1d4. Если Сила падает до 0, цель умирает; иначе уменьшение длится до короткого или долгого отдыха. Если от этой атаки умирает не злой гуманоид, через 1d4 часа из трупа поднимается новая тень.' },
    ],
  },
  {
    index: 'specter', name: 'Specter', nameRu: 'Спектр', size: 'medium', type: 'нежить', alignment: 'хаотично-злой',
    ac: 12, hp: 22, hitDice: '5d8', speed: 0, speedNote: 'летая 50 фт. (парит)', abilities: [1, 14, 11, 10, 10, 11],
    resistant: ['acid', 'cold', 'fire', 'lightning', 'thunder', 'nonmagical'], immune: ['necrotic', 'poison'], conditionImmunities: 'бессознательность, захват, истощение, окаменение, опутанность, отравление, очарование, паралич, сбит с ног',
    darkvision: 60, passive: 10, languages: 'понимает все языки, которые знал при жизни, но не говорит', cr: 1,
    traits: [INCORPOREAL_MOVEMENT, SUNLIGHT_SENSITIVITY],
    attacks: [
      { name: 'Высасывание жизни', kind: 'melee', ability: 'dexterity', toHit: 4, reach: 5, damage: '3d6', average: 10, type: 'necrotic', note: 'Цель должна преуспеть в спасброске Телосложения со СЛ 10, иначе её максимум хитов уменьшается на величину полученного урона до окончания долгого отдыха. Если максимум хитов падает до 0, цель умирает.' },
    ],
  },
  {
    index: 'swarm-of-beetles', name: 'Swarm of Beetles', nameRu: 'Рой жуков', size: 'medium', type: 'рой Крошечных зверей', alignment: 'без мировоззрения',
    ac: 12, acNote: 'природный доспех', hp: 22, hitDice: '5d8', speed: 20, speedNote: 'копая 5 фт., лазая 20 фт.', abilities: [3, 13, 10, 1, 7, 1],
    resistant: ['bludgeoning', 'piercing', 'slashing'], conditionImmunities: 'захват, испуг, окаменение, опутанность, очарование, ошеломление, паралич, сбит с ног',
    senses: 'слепое зрение 10 фт.', passive: 8, languages: '—', cr: 0.5,
    traits: [
      ['Рой', 'Может занимать пространство другого существа и наоборот и проходит сквозь любой проём, достаточный для Крошечного насекомого. Не может восстанавливать хиты и получать временные хиты.'],
    ],
    attacks: [
      { name: 'Укусы', kind: 'melee', ability: 'dexterity', toHit: 3, reach: 0, damage: '4d4', average: 10, type: 'piercing', note: 'Или 5 (2d4) колющего урона, если у роя осталась половина хитов или меньше.' },
    ],
  },
  {
    index: 'swarm-of-centipedes', name: 'Swarm of Centipedes', nameRu: 'Рой сороконожек', size: 'medium', type: 'рой Крошечных зверей', alignment: 'без мировоззрения',
    ac: 12, acNote: 'природный доспех', hp: 22, hitDice: '5d8', speed: 20, speedNote: 'лазая 20 фт.', abilities: [3, 13, 10, 1, 7, 1],
    resistant: ['bludgeoning', 'piercing', 'slashing'], conditionImmunities: 'захват, испуг, окаменение, опутанность, очарование, ошеломление, паралич, сбит с ног',
    senses: 'слепое зрение 10 фт.', passive: 8, languages: '—', cr: 0.5,
    traits: [
      ['Рой', 'Может занимать пространство другого существа и наоборот и проходит сквозь любой проём, достаточный для Крошечного насекомого. Не может восстанавливать хиты и получать временные хиты.'],
    ],
    attacks: [
      { name: 'Укусы', kind: 'melee', ability: 'dexterity', toHit: 3, reach: 0, damage: '4d4', average: 10, type: 'piercing', note: 'Или 5 (2d4) колющего урона, если у роя осталась половина хитов или меньше. Существо, чьи хиты рой опустил до 0, стабилизировано, но отравлено на 1 час, даже если восстановит хиты, и, пока отравлено так, парализовано.' },
    ],
  },
  {
    index: 'swarm-of-insects', name: 'Swarm of Insects', nameRu: 'Рой насекомых', size: 'medium', type: 'рой Крошечных зверей', alignment: 'без мировоззрения',
    ac: 12, acNote: 'природный доспех', hp: 22, hitDice: '5d8', speed: 20, speedNote: 'лазая 20 фт.', abilities: [3, 13, 10, 1, 7, 1],
    resistant: ['bludgeoning', 'piercing', 'slashing'], conditionImmunities: 'захват, испуг, окаменение, опутанность, очарование, ошеломление, паралич, сбит с ног',
    senses: 'слепое зрение 10 фт.', passive: 8, languages: '—', cr: 0.5,
    traits: [
      ['Рой', 'Может занимать пространство другого существа и наоборот и проходит сквозь любой проём, достаточный для Крошечного насекомого. Не может восстанавливать хиты и получать временные хиты.'],
    ],
    attacks: [
      { name: 'Укусы', kind: 'melee', ability: 'dexterity', toHit: 3, reach: 0, damage: '4d4', average: 10, type: 'piercing', note: 'Или 5 (2d4) колющего урона, если у роя осталась половина хитов или меньше.' },
    ],
  },
  {
    index: 'swarm-of-quippers', name: 'Swarm of Quippers', nameRu: 'Рой квипперов', size: 'medium', type: 'рой Крошечных зверей', alignment: 'без мировоззрения',
    ac: 13, hp: 28, hitDice: '8d8-8', speed: 0, speedNote: 'плавая 40 фт.', abilities: [13, 16, 9, 1, 7, 2],
    resistant: ['bludgeoning', 'piercing', 'slashing'], conditionImmunities: 'захват, испуг, окаменение, опутанность, очарование, ошеломление, паралич, сбит с ног',
    darkvision: 60, passive: 8, languages: '—', cr: 1,
    traits: [
      ['Кровавое бешенство', 'Совершает с преимуществом рукопашные атаки по существу, у которого меньше максимума хитов.'],
      ['Рой', 'Может занимать пространство другого существа и наоборот и проходит сквозь любой проём, достаточный для Крошечного квиппера. Не может восстанавливать хиты и получать временные хиты.'],
      WATER_BREATHING,
    ],
    attacks: [
      { name: 'Укусы', kind: 'melee', ability: 'dexterity', toHit: 5, reach: 0, damage: '4d6', average: 14, type: 'piercing', note: 'Или 7 (2d6) колющего урона, если у роя осталась половина хитов или меньше.' },
    ],
  },
  {
    index: 'swarm-of-spiders', name: 'Swarm of Spiders', nameRu: 'Рой пауков', size: 'medium', type: 'рой Крошечных зверей', alignment: 'без мировоззрения',
    ac: 12, acNote: 'природный доспех', hp: 22, hitDice: '5d8', speed: 20, speedNote: 'лазая 20 фт.', abilities: [3, 13, 10, 1, 7, 1],
    resistant: ['bludgeoning', 'piercing', 'slashing'], conditionImmunities: 'испуг, окаменение, опутанность, очарование, ошеломление, паралич, сбит с ног',
    senses: 'слепое зрение 10 фт.', passive: 8, languages: '—', cr: 0.5,
    traits: [
      ['Рой', 'Может занимать пространство другого существа и наоборот и проходит сквозь любой проём, достаточный для Крошечного насекомого. Не может восстанавливать хиты и получать временные хиты.'],
      SPIDER_CLIMB,
      WEB_SENSE,
      WEB_WALKER,
    ],
    attacks: [
      { name: 'Укусы', kind: 'melee', ability: 'dexterity', toHit: 3, reach: 0, damage: '4d4', average: 10, type: 'piercing', note: 'Или 5 (2d4) колющего урона, если у роя осталась половина хитов или меньше.' },
    ],
  },
  {
    index: 'swarm-of-wasps', name: 'Swarm of Wasps', nameRu: 'Рой ос', size: 'medium', type: 'рой Крошечных зверей', alignment: 'без мировоззрения',
    ac: 12, acNote: 'природный доспех', hp: 22, hitDice: '5d8', speed: 5, speedNote: 'летая 30 фт.', abilities: [3, 13, 10, 1, 7, 1],
    resistant: ['bludgeoning', 'piercing', 'slashing'], conditionImmunities: 'захват, испуг, окаменение, опутанность, очарование, ошеломление, паралич, сбит с ног',
    senses: 'слепое зрение 10 фт.', passive: 8, languages: '—', cr: 0.5,
    traits: [
      ['Рой', 'Может занимать пространство другого существа и наоборот и проходит сквозь любой проём, достаточный для Крошечного насекомого. Не может восстанавливать хиты и получать временные хиты.'],
    ],
    attacks: [
      { name: 'Укусы', kind: 'melee', ability: 'dexterity', toHit: 3, reach: 0, damage: '4d4', average: 10, type: 'piercing', note: 'Или 5 (2d4) колющего урона, если у роя осталась половина хитов или меньше.' },
    ],
  },
  {
    index: 'tiger', name: 'Tiger', nameRu: 'Тигр', size: 'large', type: 'зверь', alignment: 'без мировоззрения',
    ac: 12, hp: 37, hitDice: '5d10+10', speed: 40, abilities: [17, 15, 14, 3, 12, 8],
    skills: { perception: 3, stealth: 6 },
    darkvision: 60, passive: 13, languages: '—', cr: 1,
    traits: [
      KEEN_SMELL,
      ['Наскок', 'Если тигр переместился по прямой хотя бы на 20 фт. к существу и в тот же ход попал по нему когтем, цель должна преуспеть в спасброске Силы со СЛ 13, иначе сбита с ног. По сбитой с ног цели тигр может бонусным действием атаковать укусом.'],
    ],
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d10+3', average: 8, type: 'piercing' },
      { name: 'Коготь', kind: 'melee', ability: 'strength', toHit: 5, reach: 5, damage: '1d8+3', average: 7, type: 'slashing' },
    ],
  },
  {
    index: 'warhorse-skeleton', name: 'Warhorse Skeleton', nameRu: 'Скелет боевого коня', size: 'large', type: 'нежить', alignment: 'законно-злой',
    ac: 13, acNote: 'обрывки конского доспеха', hp: 22, hitDice: '3d10+6', speed: 60, abilities: [18, 12, 15, 2, 8, 5],
    vulnerable: ['bludgeoning'], immune: ['poison'], conditionImmunities: 'истощение, отравление',
    darkvision: 60, passive: 9, languages: '—', cr: 0.5,
    attacks: [{ name: 'Копыта', kind: 'melee', ability: 'strength', toHit: 6, reach: 5, damage: '2d6+4', average: 11, type: 'bludgeoning' }],
  },
];
