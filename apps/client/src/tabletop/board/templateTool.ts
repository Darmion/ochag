import { Mesh, StandardMaterial, PointerEventTypes, Scene, ArcRotateCamera, GroundMesh } from '@babylonjs/core';
import { snapToLatticePoint } from '../grid';
import type { AreaShape, Area } from '../areas';
import type { ToolHooks, TableTool } from '../sceneTypes';

export type TemplateToolDeps = {
  canvas: HTMLCanvasElement;
  widthCells: number;
  heightCells: number;
  tools: ToolHooks;
  scene: Scene;
  camera: ArcRotateCamera;
  cameraGesture: (event: unknown) => boolean;
  holdCamera: (event: unknown) => void;
  ground: GroundMesh;
  tintMaterial: (name: string, color: string, alpha: number) => StandardMaterial;
  areaTiles: (area: Area, name: string) => Mesh | null;
  tool: () => TableTool;
};

export function createTemplateTool({
  canvas, widthCells, heightCells, tools, scene, camera, cameraGesture, holdCamera, ground,
  tintMaterial, areaTiles, tool,
}: TemplateToolDeps) {
  let templateStyle: { shape: AreaShape; size: number; width: number; color: string } = { shape: 'circle', size: 4, width: 1, color: '#e8835a' };
  let templateDrag: { x: number; z: number; direction: number } | null = null;
  let templatePreview: { mesh: Mesh | null; material: StandardMaterial } | null = null;

  function setTemplateStyle(style: { shape: AreaShape; size: number; width: number; color: string }) {
    templateStyle = style;
  }

  function templateDragActive() {
    return templateDrag !== null;
  }

  function cancelTemplateDrag() {
    if (!templateDrag) return;
    templateDrag = null;
    camera.attachControl(canvas, true);
    showTemplatePreview();
  }

  function showTemplatePreview() {
    templatePreview?.mesh?.dispose();
    templatePreview?.material.dispose();
    templatePreview = null;
    if (!templateDrag) return;
    const area: Area = { shape: templateStyle.shape, x: templateDrag.x, z: templateDrag.z, direction: templateDrag.direction, size: templateStyle.size, width: templateStyle.width };
    const material = tintMaterial('template-preview', templateStyle.color, 0.2);
    const mesh = areaTiles(area, 'template-preview');
    if (mesh) mesh.material = material;
    templatePreview = { mesh, material };
  }

  scene.onPointerObservable.add(info => {
    if (info.type === PointerEventTypes.POINTERDOWN) {
      if (tool() !== 'template' || info.event.button !== 0 || cameraGesture(info.event)) return;
      const pick = scene.pick(scene.pointerX, scene.pointerY, mesh => mesh === ground);
      if (!pick?.hit || !pick.pickedPoint) return;
      templateDrag = { x: snapToLatticePoint(pick.pickedPoint.x, widthCells), z: snapToLatticePoint(pick.pickedPoint.z, heightCells), direction: 0 };
      holdCamera(info.event);
      showTemplatePreview();
      return;
    }

    if (info.type === PointerEventTypes.POINTERMOVE && templateDrag) {
      const pick = scene.pick(scene.pointerX, scene.pointerY, mesh => mesh === ground);
      if (!pick?.hit || !pick.pickedPoint) return;
      const dx = pick.pickedPoint.x - templateDrag.x;
      const dz = pick.pickedPoint.z - templateDrag.z;
      if (Math.hypot(dx, dz) < 0.3) return;
      const angle = (Math.atan2(dz, dx) * 180) / Math.PI;
      const direction = ((Math.round(angle / 15) * 15) % 360 + 360) % 360;
      if (direction === templateDrag.direction) return;
      templateDrag.direction = direction;
      showTemplatePreview();
      return;
    }

    if (info.type === PointerEventTypes.POINTERUP && templateDrag) {
      const placed = templateDrag;
      templateDrag = null;
      camera.attachControl(canvas, true);
      showTemplatePreview();
      tools.onTemplatePlace?.(placed);
    }
  });

  return { setTemplateStyle, templateDragActive, cancelTemplateDrag };
}
