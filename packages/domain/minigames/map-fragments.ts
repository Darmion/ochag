export const MAP_STORIES = [
  { title: 'Тропа к лунному святилищу', description: 'Сопоставьте дорожные записи до и после наводнения.', places: ['Старый мост', 'Сторожевая башня', 'Тисовая роща', 'Лунное святилище', 'Затопленная мельница'], solution: [1, 0, 2, 3],
    scraps: [
      { source: 'Дозорная запись · после наводнения', text: 'Нынешний путь начинается у сторожевой башни. Из неё выходят прямо к старому мосту.' },
      { source: 'Заметка травницы · после наводнения', text: 'Сразу после старого моста путник проходит тисовую рощу. Святилище — конечная точка.' },
      { source: 'Объявление смотрителя · после наводнения', text: 'Мельница затоплена. В действующем маршруте её нет.' },
      { source: 'Выцветший путеводитель · до наводнения', text: 'Начинайте у мельницы: от неё путь ведёт к святилищу через башню.' },
    ], hint: 'Сравните даты: старый путеводитель описывает дорогу до наводнения.' },
  { title: 'Контрабандный путь', description: 'Восстановите новый маршрут после смены караула.', places: ['Северные ворота', 'Соляной склад', 'Сухой колодец', 'Тайная пристань', 'Рыночная площадь'], solution: [2, 1, 0, 3],
    scraps: [
      { source: 'Шифровка курьера · новый караул', text: 'Точка сбора — сухой колодец. Следующая остановка — соляной склад.' },
      { source: 'План лодочника · новый караул', text: 'Со склада идут к северным воротам, а сразу за ними — тайная пристань. Там маршрут заканчивается.' },
      { source: 'Предупреждение связного · новый караул', text: 'Площадь под наблюдением. Новый маршрут обходит её полностью.' },
      { source: 'Старая расписка · прежний караул', text: 'Встречаемся на рыночной площади и идём к пристани через колодец.' },
    ], hint: 'Ищите инструкции для нового караула. Встреча назначена у колодца.' },
  { title: 'Дорога через пепельный перевал', description: 'Найдите безопасный путь после обвала в горах.', places: ['Каменный лагерь', 'Пепельный перевал', 'Звонкая пещера', 'Обсерватория', 'Рухнувший виадук'], solution: [0, 2, 1, 3],
    scraps: [
      { source: 'Дневник проводника · после обвала', text: 'Выходим из каменного лагеря. До перевала обязательно проходим звонкую пещеру.' },
      { source: 'Письмо астронома · после обвала', text: 'Обсерватория завершает путь. Непосредственно перед ней — пепельный перевал.' },
      { source: 'Отметка спасателей · после обвала', text: 'Виадук разрушен, по нему не пройти. Оставшиеся четыре места нужно посетить по одному разу.' },
      { source: 'Карта инженера · до обвала', text: 'Из лагеря идите к виадуку; пещеру лучше пропустить.' },
    ], hint: 'Исключите разрушенный виадук. Между лагерем и перевалом остаётся пещера.' },
] as const;
export type MapFragments = { revision: number; phase: 'active' | 'solved' | 'lost' | 'cancelled'; story: number; title: string; description: string; places: string[]; scraps: { source: string; text: string }[]; solution: number[]; hint: string; hintShown: boolean; route: number[]; doubtful: number[]; attempts: number; limit: number; message: string; notes: { author: string; text: string }[]; history: { route: number[]; matches: number }[] };
export type MapFragmentsView = Omit<MapFragments, 'solution' | 'hint'> & { solution?: number[]; hint?: string };
export type MapCommand = { action: 'append'; place: number } | { action: 'remove'; slot: number } | { action: 'mark'; scrap: number } | { action: 'note'; text: string } | { action: 'check' | 'hint' | 'solve' | 'cancel' };
export function createMapFragments(revision: number, story: number): MapFragments {
  if (!Number.isInteger(story) || !MAP_STORIES[story]) throw new Error('История не найдена.');
  const source = MAP_STORIES[story];
  return { revision, story, phase: 'active', title: source.title, description: source.description, places: [...source.places], scraps: source.scraps.map(s => ({ ...s })), solution: [...source.solution], hint: source.hint, hintShown: false, route: [], doubtful: [], attempts: 0, limit: 4, message: 'Соберите маршрут из четырёх разных мест. Одно место лишнее.', notes: [], history: [] };
}
export function viewMapFragments(game: MapFragments, manager: boolean): MapFragmentsView {
  const { solution, hint, ...publicState } = structuredClone(game);
  return { ...publicState, ...(manager ? { solution } : {}), ...(manager || game.hintShown ? { hint } : {}) };
}
export function actMapFragments(current: MapFragments, command: MapCommand, user: { name: string; manager: boolean }): MapFragments {
  if (['hint', 'solve', 'cancel'].includes(command.action) && !user.manager) throw new Error('Это действие доступно только мастеру.');
  if (['solved', 'cancelled'].includes(current.phase)) throw new Error('Поиск маршрута завершён.');
  const game = structuredClone(current);
  if (command.action === 'solve') { game.phase = 'solved'; game.route = [...game.solution]; game.message = 'Мастер указал верный путь по результатам сцены.'; }
  else if (command.action === 'cancel') { game.phase = 'cancelled'; game.message = 'Мастер завершил поиск маршрута.'; }
  else if (command.action === 'hint') {
    if (game.hintShown) throw new Error('Подсказка уже открыта.');
    game.hintShown = true; game.message = 'Мастер добавил подсказку к карте.';
  } else {
    if (game.phase !== 'active') throw new Error('Проверки закончились. Дальнейший путь определяет мастер.');
    if (command.action === 'append') {
      if (!Number.isInteger(command.place) || command.place < 0 || command.place >= game.places.length || game.route.includes(command.place) || game.route.length === 4) throw new Error('Выберите ещё не добавленное место. В пути четыре остановки.');
      game.route.push(command.place); game.message = `${user.name}: добавлено место «${game.places[command.place]}».`;
    } else if (command.action === 'remove') {
      if (!Number.isInteger(command.slot) || command.slot < 0 || command.slot >= game.route.length) throw new Error('Остановка не найдена.');
      game.route.splice(command.slot, 1); game.message = `${user.name}: маршрут изменён.`;
    } else if (command.action === 'mark') {
      if (!Number.isInteger(command.scrap) || command.scrap < 0 || command.scrap >= game.scraps.length) throw new Error('Обрывок не найден.');
      game.doubtful = game.doubtful.includes(command.scrap) ? game.doubtful.filter(s => s !== command.scrap) : [...game.doubtful, command.scrap];
      game.message = `${user.name}: отметка на обрывке изменена.`;
    } else if (command.action === 'note') {
      const text = command.text.trim();
      if (!text || text.length > 240 || game.notes.length >= 20) throw new Error('Запись: 1–240 символов. На карте не больше 20 заметок.');
      game.notes.push({ author: user.name, text }); game.message = `${user.name}: добавлена заметка.`;
    } else {
      if (game.route.length !== 4) throw new Error('Сначала выберите четыре места.');
      if (game.history.some(entry => entry.route.every((place, i) => place === game.route[i]))) throw new Error('Этот маршрут уже проверяли. Измените порядок или состав.');
      const matches = game.route.filter((place, i) => place === game.solution[i]).length;
      game.attempts++; game.history.push({ route: [...game.route], matches });
      game.phase = matches === 4 ? 'solved' : game.attempts === game.limit ? 'lost' : 'active';
      game.message = matches === 4 ? 'Все обрывки сошлись. Путь восстановлен!' : `Верных позиций: ${matches} из 4. ${game.phase === 'lost' ? 'Проверки закончились — обратитесь к мастеру.' : 'Сопоставьте даты и последовательность мест.'}`;
    }
  }
  game.revision++; return game;
}
