export const XP_THRESHOLDS = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
] as const;

export function levelForExperience(experience: number) {
  let level = 1;
  for (let index = 1; index < XP_THRESHOLDS.length; index++) {
    if (experience >= XP_THRESHOLDS[index]!) level = index + 1;
  }
  return level;
}

export function nextLevelExperience(level: number | null | undefined) {
  const current = Math.max(1, Math.min(20, Math.trunc(level ?? 1)));
  return current >= 20 ? null : XP_THRESHOLDS[current]!;
}

const CHALLENGE_XP: Record<string, number> = {
  '0': 10, '0.125': 25, '0.25': 50, '0.5': 100,
  '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900,
  '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000, '17': 18000, '18': 20000, '19': 22000, '20': 25000,
  '21': 33000, '22': 41000, '23': 50000, '24': 62000, '25': 75000, '26': 90000, '27': 105000, '28': 120000, '29': 135000, '30': 155000,
};

export const CHALLENGE_RATINGS = Object.keys(CHALLENGE_XP).map(Number);

export function challengeExperience(challenge: number | null | undefined): number | null {
  if (challenge === null || challenge === undefined) return null;
  return CHALLENGE_XP[String(Number(challenge))] ?? null;
}

export function experienceFor(creature: { xp_award?: number | null; challenge_rating?: number | string | null }) {
  if (creature.xp_award !== null && creature.xp_award !== undefined) return creature.xp_award;
  const challenge = creature.challenge_rating === null || creature.challenge_rating === undefined ? null : Number(creature.challenge_rating);
  return challengeExperience(challenge) ?? 0;
}

export function splitExperience(total: number, count: number) {
  return count > 0 ? Math.floor(total / count) : 0;
}

export function levelUpHitPoints(hitDie: number, constitutionModifier: number, levels: number) {
  return Math.max(1, hitDie / 2 + 1 + constitutionModifier) * Math.max(0, levels);
}
