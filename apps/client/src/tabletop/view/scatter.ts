import type { Ref, ComputedRef } from 'vue';
import { artFile } from '../../art/portraitArt';
import { pictureSets } from '../../art/pictureSets';
import { groupEntry, type HistoryEntry, type TableHistory } from '../history';
import type { TableToast } from '../toasts';
import type { ObjectSave, SceneDetail, SceneObjectDTO, TabletopProps } from './types';
import { cellCenter, scatterCells, spreadPose, type ScatterDensity, type Spread } from '../../../../../packages/domain/map/scatter';
import { footprintCells, occupiedCells } from '../../../../../packages/domain/map/footprint';

export type ScatterSample = { characterId: string; name: string; kind: string; rotationY: number; scale: number };
export type ScatterPlan = { samples: ScatterSample[]; density: ScatterDensity; spread: Spread; pictures: string };
export type SpreadOptions = Spread & { pictures: string };
export type ScatterOptions = Spread & { density: ScatterDensity; pictures: string };

export type ScatterDeps = {
  props: TabletopProps;
  sceneId: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  objects: Ref<SceneObjectDTO[]>;
  selectedObjects: ComputedRef<SceneObjectDTO[]>;
  scatterPlan: Ref<ScatterPlan | null>;
  pushToast: (toast: Omit<TableToast, 'id'>, durationMs?: number) => void;
  refresh: () => Promise<void>;
  loadLists: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  saveObjectNow: (objectId: string, body: ObjectSave, refreshAfter?: boolean) => Promise<void>;
  objectStateOf: (object: SceneObjectDTO) => ObjectSave;
  history: TableHistory;
  objectEditEntry: (placementId: string, before: ObjectSave, label: string) => HistoryEntry;
  placementAddedEntry: (placementId: string, label: string) => HistoryEntry;
};

export function useScatter({
  props, sceneId, sceneDetail, objects, selectedObjects, scatterPlan, pushToast, refresh, loadLists, run,
  saveObjectNow, objectStateOf, history, objectEditEntry, placementAddedEntry,
}: ScatterDeps) {
  const movable = () => selectedObjects.value.filter(object => object.canEdit && object.kind !== 'character');
  const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!;

  // Every object gets a random picture of the set; each picture is uploaded once and shared.
  async function randomPictures(characterIds: string[], setId: string): Promise<number> {
    const set = setId ? (await pictureSets()).find(entry => entry.id === setId) : undefined;
    if (!set || !characterIds.length) return 0;
    const chosen = characterIds.map(characterId => ({ characterId, path: pick(set.paths) }));
    const ids = new Map<string, string>();
    for (const path of new Set(chosen.map(entry => entry.path))) {
      const uploaded = await props.request(`/campaigns/${props.campaignId}/assets?kind=object_image`, 'POST', undefined, await artFile(path));
      ids.set(path, uploaded.id as string);
    }
    return (await props.request(`/campaigns/${props.campaignId}/characters/pictures`, 'POST', {
      items: chosen.map(entry => ({ characterId: entry.characterId, imageAssetId: ids.get(entry.path)! })),
    })).updated as number;
  }

  function spreadSelection(options: SpreadOptions) {
    const targets = movable();
    if (!targets.length) return;
    return run(async () => {
      const entries: HistoryEntry[] = [];
      if (options.rotate || options.size) {
        for (const object of targets) {
          const before = objectStateOf(object);
          const pose = spreadPose({ rotationY: Number(object.rotation_y), scale: Number(object.scale) }, options);
          await saveObjectNow(object.id, { ...before, ...pose }, false);
          entries.push(objectEditEntry(object.id, before, 'разброс'));
        }
        if (entries.length) history.record(groupEntry(entries, 'разброс'));
      }
      const pictured = await randomPictures(targets.filter(object => object.kind === 'object').map(object => object.character_id), options.pictures);
      await Promise.all([refresh(), loadLists()]);
      pushToast({
        tone: 'info', title: 'Разброс',
        detail: pictured ? `Поворот и размер — ${entries.length}, новая картинка — ${pictured}.` : `Поворот и размер — ${entries.length}.`,
      });
    });
  }

  function startScatter(options: ScatterOptions) {
    const samples = movable().map(object => ({
      characterId: object.character_id, name: object.name, kind: object.kind, rotationY: Number(object.rotation_y), scale: Number(object.scale),
    }));
    if (!samples.length) return;
    scatterPlan.value = { samples, density: options.density, spread: { rotate: options.rotate, size: options.size }, pictures: options.pictures };
  }

  function scatterAt(from: { col: number; row: number }, to: { col: number; row: number }) {
    const plan = scatterPlan.value;
    const detail = sceneDetail.value;
    if (!plan || !detail || !sceneId.value) return;
    scatterPlan.value = null;
    const occupied = new Set(objects.value
      .filter(object => !object.parent_object_id)
      .flatMap(object => occupiedCells(detail, Number(object.world_x), Number(object.world_z), footprintCells(object.size)))
      .map(cell => `${cell.col}:${cell.row}`));
    const cells = scatterCells(from, to, detail.width_cells, detail.height_cells, occupied, plan.density);
    if (!cells.length) {
      pushToast({ tone: 'info', title: 'Рассыпать некуда', detail: 'В этой области все клетки заняты — выберите другое место.' });
      return;
    }
    const bySample = new Map<ScatterSample, Array<{ x: number; z: number; rotationY: number; scale: number }>>();
    for (const cell of cells) {
      const sample = pick(plan.samples);
      const spots = bySample.get(sample) ?? [];
      spots.push({ ...cellCenter(cell, detail.width_cells, detail.height_cells), ...spreadPose(sample, plan.spread) });
      bySample.set(sample, spots);
    }
    return run(async () => {
      const entries: HistoryEntry[] = [];
      const things: string[] = [];
      for (const [sample, spots] of bySample) {
        const result = await props.request(`/campaigns/${props.campaignId}/characters/${sample.characterId}/duplicate`, 'POST', {
          count: spots.length, sceneId: sceneId.value, spots,
        });
        for (const placement of result.placements as Array<{ id: string; characterId: string }>) {
          entries.push(placementAddedEntry(placement.id, 'рассыпать'));
          if (sample.kind === 'object') things.push(placement.characterId);
        }
      }
      if (entries.length) history.record(groupEntry(entries, 'рассыпать'));
      await randomPictures(things, plan.pictures);
      await Promise.all([refresh(), loadLists()]);
      pushToast({ tone: 'info', title: 'Рассыпано', detail: `Новых объектов: ${entries.length}. Отменить — Ctrl+Z.` });
    });
  }

  return { spreadSelection, startScatter, scatterAt };
}
