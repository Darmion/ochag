<script setup lang="ts">
import MiniGamesModal from '../minigames/MiniGamesModal.vue';
import { type AutoTarget } from '../../tabletop/autoTarget';
import { computed, onBeforeUnmount, onMounted, reactive, ref, toRefs, watch } from 'vue';
import { protectNames } from '../../i18n/domTranslate';

import { type Tabletop, type WallSegment, type WallStyle, type WallKind, type MultiSelection, type FogState, type FogCell, type GizmoMode, type TableTool, type Drawing, type MapPin } from '../../tabletop/scene';
import { type DiagonalRule, type Position } from '../../tabletop/grid';

import { type LiveConnection } from '../../tabletop/live';
import { preloadCombatSfx } from '../../tabletop/sfx';
import { setUiScale, uiScale } from '../../settings/uiScale';
import { tableHotkeysRequest, tableSettingsAvailable, tableSettingsRequest } from '../../settings/settingsBus';
import CombatPanel from './CombatPanel.vue';
import NotesPanel from '../campaign/NotesPanel.vue';
import GameWindow from '../game/GameWindow.vue';
import InterfaceSettingsModal from '../settings/InterfaceSettingsModal.vue';
import { tableViewPrefs } from '../../settings/tablePrefs';
import HotkeysModal from '../settings/HotkeysModal.vue';
import FactionsModal from '../campaign/FactionsModal.vue';
import GridSettingsDialog from '../settings/GridSettingsDialog.vue';
import SoundSettingsDialog from '../settings/SoundSettingsDialog.vue';
import SoundPopover from '../game/SoundPopover.vue';
import GroupMenu from '../game/GroupMenu.vue';
import { type GridLook } from '../../settings/gridSettings';
import CreateObjectModal from '../objects/CreateObjectModal.vue';
import BestiaryModal, { type BestiaryPlacement } from '../rules/BestiaryModal.vue';
import CompendiumModal from '../rules/CompendiumModal.vue';
import CharacterWizard from '../characters/CharacterWizard.vue';
import { kindBadge } from '../../campaign/objects';
import TableToasts from './TableToasts.vue';
import AudioPanel from './AudioPanel.vue';
import VisionPanel from './VisionPanel.vue';
import ShopModal from './ShopModal.vue';
import type { ChatMessage } from '../../campaign/chat';
import LightSourceControl from '../objects/LightSourceControl.vue';
import EncountersPanel from '../campaign/EncountersPanel.vue';
import ObjectInventory from '../objects/ObjectInventory.vue';
import ModelObjectForm from '../objects/ModelObjectForm.vue';
import SpellSpecialModal from '../game/SpellSpecialModal.vue';
import ToolOptionsPanel from '../game/ToolOptionsPanel.vue';
import ObjectTransformForm from '../objects/ObjectTransformForm.vue';
import ObjectStatePanel from '../objects/ObjectStatePanel.vue';
import AreaTemplates from './AreaTemplates.vue';
import TriggersPanel, { type TriggerRow } from './TriggersPanel.vue';
import { type AreaShape } from '../../tabletop/areas';
import TableCounters, { type TableCounter } from './TableCounters.vue';
import ReactionPrompts from './ReactionPrompts.vue';
import ScenePlate from './ScenePlate.vue';
import RestBanner from './RestBanner.vue';
import PlayerViewChooser from './PlayerViewChooser.vue';
import PinNoteForm from './PinNoteForm.vue';
import TextLabelForm from './TextLabelForm.vue';
import { type AudioState, type LocalAudioSettings } from '../../tabletop/audio';
import GameIcon from '../game/GameIcon.vue';
import CommandPalette from '../game/CommandPalette.vue';
import TokenMenu from '../game/TokenMenu.vue';
import WallPopover from '../game/WallPopover.vue';
import SceneCards from '../game/SceneCards.vue';
import ClockPopover from '../game/ClockPopover.vue';
import PlaceObjectList from '../game/PlaceObjectList.vue';
import SceneMapDialog from './SceneMapDialog.vue';
import MultiSelectBar from '../game/MultiSelectBar.vue';
import AreaPopover from '../game/AreaPopover.vue';
import ConditionsPanel from './ConditionsPanel.vue';
import LootPanel from './LootPanel.vue';
import QuestLog from '../campaign/QuestLog.vue';
import CombatSummary from './CombatSummary.vue';
import GameLog from '../game/GameLog.vue';
import GameActionBar from '../game/actionBar/GameActionBar.vue';
import GamePortraits from '../game/GamePortraits.vue';
import GameInitiative from '../game/GameInitiative.vue';
import { closeAllGameWindows, isGameWindowOpen, toggleGameWindow } from '../../tabletop/layout/gameHud';
import type { TabletopProps, SceneInfo, SceneDetail, Character, SceneObjectDTO, LibraryAsset, RollEntry, InitiativeEntry, NoteSummary, TemplateDTO, WallTool, SoundTab } from '../../tabletop/view/types';
import { useObjectSaves } from '../../tabletop/view/objectSaves';
import { useMeasureShare } from '../../tabletop/view/measureShare';
import { usePlayerView } from '../../tabletop/view/playerView';
import { useMapHistory } from '../../tabletop/view/mapHistory';
import { useDrawings } from '../../tabletop/view/drawings';
import { useAreaTemplates } from '../../tabletop/view/areaTemplates';
import { useCounters } from '../../tabletop/view/counters';
import { useObjectPanels } from '../../tabletop/view/objectPanels';
import { useObjectSpawns } from '../../tabletop/view/objectSpawns';
import { useSceneWindow } from '../../tabletop/view/sceneWindow';
import { useNotifications } from '../../tabletop/view/notifications';
import { useTurnAnnouncements } from '../../tabletop/view/announcements';
import { useBoardLook } from '../../tabletop/view/boardLook';
import { useObjectViews } from '../../tabletop/view/objectViews';
import { useCameraFraming } from '../../tabletop/view/cameraFraming';
import { useTableSound } from '../../tabletop/view/sound';
import { useCampaignFiles } from '../../tabletop/view/campaignFiles';
import { useNotes } from '../../tabletop/view/notes';
import { useWorldSounds } from '../../tabletop/view/worldSounds';
import { useUiPreferences } from '../../tabletop/view/uiPreferences';
import { useSelection } from '../../tabletop/view/selection';
import { useGroupActions } from '../../tabletop/view/groupActions';
import { useToolHints } from '../../tabletop/view/toolHints';
import { useBuilder } from '../../tabletop/view/builder';
import { useRailMenus } from '../../tabletop/view/railMenus';
import { useTableKeys } from '../../tabletop/view/tableKeys';
import { useHudPortraits } from '../../tabletop/view/hudPortraits';
import { useWindowKeys } from '../../tabletop/view/windowKeys';
import { useActionTargets } from '../../tabletop/view/actionTargets';
import { useActor } from '../../tabletop/view/actor';
import { useAim } from '../../tabletop/view/aim';
import { useReach } from '../../tabletop/view/reach';
import { useChat } from '../../tabletop/view/chat';
import { useRailLayout } from '../../tabletop/view/railLayout';
import { useTokenMenu } from '../../tabletop/view/tokenMenu';
import { useAreaPopover } from '../../tabletop/view/areaPopover';
import { useCombatFx } from '../../tabletop/view/combatFx';
import { useReactions } from '../../tabletop/view/reactions';
import { useLegendaryActions } from '../../tabletop/view/legendaryActions';
import { useFloats } from '../../tabletop/view/floats';
import { useVision } from '../../tabletop/view/vision';
import { usePaletteItems } from '../../tabletop/view/paletteItems';
import { useCombatControls } from '../../tabletop/view/combatControls';
import { useLiveGrabs } from '../../tabletop/view/liveGrabs';
import { useTurnRules } from '../../tabletop/view/turnRules';
import { useRolls } from '../../tabletop/view/rolls';
import { useWalls } from '../../tabletop/view/walls';
import { useInitiative } from '../../tabletop/view/initiative';
import { useGroundClick } from '../../tabletop/view/groundClick';
import { useWallStrike } from '../../tabletop/view/wallStrike';
import { useObjectTransforms } from '../../tabletop/view/objectTransforms';
import { usePins } from '../../tabletop/view/pins';
import { useActionEvents } from '../../tabletop/view/actionEvents';
import { usePlacement } from '../../tabletop/view/placement';
import { useTableLoads } from '../../tabletop/view/tableLoads';
import { useLastScene } from '../../tabletop/view/lastScene';
import { useGameMenu } from '../../tabletop/view/gameMenu';
import { useSceneEdit } from '../../tabletop/view/sceneEdit';
import { useSceneLive } from '../../tabletop/view/sceneLive';
import { useBoard } from '../../tabletop/view/board';

const props = defineProps<TabletopProps>();

const viewOnly = Boolean(props.viewAs);
const gameUi = computed(() => !viewOnly);
const hudHidden = ref(false);

const emit = defineEmits<{
  'open-character-sheet': [characterId: string];
}>();

const canvas = ref<HTMLCanvasElement | null>(null);

const scenes = ref<SceneInfo[]>([]);
const sceneId = ref('');
const newSceneName = ref('');
const sceneDetail = ref<SceneDetail | null>(null);

const characters = ref<Character[]>([]);
const rosterCanManage = ref(false);
const placeCharacterId = ref('');
const createOpen = ref(false);
const duplicateCount = ref(1);
const placingEncounter = ref<{ id: string; name: string; members: Array<{ dx: number; dz: number }> } | null>(null);
const bestiaryOpen = ref(false);
const compendiumOpen = ref(false);
const spellSpecials = ref<Array<{ spellId: string; spellName: string; casterName: string; items: string[] }>>([]);
async function muteSpellSpecial(spellId: string) {
  try {
    const path = /^[0-9a-f-]{36}$/i.test(spellId) ? `spell-templates/${spellId}` : `srd-templates/${spellId}`;
    await props.request(`/campaigns/${props.campaignId}/${path}/special`, 'PATCH', { notify: false });
  } catch {
  }
  spellSpecials.value = spellSpecials.value.filter(entry => entry.spellId !== spellId);
}
const wizardOpen = ref(false);
const placingBestiary = ref<BestiaryPlacement | null>(null);
const encountersPanel = ref<InstanceType<typeof EncountersPanel> | null>(null);
const actionBar = ref<InstanceType<typeof GameActionBar> | null>(null);
const targetingActive = computed(() => actionBar.value?.targetingActive === true);

const objects = ref<SceneObjectDTO[]>([]);
watch(() => [
  ...characters.value.filter(character => character.kind !== 'object').map(character => character.name),
  ...objects.value.filter(object => object.kind !== 'object').map(object => object.name),
  ...scenes.value.map(scene => scene.name),
].join('\n'), names => protectNames('table', names.split('\n')), { immediate: true });
const library = ref<LibraryAsset[]>([]);
const activeObjectId = ref('');
const selectedLibraryAssetId = ref('');
const newObjectName = ref('');

const walls = ref<WallSegment[]>([]);
const drawings = ref<Array<Drawing & { created_by: string; author_name: string }>>([]);
const pins = ref<MapPin[]>([]);
const pendingPinPoint = ref<Position | null>(null);
const counters = ref<TableCounter[]>([]);
const templates = ref<TemplateDTO[]>([]);
const templateShape = ref<AreaShape>('circle');
const templateSizeFeet = ref(20);
const templateAsTrigger = ref(false);
const triggers = ref<Array<TriggerRow & { x: number | null; z: number | null; direction: number }>>([]);
const pendingPinNoteId = ref('');
const noteOpenRequest = ref<{ noteId: string; nonce: number } | null>(null);
const fog = ref<FogState>(null);
const illumination = ref<string | null>(null);
const fogPreviewCells = ref<FogCell[] | null>(null);
const visionInfo = ref<{ fogEnabled: boolean; partyVision: boolean; alliedChoice: 'own' | 'allies' | null } | null>(null);
const visionPreview = ref(false);
const eyesOfSelected = ref(false);
const eyesTarget = ref<{ characterId: string; name: string } | null>(null);
const chatMessages = ref<ChatMessage[]>([]);
const chatMembers = ref<Array<{ userId: string; displayName: string }>>([]);
const shopFor = ref<{ characterId: string; name: string } | null>(null);
const shopBuyers = computed(() => objects.value
  .filter(object => object.kind === 'character' && object.canEdit && !object.parent_object_id)
  .sort((a, b) => Number(b.id === actorObject.value?.id) - Number(a.id === actorObject.value?.id))
  .map(object => ({ id: object.character_id, name: object.name })));
const wallTool = ref<WallTool | null>(null);
const openingKind = ref<'door' | 'window' | 'wall'>('door');
const wallDrawMode = computed({
  get: () => wallTool.value === 'chain' || wallTool.value === 'room',
  set: (value: boolean) => { wallTool.value = value ? 'chain' : null; },
});
const wallStyle = ref<WallStyle>('stone');
const wallKind = ref<WallKind>('wall');
const wallTextureId = ref<string | null>(null);
const wallPopover = ref<{ at: { x: number; y: number }; wallId: string; tile: number; edit: boolean } | null>(null);
const wallWeapons = ref<Array<{ id: string; name: string }>>([]);
const terrainMode = ref(false);
const wallFirstPoint = ref<Position | null>(null);

const rolls = ref<RollEntry[]>([]);
const initiativeEntries = ref<InitiativeEntry[]>([]);
const combatRound = ref(1);
const combatNotice = ref('');

const notes = ref<NoteSummary[]>([]);
const notesCanManage = ref(false);
const scenesCanManage = ref(false);

const editY = ref(0);
const editRotation = ref(0);
const editScale = ref(1);
const editSnap = ref(true);
const editParentId = ref('');
const editAnimationName = ref('');
const editHidden = ref(false);
const activeObjectAnimations = ref<string[]>([]);

const gizmoMode = ref<GizmoMode>('move');

const error = ref('');
const status = ref('Выберите сцену');
const busy = ref(false);
const sceneError = ref('');

const feetPerUnit = computed(() => sceneDetail.value?.feet_per_unit ?? 5);

const sizeWidthInput = ref(20);
const sizeHeightInput = ref(20);
const sizeFeetInput = ref(5);
const sizeVisionRadiusInput = ref<number | null>(null);
const sizeLightingInput = ref<'bright' | 'dim' | 'dark'>('bright');
let sizeFieldsSyncedFor = '';

