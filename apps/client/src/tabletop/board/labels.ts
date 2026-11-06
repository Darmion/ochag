import { Vector3, Matrix, Scene, ArcRotateCamera } from '@babylonjs/core';
import { type LabelBlock, type LabelShift, layoutLabels } from '../labelLayout';
import type { ToolHooks } from '../sceneTypes';
import type { GameIconName } from '../../ui/gameIcons';
import { iconSvg } from '../../ui/iconSvg';

export type OverlayLabel = {
  el: HTMLDivElement;
  anchor: () => Vector3 | null;
  transform: string;
  visible: boolean;
  block?: { id: string; part: 'name' | 'hp'; priority: () => number };
  size: { width: number; height: number } | null;
};

type PlacedBlock = LabelBlock & { labels: OverlayLabel[] };

export type LabelsDeps = {
  canvas: HTMLCanvasElement;
  tools: ToolHooks;
  scene: Scene;
  camera: ArcRotateCamera;
};

export function createLabels({ canvas, tools, scene, camera }: LabelsDeps) {
  const overlayLabels = new Set<OverlayLabel>();

  function createLabel(className: string, anchor: () => Vector3 | null, block?: OverlayLabel['block']): OverlayLabel | null {
    if (!tools.overlay) return null;

    const el = document.createElement('div');
    el.className = `table-label ${className}`;
    el.hidden = true;
    tools.overlay.appendChild(el);

    const label: OverlayLabel = { el, anchor, transform: '', visible: false, block, size: null };
    overlayLabels.add(label);
    return label;
  }

  function removeLabel(label: OverlayLabel | null | undefined) {
    if (!label) return;
    label.el.remove();
    overlayLabels.delete(label);
  }

  function setLabelText(label: OverlayLabel | null | undefined, text: string, icons: { before?: readonly GameIconName[]; after?: readonly GameIconName[] } = {}) {
    if (!label) return;
    const before = icons.before ?? [];
    const after = icons.after ?? [];
    const key = `${before.join(',')}|${text}|${after.join(',')}`;
    if (label.el.dataset.content === key) return;
    label.el.dataset.content = key;
    if (!before.length && !after.length) label.el.textContent = text;
    else label.el.replaceChildren(...before.map(name => iconSvg(name, 13)), document.createTextNode(text), ...after.map(name => iconSvg(name, 13)));
    label.size = null;
  }

  function setLabelClass(label: OverlayLabel | null | undefined, className: string) {
    const next = `table-label ${className}`;
    if (label && label.el.className !== next) {
      label.el.className = next;
      label.size = null;
    }
  }

  const projected = new Vector3();

  function placeLabel(label: OverlayLabel, x: number, y: number) {
    const next = `translate(${x}px, ${y}px)`;
    if (next !== label.transform) {
      label.el.style.transform = next;
      label.transform = next;
    }
  }
  let lastBlocksKey = '';
  let lastShifts = new Map<string, LabelShift>();

  function invalidateLabelSizes() {
    for (const label of overlayLabels) label.size = null;
    lastBlocksKey = '';
  }

  scene.onAfterRenderObservable.add(() => {
    if (!overlayLabels.size) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const viewport = camera.viewport.toGlobal(width, height);
    const transform = scene.getTransformMatrix();
    const grouped: Array<{ label: OverlayLabel; x: number; y: number }> = [];

    for (const label of overlayLabels) {
      const anchor = label.anchor();
      let visible = false;

      if (anchor) {
        Vector3.ProjectToRef(anchor, Matrix.IdentityReadOnly, transform, viewport, projected);
        visible =
          projected.z >= 0 && projected.z <= 1 &&
          projected.x >= -60 && projected.x <= width + 60 &&
          projected.y >= -60 && projected.y <= height + 60;
      }

      if (visible !== label.visible) {
        label.el.hidden = !visible;
        label.visible = visible;
      }
      if (!visible) continue;

      const x = Math.round(projected.x);
      const y = Math.round(projected.y);
      if (label.block) grouped.push({ label, x, y });
      else placeLabel(label, x, y);
    }
    if (!grouped.length) return;

    const blocks = new Map<string, PlacedBlock>();
    for (const { label, x, y } of grouped) {
      if (!label.size) label.size = { width: label.el.offsetWidth, height: label.el.offsetHeight };
      const part = label.block!;
      let block = blocks.get(part.id);
      if (!block) {
        block = { id: part.id, x, y, width: 0, above: 0, below: 0, priority: part.priority(), labels: [] };
        blocks.set(block.id, block);
      }
      block.width = Math.max(block.width, label.size.width);
      if (part.part === 'name') block.above = label.size.height;
      else block.below = label.size.height + 2;
      block.labels.push(label);
    }

    const list = [...blocks.values()];
    const key = `${width}x${height}|${list.map(b => `${b.id}:${b.x},${b.y},${b.width},${b.above},${b.below},${b.priority}`).join(';')}`;
    if (key !== lastBlocksKey) {
      lastShifts = layoutLabels(list, { width, height }, { previous: lastShifts });
      lastBlocksKey = key;
    }
    for (const block of list) {
      const shift = lastShifts.get(block.id);
      for (const label of block.labels) placeLabel(label, block.x + (shift?.dx ?? 0), block.y + (shift?.dy ?? 0));
    }
  });

  return { overlayLabels, createLabel, removeLabel, setLabelText, setLabelClass, invalidateLabelSizes };
}

export type LabelApi = ReturnType<typeof createLabels>;
