import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapTargetDecision } from '../../src/tabletop/mapTargeting.ts';

const attack = { mode: 'attack' as const, known: true, self: false, busy: false, distance: 5, range: 5, selected: [], id: 'enemy' };

test('map attacks accept the reach boundary and reject distant or unavailable targets', () => {
  assert.equal(mapTargetDecision(attack).kind, 'attack');
  assert.equal(mapTargetDecision({ ...attack, distance: 10 }).kind, 'error');
  assert.equal(mapTargetDecision({ ...attack, known: false }).kind, 'error');
  assert.equal(mapTargetDecision({ ...attack, blocked: true }).kind, 'error');
  assert.equal(mapTargetDecision({ ...attack, self: true }).kind, 'error');
});

test('repeated clicks while an action or confirmation is pending cannot execute again', () => {
  assert.deepEqual(mapTargetDecision({ ...attack, busy: true }), { kind: 'ignore' });
  assert.deepEqual(mapTargetDecision({ ...attack, mode: 'spell', busy: true }), { kind: 'ignore' });
});

test('single-target spells replace the previous target; multi-target spells toggle it', () => {
  assert.deepEqual(mapTargetDecision({ ...attack, mode: 'spell', single: true, selected: ['ally'] }), { kind: 'spell', targets: ['enemy'] });
  assert.deepEqual(mapTargetDecision({ ...attack, mode: 'spell', selected: ['ally'] }), { kind: 'spell', targets: ['ally', 'enemy'] });
  assert.deepEqual(mapTargetDecision({ ...attack, mode: 'spell', selected: ['ally', 'enemy'] }), { kind: 'spell', targets: ['ally'] });
});

test('a spell can target its caster even when the caster is absent from the target list', () => {
  assert.deepEqual(mapTargetDecision({ ...attack, mode: 'spell', self: true, known: false, id: 'caster', single: true, distance: null }), { kind: 'spell', targets: ['caster'] });
});
