// What a condition does at the table, as a list of clauses the GM can edit per campaign. The SRD rules are the defaults;
// the engine (conditions.ts) reads only clauses, so a changed clause changes the game.
import { CONDITIONS, DAMAGE_TYPES } from '../spells/template/options.ts';

export type Option = readonly [value: string, label: string];

export const CLAUSE_KINDS = [
  'own-rolls', 'roll-bonus', 'rolls-against', 'crit-against', 'cannot-attack', 'cannot-approach', 'speed', 'cannot-act', 'resistance',
  'with-condition', 'repeat-save', 'lasts', 'note',
] as const;
export type ClauseKind = typeof CLAUSE_KINDS[number];

export type Clause = { kind: ClauseKind; values: Record<string, unknown> };

export const CONDITION_KINDS = ['condition', 'disease', 'poison', 'curse', 'effect'] as const;
export type ConditionKind = typeof CONDITION_KINDS[number];

// A course in steps: a disease that worsens or a poison that deepens. Each stage adds its own clauses to the rule's common ones.
export type ConditionStage = { name: string; clauses: Clause[] };
export const MAX_STAGES = 6;

export type ConditionRule = {
  code: string;
  name: string;
  icon: string;
  kind: ConditionKind;
  clauses: Clause[];
  stages?: ConditionStage[];
  description?: string;
  iconAssetId?: string;
  // How attacks against the creature name it in roll reasons, when «цель {name}» reads badly («цель невидима»).
  asTarget?: string;
};

type Showing = { key: string; in: readonly unknown[] };

export type FieldSpec = {
  key: string;
  label: string;
  type: 'select' | 'bool' | 'text';
  options?: readonly Option[];
  default: unknown;
  // Every listed condition must hold for the field to show.
  showIf?: Showing | readonly Showing[];
  // Options that make no sense next to another field's value, e.g. an automatic failure of an attack roll.
  hideIf?: { key: string; in: readonly unknown[]; values: readonly string[] };
  placeholder?: string;
  pattern?: RegExp;
};

export function fieldShown(field: FieldSpec, values: Record<string, unknown>): boolean {
  const list = !field.showIf ? [] : Array.isArray(field.showIf) ? field.showIf as readonly Showing[] : [field.showIf as Showing];
  return list.every(entry => entry.in.includes(values[entry.key]));
}

export const ROLL_SETS: readonly Option[] = [['attacks', 'броски атаки'], ['checks', 'проверки характеристик'], ['saves', 'спасброски'], ['all', 'все броски к20']];
export const ROLL_EFFECTS: readonly Option[] = [['disadvantage', 'с помехой'], ['advantage', 'с преимуществом'], ['fail', 'проваливаются автоматически']];
export const ABILITY_PICKS: readonly Option[] = [
  ['any', 'любой характеристики'], ['str-dex', 'Силы и Ловкости'], ['strength', 'Силы'], ['dexterity', 'Ловкости'], ['constitution', 'Телосложения'],
  ['intelligence', 'Интеллекта'], ['wisdom', 'Мудрости'], ['charisma', 'Харизмы'],
];
export const SENSES: readonly Option[] = [['any', 'любые'], ['sight', 'требующие зрения'], ['hearing', 'требующие слуха']];
export const TARGETS: readonly Option[] = [['anyone', 'по любой цели'], ['source', 'только по источнику состояния']];
export const RANGES: readonly Option[] = [['any', 'с любого расстояния'], ['near', 'в пределах 5 футов'], ['far', 'дальше 5 футов']];
export const ATTACK_BANS: readonly Option[] = [['source', 'источник состояния'], ['anyone', 'кого угодно'], ['others', 'всех, кроме источника']];
export const SPEED_MODES: readonly Option[] = [['zero', 'скорость 0'], ['half', 'скорость вдвое меньше'], ['crawl', 'только ползком: фут за два']];
export const ACT_BANS: readonly Option[] = [['all', 'действия и реакции (недееспособен)'], ['reactions', 'только реакции']];
export const ROLL_BONUSES: readonly Option[] = [-10, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 10].map(value => [String(value), value > 0 ? `+${value}` : `−${-value}`] as const);
export const LINKABLE: readonly Option[] = CONDITIONS.filter(([value]) => value !== 'exhaustion');
export const SAVE_ABILITY_CODES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;
export const SAVE_ABILITIES: readonly Option[] = [
  ...ABILITY_PICKS.filter(([value]) => (SAVE_ABILITY_CODES as readonly string[]).includes(value)), ['none', 'без спасброска'],
];
export const SAVE_DCS: readonly Option[] = Array.from({ length: 18 }, (_, index) => [String(index + 8), String(index + 8)] as const);
export const SAVE_MOMENTS: readonly Option[] = [
  ['turn-end', 'в конце каждого своего хода'], ['turn-start', 'в начале каждого своего хода'], ['long-rest', 'после каждого долгого отдыха'],
  ['hour', 'каждый час по часам кампании'], ['day', 'каждый день по часам кампании'],
];
export const SAVE_WINS: readonly Option[] = [
  ['1', 'один успех'], ['2', 'два успеха'], ['3', 'три успеха'], ['4', 'четыре успеха'], ['5', 'пять успехов'], ['7', 'семь успехов'], ['10', 'десять успехов'],
];
export const SAVE_WIN_EFFECTS: readonly Option[] = [
  ['ends', 'снимают состояние'], ['better', 'стадия легче, с первой — проходит'], ['easier', 'СЛ ниже на кость, при 0 — проходит'],
  ['exhaustion-down', 'степень истощения меньше, без истощения — проходит'],
];
export const SAVE_EASE_DICE: readonly Option[] = [['4', 'к4'], ['6', 'к6'], ['8', 'к8']];
export const SAVE_FAILS: readonly Option[] = [
  ['stays', 'ничего: состояние держится'], ['exhaustion', 'степень истощения'], ['worse', 'стадия тяжелее'], ['damage', 'урон'],
];
export const LASTS_MINUTES: readonly Option[] = [
  ['1', '1 минуту'], ['10', '10 минут'], ['60', '1 час'], ['240', '4 часа'], ['480', '8 часов'], ['1440', '24 часа'], ['10080', '7 дней'],
];
const WITH_SAVE = { key: 'ability', in: SAVE_ABILITY_CODES };
const DICE_FORMULA = /^\s*(\d{1,2}\s*[dк]\s*\d{1,3}(\s*[+-]\s*\d{1,3})?|\d{1,3})\s*$/i;

