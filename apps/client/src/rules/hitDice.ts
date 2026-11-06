export type HitDiceView = { die: number; total: number; left: number; pools?: Array<{ die: number; total: number; left: number }> };

export function hitDiceSummary(view: HitDiceView): string {
  if (view.pools && view.pools.length > 1) return view.pools.map(pool => `${pool.left} из ${pool.total} d${pool.die}`).join(' · ');
  return `${view.left} из ${view.total} (d${view.die})`;
}
