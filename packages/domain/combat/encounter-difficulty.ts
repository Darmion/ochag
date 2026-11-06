export type Difficulty = 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly';

const THRESHOLDS: Record<number, [number, number, number, number]> = {
  1: [25, 50, 75, 100], 2: [50, 100, 150, 200], 3: [75, 150, 225, 400], 4: [125, 250, 375, 500],
  5: [250, 500, 750, 1100], 6: [300, 600, 900, 1400], 7: [350, 750, 1100, 1700], 8: [450, 900, 1400, 2100],
  9: [550, 1100, 1600, 2400], 10: [600, 1200, 1900, 2800], 11: [800, 1600, 2400, 3600], 12: [1000, 2000, 3000, 4500],
  13: [1100, 2200, 3400, 5100], 14: [1250, 2500, 3800, 5700], 15: [1400, 2800, 4300, 6400], 16: [1600, 3200, 4800, 7200],
  17: [2000, 3900, 5900, 8800], 18: [2100, 4200, 6300, 9500], 19: [2400, 4900, 7300, 10900], 20: [2800, 5700, 8500, 12700],
};

const STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  trivial: 'пустяковая', easy: 'лёгкая', medium: 'средняя', hard: 'сложная', deadly: 'смертельная',
};

export function partyThresholds(levels: number[]) {
  const sum = [0, 0, 0, 0];
  for (const raw of levels) {
    const level = Math.max(1, Math.min(20, Math.round(raw)));
    THRESHOLDS[level]!.forEach((value, index) => { sum[index]! += value; });
  }
  return { easy: sum[0]!, medium: sum[1]!, hard: sum[2]!, deadly: sum[3]! };
}

export function encounterMultiplier(monsters: number, partySize: number): number {
  if (monsters <= 0) return 1;
  let step = monsters === 1 ? 1 : monsters === 2 ? 2 : monsters <= 6 ? 3 : monsters <= 10 ? 4 : monsters <= 14 ? 5 : 6;
  if (partySize > 0 && partySize < 3) step += 1;
  else if (partySize >= 6) step -= 1;
  return STEPS[Math.max(0, Math.min(STEPS.length - 1, step))]!;
}

export type DifficultyResult = {
  partySize: number;
  monsters: number;
  experience: number;
  multiplier: number;
  adjusted: number;
  thresholds: { easy: number; medium: number; hard: number; deadly: number };
  rating: Difficulty;
  label: string;
};

export function encounterDifficulty(partyLevels: number[], monsterExperience: number[]): DifficultyResult {
  const counted = monsterExperience.filter(xp => xp > 0);
  const experience = counted.reduce((sum, xp) => sum + xp, 0);
  const multiplier = encounterMultiplier(counted.length, partyLevels.length);
  const adjusted = Math.round(experience * multiplier);
  const thresholds = partyThresholds(partyLevels);
  const rating: Difficulty = !partyLevels.length || !counted.length ? 'trivial'
    : adjusted >= thresholds.deadly ? 'deadly'
      : adjusted >= thresholds.hard ? 'hard'
        : adjusted >= thresholds.medium ? 'medium'
          : adjusted >= thresholds.easy ? 'easy' : 'trivial';
  return { partySize: partyLevels.length, monsters: counted.length, experience, multiplier, adjusted, thresholds, rating, label: DIFFICULTY_LABELS[rating] };
}