type ClauseSpec = { label: string; hint: string; fields: readonly FieldSpec[] };

export const CLAUSE_CATALOG: Readonly<Record<ClauseKind, ClauseSpec>> = {
  'own-rolls': {
    label: 'Свои броски', hint: 'Помеха, преимущество или автопровал к броскам самого существа',
    fields: [
      { key: 'rolls', label: 'Какие броски', type: 'select', options: ROLL_SETS, default: 'attacks' },
      { key: 'ability', label: 'Характеристика', type: 'select', options: ABILITY_PICKS, default: 'any', showIf: { key: 'rolls', in: ['checks', 'saves'] } },
      { key: 'sense', label: 'Какие проверки', type: 'select', options: SENSES, default: 'any', showIf: { key: 'rolls', in: ['checks'] } },
      { key: 'effect', label: 'Что с ними', type: 'select', options: ROLL_EFFECTS, default: 'disadvantage', hideIf: { key: 'rolls', in: ['attacks', 'all'], values: ['fail'] } },
      { key: 'against', label: 'Атаки', type: 'select', options: TARGETS, default: 'anyone', showIf: { key: 'rolls', in: ['attacks'] } },
      { key: 'whileSourceSeen', label: 'Только пока источник в поле зрения', type: 'bool', default: false },
      { key: 'bySight', label: 'Зависит от зрения (не действует, если видят и так)', type: 'bool', default: false, showIf: { key: 'rolls', in: ['attacks'] } },
    ],
  },
  'roll-bonus': {
    label: 'Прибавка к броскам', hint: 'Число к броскам самого существа: −2 к атакам, +1 к спасброскам',
    fields: [
      { key: 'rolls', label: 'Какие броски', type: 'select', options: ROLL_SETS, default: 'attacks' },
      { key: 'ability', label: 'Характеристика', type: 'select', options: ABILITY_PICKS, default: 'any', showIf: { key: 'rolls', in: ['checks', 'saves'] } },
      { key: 'sense', label: 'Какие проверки', type: 'select', options: SENSES, default: 'any', showIf: { key: 'rolls', in: ['checks'] } },
      { key: 'value', label: 'Сколько', type: 'select', options: ROLL_BONUSES, default: '-1' },
    ],
  },
  'rolls-against': {
    label: 'Атаки по нему', hint: 'Помеха или преимущество тем, кто атакует существо',
    fields: [
      { key: 'effect', label: 'Атаки по нему', type: 'select', options: ROLL_EFFECTS.filter(([value]) => value !== 'fail'), default: 'advantage' },
      { key: 'range', label: 'Откуда', type: 'select', options: RANGES, default: 'any' },
      { key: 'bySight', label: 'Зависит от зрения (не действует, если видят и так)', type: 'bool', default: false },
    ],
  },
  'crit-against': {
    label: 'Крит по нему', hint: 'Попадание по существу — критическое',
    fields: [{ key: 'range', label: 'Откуда', type: 'select', options: RANGES.filter(([value]) => value !== 'far'), default: 'near' }],
  },
  'cannot-attack': {
    label: 'Запрет атаки', hint: 'Кого существо не может атаковать — ни оружием, ни вредным заклинанием',
    fields: [{ key: 'whom', label: 'Нельзя атаковать', type: 'select', options: ATTACK_BANS, default: 'source' }],
  },
  'cannot-approach': {
    label: 'Не подойти', hint: 'По своей воле нельзя приблизиться к источнику',
    fields: [{ key: 'whileSeen', label: 'Только пока источник в поле зрения', type: 'bool', default: true }],
  },
  speed: {
    label: 'Скорость', hint: 'Скорость 0, вдвое меньше или только ползком',
    fields: [{ key: 'mode', label: 'Скорость', type: 'select', options: SPEED_MODES, default: 'zero' }],
  },
  'cannot-act': {
    label: 'Без действий', hint: 'Что существо не может делать',
    fields: [{ key: 'what', label: 'Не может совершать', type: 'select', options: ACT_BANS, default: 'all' }],
  },
  resistance: {
    label: 'Сопротивление', hint: 'Сопротивление урону',
    fields: [{ key: 'damage', label: 'Урон', type: 'select', options: [['all', 'всему урону']], default: 'all' }],
  },
  'with-condition': {
    label: 'Вместе с состоянием', hint: 'Пока держится, существо ещё и в другом состоянии: яд, который парализует',
    fields: [{ key: 'code', label: 'Состояние', type: 'select', options: LINKABLE, default: 'poisoned' }],
  },
  'repeat-save': {
    label: 'Повторный спасбросок', hint: 'Течение: спасбросок в конце хода, после долгого отдыха, каждый час или день',
    fields: [
      { key: 'ability', label: 'Спасбросок', type: 'select', options: SAVE_ABILITIES, default: 'constitution' },
      { key: 'dc', label: 'СЛ', type: 'select', options: SAVE_DCS, default: '12', showIf: WITH_SAVE },
      { key: 'when', label: 'Когда', type: 'select', options: SAVE_MOMENTS, default: 'turn-end' },
      { key: 'onWin', label: 'Успех', type: 'select', options: SAVE_WIN_EFFECTS, default: 'ends', showIf: WITH_SAVE },
      { key: 'wins', label: 'Чтобы снять', type: 'select', options: SAVE_WINS, default: '1', showIf: [WITH_SAVE, { key: 'onWin', in: ['ends'] }] },
      { key: 'ease', label: 'Кость', type: 'select', options: SAVE_EASE_DICE, default: '6', showIf: [WITH_SAVE, { key: 'onWin', in: ['easier'] }] },
      { key: 'onFail', label: 'При провале', type: 'select', options: SAVE_FAILS, default: 'stays' },
      { key: 'damage', label: 'Урон', type: 'text', default: '1d6', placeholder: '1d6', pattern: DICE_FORMULA, showIf: { key: 'onFail', in: ['damage'] } },
      { key: 'damageType', label: 'Вид урона', type: 'select', options: DAMAGE_TYPES, default: 'poison', showIf: { key: 'onFail', in: ['damage'] } },
    ],
  },
  lasts: {
    label: 'Длительность', hint: 'Сколько держится по часам кампании, потом проходит само',
    fields: [{ key: 'minutes', label: 'Проходит через', type: 'select', options: LASTS_MINUTES, default: '60' }],
  },
  note: {
    label: 'Заметка', hint: 'Правило, которое мастер ведёт сам: показывается в описании',
    fields: [{ key: 'text', label: 'Текст', type: 'text', default: '', placeholder: 'Например: «Каждый рассвет — спасбросок Телосложения»' }],
  },
};

