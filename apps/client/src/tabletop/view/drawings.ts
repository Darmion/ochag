import { confirmAction } from '../../ui/confirmDialog';
import type { Ref } from 'vue';
import type { Drawing } from '../scene';
import { distanceToDrawing } from '../paths';
import { roundCoordinate, type Position } from '../grid';
import type { HistoryEntry, TableHistory } from '../history';
import type { DrawingData, TabletopProps, SceneDetail } from './types';

export type DrawingsDeps = {
  props: TabletopProps;
  sceneId: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  drawings: Ref<Array<Drawing & { created_by: string; author_name: string }>>;
  drawColor: Ref<string>;
  drawLayer: Ref<'all' | 'gm'>;
  pendingTextPoint: Ref<Position | null>;
  pendingText: Ref<string>;
  editingTextId: Ref<string | null>;
  editingTextColor: Ref<string>;
  movingTextId: Ref<string | null>;
  drawingsPath: () => string;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  history: TableHistory;
  drawingAddedEntry: (drawingId: string, data: DrawingData, label: string) => HistoryEntry;
  drawingRemovedEntry: (drawingId: string, data: DrawingData, label: string) => HistoryEntry;
};

export function useDrawings({ props, sceneId, sceneDetail, drawings, drawColor, drawLayer, pendingTextPoint, pendingText, editingTextId, editingTextColor, movingTextId, drawingsPath, refresh, run, history, drawingAddedEntry, drawingRemovedEntry }: DrawingsDeps) {
  function saveDrawing(points: Position[]) {
    return run(async () => {
      if (!sceneId.value) return;
      const data: DrawingData = {
        kind: 'path',
        layer: drawLayer.value,
        color: drawColor.value,
        points: points.map(point => [roundCoordinate(point.x), roundCoordinate(point.z)]),
      };
      const created = await props.request(drawingsPath(), 'POST', data);
      history.record(drawingAddedEntry(created.id, data, 'рисунок'));
      await refresh();
    });
  }

  function onTextPoint(point: Position) {
    if (movingTextId.value) {
      const id = movingTextId.value;
      movingTextId.value = null;
      return run(async () => {
        await props.request(`${drawingsPath()}/${id}`, 'PATCH', { point: [roundCoordinate(point.x), roundCoordinate(point.z)] });
        await refresh();
      });
    }
    const mayEdit = (drawing: { created_by: string }) => drawing.created_by === props.currentUserId || Boolean(sceneDetail.value?.canManage);
    const near = drawings.value
      .filter(drawing => drawing.kind === 'text' && mayEdit(drawing))
      .map(drawing => ({ drawing, distance: distanceToDrawing(point, drawing) }))
      .filter(entry => entry.distance <= 0.6)
      .sort((a, b) => a.distance - b.distance)[0]?.drawing;
    if (near) {
      editingTextId.value = near.id;
      editingTextColor.value = near.color;
      pendingText.value = near.text ?? '';
      pendingTextPoint.value = { x: near.points[0]![0]!, z: near.points[0]![1]! };
      return;
    }
    editingTextId.value = null;
    pendingTextPoint.value = point;
    pendingText.value = '';
  }

  function cancelTextEntry() {
    pendingTextPoint.value = null;
    editingTextId.value = null;
  }

  function startMovingText() {
    movingTextId.value = editingTextId.value;
    cancelTextEntry();
  }

  function deleteEditedText() {
    const id = editingTextId.value;
    if (!id) return;
    cancelTextEntry();
    return run(async () => {
      await props.request(`${drawingsPath()}/${id}`, 'DELETE');
      await refresh();
    });
  }

  function placeText() {
    const point = pendingTextPoint.value;
    const text = pendingText.value.trim();
    if (!point || !text) return;

    if (editingTextId.value) {
      const id = editingTextId.value;
      return run(async () => {
        await props.request(`${drawingsPath()}/${id}`, 'PATCH', { text, color: editingTextColor.value });
        cancelTextEntry();
        pendingText.value = '';
        await refresh();
      });
    }

    return run(async () => {
      const data: DrawingData = {
        kind: 'text',
        layer: drawLayer.value,
        color: drawColor.value,
        points: [[roundCoordinate(point.x), roundCoordinate(point.z)]],
        text,
      };
      const created = await props.request(drawingsPath(), 'POST', data);
      history.record(drawingAddedEntry(created.id, data, `подпись «${text}»`));
      pendingTextPoint.value = null;
      pendingText.value = '';
      await refresh();
    });
  }

  function eraseAt(point: Position) {
    const mayErase = (drawing: { created_by: string }) =>
      drawing.created_by === props.currentUserId || Boolean(sceneDetail.value?.canManage);

    const target = drawings.value
      .filter(mayErase)
      .map(drawing => ({ drawing, distance: distanceToDrawing(point, drawing) }))
      .filter(entry => entry.distance <= 0.5)
      .sort((a, b) => a.distance - b.distance)[0]?.drawing;

    if (!target) return;

    return run(async () => {
      await props.request(`${drawingsPath()}/${target.id}`, 'DELETE');
      history.record(drawingRemovedEntry(target.id, {
        kind: target.kind,
        layer: target.layer,
        color: target.color,
        points: target.points,
        ...(target.kind === 'text' && target.text ? { text: target.text } : {}),
      }, target.kind === 'text' ? 'стирание подписи' : 'стирание рисунка'));
      await refresh();
    });
  }

  async function eraseDrawings(scope: 'mine' | 'all') {
    const question = scope === 'all'
      ? 'Стереть все рисунки и подписи на этой сцене — и свои, и чужие?'
      : 'Стереть все свои рисунки и подписи на этой сцене?';
    if (!(await confirmAction(question, { title: 'Стереть рисунки', confirmLabel: 'Стереть', danger: true }))) return;

    return run(async () => {
      await props.request(`${drawingsPath()}/${scope}`, 'DELETE');
      await refresh();
    });
  }

  return { saveDrawing, onTextPoint, cancelTextEntry, startMovingText, deleteEditedText, placeText, eraseAt, eraseDrawings };
}
