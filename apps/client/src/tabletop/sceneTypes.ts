import type { AbstractMesh, InstantiatedEntries, Mesh, StandardMaterial, TransformNode, Vector3, DynamicTexture } from '@babylonjs/core';
import type { BoardDimensions, Position } from './grid';
import type { Area, AreaShape } from './areas';
import type { OverlayLabel } from './board/labels';
import type { GameIconName } from '../ui/gameIcons';

export type ObjectSide = 'mine' | 'party' | 'hostile' | 'neutral' | 'friendly' | 'object';

export type ObjectAppearance =
  | { kind: 'model'; assetId: string }
  | { kind: 'image'; assetId: string }
  | { kind: 'default' };

export type PlacedObject = {
  id: string;
  name: string;
  icons?: GameIconName[];
  creature: boolean;
  size: string;
  side: ObjectSide;
  appearance: ObjectAppearance;
  world_x: number;
  world_y: number;
  world_z: number;
  rotation_y: number;
  scale: number;
  animation_name: string | null;
  current: boolean;
  hidden: boolean;
  hp: { current: number; max: number; temp: number } | null;
  dead?: boolean;
  light?: { bright: number; dim: number; cone?: number | null } | null;
};

export type ObjectTransform = {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
};

export type GizmoMode = 'move' | 'rotate' | 'scale';

export type WallStyle = 'stone' | 'brick' | 'wood' | 'hedge' | 'rock' | 'plain' | 'image';
export type WallKind = 'wall' | 'door' | 'window';
export type WallSegment = {
  id: string; x1: number; z1: number; x2: number; z2: number;
  style?: WallStyle; texture_asset_id?: string | null;
  kind?: WallKind; open?: boolean; locked?: boolean; hp?: number | null; hp_max?: number | null; broken?: boolean; condition?: string;
};
export type GridCellRef = { col: number; row: number };

export type SeenLight = 'bright' | 'dim' | 'dark';
export type FogCell = { x: number; z: number; light?: SeenLight };
export type FogState = {
  visibleCells: FogCell[];
  exploredCells: Array<{ x: number; z: number }>;
} | null;

export type LiveHooks = {
  canDragObject?: (objectId: string) => boolean;
  onObjectGrab?: (objectId: string) => void;
  onObjectPull?: (objectId: string, transform: ObjectTransform) => void;
  onObjectRelease?: (objectId: string) => void;
};

export type PoseSource = { draggedByMe: boolean; contested: boolean };

export type TableTool = 'select' | 'measure' | 'ping' | 'draw' | 'text' | 'erase' | 'pin' | 'place' | 'template';

export type AreaTemplate = Area & { id: string; color: string; label: string | null };

export type MapPin = { id: string; note_id: string; title: string; x: number; z: number };

export type Drawing = {
  id: string;
  kind: 'path' | 'text';
  layer: 'all' | 'gm';
  color: string;
  width: number;
  points: number[][];
  text: string | null;
};

export type ToolHooks = {
  // DOM labels over the canvas: crisp at any camera zoom, no @babylonjs/gui needed.
  overlay?: HTMLElement;
  measureLabel?: (from: Position, to: Position) => string;
  ownColor?: string;
  onMeasure?: (from: Position, to: Position) => void;
  onMeasureClear?: () => void;
  onPing?: (point: Position) => void;
  onDrawPath?: (points: Position[]) => void;
  onTextPoint?: (point: Position) => void;
  onErasePoint?: (point: Position) => void;
  onPinClick?: (pinId: string) => void;
  onPinPoint?: (point: Position) => void;
  onPlacePoint?: (point: Position) => void;
  onTemplatePlace?: (template: { x: number; z: number; direction: number }) => void;
  onTerrainRect?: (from: GridCellRef, to: GridCellRef) => void;
  onWallPick?: (wallId: string | null, screen: { x: number; y: number }, point: Position | null) => void;
  onDoorClick?: (wallId: string) => void;
  onMultiPick?: (pick: { objectId: string | null; wallId: string | null; point: Position | null }) => void;
  onMarquee?: (found: MultiSelection) => void;
  onAimWall?: (wallId: string, point: Position | null) => void;
  onAimArea?: (placed: AimPlacement) => void;
  onAimAreaHover?: (objectIds: string[], inRange: boolean) => void;
  onAimHover?: (hover: { objectId: string | null; wallId: string | null }) => void;
  onAimPlace?: (point: Position) => void;
  dragLabel?: (objectId: string, from: Position, to: Position) => string | null;
  dragPath?: (objectId: string, from: Position, to: Position) => Position[] | null;
};

export type MultiSelection = { objects: string[]; walls: string[]; templates: string[] };

export type AimMark = 'ok' | 'far' | 'chosen';
export type AimArea = { shape: AreaShape; size: number; width: number; fromSelf: boolean; color: string; range: number | null };
export type AimPlace = { cells: number; count: number };
export type AimSpec = { originId: string | null; marks: Record<string, AimMark>; walls: boolean; area: AimArea | null; place?: AimPlace | null };
export type AimPlacement = { x: number; z: number; direction: number; inRange: boolean };

export type TabletopOptions = {
  dimensions: BoardDimensions;
  windowZoom?: number;
  cameraScheme?: 'tts' | 'classic';
  altRotate?: boolean;
  backgroundImageUrl?: string;
  onGroundClick: (point: Position) => void;
  loadModelFile?: (assetId: string) => Promise<File>;
  loadImageUrl?: (assetId: string) => Promise<string>;
  onSelectObject?: (objectId: string) => void;
  onContextClick?: (target: { objectId: string | null; point: Position | null; screen: { x: number; y: number }; wallId?: string | null }) => void;
  onObjectTransform?: (objectId: string, transform: ObjectTransform) => void;
  live?: LiveHooks;
  tools?: ToolHooks;
};

export type ObjectContent = {
  meshes: () => AbstractMesh[];
  labelHeight: number;
  entries?: InstantiatedEntries;
  dispose: () => void;
};

export type ObjectRecord = {
  holder: TransformNode;
  appearanceKey: string;
  content: ObjectContent;
  data: PlacedObject;
  playing: string | null;
  label: OverlayLabel | null;
  hpBar: OverlayLabel | null;
  glow: { geometryKey: string; contentKey: string; mesh: Mesh; texture: DynamicTexture } | null;
};

export type CameraPose = { alpha: number; beta: number; radius: number; target: Vector3 };

export type FrameInsets = { left: number; top: number; right: number; bottom: number };

export type PoseTarget = { x: number; y: number; z: number; rotationY: number; scale: number };

export type Glide = { fromX: number; fromY: number; fromZ: number; toX: number; toY: number; toZ: number; start: number; duration: number };

export type DrawingRecord = {
  mesh: Mesh | null;
  label: OverlayLabel | null;
  key: string;
};

export type Ping = {
  mesh: Mesh;
  mat: StandardMaterial;
  shadow: Mesh;
  shadowMat: StandardMaterial;
  label: OverlayLabel | null;
  startedAt: number;
  arrow: HTMLDivElement | null;
  point: Vector3;
};
