export const OBJECT_KINDS = ['character', 'npc', 'object'] as const;
export type ObjectKind = typeof OBJECT_KINDS[number];

export type Disposition = 'hostile' | 'neutral' | 'friendly';
export type CreatureSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';

export const KIND_LABELS: Record<ObjectKind, string> = {
  character: 'Персонаж игрока',
  npc: 'НПС',
  object: 'Объект',
};

export const KIND_GROUP_LABELS: Record<ObjectKind, string> = {
  character: 'Персонажи игроков',
  npc: 'НПС',
  object: 'Объекты',
};

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  hostile: 'Враг',
  neutral: 'Нейтрал',
  friendly: 'Союзник',
};

export const SIZE_LABELS: Record<CreatureSize, string> = {
  tiny: 'Крошечный',
  small: 'Маленький',
  medium: 'Средний',
  large: 'Большой',
  huge: 'Огромный',
  gargantuan: 'Громадный',
};

export type CampaignObject = {
  id: string;
  name: string;
  owner_user_id: string | null;
  owner_display_name?: string | null;
  kind: ObjectKind;
  disposition: Disposition | null;
  size: CreatureSize;
  image_asset_id: string | null;
  image_crop?: unknown;
  model_asset_id: string | null;
  shared: boolean;
  can_delete: boolean;
  can_control: boolean;
  container_id?: string | null;
  container_name?: string | null;
};

export function kindBadge(object: { kind: ObjectKind; disposition: Disposition | null }) {
  return object.kind === 'npc' && object.disposition
    ? `${KIND_LABELS.npc} · ${DISPOSITION_LABELS[object.disposition].toLowerCase()}`
    : KIND_LABELS[object.kind];
}
