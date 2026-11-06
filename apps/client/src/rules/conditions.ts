import type { GameIconName } from '../ui/gameIcons';

export type ConditionInfo = { code: string; label: string; icon: GameIconName; rule: string };

export const CONDITIONS: ConditionInfo[] = [
  { code: 'blinded', label: 'Ослеплён', icon: 'eyeOff', rule: 'Не видит; проверки, требующие зрения, проваливает. Его атаки — с помехой, атаки по нему — с преимуществом.' },
  { code: 'charmed', label: 'Очарован', icon: 'heart', rule: 'Не может атаковать очаровавшего; тот получает преимущество в общении с ним.' },
  { code: 'deafened', label: 'Оглох', icon: 'earOff', rule: 'Не слышит; проверки, требующие слуха, проваливает.' },
  { code: 'frightened', label: 'Испуган', icon: 'alert', rule: 'Помеха к проверкам и атакам, пока источник страха в поле зрения; не может приблизиться к нему.' },
  { code: 'grappled', label: 'Схвачен', icon: 'hand', rule: 'Скорость 0.' },
  { code: 'incapacitated', label: 'Недееспособен', icon: 'ban', rule: 'Не может совершать действия и реакции.' },
  { code: 'invisible', label: 'Невидим', icon: 'ghost', rule: 'Его атаки — с преимуществом, атаки по нему — с помехой.' },
  { code: 'paralyzed', label: 'Парализован', icon: 'bolt', rule: 'Недееспособен, не двигается; проваливает спасброски СИЛ и ЛОВ; атаки по нему — с преимуществом, попадание в упор — крит.' },
  { code: 'petrified', label: 'Окаменел', icon: 'stone', rule: 'Недееспособен; проваливает спасброски СИЛ и ЛОВ; атаки по нему — с преимуществом; сопротивление всему урону.' },
  { code: 'poisoned', label: 'Отравлен', icon: 'poison', rule: 'Помеха к броскам атаки и проверкам характеристик.' },
  { code: 'prone', label: 'Лежит ничком', icon: 'prone', rule: 'Ползёт (фут за два); его атаки — с помехой; атаки по нему в упор — с преимуществом, издали — с помехой. Встать — половина скорости.' },
  { code: 'restrained', label: 'Опутан', icon: 'chain', rule: 'Скорость 0; его атаки и спасброски ЛОВ — с помехой, атаки по нему — с преимуществом.' },
  { code: 'stunned', label: 'Ошеломлён', icon: 'spiral', rule: 'Недееспособен, не двигается; проваливает спасброски СИЛ и ЛОВ; атаки по нему — с преимуществом.' },
  { code: 'unconscious', label: 'Без сознания', icon: 'moon', rule: 'Недееспособен, лежит; проваливает спасброски СИЛ и ЛОВ; атаки по нему — с преимуществом, попадание в упор — крит.' },
];

export const EXHAUSTION_RULES = [
  'Помеха к проверкам характеристик.',
  'Скорость вдвое меньше.',
  'Помеха к атакам и спасброскам.',
  'Максимум хитов вдвое меньше.',
  'Скорость 0.',
  'Смерть.',
];

