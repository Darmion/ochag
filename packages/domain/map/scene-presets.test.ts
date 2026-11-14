import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isLatticePoint } from './los.ts';
import { SCENE_PRESET_IDS, SCENE_PRESETS, presetDifficultCells, presetElevationCells, presetWaterCells, presetWalls } from './scene-presets.ts';

test('every scene preset is a valid map: walls on grid corners inside the board, terrain on its cells', () => {
  for (const id of SCENE_PRESET_IDS) {
    const preset = SCENE_PRESETS[id];
    assert.equal(preset.id, id);
    const walls = presetWalls(preset);
    assert.ok(walls.length >= 8, `${id}: too few walls`);
    const halfW = preset.widthCells / 2, halfH = preset.heightCells / 2;
    const seen = new Set<string>();
    for (const wall of walls) {
      for (const [x, z] of [[wall.x1, wall.z1], [wall.x2, wall.z2]] as const) {
        assert.ok(isLatticePoint(x, preset.widthCells) && isLatticePoint(z, preset.heightCells), `${id}: ${x},${z} is off the grid`);
        assert.ok(Math.abs(x) <= halfW && Math.abs(z) <= halfH, `${id}: ${x},${z} is off the board`);
      }
      assert.ok(wall.x1 !== wall.x2 || wall.z1 !== wall.z2, `${id}: zero-length wall`);
      const key = [[wall.x1, wall.z1], [wall.x2, wall.z2]].map(point => point.join(':')).sort().join('|');
      assert.ok(!seen.has(key), `${id}: duplicate wall ${key}`);
      seen.add(key);
    }
    const cells = [...presetDifficultCells(preset), ...presetWaterCells(preset)];
    assert.equal(new Set(cells.map(cell => `${cell[0]}:${cell[1]}`)).size, cells.length, `${id}: a cell has two kinds of terrain`);
    const raised = presetElevationCells(preset);
    assert.equal(new Set(raised.map(cell => `${cell[0]}:${cell[1]}`)).size, raised.length, `${id}: a cell has two heights`);
    for (const [col, row] of [...cells, ...raised]) {
      assert.ok(Number.isInteger(col) && Number.isInteger(row) && col! >= 0 && row! >= 0 && col! < preset.widthCells && row! < preset.heightCells, `${id}: cell ${col},${row} is off the board`);
    }
    assert.ok(raised.every(cell => cell[2] !== 0 && cell[2]! % 5 === 0), `${id}: heights go in steps of 5 feet`);
  }
});

test('the tavern has a front door and windows; the cave is natural rock open at its mouth', () => {
  const tavern = presetWalls(SCENE_PRESETS.tavern);
  assert.ok(tavern.filter(wall => wall.kind === 'door').length >= 3);
  assert.ok(tavern.filter(wall => wall.kind === 'window').length >= 3);
  const cave = presetWalls(SCENE_PRESETS.cave);
  assert.ok(cave.every(wall => wall.style === 'rock' && wall.kind === 'wall'));
  const outline = SCENE_PRESETS.cave.lines[0]!.path;
  assert.notDeepEqual(outline[0], outline[outline.length - 1]);
  assert.ok(presetWaterCells(SCENE_PRESETS.cave).some(cell => cell[2] === 2), 'the cave has an underground lake');
  assert.ok(presetWaterCells(SCENE_PRESETS.road).some(cell => cell[2] === 1), 'the road fords a stream');
});