export function clause(kind: ClauseKind, values: Record<string, unknown> = {}): Clause {
  const spec = CLAUSE_CATALOG[kind];
  return { kind, values: Object.fromEntries(spec.fields.map(field => [field.key, values[field.key] ?? field.default])) };
}

// A clause from the GM or a file: unknown kinds and fields are dropped, values outside their options fall back to the default.
export function normalizeClause(input: unknown): Clause | null {
  if (!input || typeof input !== 'object') return null;
  const kind = (input as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !(CLAUSE_KINDS as readonly string[]).includes(kind)) return null;
  const given = ((input as { values?: unknown }).values ?? {}) as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  for (const field of CLAUSE_CATALOG[kind as ClauseKind].fields) {
    const value = given[field.key];
    if (field.type === 'bool') values[field.key] = typeof value === 'boolean' ? value : field.default;
    else if (field.type === 'text') {
      const text = typeof value === 'string' ? value.trim().slice(0, 300) : field.default;
      values[field.key] = field.pattern && !field.pattern.test(String(text)) ? field.default : text;
    } else values[field.key] = field.options!.some(([option]) => option === value) ? value : field.default;
  }
  for (const field of CLAUSE_CATALOG[kind as ClauseKind].fields) {
    if (field.hideIf && field.hideIf.in.includes(values[field.hideIf.key]) && field.hideIf.values.includes(String(values[field.key]))) values[field.key] = field.default;
  }
  if (kind === 'note' && !values.text) return null;
  return { kind: kind as ClauseKind, values };
}