const SPECIAL: Record<string, ConditionInfo> = {
  concentration: { code: 'concentration', label: 'Концентрация', icon: 'target', rule: 'Урон требует спасброска Телосложения (СЛ 10 или половина урона); недееспособность обрывает.' },
  shield_spell: { code: 'shield_spell', label: 'Щит', icon: 'shield', rule: '+5 к КД до начала своего хода (заклинание «Щит», реакция).' },
  see_invisibility: { code: 'see_invisibility', label: 'Видит невидимое', icon: 'eye', rule: 'Видит невидимых существ, как видимых, — там, где видит глазами (заклинание «Видение невидимого»).' },
  truesight: { code: 'truesight', label: 'Истинное зрение', icon: 'eye', rule: 'В пределах дальности видит невидимое и сквозь темноту (заклинание «Истинное зрение»).' },
  dead: { code: 'dead', label: 'Мёртв', icon: 'skull', rule: 'Хиты 0: повержен.' },
  stable: { code: 'stable', label: 'Стабилен', icon: 'heartPlus', rule: 'Без сознания с 0 хитов, но больше не умирает.' },
  dodging: { code: 'dodging', label: 'Уклоняется', icon: 'dash', rule: 'До начала своего хода: атаки по нему — с помехой, его спасброски ЛОВ — с преимуществом.' },
  raging: { code: 'raging', label: 'В ярости', icon: 'flame', rule: 'Ярость варвара (минута): прибавка к урону рукопашным на Силе, сопротивление дробящему, колющему и рубящему, преимущество в проверках и спасбросках Силы; колдовать и концентрироваться нельзя.' },
  hidden: { code: 'hidden', label: 'Спрятался', icon: 'hooded', rule: 'Его не видят те, чьё пассивное Восприятие ниже его броска Скрытности. Атака из скрытности — с преимуществом и выдаёт его; поиск может его найти.' },
  bardic_inspiration: { code: 'bardic_inspiration', label: 'Кость вдохновения', icon: 'music', rule: 'От барда: прибавить кость к одной проверке, атаке или спасброску (10 минут) — переключатель «Кость» в панели действий.' },
  turned: { code: 'turned', label: 'Изгнан', icon: 'holy', rule: 'Изгнание нежити (минута): бежит, не подходит к изгнавшему ближе 30 футов, без реакций; только Рывок. Урон снимает.' },
  sacred_weapon: { code: 'sacred_weapon', label: 'Священное оружие', icon: 'sword', rule: 'Минуту: модификатор Харизмы к броскам атаки оружием.' },
  slowed: { code: 'slowed', label: 'Замедлен', icon: 'snowflake', rule: 'Скорость меньше (например, «Луч холода» — на 10 футов) до начала следующего хода заклинателя.' },
  no_reactions: { code: 'no_reactions', label: 'Без реакций', icon: 'ban', rule: 'Не может совершать реакции до начала своего хода («Хватка электричества»).' },
  no_healing: { code: 'no_healing', label: 'Не лечится', icon: 'heartOff', rule: 'Хиты не восстанавливаются до начала следующего хода заклинателя («Леденящее прикосновение»).' },
  guided: { code: 'guided', label: 'Подсвечен', icon: 'sparkle', rule: 'Следующая атака по нему — с преимуществом (до конца следующего хода заклинателя, «Направленный снаряд»).' },
  mocked: { code: 'mocked', label: 'Осмеян', icon: 'frown', rule: 'Его следующая атака — с помехой (до конца его следующего хода, «Злая насмешка»).' },
  blessed: { code: 'blessed', label: 'Благословлён', icon: 'holy', rule: '+к4 к броскам атаки и спасброскам, пока заклинатель концентрируется.' },
  baned: { code: 'baned', label: 'Под «Порчей»', icon: 'close', rule: '−к4 к броскам атаки и спасброскам, пока заклинатель концентрируется.' },
  marked: { code: 'marked', label: 'Метка охотника', icon: 'target', rule: 'Попадания оружием того, кто пометил, — ещё 1d6.' },
  outlined: { code: 'outlined', label: 'Очерчен светом', icon: 'sun', rule: 'Атаки по нему — с преимуществом; невидимость не помогает («Огонь фей»).' },
  heroism: { code: 'heroism', label: 'Героизм', icon: 'crown', rule: 'Не испугать; в начале каждого своего хода — временные хиты (модификатор заклинателя).' },
  ac_bonus: { code: 'ac_bonus', label: 'Щит веры', icon: 'shield', rule: '+2 к КД, пока заклинатель концентрируется.' },
  sanctuary: { code: 'sanctuary', label: 'Убежище', icon: 'shield', rule: 'Кто атакует его или вредит ему заклинанием — сначала спасбросок Мудрости; провал — атака или заклинание по нему потеряны. Сам нападёт — кончится.' },
  aid: { code: 'aid', label: 'Помощь', icon: 'heartPlus', rule: 'Максимум и текущие хиты больше (+5 и за ячейку выше) — до долгого отдыха.' },
  mage_armor: { code: 'mage_armor', label: 'Доспехи мага', icon: 'shield', rule: 'Без доспехов КД — 13 + Ловкость; до долгого отдыха.' },
  wild_shape: { code: 'wild_shape', label: 'Звериный облик', icon: 'paw', rule: '«Дикий облик» или «Превращение»: хиты, КД, скорость и тело зверя; хиты зверя кончились — снова в себе, лишний урон переходит. Колдовать нельзя.' },
  guidance: { code: 'guidance', label: 'Указание', icon: 'star', rule: 'Следующая проверка характеристики — +к4 (кость тратится).' },
  resistance_die: { code: 'resistance_die', label: 'Сопротивление', icon: 'shield', rule: 'Следующий спасбросок — +к4 (кость тратится).' },
  true_strike: { code: 'true_strike', label: 'Меткий удар', icon: 'crosshair', rule: 'Первая атака по выбранной цели в свой следующий ход — с преимуществом.' },
  barkskin: { code: 'barkskin', label: 'Дубовая кора', icon: 'leaf', rule: 'КД не меньше 16, какой бы ни был доспех.' },
  longstrider: { code: 'longstrider', label: 'Скороход', icon: 'run', rule: 'Скорость +10 фт. на час.' },
  expeditious: { code: 'expeditious', label: 'Поспешное отступление', icon: 'dash', rule: 'Каждый ход можно бонусным действием совершить Рывок.' },
  blurred: { code: 'blurred', label: 'Размытый образ', icon: 'fog', rule: 'Атаки по нему — с помехой (кроме тех, кто видит истинным зрением).' },
  energy_ward: { code: 'energy_ward', label: 'Защита от энергии', icon: 'shield', rule: 'Сопротивление выбранной стихии: кислота, холод, огонь, электричество или звук.' },
  stoneskin: { code: 'stoneskin', label: 'Каменная кожа', icon: 'stone', rule: 'Сопротивление немагическому дробящему, колющему и рубящему урону.' },
  death_ward: { code: 'death_ward', label: 'Защита от смерти', icon: 'heart', rule: 'Первый раз, когда хиты упали бы до 0, остаётся 1 хит — и защита кончается.' },
  shillelagh: { code: 'shillelagh', label: '«Дубинка»', icon: 'sprout', rule: '«Дубинка»: своя дубинка или боевой посох — атака и урон характеристикой заклинаний (если она лучше), кость урона к8, удар магический.' },
  magic_weapon: { code: 'magic_weapon', label: 'Магическое оружие', icon: 'sword', rule: '«Магическое оружие»: оружие (в журнале — какое) +1 к попаданию и урону (ячейка 4–5 круга — +2, 6 и выше — +3), удар магический.' },
  warding_bond: { code: 'warding_bond', label: 'Охраняющая связь', icon: 'chain', rule: '«Охраняющая связь»: КД и спасброски +1, сопротивление всему урону; заклинатель получает тот же урон. Его хиты упали до 0 — связь рвётся.' },
  beacon_of_hope: { code: 'beacon_of_hope', label: 'Маяк надежды', icon: 'sun', rule: '«Маяк надежды»: спасброски Мудрости и от смерти — с преимуществом, лечение — наибольшее.' },
  darkvision_spell: { code: 'darkvision_spell', label: 'Тёмное зрение', icon: 'eye', rule: '«Тёмное зрение»: видит в темноте на 60 фт., как в полумраке.' },
  hasted: { code: 'hasted', label: 'Ускорен', icon: 'dash', rule: '«Ускорение»: скорость вдвое, КД +2, спасброски Ловкости с преимуществом; в ход — ещё одно действие (одна атака оружием, Рывок, Отход, Засада или Использование предмета). Кончится — до конца следующего хода ни движения, ни действий.' },
  slow_spell: { code: 'slow_spell', label: 'Замедлен', icon: 'hourglass', rule: '«Замедление»: скорость вдвое меньше, КД и спасброски Ловкости −2, реакций нет; в ход — действие или бонусное действие и не больше одной атаки. Спасбросок Мудрости в конце каждого своего хода.' },
  stupor: { code: 'stupor', label: 'Оцепенение', icon: 'spiral', rule: '«Гипнотический узор»: очарован, недееспособен, скорость 0. Урон будит.' },
  lethargic: { code: 'lethargic', label: 'Вялость', icon: 'hourglass', rule: 'После «Ускорения»: до конца своего следующего хода не может ни двигаться, ни действовать.' },
  mirror_images: { code: 'mirror_images', label: 'Зеркальные отражения', icon: 'copies', rule: 'Три двойника: атака по нему может уйти в двойника (к20: при трёх — от 6, при двух — от 8, при одном — от 11); попавшая по двойнику (КД 10 + ЛОВ) — его разбивает. Истинное зрение не обмануть.' },
  summoned: { code: 'summoned', label: 'Призван', icon: 'summon', rule: 'Призван заклинанием и слушается того, кто призвал; при 0 хитов исчезает. Звери «Призыва животных» исчезают и с концом концентрации.' },
  reckless: { code: 'reckless', label: 'Безрассудная атака', icon: 'swords', rule: 'Его рукопашные атаки Силой — с преимуществом; атаки по нему — с преимуществом до начала его хода.' },
  overchannel: { code: 'overchannel', label: 'Сверхзаряд', icon: 'burst', rule: '«Сверхзаряд» уже был с долгого отдыха: следующий — некротический урон себе (2к12 за уровень заклинания и больше с каждым разом).' },
  multiattack_defense: { code: 'multiattack_defense', label: 'Защита от мультиатаки', icon: 'shield', rule: 'До конца хода следующие атаки того, кто попал, — против КД +4.' },
  empty_body: { code: 'empty_body', label: 'Пустое тело', icon: 'ghost', rule: 'Минуту: невидим, сопротивление всему урону, кроме урона силовым полем.' },
  quivering_palm: { code: 'quivering_palm', label: 'Дрожащая ладонь', icon: 'hand', rule: 'В теле — смертельная дрожь монаха: оборвёт действием — спасбросок Телосложения, провал — 0 хитов, успех — 10к10 некротического.' },
  hurled: { code: 'hurled', label: 'В аду', icon: 'flame', rule: '«Бросок через ад»: нет на поле боя до конца следующего хода колдуна; вернувшись — 10к10 психического (исчадию — ничего).' },
  holy_nimbus: { code: 'holy_nimbus', label: 'Святой нимб', icon: 'sun', rule: 'Минуту сияет: враг, начинающий ход в 30 футах, получает 10 урона излучением.' },
  dragon_wings: { code: 'dragon_wings', label: 'Драконьи крылья', icon: 'feather', rule: 'Летит со своей скоростью: местность не мешает, ямы не страшны.' },
  flying: { code: 'flying', label: 'Летит', icon: 'feather', rule: 'Скорость полёта; местность не мешает, ямы не страшны. Сбит с ног, схвачен, опутан или недееспособен — падает с высоты полёта (1к6 за 10 футов). Высота — в расстояниях: на 10 футах над головой достать можно лишь оружием с досягаемостью 10.' },
  spell_light: { code: 'spell_light', label: 'Светится', icon: 'bulb', rule: 'Свет заклинания: яркий и тусклый свет вокруг, пока длится заклинание (или концентрация). Снять — погасить.' },
  spell_darkness: { code: 'spell_darkness', label: 'Окутан тьмой', icon: 'moon', rule: 'Магическая тьма вокруг (сфера 15 футов, идёт за носителем): тёмное зрение её не видит, свет не освещает; «Дьявольское зрение» видит. «Дневной свет» рассеивает.' },
  countercharm: { code: 'countercharm', label: 'Контрочарование', icon: 'music', rule: 'До конца следующего хода барда: он и союзники в 30 футах — спасброски от испуга и очарования с преимуществом.' },
  protected_from_evil: { code: 'protected_from_evil', label: 'Защита от добра и зла', icon: 'holy', rule: 'Аберрации, небожители, элементали, феи, исчадия и нежить атакуют с помехой и не могут очаровать или испугать.' },
  draconic_presence: { code: 'draconic_presence', label: 'Драконье присутствие', icon: 'dragonEye', rule: 'Аура на 60 футов (концентрация): враг в начале своего хода — спасбросок Мудрости, провал — испуган или очарован.' },
  readied: { code: 'readied', label: 'Подготовил атаку', icon: 'hourglass', rule: 'До начала своего следующего хода: атака реакцией («Атака» → «Чем: реакцией»).' },
  presence_resisted: { code: 'presence_resisted', label: 'Устоял перед присутствием', icon: 'shield', rule: 'Устоял перед «Пугающим» или «Драконьим присутствием» — сутки неуязвим к нему.' },
};

