// Things on scenes a new mini-game can be tied to (GET …/minigames/rune-lock and map-fragments, GM only).
export type LinkChoice = { id: string; name: string; scene: string };

export function linkGroups(choices: LinkChoice[]) {
  const groups = new Map<string, LinkChoice[]>();
  for (const choice of choices) groups.set(choice.scene, [...(groups.get(choice.scene) ?? []), choice]);
  return [...groups].map(([scene, items]) => ({ scene, items }));
}
