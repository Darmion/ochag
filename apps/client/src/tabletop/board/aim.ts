import { Mesh, StandardMaterial, MeshBuilder, PointerEventTypes, Scene, TransformNode } from '@babylonjs/core';
import { footprintCells, type Position, snapToLatticePoint, snapFootprint } from '../grid';
import { type Area, inArea } from '../areas';
import type { AimSpec, AimMark, AimPlace, TabletopOptions, ToolHooks, ObjectRecord, WallSegment, TableTool } from '../sceneTypes';

export type AimDeps = {
  canvas: HTMLCanvasElement;
  options: Pick<TabletopOptions, 'onSelectObject'>;
  widthCells: number;
  heightCells: number;
  tools: Pick<ToolHooks, 'onAimArea' | 'onAimAreaHover' | 'onAimHover' | 'onAimPlace' | 'onAimWall'>;
  scene: Scene;
  objectEntries: Map<string, ObjectRecord>;
  rootOf: (objectId: string) => TransformNode | null;
  wallList: () => WallSegment[];
  hoveredWallId: () => string | null;
  setHoveredWall: (id: string | null) => void;
  wallPointUnderPointer: () => Position | null;
  isWallPickMode: () => boolean;
  placePreviewMaterial: StandardMaterial;
  tintMaterial: (name: string, color: string, alpha: number) => StandardMaterial;
  areaTiles: (area: Area, name: string) => Mesh | null;
  tool: () => TableTool;
  pickGroundPoint: (snap: boolean) => Position | null;
};