let table: Tabletop | undefined;
const setTable = (next: Tabletop | undefined) => { table = next; };
let live: LiveConnection | undefined;
let poll: ReturnType<typeof setInterval> | undefined;

let disposed = false;
let refreshing = false;
let refreshAgain = false;
let sceneRevision = -1;
const lastRefreshAt = ref('');
const visibleRevision = ref(0);
const refreshError = ref('');
const backgroundObjectUrl = ref('');

const mapFullscreen = ref(false);
const showOverlayInterface = ref(true);
const settingsOpen = ref(false);
watch(tableSettingsRequest, () => { settingsOpen.value = true; });
watch(tableHotkeysRequest, () => { hotkeysOpen.value = true; });
if (!viewOnly) {
  onMounted(() => { tableSettingsAvailable.value = true; });
  onBeforeUnmount(() => { tableSettingsAvailable.value = false; });
}
const { showHpBars, followTurn, selectTurn, showGizmo, showMoveFilter, showWeather } = toRefs(viewOnly ? reactive({ ...tableViewPrefs }) : tableViewPrefs);
const hotkeysOpen = ref(false);
const factionsOpen = ref(false);
const factionsRevision = ref(0);
const gridDialogOpen = ref(false);
const gridPreview = ref<GridLook | null>(null);
const soundPopoverOpen = ref(false);
const soundPopoverTop = ref(0);
const soundTab = ref<SoundTab>('music');
const mapDialog = ref<'size' | 'picture' | null>(null);
const clockOpen = ref(false);
const railMoreOpen = ref(false);
const railMoreTop = ref(0);
const builderMode = ref(false);
const multiSelection = ref<MultiSelection>({ objects: [], walls: [], templates: [] });
const multiCount = computed(() => multiSelection.value.objects.length + multiSelection.value.walls.length + multiSelection.value.templates.length);
const movingTemplateId = ref<string | null>(null);
const paletteOpen = ref(false);
const tokenMenu = ref<{ at: { x: number; y: number }; objectId: string } | null>(null);
const areaPopover = ref<{ at: { x: number; y: number }; templateId: string } | null>(null);

const tool = ref<TableTool>('select');
const shareRuler = ref(true);
const diagonalRule = ref<DiagonalRule>('phb');

const overlay = ref<HTMLDivElement | null>(null);

const { imageUrls, assetBlob, loadImageUrl, loadModelFile } = useCampaignFiles({ props });

const audioState = ref<AudioState | null>(null);
const audioCanManage = ref(false);
const audioLibrary = ref<Array<{ id: string; original_filename: string | null }>>([]);
const audioBlocked = ref(false);
const localAudio = ref<LocalAudioSettings>({ music: 0.7, effects: 0.8, muted: false });

const DRAW_COLORS = ['#f5c469', '#e8835a', '#e05252', '#8fcf9c', '#7cc6de', '#b49cf0', '#f1e4c5', '#2b1b10'];
const drawColor = ref(DRAW_COLORS[1]!);
const drawLayer = ref<'all' | 'gm'>('all');
const pendingTextPoint = ref<Position | null>(null);
const pendingText = ref('');
const editingTextId = ref<string | null>(null);
const editingTextColor = ref('');
const movingTextId = ref<string | null>(null);
const drawingTool = computed(() => tool.value === 'draw' || tool.value === 'text' || tool.value === 'erase');
const lastDrawTool = ref<'draw' | 'text' | 'erase'>('draw');
watch(tool, value => { if (value === 'draw' || value === 'text' || value === 'erase') lastDrawTool.value = value; });

useUiPreferences({
  viewOnly, canvas, sceneDetail, actionBar, table: () => table, mapFullscreen,
  showOverlayInterface, showHpBars, followTurn, showGizmo, showWeather,
  shareRuler, localAudio, DRAW_COLORS, drawColor,
});

const sectionsSearch = ref<HTMLInputElement | null>(null);
const {
  cameraKeys, cameraMenuOpen, cameraMenuTop, openCameraMenu, openSoundPopover, openSoundWindow,
  openRailMore, sectionsOpen, sectionsTop, openSections, paletteQuery,
  searchFromSections,
} = useRailMenus({
  sectionsSearch, soundPopoverOpen, soundPopoverTop, soundTab, railMoreOpen, railMoreTop, paletteOpen, audioCanManage,
});

const {
  measureLabel, sendMeasure, dropMeasure, sendMeasureClear,
} = useMeasureShare({
  feetPerUnit, live: () => live, shareRuler, diagonalRule,
});

const { onPinClick, placePin } = usePins({ props, pins, pendingPinPoint, pendingPinNoteId, noteOpenRequest, tool, basePath, refresh, run });

function sendPing(point: Position) {
  live?.send({ type: 'ping', x: point.x, z: point.z });
}

const { toasts, dismissToast, pushToast, stopNotificationTimers, focusToast } = useNotifications({ gameUi, error, table: () => table });
const {
  audioPlayer, loadAudio, controlAudio, saveScenePlaylist, playSoundEffect,
  stopSoundEffects, saveMoodPlaylist, playSceneMood, audioRecipients, loadAudioRecipients, uploadAudio,
  saveSceneAmbience, disposeSound,
} = useTableSound({
  props, viewOnly, sceneId, sceneDetail, disposed: () => disposed, audioState, audioCanManage,
  audioLibrary, audioBlocked, localAudio, pushToast, basePath, assetBlob, refresh, run,
});

const {
  ownsCharacter, rollToast, takeFreshRolls, resetTurnAnnouncements, announceTurn,
} = useTurnAnnouncements({
  props, viewOnly, characters, objects, activeObjectId, table: () => table, followTurn, selectTurn,
  builderMode, multiCount, pushToast,
});

const {
  boardColors, surroundingsColors, gridLook, saveSceneGrid,
} = useBoardLook({
  props, sceneId, sceneDetail, table: () => table, gridPreview, basePath, refresh, run,
});

const {
  currentTurnCharacterId, sideOf, allyOfViewer, objectViews, activeObject, placeableGroups,
} = useObjectViews({
  props, characters, objects, activeObjectId, initiativeEntries, editY, editRotation, editScale,
  editSnap, editParentId, editAnimationName, editHidden, activeObjectAnimations, gizmoMode,
  feetPerUnit, table: () => table,
});
const {
  focusActiveObject, combatantObjectIds, frameCamera, resetFraming, frameOnOpen, reframeForHud,
} = useCameraFraming({
  viewOnly, gameUi, hudHidden, canvas, sceneId, objects, initiativeEntries, table: () => table,
  cameraMenuOpen, activeObject,
});

const {
  applyBuildModes, canBuild, builderActive, leaveBuilderTools, toggleBuilder, builderTool,
} = useBuilder({
  gameUi, sceneId, sceneDetail, targetingActive, templateAsTrigger, wallTool, wallKind, wallPopover,
  terrainMode, wallFirstPoint, table: () => table, railMoreOpen, builderMode, tool,
});

function basePath() {
  return `/campaigns/${props.campaignId}/scenes/${sceneId.value}`;
}

function objectsPath() {
  return `${basePath()}/objects`;
}

function drawingsPath() {
  return `${basePath()}/drawings`;
}

function initiativePath() {
  return `${basePath()}/initiative`;
}

const {
  loadRolls, loadInitiative, loadTableRules,
} = useTableLoads({
  props, viewOnly, sceneId, rolls, initiativeEntries, combatRound, disposed: () => disposed,
  diagonalRule, pushToast, takeFreshRolls, rollToast, announceTurn, initiativePath,
});

const {
  loadNotes, loadNoteBody, createNote, saveNote, deleteNote, grantNoteAccess, revokeNoteAccess,
} = useNotes({
  props, notes, notesCanManage, disposed: () => disposed, run,
});

function paint() {
  void table?.setObjects(objectViews.value);
  table?.setDrawings(drawings.value);
  table?.setPins(pins.value);
  table?.setWalls(walls.value);
  table?.setFog(fog.value);
  table?.setFogPreview(fogPreviewCells.value);
  table?.setLightMap(illumination.value);
  table?.setDifficultCells(sceneDetail.value?.difficult_cells ?? []);
  table?.setReachCells(reach.value?.cells ?? []);
  table?.setTemplates(templateAreas.value);
  table?.setTriggerAreas(triggerAreas.value);

  const active = activeObject.value;
  if (active) {
    activeObjectAnimations.value = active.model_asset_id ? table?.getAnimationNames(active.model_asset_id) ?? [] : [];
  }
}

watch(currentTurnCharacterId, paint);

const { playWorldSounds } = useWorldSounds({ sceneDetail });

async function refresh() {
  if (disposed || !sceneId.value) return;

  if (refreshing) {
    refreshAgain = true;
    return;
  }

  refreshing = true;
  const requestedScene = sceneId.value;

  try {
    const query = props.viewAs ? `?viewAs=${props.viewAs}`
      : eyesOfSelected.value && eyesTarget.value ? `?fogOf=${eyesTarget.value.characterId}`
        : visionPreview.value ? '?fogAs=party' : '';
    const result = await props.request(`/campaigns/${props.campaignId}/scenes/${requestedScene}${query}`);

    if (
      disposed ||
      requestedScene !== sceneId.value ||
      result.scene.revision < sceneRevision
    ) {
      return;
    }

    sceneRevision = result.scene.revision;
    sceneDetail.value = result.scene;
    playWorldSounds(objects.value, result.objects, walls.value, result.walls ?? []);
    objects.value = result.objects;
    walls.value = result.walls ?? [];
    drawings.value = result.drawings ?? [];
    pins.value = result.pins ?? [];
    announceExpiredTimers(counters.value, result.counters ?? []);
    counters.value = result.counters ?? [];
    templates.value = result.templates ?? [];
    triggers.value = result.triggers ?? [];
    fog.value = result.fog ?? null;
    illumination.value = result.illumination ?? null;
    fogPreviewCells.value = result.fogPreview?.visibleCells ?? null;
    visionInfo.value = result.vision ?? null;
    visibleRevision.value = result.scene.revision;
    lastRefreshAt.value = new Date().toLocaleTimeString('ru-RU');
    refreshError.value = '';

    if (sizeFieldsSyncedFor !== requestedScene) {
      sizeWidthInput.value = result.scene.width_cells;
      sizeHeightInput.value = result.scene.height_cells;
      sizeFeetInput.value = result.scene.feet_per_unit;
      sizeVisionRadiusInput.value = result.scene.default_vision_radius_feet;
      sizeLightingInput.value = result.scene.lighting ?? 'bright';
      sizeFieldsSyncedFor = requestedScene;
    }

    if (
      activeObjectId.value &&
      !objects.value.some(object => object.id === activeObjectId.value)
    ) {
      activeObjectId.value = '';
    }

    await ensureTable(result.scene);
    await ensureBackground(result.scene);

    paint();
    frameOnOpen(result.scene.id);
  } catch (cause) {
    if (!disposed && requestedScene === sceneId.value) {
      refreshError.value = cause instanceof Error
        ? cause.message
        : 'Не удалось обновить сцену. Попробуйте ещё раз.';
    }
  } finally {
    refreshing = false;

    if (refreshAgain && !disposed) {
      refreshAgain = false;
      void refresh();
    }
  }
}

watch(sceneId, id => {
  live?.stop();
  live = undefined;

  table?.clearSignals();
  dropMeasure();
  resetTurnAnnouncements();

  sceneRevision = -1;
  sceneDetail.value = null;
  objects.value = [];
  walls.value = [];
  drawings.value = [];
  pins.value = [];
  counters.value = [];
  templates.value = [];
  triggers.value = [];
  pendingTextPoint.value = null;
  pendingPinPoint.value = null;
  fog.value = null;
  wallTool.value = null;
  terrainMode.value = false;
  wallFirstPoint.value = null;
  activeObjectId.value = '';
  error.value = '';
  sizeFieldsSyncedFor = '';
  initiativeEntries.value = [];
  combatRound.value = 1;

  if (!id) {
    status.value = 'Выберите сцену';
    dropBoard();
    return;
  }

  live = connectScene(id);

  void refresh();
  void loadInitiative();
  if (!viewOnly) void loadChat();
});

async function run(action: () => Promise<void>) {
  if (busy.value) return;

  busy.value = true;
  error.value = '';

  try {
    await action();
  } catch (cause) {
    if (!disposed) {
      error.value = cause instanceof Error
        ? cause.message
        : 'Действие не выполнено. Попробуйте ещё раз.';
    }
  } finally {
    if (!disposed) busy.value = false;
  }
}

async function reloadCharacters() {
  try {
    const list = await props.request(`/campaigns/${props.campaignId}/characters`);
    if (disposed) return;
    characters.value = list.characters;
    rosterCanManage.value = list.canManage === true;
  } catch {
  }
}

const { readLastScenes } = useLastScene({ props, viewOnly, sceneId });

async function loadLists() {
  const [sceneList, characterList, libraryList] = await Promise.all([
    props.request(`/campaigns/${props.campaignId}/scenes`),
    props.request(`/campaigns/${props.campaignId}/characters`),
    viewOnly ? Promise.resolve({ assets: [] }) : props.request(`/campaigns/${props.campaignId}/assets?kind=object_model`),
    loadRolls(),
    viewOnly ? undefined : loadNotes(),
    loadTableRules(),
    viewOnly ? undefined : loadAudio(),
  ]);

  if (disposed) return;

  scenes.value = sceneList.scenes;
  scenesCanManage.value = sceneList.canManage === true;
  characters.value = characterList.characters;
  rosterCanManage.value = characterList.canManage === true;
  library.value = libraryList.assets;

  if (!scenes.value.some(scene => scene.id === sceneId.value)) {
    const last = viewOnly ? '' : readLastScenes()[props.campaignId];
    sceneId.value = (last && scenes.value.some(scene => scene.id === last) ? last : scenes.value[0]?.id) ?? '';
  }

  if (!placeableGroups.value.some(group => group.items.some(c => c.id === placeCharacterId.value))) {
    placeCharacterId.value = '';
  }
}

const {
  hudImage, factionPortraits, partyPortraits,
} = useHudPortraits({
  props, gameUi, characters, objects, activeObjectId, loadImageUrl, allyOfViewer, sideOf,
  currentTurnCharacterId,
});


const {
  freshRevision, rememberSaved, saveObjectNow, queueObjectSave,
} = useObjectSaves({
  props, objects, error, disposed: () => disposed, objectsPath, refresh,
});

