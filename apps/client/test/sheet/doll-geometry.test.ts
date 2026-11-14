import test from 'node:test';
import assert from 'node:assert/strict';
import { clampToFrame, fromFrame, toFrame } from '../../src/inventory/dollGeometry.ts';

const near = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-6 && Math.abs(actual.y - expected.y) < 1e-6, `${JSON.stringify(actual)} ≈ ${JSON.stringify(expected)}`);
};

test('a point of the picture lands where the cropped portrait shows it', () => {
  const frame = { width: 280, height: 380 };
  near(toFrame({ x: 0.5, y: 0.5 }, { width: 560, height: 760 }, frame, null), { x: 140, y: 190 });
  const wide = { width: 1000, height: 500 };
  near(toFrame({ x: 0.5, y: 0.5 }, wide, frame, { x: 50, y: 50, zoom: 1 }), { x: 140, y: 190 }, );
  const left = toFrame({ x: 0, y: 0.5 }, wide, frame, { x: 0, y: 50, zoom: 1 });
  near(left, { x: 0, y: 190 });
  const zoomed = toFrame({ x: 0.5, y: 0.25 }, { width: 280, height: 380 }, frame, { x: 50, y: 50, zoom: 2 });
  near(zoomed, { x: 140, y: 0 });
});

test('the way back gives the same picture point; no picture uses the frame itself', () => {
  const frame = { width: 280, height: 380 };
  const image = { width: 900, height: 1300 };
  const crop = { x: 30, y: 20, zoom: 1.6 };
  const point = { x: 0.42, y: 0.31 };
  near(fromFrame(toFrame(point, image, frame, crop), image, frame, crop), point);
  near(toFrame({ x: 0.25, y: 0.5 }, null, frame, null), { x: 70, y: 190 });
  near(clampToFrame({ x: -10, y: 500 }, frame, 20), { x: 20, y: 360 });
});
