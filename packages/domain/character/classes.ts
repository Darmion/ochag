export type ClassId =
  | 'barbarian' | 'bard' | 'cleric' | 'druid' | 'fighter' | 'monk'
  | 'paladin' | 'ranger' | 'rogue' | 'sorcerer' | 'warlock' | 'wizard';

// Word edges use Unicode letter checks: \b only knows Latin letters.
const PATTERNS: Array<[ClassId, RegExp]> = [
  ['barbarian', /варвар|barbarian/iu],
  ['bard', /бард|bard/iu],
  ['cleric', /жрец|клирик|cleric/iu],
  ['druid', /друид|druid/iu],
  ['fighter', /воин|боец|fighter/iu],
  ['monk', /монах|monk/iu],
  ['paladin', /паладин|paladin/iu],
  ['ranger', /следопыт|рейнджер|ranger/iu],
  ['rogue', /плут|(?<!\p{L})вор(?!\p{L})|rogue/iu],
  ['sorcerer', /чародей|sorcerer/iu],
  ['warlock', /колдун|warlock/iu],
  ['wizard', /волшебник|wizard|(?<!\p{L})маг(?!\p{L})/iu],
];

export function classOf(text: string | null | undefined): ClassId | null {
  const source = text ?? '';
  let best: { id: ClassId; at: number } | null = null;
  for (const [id, pattern] of PATTERNS) {
    const match = pattern.exec(source);
    if (match && (!best || match.index < best.at)) best = { id, at: match.index };
  }
  return best?.id ?? null;
}

export function sheetClassText(sheetExtra: unknown): string | null {
  const info = (sheetExtra as any)?.info;
  const value = info?.charClass?.value ?? info?.class?.value ?? info?.charClass;
  return typeof value === 'string' ? value : null;
}

export function characterClassText(character: { class_name?: string | null; sheet_extra?: unknown }) {
  return character.class_name?.trim() || sheetClassText(character.sheet_extra);
}

const HIT_DIE: Record<ClassId, number> = {
  barbarian: 12, fighter: 10, paladin: 10, ranger: 10,
  bard: 8, cleric: 8, druid: 8, monk: 8, rogue: 8, warlock: 8,
  sorcerer: 6, wizard: 6,
};

export function hitDieForClass(classId: ClassId | null): number {
  return classId ? HIT_DIE[classId] : 8;
}

export function attacksForClass(classId: ClassId | null, level: number | null | undefined): number {
  const value = Math.max(1, Math.trunc(level ?? 1));
  if (classId === 'fighter') return value >= 20 ? 4 : value >= 11 ? 3 : value >= 5 ? 2 : 1;
  if (classId && ['barbarian', 'monk', 'paladin', 'ranger'].includes(classId)) return value >= 5 ? 2 : 1;
  return 1;
}

export const CLASS_LABELS: Record<ClassId, string> = {
  barbarian: 'Варвар', bard: 'Бард', cleric: 'Жрец', druid: 'Друид', fighter: 'Воин', monk: 'Монах',
  paladin: 'Паладин', ranger: 'Следопыт', rogue: 'Плут', sorcerer: 'Чародей', warlock: 'Колдун', wizard: 'Волшебник',
};

export const CLASS_IDS = Object.keys(CLASS_LABELS) as ClassId[];

export type ClassLevel = { id: ClassId; level: number; subclass?: string };
export type ClassLevels = {
  classes: ClassLevel[];
  multiclass: boolean;
  problem: string | null;
};

function bracketed(source: string): (at: number) => boolean {
  const depth: number[] = [];
  let level = 0;
  for (const char of source) {
    if (char === '(' || char === '[') level += 1;
    for (let i = 0; i < char.length; i += 1) depth.push(level);
    if ((char === ')' || char === ']') && level > 0) level -= 1;
  }
  return at => (depth[at] ?? 0) > 0;
}