export function normalizeClauses(input: unknown, limit = 40): Clause[] {
  return (Array.isArray(input) ? input : []).slice(0, limit).map(normalizeClause).filter((entry): entry is Clause => entry !== null);
}

export function normalizeStages(input: unknown): ConditionStage[] {
  return (Array.isArray(input) ? input : []).slice(0, MAX_STAGES).map((entry, index) => {
    const raw = (entry ?? {}) as { name?: unknown; clauses?: unknown };
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : `Стадия ${index + 1}`;
    return { name, clauses: normalizeClauses(raw.clauses, 20) };
  });
}

const optionLabel = (options: readonly Option[], value: unknown) => options.find(([key]) => key === value)?.[1] ?? String(value);

// Whole sentences with their pieces as placeholders: the interface translator translates each piece on its own.
function rollsOf(v: Record<string, unknown>): string {
  const ability = v.ability === 'any' || v.ability === undefined ? null : optionLabel(ABILITY_PICKS, v.ability);
  switch (v.rolls) {
    case 'attacks': return v.against === 'source' ? 'броски атаки по источнику' : 'броски атаки';
    case 'all': return 'все броски к20';
    case 'saves': return ability ? `спасброски ${ability}` : 'спасброски';
    default:
      if (v.sense === 'sight') return ability ? `проверки ${ability}, требующие зрения` : 'проверки, требующие зрения';
      if (v.sense === 'hearing') return ability ? `проверки ${ability}, требующие слуха` : 'проверки, требующие слуха';
      return ability ? `проверки ${ability}` : 'проверки';
  }
}

const winsWord = (wins: number) => (wins >= 5 ? `${wins} успехов снимают состояние` : `${wins} успеха снимают состояние`);

function saveWin(v: Record<string, unknown>): string {
  const wins = Number(v.wins ?? 1);
  switch (v.onWin) {
    case 'better': return 'успех — стадия легче';
    case 'easier': return `успех — СЛ ниже на ${optionLabel(SAVE_EASE_DICE, v.ease)}`;
    case 'exhaustion-down': return 'успех — на степень истощения меньше';
    default: return wins > 1 ? winsWord(wins) : 'успех снимает состояние';
  }
}

function saveFail(v: Record<string, unknown>): string {
  switch (v.onFail) {
    case 'exhaustion': return 'провал — степень истощения';
    case 'worse': return 'провал — стадия тяжелее';
    case 'damage': return `провал — ${String(v.damage)} урона, ${optionLabel(DAMAGE_TYPES, v.damageType)}`;
    default: return '';
  }
}

function describeSave(v: Record<string, unknown>): string {
  const when = optionLabel(SAVE_MOMENTS, v.when);
  if (v.ability === 'none') {
    if (v.onFail === 'worse') return `Без спасброска ${when}: стадия тяжелее.`;
    if (v.onFail === 'exhaustion') return `Без спасброска ${when}: степень истощения.`;
    if (v.onFail === 'damage') return `Без спасброска ${when}: ${String(v.damage)} урона, ${optionLabel(DAMAGE_TYPES, v.damageType)}.`;
    return 'Проходит, только когда его снимут.';
  }
  const ability = optionLabel(SAVE_ABILITIES, v.ability);
  const dc = String(v.dc);
  const wins = Number(v.wins ?? 1);
  const plain = (v.onWin ?? 'ends') === 'ends' && wins <= 3;
  if (plain && v.onFail === 'exhaustion') {
    return wins > 1
      ? `Спасбросок ${ability} (СЛ ${dc}) ${when}: ${wins} успеха снимают состояние, каждый провал — степень истощения.`
      : `Спасбросок ${ability} (СЛ ${dc}) ${when}: успех снимает состояние, провал — степень истощения.`;
  }
  if (plain && (v.onFail ?? 'stays') === 'stays') {
    return wins > 1
      ? `Спасбросок ${ability} (СЛ ${dc}) ${when}: ${wins} успеха снимают состояние.`
      : `Спасбросок ${ability} (СЛ ${dc}) ${when}: успех снимает состояние.`;
  }
  const win = saveWin(v);
  const fail = saveFail(v);
  return fail ? `Спасбросок ${ability} (СЛ ${dc}) ${when}: ${win}; ${fail}.` : `Спасбросок ${ability} (СЛ ${dc}) ${when}: ${win}.`;
}

