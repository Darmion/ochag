export type ParsedFormula = {
  count: number;
  sides: number;
  modifier: number;
};

const FORMULA_PATTERN = /^([1-9][0-9]?)d([1-9][0-9]{0,2})([+-][0-9]{1,3})?$/i;

export function parseFormula(formula: string): ParsedFormula | null {
  const match = FORMULA_PATTERN.exec(formula.trim());

  if (!match) return null;

  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3]) : 0;

  if (count < 1 || count > 20) return null;
  if (sides < 1 || sides > 1000) return null;
  if (Math.abs(modifier) > 100) return null;

  return { count, sides, modifier };
}

export function rollDice(
  parsed: ParsedFormula,
  rollDie: (sides: number) => number,
): { results: number[]; total: number } {
  const results = Array.from({ length: parsed.count }, () => rollDie(parsed.sides));
  const total = results.reduce((sum, value) => sum + value, 0) + parsed.modifier;

  return { results, total };
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function proficiencyBonusForLevel(level: number): number {
  return Math.ceil(level / 4) + 1;
}

export function proficiencyBonusForChallenge(challenge: number): number {
  return Math.floor((Math.max(1, challenge) - 1) / 4) + 2;
}

export function proficiencyOf(character: { level?: unknown; challenge_rating?: unknown; sheet_extra?: any }): number | null {
  if (typeof character.level === 'number') return proficiencyBonusForLevel(character.level);
  const legacy = character.sheet_extra?.proficiency;
  if (typeof legacy === 'number' && Number.isFinite(legacy)) return legacy;
  const challenge = character.challenge_rating === null || character.challenge_rating === undefined ? NaN : Number(character.challenge_rating);
  return Number.isFinite(challenge) ? proficiencyBonusForChallenge(challenge) : null;
}

export type Advantage = 'none' | 'adv' | 'disadv';

export function rollCheck(
  modifier: number,
  advantage: Advantage,
  rollDie: (sides: number) => number,
): { results: number[]; kept: number; total: number } {
  const results = advantage === 'none' ? [rollDie(20)] : [rollDie(20), rollDie(20)];
  const kept = advantage === 'disadv' ? Math.min(...results) : Math.max(...results);

  return { results, kept, total: kept + modifier };
}

export function hitChance(modifier: number, targetAc: number, advantage: Advantage, critAt = 20): number {
  const hits = (natural: number) => natural >= Math.min(20, critAt) || (natural !== 1 && natural + modifier >= targetAc);

  if (advantage === 'none') {
    let count = 0;
    for (let n = 1; n <= 20; n += 1) if (hits(n)) count += 1;
    return count / 20;
  }

  let count = 0;
  for (let a = 1; a <= 20; a += 1) {
    for (let b = 1; b <= 20; b += 1) {
      const kept = advantage === 'adv' ? Math.max(a, b) : Math.min(a, b);
      if (hits(kept)) count += 1;
    }
  }
  return count / 400;
}
