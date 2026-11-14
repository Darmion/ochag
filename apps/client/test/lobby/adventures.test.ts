import assert from 'node:assert/strict';
import { test } from 'node:test';

import { adventureCountsText, adventureFacts } from '../../src/lobby/adventures.ts';

test('an adventure card names only what the adventure brings', () => {
  assert.equal(adventureCountsText({ scenes: 2, notes: 4, quests: 2, handouts: 1, rollTables: 0, npcs: 1 }), 'сцен: 2, заметок: 4, заданий: 2, раздаточных: 1, существ вне сцен: 1');
  assert.equal(adventureCountsText({ scenes: 0, notes: 0, quests: 0, handouts: 0, rollTables: 0, npcs: 0 }), '');
});

test('levels, players and length read as short facts; empty ones are left out', () => {
  assert.deepEqual(adventureFacts({ levels: '1–2', players: '3–5', duration: 'один вечер' }), ['уровни 1–2', 'игроков 3–5', 'один вечер']);
  assert.deepEqual(adventureFacts({ levels: '', players: '4', duration: '' }), ['игроков 4']);
});
