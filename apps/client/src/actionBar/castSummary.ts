// What a cast will cost, said before the button is pressed (Codex QoL list, 2026-11-10): the slot or other source and what
// remains of it, sorcery points, casting time, a concentration that breaks, and the chosen targets.
export type CastSource =
  | { kind: 'cantrip' } | { kind: 'slotless' } | { kind: 'ritual' } | { kind: 'free'; label: string } | { kind: 'racial' }
  | { kind: 'pact'; level: number; current: number; max: number } | { kind: 'slot'; level: number; current: number; max: number } | { kind: 'none' };

export type CastSummaryInput = {
  source: CastSource;
  points: { cost: number; current: number; max: number } | null;
  time: string | null;
  quickened: boolean;
  concentration: boolean;
  concentrating: boolean;
  targets: string[];
  area: boolean;
};

export type SummaryLine = { text: string; warn?: boolean; names?: string[] };

const TIMES: Record<string, string> = {
  action: 'действие', bonus: 'бонусное действие', reaction: 'реакция', '1m': '1 минута', '10m': '10 минут',
  '1h': '1 час', '8h': '8 часов', '12h': '12 часов', '24h': '24 часа',
};

// The same order as the cast request (actionBar/spellCast.ts): ritual, heritage, a free cast, the pact, then a slot.
export function castSource(input: {
  level: number; slotless: boolean; ritual: boolean; racial: boolean; free: string | null;
  pact: { level: number; current: number; max: number } | null; slot: { level: number; current: number; max: number } | null;
}): CastSource {
  if (input.level === 0) return { kind: 'cantrip' };
  if (input.slotless) return { kind: 'slotless' };
  if (input.ritual) return { kind: 'ritual' };
  if (input.racial) return { kind: 'racial' };
  if (input.free) return { kind: 'free', label: input.free };
  if (input.pact) return { kind: 'pact', ...input.pact };
  return input.slot ? { kind: 'slot', ...input.slot } : { kind: 'none' };
}

function sourceLine(source: CastSource): SummaryLine {
  switch (source.kind) {
    case 'cantrip': return { text: 'Заговор — без ячейки.' };
    case 'slotless': return { text: 'Без ячейки.' };
    case 'ritual': return { text: 'Ритуал — без ячейки, сотворение на 10 минут дольше.' };
    case 'racial': return { text: 'По наследию тифлинга — без ячейки.' };
    case 'free': return { text: `${source.label} — без ячейки.` };
    case 'pact': return { text: `Ячейка договора ${source.level} круга — останется ${source.current - 1} из ${source.max}.` };
    case 'slot': return { text: `Ячейка ${source.level} круга — останется ${source.current - 1} из ${source.max}.` };
    default: return { text: 'Свободной ячейки нет — заклинание не сотворить.', warn: true };
  }
}

export function castSummary(input: CastSummaryInput): SummaryLine[] {
  const lines = [sourceLine(input.source)];
  if (input.points && input.points.cost > 0) {
    const { cost, current, max } = input.points;
    lines.push(cost > current
      ? { text: `Очков чародейства не хватает: нужно ${cost}, есть ${current}.`, warn: true }
      : { text: `Очки чародейства: −${cost}, останется ${current - cost} из ${max}.` });
  }
  const time = input.quickened ? TIMES.bonus : input.time ? TIMES[input.time] ?? null : null;
  if (time) lines.push({ text: `Время: ${time}.` });
  if (input.concentration) {
    lines.push(input.concentrating ? { text: 'Нужна концентрация — текущая прервётся.', warn: true } : { text: 'Нужна концентрация.' });
  }
  if (input.targets.length) lines.push({ text: 'Цели:', names: input.targets });
  else if (input.area) lines.push({ text: 'Область — там, где она поставлена на карте.' });
  return lines;
}
