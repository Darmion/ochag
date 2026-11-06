export type SrdGear = {
  index: string;
  nameRu: string;
  category: 'gear' | 'armor' | 'ammo' | 'tools' | 'consumable' | 'focus' | 'clothes';
  priceCp: number;
  weightLb: number;
  desc?: string;
  armor?: { kind: 'light' | 'medium' | 'heavy' | 'shield'; ac: number; dex: 'full' | 'max2' | 'none'; strength?: number; stealth?: boolean };
};

const gp = (value: number) => Math.round(value * 100);
const sp = (value: number) => value * 10;

export const SRD_GEAR: SrdGear[] = [
  { index: 'backpack', nameRu: 'Рюкзак', category: 'gear', priceCp: gp(2), weightLb: 5, desc: 'Вмещает 1 кубический фут или 30 фунтов снаряжения; снаружи можно привязать ещё.' },
  { index: 'bedroll', nameRu: 'Спальник', category: 'gear', priceCp: gp(1), weightLb: 7, desc: 'Спальный мешок для ночёвки под открытым небом.' },
  { index: 'blanket', nameRu: 'Одеяло', category: 'gear', priceCp: sp(5), weightLb: 3, desc: 'Тёплое шерстяное одеяло.' },
  { index: 'candle', nameRu: 'Свеча', category: 'gear', priceCp: 1, weightLb: 0, desc: 'Горит 1 час: яркий свет на 5 фт. и тусклый ещё на 5 фт.' },
  { index: 'chain-10-feet', nameRu: 'Цепь (10 футов)', category: 'gear', priceCp: gp(5), weightLb: 10, desc: '10 хитов; разорвать — проверка Силы со СЛ 20.' },
  { index: 'crowbar', nameRu: 'Ломик', category: 'gear', priceCp: gp(2), weightLb: 5, desc: 'Преимущество к проверкам Силы, где помогает рычаг.' },
  { index: 'grappling-hook', nameRu: 'Кошка (абордажный крюк)', category: 'gear', priceCp: gp(2), weightLb: 4, desc: 'Крюк на верёвке: зацепиться за край стены или уступа, чтобы влезть.' },
  { index: 'hammer', nameRu: 'Молоток', category: 'gear', priceCp: gp(1), weightLb: 3, desc: 'Забивать шлямбуры, гвозди и колья.' },
  { index: 'hunting-trap', nameRu: 'Капкан', category: 'gear', priceCp: gp(5), weightLb: 25, desc: 'Ставится действием. Наступивший — спасбросок Ловкости со СЛ 13: провал — 1d4 колющего урона и не отойти дальше цепи (3 фт.). Освободиться — действием проверка Силы со СЛ 13; каждый провал — ещё 1 колющего урона.' },
  { index: 'lamp', nameRu: 'Лампа', category: 'gear', priceCp: sp(5), weightLb: 1, desc: 'Горит 6 часов на фляге масла: яркий свет на 15 фт. и тусклый ещё на 30 фт.' },
  { index: 'lantern-hooded', nameRu: 'Фонарь с заслонкой', category: 'gear', priceCp: gp(5), weightLb: 2, desc: 'Горит 6 часов на фляге масла: яркий свет на 30 фт. и тусклый ещё на 30 фт. Действием опустить заслонку — только тусклый свет на 5 фт.' },
  { index: 'lantern-bullseye', nameRu: 'Направленный фонарь', category: 'gear', priceCp: gp(10), weightLb: 2, desc: 'Горит 6 часов на фляге масла: конусом яркий свет на 60 фт. и тусклый ещё на 60 фт.' },
  { index: 'lock', nameRu: 'Замок', category: 'gear', priceCp: gp(10), weightLb: 1, desc: 'С ключом. Без ключа — проверка Ловкости со СЛ 15 с воровскими инструментами.' },
  { index: 'manacles', nameRu: 'Кандалы', category: 'gear', priceCp: gp(2), weightLb: 6, desc: 'Сковывают Маленькое или Среднее существо. Выскользнуть — проверка Ловкости со СЛ 20, разорвать — Силы со СЛ 20; 15 хитов. С ключом.' },
  { index: 'mirror-steel', nameRu: 'Стальное зеркальце', category: 'gear', priceCp: gp(5), weightLb: 0.5, desc: 'Стальное ручное зеркальце: заглянуть за угол, подать знак.' },
  { index: 'piton', nameRu: 'Шлямбур', category: 'gear', priceCp: 5, weightLb: 0.25, desc: 'Металлический клин: забить в трещину и закрепить верёвку.' },
  { index: 'rations-1-day', nameRu: 'Рацион (1 день)', category: 'consumable', priceCp: sp(5), weightLb: 2, desc: 'Сушёная еда в дорогу на один день: вяленое мясо, сухари, орехи.' },
  { index: 'rope-hempen-50-feet', nameRu: 'Пеньковая верёвка (50 футов)', category: 'gear', priceCp: gp(1), weightLb: 10, desc: '2 хита; разорвать — проверка Силы со СЛ 17.' },
  { index: 'rope-silk-50-feet', nameRu: 'Шёлковая верёвка (50 футов)', category: 'gear', priceCp: gp(10), weightLb: 5, desc: '2 хита; разорвать — проверка Силы со СЛ 17. Вдвое легче пеньковой.' },
  { index: 'shovel', nameRu: 'Лопата', category: 'gear', priceCp: gp(2), weightLb: 5, desc: 'Копать: ямы, рвы, могилы.' },
  { index: 'tent-two-person', nameRu: 'Палатка на двоих', category: 'gear', priceCp: gp(2), weightLb: 20, desc: 'Простая переносная палатка на двоих.' },
  { index: 'tinderbox', nameRu: 'Трутница', category: 'gear', priceCp: sp(5), weightLb: 1, desc: 'Кремень, огниво и трут. Зажечь факел, лампу или фонарь — действием, другой огонь — за минуту.' },
  { index: 'torch', nameRu: 'Факел', category: 'gear', priceCp: 1, weightLb: 1, desc: 'Горит 1 час: яркий свет на 20 фт. и тусклый ещё на 20 фт. Ударить горящим — 1 урона огнём.' },
  { index: 'waterskin', nameRu: 'Бурдюк', category: 'gear', priceCp: sp(2), weightLb: 5, desc: 'Вмещает 4 пинты воды.' },
  { index: 'ball-bearings-bag-of-1000', nameRu: 'Шарики (мешочек, 1000)', category: 'gear', priceCp: gp(1), weightLb: 2, desc: 'Действием рассыпать на квадрат 10 × 10 фт. Кто входит туда — спасбросок Ловкости со СЛ 10, провал — сбит с ног. Идущему с половинной скоростью спасбросок не нужен.' },
  { index: 'caltrops-bag-of-20', nameRu: 'Колтропы (мешочек, 20)', category: 'gear', priceCp: gp(1), weightLb: 2, desc: 'Действием рассыпать на квадрат 5 × 5 фт. Кто входит туда — спасбросок Ловкости со СЛ 15, провал — 1 колющего урона, он останавливается, скорость −10 фт., пока не восстановит хотя бы 1 хит. Идущему с половинной скоростью спасбросок не нужен.' },
  { index: 'ink-1-ounce-bottle', nameRu: 'Чернила (бутылочка)', category: 'gear', priceCp: gp(10), weightLb: 0, desc: 'Бутылочка чернил: писать, рисовать карты, переписывать заклинания.' },
  { index: 'paper-one-sheet', nameRu: 'Бумага (лист)', category: 'gear', priceCp: sp(2), weightLb: 0, desc: 'Лист бумаги.' },
  { index: 'spellbook', nameRu: 'Книга заклинаний', category: 'focus', priceCp: gp(50), weightLb: 3, desc: 'Книга волшебника: 100 листов пергамента для заклинаний.' },
  { index: 'oil-flask', nameRu: 'Масло (фляга)', category: 'consumable', priceCp: sp(1), weightLb: 1, desc: 'Действием облить существо в 5 фт. или бросить до 20 фт. (дальнобойная атака импровизированным оружием): облитый получит 5 урона огнём, если до него дойдёт огонь в течение минуты. Разлить и поджечь на квадрате 5 фт. — горит 2 раунда, 5 урона огнём входящему или кончающему там ход.' },
  { index: 'acid-vial', nameRu: 'Кислота (флакон)', category: 'consumable', priceCp: gp(25), weightLb: 1, desc: 'Действием облить существо в 5 фт. или бросить до 20 фт. (дальнобойная атака импровизированным оружием): попадание — 2d6 урона кислотой.' },
  { index: 'alchemists-fire-flask', nameRu: 'Алхимический огонь (фляга)', category: 'consumable', priceCp: gp(50), weightLb: 1, desc: 'Действием бросить до 20 фт. (дальнобойная атака импровизированным оружием): попадание — цель получает 1d4 урона огнём в начале каждого своего хода. Потушить — действием проверка Ловкости со СЛ 10.' },
  { index: 'antitoxin-vial', nameRu: 'Противоядие (флакон)', category: 'consumable', priceCp: gp(50), weightLb: 0, desc: 'Выпивший час совершает с преимуществом спасброски от яда. На нежить и конструктов не действует.' },
  { index: 'holy-water-flask', nameRu: 'Святая вода (фляга)', category: 'consumable', priceCp: gp(25), weightLb: 1, desc: 'Действием облить существо в 5 фт. или бросить до 20 фт. (дальнобойная атака импровизированным оружием): исчадие или нежить получает 2d6 урона излучением.' },
  { index: 'potion-of-healing', nameRu: 'Зелье лечения', category: 'consumable', priceCp: gp(50), weightLb: 0.5, desc: 'Выпить или напоить — действием: восстанавливает 2d4 + 2 хита.' },
  { index: 'healers-kit', nameRu: 'Набор целителя', category: 'consumable', priceCp: gp(5), weightLb: 3, desc: '10 применений. Действием — стабилизировать существо с 0 хитов без проверки Мудрости (Медицина).' },
  { index: 'arrows-20', nameRu: 'Стрелы (20)', category: 'ammo', priceCp: gp(1), weightLb: 1, desc: 'Боеприпасы для луков. После боя половину выпущенных можно собрать за минуту.' },
  { index: 'crossbow-bolts-20', nameRu: 'Арбалетные болты (20)', category: 'ammo', priceCp: gp(1), weightLb: 1.5, desc: 'Боеприпасы для арбалетов. После боя половину выпущенных можно собрать за минуту.' },
  { index: 'sling-bullets-20', nameRu: 'Снаряды для пращи (20)', category: 'ammo', priceCp: 4, weightLb: 1.5, desc: 'Боеприпасы для пращи. После боя половину выпущенных можно собрать за минуту.' },
  { index: 'component-pouch', nameRu: 'Мешочек с компонентами', category: 'focus', priceCp: gp(25), weightLb: 2, desc: 'Мешочек с материальными компонентами: заменяет те, что без цены.' },
  { index: 'arcane-focus-crystal', nameRu: 'Магическая фокусировка (кристалл)', category: 'focus', priceCp: gp(10), weightLb: 1, desc: 'Фокусировка чародея, колдуна и волшебника: вместо материальных компонентов без цены.' },
  { index: 'holy-symbol-amulet', nameRu: 'Священный символ (амулет)', category: 'focus', priceCp: gp(5), weightLb: 1, desc: 'Фокусировка жреца и паладина: держать в руке, носить на виду или на щите.' },
  { index: 'druidic-focus-sprig', nameRu: 'Друидическая фокусировка (ветка омелы)', category: 'focus', priceCp: gp(1), weightLb: 0, desc: 'Фокусировка друида и следопыта: вместо материальных компонентов без цены.' },
  { index: 'thieves-tools', nameRu: 'Воровские инструменты', category: 'tools', priceCp: gp(25), weightLb: 1, desc: 'Отмычки, напильник, зеркальце на ручке, ножницы. Владение — бонус мастерства к проверкам вскрыть замок и обезвредить ловушку.' },
  { index: 'climbers-kit', nameRu: 'Набор скалолаза', category: 'tools', priceCp: gp(25), weightLb: 12, desc: 'Шлямбуры, наконечники на сапоги, перчатки, обвязка. Действием закрепиться: не упасть дальше 25 фт. от этого места и не подняться выше, пока не отцепишься.' },
  { index: 'herbalism-kit', nameRu: 'Набор травника', category: 'tools', priceCp: gp(5), weightLb: 3, desc: 'Ножницы, ступка, мешочки. Владение — бонус мастерства к проверкам распознать и применить травы; нужен, чтобы сварить противоядие и зелье лечения.' },
  { index: 'disguise-kit', nameRu: 'Набор для грима', category: 'tools', priceCp: gp(25), weightLb: 3, desc: 'Грим, краски для волос, мелкий реквизит. Владение — бонус мастерства к проверкам изменить внешность.' },
  { index: 'clothes-common', nameRu: 'Обычная одежда', category: 'clothes', priceCp: sp(5), weightLb: 3, desc: 'Простая одежда горожанина или крестьянина.' },
  { index: 'clothes-traveler', nameRu: 'Дорожная одежда', category: 'clothes', priceCp: gp(2), weightLb: 4, desc: 'Крепкая одежда для дальней дороги: плащ с капюшоном, сапоги.' },
  { index: 'clothes-fine', nameRu: 'Богатая одежда', category: 'clothes', priceCp: gp(15), weightLb: 6, desc: 'Богатая одежда для приёмов и двора.' },
  { index: 'padded-armor', nameRu: 'Стёганый доспех', category: 'armor', priceCp: gp(5), weightLb: 8, armor: { kind: 'light', ac: 11, dex: 'full', stealth: true } },
  { index: 'leather-armor', nameRu: 'Кожаный доспех', category: 'armor', priceCp: gp(10), weightLb: 10, armor: { kind: 'light', ac: 11, dex: 'full' } },
  { index: 'studded-leather-armor', nameRu: 'Проклёпанная кожа', category: 'armor', priceCp: gp(45), weightLb: 13, armor: { kind: 'light', ac: 12, dex: 'full' } },
  { index: 'hide-armor', nameRu: 'Шкурный доспех', category: 'armor', priceCp: gp(10), weightLb: 12, armor: { kind: 'medium', ac: 12, dex: 'max2' } },
  { index: 'chain-shirt', nameRu: 'Кольчужная рубаха', category: 'armor', priceCp: gp(50), weightLb: 20, armor: { kind: 'medium', ac: 13, dex: 'max2' } },
  { index: 'scale-mail', nameRu: 'Чешуйчатый доспех', category: 'armor', priceCp: gp(50), weightLb: 45, armor: { kind: 'medium', ac: 14, dex: 'max2', stealth: true } },
  { index: 'breastplate', nameRu: 'Кираса', category: 'armor', priceCp: gp(400), weightLb: 20, armor: { kind: 'medium', ac: 14, dex: 'max2' } },
  { index: 'half-plate-armor', nameRu: 'Полулаты', category: 'armor', priceCp: gp(750), weightLb: 40, armor: { kind: 'medium', ac: 15, dex: 'max2', stealth: true } },
  { index: 'ring-mail', nameRu: 'Колечный доспех', category: 'armor', priceCp: gp(30), weightLb: 40, armor: { kind: 'heavy', ac: 14, dex: 'none', stealth: true } },
  { index: 'chain-mail', nameRu: 'Кольчуга', category: 'armor', priceCp: gp(75), weightLb: 55, armor: { kind: 'heavy', ac: 16, dex: 'none', strength: 13, stealth: true } },
  { index: 'splint-armor', nameRu: 'Наборный доспех', category: 'armor', priceCp: gp(200), weightLb: 60, armor: { kind: 'heavy', ac: 17, dex: 'none', strength: 15, stealth: true } },
  { index: 'plate-armor', nameRu: 'Латы', category: 'armor', priceCp: gp(1500), weightLb: 65, armor: { kind: 'heavy', ac: 18, dex: 'none', strength: 15, stealth: true } },
  { index: 'shield', nameRu: 'Щит', category: 'armor', priceCp: gp(10), weightLb: 6, armor: { kind: 'shield', ac: 2, dex: 'none' } },
];

export const SRD_GEAR_BY_INDEX = new Map(SRD_GEAR.map(item => [item.index, item]));