export function createAim({
  canvas, options, widthCells, heightCells, tools, scene, objectEntries, rootOf, wallList,
  hoveredWallId, setHoveredWall, wallPointUnderPointer, isWallPickMode, placePreviewMaterial,
  tintMaterial, areaTiles, tool, pickGroundPoint,
}: AimDeps) {
  let aim: AimSpec | null = null;
  let aimHover: string | null = null;
  let aimTouched = new Set<string>();
  let aimTouchedKey = '';
  function resetAimTouched() {
    aimTouchedKey = '';
  }
  let aimPreview: { key: string; mesh: Mesh | null; inRange: boolean } | null = null;
  const aimRings = new Map<string, Mesh>();
  const aimMaterials: Record<AimMark | 'hover', StandardMaterial> = {
    ok: tintMaterial('aim-ok', '#7ee08f', 0.8),
    far: tintMaterial('aim-far', '#e0574c', 0.65),
    chosen: tintMaterial('aim-chosen', '#f5c469', 0.95),
    hover: tintMaterial('aim-hover', '#ffffff', 0.95),
  };
  let aimAreaMaterial: StandardMaterial | null = null;
  const aimOffMaterial = tintMaterial('aim-area-off', '#e0574c', 0.3);

  function aimMarkOf(id: string): AimMark | null {
    if (aim?.area) return aimTouched.has(id) ? 'chosen' : null;
    return aim?.marks[id] ?? null;
  }

  function refreshAimRings() {
    const wanted = new Map<string, AimMark>();
    if (aim) for (const id of objectEntries.keys()) {
      const mark = aimMarkOf(id);
      if (mark) wanted.set(id, mark);
    }
    for (const [id, ring] of aimRings) {
      if (wanted.has(id)) continue;
      ring.dispose();
      aimRings.delete(id);
    }
    for (const [id, mark] of wanted) {
      let ring = aimRings.get(id);
      if (!ring) {
        ring = MeshBuilder.CreateTorus(`aim-ring-${id}`, { diameter: 1.1, thickness: 0.08, tessellation: 40 }, scene);
        ring.isPickable = false;
        aimRings.set(id, ring);
      }
      ring.material = aimMaterials[id === aimHover && mark === 'ok' ? 'hover' : mark];
    }
  }

  scene.onBeforeRenderObservable.add(() => {
    if (!aimRings.size) return;
    for (const [id, ring] of aimRings) {
      const holder = rootOf(id);
      if (!holder) continue;
      const size = holder.scaling.x * footprintCells(objectEntries.get(id)?.data.size);
      ring.position.set(holder.position.x, holder.position.y + 0.04, holder.position.z);
      ring.scaling.set(size, 1, size);
    }
  });

  function aimAreaAt(point: Position): { area: Area; inRange: boolean } | null {
    const spec = aim?.area;
    if (!spec) return null;
    const origin = aim?.originId ? rootOf(aim.originId) : null;
    const ox = origin?.position.x ?? point.x;
    const oz = origin?.position.z ?? point.z;
    const n = aim?.originId ? footprintCells(objectEntries.get(aim.originId)?.data.size) : 1;
    const width = spec.width;
    if (spec.fromSelf) {
      const raw = (Math.atan2(point.z - oz, point.x - ox) * 180) / Math.PI;
      const step = spec.shape === 'square' ? 90 : 15;
      const direction = ((Math.round(raw / step) * step) % 360 + 360) % 360;
      if (spec.shape === 'circle') return { area: { shape: 'circle', x: ox, z: oz, direction: 0, size: spec.size }, inRange: true };
      if (spec.shape === 'square') {
        const angle = (direction * Math.PI) / 180;
        return { area: { shape: 'square', x: ox + Math.cos(angle) * (n / 2), z: oz + Math.sin(angle) * (n / 2), direction, size: spec.size }, inRange: true };
      }
      return { area: { shape: spec.shape, x: ox, z: oz, direction, size: spec.size, width }, inRange: true };
    }
    const cx = snapToLatticePoint(point.x, widthCells);
    const cz = snapToLatticePoint(point.z, heightCells);
    const inRange = spec.range === null || !origin || Math.max(Math.abs(cx - ox), Math.abs(cz - oz)) <= spec.range + n / 2 + 1e-6;
    if (spec.shape === 'square') return { area: { shape: 'square', x: cx - spec.size / 2, z: cz, direction: 0, size: spec.size }, inRange };
    return { area: { shape: spec.shape, x: cx, z: cz, direction: 0, size: spec.size, width }, inRange };
  }

  function touchedBy(area: Area): Set<string> {
    const found = new Set<string>();
    for (const [id, record] of objectEntries) {
      if (aim?.area?.fromSelf && id === aim.originId) continue;
      const cells = footprintCells(record.data.size);
      const half = cells / 2;
      outer: for (let dz = 0; dz < cells; dz += 1) {
        for (let dx = 0; dx < cells; dx += 1) {
          if (inArea(area, record.data.world_x - half + 0.5 + dx, record.data.world_z - half + 0.5 + dz)) {
            found.add(id);
            break outer;
          }
        }
      }
    }
    return found;
  }

  function clearAimPreview() {
    aimPreview?.mesh?.dispose();
    aimPreview = null;
  }

  function updateAimArea() {
    const point = aim?.area ? pickGroundPoint(false) : null;
    const placed = point ? aimAreaAt(point) : null;
    if (!placed) {
      clearAimPreview();
      return;
    }
    const key = JSON.stringify([placed.area.shape, placed.area.x, placed.area.z, placed.area.direction, placed.area.size, placed.area.width ?? 0, placed.inRange]);
    if (aimPreview?.key !== key) {
      clearAimPreview();
      const mesh = areaTiles(placed.area, 'aim-area');
      if (mesh) {
        mesh.material = placed.inRange ? aimAreaMaterial : aimOffMaterial;
        mesh.position.y += 0.004;
      }
      aimPreview = { key, mesh, inRange: placed.inRange };
    }
    const touched = touchedBy(placed.area);
    const touchedKey = `${[...touched].sort().join(',')}|${placed.inRange}`;
    if (touchedKey === aimTouchedKey) return;
    aimTouchedKey = touchedKey;
    aimTouched = touched;
    refreshAimRings();
    tools.onAimAreaHover?.([...touched], placed.inRange);
  }

  function aimWallUnderPointer(): string | null {
    if (!aim?.walls) return null;
    const objectHit = scene.pick(scene.pointerX, scene.pointerY, mesh => Boolean(mesh.metadata?.objectId));
    if (objectHit?.hit) return null;
    const hit = scene.pick(scene.pointerX, scene.pointerY, mesh => Boolean(mesh.metadata?.wallId));
    const id = hit?.hit ? (hit.pickedMesh?.metadata?.wallId as string | undefined) : undefined;
    const wall = id ? wallList().find(entry => entry.id === id) : undefined;
    return wall && !wall.broken ? wall.id : null;
  }

  let aimPlaceNodes: Mesh[] = [];
  let aimPlaceKey = '';
  function aimPlaceCenter(point: Position, cells: number): Position {
    return { x: snapFootprint(point.x, widthCells, cells), z: snapFootprint(point.z, heightCells, cells) };
  }
  function setAimPlace(place: AimPlace | null) {
    const key = place ? `${place.cells}:${place.count}` : '';
    if (key === aimPlaceKey) return;
    aimPlaceKey = key;
    for (const mesh of aimPlaceNodes) mesh.dispose();
    aimPlaceNodes = [];
    if (!place) return;
    for (let index = 0; index < place.count; index += 1) {
      const disc = MeshBuilder.CreateCylinder(`aim-place-${index}`, { diameter: place.cells * 0.8, height: 0.05, tessellation: 24 }, scene);
      disc.material = placePreviewMaterial;
      disc.isPickable = false;
      disc.setEnabled(false);
      aimPlaceNodes.push(disc);
    }
  }
  function updateAimPlace(point: Position | null) {
    const place = aim?.place;
    if (!place) return;
    const columns = Math.ceil(Math.sqrt(place.count));
    const center = point ? aimPlaceCenter(point, place.cells) : null;
    aimPlaceNodes.forEach((disc, index) => {
      if (!center) { disc.setEnabled(false); return; }
      const dx = ((index % columns) - (columns - 1) / 2) * place.cells;
      const dz = (Math.floor(index / columns) - (Math.ceil(place.count / columns) - 1) / 2) * place.cells;
      disc.position.set(center.x + dx, 0.05, center.z + dz);
      disc.setEnabled(true);
    });
  }

  scene.onPointerObservable.add(info => {
    if (info.type !== PointerEventTypes.POINTERMOVE || !aim) return;
    if (aim.place) {
      updateAimPlace(pickGroundPoint(false));
      return;
    }
    if (aim.area) {
      updateAimArea();
      return;
    }
    const objectHit = scene.pick(scene.pointerX, scene.pointerY, mesh => Boolean(mesh.metadata?.objectId));
    const hover = objectHit?.hit ? ((objectHit.pickedMesh?.metadata?.objectId as string | undefined) ?? null) : null;
    const wall = aimWallUnderPointer();
    const changed = hover !== aimHover || wall !== hoveredWallId();
    if (hover !== aimHover) {
      aimHover = hover;
      refreshAimRings();
    }
    setHoveredWall(wall);
    if (changed) tools.onAimHover?.({ objectId: hover, wallId: wall });
  });

  function aimTap() {
    if (!aim) return;
    if (aim.place) {
      const point = pickGroundPoint(false);
      if (point) tools.onAimPlace?.(aimPlaceCenter(point, aim.place.cells));
      return;
    }
    if (aim.area) {
      const point = pickGroundPoint(false);
      const placed = point ? aimAreaAt(point) : null;
      if (placed) tools.onAimArea?.({ x: placed.area.x, z: placed.area.z, direction: placed.area.direction, inRange: placed.inRange });
      return;
    }
    const objectHit = scene.pick(scene.pointerX, scene.pointerY, mesh => Boolean(mesh.metadata?.objectId));
    const objectId = objectHit?.hit ? (objectHit.pickedMesh?.metadata?.objectId as string | undefined) : undefined;
    if (objectId) {
      options.onSelectObject?.(objectId);
      return;
    }
    const wallId = aimWallUnderPointer();
    if (wallId) tools.onAimWall?.(wallId, wallPointUnderPointer());
  }

  // Babylon rewrites canvas.style.cursor on every move (defaultCursor/hoverCursor), so the aim cursor goes through those.
  let aimCursor: string | null = null;
  function setAimCursor(css: string | null) {
    aimCursor = css;
    scene.defaultCursor = css ?? '';
    scene.hoverCursor = css ?? 'pointer';
    canvas.style.cursor = css ?? (tool() === 'select' ? '' : tool() === 'erase' ? 'cell' : 'crosshair');
  }

  function setAim(next: AimSpec | null) {
    const areaKey = (spec: AimSpec | null) => (spec?.area ? JSON.stringify([spec.originId, spec.area]) : '');
    const areaChanged = areaKey(next) !== areaKey(aim);
    aim = next;
    if (areaChanged || !next?.area) {
      clearAimPreview();
      aimTouched = new Set();
      aimTouchedKey = '';
      aimAreaMaterial?.dispose();
      aimAreaMaterial = next?.area ? tintMaterial('aim-area', next.area.color, 0.5) : null;
    }
    if (!next?.walls && hoveredWallId() && !isWallPickMode()) setHoveredWall(null);
    if (!next) aimHover = null;
    setAimPlace(next?.place ?? null);
    refreshAimRings();
    if (next?.area) updateAimArea();
  }

  function aimActive() {
    return aim !== null;
  }

  function hasAimCursor() {
    return aimCursor !== null;
  }

  function refreshAim() {
    if (!aim) return;
    resetAimTouched();
    if (aim.area) updateAimArea();
    else refreshAimRings();
  }

  return { aimTap, setAimCursor, setAim, aimActive, hasAimCursor, refreshAim };
}
