export type CombatStats = {
  characterId: string;
  damageDealt: number;
  damageTaken: number;
  hits: number;
  misses: number;
  crits: number;
  kills: number;
  healing: number;
};

type Row = { character_id: string | null; outcome: any };
type Target = { id: string; applied?: number; dropped?: boolean; healed?: number };

export function summarizeCombat(rows: Row[]): Map<string, CombatStats> {
  const stats = new Map<string, CombatStats>();
  const of = (id: string) => {
    let entry = stats.get(id);
    if (!entry) {
      entry = { characterId: id, damageDealt: 0, damageTaken: 0, hits: 0, misses: 0, crits: 0, kills: 0, healing: 0 };
      stats.set(id, entry);
    }
    return entry;
  };
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0);

  for (const { character_id: actor, outcome } of rows) {
    if (!outcome || typeof outcome !== 'object') continue;
    if (outcome.kind === 'attack' && outcome.target?.id && actor) {
      const entry = of(actor);
      if (outcome.hit) entry.hits += 1;
      else entry.misses += 1;
      if (outcome.critical && outcome.hit) entry.crits += 1;
    } else if (outcome.kind === 'damage') {
      const targets: Target[] = outcome.target?.id
        ? [{ id: outcome.target.id, applied: outcome.applied, dropped: outcome.dropped }]
        : Array.isArray(outcome.targets) ? outcome.targets : [];
      for (const target of targets) {
        if (!target?.id) continue;
        const amount = number(target.applied);
        of(target.id).damageTaken += amount;
        if (actor) {
          of(actor).damageDealt += amount;
          if (target.dropped) of(actor).kills += 1;
        }
      }
    } else if (outcome.kind === 'heal' && actor && Array.isArray(outcome.targets)) {
      for (const target of outcome.targets as Target[]) of(actor).healing += number(target.healed);
    }
  }
  return stats;
}
