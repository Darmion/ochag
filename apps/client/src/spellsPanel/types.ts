import type { SrdSpell } from '../rules/srd';
import type { DamageType, SpellPurpose } from '../spells/spellPurpose';

export type SpellsRequest = (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;

export type CampaignSpell = {
  id: string; createdBy: string; name: string; level: number; school: string;
  castingTime: string; range: string; components: string; material: string | null;
  duration: string; concentration: boolean; ritual: boolean; classes: string;
  desc: string; higherLevel: string | null;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'rework'; reviewedBy: string | null; reviewedAt: string | null;
  template?: unknown; templateVersion?: number; reviewNote?: string | null;
  damageFormula: string | null; healingFormula: string | null; upcastFormula?: string | null;
};

export type SpellSlot = { level: number; current: number; max: number };
export type CastOption = { key: string; label: string; slotLevel?: number; pact?: boolean; disabled: boolean };
export type LastCast = { spellNameText: string; slot: SpellSlot | null; damageTotal: number | null; healingTotal: number | null; pending?: boolean };
export type FormulaRoll = { spellNameText: string; formula: string; total: number; detail: string };

export type CharacterSpellEntry =
  | { id: string; source: 'srd'; prepared: boolean; granted?: boolean; slotless?: boolean; srdIndex: string; customSpellId: null; spell: SrdSpell | null }
  | { id: string; source: 'custom'; prepared: boolean; granted?: boolean; slotless?: boolean; srdIndex: null; customSpellId: string; spell: CampaignSpell | null };

export type PendingRef = { ref: string; label: string | null; level: number | null; lists: string[]; characters: string[] };
export type Spellcasting = {
  ability: string; abilityFromSheet: boolean; modifier: number; proficiency: number; dc: number; attack: number;
  dcOverride: number | null; attackOverride: number | null; pending: PendingRef[]; classes?: string[];
  autoReactions?: string[]; knowsShield?: boolean; knowsCounterspell?: boolean; knowsRebuke?: boolean;
};

export type AnySpell = SrdSpell | CampaignSpell;
export type BrowseItem = {
  key: string; name: string; alt: string; level: number; school: string;
  source: 'srd' | 'custom'; spell: AnySpell | null; entry: CharacterSpellEntry | null;
  purposes: SpellPurpose[]; damageTypes: DamageType[]; classes: string[];
};
