type Position = { x: number; z: number };

export type ToastTone = 'roll' | 'crit' | 'fumble' | 'turn' | 'mine' | 'info' | 'error';

export type TableToast = {
  id: number;
  tone: ToastTone;
  title: string;
  value?: string;
  detail?: string;
  badge?: string;
  focus?: Position | null;
};

export type ToastRoll = {
  formula: string;
  dice_results: number[];
  breakdown?: Array<{ notation: string; rolls: number[]; kept: number[] }> | null;
};

function naturalD20(roll: ToastRoll): number | null {
  const formula = roll.formula.trim().toLowerCase();
  const dice = roll.dice_results;

  const d20Groups = roll.breakdown?.filter(group => /d20(?:k[hl]1)?$/.test(group.notation)) ?? [];
  if (roll.breakdown?.length === 1 && d20Groups.length === 1 && d20Groups[0]!.kept.length === 1) {
    return d20Groups[0]!.kept[0]!;
  }

  if (/^1d20(?![0-9])/.test(formula) && dice.length === 1) return dice[0] ?? null;
  if (/^2d20(?:adv|kh1)/.test(formula) && dice.length === 2) return Math.max(...dice);
  if (/^2d20(?:dis|kl1)/.test(formula) && dice.length === 2) return Math.min(...dice);
  return null;
}

export type NaturalMark = { kind: 'crit' | 'fumble'; die: number; text: string; total: number | null };

export function naturalMark(roll: ToastRoll & { total: number; label?: string | null; outcome?: { kind?: string; critical?: boolean } | null }): NaturalMark | null {
  if (roll.outcome?.kind === 'initiative' || /инициатив/i.test(roll.label ?? '')) return null;
  const natural = naturalD20(roll);
  if (natural === null) return null;
  const attack = roll.outcome?.kind === 'attack' || /^атака|: атака|атака при уходе/i.test(roll.label ?? '');
  const crit = natural === 20 || (attack && roll.outcome?.critical === true);
  if (!crit && natural !== 1) return null;
  return {
    kind: crit ? 'crit' : 'fumble',
    die: natural,
    text: crit ? `КРИТ · ${natural}` : 'ПРОВАЛ · 1',
    total: attack || roll.total === natural ? null : roll.total,
  };
}

export function formatFeet(feet: number): string {
  return Number.isInteger(feet) ? String(feet) : feet.toFixed(1).replace('.', ',');
}
