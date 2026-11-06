import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notices, passiveScore, seesClearly} from './stealth.ts';
import {d20Ruling, conditionState} from './conditions.ts';

test('passive Perception is 10 + modifier, 5 less into half-light or weather', () => {
  assert.equal(passiveScore(3, false), 13);
  assert.equal(passiveScore(3, true), 8);
  assert.equal(notices(13, 13), true, 'a tie goes to the watcher');
  assert.equal(notices(12, 13), false);
});

test('nobody hides from one who sees him clearly: bright light, in sight, no cover', () => {
  assert.equal(seesClearly('bright', 'none'), true);
  assert.equal(seesClearly('bright', 'half'), false, 'half cover is enough');
  assert.equal(seesClearly('dim', 'none'), false, 'so is half-light');
  assert.equal(seesClearly('dark', 'none'), false, 'darkvision sees darkness only as half-light');
  assert.equal(seesClearly(null, 'none'), false);
});

test('advantages of the situation join the ruling like its disadvantages', () => {
  const own = conditionState([]);
  const sneak = d20Ruling({kind: 'attack', ability: 'dexterity', own, extraAdvantages: ['из скрытности']});
  assert.equal(sneak.advantage, 'adv');
  assert.ok(sneak.reasons.includes('преимущество: из скрытности'));
  const both = d20Ruling({kind: 'attack', ability: 'dexterity', own, extraAdvantages: ['из скрытности'], extraDisadvantages: ['цель скрыта']});
  assert.equal(both.advantage, 'none');
});