const {
  holdersText, liveGrab, livePull, finishLiveGrab, onLivePose, onLiveGrabDenied, setObjectShared,
} = useLiveGrabs({
  props, viewOnly, objects, error, table: () => table, live: () => live, disposed: () => disposed,
  activeObject, paint, refresh, run,
});

const { submitRoll, stopCombatNoticeTimer, applyRoll } = useRolls({ props, characters, combatNotice, loadRolls, run });

const { groupTurns, setGroupTurns, gmFree, toggleGmFree } = useTurnRules({ props, sceneDetail, pushToast, run });

const {
  history, objectStateOf, objectEditEntry, rememberObjectEdit, placementAddedEntry,
  placementRemovedEntry, wallsAddedEntry, wallsRemovedEntry, wallAddedEntry, wallRemovedEntry,
  drawingAddedEntry, drawingRemovedEntry, templateData, templateAddedEntry, templateRemovedEntry,
  rememberTemplateEdit, trapAddedEntry, currentSceneSize, sceneSizeEntry, stepHistory,
} = useMapHistory({
  props, sceneId, sceneDetail, objects, activeObjectId, walls, drawings, templates, triggers, sizeWidthInput,
  sizeHeightInput, sizeFeetInput, sizeVisionRadiusInput, sizeLightingInput, drawingsPath, basePath,
  objectsPath, refresh, run, freshRevision, rememberSaved,
});
const {
  createScene, saveSceneSize, uploadBackground, clearBackground, rotateBackground,
} = useSceneEdit({
  props, sceneId, newSceneName, sceneDetail, sizeWidthInput, sizeHeightInput, sizeFeetInput,
  disposed: () => disposed, basePath, refresh, run, loadLists, currentSceneSize, history,
  sceneSizeEntry,
});
const {
  renameScene, selectScene, createSceneNamed, openSceneSettings, saveMapSize, mapBackgroundUrl,
} = useSceneWindow({
  props, sceneId, newSceneName, sceneDetail, sizeWidthInput, sizeHeightInput, sizeFeetInput, mapDialog,
  run, loadLists, createScene, saveSceneSize, hudImage,
});
const {
  rollApplyTargets, placeImage, placeOnScene, onObjectCreated,
} = usePlacement({
  props, sceneId, sceneDetail, characters, placeCharacterId, createOpen, activeObjectId,
  disposed: () => disposed, objectsPath, refresh, run, loadLists, hudImage, history,
  placementAddedEntry,
});
const {
  moveObject, onObjectTransform, onModelFileChange, createObjectFromModel, saveObjectTransform,
  removeFromScene,
} = useObjectTransforms({
  props, sceneId, sceneDetail, objects, library, activeObjectId, selectedLibraryAssetId, newObjectName,
  editY, editRotation, editScale, editSnap, editParentId, editAnimationName, editHidden,
  disposed: () => disposed, activeObject, objectsPath, refresh, run, loadLists, queueObjectSave,
  finishLiveGrab, rememberObjectEdit, history, placementAddedEntry, objectStateOf,
  placementRemovedEntry,
});
const {
  placeWallPoint, newWallLook, paintTerrain, clearTerrain, onWallPictureForNew, restyleWalls,
  wallPopoverWall, wallPopoverPicture, wallPopoverEverywhere, wallPopoverEdit, setWallOpening,
  toggleDoor, removeAllWalls,
} = useWalls({
  props, sceneDetail, walls, wallTool, openingKind, wallStyle, wallKind, wallTextureId, wallPopover,
  wallFirstPoint, basePath, refresh, run, history, wallsAddedEntry, wallAddedEntry, wallsRemovedEntry,
  wallRemovedEntry,
});
const {
  saveDrawing, onTextPoint, cancelTextEntry, startMovingText, deleteEditedText,
  placeText, eraseAt, eraseDrawings,
} = useDrawings({
  props, sceneId, sceneDetail, drawings, drawColor, drawLayer, pendingTextPoint, pendingText,
  editingTextId, editingTextColor, movingTextId, drawingsPath, refresh, run, history, drawingAddedEntry,
  drawingRemovedEntry,
});

const {
  playerViewAvailable, playerViewOpen, playerViewChooser, playerViewTarget, playerViewName,
  playerViewRoster, togglePlayerViewChooser, openPlayerView, closePlayerView, stopPlayerViewListening,
} = usePlayerView({
  props, viewOnly, sceneId, run,
});

const {
  templateAreas, templateRows, placeTemplate, removeTemplate, rollTemplateSaves, triggerAreaList,
  triggerAreas, trapPopover, trapPopoverStyle, triggerItems, onTriggersChanged,
} = useAreaTemplates({
  props, sceneDetail, objects, templates, templateShape, templateSizeFeet, templateAsTrigger, triggers,
  feetPerUnit, table: () => table, drawColor, pushToast, basePath, loadRolls, refresh, run,
  history, templateData, templateAddedEntry, templateRemovedEntry, trapAddedEntry,
});
const {
  selectedObjects, selectedCreatures, onMultiPick, onMarquee, clearSelection, groupCenter,
  moveSelection, rotateSelection, groupMenu, moveSelectionTo, groupMoveActive,
} = useSelection({
  props, viewOnly, objects, walls, templates, wallTool, terrainMode, busy, table: () => table,
  multiSelection, multiCount, tool, activeObject, basePath, refresh, run, saveObjectNow, objectStateOf,
  history, objectEditEntry, rememberTemplateEdit, templateAreas,
});
const {
  hideSelection, conditionSelection, hpSelection, downedSelected, reviveSelection, combatSelection,
  wallStyleSelection, removeSelection,
} = useGroupActions({
  props, activeObjectId, walls, initiativeEntries, multiSelection, pushToast, basePath,
  objectsPath, initiativePath, loadRolls, loadInitiative, refresh, run, queueObjectSave,
  restyleWalls, objectStateOf, history, rememberObjectEdit, placementRemovedEntry, wallsRemovedEntry,
  templates, templateData, templateRemovedEntry, selectedObjects, selectedCreatures, clearSelection,
});
const {
  toolHint, toolOptionsMeta,
} = useToolHints({
  placingEncounter, placingBestiary, actionBar, targetingActive, pendingPinPoint, templateAsTrigger,
  wallTool, terrainMode, wallFirstPoint, table: () => table, movingTemplateId, tool, shareRuler,
  diagonalRule, pendingTextPoint, editingTextId, movingTextId, sendMeasureClear, groupMoveActive,
});

const { announceExpiredTimers, createCounter, changeCounter, removeCounter } = useCounters({ props, pushToast, basePath, refresh, run });

const {
  stateActors, onStateResult, inventoryTargets, onInventoryChanged,
} = useObjectPanels({
  characters, objects, pushToast, loadRolls, refresh, run, loadLists,
});

const {
  encounterCandidates, duplicateActive, startEncounterPlacement, startBestiaryPlacement,
  spawnBestiaryAt, onWizardCreated, onBestiaryCreated, onBestiarySaved, deployEncounterAt,
} = useObjectSpawns({
  props, sceneId, duplicateCount, placingEncounter, bestiaryOpen, compendiumOpen, wizardOpen,
  placingBestiary, encountersPanel, objects, table: () => table, tool, pushToast, activeObject,
  refresh, run, loadLists, placeOnScene,
});

const {
  deselectActor, actorObject, actionActor, actorEntry, currentEntry, actorEconomy, actorDeathSaveNote,
  canJoinCombat,
} = useActor({
  props, sceneId, sceneDetail, objects, activeObjectId, initiativeEntries, activeObject, sideOf,
  hudImage, gmFree,
});
const {
  onAimRange, onConditionResult, onActed, initiativeMedals, selectPlacement, focusCharacter,
} = useActionEvents({
  objects, activeObjectId, initiativeEntries, feetPerUnit, table: () => table, pushToast, sideOf,
  focusActiveObject, refresh, hudImage, actorObject,
});
const {
  conditionSources, distanceFeet, attackTargets, lootTargets, tradeTargets, ownCharacterObject,
} = useActionTargets({
  props, sceneDetail, objects, feetPerUnit, activeObject, sideOf, actorObject,
});

watch(() => [wallPopover.value?.wallId, actorObject.value?.character_id] as const, async ([wallId, characterId]) => {
  wallWeapons.value = [];
  if (!wallId || !characterId) return;
  try {
    const sheet = await props.request(`/campaigns/${props.campaignId}/characters/${characterId}`);
    if (wallPopover.value?.wallId === wallId) wallWeapons.value = (sheet.weapons ?? []).map((weapon: any) => ({ id: weapon.id, name: weapon.name }));
  } catch {
  }
});

const {
  aimTipAt, aimHovered, aimAreaNames, aimTip, onAimPointer,
} = useAim({
  actionBar, objects, walls, feetPerUnit, table: () => table, actorObject, attackTargets, distanceFeet,
});

const {
  reach, dragLabel, dragPath, loadDragReach, showDragFilter, hideDragFilter, movementLeft,
} = useReach({
  props, viewOnly, sceneId, sceneDetail, objects, activeObjectId, walls, visionPreview, eyesOfSelected,
  feetPerUnit, table: () => table, disposed: () => disposed, showMoveFilter, diagonalRule,
  measureLabel, currentTurnCharacterId, refresh, currentEntry, actorObject,
});

const {
  lightSources, partySight, lightTarget, visionChip, eyesChipName, visionChipParts, worldClock,
  alliedToggle, chooseVision,
} = useVision({
  props, viewOnly, sceneDetail, objects, fog, visionInfo, visionPreview, eyesOfSelected, eyesTarget,
  initiativeEntries, activeObject, reframeForHud, refresh, run, partyPortraits,
});

const {
  loadChat, chatSpeaker, sendChat, speak, onVisionChanged,
} = useChat({
  props, objects, chatMessages, chatMembers, table: () => table, pushToast, refresh, run,
  actorObject,
});

const currentEntries = computed<InitiativeEntry[]>(() => initiativeEntries.value.filter(entry => entry.is_current));
const {
  joinInitiative, addNpcToInitiative, advanceInitiative, advanceActorTurn, endCombat, dashInitiative,
  canAutoTurn, autoTarget, autoTurn, actInitiative, economyInitiative, deleteInitiativeEntry,
} = useInitiative({
  props, sceneDetail, objects, pushToast, initiativePath, loadInitiative, run, actorEntry,
  currentEntry, currentEntries,
});
const canAdvanceTurn = computed(() => currentEntries.value.length > 0 &&
  (Boolean(sceneDetail.value?.canManage) || currentEntries.value.some(entry => ownsCharacter(entry.character_id ?? null))));

const characterNames = computed(() => Object.fromEntries(characters.value.map(character => [character.id, character.name])));

const {
  gameWindowAvailable, windowHotkey, minigameOpen, gameMenu, onGameMenu, openActorSheet,
} = useGameMenu({
  emit, sceneDetail, compendiumOpen, notes, notesCanManage, settingsOpen, hotkeysOpen, factionsOpen,
  paletteOpen, actorObject,
});

const {
  paletteItems,
} = usePaletteItems({
  hudHidden, scenes, sceneId, sceneDetail, actionBar, objects, gridDialogOpen, tool, cameraKeys,
  openSoundWindow, frameCamera, combatantObjectIds, selectPlacement, actionActor, gameWindowAvailable,
  windowHotkey, gameMenu, onGameMenu,
});

const {
  handleGameKey,
} = useWindowKeys({
  gameUi, hudHidden, compendiumOpen, gameWindowAvailable, openActorSheet,
});

const {
  altHeld, releasePanKeys, handleKeyUp, handleKey,
} = useTableKeys({
  viewOnly, gameUi, hudHidden, actionBar, wallTool, wallPopover, terrainMode, wallFirstPoint,
  notesCanManage, table: () => table, mapFullscreen, settingsOpen, hotkeysOpen, factionsOpen,
  soundPopoverOpen, clockOpen, railMoreOpen, builderMode, multiCount, movingTemplateId, paletteOpen,
  tool, cameraMenuOpen, sectionsOpen, activeObject, frameCamera, focusActiveObject, removeFromScene,
  stepHistory, trapPopover, moveSelection, clearSelection, deselectActor, actorObject, tokenMenu,
  areaPopover, handleGameKey,
});
const railScroll = ref<HTMLElement | null>(null);
const {
  railCollapsed, railAutoCompact, railWide, toggleRail, hintShift, railMore,
  updateRailMore,
} = useRailLayout({
  railScroll, gameUi, sceneDetail, builderMode, canBuild, altHeld,
});

const {
  startCombat, restParty, beginRest, finishRest, cancelRest, restBanner, joinActorInitiative,
  canLeaveCombat, leaveCombat, leaveActorCombat, dashActor,
} = useCombatControls({
  props, viewOnly, sceneId, sceneDetail, objects, initiativeEntries, pushToast, initiativePath,
  loadInitiative, refresh, run, joinInitiative, dashInitiative, deleteInitiativeEntry, actorObject,
  actorEntry,
});

const {
  onTableContext, tokenMenuObject, tokenMenuTarget, factionList, loadFactionList, tokenFactions,
  tokenNotice, tokenMenuCanAttack, tokenAttack, tokenSpell, tokenHp, tokenFly, tokenFall, tokenSave,
  tokenCombat, tokenDisposition, tokenPing, tokenCondition, tokenHide, tokenRotate, tokenScale,
  tokenDuplicate, tokenRemove,
} = useTokenMenu({
  props, viewOnly, gameUi, sceneId, sceneDetail, actionBar, targetingActive, objects, activeObjectId,
  walls, wallTool, wallPopover, terrainMode, wallFirstPoint, initiativeEntries, editRotation,
  editScale, editHidden, table: () => table, factionsOpen, multiSelection, multiCount, tokenMenu,
  areaPopover, sendPing, pushToast, loadRolls, loadInitiative, refresh, run, saveObjectTransform,
  removeFromScene, joinInitiative, deleteInitiativeEntry, triggerAreaList, trapPopover, templateAreas,
  groupMenu, actorObject, leaveCombat,
});

const {
  areaPopoverTemplate, areaEdit, areaMove, moveTemplateTo, areaSaves,
} = useAreaPopover({
  props, movingTemplateId, areaPopover, tool, pushToast, basePath, loadRolls, refresh, run,
  templateRows, rememberTemplateEdit,
});
const { handleGroundClick } = useGroundClick({
  targetingActive, activeObjectId, wallTool, wallDrawMode, terrainMode, movingTemplateId, moveObject,
  placeWallPoint, groupMoveActive, moveSelectionTo, moveTemplateTo,
});
const { wallPopoverStrike } = useWallStrike({
  props, wallPopover, basePath, loadRolls, loadInitiative, refresh, run, wallPopoverWall, actorObject,
});

