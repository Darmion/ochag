export type LegendaryOption = { name: string; cost: number; text: string };

export type BossPhase = { atPercent: number; title: string; text: string; public: boolean; done: boolean };

export type BossSettings = { legendaryActions: number; options: LegendaryOption[]; phases: BossPhase[]; legendaryResistances?: number };

export function bossProblems(settings: BossSettings): string[] {
  const problems: string[] = [];
  const { legendaryActions, options, phases } = settings;
  if (!Number.isInteger(legendaryActions) || legendaryActions < 0 || legendaryActions > 5) {
    problems.push('Легендарных действий за раунд — от 0 до 5.');
  }
  const resistances = settings.legendaryResistances ?? 0;
  if (!Number.isInteger(resistances) || resistances < 0 || resistances > 5) problems.push('Легендарного сопротивления в день — от 0 до 5.');
  if (options.length > 10) problems.push('Вариантов легендарных действий — не больше 10.');
  if (legendaryActions > 0 && options.length === 0) problems.push('Добавьте хотя бы один вариант легендарного действия.');
  options.forEach((option, index) => {
    const label = option.name?.trim() || `№${index + 1}`;
    if (!option.name?.trim()) problems.push(`Вариант ${label}: нужно название.`);
    if (!Number.isInteger(option.cost) || option.cost < 1 || option.cost > 3) problems.push(`«${label}»: стоимость — 1, 2 или 3 действия.`);
    else if (legendaryActions > 0 && option.cost > legendaryActions) problems.push(`«${label}» стоит ${option.cost}, а за раунд всего ${legendaryActions}.`);
  });
  if (phases.length > 5) problems.push('Фаз — не больше 5.');
  const seen = new Set<number>();
  phases.forEach((phase, index) => {
    const label = phase.title?.trim() || `№${index + 1}`;
    if (!phase.title?.trim()) problems.push(`Фаза ${label}: нужно название.`);
    if (!Number.isInteger(phase.atPercent) || phase.atPercent < 1 || phase.atPercent > 99) {
      problems.push(`Фаза «${label}»: порог — от 1 до 99 % хитов.`);
    } else if (seen.has(phase.atPercent)) {
      problems.push(`Две фазы на ${phase.atPercent} % хитов.`);
    }
    seen.add(phase.atPercent);
  });
  return problems;
}

export function phaseThreshold(hpMax: number, atPercent: number): number {
  return Math.max(1, Math.floor((hpMax * atPercent) / 100));
}

export function phasesCrossed(phases: BossPhase[], hpMax: number, before: number, after: number): number[] {
  if (after <= 0 || after >= before) return [];
  return phases
    .map((phase, index) => ({ phase, index, threshold: phaseThreshold(hpMax, phase.atPercent) }))
    .filter(({ phase, threshold }) => !phase.done && before > threshold && after <= threshold)
    .sort((a, b) => b.threshold - a.threshold)
    .map(({ index }) => index);
}

export const BOSS_TEMPLATE: BossSettings = {
  legendaryActions: 3,
  legendaryResistances: 3,
  options: [
    { name: 'Атака', cost: 1, text: 'Одна атака оружием.' },
    { name: 'Перемещение', cost: 1, text: 'Перемещается на половину скорости, не провоцируя атак при уходе.' },
    { name: 'Сокрушительный удар', cost: 2, text: 'Две атаки оружием подряд.' },
  ],
  phases: [
    { atPercent: 50, title: 'Ярость раненого', text: 'Босс ранен и приходит в ярость: держитесь!', public: true, done: false },
  ],
};
