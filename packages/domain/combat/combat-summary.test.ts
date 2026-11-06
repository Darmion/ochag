import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCombat} from './combat-summary.ts';

test('combat summary from roll outcomes: attacks, damage dealt and taken, kills, healing', () => {
  const stats = summarizeCombat([
    {character_id: 'hero', outcome: {kind: 'attack', target: {id: 'orc'}, hit: true, critical: true}},
    {character_id: 'hero', outcome: {kind: 'damage', target: {id: 'orc'}, applied: 9, dropped: false}},
    {character_id: 'hero', outcome: {kind: 'attack', target: {id: 'orc'}, hit: false}},
    {character_id: 'mage', outcome: {kind: 'damage', targets: [{id: 'orc', applied: 7, dropped: true}, {id: 'gob', applied: 3, dropped: false}]}},
    {character_id: 'orc', outcome: {kind: 'attack', target: {id: 'hero'}, hit: true, critical: false}},
    {character_id: 'orc', outcome: {kind: 'damage', target: {id: 'hero'}, applied: 5}},
    {character_id: 'mage', outcome: {kind: 'heal', targets: [{id: 'hero', healed: 4}]}},
    {character_id: 'hero', outcome: {kind: 'save', success: true}},
    {character_id: null, outcome: null},
  ]);
  assert.deepEqual(stats.get('hero'), {characterId: 'hero', damageDealt: 9, damageTaken: 5, hits: 1, misses: 1, crits: 1, kills: 0, healing: 0});
  assert.deepEqual(stats.get('mage'), {characterId: 'mage', damageDealt: 10, damageTaken: 0, hits: 0, misses: 0, crits: 0, kills: 1, healing: 4});
  assert.equal(stats.get('orc')!.damageTaken, 16);
  assert.equal(stats.get('gob')!.damageTaken, 3);
});