const { combatSummary, openCombatSummary, showAttackFx } = useCombatFx({ props, sceneId, objects, table: () => table, pushToast, run });

const {
  opportunityPrompts, addOpportunity, dismissOpportunity, takeOpportunity, counterPrompts,
  rebukePrompts, stopPromptClock, counterHint, secondsLeft, addCounterspell, closeCounterspell,
  counterspellIt, skipCounterspell, addReactionOffer, rebukeIt, skipRebuke,
} = useReactions({
  props, sceneId, objects, pushToast, run, currentEntry,
});

const {
  bossOptions, legendaryOpen, legendaryBosses, openLegendary, useLegendary,
} = useLegendaryActions({
  props, sceneDetail, objects, initiativeEntries, pushToast, initiativePath, loadInitiative, run,
  currentEntry,
});

const { questsRevision, showExperience, awardParty, showHpFloat } = useFloats({ props, objects, table: () => table, pushToast, run });

const {
  ensureTable, ensureBackground, dropBoard,
} = useBoard({
  props, viewOnly, canvas, sceneDetail, placingBestiary, actionBar, targetingActive, objects,
  activeObjectId, walls, pendingPinPoint, templateShape, templateSizeFeet, pendingPinNoteId, wallTool,
  wallPopover, notes, sceneError, feetPerUnit, table: () => table, setTable, disposed: () => disposed,
  backgroundObjectUrl, showHpBars, showGizmo, showWeather, multiSelection, tool, overlay,
  loadModelFile, loadImageUrl, assetBlob, drawColor, measureLabel, sendMeasure, sendMeasureClear,
  onPinClick, sendPing, boardColors, surroundingsColors, gridLook, resetFraming, applyBuildModes,
  liveGrab, livePull, onObjectTransform, paintTerrain, setWallOpening, toggleDoor, saveDrawing,
  onTextPoint, eraseAt, placeTemplate, onMultiPick, onMarquee, groupMoveActive, groupCenter,
  spawnBestiaryAt, deployEncounterAt, aimAreaNames, aimHovered, loadDragReach, showDragFilter,
  hideDragFilter, dragLabel, dragPath, onTableContext, handleGroundClick,
});

const {
  connectScene,
} = useSceneLive({
  props, viewOnly, sceneId, spellSpecials, objects, chatMessages, status, table: () => table,
  disposed: () => disposed, factionsOpen, factionsRevision, pushToast, loadAudio, audioPlayer,
  loadRolls, loadInitiative, loadNotes, refresh, reloadCharacters, onLivePose, onLiveGrabDenied, speak,
  factionList, loadFactionList, showAttackFx, combatSummary, addOpportunity, addCounterspell,
  closeCounterspell, addReactionOffer, showHpFloat, showExperience, questsRevision,
});

watch(() => placingEncounter.value ?? placingBestiary.value, placing => {
  if (placing && gameUi.value) closeAllGameWindows();
});

onMounted(() => {
  preloadCombatSfx();

  void run(loadLists);

  let pollTick = 0;
  poll = setInterval(() => {
    pollTick += 1;
    if (!live?.isReady() || pollTick % 3 === 0) void refresh();
  }, 10000);
  window.addEventListener('keydown', handleKey);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', releasePanKeys);
});

onBeforeUnmount(() => {
  disposed = true;
  stopPromptClock();
  stopPlayerViewListening();
  live?.stop();
  clearInterval(poll);
  stopCombatNoticeTimer();
  dropMeasure();
  stopNotificationTimers();
  disposeSound();
  for (const url of imageUrls.values()) void url.then(value => URL.revokeObjectURL(value)).catch(() => {});
  window.removeEventListener('keydown', handleKey);
  window.removeEventListener('keyup', handleKeyUp);
  window.removeEventListener('blur', releasePanKeys);
  if (backgroundObjectUrl.value) URL.revokeObjectURL(backgroundObjectUrl.value);
  table?.dispose();
});
</script>

