export const SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation'] as const;
export const SCHOOL_LABELS: Record<string, string> = {
  Abjuration: 'Ограждение', Conjuration: 'Вызов', Divination: 'Прорицание', Enchantment: 'Очарование',
  Evocation: 'Воплощение', Illusion: 'Иллюзия', Necromancy: 'Некромантия', Transmutation: 'Преобразование',
};

export const SPELL_CLASSES: Array<{ id: string; label: string }> = [
  { id: 'Bard', label: 'Бард' }, { id: 'Cleric', label: 'Жрец' }, { id: 'Druid', label: 'Друид' },
  { id: 'Paladin', label: 'Паладин' }, { id: 'Ranger', label: 'Следопыт' }, { id: 'Sorcerer', label: 'Чародей' },
  { id: 'Warlock', label: 'Колдун' }, { id: 'Wizard', label: 'Волшебник' },
];

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const UNITS: Array<[RegExp, [string, string, string]]> = [
  [/^bonus actions?$/, ['бонусное действие', 'бонусных действия', 'бонусных действий']],
  [/^actions?$/, ['действие', 'действия', 'действий']],
  [/^reactions?$/, ['реакция', 'реакции', 'реакций']],
  [/^rounds?$/, ['раунд', 'раунда', 'раундов']],
  [/^minutes?$/, ['минута', 'минуты', 'минут']],
  [/^hours?$/, ['час', 'часа', 'часов']],
  [/^days?$/, ['день', 'дня', 'дней']],
  [/^(feet|foot)$/, ['фут', 'фута', 'футов']],
  [/^miles?$/, ['миля', 'мили', 'миль']],
];

const WORDS: Record<string, string> = {
  instantaneous: 'Мгновенная', self: 'На себя', touch: 'Касание', sight: 'В пределах видимости', unlimited: 'Без ограничения',
  special: 'Особая', 'until dispelled': 'Пока не рассеют', 'until dispelled or triggered': 'Пока не рассеют или не сработает',
};

const SHAPES: Record<string, string> = { cone: 'конус', cube: 'куб', line: 'линия', sphere: 'сфера', radius: 'радиус', hemisphere: 'полусфера', cylinder: 'цилиндр' };

function amountUnit(text: string): string {
  return text.replace(/(\d+)\s+([a-z ]+?)(?=$|,|\))/gi, (match, amount: string, unit: string) => {
    const entry = UNITS.find(([pattern]) => pattern.test(unit.trim().toLowerCase()));
    if (!entry) return match;
    const n = Number(amount);
    return `${n} ${plural(n, ...entry[1])}`;
  });
}

export function spellTextRu(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  if (!text) return '';
  const word = WORDS[text.toLowerCase()];
  if (word) return word;
  const shape = /^self \((\d+)-(?:foot|mile)[- ](radius|cone|cube|line|sphere|hemisphere)\)$/i.exec(text);
  if (shape) return `На себя (${SHAPES[shape[2]!.toLowerCase()]} ${shape[1]} фт.)`;
  const upTo = /^up to (\d+) (round|minute|hour|day)s?$/i.exec(text);
  if (upTo) {
    const n = Number(upTo[1]);
    const forms: Record<string, [string, string, string]> = {
      round: ['раунда', 'раундов', 'раундов'], minute: ['минуты', 'минут', 'минут'], hour: ['часа', 'часов', 'часов'], day: ['дня', 'дней', 'дней'],
    };
    return `До ${n} ${plural(n, ...forms[upTo[2]!.toLowerCase()]!)}`;
  }
  let result = text.replace(/, which you take when .*$/i, '');
  result = amountUnit(result);
  return result.charAt(0).toUpperCase() + result.slice(1);
}

export function classesRu(value: string | string[] | null | undefined): string {
  const list = Array.isArray(value) ? value : (value ?? '').split(',').map(entry => entry.trim()).filter(Boolean);
  return list.map(entry => SPELL_CLASSES.find(option => option.id.toLowerCase() === entry.toLowerCase())?.label ?? entry).join(', ');
}

export function componentsRu(value: string | null | undefined): string {
  return (value ?? '').replace(/\bV\b/g, 'В').replace(/\bS\b/g, 'С').replace(/\bM\b/g, 'М');
}
