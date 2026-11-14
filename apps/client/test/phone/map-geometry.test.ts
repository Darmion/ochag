import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canvasPoint, figureAt, insideBoard, snapFigure, toPx, toWorld } from '../../src/phone/mapGeometry.ts';

const board = { widthCells: 16, heightCells: 12 };

test('a finger on the shown canvas becomes a point on the board and back', () => {
  const at = toPx(board, 2.5, -2.5);
  assert.deepEqual(at, { px: (2.5 + 8) * 32 + 18, pz: (-2.5 + 6) * 32 + 18 });
  assert.deepEqual(toWorld(board, at.px, at.pz), { x: 2.5, z: -2.5 });
  const shown = { left: 10, top: 100, width: 274, height: 210 };
  const drawn = { width: 548, height: 420 };
  assert.deepEqual(canvasPoint(shown, drawn, 10 + 137, 100 + 105), { px: 274, pz: 210 }, 'the canvas shown at half size');
  assert.equal(insideBoard(board, 7.9, -5.9), true);
  assert.equal(insideBoard(board, 8.4, 0), false);
});

test('a drop snaps to cells the way the server takes it; a large figure takes a 2×2 square', () => {
  assert.deepEqual(snapFigure(board, 2.2, -2.9, 'medium'), { x: 2.5, z: -2.5 });
  assert.deepEqual(snapFigure(board, 2.2, -2.9, 'large'), { x: 2, z: -3 });
  assert.deepEqual(snapFigure(board, 40, -40, 'medium'), { x: 7.5, z: -5.5 }, 'off the board — the nearest edge cell');
});

test('the figure under the finger: the one drawn last wins, a large one is wider, empty ground gives nothing', () => {
  const figures = [
    { id: 'a', world_x: 0.5, world_z: 0.5, size: 'medium' },
    { id: 'b', world_x: 0.5, world_z: 0.5, size: 'medium' },
    { id: 'ogre', world_x: 4, world_z: 4, size: 'large' },
  ];
  assert.equal(figureAt(figures, 0.6, 0.4)?.id, 'b');
  assert.equal(figureAt(figures, 4.8, 4.5)?.id, 'ogre', 'a large figure is a circle two cells wide');
  assert.equal(figureAt(figures, 2.5, 2.5), null);
});
