// Texts the desktop shell shows in Windows' own dialogs and window titles, where the page translator does not reach.
// apps/desktop/main/native-texts.cjs gets their translations from the page; a test keeps both lists in step.
// The interface language goes along: Chromium's own controls (file buttons, form hints) follow it from the next start.
export const NATIVE_LOCALE_KEY = '__locale';

export const NATIVE_TEXTS = [
  'Сохранить кампанию в файл',
  'Загрузить кампанию из файла',
  'Сохранить объект в файл',
  'Загрузить объект из файла',
  'Сохранить сцену в файл',
  'Загрузить сцену из файла',
  'Сохранить заклинание в файл',
  'Кампания «Очага»',
  'Объект «Очага»',
  'Сцена «Очага»',
  'Заклинание «Очага»',
  'Заклинание',
  'Кампания',
  'Объект',
  'Сцена',
  'Выберите установщик приложения',
  'Установщик (.exe)',
  'Не удалось запустить «Очаг»',
  'Очаг — вид игроков',
  'Очаг',
  'Служебная часть «Очага» неожиданно остановилась. Перезапустите программу; подробности — в host.log в папке данных.',
];