<template>
  <section
    class="tabletop-shell"
    :class="{ 'is-game': gameUi, 'hud-hidden': gameUi && hudHidden, 'in-combat': gameUi && initiativeMedals.length > 0 }"
    :style="{ '--hint-shift': hintShift }"
    aria-labelledby="tabletop-title"
  >



    <CombatSummary v-if="combatSummary" :summary="combatSummary" @close="combatSummary = null" />
    <RestBanner
      v-if="restBanner" :banner="restBanner" :can-manage="Boolean(sceneDetail?.canManage) && !viewOnly" :busy="busy"
      @finish="finishRest" @cancel="cancelRest"
    />
    <ReactionPrompts
      v-model:legendary-open="legendaryOpen"
      :busy="busy"
      :counter-prompts="counterPrompts"
      :rebuke-prompts="rebukePrompts"
      :opportunity-prompts="opportunityPrompts"
      :legendary-bosses="legendaryBosses"
      :boss-options="bossOptions"
      :seconds-left="secondsLeft"
      :counter-hint="counterHint"
      @counterspell="counterspellIt"
      @skip-counterspell="skipCounterspell"
      @rebuke="rebukeIt"
      @skip-rebuke="skipRebuke"
      @take-opportunity="takeOpportunity"
      @dismiss-opportunity="dismissOpportunity"
      @use-legendary="useLegendary"
    />
    <p v-if="refreshError" class="notice error" role="alert">
      Обновление сцены: {{ refreshError }}
    </p>

    <p v-if="error" class="notice error dismissible" role="alert">
      {{ error }}
      <button type="button" class="notice-close" aria-label="Закрыть" @click="error = ''"><GameIcon class="inline-icon" name="close" :size="16" /></button>
    </p>

    <div class="board-area" :class="{ 'is-fullscreen': mapFullscreen }">
      <p v-if="sceneError" class="notice error" role="alert">
        {{ sceneError }}
      </p>

      <div class="board-stage">
        <canvas
          ref="canvas"
          class="board-canvas"
          aria-label="Игровое поле"
          @pointermove="onAimPointer"
          @pointerleave="aimTipAt = null"
        />
        <p v-if="aimTip" class="aim-tip" :style="{ left: `${aimTipAt!.x + 20}px`, top: `${aimTipAt!.y + 22}px` }">{{ aimTip }}</p>

        <div ref="overlay" class="board-overlay" aria-hidden="true" />

        <p v-if="toolHint && !pendingTextPoint && !pendingPinPoint" class="tool-hint">{{ toolHint }}</p>
        <p v-if="visionChip || eyesChipName || visionChipParts.length || alliedToggle" class="vision-chip">
          <template v-if="visionChip"><GameIcon class="inline-icon" name="eye" :size="16" /> {{ visionChip }}</template>
          <span v-if="eyesChipName"><GameIcon class="inline-icon" name="eye" :size="16" /> <span>Глазами:</span> <b translate="no">{{ eyesChipName }}</b> <span>— тёмное не видно</span></span>
          <span v-for="part in visionChipParts" :key="part.label"><GameIcon class="inline-icon" :name="part.icon!" :size="16" /> <span>{{ part.label }}</span>: <span>{{ part.hint }}</span></span>
          <button v-if="visionPreview || eyesOfSelected" type="button" @click="visionPreview = false; eyesOfSelected = false">Выключить</button>
          <button v-if="alliedToggle" type="button" @click="chooseVision(alliedToggle === 'allies' ? 'own' : 'allies')">
            <GameIcon class="inline-icon" name="eye" :size="16" /> {{ alliedToggle === 'allies' ? 'Глазами отряда' : 'Своими глазами' }} — сменить
          </button>
        </p>

        <PlayerViewChooser
          v-if="playerViewChooser" v-model:target="playerViewTarget" :roster="playerViewRoster" :open="playerViewOpen"
          @submit="openPlayerView" @close="closePlayerView" @cancel="playerViewChooser = false"
        />

        <PinNoteForm
          v-if="pendingPinPoint" v-model:note-id="pendingPinNoteId" :notes="notes" :busy="busy"
          @submit="placePin" @cancel="pendingPinPoint = null"
        />

        <TextLabelForm
          v-if="pendingTextPoint" v-model:text="pendingText" v-model:color="editingTextColor" :editing="Boolean(editingTextId)" :colors="DRAW_COLORS"
          :busy="busy" @submit="placeText" @move="startMovingText" @delete="deleteEditedText" @cancel="cancelTextEntry"
        />

        <TableCounters
          v-if="sceneId && viewOnly"
          readonly
          :counters="counters"
          :busy="busy"
          @create="createCounter"
          @change="changeCounter"
          @remove="removeCounter"
        />

        <TableToasts :toasts="toasts" @dismiss="dismissToast" @focus="focusToast" />
      </div>

      <p v-if="holdersText" class="board-holders" aria-live="polite">
        <GameIcon class="inline-icon" name="hand" :size="16" /> Сейчас тянут: {{ holdersText }}
      </p>

    </div>


    <template v-if="gameUi">
      <ScenePlate
        v-show="!hudHidden" v-model:clock-open="clockOpen" :status="status" :scene-name="sceneDetail?.name ?? null" :world-clock="worldClock"
        :can-set-clock="Boolean(sceneDetail?.canManage && !viewOnly && sceneDetail.world_minutes !== undefined)"
      >
        <TableCounters
          v-if="sceneId"
          embedded
          :readonly="viewOnly"
          :counters="counters"
          :busy="busy"
          @create="createCounter"
          @change="changeCounter"
          @remove="removeCounter"
        />
        <ClockPopover
          v-if="clockOpen && sceneDetail"
          :campaign-id="campaignId"
          :minutes="sceneDetail.world_minutes ?? 0"
          :weather="sceneDetail.weather ?? 'clear'"
          :scene-path="basePath()"
          :busy="busy"
          :request="request"
          @changed="onVisionChanged"
          @close="clockOpen = false"
          @light="clockOpen = false; toggleGameWindow('vision')"
        />
      </ScenePlate>

      <nav
        v-show="!hudHidden" class="game-tool-rail g-frame rail-mode"
        :class="{ labeled: railWide, builder: builderMode, 'menu-open': soundPopoverOpen || railMoreOpen || cameraMenuOpen || sectionsOpen }"
        role="toolbar" :aria-label="builderMode ? 'Конструктор карты' : 'Инструменты стола'"
      >
        <div class="rail-head">
          <button type="button" class="rail-collapse" :aria-label="railCollapsed || railAutoCompact ? 'Развернуть с подписями' : 'Свернуть до значков'" :title="railAutoCompact ? 'С подписями не помещается по высоте — значками; щелчок — всё равно с подписями' : ''" @click="toggleRail">
            <GameIcon :name="railCollapsed || railAutoCompact ? 'chevronRight' : 'chevronLeft'" />
            <span v-if="railWide">Свернуть</span>
          </button>
          <span class="rail-history" role="group" aria-label="История">
            <button type="button" class="rail-mini" :disabled="busy || !history.undoLabel.value" :title="history.undoLabel.value ? `Отменить: ${history.undoLabel.value} (Ctrl+Z)` : 'Нечего отменять'" aria-label="Отменить" @click="stepHistory('undo')"><GameIcon name="undo" :size="16" /></button>
            <button type="button" class="rail-mini" :disabled="busy || !history.redoLabel.value" :title="history.redoLabel.value ? `Повторить: ${history.redoLabel.value} (Ctrl+Y)` : 'Нечего повторять'" aria-label="Повторить" @click="stepHistory('redo')"><GameIcon name="redo" :size="16" /></button>
          </span>
        </div>
        <button
          v-if="canBuild" type="button" class="rail-builder-toggle" :aria-pressed="builderMode"
          :title="builderMode ? 'Выйти из конструктора — обратно к игре (Esc)' : 'Конструктор карты: стены, двери и окна, местность, ловушки, свет, картинка и размер карты'"
          :aria-label="builderMode ? 'К игре' : 'Конструктор карты'" @click="toggleBuilder"
        ><GameIcon :name="builderMode ? 'chevronLeft' : 'hammer'" /><span v-if="railWide">{{ builderMode ? 'К игре' : 'Конструктор карты' }}</span></button>
        <div ref="railScroll" class="rail-scroll" :class="{ 'more-below': railMore }" @scroll.passive="updateRailMore">
        <template v-if="builderMode">
          <span class="rail-heading" aria-hidden="true">Конструктор карты</span>
          <button type="button" :aria-pressed="tool === 'select' && !builderActive" title="Выбор и перемещение (V)" aria-label="Выбор" @click="leaveBuilderTools(); tool = 'select'"><GameIcon name="pointer" /></button>
          <button type="button" :aria-pressed="builderActive === 'walls'" title="Стены: цепочкой, комнатой, правка" aria-label="Стены" @click="builderTool('walls')"><GameIcon name="wall" /></button>
          <button type="button" :aria-pressed="builderActive === 'doors'" title="Двери и окна: щелчок по участку готовой стены — дверь, окно или снова стена" aria-label="Двери" @click="builderTool('doors')"><GameIcon name="door" /></button>
          <button type="button" :aria-pressed="builderActive === 'terrain'" title="Труднопроходимая местность: путь через клетки вдвое дороже" aria-label="Местность" @click="builderTool('terrain')"><GameIcon name="terrain" /></button>
          <button type="button" :aria-pressed="builderActive === 'traps'" title="Ловушка: область, которую видит только мастер; срабатывает при входе" aria-label="Ловушки" @click="builderTool('traps')"><GameIcon name="trap" /></button>
          <button type="button" :aria-pressed="isGameWindowOpen('vision')" title="Свет и обзор: время, освещение, погода, туман войны (8)" aria-label="Свет" @click="toggleGameWindow('vision')"><GameIcon name="flame" /></button>
          <button type="button" :aria-pressed="Boolean(mapDialog)" title="Карта: размер в клетках, футы на клетку, картинка карты" aria-label="Карта" @click="mapDialog = mapDialog ? null : 'size'"><GameIcon name="image" /></button>
          <span class="rail-divider" aria-hidden="true" />
          <span class="rail-heading" aria-hidden="true">Вид стола</span>
          <button type="button" :aria-expanded="cameraMenuOpen" :title="`Камера: вся доска (${cameraKeys.board}), сверху, участники боя, к выбранному`" aria-label="Камера" data-rail="camera" @click="openCameraMenu"><GameIcon name="crosshair" /></button>
          <button type="button" :aria-pressed="gridDialogOpen" title="Сетка сцены для всех: вид, цвет, скрыть (своя — в «Настройках»)" aria-label="Сетка" @click="gridDialogOpen = !gridDialogOpen"><GameIcon name="grid" /></button>
        </template>
        <template v-else>
        <span class="rail-heading" aria-hidden="true">На карте</span>
        <button type="button" :aria-pressed="tool === 'select'" title="Выбор и перемещение (V)" aria-label="Выбор" @click="tool = 'select'"><GameIcon name="pointer" /></button>
        <button type="button" :aria-pressed="tool === 'measure'" title="Линейка (M)" aria-label="Линейка" @click="tool = tool === 'measure' ? 'select' : 'measure'"><GameIcon name="ruler" /></button>
        <button type="button" :aria-pressed="tool === 'ping'" title="Указка — покажет место всем (P или Ctrl+щелчок)" aria-label="Указка" @click="tool = tool === 'ping' ? 'select' : 'ping'"><GameIcon name="ping" /></button>
        <button type="button" :aria-pressed="tool === 'template'" title="Область заклинания (R)" aria-label="Область" @click="tool = tool === 'template' ? 'select' : 'template'"><GameIcon name="burst" /></button>
        <span class="rail-divider" aria-hidden="true" />
        <span class="rail-heading" aria-hidden="true">Разметка</span>
        <button
          type="button" :aria-pressed="drawingTool" title="Рисование: кисть (B), подпись (L), ластик (E) — выбор в панели инструмента" aria-label="Рисование"
          @click="tool = drawingTool ? 'select' : lastDrawTool"
        ><GameIcon :name="tool === 'text' ? 'letter' : tool === 'erase' ? 'eraser' : 'quill'" /></button>
        <button v-if="notesCanManage" type="button" :aria-pressed="tool === 'pin'" title="Булавка с заметкой (N)" aria-label="Булавка" @click="tool = tool === 'pin' ? 'select' : 'pin'"><GameIcon name="pushpin" /></button>
        <span class="rail-divider" aria-hidden="true" />
        <span class="rail-heading" aria-hidden="true">Вид стола</span>
        <button type="button" :aria-expanded="cameraMenuOpen" :title="`Камера: вся доска (${cameraKeys.board}), сверху, участники боя, к выбранному`" aria-label="Камера" data-rail="camera" @click="openCameraMenu"><GameIcon name="crosshair" /></button>
        <button type="button" :aria-expanded="soundPopoverOpen" title="Звук: что играет, своя громкость; музыка, разовые звуки, фон места и звуки событий — «Всё о звуке…»" aria-label="Звук" data-rail="sound" @click="openSoundPopover"><GameIcon name="speaker" /></button>
        <button type="button" :aria-expanded="railMoreOpen" title="Ещё: «Свободно», окно игроков, скрыть интерфейс" aria-label="Ещё" data-rail="more" @click="openRailMore"><GameIcon name="more" /></button>
        <span class="rail-divider" aria-hidden="true" />
        <button
          type="button" class="rail-sections" :class="{ open: sectionsOpen || gameMenu.some(item => item.pressed) }" :aria-expanded="sectionsOpen"
          title="Разделы: сцены, объекты, заметки, задания, справочник, лист персонажа… и поиск (Ctrl+K)" aria-label="Разделы" data-rail="sections" @click="openSections"
        ><GameIcon name="layout" /><span class="rail-sections-label">Разделы</span></button>
        </template>
        </div>
        <SoundPopover
          v-if="soundPopoverOpen" class="rail-more-menu g-frame rail-sound" :style="{ top: `${soundPopoverTop}px` }"
          :state="audioState" :library="audioLibrary" :local="localAudio" :can-manage="audioCanManage" :busy="busy" :blocked="audioBlocked" :scene-id="sceneId"
          @control="controlAudio" @update:local="localAudio = $event" @unlock="audioBlocked = false; audioPlayer.unlock()"
          @open="openSoundWindow" @close="soundPopoverOpen = false"
        />
        <div v-if="railMoreOpen" class="rail-more-menu rail-more-list g-frame" role="menu" :style="{ top: `${railMoreTop}px` }" @keydown.esc.stop="railMoreOpen = false">
          <button
            v-if="sceneDetail?.canManage" type="button" role="menuitemcheckbox" :aria-checked="gmFree" :disabled="busy"
            :title="gmFree ? 'Свободно: в бою вы двигаете фигуры и действуете ими вне очереди и сверх действий хода — щелчок вернёт правила' : 'По правилам: в бою вы тоже двигаете и действуете только тем, чей ход. Щелчок — свободно (толчок, телепорт, легендарные действия)'"
            @click="toggleGmFree(); railMoreOpen = false"
          ><GameIcon name="hand" :size="18" />{{ gmFree ? 'Свободно — вкл.' : 'Свободно (вне правил)' }}</button>
          <button
            v-if="playerViewAvailable && sceneDetail?.canManage" type="button" role="menuitemcheckbox" :aria-checked="playerViewOpen"
            :title="playerViewOpen ? `Окно игроков: ${playerViewName}` : 'Окно игроков — карта глазами игрока для проектора'"
            @click="togglePlayerViewChooser(); railMoreOpen = false"
          ><GameIcon name="projector" :size="18" />{{ playerViewOpen ? `Окно игроков: ${playerViewName}` : 'Окно игроков' }}</button>
          <button type="button" role="menuitem" title="H — показать снова: H или Esc" @click="hudHidden = true; railMoreOpen = false"><GameIcon name="eye" :size="18" />Скрыть интерфейс (H)</button>
        </div>
        <div v-if="cameraMenuOpen" class="rail-more-menu rail-camera-menu g-frame" role="menu" :style="{ top: `${cameraMenuTop}px` }" @keydown.esc.stop="cameraMenuOpen = false">
          <button type="button" role="menuitem" title="Вся доска — в свободном от панелей месте, с обычного угла" @click="frameCamera('board')"><GameIcon name="crosshair" :size="18" />Вся доска<kbd>{{ cameraKeys.board }}</kbd></button>
          <button type="button" role="menuitem" title="Вся доска сверху — как карта" @click="frameCamera('top')"><GameIcon name="map" :size="18" />Сверху</button>
          <button v-if="combatantObjectIds.length" type="button" role="menuitem" title="Все участники боя в кадре; угол камеры прежний" @click="frameCamera('combat')"><GameIcon name="swords" :size="18" />Участники боя</button>
          <button v-if="activeObject" type="button" role="menuitem" title="Камера смотрит на выбранного; угол и приближение прежние" @click="focusActiveObject(); cameraMenuOpen = false"><GameIcon name="target" :size="18" />К выбранному<kbd>{{ cameraKeys.focus }}</kbd></button>
        </div>
        <div v-if="sectionsOpen" class="rail-more-menu rail-sections-menu g-frame" role="menu" :style="{ top: `${sectionsTop}px` }" @keydown.esc.stop="sectionsOpen = false">
          <label class="sections-search" title="Окна, действия, объекты и сцены по названию">
            <GameIcon name="search" :size="18" />
            <input
              ref="sectionsSearch" type="search" autocomplete="off" spellcheck="false" placeholder="Найти: окно, действие, объект…" aria-label="Найти окно, действие или объект"
              @input="searchFromSections" @compositionend="searchFromSections" @keydown.enter="searchFromSections"
            />
            <kbd>Ctrl+K</kbd>
          </label>
          <div class="sections-grid">
            <button
              v-for="item in gameMenu" :key="item.id" type="button" role="menuitemcheckbox" :aria-checked="item.pressed"
              :title="item.hotkey ? `${item.label} (${item.hotkey})` : item.label" @click="onGameMenu(item.id); sectionsOpen = false"
            ><GameIcon :name="item.icon" :size="18" /><span>{{ item.id === 'sheet' ? 'Лист' : item.label }}</span><kbd v-if="item.hotkey">{{ item.hotkey }}</kbd></button>
          </div>
        </div>
      </nav>

      <CommandPalette :open="paletteOpen" :items="paletteItems" :initial-query="paletteQuery" @close="paletteOpen = false" />

      <TokenMenu
        v-if="tokenMenu && tokenMenuTarget"
        :at="tokenMenu.at"
        :target="tokenMenuTarget"
        :actor-name="actorObject?.name ?? null"
        :can-attack="tokenMenuCanAttack"
        :can-edit="Boolean(tokenMenuObject?.canEdit) || Boolean(sceneDetail?.canManage)"
        :can-manage="Boolean(sceneDetail?.canManage)"
        :can-duplicate="Boolean(sceneDetail?.canManage) && tokenMenuObject?.kind !== 'character'"
        :faction-list="factionList"
        :busy="busy"
        :notice="tokenNotice"
        @factions="tokenFactions"
        @manage-factions="factionsOpen = true; tokenMenu = null"
        @save="tokenSave"
        @combat="tokenCombat"
        @disposition="tokenDisposition"
        @ping="tokenPing"
        @attack="tokenAttack"
        @spell="tokenSpell"
        @hp="tokenHp"
        @fall="tokenFall"
        @fly="tokenFly"
        @condition="tokenCondition"
        @sheet="tokenMenuTarget && emit('open-character-sheet', tokenMenuTarget.characterId)"
        @shop="tokenMenuTarget && (shopFor = { characterId: tokenMenuTarget.characterId, name: tokenMenuTarget.name })"
        @hide="tokenHide"
        @focus="tokenMenuObject && selectPlacement(tokenMenuObject.id)"
        @remove="tokenRemove"
        @rotate="tokenRotate"
        @scale="tokenScale"
        @duplicate="tokenDuplicate"
        @close="tokenMenu = null"
      />

      <MultiSelectBar
        v-if="multiCount && !hudHidden && !viewOnly"
        :objects="multiSelection.objects.length"
        :creatures="selectedCreatures.length"
        :walls="multiSelection.walls.length"
        :templates="multiSelection.templates.length"
        :can-manage="Boolean(sceneDetail?.canManage)"
        :all-hidden="selectedObjects.length > 0 && selectedObjects.every(object => object.hidden)"
        :busy="busy"
        :downed="downedSelected.length"
        @revive="reviveSelection"
        @move="moveSelection"
        @rotate="rotateSelection"
        @hide="hideSelection"
        @condition="conditionSelection"
        @hp="hpSelection"
        @combat="combatSelection"
        @wall-style="wallStyleSelection"
        @remove="removeSelection"
        @clear="clearSelection"
      />
      <GroupMenu v-if="groupMenu && multiCount > 1 && !viewOnly" :at="groupMenu.at" @close="groupMenu = null">
      <MultiSelectBar
        menu
        :objects="multiSelection.objects.length"
        :creatures="selectedCreatures.length"
        :walls="multiSelection.walls.length"
        :templates="multiSelection.templates.length"
        :can-manage="Boolean(sceneDetail?.canManage)"
        :all-hidden="selectedObjects.length > 0 && selectedObjects.every(object => object.hidden)"
        :busy="busy"
        :downed="downedSelected.length"
        @revive="reviveSelection"
        @move="moveSelection"
        @rotate="rotateSelection"
        @hide="(hidden: boolean) => { hideSelection(hidden); groupMenu = null; }"
        @condition="conditionSelection"
        @hp="hpSelection"
        @combat="combatSelection"
        @wall-style="(style: WallStyle) => { wallStyleSelection(style); groupMenu = null; }"
        @remove="removeSelection"
        @clear="clearSelection(); groupMenu = null"
      />
      </GroupMenu>

      <WallPopover
        v-if="wallPopover && wallPopoverWall"
        :key="wallPopover.wallId"
        :at="wallPopover.at"
        :wall="wallPopoverWall"
        :tile="wallPopover.tile"
        :edit-mode="wallPopover.edit"
        :can-manage="Boolean(sceneDetail?.canManage)"
        :has-picture="Boolean(wallPopoverWall.texture_asset_id || wallTextureId)"
        :total="walls.length"
        :busy="busy"
        :actor-name="actorObject && actorObject.kind !== 'object' ? actorObject.name : null"
        :weapons="wallWeapons"
        @edit="wallPopoverEdit"
        @strike="wallPopoverStrike"
        @picture="wallPopoverPicture"
        @everywhere="wallPopoverEverywhere"
        @close="wallPopover = null"
      />

      <AreaPopover
        v-if="areaPopover && areaPopoverTemplate"
        :at="areaPopover.at"
        :template="areaPopoverTemplate"
        :can-manage="Boolean(sceneDetail?.canManage)"
        :can-remove="areaPopoverTemplate.createdBy === currentUserId || Boolean(sceneDetail?.canManage)"
        :busy="busy"
        @saves="areaSaves"
        @edit="areaEdit"
        @move="areaMove"
        @remove="() => { const id = areaPopoverTemplate!.id; areaPopover = null; removeTemplate(id); }"
        @close="areaPopover = null"
      />

      <div v-if="trapPopover" class="trap-popover g-frame" role="dialog" aria-label="Ловушка" :style="trapPopoverStyle">
        <header class="trap-popover-head">
          <GameIcon name="trap" :size="18" /><b>Ловушка</b>
          <button type="button" class="trap-popover-close" aria-label="Закрыть" @click="trapPopover = null"><GameIcon name="close" :size="14" /></button>
        </header>
        <div class="trap-popover-body">
          <TriggersPanel
            :triggers="triggers"
            :items="triggerItems"
            :busy="busy"
            :request="request"
            :base-path="basePath()"
            :focus-id="trapPopover.triggerId"
            @changed="onTriggersChanged"
            @done="trapPopover = null"
          />
        </div>
      </div>

      <ToolOptionsPanel
        v-if="!hudHidden && (tool === 'measure' || tool === 'template' || drawingTool || (builderMode && (wallTool || terrainMode)))"
        v-model:tool="tool"
        v-model:share-ruler="shareRuler"
        v-model:opening-kind="openingKind"
        v-model:wall-tool="wallTool"
        v-model:wall-style="wallStyle"
        v-model:template-shape="templateShape"
        v-model:template-size-feet="templateSizeFeet"
        v-model:template-as-trigger="templateAsTrigger"
        v-model:draw-color="drawColor"
        v-model:draw-layer="drawLayer"
        :meta="toolOptionsMeta"
        :busy="busy"
        :builder-mode="builderMode"
        :terrain-mode="terrainMode"
        :drawing-tool="drawingTool"
        :walls-count="walls.length"
        :wall-texture-id="wallTextureId"
        :can-manage="Boolean(sceneDetail?.canManage)"
        :difficult-cells="sceneDetail?.difficult_cells?.length ?? 0"
        :colors="DRAW_COLORS"
        @wall-picture="onWallPictureForNew"
        @restyle-all="restyleWalls(null, newWallLook().style, newWallLook().textureAssetId)"
        @remove-all-walls="removeAllWalls"
        @clear-terrain="clearTerrain"
        @open-triggers="toggleGameWindow('triggers')"
        @erase="eraseDrawings"
      />

      <GameInitiative
        v-show="!hudHidden"
        :entries="initiativeMedals"
        :round="combatRound"
        :can-manage="Boolean(sceneDetail?.canManage)"
        :busy="busy"
        :group-turns="groupTurns"
        @group-turns="setGroupTurns"
        @advance="advanceInitiative"
        @end="endCombat"
        @focus="focusCharacter"
        @legendary="openLegendary"
      />

      <GamePortraits
        v-show="!hudHidden"
        :entries="partyPortraits"
        @select="selectPlacement"
        @open="emit('open-character-sheet', $event)"
      />

      <footer v-show="!hudHidden" class="game-console g-frame">
        <div class="console-log">
          <GameLog
            resizable
            :apply-targets="rollApplyTargets"
            :default-target-id="activeObject?.character_id ?? null"
            @apply-roll="applyRoll"
            :rolls="rolls"
            :character-names="characterNames"
            :current-user-id="currentUserId"
            :can-hide="Boolean(sceneDetail?.canManage)"
            :busy="busy"
            :chat="chatMessages"
            :speaker="chatSpeaker"
            :members="chatMembers"
            @roll="payload => submitRoll({ ...payload, characterId: '' })"
            @say="sendChat"
          />
        </div>
        <GameActionBar
          ref="actionBar"
          class="console-actions"
          :campaign-id="campaignId"
          :request="request"
          :actor="actionActor"
          :in-combat="Boolean(actorEntry)"
          :is-actor-turn="Boolean(actorEntry?.is_current)"
          :can-advance="canAdvanceTurn"
          :can-join="canJoinCombat"
          :can-leave="canLeaveCombat"
          :can-hide="Boolean(sceneDetail?.canManage)"
          :can-start-combat="Boolean(sceneDetail?.canManage) && initiativeEntries.length === 0"
          :busy="busy"
          :targets="attackTargets"
          :areas="templateRows.map((row, index) => ({ id: row.id, label: `${row.label || { circle: 'Круг', cone: 'Конус', square: 'Куб', line: 'Линия' }[row.shape]} ${row.size_feet} фут. (${index + 1})` }))"
          :scene-id="sceneId"
          :movement-left="movementLeft"
          :economy="actorEconomy"
          :death-save-note="actorDeathSaveNote"
          :can-inspire="Boolean(sceneDetail?.canManage)"
          :can-auto-turn="canAutoTurn"
          :loot-targets="lootTargets"
          :trade-targets="tradeTargets"
          :eyes="sceneDetail?.canManage ? { on: eyesOfSelected, name: eyesTarget?.name ?? null } : null"
          @eyes="on => (eyesOfSelected = on)"
          @trade="merchant => (shopFor = merchant)"
          @acted="onActed"
          @range="onAimRange"
          @roll="(formula, hidden) => submitRoll({ formula, label: '', characterId: '', hidden })"
          @join="joinActorInitiative"
          @leave="leaveActorCombat"
          @start-combat="startCombat"
          @rest-party="restParty"
          @begin-rest="beginRest"
          @award-party="awardParty"
          @auto-turn="autoTurn"
          :auto-target="autoTarget"
          @auto-target="(mode: AutoTarget) => { autoTarget = mode; }"
          @dash="dashActor"
          @advance="advanceActorTurn"
          @open-sheet="openActorSheet"
          @deselect="deselectActor"
          @focus="focusActiveObject"
        />
      </footer>

      <button v-if="hudHidden" type="button" class="hud-restore g-gem" title="Показать интерфейс (H или Esc)" aria-label="Показать интерфейс" @click="hudHidden = false">
        <GameIcon name="eye" />
      </button>
    </template>

    <template v-if="!viewOnly">
      <GameWindow
        id="scenes"
        title="Сцены кампании"
       
      >
        <SceneCards
          :scenes="scenes"
          :current-id="sceneId"
          :can-create="scenesCanManage"
          :can-manage="Boolean(sceneDetail?.canManage)"
          :busy="busy"
          :load-image="loadImageUrl"
          @select="selectScene"
          @create="createSceneNamed"
          @rename="renameScene"
          @settings="openSceneSettings"
        />
      </GameWindow>

      <GameWindow
        v-if="notesCanManage || notes.length > 0"
        id="gmNotes"
        :title="notesCanManage ? 'Заметки мастера' : 'Заметки от мастера'"
       
      >
        <NotesPanel
          :notes="notes"
          :can-manage="notesCanManage"
          :busy="busy"
          :load-note="loadNoteBody"
          :create-note="createNote"
          :save-note="saveNote"
          :remove-note="deleteNote"
          :grant-access="grantNoteAccess"
          :revoke-access="revokeNoteAccess"
          :open-request="noteOpenRequest"
          @roll="payload => submitRoll({ formula: payload.formula, label: payload.label, characterId: '', hidden: false })"
        />
      </GameWindow>

      <GameWindow
        id="objects"
        title="Объекты сцены"
      >
        <p class="muted">
          Всё на столе — объекты: персонажи игроков, НПС и неодушевлённые
          предметы. Свой объект можно тащить мышью прямо по карте.
        </p>

        <div class="object-actions">
          <button type="button" class="primary" :disabled="busy" @click="createOpen = true">Создать новый…</button>
          <button v-if="rosterCanManage" type="button" :disabled="busy" title="Монстры SRD 5.1 с готовыми листами" @click="bestiaryOpen = true"><GameIcon class="inline-icon" name="spellbook" :size="16" /> Бестиарий…</button>
        </div>
        <PlaceObjectList :groups="placeableGroups" :busy="busy" :disabled="!sceneId" :image-for="placeImage" @place="placeOnScene" />

        <ModelObjectForm
          v-model:asset-id="selectedLibraryAssetId"
          v-model:name="newObjectName"
          :busy="busy"
          :can-create="Boolean(sceneId)"
          :library="library"
          @file="onModelFileChange"
          @create="createObjectFromModel"
        />

        <p v-if="!activeObject" class="muted">Объект на сцене выбирают щелчком по нему на карте — здесь появятся его настройки.</p>

        <template v-if="activeObject">
          <h3>{{ activeObject.name }}</h3>
          <p class="muted">{{ kindBadge(activeObject) }}</p>

          <div class="object-actions">
            <button type="button" @click="emit('open-character-sheet', activeObject.character_id)">
              Открыть лист
            </button>
            <button type="button" title="T" @click="focusActiveObject">Камера к объекту</button>
          </div>

          <div v-if="rosterCanManage && activeObject.kind !== 'character'" class="duplicate-row">
            <label>
              Копий
              <input v-model.number="duplicateCount" type="number" min="1" max="20" step="1" :disabled="busy" />
            </label>
            <button
              type="button"
              :disabled="busy"
              title="Копия с тем же листом и полными хитами встанет в ближайшую свободную клетку"
              @click="duplicateActive"
            >
              Дублировать ×{{ Math.max(1, Math.min(20, Math.round(duplicateCount || 1))) }}
            </button>
          </div>

          <ObjectTransformForm
            v-model:show-gizmo="showGizmo"
            v-model:gizmo-mode="gizmoMode"
            v-model:y="editY"
            v-model:rotation="editRotation"
            v-model:scale="editScale"
            v-model:snap="editSnap"
            v-model:hidden="editHidden"
            v-model:parent-id="editParentId"
            v-model:animation-name="editAnimationName"
            :object="activeObject"
            :busy="busy"
            :can-manage="Boolean(sceneDetail?.canManage)"
            :parents="objects.filter(o => o.id !== activeObjectId)"
            :animations="activeObjectAnimations"
            @save="saveObjectTransform"
            @remove="removeFromScene"
            @share="setObjectShared"
          />

          <section v-if="activeObject.loot && ownCharacterObject" class="loot-section">
            <h3><GameIcon class="inline-icon" name="chest" :size="16" /> Добыча</h3>
            <LootPanel
              :campaign-id="campaignId"
              :scene-id="sceneId"
              :corpse="{ characterId: activeObject.character_id, name: activeObject.name }"
              :looter="{ characterId: ownCharacterObject.character_id, name: ownCharacterObject.name }"
              :request="request"
              @taken="refresh"
            />
          </section>

          <div v-if="activeObject.merchant" class="stealth-actions">
            <button type="button" class="primary" :disabled="busy" @click="shopFor = { characterId: activeObject.character_id, name: activeObject.name }"><GameIcon class="inline-icon" name="coins" :size="16" /> Торговать</button>
          </div>


          <LightSourceControl
            v-if="activeObject.kind !== 'object' && (activeObject.canEdit || activeObject.state?.light)"
            :campaign-id="campaignId"
            :character-id="activeObject.character_id"
            :name="activeObject.name"
            :light="activeObject.state?.light ?? null"
            :can-edit="activeObject.canEdit"
            :busy="busy"
            :request="request"
            @changed="onVisionChanged"
          />

          <ObjectStatePanel
            v-if="activeObject.kind === 'object'"
            :campaign-id="campaignId"
            :character-id="activeObject.character_id"
            :name="activeObject.name"
            :state="activeObject.state ?? null"
            :can-edit="activeObject.canEdit"
            :actors="stateActors"
            :busy="busy"
            :scenes="scenes"
            :request="request"
            @result="onStateResult"
            @travelled="sceneId = $event.sceneId"
          />

          <ObjectInventory
            :campaign-id="campaignId"
            :scene-id="sceneId"
            :character-id="activeObject.character_id"
            :name="activeObject.name"
            :kind="activeObject.kind"
            :can-handle="activeObject.canEdit"
            :targets="inventoryTargets"
            :busy="busy"
            :revision="visibleRevision"
            :request="request"
            @changed="onInventoryChanged"
          />

          <ConditionsPanel
            v-if="activeObject.kind !== 'object'"
            :campaign-id="campaignId"
            :character-id="activeObject.character_id"
            :name="activeObject.name"
            :conditions="activeObject.conditions ?? []"
            :hp-current="activeObject.hp?.current ?? null"
            :can-edit="activeObject.canEdit"
            :is-manager="Boolean(sceneDetail?.canManage)"
            :sources="conditionSources"
            :revision="visibleRevision"
            :busy="busy"
            :request="request"
            @result="onConditionResult"
          />

          <p v-if="activeObject.canEdit" class="muted">
            Внешний вид (картинка-стойка или 3D-модель), вид объекта и доступ
            для других игроков — в листе объекта и во вкладке «Отряд».
          </p>
        </template>
      </GameWindow>

      <GameWindow
        v-if="sceneId"
        id="combat"
        title="Бой"
       
      >
        <p v-if="combatNotice" class="notice">{{ combatNotice }}</p>

        <AreaTemplates
          :templates="templateRows"
          :current-user-id="currentUserId"
          :can-manage="Boolean(sceneDetail?.canManage)"
          :busy="busy"
          @remove="removeTemplate"
          @saves="rollTemplateSaves"
        />

        <CombatPanel
          slim
          :rolls="rolls"
          :entries="initiativeEntries"
          :combat-round="combatRound"
          :characters="characters"
          :current-user-id="currentUserId"
          :can-manage="Boolean(sceneDetail?.canManage)"
          :busy="busy"
          @roll="submitRoll"
          @join="joinInitiative"
          @add-npc="addNpcToInitiative"
          @advance="advanceInitiative"
          @end-combat="endCombat"
          @start-combat="startCombat"
          @rest-party="restParty"
          @begin-rest="beginRest"
          @award-party="awardParty"
          @act="actInitiative"
          @economy="economyInitiative"
          @auto-turn="autoTurn"
          :auto-target="autoTarget"
          @auto-target="(mode: AutoTarget) => { autoTarget = mode; }"
          @summary="openCombatSummary"
          @delete-entry="deleteInitiativeEntry"
          @dash="dashInitiative"
          @apply-roll="applyRoll"
        />
      </GameWindow>
    </template>

    <template v-if="!viewOnly">
      <GameWindow
        id="audio"
        title="Звук"

      >
        <nav class="sound-tabs" role="tablist" aria-label="Звук">
          <button type="button" role="tab" :aria-selected="soundTab === 'music'" @click="soundTab = 'music'">Музыка</button>
          <button v-if="audioCanManage" type="button" role="tab" :aria-selected="soundTab === 'effects'" @click="soundTab = 'effects'">Разовые звуки</button>
          <button type="button" role="tab" :aria-selected="soundTab === 'ambience'" @click="soundTab = 'ambience'">Фон места</button>
          <button type="button" role="tab" :aria-selected="soundTab === 'events'" @click="soundTab = 'events'">Звуки событий</button>
        </nav>
        <small class="muted sound-volume-hint">Своя громкость — кнопка «Звук» на левой панели.</small>
        <SoundSettingsDialog
          v-if="soundTab === 'ambience' || soundTab === 'events'"
          :section="soundTab"
          :scene-ambience="sceneDetail?.ambience"
          :scene-name="sceneDetail?.name ?? ''"
          :can-manage="Boolean(sceneDetail?.canManage) && !viewOnly"
          :busy="busy"
          @save-ambience="saveSceneAmbience"
        />
        <AudioPanel
          v-else
          :section="soundTab === 'effects' ? 'effects' : 'music'"
          :state="audioState"
          :can-manage="audioCanManage"
          :busy="busy"
          :library="audioLibrary"
          :local="localAudio"
          :blocked="audioBlocked"
          :scene-name="sceneDetail?.name ?? ''"
          :scene-id="sceneId"
          :scene-playlist="sceneDetail?.playlist ?? []"
          :scene-mood-playlists="sceneDetail?.mood_playlists ?? {}"
          @mood-playlist="saveMoodPlaylist"
          @mood="playSceneMood"
          :campaign-id="campaignId"
          :recipients="audioRecipients"
          @control="controlAudio"
          @playlist="saveScenePlaylist"
          @effect="playSoundEffect"
          @stop-effects="stopSoundEffects"
          @need-recipients="loadAudioRecipients"
          @upload="uploadAudio"
          @update:local="localAudio = $event"
          sounds-elsewhere
          @sounds="soundTab = 'events'"
          @unlock="audioBlocked = false; audioPlayer.unlock()"
        />
      </GameWindow>
    </template>

    <MiniGamesModal v-if="minigameOpen && !viewOnly" :key="campaignId" :campaign-id="campaignId" :request="request" @close="minigameOpen = false" />
    <template v-if="!viewOnly">
      <GameWindow
        id="quests"
        title="Журнал заданий"
       
      >
        <QuestLog :campaign-id="campaignId" :scene-id="sceneId" :request="request" :revision="questsRevision" :current-user-id="currentUserId" />
      </GameWindow>
    </template>

    <template v-if="sceneId && !viewOnly">
      <GameWindow
        id="encounters"
        title="Встречи"
       
      >
        <EncountersPanel
          ref="encountersPanel"
          :campaign-id="campaignId"
          :scene-id="sceneId"
          :can-manage="rosterCanManage"
          :busy="busy"
          :candidates="encounterCandidates"
          :placing-id="placingEncounter?.id ?? ''"
          :request="request"
          @deploy="startEncounterPlacement"
          @cancel-deploy="tool = 'select'"
          @bestiary="bestiaryOpen = true"
          @place-monsters="startBestiaryPlacement"
        />
      </GameWindow>
    </template>

    <template v-if="sceneId && sceneDetail?.canManage && !viewOnly">
      <GameWindow
        id="triggers"
        title="Триггеры (мастер)"
       
      >
        <TriggersPanel
          :triggers="triggers"
          :items="triggerItems"
          :busy="busy"
          :request="request"
          :base-path="basePath()"
          @changed="onTriggersChanged"
        />
      </GameWindow>
    </template>


    <template v-if="sceneId && sceneDetail?.canManage && !viewOnly">
      <GameWindow
        id="vision"
        title="Свет и обзор (мастер)"
       
      >
        <VisionPanel
          :campaign-id="campaignId"
          :scene-path="basePath()"
          :lighting="sceneDetail.lighting ?? 'bright'"
          :effective-lighting="sceneDetail.effective_lighting ?? sceneDetail.lighting ?? 'bright'"
          :minutes="sceneDetail.world_minutes ?? 0"
          :sky="sceneDetail.sky ?? 'fixed'"
          :weather="sceneDetail.weather ?? 'clear'"
          :vision-radius-feet="sceneDetail.default_vision_radius_feet ?? null"
          :fog-enabled="visionInfo?.fogEnabled ?? true"
          :party-vision="visionInfo?.partyVision ?? true"
          :preview="visionPreview"
          :sources="lightSources"
          :party="partySight"
          :selected="lightTarget"
          :busy="busy"
          :request="request"
          @changed="onVisionChanged"
          @update:preview="visionPreview = $event"
        />
      </GameWindow>
    </template>

    <InterfaceSettingsModal
      v-if="settingsOpen"
      :ui-scale="uiScale"
      :request="props.request"
      can-open-sounds
      @update:ui-scale="setUiScale($event)"
      @sounds="settingsOpen = false; openSoundWindow('events')"
      @close="settingsOpen = false"
    />

    <HotkeysModal v-if="hotkeysOpen" @close="hotkeysOpen = false" />
    <FactionsModal
      v-if="factionsOpen && sceneDetail?.canManage"
      :campaign-id="campaignId"
      :request="request"
      :creatures="characters"
      :portraits="factionPortraits"
      :revision="factionsRevision"
      @close="factionsOpen = false"
    />
    <GridSettingsDialog
      v-if="gridDialogOpen"
      :scene-grid="sceneDetail?.grid"
      :scene-name="sceneDetail?.name ?? ''"
      :can-manage="Boolean(sceneDetail?.canManage) && !viewOnly"
      :busy="busy"
      :theme-color="boardColors.grid"
      @close="gridDialogOpen = false"
      @preview="gridPreview = $event"
      @save="saveSceneGrid"
    />

    <SceneMapDialog
      v-if="mapDialog && sceneDetail"
      :scene-name="sceneDetail.name"
      :width-cells="sceneDetail.width_cells"
      :height-cells="sceneDetail.height_cells"
      :feet-per-unit="sceneDetail.feet_per_unit"
      :background-url="mapBackgroundUrl"
      :has-background="Boolean(sceneDetail.background_asset_id)"
      :rotation="sceneDetail.background_rotation ?? 0"
      :busy="busy"
      :focus="mapDialog"
      @close="mapDialog = null"
      @save-size="saveMapSize"
      @upload="uploadBackground"
      @rotate="rotateBackground"
      @clear-background="clearBackground"
    />

    <ShopModal
      v-if="shopFor"
      :campaign-id="campaignId"
      :merchant-id="shopFor.characterId"
      :merchant-name="shopFor.name"
      :buyers="shopBuyers"
      :request="request"
      @close="shopFor = null"
      @done="message => pushToast({ tone: 'info', title: message })"
    />

    <SpellSpecialModal
      v-if="spellSpecials.length"
      :special="spellSpecials[0]!"
      :more="spellSpecials.length - 1"
      @dismiss="spellSpecials = spellSpecials.slice(1)"
      @mute="muteSpellSpecial"
    />
    <CompendiumModal
      v-if="compendiumOpen"
      :campaign-id="campaignId"
      :can-spawn="rosterCanManage"
      :can-place="Boolean(sceneId)"
      :scene-id="sceneId || undefined"
      :request="request"
      @close="compendiumOpen = false"
      @place="startBestiaryPlacement"
      @created="onBestiaryCreated"
      @saved="onBestiarySaved"
    />
    <BestiaryModal
      v-if="bestiaryOpen"
      :campaign-id="campaignId"
      :can-place="Boolean(sceneId)"
      :scene-id="sceneId || undefined"
      :request="request"
      @close="bestiaryOpen = false"
      @place="startBestiaryPlacement"
      @created="onBestiaryCreated"
      @saved="onBestiarySaved"
    />

    <CreateObjectModal
      v-if="createOpen"
      :campaign-id="campaignId"
      :can-manage="rosterCanManage"
      :offer-placement="Boolean(sceneId)"
      :request="request"
      @close="createOpen = false"
      @created="onObjectCreated"
      @bestiary="createOpen = false; bestiaryOpen = true"
      @wizard="createOpen = false; wizardOpen = true"
    />

    <CharacterWizard
      v-if="wizardOpen"
      :campaign-id="campaignId"
      :request="request"
      @close="wizardOpen = false"
      @created="onWizardCreated"
    />
  </section>