export function describeClause(item: Clause): string {
  const v = item.values;
  switch (item.kind) {
    case 'own-rolls': {
      const rolls = rollsOf(v);
      const effect = optionLabel(ROLL_EFFECTS, v.effect);
      return v.whileSourceSeen ? `Его ${rolls} — ${effect}, пока источник в поле зрения.` : `Его ${rolls} — ${effect}.`;
    }
    case 'roll-bonus':
      return `Его ${rollsOf(v)}: ${optionLabel(ROLL_BONUSES, v.value)}.`;
    case 'rolls-against': {
      const effect = optionLabel(ROLL_EFFECTS, v.effect);
      return v.range === 'any' ? `Атаки по нему — ${effect}.` : `Атаки по нему ${optionLabel(RANGES, v.range)} — ${effect}.`;
    }
    case 'crit-against':
      return v.range === 'near' ? 'Попадание по нему в пределах 5 футов — критическое.' : 'Попадание по нему — критическое.';
    case 'cannot-attack':
      return v.whom === 'anyone'
        ? 'Не может атаковать никого — ни оружием, ни вредным заклинанием.'
        : v.whom === 'others'
          ? 'Может атаковать оружием и вредными заклинаниями только источник состояния.'
          : 'Не может атаковать источник состояния — ни оружием, ни вредным заклинанием.';
    case 'cannot-approach':
      return v.whileSeen ? 'Не может по своей воле приблизиться к источнику, пока видит его.' : 'Не может по своей воле приблизиться к источнику.';
    case 'speed':
      return v.mode === 'half' ? 'Скорость вдвое меньше.' : v.mode === 'crawl' ? 'Передвигается только ползком: каждый фут стоит два.' : 'Скорость 0.';
    case 'cannot-act':
      return v.what === 'reactions' ? 'Не может совершать реакции.' : 'Недееспособен: не может совершать действия и реакции.';
    case 'resistance':
      return 'Сопротивление всему урону.';
    case 'with-condition':
      return `Вместе с ним — состояние «${optionLabel(LINKABLE, v.code)}».`;
    case 'repeat-save':
      return describeSave(v);
    case 'lasts':
      return `Проходит само через ${optionLabel(LASTS_MINUTES, v.minutes)} по часам кампании.`;
    case 'note':
      return String(v.text ?? '');
  }
}

export function stageIndex(rule: { stages?: readonly ConditionStage[] } | undefined, stage: unknown): number {
  const count = rule?.stages?.length ?? 0;
  if (!count) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(Number(stage) || 0)));
}

// The clauses that hold right now: the common ones plus those of the stage the creature is at.
export function ruleClauses(rule: { clauses: readonly Clause[]; stages?: readonly ConditionStage[] } | undefined, stage: unknown = 0): Clause[] {
  if (!rule) return [];
  const at = rule.stages?.length ? rule.stages[stageIndex(rule, stage)] : undefined;
  return [...rule.clauses, ...(at?.clauses ?? [])];
}

export type RepeatSave = {
  ability: string; dc: number; when: 'turn-end' | 'turn-start' | 'long-rest' | 'hour' | 'day'; wins: number;
  onWin: 'ends' | 'better' | 'easier' | 'exhaustion-down'; ease: number;
  onFail: 'stays' | 'exhaustion' | 'worse' | 'damage'; damage: string; damageType: string;
};

const MOMENTS: readonly RepeatSave['when'][] = ['turn-end', 'turn-start', 'long-rest', 'hour', 'day'];
const WIN_EFFECTS: readonly RepeatSave['onWin'][] = ['ends', 'better', 'easier', 'exhaustion-down'];
const FAIL_EFFECTS: readonly RepeatSave['onFail'][] = ['stays', 'exhaustion', 'worse', 'damage'];

// The stage's own course wins over the common one: a poison may stop being shaken off once it deepens.
export function repeatSaveOf(rule: { clauses: readonly Clause[]; stages?: readonly ConditionStage[] } | undefined, stage: unknown = 0): RepeatSave | null {
  if (!rule) return null;
  const own = rule.stages?.length ? rule.stages[stageIndex(rule, stage)]?.clauses.find(entry => entry.kind === 'repeat-save') : undefined;
  const found = own ?? rule.clauses.find(entry => entry.kind === 'repeat-save');
  if (!found) return null;
  const v = found.values;
  const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T) => (list as readonly unknown[]).includes(value) ? value as T : fallback;
  return {
    ability: String(v.ability), dc: Number(v.dc), when: pick(MOMENTS, v.when, 'turn-end'), wins: Math.max(1, Number(v.wins) || 1),
    onWin: pick(WIN_EFFECTS, v.onWin, 'ends'), ease: Number(v.ease) || 6,
    onFail: pick(FAIL_EFFECTS, v.onFail, 'stays'), damage: String(v.damage ?? '1d6'), damageType: String(v.damageType ?? 'poison'),
  };
}

