import { FIGHTING_STYLES } from '../srd/heroes.ts';

const ABILITY_FEAT: Array<[string, string, string, string]> = [
  ['strength', 'Сила', 'Силы', 'Strength'],
  ['dexterity', 'Ловкость', 'Ловкости', 'Dexterity'],
  ['constitution', 'Телосложение', 'Телосложения', 'Constitution'],
  ['intelligence', 'Интеллект', 'Интеллекта', 'Intelligence'],
  ['wisdom', 'Мудрость', 'Мудрости', 'Wisdom'],
  ['charisma', 'Харизма', 'Харизмы', 'Charisma'],
];

export const FEATS: Array<{ id: string; nameRu: string; en: string; text: string; pattern: RegExp }> = [
  {
    id: 'alert', nameRu: 'Настороженный', en: 'Alert', text: '+5 к инициативе; атаки по вам не получают преимущества оттого, что вы атакующего не видите. Само.',
    pattern: /(Настороженн|Бдительн)(ый|ость)(?![а-яё])|\bAlert\b/,
  },
  {
    id: 'war-caster', nameRu: 'Боевой заклинатель', en: 'War Caster', text: 'Спасброски Телосложения для концентрации — с преимуществом. Само.',
    pattern: /Боев\S* заклинател|War Caster/i,
  },
  {
    id: 'sharpshooter', nameRu: 'Меткий стрелок', en: 'Sharpshooter',
    text: 'Дальнобойным оружием: дальняя дистанция без помехи, половинное и ¾ укрытие не мешают — само; −5 к попаданию / +10 к урону — галочкой в окне атаки.',
    pattern: /Метк\S* стрел|Sharpshooter/i,
  },
  {
    id: 'great-weapon-master', nameRu: 'Мастер большого оружия', en: 'Great Weapon Master', text: 'Тяжёлым рукопашным оружием: −5 к попаданию / +10 к урону — галочкой в окне атаки.',
    pattern: /Мастер больш\S* оружи|Great Weapon Master/i,
  },
  { id: 'mobile', nameRu: 'Мобильный', en: 'Mobile', text: 'Скорость +10 футов; по кому били в рукопашной в этот ход, тот не атакует вас при уходе. Само.', pattern: /(Мобильн|Подвижн)(ый|ость)(?![а-яё])|\bMobile\b/ },
  {
    id: 'observant', nameRu: 'Наблюдательный', en: 'Observant', text: '+5 к пассивному Восприятию. Само.',
    pattern: /(Наблюдательн|Внимательн)(ый|ость)(?![а-яё])|\bObservant\b/,
  },
  {
    id: 'lucky', nameRu: 'Везунчик', en: 'Lucky',
    text: '3 очка удачи до долгого отдыха: проваленный спасбросок, что бросает сервер, — ещё к20, берётся лучший (правило «Переброс проваленного спасброска»); в окне атаки — галочка «если промах — очко удачи»; к проверке — галочка в «Проверках»; против атак по вам — «наготове» здесь (попали — ещё к20, берётся меньший).',
    pattern: /Везунчик|Черта:?\s*Lucky|Feat:?\s*Lucky/i,
  },
  {
    id: 'sentinel', nameRu: 'Часовой', en: 'Sentinel',
    text: 'Атака при уходе попала — скорость цели 0 до конца её хода; «Отход» от вашей атаки при уходе не спасает; враг рядом бьёт другого — реакцией атака по нему (вопрос, НПС — сами). Само.',
    pattern: /Часов(ой|ого)(?![а-яё])|\bSentinel\b/,
  },
  {
    id: 'crossbow-expert', nameRu: 'Эксперт по арбалетам', en: 'Crossbow Expert',
    text: 'Враг в 5 футах не даёт помехи вашим дальнобойным атакам (оружием и заклинанием); бонусный выстрел ручным арбалетом — с модификатором к урону. Само.',
    pattern: /Арбалетчик|Эксперт\S* по арбалет|Crossbow Expert/i,
  },
  {
    id: 'spell-sniper', nameRu: 'Снайпер заклинаний', en: 'Spell Sniper',
    text: 'Заклинания с броском атаки — дальность вдвое, половинное и ¾ укрытие не мешают. Само.',
    pattern: /Снайпер\S* заклинани|Заклинатель-снайпер|Spell Sniper/i,
  },
  {
    id: 'savage-attacker', nameRu: 'Дикарь', en: 'Savage Attacker',
    text: 'Раз в свой ход: кости урона рукопашным оружием бросаются дважды, берётся больший результат. Само.',
    pattern: /Дикар(ь|я)(?![а-яё])|Savage Attacker/,
  },
  {
    id: 'heavy-armor-master', nameRu: 'Мастер тяжёлых доспехов', en: 'Heavy Armor Master',
    text: 'Урон дробящий, колющий и рубящий — на 3 меньше (считается, что тяжёлый доспех надет). Само.',
    pattern: /Мастер тяж\S* доспех|Heavy Armor Master/i,
  },
  {
    id: 'inspiring-leader', nameRu: 'Воодушевляющий лидер', en: 'Inspiring Leader',
    text: 'Вне боя, речь 10 минут: до 6 своих в 30 футах (и вы) — временные хиты уровень + Харизма; до короткого отдыха.',
    pattern: /(Воодушевля|Вдохновля)\S* лидер|Inspiring Leader/i,
  },
  {
    id: 'polearm-master', nameRu: 'Мастер древкового оружия', en: 'Polearm Master',
    text: 'Глефа, алебарда, пика, боевой посох, копьё: бонусная атака древком — 1d4 дробящего (атака бонусным действием этим оружием); враг входит в досягаемость — атака при уходе по нему. Само.',
    pattern: /Мастер древков\S* оружи|Polearm Master/i,
  },
  {
    id: 'shield-master', nameRu: 'Мастер щита', en: 'Shield Master',
    text: '«Толкнуть» — и бонусным действием (в «Действиях»). Само.',
    pattern: /Мастер щит|Shield Master/i,
  },
  {
    id: 'ritual-caster', nameRu: 'Ритуальный заклинатель', en: 'Ritual Caster',
    text: 'Ритуалы — как у волшебника: «ритуалом» в окне сотворения, без ячейки, +10 минут. Само.',
    pattern: /Ритуальн\S* заклинател|Ritual Caster/i,
  },
  {
    id: 'mage-slayer', nameRu: 'Убийца магов', en: 'Mage Slayer',
    text: 'Спасброски против заклинаний того, кто в 5 футах от вас, — с преимуществом; колдует рядом — реакцией атака по нему (вопрос, НПС — сами); ваш урон — помеха его спасброску концентрации. Само.',
    pattern: /Убийц\S* маг|Mage Slayer/i,
  },
  ...([['acid', 'кислота', 'Acid'], ['cold', 'холод', 'Cold'], ['fire', 'огонь', 'Fire'], ['lightning', 'электричество', 'Lightning'], ['thunder', 'звук', 'Thunder']] as const).map(([id, ru, en]) => ({
    id: `elemental-adept-${id}`, nameRu: `Стихийный адепт (${ru})`, en: `Elemental Adept (${en})`,
    text: `Ваши заклинания с уроном вида «${ru}»: сопротивление ему не помогает, единицы на костях урона — двойки. Само.`,
    pattern: new RegExp(`(Стихийн\\S* адепт|Адепт стихи\\S*)[\\s(:—–-]*${ru.slice(0, 4)}|Elemental Adept[\\s(:—–-]*${en}`, 'i'),
  })),
  {
    id: 'durable', nameRu: 'Выносливый', en: 'Durable',
    text: 'Кость хитов на коротком отдыхе даёт не меньше двух модификаторов Телосложения (не меньше 2). Само.',
    pattern: /Выносливый(?![а-яё])|\bDurable\b|Стойкий(?!\s*\()(?![а-яё])/,
  },
  {
    id: 'tough', nameRu: 'Крепкий', en: 'Tough',
    text: 'Максимум хитов +2 за уровень: взята при повышении уровня — +2 × уровень сразу, дальше — +2 за каждый. Само.',
    pattern: /Крепк(ий|ого)(?![а-яё])|\bTough\b/,
  },
  ...ABILITY_FEAT.map(([id, ru, genitive, en]) => ({
    id: `resilient-${id}`, nameRu: `Устойчивый (${ru})`, en: `Resilient (${en})`, text: `Владение спасбросками ${genitive}. Само.`,
    pattern: new RegExp(`(Стойк|Устойчив)\\S*\\s*\\(?\\s*${ru.slice(0, 5)}|Resilient\\s*\\(?\\s*${en}`, 'i'),
  })),
];

export type FeatId = string;

export const FEAT_ABILITIES: Record<string, Array<'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma'>> = {
  'heavy-armor-master': ['strength'],
  observant: ['intelligence', 'wisdom'],
  durable: ['constitution'],
  ...Object.fromEntries(ABILITY_FEAT.map(([id]) => [`resilient-${id}`, [id]])),
} as Record<string, any>;

const STYLE_EN: Record<string, string> = {
  defense: 'Defense', archery: 'Archery', dueling: 'Dueling', 'great-weapon': 'Great Weapon Fighting', protection: 'Protection', 'two-weapon': 'Two-Weapon Fighting',
};
export const STYLE_PATTERNS = FIGHTING_STYLES.map(style => ({
  ...style,
  pattern: new RegExp(`(Боев\\S* стил\\S*|Fighting Style):?\\s*«?(${style.nameRu}|${STYLE_EN[style.id] ?? style.id})`, 'i'),
}));

function marked(sheetExtra: any, key: string, list: ReadonlyArray<{ id: string; pattern: RegExp }>): string[] {
  if (Array.isArray(sheetExtra?.[key])) {
    const ids = new Set(sheetExtra[key].map(String));
    return list.filter(entry => ids.has(entry.id)).map(entry => entry.id);
  }
  const text = JSON.stringify(sheetExtra?.text ?? {});
  return list.filter(entry => entry.pattern.test(text)).map(entry => entry.id);
}

export function knownFeats(sheetExtra: unknown): FeatId[] {
  return marked(sheetExtra, 'feats', FEATS);
}

export function hasFeat(sheetExtra: unknown, id: FeatId): boolean {
  return knownFeats(sheetExtra).includes(id);
}

export function knownFightingStyles(sheetExtra: unknown): { ids: string[]; baked: string | null } {
  const extra = sheetExtra as any;
  const baked = typeof extra?.builder?.fightingStyle === 'string' ? extra.builder.fightingStyle : null;
  const ids = new Set(marked(extra, 'fightingStyles', STYLE_PATTERNS));
  if (baked) ids.add(baked);
  return { ids: FIGHTING_STYLES.map(style => style.id).filter(id => ids.has(id)), baked };
}

export function liveStyle(sheetExtra: unknown, id: string): boolean {
  const { ids, baked } = knownFightingStyles(sheetExtra);
  return ids.includes(id) && !(baked === id && (id === 'archery' || id === 'dueling'));
}

const POLEARMS = new Set(['glaive', 'halberd', 'pike', 'quarterstaff', 'spear']);
export function isPolearm(weapon: { srd_index?: string | null; name?: string | null } | null | undefined): boolean {
  if (!weapon) return false;
  if (weapon.srd_index) return POLEARMS.has(weapon.srd_index);
  return /глеф|алебард|пика|посох|копь[её]|glaive|halberd|pike|quarterstaff|spear/i.test(weapon.name ?? '');
}
export function isHandCrossbow(weapon: { srd_index?: string | null; name?: string | null } | null | undefined): boolean {
  if (!weapon) return false;
  return weapon.srd_index === 'crossbow-hand' || /ручн\S* арбалет|hand crossbow/i.test(weapon.name ?? '');
}

export function greatWeaponReroll(dice: number[], rollDie: () => number): { dice: number[]; rerolled: number } {
  let rerolled = 0;
  const next = dice.map(value => {
    if (value > 2) return value;
    rerolled += 1;
    return rollDie();
  });
  return { dice: next, rerolled };
}
