import { findMonster } from './bestiary.ts';
import { parseFormula } from '../dice/dice.ts';

export type TableMonster = { index: string; count: string };
export type TableEntry = { from: number; to: number; text: string; monsters?: TableMonster[] };

export function parseCount(count: string): { min: number; max: number } | null {
  const text = count.trim();
  if (/^\d{1,2}$/.test(text)) {
    const value = Number(text);
    return value >= 1 && value <= 20 ? { min: value, max: value } : null;
  }
  const parsed = parseFormula(text);
  if (!parsed) return null;
  const min = parsed.count + parsed.modifier;
  const max = parsed.count * parsed.sides + parsed.modifier;
  return min >= 1 && max <= 20 ? { min, max } : null;
}

export function rollCount(count: string, rollDie: (sides: number) => number): number {
  const text = count.trim();
  if (/^\d{1,2}$/.test(text)) return Number(text);
  const parsed = parseFormula(text)!;
  let total = parsed.modifier;
  for (let i = 0; i < parsed.count; i += 1) total += rollDie(parsed.sides);
  return Math.max(1, Math.min(20, total));
}

export function tableProblems(formula: string, entries: TableEntry[]): string[] {
  const problems: string[] = [];
  const parsed = parseFormula(formula.trim());
  if (!parsed || parsed.count > 10 || parsed.sides < 2 || parsed.sides > 100 || parsed.modifier !== 0) {
    return ['Кость таблицы — вида 1d6, 2d6 или 1d100 (без прибавок).'];
  }
  const low = parsed.count;
  const high = parsed.count * parsed.sides;
  if (!entries.length) problems.push('В таблице нет строк.');
  const sorted = [...entries].sort((a, b) => a.from - b.from);
  let expected = low;
  for (const entry of sorted) {
    const where = `Строка ${entry.from === entry.to ? entry.from : `${entry.from}–${entry.to}`}`;
    if (!Number.isInteger(entry.from) || !Number.isInteger(entry.to) || entry.from > entry.to) {
      problems.push(`${where}: «от» не больше «до», целые числа.`);
      continue;
    }
    if (entry.from < low || entry.to > high) problems.push(`${where}: вне значений ${formula} (${low}–${high}).`);
    if (entry.from > expected) problems.push(`Не покрыто: ${expected === entry.from - 1 ? expected : `${expected}–${entry.from - 1}`}.`);
    if (entry.from < expected) problems.push(`${where}: пересекается с предыдущей.`);
    expected = Math.max(expected, entry.to + 1);
    if (!entry.text.trim()) problems.push(`${where}: пустой текст.`);
    for (const monster of entry.monsters ?? []) {
      if (!findMonster(monster.index)) problems.push(`${where}: в бестиарии нет «${monster.index}».`);
      else if (!parseCount(monster.count)) problems.push(`${where}: число «${monster.count}» — целое или кости, от 1 до 20.`);
    }
  }
  if (entries.length && expected <= high) problems.push(`Не покрыто: ${expected === high ? high : `${expected}–${high}`}.`);
  return problems;
}

export function entryFor(entries: TableEntry[], total: number): TableEntry | undefined {
  return entries.find(entry => total >= entry.from && total <= entry.to);
}

export type TablePreset = { id: string; name: string; formula: string; secret: boolean; entries: TableEntry[] };

