import { emptyAction, newId, type Action } from '../../../../packages/domain/spells/spell-template.ts';

export function toggleIn(list: string[], value: string) {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1); else list.push(value);
}
export function addAction(list: Action[]) {
  list.push(emptyAction(`Действие ${list.length + 1}`));
}
export function duplicate(list: Action[], index: number) {
  const copy = JSON.parse(JSON.stringify(list[index])) as Action;
  copy.id = newId('a');
  list.splice(index + 1, 0, copy);
}