export function lastsMinutes(rule: { clauses: readonly Clause[]; stages?: readonly ConditionStage[] } | undefined, stage: unknown = 0): number | null {
  const found = ruleClauses(rule, stage).find(entry => entry.kind === 'lasts');
  const minutes = Number(found?.values.minutes);
  return found && minutes > 0 ? minutes : null;
}

export function linkedCodes(rule: { clauses: readonly Clause[]; stages?: readonly ConditionStage[] } | undefined, stage: unknown = 0): string[] {
  return [...new Set(ruleClauses(rule, stage).filter(entry => entry.kind === 'with-condition').map(entry => String(entry.values.code)))];
}

export function describeStage(stage: ConditionStage, index: number): string {
  const text = stage.clauses.map(describeClause).filter(Boolean).join(' ');
  return text ? `Стадия ${index + 1} — ${stage.name}: ${text}` : `Стадия ${index + 1} — ${stage.name}.`;
}

export function describeRule(rule: { clauses: Clause[]; stages?: ConditionStage[] }): string {
  return [...rule.clauses.map(describeClause), ...(rule.stages ?? []).map(describeStage)].filter(Boolean).join(' ');
}

const own = (rolls: string, effect: string, extra: Record<string, unknown> = {}) => clause('own-rolls', { rolls, effect, ...extra });
const against = (effect: string, range = 'any', extra: Record<string, unknown> = {}) => clause('rolls-against', { effect, range, ...extra });
const helpless = (): Clause[] => [
  clause('cannot-act', { what: 'all' }), clause('speed', { mode: 'zero' }),
  own('saves', 'fail', { ability: 'str-dex' }), against('advantage'),
];
const also = (code: string) => clause('with-condition', { code });
const note = (text: string) => clause('note', { text });
const course = (values: Record<string, unknown>) => clause('repeat-save', values);
const lasts = (minutes: number) => clause('lasts', { minutes: String(minutes) });
const sightPenalty = (value: number): Clause[] => [
  clause('roll-bonus', { rolls: 'attacks', value: String(value) }), clause('roll-bonus', { rolls: 'checks', sense: 'sight', value: String(value) }),
];

