export const SEALS = [{ name: 'Пламя', glyph: '♨' }, { name: 'Прилив', glyph: '≈' }, { name: 'Корни', glyph: '❧' }, { name: 'Небо', glyph: '✦' }] as const;
export type Ritual = { revision: number; phase: 'active' | 'won' | 'failed' | 'cancelled'; energy: number[]; target: number[]; moves: number; limit: number; strain: number; message: string; history: string[] };
export type RitualCommand = { action: 'transfer'; from: number; direction: number; amount: number } | { action: 'stabilize' } | { action: 'cancel' };
export function createRitual(revision: number, limit: number, rotation: number): Ritual {
  if (!Number.isInteger(limit) || limit < 6 || limit > 20) throw new Error('Выберите от 6 до 20 ходов.');
  if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) throw new Error('Неизвестное расположение печатей.');
  const base = [6, 1, 1, 4];
  return { revision, phase: 'active', energy: base.map((_, i) => base[(i + rotation) % 4]), target: [3, 3, 3, 3], moves: 0, limit, strain: 0, message: 'Распределите энергию: каждой печати нужно ровно 3.', history: [] };
}
export function actRitual(current: Ritual, command: RitualCommand, user: { name: string; manager: boolean }): Ritual {
  if (current.phase !== 'active') throw new Error('Ритуал завершён.');
  const game = structuredClone(current);
  if (command.action === 'cancel') {
    if (!user.manager) throw new Error('Завершить ритуал может только мастер.');
    game.phase = 'cancelled'; game.message = 'Мастер завершил ритуал.';
  } else {
    if (command.action === 'stabilize') {
      if (!game.strain) throw new Error('Нестабильности нет.');
      game.strain--; game.message = `${user.name}: нестабильность снижена на 1.`;
    } else {
      const { from, direction, amount } = command;
      if (!Number.isInteger(from) || from < 0 || from > 3 || ![-1, 1].includes(direction) || ![1, 2].includes(amount)) throw new Error('Выберите печать, соседнюю цель и 1–2 единицы энергии.');
      const to = (from + direction + 4) % 4;
      if (game.energy[from] < amount) throw new Error('В исходной печати недостаточно энергии.');
      if (game.energy[to] + amount > 6) {
        game.strain++; game.message = `${user.name}: перегрузка ${SEALS[to].name}! Энергия осталась на месте, нестабильность +1.`;
      } else {
        game.energy[from] -= amount; game.energy[to] += amount;
        game.message = `${user.name}: ${SEALS[from].name} → ${SEALS[to].name}, ${amount} энергии.`;
      }
    }
    game.moves++;
    if (game.energy.every((n, i) => n === game.target[i])) { game.phase = 'won'; game.message += ' Все печати в равновесии — ритуал завершён!'; }
    else if (game.strain >= 3 || game.moves >= game.limit) { game.phase = 'failed'; game.message += game.strain >= 3 ? ' Три перегрузки разрушили круг.' : ' Ходы закончились — круг погас.'; }
  }
  game.history.push(game.message); game.revision++;
  return game;
}
