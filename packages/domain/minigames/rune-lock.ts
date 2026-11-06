export const RUNES = [
  { glyph: '☀', name: 'Солнце' }, { glyph: '☽', name: 'Луна' },
  { glyph: '✦', name: 'Звезда' }, { glyph: '♨', name: 'Пламя' },
  { glyph: '❧', name: 'Лист' }, { glyph: '≈', name: 'Волна' },
] as const;
export type RuneSymbol = { name: string; assetId: string | null };
export type RuneLock = {
  symbols: RuneSymbol[];
  revision: number; phase: 'active' | 'opened' | 'jammed' | 'cancelled';
  solution: number[]; rings: number[]; revealed: boolean[]; hint: string;
  attempts: number; limit: number; message: string;
  history: { rings: number[]; matches: number }[];
};
export type RuneView = Omit<RuneLock, 'solution'> & { solution?: number[] };
export type RuneAction = { action: 'rotate'; ring: number; step: number }
  | { action: 'reveal'; ring: number } | { action: 'check' | 'open' | 'cancel' };
export function createRuneLock(solution: number[], hint: string, limit: number, revision: number, symbols: RuneSymbol[] = RUNES.map(r => ({ name: r.name, assetId: null }))): RuneLock {
  if (solution.length !== 3 || solution.some(n => !Number.isInteger(n) || n < 0 || n >= RUNES.length)) throw new Error('Выберите три символа.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new Error('Число проверок: от 1 до 12.');
  if (hint.length > 600) throw new Error('Подсказка: не более 600 символов.');
  return { symbols: structuredClone(symbols), revision, phase: 'active', solution: [...solution], rings: [0, 0, 0], revealed: [false, false, false],
    hint: hint.trim(), attempts: 0, limit, history: [], message: 'Совместите три руны и проверьте комбинацию.' };
}
// Explicit public projection: never serialize a player's copy of the secret solution.
export function viewRuneLock(game: RuneLock, manager: boolean): RuneView {
  const { solution, ...publicState } = structuredClone(game);
  return manager ? { ...publicState, solution } : publicState;
}
export function actRuneLock(current: RuneLock, command: RuneAction, manager: boolean): RuneLock {
  if (['reveal', 'open', 'cancel'].includes(command.action) && !manager) throw new Error('Это действие доступно только мастеру.');
  if (current.phase === 'opened' || current.phase === 'cancelled') throw new Error('Головоломка завершена.');
  const game = structuredClone(current);
  if (command.action === 'open') {
    game.phase = 'opened'; game.message = 'Мастер открыл замок по результату сцены или проверки персонажа.';
  } else if (command.action === 'cancel') {
    game.phase = 'cancelled'; game.message = 'Мастер завершил головоломку.';
  } else {
    if (game.phase !== 'active') throw new Error('Замок заклинило. Дальнейший исход определяет мастер.');
    if (command.action === 'rotate' || command.action === 'reveal') {
      const ring = command.ring;
      if (!Number.isInteger(ring) || ring < 0 || ring > 2) throw new Error('Кольцо не найдено.');
      if (game.revealed[ring]) throw new Error('Это кольцо уже закреплено.');
      if (command.action === 'reveal') {
        game.rings[ring] = game.solution[ring]; game.revealed[ring] = true;
        game.message = `Мастер раскрыл и закрепил кольцо ${ring + 1}.`;
      } else {
        if (command.step !== -1 && command.step !== 1) throw new Error('Поворот возможен только на один символ.');
        game.rings[ring] = (game.rings[ring] + command.step + RUNES.length) % RUNES.length;
        game.message = `Кольцо ${ring + 1} повернулось. Проверки не потрачены.`;
      }
    } else {
      if (game.history.some(entry => entry.rings.every((r, i) => r === game.rings[i]))) throw new Error('Эту комбинацию уже проверяли. Измените кольца.');
      const matches = game.rings.filter((r, i) => r === game.solution[i]).length;
      game.attempts += 1;
      game.history.push({ rings: [...game.rings], matches });
      game.phase = matches === 3 ? 'opened' : game.attempts >= game.limit ? 'jammed' : 'active';
      game.message = matches === 3 ? 'Все три руны совпали. Замок открыт!' : `Верных позиций: ${matches} из 3. ${game.phase === 'jammed' ? 'Замок заклинило — обратитесь к мастеру.' : 'Попробуйте другую комбинацию.'}`;
    }
  }
  game.revision += 1;
  return game;
}