const SRD: ConditionRule[] = [
  { code: 'blinded', name: 'ослеплён', icon: 'eyeOff', kind: 'condition', clauses: [
    own('checks', 'fail', { sense: 'sight' }), own('attacks', 'disadvantage', { bySight: true }), against('advantage'),
  ] },
  { code: 'charmed', name: 'очарован', icon: 'charmed', kind: 'condition', clauses: [
    clause('cannot-attack', { whom: 'source' }), note('Источник получает преимущество в проверках общения с ним.'),
  ] },
  { code: 'deafened', name: 'оглох', icon: 'earOff', kind: 'condition', clauses: [own('checks', 'fail', { sense: 'hearing' })] },
  { code: 'frightened', name: 'испуган', icon: 'frightened', kind: 'condition', clauses: [
    own('attacks', 'disadvantage', { whileSourceSeen: true }), own('checks', 'disadvantage', { whileSourceSeen: true }), clause('cannot-approach', { whileSeen: true }),
  ] },
  { code: 'grappled', name: 'схвачен', icon: 'hand', kind: 'condition', clauses: [clause('speed', { mode: 'zero' })] },
  { code: 'incapacitated', name: 'недееспособен', icon: 'ban', kind: 'condition', clauses: [clause('cannot-act', { what: 'all' })] },
  { code: 'invisible', name: 'невидим', icon: 'invisible', kind: 'condition', asTarget: 'цель невидима', clauses: [
    own('attacks', 'advantage', { bySight: true }), against('disadvantage', 'any', { bySight: true }),
  ] },
  { code: 'paralyzed', name: 'парализован', icon: 'paralyzed', kind: 'condition', clauses: [...helpless(), clause('crit-against', { range: 'near' })] },
  { code: 'petrified', name: 'окаменел', icon: 'stone', kind: 'condition', clauses: [...helpless(), clause('resistance', { damage: 'all' })] },
  { code: 'poisoned', name: 'отравлен', icon: 'poison', kind: 'condition', clauses: [own('attacks', 'disadvantage'), own('checks', 'disadvantage')] },
  { code: 'prone', name: 'лежит ничком', icon: 'prone', kind: 'condition', clauses: [
    clause('speed', { mode: 'crawl' }), own('attacks', 'disadvantage'), against('advantage', 'near'), against('disadvantage', 'far'),
  ] },
  { code: 'restrained', name: 'опутан', icon: 'chain', kind: 'condition', clauses: [
    clause('speed', { mode: 'zero' }), own('attacks', 'disadvantage'), own('saves', 'disadvantage', { ability: 'dexterity' }), against('advantage'),
  ] },
  { code: 'stunned', name: 'ошеломлён', icon: 'stunned', kind: 'condition', clauses: helpless() },
  { code: 'unconscious', name: 'без сознания', icon: 'unconscious', kind: 'condition', clauses: [...helpless(), clause('crit-against', { range: 'near' })] },

  { code: 'cackle_fever', name: 'Хохочущая лихорадка', icon: 'mask', kind: 'disease', clauses: [
    note('Болеют гуманоиды, гномы невосприимчивы. Пока болен — степень истощения, которую не снять до излечения.'),
    note('Сильный стресс (бой, урон, испуг, кошмар) — спасбросок Телосложения той же СЛ: провал — 1к10 психического урона и минута безумного смеха, существо недееспособно; спасбросок в конце каждого хода прекращает приступ.'),
    course({ ability: 'constitution', dc: '13', when: 'long-rest', onWin: 'easier', ease: '6' }),
    note('Три проваленных спасброска после отдыха — бессрочное безумие.'),
  ] },
  { code: 'sewer_plague', name: 'Сточная чума', icon: 'sprout', kind: 'disease', clauses: [
    note('Заражает укус больной твари или нечистоты в ране: спасбросок Телосложения СЛ 11. Через 1к4 дня — степень истощения.'),
    note('Тратя кости хитов, восстанавливает лишь половину хитов; долгий отдых хитов не возвращает.'),
    course({ ability: 'constitution', dc: '11', when: 'long-rest', onWin: 'exhaustion-down', onFail: 'exhaustion' }),
  ] },
  { code: 'sight_rot', name: 'Глазная гниль', icon: 'eyeOff', kind: 'disease', clauses: [
    note('Заражает питьё грязной воды: спасбросок Телосложения СЛ 15. Через день мутнеет зрение.'),
    course({ ability: 'none', when: 'long-rest', onFail: 'worse' }),
    note('Не даёт стать хуже мазь из цветка очанки (одна доза перед долгим отдыхом); три дозы излечивают.'),
  ], stages: [
    { name: 'зрение мутнеет', clauses: sightPenalty(-1) },
    { name: 'хуже', clauses: sightPenalty(-2) },
    { name: 'ещё хуже', clauses: sightPenalty(-3) },
    { name: 'почти не видит', clauses: sightPenalty(-4) },
    { name: 'слепота', clauses: [...sightPenalty(-5), also('blinded')] },
  ] },

  { code: 'assassins_blood', name: 'Кровь ассасина', icon: 'drop', kind: 'poison', clauses: [
    also('poisoned'), lasts(1440),
    note('Проглоченный: спасбросок Телосложения СЛ 10, провал — 1к12 урона ядом и отравление на сутки, успех — половина урона без отравления.'),
  ] },
  { code: 'burnt_othur_fumes', name: 'Дым жжённого отура', icon: 'fog', kind: 'poison', clauses: [
    note('Вдохнувший: спасбросок Телосложения СЛ 13, провал — 3к6 урона ядом.'),
    course({ ability: 'constitution', dc: '13', when: 'turn-start', wins: '3', onFail: 'damage', damage: '1d6', damageType: 'poison' }),
  ] },
  { code: 'crawler_mucus', name: 'Слизь ползающего падальщика', icon: 'paralyzed', kind: 'poison', clauses: [
    also('poisoned'), also('paralyzed'), lasts(1),
    course({ ability: 'constitution', dc: '13', when: 'turn-end' }),
    note('Контакт: спасбросок Телосложения СЛ 13.'),
  ] },
  { code: 'drow_poison', name: 'Яд дроу', icon: 'poison', kind: 'poison', clauses: [
    also('poisoned'), lasts(60),
    note('Ранение: спасбросок Телосложения СЛ 13; провал на 5 и больше — ещё и без сознания (вторая стадия).'),
  ], stages: [
    { name: 'отравлен', clauses: [] },
    { name: 'без сознания', clauses: [also('unconscious'), note('Очнётся, если получит урон или если другое существо действием растормошит его.')] },
  ] },
  { code: 'essence_of_ether', name: 'Эссенция эфира', icon: 'unconscious', kind: 'poison', clauses: [
    also('poisoned'), also('unconscious'), lasts(480),
    note('Вдохнувший: спасбросок Телосложения СЛ 15. Очнётся, если получит урон или если другое существо действием растормошит его.'),
  ] },
  { code: 'malice', name: 'Злоба', icon: 'frown', kind: 'poison', clauses: [
    also('poisoned'), also('blinded'), lasts(60), note('Вдохнувший: спасбросок Телосложения СЛ 15.'),
  ] },
  { code: 'oil_of_taggit', name: 'Масло таггита', icon: 'flask', kind: 'poison', clauses: [
    also('poisoned'), also('unconscious'), lasts(1440), note('Контакт: спасбросок Телосложения СЛ 13. Очнётся, если получит урон.'),
  ] },
  { code: 'pale_tincture', name: 'Бледная настойка', icon: 'potion', kind: 'poison', clauses: [
    also('poisoned'),
    course({ ability: 'constitution', dc: '16', when: 'day', wins: '7', onFail: 'damage', damage: '1d6', damageType: 'poison' }),
    note('Проглоченный: спасбросок Телосложения СЛ 16, провал — 1к6 урона ядом. Пока нет семи успехов, этот урон ничем не лечится.'),
  ] },
  { code: 'torpor', name: 'Ступор', icon: 'stupor', kind: 'poison', clauses: [
    also('poisoned'), also('incapacitated'), note('Проглоченный: спасбросок Телосложения СЛ 15. Держится 4к6 часов.'),
  ] },
  { code: 'truth_serum', name: 'Сыворотка правды', icon: 'dmgPsychic', kind: 'poison', clauses: [
    also('poisoned'), lasts(60), note('Проглоченный: спасбросок Телосложения СЛ 11. Не может сознательно лгать, как в «Области истины».'),
  ] },
];

