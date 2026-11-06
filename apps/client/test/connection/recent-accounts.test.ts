import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addRecent, mergeAccounts, parseRecent, type AccountPlace } from '../../src/connection/recentAccounts.ts';

test('recent accounts are read leniently from storage', () => {
  assert.deepEqual(parseRecent(null), []);
  assert.deepEqual(parseRecent('{"username":"a"}'), []);
  assert.deepEqual(parseRecent(JSON.stringify([
    { username: 'lira', serverUrl: 'https://10.0.0.2:3000', usedAt: 5 },
    { username: 'no-server' },
    null,
    { username: 7, serverUrl: 'https://x' },
  ])), [{ username: 'lira', serverUrl: 'https://10.0.0.2:3000', usedAt: 5 }]);
  assert.throws(() => parseRecent('not json'));
});

test('a new sign-in goes first, replaces the same account on the same server and keeps twelve', () => {
  const list = Array.from({ length: 12 }, (_, index) => ({ username: `u${index}`, serverUrl: 'https://a', usedAt: index }));
  const next = addRecent(list, 'u3', 'https://a', 100);
  assert.equal(next.length, 12);
  assert.deepEqual(next[0], { username: 'u3', serverUrl: 'https://a', usedAt: 100 });
  assert.equal(next.filter(entry => entry.username === 'u3').length, 1);
  const other = addRecent(list, 'u3', 'https://b', 101);
  assert.equal(other.length, 12);
  assert.deepEqual(other.slice(0, 1), [{ username: 'u3', serverUrl: 'https://b', usedAt: 101 }]);
  assert.ok(other.some(entry => entry.username === 'u3' && entry.serverUrl === 'https://a'));
  assert.ok(!other.some(entry => entry.username === 'u11'));
});

test('saved sign-ins come first, then recent ones by last use, without repeats', () => {
  const places: AccountPlace[] = [];
  const where = (place: AccountPlace) => { places.push(place); return place.hostName ?? place.serverUrl; };
  const saved = [{ id: 's1', serverUrl: 'https://a', username: 'master', hostName: 'GM-PC' }];
  const recent = [
    { username: 'lira', serverUrl: 'https://b', usedAt: 1 },
    { username: 'master', serverUrl: 'https://a', usedAt: 9 },
    { username: 'tor', serverUrl: 'https://b', usedAt: 5 },
  ];
  const list = mergeAccounts(saved, recent, where);
  assert.deepEqual(list.map(entry => [entry.key, entry.where, entry.saved?.id ?? null]), [
    ['https://a|master', 'GM-PC', 's1'],
    ['https://b|tor', 'https://b', null],
    ['https://b|lira', 'https://b', null],
  ]);
  assert.deepEqual(places.slice(1), [{ serverUrl: 'https://b', hostName: null }, { serverUrl: 'https://b', hostName: null }]);
  assert.equal(recent[0]!.username, 'lira');
});
