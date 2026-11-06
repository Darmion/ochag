import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cellCutByWall, footprintEdges, nearSideOfObstruction, pathBlocked, wallCrossesCellDiagonally} from './blockers.ts';
import {visibleCells} from './los.ts';

test('a blocking object’s square edges stop sight like walls', () => {
  const edges = footprintEdges(0.5, 0, 1);
  assert.equal(edges.length, 4);
  const seen = visibleCells({x: -1.5, z: 0}, null, 5, {widthCells: 4, heightCells: 1}, edges).map(cell => cell.x);
  assert.deepEqual(seen, [-1.5, -0.5], 'the door cell and the one behind it are dark');
});

test('a path through a wall or a blocker is blocked; around it is not', () => {
  const wall = [{x1: 0, z1: -2, x2: 0, z2: 2}];
  assert.equal(pathBlocked({x: -0.5, z: 0.5}, {x: 0.5, z: 0.5}, wall), true);
  assert.equal(pathBlocked({x: -0.5, z: 0.5}, {x: -0.5, z: 3.5}, wall), false, 'alongside');
  assert.equal(pathBlocked({x: -0.5, z: 2.5}, {x: 0.5, z: 2.5}, wall), false, 'past its end');
  assert.equal(pathBlocked({x: 1, z: 1}, {x: 1, z: 1}, wall), false, 'standing still');

  const house = footprintEdges(3.5, 0.5, 3);
  assert.equal(pathBlocked({x: 0.5, z: 0.5}, {x: 6.5, z: 0.5}, house), true, 'straight through the house');
});

test('a wall along a cell edge does not block it; one that cuts across its corner does', () => {
  assert.equal(wallCrossesCellDiagonally({x1: 0, z1: 0, x2: 1, z2: 0}, 0.5, 0.5), false, 'bottom edge');
  assert.equal(wallCrossesCellDiagonally({x1: 0, z1: 0, x2: 0, z2: 1}, 0.5, 0.5), false, 'left edge');
  assert.equal(wallCrossesCellDiagonally({x1: -5, z1: 0, x2: 5, z2: 0}, 0.5, 0.5), false, 'a long wall along the same edge');
  assert.equal(wallCrossesCellDiagonally({x1: 0, z1: 0, x2: 1, z2: 1}, 0.5, 0.5), true, 'corner to corner');
  assert.equal(wallCrossesCellDiagonally({x1: 0, z1: 1, x2: 1, z2: 0}, 0.5, 0.5), true, 'the other diagonal');
  assert.equal(wallCrossesCellDiagonally({x1: 0, z1: 0.3, x2: 0.3, z2: 0}, 0.5, 0.5), true, 'a shallower corner cut');
  assert.equal(wallCrossesCellDiagonally({x1: -1, z1: -1, x2: 0, z2: 0}, 0.5, 0.5), false, 'only grazes the corner point');
  assert.equal(wallCrossesCellDiagonally({x1: 5, z1: 5, x2: 6, z2: 6}, 0.5, 0.5), false, 'nowhere near the cell');

  const long = {x1: 0, z1: 0, x2: 2, z2: 2};
  assert.equal(wallCrossesCellDiagonally(long, 0.5, 0.5), true);
  assert.equal(wallCrossesCellDiagonally(long, 1.5, 1.5), true);
  assert.equal(wallCrossesCellDiagonally(long, 2.5, 2.5), false, 'past its end');

  assert.equal(cellCutByWall(0.5, 0.5, [{x1: 0, z1: 0, x2: 1, z2: 0}]), false);
  assert.equal(cellCutByWall(0.5, 0.5, [{x1: 5, z1: 5, x2: 6, z2: 6}, {x1: 0, z1: 0, x2: 1, z2: 1}]), true);
});

test('an area point behind a wall comes into being on the near side of it (PHB, p. 204)', () => {
  const door = [{x1: 2, z1: -1, x2: 2, z2: 1}];
  const near = nearSideOfObstruction({x: 0, z: 0}, {x: 5, z: 0}, door)!;
  assert.ok(near.x < 1.9 && near.x > 1.5, String(near.x));
  assert.equal(near.z, 0);
  const twoWalls = [{x1: 4, z1: -1, x2: 4, z2: 1}, ...door];
  assert.ok(nearSideOfObstruction({x: 0, z: 0}, {x: 5, z: 0}, twoWalls)!.x < 2);
  assert.equal(nearSideOfObstruction({x: 0, z: 0}, {x: 1.5, z: 0}, door), null);
  assert.equal(nearSideOfObstruction({x: 0, z: 0}, {x: 5, z: 3}, door), null);
});
