import { computed, ref, watch, type Ref } from 'vue';
import { confirmAction } from '../ui/confirmDialog';
import { describeRoll } from './sheet';
import { buzzOnTurn } from './mapLive';
import { DRAG_START_PX, canvasPoint, figureAt, insideBoard, snapFigure, toWorld, type Board } from './mapGeometry';

export type TurnFigure = {
  id: string; character_id: string; name: string; kind: string; size: string | null;
  world_x: number; world_y?: number; world_z: number; rotation_y?: number; scale?: number; snap_to_grid?: boolean;
  parent_object_id?: string | null; animation_name?: string | null; revision: number; canEdit?: boolean; canMove?: boolean;
};
type Weapon = { id: string; name: string; damage_formula: string | null };
type Entry = { id: string; character_id: string | null; name: string; is_current: boolean };
type Press = { pointerId: number; startX: number; startY: number; x: number; z: number; figureId: string | null; movable: boolean; moved: boolean };

export type PhoneTurnDeps = {
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  campaignId: string;
  sceneId: Ref<string>;
  sceneData: Ref<any | null>;
  canvas: Ref<HTMLCanvasElement | null>;
  redraw: () => void;
  reload: () => void;
};

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : 'Не получилось. Попробуйте ещё раз.');

export function usePhoneTurn({ request, campaignId, sceneId, sceneData, canvas, redraw, reload }: PhoneTurnDeps) {
  const selectedId = ref<string | null>(null);
  const drag = ref<{ id: string; x: number; z: number } | null>(null);
  const target = ref<TurnFigure | null>(null);
  const weapons = ref<Weapon[]>([]);
  const entries = ref<Entry[]>([]);
  const message = ref('');
  const problem = ref('');
  const working = ref(false);
  let press: Press | null = null;

  const figures = computed<TurnFigure[]>(() => sceneData.value?.objects ?? []);
  const board = computed<Board | null>(() => (sceneData.value ? { widthCells: sceneData.value.scene.width_cells, heightCells: sceneData.value.scene.height_cells } : null));
  const selected = computed(() => figures.value.find(figure => figure.id === selectedId.value) ?? null);
  const current = computed(() => entries.value.filter(entry => entry.is_current));
  const currentNames = computed(() => current.value.map(entry => entry.name).join(', '));
  const mine = (characterId: string | null) => Boolean(characterId) && figures.value.some(figure => figure.character_id === characterId && figure.canEdit);
  const myTurn = computed(() => current.value.some(entry => mine(entry.character_id)));
  const currentCharacters = computed(() => new Set(current.value.map(entry => entry.character_id).filter(Boolean)));

  watch(myTurn, (now, before) => {
    try {
      buzzOnTurn(before, now, typeof navigator.vibrate === 'function' ? pattern => navigator.vibrate(pattern) : undefined);
    } catch {
      // vibration is a courtesy; a browser that refuses it must not break the turn line
    }
  });

  async function loadInitiative() {
    if (!sceneId.value) { entries.value = []; return; }
    try {
      entries.value = (await request(`/campaigns/${campaignId}/scenes/${sceneId.value}/initiative`))?.entries ?? [];
    } catch {
      entries.value = [];
    }
  }

  function pointOf(clientX: number, clientY: number) {
    const el = canvas.value;
    if (!el || !board.value) return null;
    const { px, pz } = canvasPoint(el.getBoundingClientRect(), el, clientX, clientY);
    return toWorld(board.value, px, pz);
  }

  // A touch that starts on one's own figure must not scroll the map, or the drag never begins.
  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch || event.touches.length > 1) return;
    const point = pointOf(touch.clientX, touch.clientY);
    if (point && figureAt(figures.value, point.x, point.z)?.canMove) event.preventDefault();
  }

  function onPointerDown(event: PointerEvent) {
    const point = pointOf(event.clientX, event.clientY);
    if (!point) return;
    const figure = figureAt(figures.value, point.x, point.z);
    press = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: point.x, z: point.z, figureId: figure?.id ?? null, movable: Boolean(figure?.canMove), moved: false };
    if (press.movable) canvas.value?.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!press || press.pointerId !== event.pointerId || !press.movable || !press.figureId) return;
    if (!press.moved && Math.hypot(event.clientX - press.startX, event.clientY - press.startY) < DRAG_START_PX) return;
    press.moved = true;
    const point = pointOf(event.clientX, event.clientY);
    if (!point) return;
    drag.value = { id: press.figureId, x: point.x, z: point.z };
    redraw();
  }

  function onPointerUp(event: PointerEvent) {
    if (!press || press.pointerId !== event.pointerId) return;
    const done = press;
    press = null;
    const ghost = drag.value;
    drag.value = null;
    if (done.moved && ghost) void moveTo(ghost.id, ghost.x, ghost.z);
    else void tap(done.figureId, done.x, done.z);
  }

  function onPointerCancel() {
    press = null;
    drag.value = null;
    redraw();
  }

  async function tap(figureId: string | null, x: number, z: number) {
    problem.value = '';
    message.value = '';
    const figure = figures.value.find(entry => entry.id === figureId) ?? null;
    // With a figure chosen, a tap on another creature is a target — even one's own (the GM's NPCs are all «own»);
    // the attack panel offers to act for it instead.
    if (figure && figure.kind !== 'object') {
      if (figure.id === selectedId.value) selectedId.value = null;
      else if (selected.value) { await openAttack(figure); return; }
      else if (figure.canEdit) selectedId.value = figure.id;
      else message.value = 'Сначала коснитесь своей фигуры, потом — цели.';
      target.value = null;
      redraw();
      return;
    }
    if (!figure && selected.value?.canMove && board.value && insideBoard(board.value, x, z)) await moveTo(selected.value.id, x, z);
  }

  async function moveTo(id: string, x: number, z: number) {
    const figure = figures.value.find(entry => entry.id === id);
    if (!figure || !board.value || working.value) { redraw(); return; }
    const spot = snapFigure(board.value, x, z, figure.size);
    if (spot.x === figure.world_x && spot.z === figure.world_z) { redraw(); return; }
    working.value = true;
    problem.value = '';
    message.value = '';
    try {
      const result = await request(`/campaigns/${campaignId}/scenes/${sceneId.value}/objects/${figure.id}`, 'PUT', {
        x: spot.x, y: figure.world_y ?? 0, z: spot.z, rotationY: figure.rotation_y ?? 0, scale: figure.scale ?? 1,
        snapToGrid: figure.snap_to_grid ?? true, parentObjectId: figure.parent_object_id ?? null, animationName: figure.animation_name ?? null,
        revision: figure.revision,
      });
      figure.world_x = spot.x;
      figure.world_z = spot.z;
      if (typeof result?.revision === 'number') figure.revision = result.revision;
      selectedId.value = figure.id;
    } catch (cause) {
      problem.value = errorText(cause);
    } finally {
      working.value = false;
      redraw();
      reload();
    }
  }

  async function openAttack(figure: TurnFigure) {
    const actor = selected.value;
    if (!actor) return;
    target.value = figure;
    weapons.value = [];
    message.value = '';
    try {
      const sheet = await request(`/campaigns/${campaignId}/characters/${actor.character_id}`);
      weapons.value = (sheet?.weapons ?? []).map((weapon: any) => ({ id: String(weapon.id), name: String(weapon.name), damage_formula: weapon.damage_formula ?? null }));
      if (!weapons.value.length) problem.value = `У «${actor.name}» в листе нет оружия — атакуйте за столом или заклинанием из листа.`;
    } catch (cause) {
      problem.value = errorText(cause);
    }
  }

  async function attack(weapon: Weapon, friendlyConfirmed = false): Promise<void> {
    const actor = selected.value;
    const foe = target.value;
    if (!actor || !foe || working.value) return;
    working.value = true;
    problem.value = '';
    message.value = '';
    let retry = false;
    try {
      const result = await request(`/campaigns/${campaignId}/rolls/check`, 'POST', {
        ...(friendlyConfirmed ? {} : { warnFriendly: true }),
        characterId: actor.character_id, kind: 'attack', key: weapon.id, targetCharacterId: foe.character_id, sceneId: sceneId.value,
      });
      message.value = describeRoll(result);
      target.value = null;
    } catch (cause) {
      if ((cause as { code?: string }).code === 'FRIENDLY_FIRE' && !friendlyConfirmed) {
        retry = await confirmAction(errorText(cause), { title: 'Это свои', confirmLabel: 'Всё равно ударить', danger: true });
      } else {
        problem.value = errorText(cause);
      }
    } finally {
      working.value = false;
      reload();
    }
    if (retry) await attack(weapon, true);
  }

  async function endTurn() {
    if (working.value) return;
    const entry = current.value.find(item => mine(item.character_id));
    working.value = true;
    problem.value = '';
    try {
      await request(`/campaigns/${campaignId}/scenes/${sceneId.value}/initiative/advance`, 'POST', {
        ...(entry && current.value.length > 1 ? { entryId: entry.id } : {}), current: current.value.map(item => item.id),
      });
      message.value = 'Ход передан.';
    } catch (cause) {
      problem.value = errorText(cause);
    } finally {
      working.value = false;
      await loadInitiative();
    }
  }

  function actForTarget() {
    if (!target.value?.canEdit) return;
    selectedId.value = target.value.id;
    target.value = null;
    redraw();
  }

  function reset() {
    selectedId.value = null;
    target.value = null;
    drag.value = null;
    press = null;
    message.value = '';
    problem.value = '';
  }

  return {
    selectedId, selected, drag, target, weapons, message, problem, working, currentNames, myTurn, currentCharacters,
    loadInitiative, onTouchStart, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, attack, endTurn, actForTarget, reset,
  };
}