export const SRD_CONDITION_RULES: ReadonlyMap<string, ConditionRule> = new Map(SRD.map(rule => [rule.code, rule]));

export type RuleSet = ReadonlyMap<string, ConditionRule>;

// What the app starts from: the SRD rules, and the ones a mechanics mod adds or replaces at startup. A campaign changes them on top.
const BUILT_IN = new Map<string, ConditionRule>(SRD_CONDITION_RULES);
const FROM_MOD = new Map<string, string>();

export const CUSTOM_CODE = /^custom_[a-z0-9]{6,40}$/;
export const MOD_CODE = /^mod_[a-z0-9_]{2,40}$/;

export function builtInRules(): RuleSet {
  return BUILT_IN;
}

export function builtInRule(code: string): ConditionRule | undefined {
  return BUILT_IN.get(code);
}

// The mod that brought or replaced this rule; null for the SRD's own.
export function modOfRule(code: string): string | null {
  return FROM_MOD.get(code) ?? null;
}

export function ruleOf(rules: RuleSet | undefined, code: string): ConditionRule | undefined {
  return rules?.get(code) ?? BUILT_IN.get(code);
}

// A rule from a mod: an SRD code replaces that rule (keeping its name), a new one needs a code `mod_…`; clauses are checked like the GM's.
export function normalizeModRule(input: unknown): ConditionRule | string {
  if (!input || typeof input !== 'object') return 'нужен объект правила';
  const raw = input as Record<string, unknown>;
  const code = typeof raw.code === 'string' ? raw.code : '';
  const srd = SRD_CONDITION_RULES.get(code);
  if (!srd && !MOD_CODE.test(code)) return `код «${code}»: код состояния SRD или mod_ и строчные латинские буквы, цифры, «_»`;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : '';
  if (!srd && !name) return `«${code}»: нужно имя`;
  const kind = (CONDITION_KINDS as readonly unknown[]).includes(raw.kind) ? raw.kind as ConditionKind : srd?.kind ?? 'condition';
  const icon = typeof raw.icon === 'string' && /^[A-Za-z0-9]{1,40}$/.test(raw.icon) ? raw.icon : srd?.icon ?? 'alert';
  const stages = normalizeStages(raw.stages);
  return {
    code, name: srd?.name ?? name, icon, kind, clauses: normalizeClauses(raw.clauses),
    ...(stages.length ? { stages } : {}),
    ...(typeof raw.description === 'string' && raw.description.trim() ? { description: raw.description.trim().slice(0, 2000) } : {}),
    ...(srd?.asTarget ? { asTarget: srd.asTarget } : {}),
  };
}

export function defineModRule(rule: ConditionRule, modName: string) {
  BUILT_IN.set(rule.code, rule);
  FROM_MOD.set(rule.code, modName);
}