function classMatches(source: string) {
  const inside = bracketed(source);
  const found: Array<{ id: ClassId; at: number; end: number }> = [];
  for (const [id, pattern] of PATTERNS) {
    for (const match of source.matchAll(new RegExp(pattern.source, 'giu'))) {
      if (!inside(match.index!)) found.push({ id, at: match.index!, end: match.index! + match[0].length });
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

const clampLevel = (level: number | null | undefined) => Math.max(1, Math.min(20, Math.trunc(level ?? 1)));

export function parseClassLevels(text: string | null | undefined, totalLevel: number | null | undefined): ClassLevels {
  const total = clampLevel(totalLevel);
  const source = text ?? '';
  const found = classMatches(source);
  if (!found.length) return { classes: [], multiclass: false, problem: null };
  const single = (problem: string | null): ClassLevels => ({ classes: [{ id: found[0]!.id, level: total }], multiclass: false, problem });
  if (new Set(found.map(entry => entry.id)).size === 1) return single(found.length > 1 ? 'класс указан дважды' : null);

  const classes = found.map((entry, index) => {
    const tail = source.slice(entry.end, found[index + 1]?.at ?? source.length);
    const number = /\d+/.exec(tail);
    return { id: entry.id, level: number ? Number(number[0]) : null };
  });
  if (new Set(classes.map(entry => entry.id)).size !== classes.length) return single('класс указан дважды');
  if (classes.some(entry => entry.level === null || entry.level < 1)) {
    return single(`укажите уровень каждого класса, например «${CLASS_LABELS[classes[0]!.id]} ${Math.max(1, total - 1)} / ${CLASS_LABELS[classes[1]!.id]} 1»`);
  }
  const sum = classes.reduce((value, entry) => value + entry.level!, 0);
  if (sum !== total) return single(`сумма уровней классов (${sum}) не равна уровню персонажа (${total})`);
  return { classes: classes as ClassLevel[], multiclass: true, problem: null };
}

// Order matters: specific patterns before general ones, «other» last.
export type SubclassRule = { level: number; default: string; list: Array<{ id: string; nameRu: string; pattern: RegExp }> };
export const SUBCLASSES: Partial<Record<ClassId, SubclassRule>> = {
  barbarian: {
    level: 3, default: 'berserker',
    list: [
      { id: 'berserker', nameRu: 'Путь берсерка', pattern: /берсерк|berserker/iu },
      { id: 'totem-warrior', nameRu: 'Путь тотемного воина', pattern: /тотем|totem/iu },
      { id: 'ancestral-guardian', nameRu: 'Путь предков-хранителей', pattern: /предк|ancestral/iu },
      { id: 'storm-herald', nameRu: 'Путь буревестника', pattern: /бур|storm/iu },
      { id: 'zealot', nameRu: 'Путь фанатика', pattern: /фанатик|zealot/iu },
      { id: 'beast', nameRu: 'Путь зверя', pattern: /зверя|beast/iu },
      { id: 'wild-magic', nameRu: 'Путь дикой магии', pattern: /дик\p{L}* маги|wild magic/iu },
      { id: 'other', nameRu: 'Другой путь', pattern: /путь|path/iu },
    ],
  },
  bard: {
    level: 3, default: 'lore',
    list: [
      { id: 'lore', nameRu: 'Коллегия знаний', pattern: /знани|lore/iu },
      { id: 'valor', nameRu: 'Коллегия доблести', pattern: /доблест|valor/iu },
      { id: 'swords', nameRu: 'Коллегия мечей', pattern: /мечей|swords/iu },
      { id: 'whispers', nameRu: 'Коллегия шёпотов', pattern: /шёпот|шепот|whispers/iu },
      { id: 'glamour', nameRu: 'Коллегия очарования', pattern: /очаровани|glamour/iu },
      { id: 'creation', nameRu: 'Коллегия творения', pattern: /творени|creation/iu },
      { id: 'eloquence', nameRu: 'Коллегия красноречия', pattern: /красноречи|eloquence/iu },
      { id: 'spirits', nameRu: 'Коллегия духов', pattern: /духов|spirits/iu },
      { id: 'other', nameRu: 'Другая коллегия', pattern: /коллеги|college/iu },
    ],
  },
  cleric: {
    level: 1, default: 'life',
    list: [
      { id: 'life', nameRu: 'Домен Жизни', pattern: /жизн|life/iu },
      { id: 'knowledge', nameRu: 'Домен Знаний', pattern: /знани|knowledge/iu },
      { id: 'twilight', nameRu: 'Домен Сумерек', pattern: /сумер|twilight/iu },
      { id: 'light', nameRu: 'Домен Света', pattern: /свет|light/iu },
      { id: 'nature', nameRu: 'Домен Природы', pattern: /природ|nature/iu },
      { id: 'tempest', nameRu: 'Домен Бури', pattern: /бур|tempest/iu },
      { id: 'trickery', nameRu: 'Домен Обмана', pattern: /обман|trickery/iu },
      { id: 'war', nameRu: 'Домен Войны', pattern: /войн|war(?![a-z])/iu },
      { id: 'forge', nameRu: 'Домен Кузни', pattern: /кузн|forge/iu },
      { id: 'grave', nameRu: 'Домен Могилы', pattern: /могил|grave/iu },
      { id: 'order', nameRu: 'Домен Порядка', pattern: /порядк|order/iu },
      { id: 'peace', nameRu: 'Домен Мира', pattern: /домен мира|peace/iu },
      { id: 'other', nameRu: 'Другой домен', pattern: /домен|domain/iu },
    ],
  },
  druid: {
    level: 2, default: 'land',
    list: [
      { id: 'land', nameRu: 'Круг Земли', pattern: /земл|land/iu },
      { id: 'moon', nameRu: 'Круг Луны', pattern: /луны|moon/iu },
      { id: 'shepherd', nameRu: 'Круг пастыря', pattern: /пастыр|shepherd/iu },
      { id: 'dreams', nameRu: 'Круг снов', pattern: /снов|dreams/iu },
      { id: 'spores', nameRu: 'Круг спор', pattern: /спор|spores/iu },
      { id: 'stars', nameRu: 'Круг звёзд', pattern: /звёзд|звезд|stars/iu },
      { id: 'wildfire', nameRu: 'Круг лесного пожара', pattern: /пожар|wildfire/iu },
      { id: 'other', nameRu: 'Другой круг', pattern: /круг|circle/iu },
    ],
  },
  fighter: {
    level: 3, default: 'champion',
    list: [
      { id: 'champion', nameRu: 'Чемпион', pattern: /чемпион|champion/iu },
      { id: 'battle-master', nameRu: 'Мастер боевых искусств', pattern: /мастер боевых искусств|battle ?master/iu },
      { id: 'eldritch-knight', nameRu: 'Мистический рыцарь', pattern: /мистическ\p{L}* рыцар|eldritch/iu },
      { id: 'arcane-archer', nameRu: 'Мистический лучник', pattern: /лучник|archer/iu },
      { id: 'samurai', nameRu: 'Самурай', pattern: /самура|samurai/iu },
      { id: 'cavalier', nameRu: 'Кавалерист', pattern: /кавалер|cavalier/iu },
      { id: 'psi-warrior', nameRu: 'Пси-воин', pattern: /пси|psi/iu },
      { id: 'rune-knight', nameRu: 'Рыцарь рун', pattern: /рун|rune/iu },
      { id: 'echo-knight', nameRu: 'Рыцарь эха', pattern: /эхо|эха|echo/iu },
      { id: 'other', nameRu: 'Другой архетип', pattern: /рыцар|knight|архетип|archetype/iu },
    ],
  },
  monk: {
    level: 3, default: 'open-hand',
    list: [
      { id: 'open-hand', nameRu: 'Путь открытой ладони', pattern: /открыт\p{L}* ладон|open hand/iu },
      { id: 'shadow', nameRu: 'Путь тени', pattern: /тен|shadow/iu },
      { id: 'four-elements', nameRu: 'Путь четырёх стихий', pattern: /стихи|elements/iu },
      { id: 'sun-soul', nameRu: 'Путь солнечной души', pattern: /солн|sun soul/iu },
      { id: 'drunken-master', nameRu: 'Путь пьяного мастера', pattern: /пьян|drunken/iu },
      { id: 'kensei', nameRu: 'Путь Кенсей', pattern: /кенсей|kensei/iu },
      { id: 'mercy', nameRu: 'Путь милосердия', pattern: /милосерд|mercy/iu },
      { id: 'astral-self', nameRu: 'Путь астрального «я»', pattern: /астрал|astral/iu },
      { id: 'other', nameRu: 'Другая традиция', pattern: /путь|way|традици|tradition/iu },
    ],
  },
  paladin: {
    level: 3, default: 'devotion',
    list: [
      { id: 'devotion', nameRu: 'Клятва преданности', pattern: /преданност|devotion/iu },
      { id: 'ancients', nameRu: 'Клятва древних', pattern: /древн|ancients/iu },
      { id: 'vengeance', nameRu: 'Клятва мести', pattern: /мест|vengeance/iu },
      { id: 'crown', nameRu: 'Клятва короны', pattern: /корон|crown/iu },
      { id: 'conquest', nameRu: 'Клятва завоевания', pattern: /завоеван|покорени|conquest/iu },
      { id: 'redemption', nameRu: 'Клятва искупления', pattern: /искуплен|redemption/iu },
      { id: 'glory', nameRu: 'Клятва славы', pattern: /слав|glory/iu },
      { id: 'watchers', nameRu: 'Клятва стражей', pattern: /страж|watchers/iu },
      { id: 'oathbreaker', nameRu: 'Клятвопреступник', pattern: /клятвопреступ|oathbreaker/iu },
      { id: 'other', nameRu: 'Другая клятва', pattern: /клятв|oath/iu },
    ],
  },
  sorcerer: {
    level: 1, default: 'draconic',
    list: [
      { id: 'draconic', nameRu: 'Драконья кровь', pattern: /драконь|draconic|dragon/iu },
      { id: 'wild-magic', nameRu: 'Дикая магия', pattern: /дик\p{L}* маги|wild magic/iu },
      { id: 'divine-soul', nameRu: 'Божественная душа', pattern: /божественн\p{L}* душ|divine soul/iu },
      { id: 'shadow-magic', nameRu: 'Теневая магия', pattern: /тен|shadow/iu },
      { id: 'storm', nameRu: 'Магия бури', pattern: /бур|storm/iu },
      { id: 'aberrant-mind', nameRu: 'Аберрантный разум', pattern: /аберрант|aberrant/iu },
      { id: 'clockwork-soul', nameRu: 'Механическая душа', pattern: /механ|clockwork/iu },
      { id: 'other', nameRu: 'Другое происхождение', pattern: /происхожд|origin/iu },
    ],
  },
  warlock: {
    level: 1, default: 'fiend',
    list: [
      { id: 'fiend', nameRu: 'Исчадие', pattern: /исчади|fiend/iu },
      { id: 'archfey', nameRu: 'Архифея', pattern: /архифе|archfey/iu },
      { id: 'great-old-one', nameRu: 'Великий Древний', pattern: /древн|old one/iu },
      { id: 'undying', nameRu: 'Бессмертный', pattern: /бессмерт|undying/iu },
      { id: 'celestial', nameRu: 'Небожитель', pattern: /небожител|celestial/iu },
      { id: 'hexblade', nameRu: 'Ведьмовской клинок', pattern: /клин|hexblade/iu },
      { id: 'genie', nameRu: 'Гений', pattern: /гени|genie/iu },
      { id: 'fathomless', nameRu: 'Глубинный', pattern: /глубин|fathomless/iu },
      { id: 'undead', nameRu: 'Нежить', pattern: /нежит|undead/iu },
      { id: 'other', nameRu: 'Другой покровитель', pattern: /покровител|patron/iu },
    ],
  },
  wizard: {
    level: 2, default: 'evocation',
    list: [
      { id: 'evocation', nameRu: 'Школа Воплощения', pattern: /воплощени|evocation/iu },
      { id: 'abjuration', nameRu: 'Школа Ограждения', pattern: /ограждени|abjuration/iu },
      { id: 'conjuration', nameRu: 'Школа Вызова', pattern: /вызова|conjuration/iu },
      { id: 'divination', nameRu: 'Школа Прорицания', pattern: /прорицани|divination/iu },
      { id: 'enchantment', nameRu: 'Школа Очарования', pattern: /очаровани|enchantment/iu },
      { id: 'illusion', nameRu: 'Школа Иллюзии', pattern: /иллюзи|illusion/iu },
      { id: 'necromancy', nameRu: 'Школа Некромантии', pattern: /некромант|necromancy/iu },
      { id: 'transmutation', nameRu: 'Школа Преобразования', pattern: /преобразовани|transmutation/iu },
      { id: 'bladesinging', nameRu: 'Песнь клинка', pattern: /песн|bladesing/iu },
      { id: 'war-magic', nameRu: 'Военная магия', pattern: /военн\p{L}* маги|war magic/iu },
      { id: 'scribes', nameRu: 'Орден писцов', pattern: /писц|scribes/iu },
      { id: 'other', nameRu: 'Другая школа', pattern: /школ|school|традици|tradition/iu },
    ],
  },
  rogue: {
    level: 3, default: 'thief',
    list: [
      { id: 'thief', nameRu: 'Вор', pattern: /(?<!\p{L})вор(?!\p{L})|thief/iu },
      { id: 'assassin', nameRu: 'Убийца', pattern: /убийц|assassin/iu },
      { id: 'arcane-trickster', nameRu: 'Мистический ловкач', pattern: /ловкач|trickster/iu },
      { id: 'inquisitive', nameRu: 'Сыщик', pattern: /сыщик|inquisitive/iu },
      { id: 'swashbuckler', nameRu: 'Пройдоха', pattern: /пройдох|swashbuckler/iu },
      { id: 'phantom', nameRu: 'Фантом', pattern: /фантом|phantom/iu },
      { id: 'soulknife', nameRu: 'Клинок души', pattern: /клинок души|soul ?knife/iu },
      { id: 'scout', nameRu: 'Разведчик', pattern: /разведч|scout/iu },
      { id: 'other', nameRu: 'Другой архетип', pattern: /архетип|archetype/iu },
    ],
  },
  ranger: {
    level: 3, default: 'hunter',
    list: [
      { id: 'hunter', nameRu: 'Охотник', pattern: /охотник|hunter/iu },
      { id: 'beast-master', nameRu: 'Повелитель зверей', pattern: /повелител|beast ?master/iu },
      { id: 'gloom-stalker', nameRu: 'Сумрачный странник', pattern: /сумрачн|gloom/iu },
      { id: 'horizon-walker', nameRu: 'Странник горизонта', pattern: /горизонт|horizon/iu },
      { id: 'monster-slayer', nameRu: 'Убийца монстров', pattern: /монстр|monster/iu },
      { id: 'swarmkeeper', nameRu: 'Хранитель роя', pattern: /роя|рой|swarm/iu },
      { id: 'fey-wanderer', nameRu: 'Странник фей', pattern: /фей|fey/iu },
      { id: 'drakewarden', nameRu: 'Хранитель дрейка', pattern: /дрейк|drake/iu },
      { id: 'other', nameRu: 'Другой архетип', pattern: /архетип|archetype|conclave/iu },
    ],
  },
};

function sheetSubclassText(sheetExtra: unknown): string | null {
  const info = (sheetExtra as any)?.info;
  const value = info?.charSubclass?.value ?? info?.subclass?.value ?? info?.charSubclass;
  return typeof value === 'string' ? value : null;
}

export function characterClassLevels(character: { class_name?: string | null; sheet_extra?: unknown; level?: number | null }): ClassLevels {
  const text = characterClassText(character) ?? '';
  const parsed = parseClassLevels(text, character.level);
  const found = classMatches(text);
  const chosen = (character.sheet_extra as any)?.subclasses ?? {};
  const lss = sheetSubclassText(character.sheet_extra);
  return {
    ...parsed,
    classes: parsed.classes.map(entry => {
      const rule = SUBCLASSES[entry.id];
      if (!rule || entry.level < rule.level) return entry;
      const at = found.find(match => match.id === entry.id);
      const next = at ? found.find(match => match.at > at.at && match.id !== entry.id) : undefined;
      const segment = at ? text.slice(at.end, next?.at ?? text.length) : '';
      const pick = rule.list.find(item => item.id === chosen[entry.id])
        ?? rule.list.find(item => item.pattern.test(segment))
        ?? (lss && parsed.classes.length === 1 ? rule.list.find(item => item.pattern.test(lss)) : undefined);
      return { ...entry, subclass: pick?.id ?? rule.default };
    }),
  };
}

export function advanceClassText(text: string | null | undefined, totalLevel: number | null | undefined, classId: ClassId): string {
  const source = (text ?? '').trim();
  const parsed = parseClassLevels(source, totalLevel);
  if (!parsed.classes.length) return CLASS_LABELS[classId];
  const own = parsed.classes.find(entry => entry.id === classId);
  if (own && !parsed.multiclass) return source;

  const found = classMatches(source);
  const levels = new Map(parsed.classes.map(entry => [entry.id, entry.level]));
  if (own) levels.set(classId, own.level + 1);
  let result = source;
  for (let index = found.length - 1; index >= 0; index -= 1) {
    const entry = found[index]!;
    const level = levels.get(entry.id);
    if (level === undefined) continue;
    const tailEnd = found[index + 1]?.at ?? result.length;
    const tail = result.slice(entry.end, tailEnd);
    const number = /\d+/.exec(tail);
    const group = /^\s*[([][^)\]]*[)\]]/u.exec(tail);
    const cut = entry.end + (group ? group[0].length : 0);
    result = number
      ? result.slice(0, entry.end) + tail.slice(0, number.index) + level + tail.slice(number.index + number[0].length) + result.slice(tailEnd)
      : result.slice(0, cut) + ` ${level}` + result.slice(cut);
  }
  return own ? result : `${result.replace(/[\s/,;+]+$/u, '')} / ${CLASS_LABELS[classId]} 1`;
}

export function withSubclassText(text: string | null | undefined, totalLevel: number | null | undefined, classId: ClassId, subclassName: string): string {
  const source = (text ?? '').trim();
  const at = classMatches(source).find(entry => entry.id === classId);
  if (!at || /^\s*[([]/u.test(source.slice(at.end))) return source;
  const result = `${source.slice(0, at.end)} (${subclassName})${source.slice(at.end)}`;
  const before = parseClassLevels(source, totalLevel);
  const after = parseClassLevels(result, totalLevel);
  const same = JSON.stringify(before.classes) === JSON.stringify(after.classes) && before.problem === after.problem;
  return same ? result : source;
}

export function attacksForClasses(classes: ClassLevel[]): number {
  return classes.reduce((best, entry) => Math.max(best, attacksForClass(entry.id, entry.level)), 1);
}

type Ability = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
const ABILITY_RU: Record<Ability, string> = {
  strength: 'Сила', dexterity: 'Ловкость', constitution: 'Телосложение', intelligence: 'Интеллект', wisdom: 'Мудрость', charisma: 'Харизма',
};
const PREREQUISITES: Record<ClassId, { all: Ability[] } | { any: Ability[] }> = {
  barbarian: { all: ['strength'] }, bard: { all: ['charisma'] }, cleric: { all: ['wisdom'] }, druid: { all: ['wisdom'] },
  fighter: { any: ['strength', 'dexterity'] }, monk: { all: ['dexterity', 'wisdom'] }, paladin: { all: ['strength', 'charisma'] },
  ranger: { all: ['dexterity', 'wisdom'] }, rogue: { all: ['dexterity'] }, sorcerer: { all: ['charisma'] },
  warlock: { all: ['charisma'] }, wizard: { all: ['intelligence'] },
};

export function multiclassPrerequisiteProblems(current: ClassLevel[], next: ClassId, scores: Record<Ability, number>): string[] {
  if (!current.length || current.some(entry => entry.id === next)) return [];
  const problems: string[] = [];
  for (const id of [...current.map(entry => entry.id), next]) {
    const rule = PREREQUISITES[id];
    const ok = 'all' in rule ? rule.all.every(ability => scores[ability] >= 13) : rule.any.some(ability => scores[ability] >= 13);
    if (!ok) {
      const need = 'all' in rule ? rule.all.map(ability => ABILITY_RU[ability]).join(' и ') : rule.any.map(ability => ABILITY_RU[ability]).join(' или ');
      problems.push(`${CLASS_LABELS[id]}: нужна ${need} 13+`);
    }
  }
  return problems;
}
