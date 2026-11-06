import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cropStyle, DEFAULT_CROP, dragCrop, MAX_ZOOM, normalizeCrop, zoomCrop } from '../../src/art/imageCrop.ts';

test('a crop is a focus point and zoom; junk is no crop', () => {
  assert.deepEqual(normalizeCrop({ x: 30.123, y: 120, zoom: 9 }), { x: 30.1, y: 100, zoom: MAX_ZOOM });
  assert.deepEqual(normalizeCrop({ x: -5, y: 50, zoom: 0.2 }), { x: 0, y: 50, zoom: 1 });
  assert.equal(normalizeCrop(null), null);
  assert.equal(normalizeCrop({ x: 1, y: 2 }), null);
  assert.equal(normalizeCrop({ x: '1', y: 2, zoom: 1 }), null);
});

test('the style keeps the focus point in place and zooms around it; no crop — no style', () => {
  assert.deepEqual(cropStyle(null), {});
  assert.deepEqual(cropStyle({ x: 40, y: 20, zoom: 1 }), { objectFit: 'cover', objectPosition: '40% 20%', transformOrigin: '40% 20%' });
  assert.equal(cropStyle({ x: 40, y: 20, zoom: 2 }).transform, 'scale(2)');
});

test('dragging right moves the picture right (the focus point left); zoom makes steps finer', () => {
  const frame = { width: 200, height: 100 };
  assert.deepEqual(dragCrop(DEFAULT_CROP, 20, 0, frame), { x: 40, y: 50, zoom: 1 });
  assert.deepEqual(dragCrop({ x: 50, y: 50, zoom: 2 }, 20, -10, frame), { x: 45, y: 55, zoom: 2 });
  assert.equal(dragCrop({ x: 2, y: 50, zoom: 1 }, 100, 0, frame).x, 0);
  assert.equal(zoomCrop(DEFAULT_CROP, 10).zoom, MAX_ZOOM);
  assert.equal(zoomCrop(DEFAULT_CROP, 0.5).zoom, 1);
});
