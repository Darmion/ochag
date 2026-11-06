import { computed, ref, watch } from 'vue';

import {
  SOURCE_LOCALE, localeChain, localeTemplate, parseLocaleFile, translate, translatePlural,
  type LocaleMeta, type LocaleProblem, type Messages, type Params,
} from './i18nCore';
import englishFile from '../locales/en.json';
import { SOURCE_KEYS } from '../locales/keys';

const en = parseLocaleFile(englishFile, 'en').messages;

export type LocaleInfo = LocaleMeta & { kind: 'source' | 'built-in' | 'user'; size: number; file?: string; problems?: LocaleProblem[] };

const KEY = 'ttrpg.locale.choice';
export const DEFAULT_LOCALE = 'en';
const BUILT_IN: Record<string, { meta: LocaleMeta; messages: Messages }> = {
  en: { meta: { code: 'en', name: 'English', base: null }, messages: en },
};

const userLocales = ref<Record<string, { info: LocaleInfo; messages: Messages }>>({});
export const localeErrors = ref<Array<{ file: string; error: string }>>([]);

function readSaved(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export const locale = ref(readSaved());

watch(locale, value => {
  try {
    localStorage.setItem(KEY, value);
  } catch {
  }
});
watch(locale, value => {
  if (typeof document !== 'undefined') document.documentElement.lang = value;
}, { immediate: true });

function entryOf(code: string) {
  return userLocales.value[code] ?? (BUILT_IN[code] ? { info: { ...BUILT_IN[code]!.meta, kind: 'built-in' as const, size: 0 }, messages: BUILT_IN[code]!.messages } : null);
}

const chain = computed(() =>
  localeChain(locale.value, code => entryOf(code)?.info.base ?? (code === 'en' ? null : 'en'))
    .map(code => ({ code, messages: entryOf(code)?.messages ?? {} })));

export const translationEntries = computed<Array<[string, string]>>(() => {
  const entries: Array<[string, string]> = [];
  for (const { code, messages } of chain.value) {
    if (code === SOURCE_LOCALE) continue;
    for (const [key, value] of Object.entries(messages)) if (typeof value === 'string' && value) entries.push([key, value]);
  }
  return entries;
});

// No-op marker so scripts/i18n-extract.mjs collects data strings; t() translates them on output.
export const tr = (key: string): string => key;

export function t(key: string, params?: Params): string {
  return translate(chain.value, key, params);
}

export function tn(count: number, key: string, params?: Params): string {
  return translatePlural(chain.value, key, count, params);
}

export const availableLocales = computed<LocaleInfo[]>(() => [
  { code: SOURCE_LOCALE, name: 'Русский', base: null, kind: 'source', size: SOURCE_KEYS.length },
  ...Object.values(BUILT_IN).filter(entry => !userLocales.value[entry.meta.code]).map(entry => ({ ...entry.meta, kind: 'built-in' as const, size: Object.keys(entry.messages).length })),
  ...Object.values(userLocales.value).map(entry => entry.info),
]);

export function coverage(code: string): number {
  if (code === SOURCE_LOCALE || !SOURCE_KEYS.length) return 1;
  const messages = entryOf(code)?.messages ?? {};
  return SOURCE_KEYS.filter(key => messages[key] !== undefined).length / SOURCE_KEYS.length;
}

export function baseName(code: string): string | null {
  const base = entryOf(code)?.info.base;
  return base ? entryOf(base)?.info.name ?? base : null;
}

export function problemText(problem: LocaleProblem): string {
  if (problem.kind === 'not-object') return t('файл — не объект JSON');
  if (problem.kind === 'bad-code') return t('код языка «{code}» — нужен вида «de» или «pt-BR»', { code: problem.code });
  if (problem.kind === 'too-many') return t('строк больше {limit} — остальные пропущены', { limit: problem.limit });
  return t('«{key}» — не строка', { key: problem.key });
}

export async function loadUserLocales(): Promise<void> {
  const api = typeof window !== 'undefined' ? window.desktop?.locales : undefined;
  if (!api) return;
  const found: Record<string, { info: LocaleInfo; messages: Messages }> = {};
  const errors: Array<{ file: string; error: string }> = [];
  for (const entry of await api.list()) {
    if (entry.error || entry.data === undefined) {
      errors.push({ file: entry.file, error: entry.error ?? t('не прочитан') });
      continue;
    }
    const parsed = parseLocaleFile(entry.data, entry.file.replace(/\.json$/i, ''));
    if (parsed.meta.code === SOURCE_LOCALE) {
      errors.push({ file: entry.file, error: t('русский — исходный язык, переводить его не нужно') });
      continue;
    }
    found[parsed.meta.code] = {
      info: { ...parsed.meta, kind: 'user', size: Object.keys(parsed.messages).length, file: entry.file, ...(parsed.problems.length ? { problems: parsed.problems } : {}) },
      messages: parsed.messages,
    };
  }
  userLocales.value = found;
  localeErrors.value = errors;
  if (locale.value !== SOURCE_LOCALE && !entryOf(locale.value)) locale.value = DEFAULT_LOCALE;
}

export function buildTemplate(): Record<string, unknown> {
  return localeTemplate(englishFile as Record<string, unknown>, { code: 'xx', name: 'Новый язык', base: 'en' });
}

export async function saveTemplate(): Promise<string | null> {
  const api = typeof window !== 'undefined' ? window.desktop?.locales : undefined;
  return api ? api.saveTemplate(buildTemplate()) : null;
}

export async function openLocalesFolder(): Promise<string | null> {
  const api = typeof window !== 'undefined' ? window.desktop?.locales : undefined;
  return api ? api.openFolder() : null;
}
