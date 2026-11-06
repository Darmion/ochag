export const DUEL_MOVES = [
  { id: 'strike', name: 'Натиск', glyph: '⚔', cost: 1, recovery: 0, description: 'Силен против финта и выжидания, но попадает под контрудар защиты.' },
  { id: 'feint', name: 'Финт', glyph: '⌁', cost: 2, recovery: 0, description: 'Пробивает защиту. Уступает прямому натиску.' },
  { id: 'guard', name: 'Защита', glyph: '◇', cost: 0, recovery: 1, description: 'Отражает натиск с контрударом и восстанавливает 1 выносливость.' },
  { id: 'rest', name: 'Выжидание', glyph: '☽', cost: 0, recovery: 2, description: 'Восстанавливает 2 выносливости, но оставляет вас открытым.' },
] as const;
export type DuelMove = typeof DUEL_MOVES[number]['id'];
// Damage dealt by row move against column move: strike, feint, guard, rest.
export const DUEL_DAMAGE = [[1, 2, 0, 2], [0, 1, 2, 1], [1, 0, 0, 0], [0, 0, 0, 0]] as const;
export type DuelPlayer = { id: string; name: string; health: number; stamina: number };
export type Duel = { revision: number; hostId: string; phase: 'lobby' | 'playing' | 'finished' | 'cancelled'; players: DuelPlayer[]; choices: Partial<Record<string, DuelMove>>; round: number; limit: number; winnerId: string | null; message: string; history: { round: number; moves: DuelMove[]; damage: number[] }[] };
export type DuelView = Omit<Duel, 'choices'> & { ready: string[]; ownMove: DuelMove | null };
export type DuelCommand = { action: 'choose'; move: DuelMove } | { action: 'join' | 'leave' | 'start' | 'surrender' | 'cancel' };
export function createDuel(id: string, name: string, revision: number): Duel {
  return { revision, hostId: id, phase: 'lobby', players: [{ id, name, health: 6, stamina: 3 }], choices: {}, round: 1, limit: 8, winnerId: null, message: 'Ждём второго дуэлянта.', history: [] };
}
export function viewDuel(game: Duel, viewerId: string): DuelView {
  const { choices, ...visible } = structuredClone(game);
  return { ...visible, ready: Object.keys(choices), ownMove: choices[viewerId] ?? null };
}
export function actDuel(current: Duel, command: DuelCommand, user: { id: string; name: string; manager: boolean }): Duel {
  if (['finished', 'cancelled'].includes(current.phase)) throw new Error('Дуэль завершена.');
  const game = structuredClone(current);
  const player = game.players.find(p => p.id === user.id);
  if (command.action === 'cancel') {
    if (user.id !== game.hostId && !user.manager) throw new Error('Завершить дуэль может создатель или мастер.');
    game.phase = 'cancelled'; game.choices = {}; game.message = 'Дуэль завершена без победителя.';
  } else if (command.action === 'join') {
    if (game.phase !== 'lobby' || player || game.players.length >= 2) throw new Error('Присоединиться к дуэли сейчас нельзя.');
    game.players.push({ id: user.id, name: user.name, health: 6, stamina: 3 }); game.message = 'Оба дуэлянта готовы. Создатель может начать бой.';
  } else if (command.action === 'leave') {
    if (game.phase !== 'lobby' || !player || user.id === game.hostId) throw new Error('Покинуть сбор может только приглашённый дуэлянт.');
    game.players = game.players.filter(p => p.id !== user.id); game.message = 'Ждём второго дуэлянта.';
  } else if (command.action === 'start') {
    if (game.phase !== 'lobby' || user.id !== game.hostId || game.players.length !== 2) throw new Error('Создатель начинает дуэль после сбора двух участников.');
    game.phase = 'playing'; game.message = 'Выберите приём. Он останется тайным до решения соперника.';
  } else {
    if (game.phase !== 'playing' || !player) throw new Error('Это действие доступно только участнику начавшейся дуэли.');
    if (command.action === 'surrender') {
      game.phase = 'finished'; game.winnerId = game.players.find(p => p.id !== user.id)!.id; game.choices = {}; game.message = `${user.name} уступает дуэль.`;
    } else if (command.action === 'choose') {
      if (game.choices[user.id]) throw new Error('Приём уже выбран. Дождитесь раскрытия раунда.');
      const move = DUEL_MOVES.find(m => m.id === command.move);
      if (!move || player.stamina < move.cost) throw new Error('Для этого приёма недостаточно выносливости.');
      game.choices[user.id] = move.id;
      game.message = 'Один из дуэлянтов выбрал приём. Ждём второго.';
      if (game.players.every(p => game.choices[p.id])) {
        const moves = game.players.map(p => game.choices[p.id]!);
        const indices = moves.map(id => DUEL_MOVES.findIndex(m => m.id === id));
        const damage = [DUEL_DAMAGE[indices[0]][indices[1]], DUEL_DAMAGE[indices[1]][indices[0]]];
        game.players.forEach((p, i) => { const m = DUEL_MOVES[indices[i]]; p.stamina = Math.min(3, p.stamina - m.cost + m.recovery); p.health = Math.max(0, p.health - damage[1 - i]); });
        game.history.push({ round: game.round, moves, damage }); game.choices = {};
        if (game.players.some(p => p.health === 0) || game.round === game.limit) {
          game.phase = 'finished'; const [a, b] = game.players;
          game.winnerId = a.health === b.health ? null : a.health > b.health ? a.id : b.id;
          game.message = game.winnerId ? `Побеждает ${game.players.find(p => p.id === game.winnerId)!.name}.` : 'Равный результат — ничья.';
        } else { game.message = `Раунд ${game.round} раскрыт. Выберите следующий приём.`; game.round++; }
      }
    }
  }
  game.revision++; return game;
}
