export const CHASE_ROUTES = [
  { name: 'Главная улица', glyph: '♜', progress: 1, difficulty: 2, description: 'Мало продвижения, зато легче пройти препятствие.' },
  { name: 'Переулки', glyph: '⌁', progress: 2, difficulty: 3, description: 'Средний риск и быстрый путь к укрытию.' },
  { name: 'Крыши', glyph: '⌂', progress: 3, difficulty: 4, description: 'Короткий путь с трудными препятствиями.' },
] as const;
export const CHASE_OBSTACLES = [
  { name: 'Перевёрнутая телега', text: 'Телега перегородила дорогу. Можно перескочить преграду или затеряться в толпе.', advantage: 'sprint' },
  { name: 'Туман над каналом', text: 'Сырой туман скрывает силуэты. Самое время запутать след.', advantage: 'hide' },
  { name: 'Ночной рынок', text: 'Торговцы сворачивают лавки. Придётся искать просвет между рядами.', advantage: 'hide' },
  { name: 'Закрывающиеся ворота', text: 'Створки уже движутся. Решительный рывок поможет проскочить.', advantage: 'sprint' },
] as const;
export type Chase = { revision: number; phase: 'route' | 'obstacle' | 'escaped' | 'caught' | 'cancelled'; progress: number; goal: number; gap: number; stamina: number; turn: number; limit: number; route: number | null; obstacle: number | null; lastRoll: number | null; message: string; history: string[] };
export type ChaseCommand = { action: 'route'; route: number } | { action: 'sprint' } | { action: 'hide' } | { action: 'detour' } | { action: 'cancel' };
export function createChase(revision: number): Chase {
  return { revision, phase: 'route', progress: 0, goal: 10, gap: 4, stamina: 3, turn: 0, limit: 8, route: null, obstacle: null, lastRoll: null, message: 'Выберите дорогу к убежищу. Преследователь уже близко.', history: [] };
}
export function chaseDifficulty(game: Chase, action: 'sprint' | 'hide'): number {
  return CHASE_ROUTES[game.route!].difficulty + 1 - (CHASE_OBSTACLES[game.obstacle!].advantage === action ? 1 : 0);
}
export function actChase(current: Chase, command: ChaseCommand, user: { name: string; manager: boolean }, random: (max: number) => number): Chase {
  if (!['route', 'obstacle'].includes(current.phase)) throw new Error('Погоня завершена.');
  const game = structuredClone(current);
  if (command.action === 'cancel') {
    if (!user.manager) throw new Error('Остановить погоню может только мастер.');
    game.phase = 'cancelled'; game.message = 'Мастер остановил погоню.';
  } else if (command.action === 'route') {
    if (game.phase !== 'route') throw new Error('Сначала преодолейте текущее препятствие.');
    if (!Number.isInteger(command.route) || !CHASE_ROUTES[command.route]) throw new Error('Маршрут не найден.');
    const obstacle = random(CHASE_OBSTACLES.length);
    if (!Number.isInteger(obstacle) || obstacle < 0 || obstacle >= CHASE_OBSTACLES.length) throw new Error('Некорректный результат случайного выбора.');
    game.route = command.route; game.obstacle = obstacle; game.lastRoll = null; game.phase = 'obstacle';
    game.message = `${user.name}: ${CHASE_ROUTES[command.route].name}. Впереди — ${CHASE_OBSTACLES[obstacle].name}.`;
  } else {
    if (game.phase !== 'obstacle') throw new Error('Сначала выберите маршрут.');
    if (command.action === 'detour') {
      game.progress++; game.gap--; game.stamina = Math.min(4, game.stamina + 1); game.lastRoll = null;
      game.message = `${user.name}: обход — путь +1, отрыв −1, силы +1 (максимум 4).`;
    } else {
      if (command.action === 'sprint' && game.stamina === 0) throw new Error('Нет сил для рывка. Выберите укрытие или обход.');
      const face = random(6);
      if (!Number.isInteger(face) || face < 0 || face > 5) throw new Error('Некорректный бросок кости.');
      game.lastRoll = face + 1;
      const difficulty = chaseDifficulty(game, command.action);
      if (command.action === 'sprint') game.stamina--;
      const success = game.lastRoll >= difficulty;
      game.progress += success ? CHASE_ROUTES[game.route!].progress : 1;
      game.gap += success ? command.action === 'sprint' ? 2 : 1 : -2;
      game.message = `${user.name}: ${command.action === 'sprint' ? 'рывок' : 'скрыться'}, к6 = ${game.lastRoll}, нужно ${difficulty}+. ${success ? 'Успех!' : 'Неудача: путь +1, отрыв −2.'}`;
    }
    game.turn++;
    game.phase = game.gap <= 0 ? 'caught' : game.progress >= game.goal ? 'escaped' : game.turn >= game.limit ? 'caught' : 'route';
    if (game.phase === 'escaped') game.message += ' Отряд добрался до убежища!';
    if (game.phase === 'caught') game.message += game.gap <= 0 ? ' Преследователь настиг отряд.' : ' Время вышло: выходы перекрыты.';
  }
  game.history.push(game.message); game.revision++;
  return game;
}
