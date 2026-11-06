import type { WallStyle } from '../scene';
import type { SceneAmbience } from '../ambience';
import type { CampaignObject, ObjectKind } from '../../campaign/objects';
import type { Weather } from '../../campaign/worldClock';
import type { ObjectState } from '../../components/objects/ObjectStatePanel.vue';
import type { AreaShape } from '../areas';
import type { RollOutcome } from '../../rules/conditions';

export type TabletopProps = {
  campaignId: string;
  token: string;
  currentUserId: string;
  request: (
    path: string,
    method?: string,
    body?: unknown,
    file?: File,
  ) => Promise<any>;
  viewAs?: string;
  fixedSceneId?: string;
};

export type SceneInfo = {
  id: string;
  name: string;
  revision: number;
  width_cells?: number;
  height_cells?: number;
  feet_per_unit?: number;
  background_asset_id?: string | null;
  background_rotation?: number | null;
};

export type SceneDetail = SceneInfo & {
  width_cells: number;
  height_cells: number;
  feet_per_unit: number;
  background_asset_id: string | null;
  background_rotation?: number;
  default_vision_radius_feet: number | null;
  playlist?: string[];
  lighting?: 'bright' | 'dim' | 'dark';
  mood_playlists?: { combat?: string[]; tension?: string[] };
  grid?: unknown;
  ambience?: SceneAmbience;
  sky?: 'fixed' | 'clock';
  weather?: Weather;
  effective_lighting?: 'bright' | 'dim' | 'dark';
  world_minutes?: number;
  difficult_cells?: number[][];
  rest?: { kind: 'short' | 'long'; startedMinutes: number; strenuousMinutes?: number; interrupted: string | null } | null;
  canManage: boolean;
};

export type Character = CampaignObject;

export type SceneObjectDTO = {
  id: string;
  character_id: string;
  name: string;
  kind: ObjectKind;
  disposition: 'hostile' | 'neutral' | 'friendly' | null;
  side?: 'self' | 'ally' | 'enemy' | 'neutral' | null;
  factions?: string[];
  canFly?: boolean;
  classId?: string;
  flightHeight?: number;
  size: string;
  owner_user_id: string | null;
  shared: boolean;
  hidden: boolean;
  hp: { current: number; max: number; temp: number } | null;
  conditions?: string[];
  loot?: number;
  inspired?: boolean;
  state?: ObjectState | null;
  darkvision_feet?: number | null;
  merchant?: boolean;
  model_asset_id: string | null;
  image_asset_id: string | null;
  image_crop?: unknown;
  parent_object_id: string | null;
  x: number;
  y: number;
  z: number;
  rotation_y: number;
  scale: number;
  snap_to_grid: boolean;
  animation_name: string | null;
  revision: number;
  world_x: number;
  world_y: number;
  world_z: number;
  canEdit: boolean;
  canMove: boolean;
  canShare: boolean;
};

export type LibraryAsset = {
  id: string;
  kind: string;
  content_type: string;
  byte_size: number;
  original_filename: string | null;
  created_at: string;
};

export type RollEntry = {
  id: string;
  user_id: string;
  character_id: string | null;
  label: string | null;
  formula: string;
  dice_results: number[];
  modifier: number;
  total: number;
  hidden: boolean;
  created_at: string;
  user_display_name?: string | null;
  breakdown?: Array<{ notation: string; sign: 1 | -1; rolls: number[]; kept: number[] }> | null;
  outcome?: RollOutcome | null;
};

export type InitiativeEntry = {
  id: string;
  character_id: string | null;
  name: string;
  score: number;
  is_current: boolean;
  moved_feet?: number;
  dashes?: number;
  action_used?: boolean;
  bonus_used?: boolean;
  reaction_used?: boolean;
  attacks_made?: number;
  attacks_per_action?: number;
  disengaged?: boolean;
  legendary_actions?: number;
  legendary_used?: number;
  sneak_attack_used?: boolean;
  action_surged?: boolean;
  death_saved?: boolean;
  haste_used?: boolean;
};

export type NoteSummary = {
  id: string;
  title: string;
  created_by: string;
  revision: number;
  grantedUsers?: Array<{ userId: string; displayName: string }>;
};

export type TemplateDTO = {
  id: string; shape: AreaShape; x: number; z: number; direction: number;
  size_feet: number; width_feet: number | null; color: string; label: string | null;
  created_by: string; author_name: string;
};

export type WallTool = 'chain' | 'room' | 'pick' | 'opening';

export type SoundTab = 'music' | 'effects' | 'ambience' | 'events';

export type PickClass = 'creatures' | 'things' | 'walls' | 'areas';

export type BuilderTool = 'walls' | 'doors' | 'terrain' | 'traps';

export type ObjectSave = {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
  snapToGrid: boolean;
  parentObjectId: string | null;
  animationName: string | null;
  hidden: boolean;
  formation?: string[];
};

export type LivePoint = { x: number; y: number; z: number; rotationY?: number; scale?: number };

export type WallCoords = { x1: number; z1: number; x2: number; z2: number; style?: WallStyle; textureAssetId?: string };

export type WallGroupEntry = { id: string; coords: WallCoords };

export type DrawingData = { kind: 'path' | 'text'; layer: 'all' | 'gm'; color: string; points: number[][]; text?: string };

export type SceneSize = {
  widthCells: number;
  heightCells: number;
  feetPerUnit: number;
  defaultVisionRadiusFeet: number | null;
  lighting: 'bright' | 'dim' | 'dark';
};

export type ReachInfo = { limited: boolean; isTurn: boolean; feetLeft: number | null; budget: number | null; cells: number[][]; costs?: number[][]; trail?: number[][] };

export type OpportunityPrompt = { key: string; moverId: string; moverName: string; reactorId: string; reactorName: string; weaponId: string | null; reason: 'leave' | 'sentinel' | 'mage-slayer' };

export type SlotChoice = { value: string; level: number; label: string };

export type CounterPrompt = {
  key: string; windowId: string; casterName: string; spellName: string; spellLevel: number;
  reactorId: string; reactorName: string; choices: SlotChoice[]; choice: string; deadline: number;
};

export type RebukePrompt = {
  key: string; sceneId: string; reactorId: string; reactorName: string; triggerId: string; triggerName: string;
  spellEntryId: string; choices: SlotChoice[]; choice: string; deadline: number;
};

export type LegendaryOption = { name: string; cost: number; text: string };