</template>

<style scoped>
.tabletop-shell{border:1px solid var(--brass);background:#24180f;box-shadow:0 16px 40px #0006;margin-top:24px;color:var(--ivory)}
.seal{padding:10px;border:1px solid var(--brass);font:700 14px Georgia,serif;color:var(--gold-light)}
.board-area{min-width:0;min-height:0;position:relative}
.board-stage{position:relative;height:560px}
.aim-tip{position:absolute;z-index:6;margin:0;max-width:280px;padding:5px 9px;border:1px solid var(--g-gold-lo,#8a6a3a);border-radius:4px;background:#1b130dEE;color:#f3e3c0;font:600 12px/1.35 var(--g-body-font,Georgia);pointer-events:none;box-shadow:0 4px 10px #0009;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.board-canvas{width:100%;height:100%; overscroll-behavior: contain; display:block;touch-action:none;outline:none}
.board-overlay{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.board-overlay :deep(.table-label){position:absolute;left:0;top:0;translate:-50% -100%;padding:1px 7px;white-space:nowrap;font:600 12px/1.35 var(--ui-label-font,"Segoe UI",Arial,sans-serif);color:#f1e4c5;background:#1a120bd9;border:1px solid var(--brass);border-radius:3px;box-shadow:0 1px 4px #0009}
.board-overlay :deep(.token-label.side-mine){border-color:#6fae93}
.board-overlay :deep(.token-label.side-party){border-color:#8ea2d4}
.board-overlay :deep(.token-label.is-selected){font-weight:800;background:#2b1b10f2}
.board-overlay :deep(.token-label.is-current){color:#1a120b;background:#f5c469;border-color:#f5c469}
.board-overlay :deep(.token-label.side-hostile){border-color:#c46a70}
.board-overlay :deep(.token-label.is-dead){color:#f0d2d2;background:#4a0f0ff0;border-color:#b0413f;text-decoration:line-through;text-decoration-thickness:2px;text-decoration-color:#ff8f86}
.board-overlay :deep(.token-label.side-neutral){border-color:#c7a96a}
.board-overlay :deep(.token-label.side-friendly){border-color:#6fb7b3}
.board-overlay :deep(.table-label .label-icon){display:inline-block;vertical-align:-.15em;margin:0 2px}
.board-overlay :deep(.table-label.is-in-area){box-shadow:0 0 0 2px #e8835a,0 1px 4px #0009}
.board-overlay :deep(.table-label.is-in-area::after){content:' ◎'}
.board-overlay :deep(.object-label){border-style:dashed;font-weight:600}
.board-overlay :deep(.table-label.is-hidden){opacity:.75;font-style:italic}
.board-overlay :deep(.table-label.is-hidden::after){content:' · скрыт'}
.board-overlay :deep(.ruler-label){translate:-50% calc(-100% - 8px);font-size:13px;font-weight:700;color:var(--signal-color,#f5c469);border-color:var(--signal-color,#f5c469)}
.board-overlay :deep(.ruler-label.is-drag){translate:-50% calc(-200% - 4px);color:#f1e4c5;border-color:#f1e4c5}
.board-overlay :deep(.ping-label){color:var(--signal-color,#f5c469);border-color:var(--signal-color,#f5c469);font-weight:700}
.duplicate-row{display:flex;gap:8px;align-items:flex-end;margin:8px 0}
.duplicate-row label{flex:0 0 84px}
.duplicate-row input{width:100%}
.is-game .board-overlay{--ping-inset-left:96px;--ping-inset-right:140px;--ping-inset-top:150px;--ping-inset-bottom:200px}
.board-overlay :deep(.ping-arrow){position:absolute;left:0;top:0;z-index:4;display:flex;align-items:center;gap:4px;translate:-50% -50%;pointer-events:none;font:700 13px "Segoe UI",Arial,sans-serif;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000}
.board-overlay :deep(.ping-arrow-head){display:inline-block;font-size:30px;line-height:1;color:var(--signal-color,#f5c469);rotate:var(--angle,0deg);filter:drop-shadow(0 0 4px #000)}
.board-overlay :deep(.ping-arrow-name){padding:1px 6px;border-radius:4px;background:#000a;box-shadow:0 0 0 1px var(--signal-color,#f5c469)}
.board-overlay :deep(.hp-bar){translate:-50% 2px;width:64px;height:12px;padding:0;overflow:hidden;background:#1a120bd9;border-color:#1a120b}
.board-overlay :deep(.hp-bar .hp-fill){position:absolute;left:0;top:0;bottom:0;background:#5fa36a}
.board-overlay :deep(.hp-bar.hp-mid .hp-fill){background:#d9b44a}
.board-overlay :deep(.hp-bar.hp-low .hp-fill){background:#c4504f}
.board-overlay :deep(.hp-bar .hp-temp){position:absolute;right:0;top:0;bottom:0;background:#7cc6de}
.board-overlay :deep(.hp-bar .hp-text){position:relative;display:block;text-align:center;font:700 10px/12px var(--ui-label-font,"Segoe UI",Arial,sans-serif);color:#fff;text-shadow:0 0 2px #000,0 0 2px #000}
.board-overlay :deep(.hp-bar .hp-fill){transition:width .35s ease,background-color .35s ease}
.board-overlay :deep(.pin-label){translate:-50% -100%;font-weight:700;color:#f1e4c5;border-color:#8e2a2f}
.board-overlay :deep(.floating-text){translate:-50% calc(-100% - 10px - var(--float-step,0) * 20px);padding:0 6px;background:none;border:0;box-shadow:none;font:800 22px/1 Georgia,"Times New Roman",serif;color:#ff6b5a;text-shadow:0 2px 0 #000,0 0 6px #000,0 0 12px #000;pointer-events:none;animation:float-up 1.7s ease-out forwards}
.board-overlay :deep(.floating-text.tone-heal){color:#7ee08a}
.board-overlay :deep(.speech-bubble){translate:-50% calc(-100% - 14px);max-width:260px;padding:6px 10px;white-space:normal;text-align:center;font:italic 500 14px/1.35 Georgia,"Times New Roman",serif;color:#2b1d10;background:#fbf2dc;border:1px solid #8a6a35;border-radius:10px;box-shadow:0 4px 12px #0008;pointer-events:none}
.board-overlay :deep(.floating-text.tone-crit){color:#ffd45a;font-size:28px}
.board-overlay :deep(.floating-text.tone-miss){color:#d8d8d8;font-size:18px;font-style:italic}
.board-overlay :deep(.floating-text.tone-info){color:#b9c8ff;font-size:17px}
.board-overlay :deep(.floating-text.tone-condition){color:#e0b0ff;font-size:16px}
.board-overlay :deep(.floating-text.tone-xp){color:#f1d27a;font-size:18px}
.board-overlay :deep(.floating-text.tone-level){color:#ffe27a;font-size:32px;letter-spacing:.04em;text-shadow:0 2px 0 #000,0 0 10px #c98a1e,0 0 22px #000}
.board-overlay :deep(.floating-text.no-motion){animation:none}
@keyframes float-up{0%{opacity:0;margin-top:8px}12%{opacity:1;margin-top:0}70%{opacity:1}100%{opacity:0;margin-top:-34px}}
.board-overlay :deep(.drawing-label){translate:-50% -50%;font:700 14px/1.3 Georgia,"Times New Roman",serif;color:var(--signal-color,#f5c469);background:#1a120bb3;border-color:transparent;box-shadow:none}
.board-overlay :deep(.drawing-label.is-gm-layer){border:1px dashed var(--signal-color,#f5c469)}
.stealth-actions{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.stealth-actions button{min-height:30px;padding:2px 10px;font-size:12px}
.vision-chip{position:absolute;left:12px;top:12px;z-index:2;max-width:min(520px,calc(100% - 24px));margin:0;padding:5px 10px;display:flex;gap:8px;align-items:center;background:#1a120be6;color:#f1e4c5;border:1px solid var(--brass);border-radius:4px;font-size:12px;line-height:1.35}
.vision-chip button{min-height:24px;padding:1px 8px;font-size:12px;flex:none}
.is-game .vision-chip{position:fixed;left:auto;right:118px;top:calc(var(--initiative-bottom, var(--game-top,54px)) + 12px);max-width:min(460px,calc(100% - 620px));background:#000c;border:0;box-shadow:0 0 0 1px var(--g-gold-lo);color:var(--g-text);font-family:var(--g-body-font)}
.tool-hint{position:absolute;right:12px;bottom:12px;z-index:2;max-width:min(460px,calc(100% - 24px));margin:0;padding:6px 12px;background:#1a120be6;color:#f1e4c5;border:1px solid var(--brass);border-radius:4px;font-size:13px;text-align:center;pointer-events:none}
.board-holders{padding:8px 20px;margin:0;color:#f5c469;font-size:14px;font-weight:600;background:#2b1b10}
.object-actions{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;margin-bottom:10px}
.object-actions label{flex:1 1 180px;margin:0}
.board-area.is-fullscreen{position:fixed;inset:0;z-index:2000;background:#0b0704;display:flex;flex-direction:column}
.board-area.is-fullscreen .board-stage{flex:1;height:auto;min-height:0}
h3{font:700 27px var(--heading-font);margin:24px 0 14px}
p{line-height:1.5}.muted{font-size:13px}
.grant-list{list-style:none;padding:0;margin:0 0 12px}
.grant-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--brass-light)}
.grant-list button{min-height:32px;padding:4px 10px}

.tabletop-shell.is-game{border:0;background:none;box-shadow:none;margin:0}
.is-game .board-area{position:fixed;top:var(--game-top,54px);left:0;right:0;bottom:0;z-index:1;background:#000}
.is-game .board-stage{height:100%}
.notice.dismissible{display:flex;align-items:flex-start;gap:10px}
.notice-close{flex:none;margin-left:auto;width:26px;min-height:26px;height:26px;padding:0;border-radius:50%;font-size:12px}
.is-game > .notice{position:fixed;top:calc(var(--game-top,54px) + 84px);left:50%;translate:-50% 0;z-index:2200;max-width:min(640px,80vw)}
.is-game .board-area > .notice{position:absolute;top:70px;left:50%;translate:-50% 0;z-index:3;max-width:min(640px,80vw)}
.is-game .board-holders{position:fixed;top:calc(var(--game-top,54px) + 88px);left:50%;translate:-50% 0;z-index:2096;padding:6px 16px;border-radius:18px;background:#000b;box-shadow:0 0 0 1px var(--g-gold-lo)}
.is-game .tool-hint{right:auto;left:calc(50% + var(--hint-shift, 0px));translate:-50% 0;bottom:calc(var(--game-bottom,154px) + 16px)}
.is-game .tool-hint{background:#000c;border:0;box-shadow:0 0 0 1px var(--g-gold-lo);color:var(--g-text);font-family:var(--g-body-font)}
.is-game .board-overlay :deep(.table-label){font-family:var(--g-title-font);background:#0d0a07e6;border-color:var(--g-gold-lo);color:var(--g-text)}
.is-game .board-overlay :deep(.token-label.is-current){color:#1a120b;background:linear-gradient(180deg,var(--g-gold-hi),var(--g-gold));border-color:var(--g-gold-hi)}
.is-game .board-overlay :deep(.token-label.is-dead){color:#f0d2d2;background:#4a0f0ff0;border-color:#b0413f}
.hud-hidden :deep(.game-window){display:none !important}
.is-game.in-combat{--combat-plate:min(240px,24vw)}
@media (max-width:960px){.is-game.in-combat{--combat-plate:min(200px,20vw)}}
.game-tool-rail.rail-mode{padding:8px 8px 10px;gap:6px;background:linear-gradient(160deg,#ffffff09,#0000 35%),linear-gradient(180deg,#24170ff2,#100a07f5)}
.rail-head{position:relative;display:flex;align-items:center;justify-content:space-between;gap:6px;flex:none;min-height:32px;padding:0 2px 7px;box-shadow:inset 0 -1px 0 color-mix(in srgb,var(--g-gold-lo) 70%,transparent)}
.rail-head .rail-collapse{display:inline-flex;align-items:center;gap:7px;width:auto;height:29px;min-height:29px;padding:0 8px;border:0;background:transparent;box-shadow:none;color:var(--g-text-dim);font-size:12px}
.rail-head .rail-collapse:hover:not(:disabled){color:var(--g-gold-hi);background:#ffffff0a;box-shadow:none}
.game-tool-rail:not(.labeled) .rail-head{flex-direction:column;padding-bottom:6px}
.game-tool-rail:not(.labeled) .rail-head .rail-collapse{width:42px;padding:0;justify-content:center}
.rail-scroll{display:flex;flex-direction:column;align-items:center;gap:5px;flex:1 1 auto;min-height:0;overflow-y:auto;scrollbar-width:none;padding:2px}
.rail-scroll.more-below{scrollbar-width:thin;scrollbar-color:var(--g-gold-lo,#6b5233) transparent}
.rail-scroll::-webkit-scrollbar{display:none}
.rail-scroll.more-below{-webkit-mask-image:linear-gradient(#000 calc(100% - 26px),transparent);mask-image:linear-gradient(#000 calc(100% - 26px),transparent)}
.rail-scroll > button{flex:0 0 auto}
.game-tool-rail.labeled{align-items:stretch;width:248px}
.game-tool-rail.rail-mode .rail-scroll{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;align-items:stretch;justify-items:stretch;gap:4px}
.game-tool-rail.rail-mode .rail-scroll > .rail-heading,.game-tool-rail.rail-mode .rail-scroll > .rail-divider{grid-column:1/-1}
.game-tool-rail.rail-mode:not(.labeled) .rail-scroll{justify-items:center;gap:4px}
.game-tool-rail.rail-mode:not(.labeled) .rail-scroll > button{width:34px;height:34px}
.game-tool-rail.rail-mode:not(.labeled) .rail-divider{width:60px}
.rail-history{display:flex;gap:2px}
.game-tool-rail .rail-history .rail-mini{width:28px;height:28px;border-radius:4px}
.game-tool-rail:not(.labeled) .rail-history{flex-direction:row}
.game-tool-rail .rail-builder-toggle{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:34px;min-height:34px;margin:0 0 4px;padding:0 10px;font:600 12px var(--g-body-font);flex:none}
.game-tool-rail.labeled .rail-builder-toggle{justify-content:flex-start}
.game-tool-rail .rail-builder-toggle[aria-pressed="true"]{color:var(--g-accent-text);background:linear-gradient(90deg,var(--g-accent),color-mix(in srgb,var(--g-accent) 45%,transparent))}
.game-tool-rail.builder{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--g-accent) 70%,transparent),0 0 16px color-mix(in srgb,var(--g-accent) 35%,transparent)}
.rail-more-menu{position:absolute;left:calc(100% + 8px);z-index:3;display:flex;flex-direction:column;gap:4px;min-width:230px;padding:8px;background:linear-gradient(110deg,#24170ff8,#100a07f5);box-shadow:0 12px 26px #000c}
.rail-more-menu.rail-sound{padding:10px 12px;z-index:6}
.game-tool-rail.menu-open{z-index:2150}
.sound-tabs{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px}
.sound-tabs button{min-height:30px;padding:2px 10px;font-size:13px}
.sound-tabs button[aria-selected="true"]{color:var(--g-accent-text,#1a120b);background:var(--g-accent,#f5c469);border-color:var(--g-accent,#f5c469)}
.sound-volume-hint{display:block;margin:0 0 8px}
.game-tool-rail .rail-more-menu button{display:flex;align-items:center;justify-content:flex-start;gap:9px;width:auto;height:auto;min-height:34px;padding:4px 10px;font:600 12px var(--g-body-font);text-align:left}
.game-tool-rail .rail-more-menu button[aria-checked="true"]{color:var(--g-accent-text);background:linear-gradient(90deg,var(--g-accent),color-mix(in srgb,var(--g-accent) 35%,transparent))}
.game-tool-rail .rail-more-menu kbd{margin-left:auto;padding:0 4px;font:11px Consolas,monospace;opacity:.7;border:1px solid var(--g-gold-lo);border-radius:3px}
.game-tool-rail.rail-mode .rail-scroll > .rail-sections{grid-column:1/-1}
.game-tool-rail.rail-mode:not(.labeled) .rail-scroll > .rail-sections{display:flex;align-items:center;justify-content:center;gap:5px;width:auto;padding:0 6px;justify-self:stretch}
.game-tool-rail .rail-scroll > .rail-sections::after{content:none !important}
.rail-sections-label{font:600 12px var(--g-body-font);letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.game-tool-rail.labeled .rail-sections-label{font-size:12px}
.game-tool-rail .rail-scroll > .rail-sections.open{box-shadow:inset 0 0 0 1px var(--g-gold-hi),0 0 10px color-mix(in srgb,var(--g-gold-hi) 30%,transparent)}
.rail-sections-menu{min-width:350px}
.rail-sections-menu .sections-search{position:relative;display:block;margin:0 0 2px;color:var(--g-text-dim);cursor:text}
.rail-sections-menu .sections-search:focus-within{color:var(--g-gold-hi)}
.rail-sections-menu .sections-search > svg{position:absolute;left:10px;top:50%;translate:0 -50%;pointer-events:none}
.rail-sections-menu .sections-search input{display:block;width:100%;min-height:0;height:36px;padding:0 70px 0 36px;font:600 12px var(--g-body-font)}
.rail-sections-menu .sections-search input::-webkit-search-cancel-button{display:none}
.rail-sections-menu .sections-search kbd{position:absolute;right:8px;top:50%;translate:0 -50%;padding:0 4px;font:11px Consolas,monospace;opacity:.7;border:1px solid var(--g-gold-lo);border-radius:3px;pointer-events:none}
.rail-sections-menu .sections-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}
.rail-sections-menu .sections-grid span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.game-tool-rail.labeled .rail-scroll{align-items:stretch;gap:4px}
.game-tool-rail.labeled .rail-scroll > button{display:flex;align-items:center;justify-content:flex-start;gap:7px;width:auto !important;height:34px !important;min-height:34px !important;padding:0 7px !important;min-width:0;border:0 !important;border-radius:4px !important;color:var(--g-text-dim);background:transparent;box-shadow:none;text-shadow:none}
.game-tool-rail.labeled .rail-scroll > button:hover:not(:disabled){color:var(--g-gold-hi);background:linear-gradient(90deg,#ffffff12,#ffffff04);box-shadow:inset 2px 0 var(--g-gold-lo)}
.game-tool-rail.labeled .rail-scroll > button[aria-pressed="true"]{color:var(--g-accent-text);background:linear-gradient(90deg,var(--g-accent),color-mix(in srgb,var(--g-accent) 35%,transparent));box-shadow:inset 3px 0 var(--g-gold-hi),inset 0 0 0 1px #ffffff0b}
.game-tool-rail.labeled .rail-scroll > button::after{content:attr(aria-label);font:600 12px var(--g-body-font);letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.game-tool-rail.labeled .rail-scroll > button svg{flex:none;color:var(--g-gold-hi)}
.rail-heading{display:none;font:600 11px var(--g-body-font);color:var(--g-gold-lo,#8a6a35);letter-spacing:.13em;text-transform:uppercase;padding:7px 8px 2px}
.game-tool-rail.labeled .rail-heading{display:block}
.game-tool-rail.labeled .rail-divider{width:auto;margin:4px 6px}
.game-tool-rail{position:fixed;left:10px;top:calc(var(--game-top,54px) + 14px);z-index:2100;display:flex;flex-direction:column;align-items:center;gap:5px;padding:9px 6px;max-height:calc(100vh - var(--game-top,54px) - var(--game-bottom,154px) - max(0px,var(--chat-height,120px) - var(--game-bottom,156px) + 36px) - 28px)}
/* scrollbar-width:none is ignored by Chromium/Electron; ::-webkit-scrollbar hides it. */
.game-tool-rail button{display:grid;place-items:center;width:42px;height:42px;min-height:0;padding:0;border-radius:6px}
.rail-divider{width:28px;height:1px;margin:3px 0;background:linear-gradient(90deg,transparent,var(--g-gold-lo),transparent)}
.trap-popover{position:fixed;z-index:2300;width:360px;max-height:min(420px,calc(100vh - var(--game-top,54px) - var(--game-bottom,156px) - 24px));display:flex;flex-direction:column;padding:10px 12px;background:linear-gradient(110deg,#24170ff8,#100a07f5);box-shadow:0 14px 30px #000c}
.trap-popover-body{min-height:0;overflow-y:auto;margin-right:-6px;padding-right:6px}
.trap-popover-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;color:var(--g-gold-hi)}
.trap-popover-close{margin-left:auto;width:26px;min-width:26px;height:26px;min-height:26px;padding:0;display:grid;place-items:center}
.game-console{position:fixed;left:10px;right:10px;bottom:10px;height:calc(var(--game-bottom,154px) - 20px);z-index:2100;display:grid;grid-template-columns:minmax(260px,27%) minmax(0,1fr);gap:16px;padding:10px 14px 10px 12px;background:linear-gradient(110deg,#271a12f7,#100a07fa 45%,#1d130df7)}
@media (max-width:1100px){.game-console{grid-template-columns:minmax(220px,25%) minmax(0,1fr);gap:10px}}
/* Action bar popovers rise above the windows at the screen edge (same z-index 2100). */
.game-console:has(.action-popover, .smite-offer){z-index:2150}
/* A positioning wrapper of its own: the stretched log grows upward without enlarging the grid cell. */
.console-log{position:relative;min-height:0;align-self:stretch}
.console-actions{min-width:0}
.hud-restore{position:fixed;left:14px;bottom:14px;z-index:2100}
.is-game :deep(.table-counters){left:var(--rail-space,78px);top:60px}
.is-game :deep(.table-toasts){left:auto;right:112px;bottom:calc(var(--game-bottom,156px) + 12px)}

.hud-hidden :deep(.table-toasts){bottom:16px}
@media(max-width:1000px){
  .board-stage{height:460px}
}
</style>