export function conditionInfo(code: string): ConditionInfo {
  const exhaustion = /^exhaustion_([1-6])$/.exec(code);
  if (exhaustion) {
    const level = Number(exhaustion[1]);
    return { code, label: `Истощение ${level}`, icon: 'hourglass', rule: EXHAUSTION_RULES.slice(0, level).join(' ') };
  }
  return CONDITIONS.find(entry => entry.code === code) ?? SPECIAL[code] ?? { code, label: code, icon: 'sparkle', rule: '' };
}

export const ABILITY_OPTIONS = [
  ['strength', 'Сила'], ['dexterity', 'Ловкость'], ['constitution', 'Телосложение'],
  ['intelligence', 'Интеллект'], ['wisdom', 'Мудрость'], ['charisma', 'Харизма'],
] as const;

export type RollOutcome = {
  kind?: string;
  advantage?: 'none' | 'adv' | 'disadv';
  reasons?: string[];
  notes?: string[];
  autoFail?: boolean;
  target?: { id: string; name: string };
  hit?: boolean;
  critical?: boolean;
  dc?: number;
  success?: boolean;
  result?: 'success' | 'failure' | 'stable' | 'dead' | 'revived';
  successes?: number;
  failures?: number;
  applied?: number;
  blocked?: 'immune' | 'threshold' | 'dead' | 'no_healing' | null;
  modified?: 'resisted' | 'vulnerable' | null;
  text?: string;
  monsters?: Array<{ nameRu: string; count: number }>;
  shield?: { name: string; ac: number; spent: string };
};

