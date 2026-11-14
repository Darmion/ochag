import { test } from 'node:test';
import assert from 'node:assert/strict';

import { paintTerrainRect, terrainCounts, terrainMap } from './terrain.ts';

test('painting a rectangle sets one kind per cell; starting on that kind clears only that kind', () => {
  let state = { difficult: [[0, 0], [1, 0]], water: [] as number[][] };
  state = paintTerrainRect(state, { col: 1, row: 0 }, { col: 2, row: 1 }, 'deep');
  assert.deepEqual(terrainCounts(state), { difficult: 1, shallow: 0, deep: 4 });
  assert.equal(terrainMap(state).get('1:0'), 'deep', 'water replaces mud in the same cell');

  state = paintTerrainRect(state, { col: 0, row: 1 }, { col: 0, row: 1 }, 'shallow');
  assert.deepEqual(state.water.find(([col, row]) => col === 0 && row === 1), [0, 1, 1]);

  state = paintTerrainRect(state, { col: 2, row: 1 }, { col: 0, row: 0 }, 'deep');
  assert.deepEqual(terrainCounts(state), { difficult: 1, shallow: 1, deep: 0 }, 'the drag began on deep water: only deep water goes');
});
