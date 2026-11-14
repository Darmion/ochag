import {test} from 'node:test';
import assert from 'node:assert/strict';
import {alternateSections, orderWallsAlong} from './wall-alternate.ts';

const wall = (id: string, x1: number, z1: number, x2: number, z2: number) => ({id, x1, z1, x2, z2});

test('walls are ordered along their chain, whatever order they were selected in, with their direction', () => {
  const chain = [wall('c', 2, 0, 3, 0), wall('a', 0, 0, 1, 0), wall('d', 3, 1, 3, 0), wall('b', 1, 0, 2, 0)];
  const order = orderWallsAlong(chain);
  const ids = order.map(entry => entry.wall.id).join('');
  assert.ok(ids === 'abcd' || ids === 'dcba', ids);
  const d = order.find(entry => entry.wall.id === 'd')!;
  assert.equal(d.reversed, ids === 'abcd', 'd is drawn towards the chain, so walking a→d goes against it');
  const apart = orderWallsAlong([wall('x', 5, 5, 6, 5), ...chain]);
  assert.equal(apart.length, 5, 'a separate wall is not lost');
  assert.equal(new Set(apart.map(entry => entry.chain)).size, 2, 'two chains');
});

test('sections alternate along the tiles of a chain, across wall joints and inside long walls', () => {
  const chain = [wall('long', 0, 0, 3, 0), wall('turn', 3, 0, 3, 2)];
  const cycle = alternateSections(chain, ['rock', 'stone'], 'cycle');
  assert.deepEqual(cycle.get('long'), [{from: 0, to: 1, style: 'rock'}, {from: 1, to: 2, style: 'stone'}, {from: 2, to: 3, style: 'rock'}]);
  assert.deepEqual(cycle.get('turn'), [{from: 0, to: 1, style: 'stone'}, {from: 1, to: 2, style: 'rock'}], 'goes on after the corner');
  const pairs = alternateSections(chain, ['rock', 'stone'], 'cycle', 2);
  assert.deepEqual(pairs.get('long'), [{from: 0, to: 2, style: 'rock'}, {from: 2, to: 3, style: 'stone'}], 'two cells per section');
  assert.deepEqual(pairs.get('turn'), [{from: 0, to: 1, style: 'stone'}, {from: 1, to: 2, style: 'rock'}]);
});

test('a wall drawn backwards gets its sections in its own direction', () => {
  const back = alternateSections([wall('a', 0, 0, 2, 0), wall('b', 4, 0, 2, 0)], ['rock', 'stone'], 'cycle');
  const tiles = (id: string) => back.get(id)!.flatMap(section => Array.from({length: section.to - section.from}, () => section.style));
  const along = [...tiles('a'), ...tiles('b').reverse()];
  assert.deepEqual(along, ['rock', 'stone', 'rock', 'stone']);
});

test('mixed: no two equal neighbouring sections; one style or a new chain restarts cleanly', () => {
  let seed = 0.13;
  const random = () => (seed = (seed * 9301 + 0.49297) % 1);
  const mixed = alternateSections([wall('a', 0, 0, 8, 0)], ['rock', 'stone', 'hedge'], 'mix', 1, random).get('a')!;
  const tiles = mixed.flatMap(section => Array.from({length: section.to - section.from}, () => section.style));
  assert.equal(tiles.length, 8);
  for (let index = 1; index < tiles.length; index += 1) assert.notEqual(tiles[index], tiles[index - 1], tiles.join(' '));
  assert.deepEqual(alternateSections([wall('a', 0, 0, 3, 0)], ['rock'], 'mix').get('a'), [{from: 0, to: 3, style: 'rock'}]);
  const two = alternateSections([wall('a', 0, 0, 1, 0), wall('b', 5, 5, 6, 5)], ['rock', 'stone'], 'cycle');
  assert.equal(two.get('a')![0]!.style, 'rock');
  assert.equal(two.get('b')![0]!.style, 'rock', 'each chain starts with the first style');
});
