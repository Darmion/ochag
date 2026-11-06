import type { CreatureSize, Disposition, ObjectKind } from '../campaign/objects';
import type { HitDiceView } from '../rules/hitDice';
import type { VisibilitySetting } from '../components/common/VisibilityControl.vue';
import type { WeaponDTO } from '../components/sheet/WeaponsPanel.vue';

export type SheetRequest = (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;

export type EffectDTO = {
  id: string;
  effect_code: string;
  parameters: Record<string, unknown>;
  active: boolean;
};

export type ResourceDTO = {
  id: string;
  name: string;
  current: number;
  max: number;
  recharge?: Recharge;
};

export type Recharge = 'none' | 'short' | 'long';

export type CharacterDTO = {
  id: string;
  name: string;
  owner_user_id: string | null;
  kind: ObjectKind;
  disposition: Disposition | null;
  size: CreatureSize;
  image_asset_id: string | null;
  image_crop?: unknown;
  model_asset_id: string | null;
  level: number | null;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  hp_current: number;
  hp_max: number;
  hp_temp: number;
  armor_class: number;
  damage_threshold?: number | null;
  speed_feet: number;
  revision: number;
  sheet_extra: Record<string, any>;
  cp?: number; sp?: number; ep?: number; gp?: number; pp?: number;
  price_cp?: number | null;
  weight_lb?: number | null;
  merchant?: boolean;
  death_successes?: number;
  death_failures?: number;
  weapons?: WeaponDTO[];
  damage_resistances?: string[];
  damage_immunities?: string[];
  damage_vulnerabilities?: string[];
  spellcasting_ability?: string | null;
  hit_die?: number | null;
  hit_dice?: HitDiceView;
  experience?: number;
  challenge_rating?: number | null;
  xp_award?: number | null;
  experience_info?: { floor: number; next: number | null; reward: number | null };
  inspiration?: boolean;
  class_name?: string | null;
  attacks_per_action?: number | null;
  class_info?: {
    classId: string | null; attacksPerAction: number;
    classes?: Array<{ id: string; label: string; level: number }>; multiclass?: boolean; problem?: string | null;
    multiclassSlots?: { slots: number[]; pact: { count: number; slotLevel: number } | null } | null;
  };
  pact_slots_max?: number | null;
  pact_slots_current?: number | null;
  pact_slot_level?: number | null;
  effects: EffectDTO[];
  resources: ResourceDTO[];
  hiddenFields: string[];
  privileged: boolean;
  visibility?: Record<string, VisibilitySetting>;
};
