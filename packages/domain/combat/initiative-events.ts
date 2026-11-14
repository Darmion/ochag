// An initiative event is a slot in the turn order that is nobody's own turn: a lair, a hazard, reinforcements.
// The core knows no particular game; when the slot acts, how it breaks ties and whether an option may repeat are data.

export type EventOption = { name: string; text: string };

export type EventRules = {
  score: number;
  // -1 wins ties against creatures with the same score, 0 breaks them as usual, 1 loses them.
  tieRank: -1 | 0 | 1;
  noRepeat: boolean;
};

export type TurnEvent = { kind: string; active: boolean; rules: EventRules; options: EventOption[] };

export const EVENT_KINDS = ['lair'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_LABELS: Record<EventKind, string> = { lair: 'Логово' };

// D&D 5e: lair actions come on initiative count 20, lose ties, and the same one is not used two rounds running.
export const LAIR_RULES_5E: EventRules = { score: 20, tieRank: 1, noRepeat: true };

export const EVENT_LIMITS = { options: 10, name: 80, text: 600, scoreMin: -10, scoreMax: 50 } as const;

export function eventProblems(event: TurnEvent): string[] {
  const problems: string[] = [];
  if (!(EVENT_KINDS as readonly string[]).includes(event.kind)) problems.push(`Неизвестный вид события «${event.kind}».`);
  const { score, tieRank } = event.rules;
  if (!Number.isInteger(score) || score < EVENT_LIMITS.scoreMin || score > EVENT_LIMITS.scoreMax) {
    problems.push(`Счёт инициативы — целое от ${EVENT_LIMITS.scoreMin} до ${EVENT_LIMITS.scoreMax}.`);
  }
  if (![-1, 0, 1].includes(tieRank)) problems.push('Порядок при ничьей — раньше, как обычно или позже.');
  if (event.options.length > EVENT_LIMITS.options) problems.push(`Вариантов — не больше ${EVENT_LIMITS.options}.`);
  if (event.active && !event.options.length) problems.push('Добавьте хотя бы один вариант действия.');
  const names = new Set<string>();
  event.options.forEach((option, index) => {
    const name = option.name.trim();
    if (!name) problems.push(`Вариант №${index + 1}: нужно название.`);
    else if (names.has(name)) problems.push(`Два варианта «${name}».`);
    names.add(name);
  });
  if (event.rules.noRepeat && event.active && event.options.length === 1) {
    problems.push('Без повтора подряд нужен хотя бы второй вариант, иначе через раунд выбирать будет нечего.');
  }
  return problems;
}

export function eventOf(events: unknown, kind: string): TurnEvent | null {
  if (!Array.isArray(events)) return null;
  return (events as TurnEvent[]).find(event => event?.kind === kind) ?? null;
}

// Indices of the options that may be used now; with noRepeat the one used last time waits a round.
export function freeOptions(event: Pick<TurnEvent, 'options' | 'rules'>, lastUsed: string | null): number[] {
  return event.options
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => !event.rules.noRepeat || option.name !== lastUsed)
    .map(({ index }) => index);
}

export function eventEntryName(ownerName: string, kind: string): string {
  const label = (EVENT_LABELS as Record<string, string>)[kind] ?? kind;
  return `${label}: ${ownerName}`.slice(0, 100);
}
