export type Weapon = {
  id: string; name: string; ability: string; proficient: boolean; range_feet?: number;
  weapon_kind?: 'melee' | 'ranged'; long_range_feet?: number | null; thrown_range_feet?: number | null; versatile_formula?: string | null;
};

export type AttackOptions = {
  inCombat: boolean; current: boolean; enforced: boolean;
  weapons: Array<{ id: string; bonus: string | null; bonusLabel: string | null; bonusReason: string | null }>;
  readied: { trigger: string | null } | null; reactionReason: string | null;
};
