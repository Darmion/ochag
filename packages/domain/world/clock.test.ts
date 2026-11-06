import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clockText, dayPhase, effectiveLighting, lightingAt, weatherRules} from './clock.ts';

const at = (day: number, hour: number, minute = 0) => (day - 1) * 1440 + hour * 60 + minute;

test('the day goes dawn → day → dusk → night, and the light follows it', () => {
  assert.deepEqual([4, 5, 7, 12, 18, 20, 23].map(hour => dayPhase(at(1, hour))), ['night', 'dawn', 'day', 'day', 'dusk', 'night', 'night']);
  assert.equal(lightingAt(at(2, 13)), 'bright');
  assert.equal(lightingAt(at(2, 6, 30)), 'dim');
  assert.equal(lightingAt(at(2, 2)), 'dark');
});

test('the clock reads as a day number and a time', () => {
  assert.equal(clockText(0), 'День 1, 00:00');
  assert.equal(clockText(at(3, 14, 5)), 'День 3, 14:05');
});

test('a scene under the sky follows the clock, a dungeon keeps its own light', () => {
  assert.equal(effectiveLighting({sky: 'clock', lighting: 'bright'}, at(1, 23)), 'dark');
  assert.equal(effectiveLighting({sky: 'fixed', lighting: 'dark'}, at(1, 12)), 'dark');
  assert.equal(effectiveLighting({}, at(1, 23)), 'bright');
});

test('heavy weather obscures; a storm puts out open flames; fog limits sight to 60 ft', () => {
  assert.deepEqual(weatherRules('clear'), {obscured: false, perceptionDisadvantage: false, dousesFlames: false, sightFeet: null});
  assert.equal(weatherRules('rain').obscured, false, 'light rain is only a look');
  assert.equal(weatherRules('storm').dousesFlames, true);
  assert.equal(weatherRules('snow').perceptionDisadvantage, true);
  assert.equal(weatherRules('fog').sightFeet, 60);
});
