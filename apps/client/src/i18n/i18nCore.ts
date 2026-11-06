export const SOURCE_LOCALE = 'ru';

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>>;
export type Messages = Record<string, string | PluralForms>;
export type Params = Record<string, string | number>;

export type LocaleMeta = { code: string; name: string; base: string | null };
export type LocaleProblem =
  | { kind: 'not-object' } | { kind: 'bad-code'; code: string } | { kind: 'too-many'; limit: number } | { kind: 'not-string'; key: string };

export function formatMessage(template: string, params?: Params): string {
  if (!params) return template.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
  return template
    .replace(/\{(\w+)\}/g, (whole, name: string) => (params[name] === undefined ? whole : String(params[name])))
    .replace(/\{\{/g, '{').replace(/\}\}/g, '}');
}

const pluralRules = new Map<string, Intl.PluralRules>();
export function pluralCategory(locale: string, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      rules = new Intl.PluralRules('en');
    }
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

export function sourcePlural(key: string, count: number): string {
  const [one, few, many] = key.split('|');
  const category = pluralCategory(SOURCE_LOCALE, count);
  return (category === 'one' ? one : category === 'few' ? few : many) ?? one ?? key;
}

export function translate(chain: Array<{ code: string; messages: Messages }>, key: string, params?: Params): string {
  for (const { messages } of chain) {
    const value = messages[key];
    if (typeof value === 'string' && value) return formatMessage(value, params);
  }
  return formatMessage(key, params);
}

export function translatePlural(chain: Array<{ code: string; messages: Messages }>, key: string, count: number, params?: Params): string {
  const all = { n: count, ...params };
  for (const { code, messages } of chain) {
    const value = messages[key];
    if (typeof value === 'string' && value) return formatMessage(value, all);
    if (value && typeof value === 'object') {
      const form = value[pluralCategory(code, count)] ?? value.other ?? value.one;
      if (form) return formatMessage(form, all);
    }
  }
  return formatMessage(sourcePlural(key, count), all);
}

const CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
function isSection(key: string, value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || key.includes('|')) return false;
  return !Object.keys(value).every(form => PLURAL_FORMS.includes(form));
}
export const MAX_LOCALE_ENTRIES = 50_000;
export function parseLocaleFile(raw: unknown, fallbackCode: string): { meta: LocaleMeta; messages: Messages; problems: LocaleProblem[] } {
  const problems: LocaleProblem[] = [];
  const object = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!object) return { meta: { code: fallbackCode, name: fallbackCode, base: 'en' }, messages: {}, problems: [{ kind: 'not-object' }] };
  const metaRaw = object.$meta && typeof object.$meta === 'object' ? (object.$meta as Record<string, unknown>) : {};
  const code = typeof metaRaw.code === 'string' && CODE.test(metaRaw.code) ? metaRaw.code : fallbackCode;
  if (!CODE.test(code)) problems.push({ kind: 'bad-code', code });
  const name = typeof metaRaw.name === 'string' && metaRaw.name.trim() ? metaRaw.name.trim().slice(0, 40) : code;
  const base = metaRaw.base === null ? null : typeof metaRaw.base === 'string' && CODE.test(metaRaw.base) ? metaRaw.base : 'en';
  const messages: Messages = {};
  let count = 0;
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(object)) {
    if (key.startsWith('$')) continue;
    if (isSection(key, value)) entries.push(...Object.entries(value as Record<string, unknown>));
    else entries.push([key, value]);
  }
  for (const [key, value] of entries) {
    if (++count > MAX_LOCALE_ENTRIES) {
      problems.push({ kind: 'too-many', limit: MAX_LOCALE_ENTRIES });
      break;
    }
    if (typeof value === 'string') {
      if (value) messages[key] = value.slice(0, 2000);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const forms: PluralForms = {};
      for (const [form, text] of Object.entries(value as Record<string, unknown>)) {
        if (PLURAL_FORMS.includes(form) && typeof text === 'string' && text) forms[form as Intl.LDMLPluralRule] = text.slice(0, 2000);
      }
      if (Object.keys(forms).length) messages[key] = forms;
    } else if (value !== null && value !== undefined) {
      problems.push({ kind: 'not-string', key: key.slice(0, 40) });
    }
  }
  return { meta: { code, name, base: base === code ? null : base }, messages, problems };
}

export function localeChain(code: string, bases: (code: string) => string | null | undefined): string[] {
  const chain: string[] = [];
  let current: string | null | undefined = code;
  while (current && current !== SOURCE_LOCALE && !chain.includes(current) && chain.length < 5) {
    chain.push(current);
    current = bases(current);
  }
  return chain;
}

export function localeTemplate(sample: Record<string, unknown>, meta: LocaleMeta): Record<string, unknown> {
  const template: Record<string, unknown> = { $meta: meta };
  for (const [key, value] of Object.entries(sample)) {
    if (key.startsWith('$')) continue;
    template[key] = value && typeof value === 'object' ? structuredClone(value) : value;
  }
  return template;
}
