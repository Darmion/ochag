import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMapFragments, actMapFragments, viewMapFragments } from './map-fragments.ts';
const user = { name: 'Следопыт', manager: false }, gm = { name: 'Мастер', manager: true };
test('map fragments: all stories have a solvable four-place route', () => {
  for (const [story, route] of [[0, [1, 0, 2, 3]], [1, [2, 1, 0, 3]], [2, [0, 2, 1, 3]]] as const) {
    let game = createMapFragments(1, story);
    for (const place of route) game = actMapFragments(game, { action: 'append', place }, user);
    game = actMapFragments(game, { action: 'check' }, user);
    assert.equal(game.phase, 'solved'); assert.equal(game.attempts, 1);
    assert.throws(() => actMapFragments(game, { action: 'remove', slot: 0 }, user));
  }
});
test('map fragments: edit and note actions are free, duplicates invalid, projections hide secrets', () => {
  const initial = createMapFragments(1, 0);
  let game = actMapFragments(initial, { action: 'append', place: 4 }, user);
  assert.throws(() => actMapFragments(game, { action: 'append', place: 4 }, user));
  assert.throws(() => actMapFragments(game, { action: 'check' }, user));
  game = actMapFragments(game, { action: 'remove', slot: 0 }, user);
  game = actMapFragments(game, { action: 'note', text: '  Запись устарела.  ' }, user);
  game = actMapFragments(game, { action: 'mark', scrap: 3 }, user);
  assert.deepEqual(game.doubtful, [3]); assert.equal(game.notes[0].text, 'Запись устарела.'); assert.equal(game.attempts, 0);
  const visible = viewMapFragments(game, false);
  assert.equal('solution' in visible, false); assert.equal('hint' in visible, false);
  visible.route.push(1); assert.deepEqual(game.route, []);
  assert.deepEqual(initial.notes, []);
  assert.throws(() => actMapFragments(game, { action: 'hint' }, user));
  game = actMapFragments(game, { action: 'hint' }, gm);
  assert.equal(viewMapFragments(game, false).hint, game.hint);
  assert.equal('solution' in viewMapFragments(game, false), false);
});
test('map fragments: last attempt can win, repeated route is free, failure permits GM resolution', () => {
  let game = createMapFragments(1, 0);
  for (const route of [[0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3]]) {
    while (game.route.length) game = actMapFragments(game, { action: 'remove', slot: 0 }, user);
    for (const place of route) game = actMapFragments(game, { action: 'append', place }, user);
    game = actMapFragments(game, { action: 'check' }, user);
    assert.throws(() => actMapFragments(game, { action: 'check' }, user));
  }
  const last = structuredClone(game);
  while (game.route.length) game = actMapFragments(game, { action: 'remove', slot: 0 }, user);
  for (const place of [1, 0, 2, 3]) game = actMapFragments(game, { action: 'append', place }, user);
  assert.equal(actMapFragments(game, { action: 'check' }, user).phase, 'solved');
  last.route = [4, 3, 2, 1];
  const lost = actMapFragments(last, { action: 'check' }, user);
  assert.equal(lost.phase, 'lost');
  assert.throws(() => actMapFragments(lost, { action: 'remove', slot: 0 }, user));
  assert.equal(actMapFragments(lost, { action: 'solve' }, gm).phase, 'solved');
});
test('map fragments: input bounds and shared note capacity', () => {
  let game = createMapFragments(1, 0);
  assert.throws(() => actMapFragments(game, { action: 'append', place: 5 }, user));
  assert.throws(() => actMapFragments(game, { action: 'mark', scrap: -1 }, user));
  assert.throws(() => actMapFragments(game, { action: 'note', text: '  ' }, user));
  for (let i = 0; i < 20; i++) game = actMapFragments(game, { action: 'note', text: String(i) }, user);
  assert.throws(() => actMapFragments(game, { action: 'note', text: '21' }, user));
  assert.throws(() => actMapFragments(game, { action: 'cancel' }, user));
  assert.equal(actMapFragments(game, { action: 'cancel' }, gm).phase, 'cancelled');
});
