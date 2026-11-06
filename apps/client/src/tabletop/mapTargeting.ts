export function mapTargetDecision(input: {
  mode: 'attack' | 'spell'; known: boolean; self: boolean; busy: boolean; blocked?: boolean;
  distance: number | null; range: number | null; selected: string[]; id: string; single?: boolean;
}): { kind: 'ignore' } | { kind: 'error'; message: string } | { kind: 'attack' } | { kind: 'spell'; targets: string[] } {
  if (input.busy) return { kind: 'ignore' };
  if ((!input.known && !(input.mode === 'spell' && input.self)) || (input.mode === 'attack' && input.self))
    return { kind: 'error', message: 'Эта цель недоступна.' };
  if (input.blocked) return { kind: 'error', message: 'Сейчас нельзя атаковать этим оружием.' };
  if (input.range !== null && input.distance !== null && input.distance > input.range)
    return { kind: 'error', message: 'Цель вне досягаемости. Подойдите ближе или выберите другое действие.' };
  if (input.mode === 'attack') return { kind: 'attack' };
  return { kind: 'spell', targets: input.single ? [input.id] : input.selected.includes(input.id)
    ? input.selected.filter(id => id !== input.id) : [...input.selected, input.id] };
}