export const TABLE_PRESETS: TablePreset[] = [
  {
    id: 'forest-encounters', name: 'Случайная встреча в лесу (уровни 1–4)', formula: '1d12', secret: true,
    entries: [
      { from: 1, to: 2, text: 'Тихо: только птицы и ветер в кронах.' },
      { from: 3, to: 3, text: 'Следы большого зверя ведут в чащу.' },
      { from: 4, to: 5, text: 'Волки выходят на тропу.', monsters: [{ index: 'wolf', count: '1d4+1' }] },
      { from: 6, to: 6, text: 'Кабан роет землю у ручья.', monsters: [{ index: 'boar', count: '1' }] },
      { from: 7, to: 8, text: 'Гоблины устроили засаду у поваленного дерева.', monsters: [{ index: 'goblin', count: '1d4+2' }] },
      { from: 9, to: 9, text: 'Бандиты требуют «плату за проход».', monsters: [{ index: 'bandit', count: '1d4+1' }, { index: 'thug', count: '1' }] },
      { from: 10, to: 10, text: 'Гигантский паук ждёт в паутине между деревьями.', monsters: [{ index: 'giant-spider', count: '1' }] },
      { from: 11, to: 11, text: 'Бурый медведь не уступит дорогу.', monsters: [{ index: 'brown-bear', count: '1' }] },
      { from: 12, to: 12, text: 'Совомедведь вышел на охоту.', monsters: [{ index: 'owlbear', count: '1' }] },
    ],
  },
  {
    id: 'dungeon-encounters', name: 'Случайная встреча в подземелье (уровни 1–4)', formula: '1d10', secret: true,
    entries: [
      { from: 1, to: 2, text: 'Где-то капает вода; больше ничего.' },
      { from: 3, to: 3, text: 'Гигантские крысы шуршат в куче мусора.', monsters: [{ index: 'giant-rat', count: '2d4' }] },
      { from: 4, to: 4, text: 'Скелеты поднимаются из ниш.', monsters: [{ index: 'skeleton', count: '1d4+1' }] },
      { from: 5, to: 5, text: 'Медленно бредут зомби.', monsters: [{ index: 'zombie', count: '1d4' }] },
      { from: 6, to: 6, text: 'Кобольды тащат ловушку.', monsters: [{ index: 'kobold', count: '2d4' }] },
      { from: 7, to: 7, text: 'Упыри учуяли живых.', monsters: [{ index: 'ghoul', count: '1d3' }] },
      { from: 8, to: 8, text: 'Сундук в углу подозрительно неподвижен.', monsters: [{ index: 'mimic', count: '1' }] },
      { from: 9, to: 9, text: 'Желатиновый куб ползёт по коридору.', monsters: [{ index: 'gelatinous-cube', count: '1' }] },
      { from: 10, to: 10, text: 'Багбиры и их вожак-гоблин.', monsters: [{ index: 'bugbear', count: '1d2' }, { index: 'goblin-boss', count: '1' }] },
    ],
  },
  {
    id: 'tavern-rumors', name: 'Слухи в таверне', formula: '1d8', secret: false,
    entries: [
      { from: 1, to: 1, text: 'Мельник клянётся, что по ночам у мельницы горят огни.' },
      { from: 2, to: 2, text: 'Караван с юга не пришёл уже неделю.' },
      { from: 3, to: 3, text: 'В старом склепе на холме кто-то ходит по ночам.' },
      { from: 4, to: 4, text: 'Барон тайно ищет наёмников — платит золотом.' },
      { from: 5, to: 5, text: 'Охотники видели в лесу медведя с головой совы.' },
      { from: 6, to: 6, text: 'Трактирщик прячет в погребе что-то ценное.' },
      { from: 7, to: 7, text: 'Гоблины с холмов стали нападать организованно — у них новый вожак.' },
      { from: 8, to: 8, text: 'Странник в плаще расспрашивает о древней башне и платит за каждую байку.' },
    ],
  },
  {
    id: 'goblin-pockets', name: 'Карманы гоблина', formula: '1d6', secret: false,
    entries: [
      { from: 1, to: 2, text: 'Пусто, только крошки и камешки.' },
      { from: 3, to: 3, text: '1d6 медных монет и обглоданная кость.' },
      { from: 4, to: 4, text: '2d4 серебряных монеты.' },
      { from: 5, to: 5, text: 'Грубо нарисованная карта с крестиком.' },
      { from: 6, to: 6, text: 'Блестящая безделушка: стеклянный «самоцвет» (или настоящий — 10 зм).' },
    ],
  },
];
