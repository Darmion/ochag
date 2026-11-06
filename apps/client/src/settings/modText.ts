import { locale } from '../i18n/i18n';

export type ModTranslations = Record<string, { name?: string; description?: string; author?: string; sections?: Record<string, string> }>;
type Translated = { translations?: ModTranslations };

function translation(mod: Translated) {
  const code = locale.value.toLowerCase();
  return mod.translations?.[code] ?? mod.translations?.[code.split('-')[0]!];
}

export const modText = (mod: Translated, field: 'name' | 'description' | 'author', fallback: string) => translation(mod)?.[field] ?? fallback;
export const modSectionText = (mod: Translated, id: string, fallback: string) => translation(mod)?.sections?.[id] ?? fallback;
