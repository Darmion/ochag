import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blocksMove, blocksSight, splitWall, wallCondition, wallDefense, wallReachable, wallSteps, wallTileAt} from './walls.ts';

test('what a wall, a door and a window hold', () => {
  const at = {x1: 0, z1: 0, x2: 1, z2: 0};
  assert.deepEqual([blocksMove({...at}), blocksSight({...at})], [true, true], 'a wall holds both');
  assert.deepEqual([blocksMove({...at, kind: 'window'}), blocksSight({...at, kind: 'window'})], [true, false], 'glass: no way through, but seen through');
  assert.deepEqual([blocksMove({...at, kind: 'door'}), blocksSight({...at, kind: 'door'})], [true, true], 'a closed door');
  assert.deepEqual([blocksMove({...at, kind: 'door', open: true}), blocksSight({...at, kind: 'door', open: true})], [false, false], 'an open door');
  assert.deepEqual([blocksMove({...at, broken: true}), blocksSight({...at, broken: true})], [false, false], 'rubble');
});

test('armour class and hit points by material (DMG): stone, wood, glass; own maximum first', () => {
  assert.deepEqual(wallDefense({style: 'stone'}), {ac: 17, hpMax: 27});
  assert.deepEqual(wallDefense({style: 'wood'}), {ac: 15, hpMax: 18});
  assert.deepEqual(wallDefense({kind: 'door', style: 'stone'}), {ac: 15, hpMax: 18}, 'a door is wooden');
  assert.deepEqual(wallDefense({kind: 'window'}), {ac: 13, hpMax: 4});
  assert.deepEqual(wallDefense({style: 'rock', hp_max: 100}), {ac: 17, hpMax: 100});
  assert.equal(wallCondition(null, 27, false), 'целая');
  assert.equal(wallCondition(20, 27, false), 'повреждена');
  assert.equal(wallCondition(5, 27, false), 'вот-вот рухнет');
  assert.equal(wallCondition(0, 27, true), 'разрушена');
  assert.deepEqual([wallCondition(null, 4, false, 'window'), wallCondition(0, 4, true, 'window'), wallCondition(0, 18, true, 'door')], ['целое', 'разбито', 'выбита'], 'by gender');
});

test('a wall tile behind another wall cannot be struck (26.10.2026, item 1)', () => {
  const tile = {x1: 0, z1: 2, x2: 0, z2: 3};
  const hero = {x: -1.5, z: 2.5, size: 1};
  assert.equal(wallReachable(hero, tile, []), true, 'nothing between');
  assert.equal(wallReachable(hero, tile, [{x1: -1, z1: 2, x2: -1, z2: 3}]), false, 'a wall between covers every line');
  assert.equal(wallReachable(hero, tile, [{x1: -1, z1: 2, x2: -1, z2: 2.5}]), true, 'half covered — a line gets through');
  assert.equal(wallReachable(hero, tile, [{x1: 0, z1: -5, x2: 0, z2: 2}, {x1: 0, z1: 3, x2: 0, z2: 5}]), true, 'its own neighbours');
  assert.equal(wallReachable({x: 1.5, z: 2.5, size: 1}, tile, [{x1: -1, z1: 2, x2: -1, z2: 3}]), true, 'the inner wall is behind the target');
});

test('a wall is cut into one-cell pieces round the chosen one', () => {
  const wall = {x1: 0, z1: -5, x2: 0, z2: 5};
  assert.equal(wallSteps(wall), 10);
  assert.equal(wallSteps({x1: 0, z1: 0, x2: 3, z2: 3}), 3, 'a diagonal — by steps');
  assert.equal(wallTileAt(wall, {x: 0.2, z: 0.5}), 5);
  assert.equal(wallTileAt(wall, {x: 0, z: 99}), 9, 'clamped to the end');
  assert.deepEqual(splitWall(wall, 5), [
    {part: 'before', x1: 0, z1: -5, x2: 0, z2: 0},
    {part: 'tile', x1: 0, z1: 0, x2: 0, z2: 1},
    {part: 'after', x1: 0, z1: 1, x2: 0, z2: 5},
  ]);
  assert.deepEqual(splitWall(wall, 0).map(part => part.part), ['tile', 'after']);
  assert.deepEqual(splitWall({x1: 0, z1: 0, x2: 1, z2: 0}, 0).map(part => part.part), ['tile'], 'one cell — the wall itself');
});