export function outcomeText(outcome: RollOutcome | null | undefined): string {
  if (!outcome) return '';
  if (outcome.kind === 'table') {
    const monsters = (outcome.monsters ?? []).map(monster => (monster.count > 1 ? `${monster.nameRu} ×${monster.count}` : monster.nameRu)).join(', ');
    return `→ ${outcome.text ?? ''}${monsters ? ` (${monsters})` : ''}`;
  }
  if (outcome.kind === 'death') {
    return {
      success: `успех (${outcome.successes}/3)`,
      failure: `провал (${outcome.failures}/3)`,
      stable: 'стабилен',
      dead: 'смерть',
      revived: 'приходит в себя!',
    }[outcome.result ?? 'success'] ?? '';
  }
  if (outcome.kind === 'damage' && outcome.target) {
    const name = `«${outcome.target.name}»`;
    if (outcome.blocked === 'immune') return `${name}: иммунитет`;
    if (outcome.blocked === 'threshold') return `${name}: не пробито`;
    const how = outcome.modified === 'resisted' ? ' (сопротивление)' : outcome.modified === 'vulnerable' ? ' (уязвимость)' : '';
    return `${outcome.critical ? 'крит: ' : ''}урон по ${name}: ${outcome.applied ?? 0}${how}`;
  }
  if (outcome.target) {
    if (outcome.critical) return `крит по «${outcome.target.name}»!`;
    if (outcome.hit) return `попадание по «${outcome.target.name}»`;
    return outcome.shield ? `промах по «${outcome.target.name}» — «Щит», КД ${outcome.shield.ac}` : `промах по «${outcome.target.name}»`;
  }
  if (outcome.autoFail) return 'автопровал';
  if (outcome.success !== undefined) return outcome.success ? 'успех' : 'провал';
  return '';
}
