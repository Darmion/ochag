import {
  AMPHIBIOUS, DEVILS_SIGHT, IMMUTABLE_FORM, KEEN_SIGHT, KEEN_SMELL, MAGIC_RESISTANCE, MAGIC_WEAPONS, SIEGE_MONSTER, PARRY,
  type SrdMonster,
} from './shared.ts';

export const MONSTERS_CHALLENGE_9: SrdMonster[] = [
  {
    index: 'aboleth', name: 'Aboleth', nameRu: 'Аболет', size: 'large', type: 'аберрация', alignment: 'законно-злой',
    ac: 17, acNote: 'природный доспех', hp: 135, hitDice: '18d10+36', speed: 10, speedNote: 'плавая 40 фт.', abilities: [21, 9, 15, 18, 15, 18],
    saves: { constitution: 6, intelligence: 8, wisdom: 6 }, skills: { history: 12, perception: 10 },
    darkvision: 120, passive: 20, languages: 'Глубинная речь, телепатия 120 фт.', cr: 10,
    traits: [
      AMPHIBIOUS,
      ['Слизистое облако', 'Под водой аболета окружает преображающая слизь. Существо, которое касается его или попадает по нему рукопашной атакой, находясь в пределах 5 фт., совершает спасбросок Телосложения со СЛ 14. При провале оно на 1d4 часа заражено: может дышать только под водой.'],
      ['Зондирующая телепатия', 'Если существо общается с аболетом телепатически, а аболет его видит, он узнаёт его самые сильные желания.'],
    ],
    multiattack: { count: 3, text: 'Совершает три атаки щупальцами.' },
    attacks: [
      { name: 'Щупальце', kind: 'melee', ability: 'strength', toHit: 9, reach: 10, damage: '2d6+5', average: 12, type: 'bludgeoning', note: 'Если цель — существо, она должна преуспеть в спасброске Телосложения со СЛ 14, иначе заражается болезнью. 1 минуту болезнь не проявляется, и её снимает любая излечивающая болезни магия. Затем кожа существа становится полупрозрачной и склизкой, оно восстанавливает хиты только под водой, а снять болезнь можно лишь заклинанием полное исцеление или другим излечивающим болезни заклинанием 6-го круга или выше. Вне воды существо получает 6 (1d12) урона кислотой каждые 10 минут, если за это время кожу не увлажнят.' },
      { name: 'Хвост', kind: 'melee', ability: 'strength', toHit: 9, reach: 10, damage: '3d6+5', average: 15, type: 'bludgeoning' },
    ],
    actions: [
      ['Порабощение (3/день)', 'Выбирает существо, которое видит в пределах 30 фт. Цель должна преуспеть в спасброске Мудрости со СЛ 14, иначе магически очарована аболетом, пока тот не умрёт или не окажется на другом плане. Очарованная цель подчиняется аболету и не может совершать реакции; они общаются телепатически на любом расстоянии. Получая урон, цель повторяет спасбросок, заканчивая эффект при успехе. Не чаще раза в 24 часа она может повторить спасбросок и когда находится хотя бы в 1 миле от аболета.'],
    ],
    legendary: {
      actions: 3,
      options: [
        { name: 'Обнаружение', cost: 1, text: 'Совершает проверку Мудрости (Восприятие).' },
        { name: 'Удар хвостом', cost: 1, text: 'Совершает одну атаку хвостом.' },
        { name: 'Психическое истощение', cost: 2, text: 'Одно очарованное аболетом существо получает 10 (3d6) психического урона, а аболет восстанавливает столько хитов, сколько урона получило существо.' },
      ],
    },
  },
  {
    index: 'archmage', name: 'Archmage', nameRu: 'Архимаг', size: 'medium', type: 'гуманоид (любая раса)', alignment: 'любое мировоззрение',
    ac: 12, acNote: '15 с доспехами мага', hp: 99, hitDice: '18d8+18', speed: 30, abilities: [10, 14, 12, 20, 15, 16],
    saves: { intelligence: 9, wisdom: 6 }, skills: { arcana: 13, history: 13 },
    resistant: ['nonmagical'], defenseNote: 'Сопротивление: урон от заклинаний; от «каменной кожи».',
    passive: 12, languages: 'любые шесть языков', cr: 12,
    traits: [MAGIC_RESISTANCE],
    attacks: [
      { name: 'Кинжал', kind: 'melee', ability: 'dexterity', toHit: 6, reach: 5, range: [20, 60], damage: '1d4+2', average: 4, type: 'piercing' },
    ],
    spellcasting: {
      ability: 'intelligence', slots: [4, 3, 3, 3, 3, 1, 1, 1, 1],
      spells: ['disguise-self', 'invisibility', 'fire-bolt', 'light', 'mage-hand', 'prestidigitation', 'shocking-grasp', 'detect-magic', 'identify', 'mage-armor', 'magic-missile', 'detect-thoughts', 'mirror-image', 'misty-step', 'counterspell', 'fly', 'lightning-bolt', 'banishment', 'fire-shield', 'stoneskin', 'cone-of-cold', 'scrying', 'wall-of-force', 'globe-of-invulnerability', 'teleport', 'mind-blank', 'time-stop'],
      slotless: ['disguise-self', 'invisibility'],
      text: 'Заклинатель 18-го уровня, базовая характеристика — Интеллект (СЛ спасброска 17, +9 к попаданию заклинаниями). Может неограниченно накладывать заклинания: маскировка, невидимость. Подготовлены заклинания волшебника: заговоры — огненный снаряд, свет, волшебная рука, фокусы, электрошок; 1-й круг (4 ячейки) — обнаружение магии, опознание, доспехи мага*, волшебная стрела; 2-й круг (3 ячейки) — обнаружение мыслей, отражения, туманный шаг; 3-й круг (3 ячейки) — контрзаклинание, полёт, молния; 4-й круг (3 ячейки) — изгнание, огненный щит, каменная кожа*; 5-й круг (3 ячейки) — конус холода, наблюдение, силовая стена; 6-й круг (1 ячейка) — сфера неуязвимости; 7-й круг (1 ячейка) — телепортация; 8-й круг (1 ячейка) — сокрытие разума*; 9-й круг (1 ячейка) — остановка времени. Заклинания со звёздочкой накладывает на себя перед боем.',
    },
  },
  {
    index: 'behir', name: 'Behir', nameRu: 'Бехир', size: 'huge', type: 'чудовище', alignment: 'нейтрально-злой',
    ac: 17, acNote: 'природный доспех', hp: 168, hitDice: '16d12+64', speed: 50, speedNote: 'лазая 40 фт.', abilities: [23, 16, 18, 7, 14, 12],
    skills: { perception: 6, stealth: 7 },
    immune: ['lightning'],
    darkvision: 90, passive: 16, languages: 'Драконий', cr: 11,
    multiattack: { count: 2, text: 'Совершает две атаки: одну укусом и одну сдавливанием.' },
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 10, reach: 10, damage: '3d10+6', average: 22, type: 'piercing' },
      { name: 'Сдавливание', kind: 'melee', ability: 'strength', toHit: 10, reach: 5, damage: '2d10+6', average: 17, type: 'bludgeoning', extra: { damage: '2d10+6', average: 17, type: 'slashing' }, note: 'Цель схвачена (СЛ высвобождения 16), если бехир уже никого не сдавливает, и, пока захват длится, опутана.' },
    ],
    actions: [
      ['Электрическое дыхание (перезарядка 5–6)', 'Выдыхает молнию линией длиной 20 фт. и шириной 5 фт. Каждое существо на линии совершает спасбросок Ловкости со СЛ 16, получая 66 (12d10) урона электричеством при провале или половину при успехе.'],
      ['Проглатывание', 'Атакует укусом схваченное им существо Среднего размера или меньше. При попадании существо ещё и проглочено, а захват заканчивается. Проглоченное существо ослеплено и опутано, у него полное укрытие от атак и других эффектов снаружи, и в начале каждого хода бехира оно получает 21 (6d6) урона кислотой. Если за один ход бехир получает от проглоченного 30 урона или больше, в конце этого хода он должен преуспеть в спасброске Телосложения со СЛ 14, иначе отрыгивает существо; оно падает ничком в пределах 10 фт. от него. Бехир держит в себе только одно существо. Если он умирает, проглоченное существо больше не опутано и может выбраться из трупа, потратив 15 фт. перемещения; выбирается оно сбитым с ног.'],
    ],
  },
  {
    index: 'bone-devil', name: 'Bone Devil', nameRu: 'Костяной дьявол', size: 'large', type: 'исчадие (дьявол)', alignment: 'законно-злой',
    ac: 19, acNote: 'природный доспех', hp: 142, hitDice: '15d10+60', speed: 40, speedNote: 'летая 40 фт.', abilities: [18, 16, 18, 13, 14, 16],
    saves: { intelligence: 5, wisdom: 6, charisma: 7 }, skills: { deception: 7, insight: 6 },
    resistant: ['cold', 'nonmagical'], immune: ['fire', 'poison'], defenseNote: 'Сопротивление: посеребрённое оружие пробивает.', conditionImmunities: 'отравление',
    darkvision: 120, passive: 12, languages: 'Инфернальный, телепатия 120 фт.', cr: 9,
    traits: [DEVILS_SIGHT, MAGIC_RESISTANCE],
    multiattack: { count: 3, text: 'Совершает три атаки: две когтями и одну жалом.' },
    attacks: [
      { name: 'Коготь', kind: 'melee', ability: 'strength', toHit: 8, reach: 10, damage: '1d8+4', average: 8, type: 'slashing' },
      { name: 'Жало', kind: 'melee', ability: 'strength', toHit: 8, reach: 10, damage: '2d8+4', average: 13, type: 'piercing', extra: { damage: '5d6', average: 17, type: 'poison' }, note: 'Цель должна преуспеть в спасброске Телосложения со СЛ 14, иначе отравлена на 1 минуту. Она повторяет спасбросок в конце каждого своего хода, заканчивая эффект при успехе.' },
    ],
  },
  {
    index: 'clay-golem', name: 'Clay Golem', nameRu: 'Глиняный голем', size: 'large', type: 'конструкт', alignment: 'без мировоззрения',
    ac: 14, acNote: 'природный доспех', hp: 133, hitDice: '14d10+56', speed: 20, abilities: [20, 9, 18, 3, 8, 1],
    immune: ['acid', 'poison', 'psychic', 'nonmagical'], defenseNote: 'Иммунитет: адамантиновое оружие пробивает.', conditionImmunities: 'испуг, истощение, окаменение, отравление, очарование, паралич',
    darkvision: 60, passive: 9, languages: 'понимает языки своего создателя, но не говорит', cr: 9,
    traits: [
      ['Поглощение кислоты', 'Получая урон кислотой, не получает урона, а восстанавливает столько хитов, сколько урона кислотой нанесено.'],
      ['Берсерк', 'Каждый раз, начиная ход с 60 хитами или меньше, голем бросает d6. На 6 он впадает в неистовство: в каждый свой ход атакует ближайшее видимое существо, а если до такого не добраться — предмет, предпочитая те, что меньше его. Неистовство длится, пока голем не уничтожен или не восстановит все хиты.'],
      IMMUTABLE_FORM,
      MAGIC_RESISTANCE,
      MAGIC_WEAPONS,
    ],
    multiattack: { count: 2, text: 'Совершает две атаки ударом.' },
    attacks: [
      { name: 'Удар', kind: 'melee', ability: 'strength', toHit: 8, reach: 5, damage: '2d10+5', average: 16, type: 'bludgeoning', quirk: true, note: 'Если цель — существо, она должна преуспеть в спасброске Телосложения со СЛ 15, иначе её максимум хитов уменьшается на величину полученного урона. Если максимум хитов падает до 0, цель умирает. Уменьшение снимает только заклинание высшее восстановление или другая магия.' },
    ],
    actions: [
      ['Ускорение (перезарядка 5–6)', 'До конца своего следующего хода голем магически получает бонус +2 к КД, совершает с преимуществом спасброски Ловкости и может бонусным действием атаковать ударом.'],
    ],
  },
  {
    index: 'cloud-giant', name: 'Cloud Giant', nameRu: 'Облачный великан', size: 'huge', type: 'великан', alignment: 'нейтрально-добрый (50%) или нейтрально-злой (50%)',
    ac: 14, acNote: 'природный доспех', hp: 200, hitDice: '16d12+96', speed: 40, abilities: [27, 10, 22, 12, 16, 16],
    saves: { constitution: 10, wisdom: 7, charisma: 7 }, skills: { insight: 7, perception: 7 },
    passive: 17, languages: 'Общий, Великаний', cr: 9,
    traits: [KEEN_SMELL],
    multiattack: { count: 2, text: 'Совершает две атаки моргенштерном.' },
    attacks: [
      { name: 'Моргенштерн', kind: 'melee', ability: 'strength', toHit: 12, reach: 10, damage: '3d8+8', average: 21, type: 'piercing' },
      { name: 'Камень', kind: 'ranged', ability: 'strength', toHit: 12, range: [60, 240], damage: '4d10+8', average: 30, type: 'bludgeoning' },
    ],
    spellcasting: {
      ability: 'charisma', slots: [],
      spells: ['detect-magic', 'fog-cloud', 'light', 'feather-fall', 'fly', 'misty-step', 'telekinesis', 'control-weather', 'gaseous-form'],
      slotless: ['detect-magic', 'fog-cloud', 'light', 'feather-fall', 'fly', 'misty-step', 'telekinesis', 'control-weather', 'gaseous-form'],
      text: 'Врождённая базовая характеристика — Харизма (). Может накладывать следующие заклинания, не нуждаясь в материальных компонентах: неограниченно — обнаружение магии, туманное облако, свет; 3/день каждое — падение пёрышком, полёт, туманный шаг, телекинез; 1/день каждое — власть над погодой, газообразная форма.',
    },
  },
  {
    index: 'deva', name: 'Deva', nameRu: 'Дэва', size: 'medium', type: 'небожитель', alignment: 'законно-добрый',
    ac: 17, acNote: 'природный доспех', hp: 136, hitDice: '16d8+64', speed: 30, speedNote: 'летая 90 фт.', abilities: [18, 18, 18, 17, 20, 20],
    saves: { wisdom: 9, charisma: 9 }, skills: { insight: 9, perception: 9 },
    resistant: ['radiant', 'nonmagical'], conditionImmunities: 'испуг, истощение, очарование',
    darkvision: 120, passive: 19, languages: 'все, телепатия 120 фт.', cr: 10,
    traits: [
      ['Ангельское оружие', 'Атаки оружием дэвы магические. Попадая любым оружием, она наносит дополнительно 4d8 урона излучением (учтено в атаке).'],
      MAGIC_RESISTANCE,
    ],
    multiattack: { count: 2, text: 'Совершает две рукопашные атаки.' },
    attacks: [
      { name: 'Булава', kind: 'melee', ability: 'strength', toHit: 8, reach: 5, damage: '1d6+4', average: 7, type: 'bludgeoning', extra: { damage: '4d8', average: 18, type: 'radiant' } },
    ],
    actions: [
      ['Исцеляющее касание (3/день)', 'Касается другого существа. Цель магически восстанавливает 20 (4d8 + 2) хитов и избавляется от любых проклятий, болезней, ядов, слепоты и глухоты.'],
      ['Смена облика', 'Магически превращается в гуманоида или зверя с опасностью не выше своей либо возвращается в истинный облик. После смерти возвращается в истинный облик. Снаряжение по выбору дэвы поглощается новым обликом или остаётся на нём. В новом облике дэва сохраняет игровые характеристики и речь, но КД, способы перемещения, Сила, Ловкость и особые чувства заменяются теми, что у нового облика, и он получает недостающие свойства облика (кроме умений классов, легендарных действий и действий логова).'],
    ],
    spellcasting: {
      ability: 'charisma', slots: [],
      spells: ['detect-evil-and-good', 'commune', 'raise-dead'],
      slotless: ['detect-evil-and-good', 'commune', 'raise-dead'],
      text: 'Врождённая базовая характеристика — Харизма (СЛ спасброска 17). Может накладывать следующие заклинания, нуждаясь только в словесных компонентах: неограниченно — обнаружение зла и добра; 1/день каждое — общение, оживление.',
    },
  },
  {
    index: 'djinni', name: 'Djinni', nameRu: 'Джинн', size: 'large', type: 'элементаль', alignment: 'хаотично-добрый',
    ac: 17, acNote: 'природный доспех', hp: 161, hitDice: '14d10+84', speed: 30, speedNote: 'летая 90 фт.', abilities: [21, 15, 22, 15, 16, 20],
    saves: { dexterity: 6, wisdom: 7, charisma: 9 },
    immune: ['lightning', 'thunder'],
    darkvision: 120, passive: 13, languages: 'Ауран', cr: 11,
    traits: [['Стихийная гибель', 'Умирая, джинн рассыпается тёплым ветерком, после него остаётся лишь снаряжение, которое он нёс и носил.']],
    multiattack: { count: 3, text: 'Совершает три атаки скимитаром.' },
    attacks: [
      { name: 'Скимитар', kind: 'melee', ability: 'strength', toHit: 9, reach: 5, damage: '2d6+5', average: 12, type: 'slashing', note: 'Плюс 3 (1d6) урона электричеством или звуком (на выбор джинна).' },
    ],
    actions: [
      ['Создание вихря', 'В видимой джинном точке в пределах 120 фт. магически возникает цилиндр кружащегося воздуха радиусом 5 фт. и высотой 30 фт. Вихрь держится, пока джинн сохраняет концентрацию (как на заклинании). Любое существо, кроме джинна, входящее в вихрь, должно преуспеть в спасброске Силы со СЛ 18, иначе опутано им. Джинн может действием переместить вихрь на расстояние до 60 фт.; опутанные существа перемещаются вместе с ним. Вихрь исчезает, если джинн теряет его из виду. Существо может действием освободить опутанного вихрем, в том числе себя, успешной проверкой Силы со СЛ 18; освобождённый переходит в ближайшее пространство вне вихря.'],
    ],
    spellcasting: {
      ability: 'charisma', slots: [],
      spells: ['detect-evil-and-good', 'detect-magic', 'thunderwave', 'create-food-and-water', 'tongues', 'wind-walk', 'conjure-elemental', 'creation', 'gaseous-form', 'invisibility', 'major-image', 'plane-shift'],
      slotless: ['detect-evil-and-good', 'detect-magic', 'thunderwave', 'create-food-and-water', 'tongues', 'wind-walk', 'conjure-elemental', 'creation', 'gaseous-form', 'invisibility', 'major-image', 'plane-shift'],
      text: 'Врождённая базовая характеристика — Харизма (СЛ спасброска 17, +9 к попаданию заклинаниями). Может накладывать следующие заклинания, не нуждаясь в материальных компонентах: неограниченно — обнаружение зла и добра, обнаружение магии, волна грома; 3/день каждое — сотворение пищи и воды (может сотворить вино вместо воды), языки, хождение по ветру; 1/день каждое — призыв элементаля (только воздушного элементаля), сотворение, газообразная форма, невидимость, образ, уход в иной мир.',
    },
  },
  {
    index: 'efreeti', name: 'Efreeti', nameRu: 'Ифрит', size: 'large', type: 'элементаль', alignment: 'законно-злой',
    ac: 17, acNote: 'природный доспех', hp: 200, hitDice: '16d10+112', speed: 40, speedNote: 'летая 60 фт.', abilities: [22, 12, 24, 16, 15, 16],
    saves: { intelligence: 7, wisdom: 6, charisma: 7 },
    immune: ['fire'],
    darkvision: 120, passive: 12, languages: 'Игнан', cr: 11,
    traits: [['Стихийная гибель', 'Умирая, ифрит исчезает во вспышке пламени и клубе дыма, после него остаётся лишь снаряжение, которое он нёс и носил.']],
    multiattack: { count: 2, text: 'Совершает две атаки скимитаром или дважды применяет Метание пламени.' },
    attacks: [
      { name: 'Скимитар', kind: 'melee', ability: 'strength', toHit: 10, reach: 5, damage: '2d6+6', average: 13, type: 'slashing', extra: { damage: '2d6', average: 7, type: 'fire' } },
      { name: 'Метание пламени', kind: 'ranged', ability: 'dexterity', toHit: 7, range: [120, 120], damage: '5d6', average: 17, type: 'fire', quirk: true },
    ],
    spellcasting: {
      ability: 'charisma', slots: [],
      spells: ['detect-magic', 'enlarge-reduce', 'tongues', 'conjure-elemental', 'gaseous-form', 'invisibility', 'major-image', 'plane-shift', 'wall-of-fire'],
      slotless: ['detect-magic', 'enlarge-reduce', 'tongues', 'conjure-elemental', 'gaseous-form', 'invisibility', 'major-image', 'plane-shift', 'wall-of-fire'],
      text: 'Врождённая базовая характеристика — Харизма (СЛ спасброска 15, +7 к попаданию заклинаниями). Может накладывать следующие заклинания, не нуждаясь в материальных компонентах: неограниченно — обнаружение магии; 3/день каждое — увеличение/уменьшение, языки; 1/день каждое — призыв элементаля (только огненного элементаля), газообразная форма, невидимость, образ, уход в иной мир, огненная стена.',
    },
  },
  {
    index: 'erinyes', name: 'Erinyes', nameRu: 'Эриния', size: 'medium', type: 'исчадие (дьявол)', alignment: 'законно-злой',
    ac: 18, acNote: 'латы', hp: 153, hitDice: '18d8+72', speed: 30, speedNote: 'летая 60 фт.', abilities: [18, 16, 18, 14, 14, 18],
    saves: { dexterity: 7, constitution: 8, wisdom: 6, charisma: 8 },
    resistant: ['cold', 'nonmagical'], immune: ['fire', 'poison'], defenseNote: 'Сопротивление: посеребрённое оружие пробивает.', conditionImmunities: 'отравление',
    senses: 'истинное зрение 120 фт.', passive: 12, languages: 'Инфернальный, телепатия 120 фт.', cr: 12,
    traits: [
      ['Адское оружие', 'Атаки оружием эринии магические и при попадании наносят дополнительно 13 (3d8) урона ядом (учтено в атаках).'],
      MAGIC_RESISTANCE,
    ],
    multiattack: { count: 3, text: 'Совершает три атаки.' },
    attacks: [
      { name: 'Длинный меч', kind: 'melee', ability: 'strength', toHit: 8, reach: 5, damage: '1d8+4', average: 8, type: 'slashing', versatile: '1d10+4', extra: { damage: '3d8', average: 13, type: 'poison' } },
      { name: 'Длинный лук', kind: 'ranged', ability: 'dexterity', toHit: 7, range: [150, 600], damage: '1d8+3', average: 7, type: 'piercing', extra: { damage: '3d8', average: 13, type: 'poison' }, note: 'Цель должна преуспеть в спасброске Телосложения со СЛ 14, иначе отравлена. Отравление длится, пока его не снимет заклинание малое восстановление или подобная магия.' },
    ],
    reactions: [PARRY(4)],
  },
  {
    index: 'fire-giant', name: 'Fire Giant', nameRu: 'Огненный великан', size: 'huge', type: 'великан', alignment: 'законно-злой',
    ac: 18, acNote: 'латы', hp: 162, hitDice: '13d12+78', speed: 30, abilities: [25, 9, 23, 10, 14, 13],
    saves: { dexterity: 3, constitution: 10, charisma: 5 }, skills: { athletics: 11, perception: 6 },
    immune: ['fire'],
    passive: 16, languages: 'Великаний', cr: 9,
    multiattack: { count: 2, text: 'Совершает две атаки двуручным мечом.' },
    attacks: [
      { name: 'Двуручный меч', kind: 'melee', ability: 'strength', toHit: 11, reach: 10, damage: '6d6+7', average: 28, type: 'slashing' },
      { name: 'Камень', kind: 'ranged', ability: 'strength', toHit: 11, range: [60, 240], damage: '4d10+7', average: 29, type: 'bludgeoning' },
    ],
  },
  {
    index: 'glabrezu', name: 'Glabrezu', nameRu: 'Глабрезу', size: 'large', type: 'исчадие (демон)', alignment: 'хаотично-злой',
    ac: 17, acNote: 'природный доспех', hp: 157, hitDice: '15d10+75', speed: 40, abilities: [20, 15, 21, 19, 17, 16],
    saves: { strength: 9, constitution: 9, wisdom: 7, charisma: 7 },
    resistant: ['cold', 'fire', 'lightning', 'nonmagical'], immune: ['poison'], conditionImmunities: 'отравление',
    senses: 'истинное зрение 120 фт.', passive: 13, languages: 'Бездны, телепатия 120 фт.', cr: 9,
    traits: [MAGIC_RESISTANCE],
    multiattack: { count: 4, text: 'Совершает четыре атаки: две клешнями и две кулаками. Или совершает две атаки клешнями и накладывает одно заклинание.' },
    attacks: [
      { name: 'Клешня', kind: 'melee', ability: 'strength', toHit: 9, reach: 10, damage: '2d10+5', average: 16, type: 'bludgeoning', note: 'Если цель — существо Среднего размера или меньше, она схвачена (СЛ высвобождения 15). У глабрезу две клешни, каждая держит только одну цель.' },
      { name: 'Кулак', kind: 'melee', ability: 'strength', toHit: 9, reach: 5, damage: '2d4+2', average: 7, type: 'bludgeoning' },
    ],
    spellcasting: {
      ability: 'intelligence', slots: [],
      spells: ['darkness', 'detect-magic', 'dispel-magic', 'confusion', 'fly', 'power-word-stun'],
      slotless: ['darkness', 'detect-magic', 'dispel-magic', 'confusion', 'fly', 'power-word-stun'],
      text: 'Врождённая базовая характеристика — Интеллект (СЛ спасброска 16). Может накладывать следующие заклинания, не нуждаясь в материальных компонентах: неограниченно — тьма, обнаружение магии, рассеивание магии; 1/день каждое — смятение, полёт, слово силы: ошеломление.',
    },
  },
  {
    index: 'guardian-naga', name: 'Guardian Naga', nameRu: 'Нага-страж', size: 'large', type: 'чудовище', alignment: 'законно-добрый',
    ac: 18, acNote: 'природный доспех', hp: 127, hitDice: '15d10+45', speed: 40, abilities: [19, 18, 16, 16, 19, 18],
    saves: { dexterity: 8, constitution: 7, intelligence: 7, wisdom: 8, charisma: 8 },
    immune: ['poison'], conditionImmunities: 'отравление, очарование',
    darkvision: 60, passive: 14, languages: 'Небесный, Общий', cr: 10,
    traits: [['Омоложение', 'Умерев, нага через 1d6 дней оживает со всеми хитами. Помешать этому может только заклинание исполнение желаний.']],
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 8, reach: 10, damage: '1d8+4', average: 8, type: 'piercing', note: 'Цель совершает спасбросок Телосложения со СЛ 15, получая 45 (10d8) урона ядом при провале или половину при успехе.' },
      { name: 'Ядовитый плевок', kind: 'ranged', ability: 'dexterity', toHit: 8, range: [15, 30], damage: null, note: 'Цель совершает спасбросок Телосложения со СЛ 15, получая 45 (10d8) урона ядом при провале или половину при успехе.' },
    ],
    spellcasting: {
      ability: 'wisdom', slots: [4, 3, 3, 3, 2, 1],
      spells: ['mending', 'sacred-flame', 'thaumaturgy', 'command', 'cure-wounds', 'shield-of-faith', 'calm-emotions', 'hold-person', 'bestow-curse', 'clairvoyance', 'banishment', 'freedom-of-movement', 'flame-strike', 'geas', 'true-seeing'],
      text: 'Заклинатель 11-го уровня, базовая характеристика — Мудрость (СЛ спасброска 16, +8 к попаданию заклинаниями). Подготовлены заклинания жреца: заговоры — починка, священное пламя, чудотворство; 1-й круг (4 ячейки) — приказ, лечение ран, щит веры; 2-й круг (3 ячейки) — умиротворение, удержание личности; 3-й круг (3 ячейки) — проклятие, подсматривание; 4-й круг (3 ячейки) — изгнание, свобода перемещения; 5-й круг (2 ячейки) — небесный огонь, обет; 6-й круг (1 ячейка) — истинное зрение.',
    },
  },
  {
    index: 'gynosphinx', name: 'Gynosphinx', nameRu: 'Гиносфинкс', size: 'large', type: 'чудовище', alignment: 'законно-нейтральный',
    ac: 17, acNote: 'природный доспех', hp: 136, hitDice: '16d10+48', speed: 40, speedNote: 'летая 60 фт.', abilities: [18, 15, 16, 18, 18, 18],
    skills: { arcana: 12, history: 12, perception: 8, religion: 8 },
    resistant: ['nonmagical'], immune: ['psychic'], conditionImmunities: 'испуг, очарование',
    senses: 'истинное зрение 120 фт.', passive: 18, languages: 'Общий, Сфинксов', cr: 11,
    traits: [
      ['Непостижимость', 'Иммунитет к любым эффектам, которые чувствуют его эмоции или читают мысли, и к заклинаниям прорицания, которым он отказывает. Проверки Мудрости (Проницательность), чтобы понять намерения или искренность сфинкса, совершаются с помехой.'],
      MAGIC_WEAPONS,
    ],
    multiattack: { count: 2, text: 'Совершает две атаки когтями.' },
    attacks: [
      { name: 'Коготь', kind: 'melee', ability: 'strength', toHit: 9, reach: 5, damage: '2d8+4', average: 13, type: 'slashing', quirk: true },
    ],
    legendary: {
      actions: 3,
      options: [
        { name: 'Атака когтем', cost: 1, text: 'Совершает одну атаку когтем.' },
        { name: 'Телепортация', cost: 2, text: 'Магически телепортируется вместе с тем, что несёт и носит, на расстояние до 120 фт. в видимое незанятое пространство.' },
        { name: 'Заклинание', cost: 3, text: 'Накладывает заклинание из списка подготовленных, тратя ячейку как обычно.' },
      ],
    },
    spellcasting: {
      ability: 'intelligence', slots: [4, 3, 3, 3, 1],
      spells: ['mage-hand', 'minor-illusion', 'prestidigitation', 'detect-magic', 'identify', 'shield', 'darkness', 'locate-object', 'suggestion', 'dispel-magic', 'remove-curse', 'tongues', 'banishment', 'greater-invisibility', 'legend-lore'],
      text: 'Заклинатель 9-го уровня, базовая характеристика — Интеллект (СЛ спасброска 16, +8 к попаданию заклинаниями). Подготовлены заклинания волшебника: заговоры — волшебная рука, малая иллюзия, фокусы; 1-й круг (4 ячейки) — обнаружение магии, опознание, щит; 2-й круг (3 ячейки) — тьма, поиск предмета, внушение; 3-й круг (3 ячейки) — рассеивание магии, снятие проклятия, языки; 4-й круг (3 ячейки) — изгнание, высшая невидимость; 5-й круг (1 ячейка) — знание легенд.',
    },
  },
  {
    index: 'horned-devil', name: 'Horned Devil', nameRu: 'Рогатый дьявол', size: 'large', type: 'исчадие (дьявол)', alignment: 'законно-злой',
    ac: 18, acNote: 'природный доспех', hp: 178, hitDice: '17d10+85', speed: 20, speedNote: 'летая 60 фт.', abilities: [22, 17, 21, 12, 16, 17],
    saves: { strength: 10, dexterity: 7, wisdom: 7, charisma: 7 },
    resistant: ['cold', 'nonmagical'], immune: ['fire', 'poison'], defenseNote: 'Сопротивление: посеребрённое оружие пробивает.', conditionImmunities: 'отравление',
    darkvision: 120, passive: 13, languages: 'Инфернальный, телепатия 120 фт.', cr: 11,
    traits: [DEVILS_SIGHT, MAGIC_RESISTANCE],
    multiattack: { count: 3, text: 'Совершает три рукопашные атаки: две вилами и одну хвостом. Любую рукопашную атаку может заменить Метанием пламени.' },
    attacks: [
      { name: 'Вилы', kind: 'melee', ability: 'strength', toHit: 10, reach: 10, damage: '2d8+6', average: 15, type: 'piercing' },
      { name: 'Хвост', kind: 'melee', ability: 'strength', toHit: 10, reach: 10, damage: '1d8+6', average: 10, type: 'piercing', note: 'Если цель — существо, но не нежить и не конструкт, она должна преуспеть в спасброске Телосложения со СЛ 17, иначе от адской раны теряет 10 (3d6) хитов в начале каждого своего хода. Каждое новое попадание дьявола этой атакой по раненой цели увеличивает урон раны на 10 (3d6). Любое существо может действием остановить кровь успешной проверкой Мудрости (Медицина) со СЛ 12. Рана закрывается и от магического лечения.' },
      { name: 'Метание пламени', kind: 'ranged', ability: 'dexterity', toHit: 7, range: [150, 150], damage: '4d6', average: 14, type: 'fire', note: 'Если цель — горючий предмет, который никто не несёт и не носит, он ещё и загорается.' },
    ],
  },
  {
    index: 'remorhaz', name: 'Remorhaz', nameRu: 'Ремораз', size: 'huge', type: 'чудовище', alignment: 'без мировоззрения',
    ac: 17, acNote: 'природный доспех', hp: 195, hitDice: '17d12+85', speed: 30, speedNote: 'копая 20 фт.', abilities: [24, 13, 21, 4, 10, 5],
    immune: ['cold', 'fire'],
    darkvision: 60, senses: 'чувство вибрации 60 фт.', passive: 10, languages: '—', cr: 11,
    traits: [
      ['Раскалённое тело', 'Существо, которое касается ремораза или попадает по нему рукопашной атакой, находясь в пределах 5 фт., получает 10 (3d6) урона огнём.'],
    ],
    attacks: [
      { name: 'Укус', kind: 'melee', ability: 'strength', toHit: 11, reach: 10, damage: '6d10+7', average: 40, type: 'piercing', extra: { damage: '3d6', average: 10, type: 'fire' }, note: 'Если цель — существо, она схвачена (СЛ высвобождения 17). Пока захват длится, цель опутана, а ремораз не может кусать другую цель.' },
    ],
    actions: [
      ['Проглатывание', 'Атакует укусом схваченное им существо Среднего размера или меньше. При попадании существо получает урон укуса и проглочено, а захват заканчивается. Проглоченное существо ослеплено и опутано, у него полное укрытие от атак и других эффектов снаружи, и в начале каждого хода ремораза оно получает 21 (6d6) урона кислотой. Если за один ход ремораз получает от проглоченного 30 урона или больше, в конце этого хода он должен преуспеть в спасброске Телосложения со СЛ 15, иначе отрыгивает всех проглоченных; они падают ничком в пределах 10 фт. от него. Если он умирает, проглоченное существо больше не опутано и может выбраться из трупа, потратив 15 фт. перемещения; выбирается оно сбитым с ног.'],
    ],
  },
  {
    index: 'roc', name: 'Roc', nameRu: 'Рух', size: 'gargantuan', type: 'чудовище', alignment: 'без мировоззрения',
    ac: 15, acNote: 'природный доспех', hp: 248, hitDice: '16d20+80', speed: 20, speedNote: 'летая 120 фт.', abilities: [28, 10, 20, 3, 10, 9],
    saves: { dexterity: 4, constitution: 9, wisdom: 4, charisma: 3 }, skills: { perception: 4 },
    passive: 14, languages: '—', cr: 11,
    traits: [KEEN_SIGHT],
    multiattack: { count: 2, text: 'Совершает две атаки: одну клювом и одну когтями.' },
    attacks: [
      { name: 'Клюв', kind: 'melee', ability: 'strength', toHit: 13, reach: 10, damage: '4d8+9', average: 27, type: 'piercing' },
      { name: 'Когти', kind: 'melee', ability: 'strength', toHit: 13, reach: 5, damage: '4d6+9', average: 23, type: 'slashing', note: 'Цель схвачена (СЛ высвобождения 19). Пока захват длится, цель опутана, а рух не может хватать когтями другую цель.' },
    ],
  },
  {
    index: 'stone-golem', name: 'Stone Golem', nameRu: 'Каменный голем', size: 'large', type: 'конструкт', alignment: 'без мировоззрения',
    ac: 17, acNote: 'природный доспех', hp: 178, hitDice: '17d10+85', speed: 30, abilities: [22, 9, 20, 3, 11, 1],
    immune: ['poison', 'psychic', 'nonmagical'], defenseNote: 'Иммунитет: адамантиновое оружие пробивает.', conditionImmunities: 'испуг, истощение, окаменение, отравление, очарование, паралич',
    darkvision: 120, passive: 10, languages: 'понимает языки своего создателя, но не говорит', cr: 10,
    traits: [IMMUTABLE_FORM, MAGIC_RESISTANCE, MAGIC_WEAPONS],
    multiattack: { count: 2, text: 'Совершает две атаки ударом.' },
    attacks: [{ name: 'Удар', kind: 'melee', ability: 'strength', toHit: 10, reach: 5, damage: '3d8+6', average: 19, type: 'bludgeoning' }],
    actions: [
      ['Замедление (перезарядка 5–6)', 'Выбирает одно или несколько существ, которых видит в пределах 10 фт. Каждая цель совершает спасбросок Мудрости со СЛ 17 от этой магии. При провале цель не может совершать реакции, её скорость уменьшается вдвое, в свой ход она совершает не больше одной атаки и только действие или бонусное действие, но не оба. Эффекты длятся 1 минуту. Цель повторяет спасбросок в конце каждого своего хода, заканчивая эффект при успехе.'],
    ],
  },
  {
    index: 'treant', name: 'Treant', nameRu: 'Трент', size: 'huge', type: 'растение', alignment: 'хаотично-добрый',
    ac: 16, acNote: 'природный доспех', hp: 138, hitDice: '12d12+60', speed: 30, abilities: [23, 8, 21, 12, 16, 12],
    vulnerable: ['fire'], resistant: ['bludgeoning', 'piercing'],
    passive: 13, languages: 'Общий, Друидический, Эльфийский, Сильван', cr: 9,
    traits: [['Обманчивый вид', 'Пока трент неподвижен, его не отличить от обычного дерева.'], SIEGE_MONSTER],
    multiattack: { count: 2, text: 'Совершает две атаки ударом.' },
    attacks: [
      { name: 'Удар', kind: 'melee', ability: 'strength', toHit: 10, reach: 5, damage: '3d6+6', average: 16, type: 'bludgeoning' },
      { name: 'Камень', kind: 'ranged', ability: 'strength', toHit: 10, range: [60, 180], damage: '4d10+6', average: 28, type: 'bludgeoning' },
    ],
    actions: [
      ['Оживление деревьев (1/день)', 'Магически оживляет одно или два дерева, которые видит в пределах 60 фт. Их характеристики как у трента, но Интеллект и Харизма равны 1, они не говорят и из действий у них только Удар. Оживлённое дерево — союзник трента. Оно остаётся живым 1 день или пока не погибнет, пока трент не умрёт или не отойдёт от него дальше чем на 120 фт. или пока трент бонусным действием не вернёт его в обычное состояние. Тогда дерево по возможности укореняется.'],
    ],
  },
];
