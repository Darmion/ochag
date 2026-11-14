import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onSegment } from './links.ts';
import { createRuneLock, viewRuneLock } from './rune-lock.ts';
import { createMapFragments, viewMapFragments } from './map-fragments.ts';

test('a door piece belongs to the remembered door when both its ends lie on it', () => {
  const door = { x1: 4, z1: 0, x2: 4, z2: 2 };
  assert.equal(onSegment(door, { x1: 4, z1: 0, x2: 4, z2: 1 }), true);
  assert.equal(onSegment(door, { x1: 4, z1: 2, x2: 4, z2: 1 }), true, 'direction does not matter');
  assert.equal(onSegment(door, { x1: 4, z1: 1, x2: 4, z2: 3 }), false, 'a piece reaching past the door is another door');
  assert.equal(onSegment(door, { x1: 5, z1: 0, x2: 5, z2: 1 }), false);
});

test('only the GM sees what a lock holds shut or what a map opens', () => {
  const lock = createRuneLock([0, 1, 2], '', 3, 1, undefined, { kind: 'object', id: 'chest', name: 'Сундук' });
  assert.equal('target' in viewRuneLock(lock, false), false);
  assert.deepEqual(viewRuneLock(lock, true).target, { kind: 'object', id: 'chest', name: 'Сундук' });
  const map = createMapFragments(1, 0, { kind: 'object', id: 'hatch', name: 'Люк' });
  assert.equal('target' in viewMapFragments(map, false), false);
  assert.equal(viewMapFragments(map, true).target?.name, 'Люк');
});
