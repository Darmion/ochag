import { Vector3, Matrix, MeshBuilder, Scene, ArcRotateCamera, StandardMaterial } from '@babylonjs/core';
import type { Position } from '../grid';
import type { LabelApi } from './labels';
import { PING_DURATION_MS, SIGNAL_COLORS } from '../signals';
import type { Ping, ToolHooks } from '../sceneTypes';

export type PingsDeps = Pick<LabelApi, 'createLabel' | 'removeLabel' | 'setLabelText'> & {
  canvas: HTMLCanvasElement;
  tools: ToolHooks;
  reducedMotion: boolean;
  scene: Scene;
  camera: ArcRotateCamera;
  clampX: (value: number) => number;
  clampZ: (value: number) => number;
  emissiveMaterial: (name: string, color: string) => StandardMaterial;
};

export function createPings({
  canvas, tools, reducedMotion, scene, camera, removeLabel, createLabel, setLabelText, clampX,
  clampZ, emissiveMaterial,
}: PingsDeps) {
  const pings = new Set<Ping>();

  function disposePing(ping: Ping) {
    ping.mesh.dispose();
    ping.mat.dispose();
    ping.shadow.dispose();
    ping.shadowMat.dispose();
    removeLabel(ping.label);
    ping.arrow?.remove();
    pings.delete(ping);
  }

  const arrowProjected = new Vector3();
  function pingInsets() {
    const style = tools.overlay ? getComputedStyle(tools.overlay) : null;
    const read = (name: string, fallback: number) => {
      const value = parseFloat(style?.getPropertyValue(name) ?? '');
      return Number.isFinite(value) ? value : fallback;
    };
    return { left: read('--ping-inset-left', 46), right: read('--ping-inset-right', 46), top: read('--ping-inset-top', 46), bottom: read('--ping-inset-bottom', 46) };
  }
  function placePingArrow(ping: Ping, alpha: number) {
    if (!ping.arrow) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    Vector3.ProjectToRef(ping.point, Matrix.IdentityReadOnly, scene.getTransformMatrix(), camera.viewport.toGlobal(width, height), arrowProjected);
    const behind = arrowProjected.z < 0 || arrowProjected.z > 1;
    const inside = !behind && arrowProjected.x >= 0 && arrowProjected.x <= width && arrowProjected.y >= 0 && arrowProjected.y <= height;
    ping.arrow.hidden = inside;
    if (inside) return;
    const cx = width / 2;
    const cy = height / 2;
    let dx = arrowProjected.x - cx;
    let dy = arrowProjected.y - cy;
    if (behind) { dx = -dx; dy = -dy; }
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dy = 1;
    const inset = pingInsets();
    const left = inset.left;
    const right = width - inset.right;
    const top = inset.top;
    const bottom = height - inset.bottom;
    const ox = Math.min(Math.max(cx, left), right);
    const oy = Math.min(Math.max(cy, top), bottom);
    const scale = Math.min(
      dx > 0 ? (right - ox) / dx : dx < 0 ? (left - ox) / dx : Infinity,
      dy > 0 ? (bottom - oy) / dy : dy < 0 ? (top - oy) / dy : Infinity,
    );
    const x = ox + dx * scale;
    const y = oy + dy * scale;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    ping.arrow.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    ping.arrow.style.setProperty('--angle', `${angle.toFixed(1)}deg`);
    ping.arrow.style.opacity = String(Math.max(0.35, alpha));
  }

  function showPing(point: Position, displayName: string, color: string) {
    const oldest = pings.values().next().value;
    if (pings.size >= 12 && oldest) disposePing(oldest);

    const x = clampX(point.x);
    const z = clampZ(point.z);
    const mat = emissiveMaterial('ping', color);
    const mesh = MeshBuilder.CreateTorus('ping', { diameter: 1, thickness: 0.11, tessellation: 40 }, scene);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.position.set(x, 0.1, z);

    const shadowMat = emissiveMaterial('ping-shadow', '#1a120b');
    const shadow = MeshBuilder.CreateTorus('ping-shadow', { diameter: 1, thickness: 0.2, tessellation: 40 }, scene);
    shadow.material = shadowMat;
    shadow.isPickable = false;
    shadow.position.set(x, 0.08, z);

    const anchor = new Vector3(x, 0.6, z);
    const label = createLabel('ping-label', () => anchor);
    label?.el.style.setProperty('--signal-color', color);
    setLabelText(label, displayName);

    let arrow: HTMLDivElement | null = null;
    if (tools.overlay) {
      arrow = document.createElement('div');
      arrow.className = 'ping-arrow';
      arrow.hidden = true;
      arrow.style.setProperty('--signal-color', color);
      const head = document.createElement('span');
      head.className = 'ping-arrow-head';
      head.textContent = '➤';
      const name = document.createElement('span');
      name.className = 'ping-arrow-name';
      name.textContent = displayName;
      arrow.append(head, name);
      tools.overlay.appendChild(arrow);
    }

    pings.add({ mesh, mat, shadow, shadowMat, label, startedAt: performance.now(), arrow, point: new Vector3(x, 0.1, z) });
  }

  scene.onBeforeRenderObservable.add(() => {
    if (!pings.size) return;
    const now = performance.now();

    for (const ping of [...pings]) {
      const age = (now - ping.startedAt) / PING_DURATION_MS;

      if (age >= 1) {
        disposePing(ping);
        continue;
      }

      let size: number;
      let alpha: number;

      if (reducedMotion) {
        size = 1.3;
        alpha = age < 0.8 ? 1 : (1 - age) / 0.2;
      } else {
        const wave = (age * 3) % 1;
        size = 0.3 + wave * 1.9;
        alpha = 1 - wave * wave;
      }

      ping.mesh.scaling.set(size, 1, size);
      ping.shadow.scaling.set(size, 1, size);
      ping.mat.alpha = alpha;
      ping.shadowMat.alpha = alpha * 0.7;
      placePingArrow(ping, 1 - age * 0.6);
    }
  });

  function firePing(point: Position) {
    showPing(point, 'Вы', tools.ownColor ?? SIGNAL_COLORS[0]!);
    tools.onPing?.(point);
  }

  function clearPings() {
    for (const ping of [...pings]) disposePing(ping);
  }

  return { showPing, firePing, clearPings };
}
