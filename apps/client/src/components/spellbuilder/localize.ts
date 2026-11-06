import { locale } from '../../i18n/i18n';

const COMPONENTS: Record<string, string> = { В: 'V', С: 'S', М: 'M' };

export function localized(text: string): string {
  if (locale.value === 'ru') return text;
  return text
    .replace(/(\d+)\s*к\s*(\d+)/g, '$1d$2')
    .replace(/(^|· )([ВСМ](?: [ВСМ])*)(?= ·| \(|$)/g,(_, before: string, letters: string) => before + letters.replace(/[ВСМ]/g, letter => COMPONENTS[letter]!));
}
