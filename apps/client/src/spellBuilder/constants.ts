import { SCHOOLS } from '../../../../packages/domain/spells/spell-template.ts';

export const STEPS = [[1, '1. Описание'], [2, '2. Таблица'], [3, '3. Проверка']] as const;
export const STATUS_LABELS: Record<string, string> = { draft: 'черновик', pending: 'на рассмотрении', approved: 'принято', rejected: 'отклонено', rework: 'на доработке' };
export const SCHOOL_OPTIONS = SCHOOLS.map(([value, label]) => [value, label.charAt(0).toUpperCase() + label.slice(1)] as const);
export const SECTIONS = [
  ['passport', 'А. Паспорт'], ['casting', 'Б. Сотворение'], ['duration', 'В. Длительность'], ['targeting', 'Г. Цели'],
  ['options', 'Д. Варианты'], ['actions', 'Е. Действия'], ['commands', 'Ж. Команды'], ['scaling', 'З. Усиление'],
  ['ending', 'И. Окончание'], ['hints', 'К. Подсказки для игры'],
] as const;
export const LETTER_SECTION: Record<string, string> = {
  А: 'passport', Б: 'casting', В: 'duration', Г: 'targeting', Д: 'options', Е: 'actions', Ж: 'commands', З: 'scaling', И: 'ending', К: 'hints',
};
