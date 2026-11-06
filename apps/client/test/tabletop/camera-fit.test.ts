import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraBasis, fitCamera, freeRect, insetsFromPanels, projectPoint } from '../../src/tabletop/cameraFit.ts';

type V = { x: number; y: number; z: number };
const FOV = 0.8;

function project(points: V[], fit: { target: { x: number; z: number }; radius: number }, alpha: number, beta: number, size: { width: number; height: number }) {
  const basis = cameraBasis(alpha, beta);
  const eye = { x: fit.target.x - basis.look.x * fit.radius, y: -basis.look.y * fit.radius, z: fit.target.z - basis.look.z * fit.radius };
  return points.map(point => projectPoint(point, eye, basis, size.height / 2 / Math.tan(FOV / 2), size));
}

const board = (w: number, h: number, y0 = -0.2, y1 = 1): V[] => [-1, 1].flatMap(sx => [-1, 1].flatMap(sz => [y0, y1].map(y => ({ x: sx * (w / 2 + 0.65), y, z: sz * (h / 2 + 0.65) }))));

function bbox(points: Array<{ x: number; y: number }>) {
  return {
    left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)),
  };
}

test('the whole board fits the free rectangle between the HUD panels and fills it on one axis', () => {
  const size = { width: 1264, height: 800 };
  const rect = { left: 130, top: 110, right: 1140, bottom: 640 };
  const alpha = -Math.PI / 2, beta = Math.PI / 3;
  const points = board(20, 14);
  const fit = fitCamera({ points, alpha, beta, fov: FOV, size, rect, minRadius: 6, maxRadius: 200 });
  assert.equal(fit.fits, true);
  const box = bbox(project(points, fit, alpha, beta, size));
  for (const side of ['left', 'top'] as const) assert.ok(box[side] >= rect[side] - 1, `${side}: ${box[side]} vs ${rect[side]}`);
  for (const side of ['right', 'bottom'] as const) assert.ok(box[side] <= rect[side] + 1, `${side}: ${box[side]} vs ${rect[side]}`);
  const fillsWidth = Math.abs(box.left - rect.left) < 1 && Math.abs(box.right - rect.right) < 1;
  const fillsHeight = Math.abs(box.top - rect.top) < 1 && Math.abs(box.bottom - rect.bottom) < 1;
  assert.ok(fillsWidth || fillsHeight, JSON.stringify(box));
  if (fillsWidth) assert.ok(Math.abs((box.top + box.bottom) / 2 - (rect.top + rect.bottom) / 2) < 3, JSON.stringify(box));
  else assert.ok(Math.abs((box.left + box.right) / 2 - (rect.left + rect.right) / 2) < 3, JSON.stringify(box));
  assert.ok(fit.coverage > 0.3 && fit.coverage <= 1.01);
});

test('any board, angle and window: points stay in front of the camera and inside the rectangle, the target stays near', () => {
  let checked = 0;
  for (const size of [{ width: 1264, height: 800 }, { width: 700, height: 900 }])
    for (const [w, h] of [[1, 1], [20, 14], [30, 6], [6, 30], [100, 100]] as const)
      for (const [y0, y1] of [[0, 0.4], [-0.2, 1]] as const)
        for (const alpha of [-Math.PI / 2, -1, 0, 0.7, Math.PI, 2.5])
          for (const beta of [0.2, 0.6, Math.PI / 3, 1.3, 1.45]) {
            const points = board(w, h, y0, y1);
            const rect = { left: 130, top: 110, right: size.width - 120, bottom: size.height - 160 };
            const maxRadius = Math.max(45, Math.hypot(w, h) * 1.8);
            const fit = fitCamera({ points, alpha, beta, fov: FOV, size, rect, minRadius: 6, maxRadius });
            assert.ok(Math.hypot(fit.target.x, fit.target.z) < Math.hypot(w, h) + 10, JSON.stringify({ w, h, alpha, beta, fit }));
            if (fit.radius < maxRadius - 1e-6) {
              const projected = project(points, fit, alpha, beta, size);
              assert.ok(projected.every(p => p.depth > 0), 'behind the camera');
              const box = bbox(projected);
              assert.ok(box.left >= rect.left - 2 && box.right <= rect.right + 2 && box.top >= rect.top - 2 && box.bottom <= rect.bottom + 2, JSON.stringify({ w, h, alpha, beta, box }));
              assert.equal(fit.fits, true);
            }
            checked++;
          }
  assert.equal(checked, 600);
});

test('a group of tokens away from the centre fits at a rotated angle', () => {
  const size = { width: 1920, height: 1000 };
  const rect = { left: 290, top: 170, right: 1790, bottom: 820 };
  const tokens: V[] = [{ x: 6, y: 0, z: 3 }, { x: 9, y: 1.6, z: 4 }, { x: 7, y: 0, z: -2 }, { x: 11, y: 1.6, z: 0 }];
  const alpha = -Math.PI / 3, beta = Math.PI / 4;
  const fit = fitCamera({ points: tokens, alpha, beta, fov: FOV, size, rect, minRadius: 6, maxRadius: 200 });
  const box = bbox(project(tokens, fit, alpha, beta, size));
  assert.ok(box.left >= rect.left - 1 && box.right <= rect.right + 1 && box.top >= rect.top - 1 && box.bottom <= rect.bottom + 1, JSON.stringify(box));
});

test('the radius stays within the camera limits and says when the board does not fit', () => {
  const size = { width: 1264, height: 800 };
  const rect = { left: 20, top: 20, right: 1244, bottom: 780 };
  const near = fitCamera({ points: [{ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0.2 }], alpha: -Math.PI / 2, beta: Math.PI / 3, fov: FOV, size, rect, minRadius: 6, maxRadius: 45 });
  assert.equal(near.radius, 6);
  assert.ok(Math.hypot(near.target.x - 0.1, near.target.z - 0.1) < 0.5);
  const far = fitCamera({ points: board(200, 200), alpha: -Math.PI / 2, beta: Math.PI / 3, fov: FOV, size, rect, minRadius: 6, maxRadius: 45 });
  assert.equal(far.radius, 45);
  assert.equal(far.fits, false);
});

test('free rectangle leaves the panels out and falls back to the whole canvas when too tight', () => {
  assert.deepEqual(freeRect({ width: 1200, height: 800 }, { left: 118, top: 90, right: 110, bottom: 150 }), { left: 134, top: 106, right: 1074, bottom: 634 });
  assert.deepEqual(freeRect({ width: 500, height: 400 }, { left: 268, top: 90, right: 110, bottom: 150 }), { left: 16, top: 16, right: 484, bottom: 384 });
  assert.deepEqual(freeRect({ width: 1200, height: 800 }, { left: 500, top: 90, right: 480, bottom: 150 }), { left: 16, top: 16, right: 1184, bottom: 784 });
});

test('each panel takes the edge that costs the least area', () => {
  const size = { width: 1264, height: 805 };
  const insets = insetsFromPanels(size, [
    { left: 10, top: 10, right: 104, bottom: 410 },
    { left: 118, top: 10, right: 315, bottom: 90 },
    { left: 1165, top: 15, right: 1254, bottom: 260 },
    { left: 10, top: 650, right: 1254, bottom: 795 },
    { left: -400, top: 100, right: -10, bottom: 300 },
  ]);
  assert.deepEqual(insets, { left: 104, top: 90, right: 99, bottom: 155 });
});
