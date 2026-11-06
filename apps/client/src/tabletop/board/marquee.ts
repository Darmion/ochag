import { Vector3, Matrix, PointerEventTypes, Scene, ArcRotateCamera } from '@babylonjs/core';
import type { ToolHooks, ObjectRecord, WallSegment, AreaTemplate, TableTool } from '../sceneTypes';

export type MarqueeDeps = {
  canvas: HTMLCanvasElement;
  tools: ToolHooks;
  scene: Scene;
  camera: ArcRotateCamera;
  cameraScheme: () => 'tts' | 'classic';
  cameraGesture: (event: unknown) => boolean;
  holdCamera: (event: unknown) => void;
  objectEntries: Map<string, ObjectRecord>;
  isWallPickMode: () => boolean;
  wallList: () => WallSegment[];
  isWallDrawMode: () => boolean;
  templateList: () => AreaTemplate[];
  tool: () => TableTool;
  isTerrainBrush: () => boolean;
};

export function createMarquee({
  canvas, tools, scene, camera, cameraScheme, cameraGesture, holdCamera, objectEntries,
  isWallPickMode, wallList, isWallDrawMode, templateList, tool, isTerrainBrush,
}: MarqueeDeps) {
  let marquee: { x0: number; y0: number; x1: number; y1: number; el: HTMLDivElement | null } | null = null;
  let marqueeEnded = false;
  const projectedPoint = new Vector3();
  function onScreen(x: number, y: number, z: number) {
    Vector3.ProjectToRef(new Vector3(x, y, z), Matrix.IdentityReadOnly, scene.getTransformMatrix(),
      camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight), projectedPoint);
    return projectedPoint.z >= 0 && projectedPoint.z <= 1 ? { x: projectedPoint.x, y: projectedPoint.y } : null;
  }

  scene.onPointerObservable.add(info => {
    if (info.type === PointerEventTypes.POINTERDOWN) {
      const event = info.event as PointerEvent;
      const plainMarquee = cameraScheme() === 'tts' && !event.altKey && !isWallPickMode();
      if (event.button !== 0 || !(event.shiftKey || plainMarquee) || tool() !== 'select' || isWallDrawMode() || isTerrainBrush() || !tools.onMarquee || cameraGesture(event)) return;
      if (scene.pick(scene.pointerX, scene.pointerY, mesh => Boolean(mesh.metadata?.objectId || mesh.metadata?.wallId))?.hit) return;
      marquee = { x0: scene.pointerX, y0: scene.pointerY, x1: scene.pointerX, y1: scene.pointerY, el: null };
      holdCamera(info.event);
      return;
    }
    if (info.type === PointerEventTypes.POINTERMOVE && marquee) {
      marquee.x1 = scene.pointerX;
      marquee.y1 = scene.pointerY;
      if (!marquee.el && Math.hypot(marquee.x1 - marquee.x0, marquee.y1 - marquee.y0) > 5 && tools.overlay) {
        marquee.el = document.createElement('div');
        marquee.el.className = 'table-marquee';
        marquee.el.style.cssText = 'position:absolute;left:0;top:0;border:1.5px dashed #6fe3d0;background:#6fe3d022;pointer-events:none;z-index:3';
        tools.overlay.appendChild(marquee.el);
      }
      if (marquee.el) {
        marquee.el.style.transform = `translate(${Math.min(marquee.x0, marquee.x1)}px, ${Math.min(marquee.y0, marquee.y1)}px)`;
        marquee.el.style.width = `${Math.abs(marquee.x1 - marquee.x0)}px`;
        marquee.el.style.height = `${Math.abs(marquee.y1 - marquee.y0)}px`;
      }
      return;
    }
    if (info.type === PointerEventTypes.POINTERUP && marquee) {
      const box = marquee;
      marquee = null;
      box.el?.remove();
      camera.attachControl(canvas, true);
      if (!box.el) return;
      marqueeEnded = true;
      setTimeout(() => { marqueeEnded = false; }, 0);
      const left = Math.min(box.x0, box.x1), right = Math.max(box.x0, box.x1);
      const top = Math.min(box.y0, box.y1), bottom = Math.max(box.y0, box.y1);
      const inside = (point: { x: number; y: number } | null) => Boolean(point && point.x >= left && point.x <= right && point.y >= top && point.y <= bottom);
      const objects = [...objectEntries.entries()]
        .filter(([, record]) => record.holder.isEnabled() && inside(onScreen(record.holder.getAbsolutePosition().x, record.holder.getAbsolutePosition().y + 0.3, record.holder.getAbsolutePosition().z)))
        .map(([id]) => id);
      const walls = wallList().filter(wall => inside(onScreen((wall.x1 + wall.x2) / 2, 0.5, (wall.z1 + wall.z2) / 2))).map(wall => wall.id);
      const templates = templateList().filter(area => inside(onScreen(area.x, 0.03, area.z))).map(area => area.id);
      tools.onMarquee?.({ objects, walls, templates });
    }
  });

  function marqueeActive() {
    return marquee !== null;
  }

  function consumeMarqueeEnd() {
    if (!marqueeEnded) return false;
    marqueeEnded = false;
    return true;
  }

  function cancelMarquee() {
    if (!marquee) return;
    marquee.el?.remove();
    marquee = null;
    camera.attachControl(canvas, true);
  }

  function disposeMarquee() {
    marquee?.el?.remove();
    marquee = null;
  }

  return { marqueeActive, consumeMarqueeEnd, cancelMarquee, disposeMarquee };
}
