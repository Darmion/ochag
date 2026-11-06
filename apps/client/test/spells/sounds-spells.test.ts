import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

import { ambienceTrack, SFX_EVENTS, sceneSurface, spellSfxEvent, waterTrack } from '../../src/tabletop/soundCatalog.ts';
import { naturalMark } from '../../src/tabletop/toasts.ts';

const publicFile = (path: string) => new URL(`../../public/sfx/${path}`, import.meta.url);

test('every pack sound and ambience loop the client asks for is in public/sfx', () => {
  for (const event of SFX_EVENTS) {
    for (const choice of event.choices) {
      for (const path of [...(choice.files ?? []), ...(choice.area ?? []), ...(choice.spray ?? [])]) {
        assert.ok(existsSync(publicFile(path)), `${event.id}/${choice.id}: ${path}`);
      }
    }
  }
  for (const surface of ['dirt', 'stone', 'water', 'wood']) {
    for (let index = 1; index <= 5; index++) {
      assert.ok(existsSync(publicFile(`steps/${surface}-walk-${index}.ogg`)));
      assert.ok(existsSync(publicFile(`steps/${surface}-chain-walk-${index}.ogg`)));
    }
  }
  for (const place of ['forest', 'cave', 'beach', 'sea', 'inside'] as const) {
    for (const weather of ['clear', 'rain', 'storm'] as const) {
      for (const night of [false, true]) {
        const track = ambienceTrack(place, night, weather)!;
        assert.ok(existsSync(publicFile(track)), track);
      }
    }
  }
  for (const water of ['river', 'stream', 'waterfall'] as const) assert.ok(existsSync(publicFile(waterTrack(water)!)));
});

test('ambience follows day and night and the weather; footsteps follow the place', () => {
  assert.equal(ambienceTrack('forest', false, 'clear'), 'ambience/forest-day.webm');
  assert.equal(ambienceTrack('forest', true, 'rain'), 'ambience/forest-night-rain.webm');
  assert.equal(ambienceTrack('cave', true, 'storm'), 'ambience/cave-storm.webm', 'a cave has no day and night');
  assert.equal(ambienceTrack('sea', false, 'fog'), 'ambience/sea.webm', 'fog and snow — the plain loop');
  assert.equal(ambienceTrack('none', false, 'rain'), null);
  assert.equal(waterTrack('none'), null);
  assert.equal(sceneSurface({ place: 'forest' }), 'dirt');
  assert.equal(sceneSurface({ place: 'sea' }), 'wood');
  assert.equal(sceneSurface({ place: 'forest', steps: 'water' }), 'water', 'the GM’s choice wins');
  assert.equal(sceneSurface({}), 'stone');
});

test('spell sound by damage type', () => {
  assert.deepEqual(
    ['fire', 'cold', 'piercing', 'thunder', 'poison', 'radiant', null].map(spellSfxEvent),
    ['spell-fire', 'spell-cold', 'spell-earth', 'spell-thunder', 'spell-acid', 'spell-other', 'spell-other'],
  );
});

test('natural 20 and 1 are marked and shown without modifiers', () => {
  const roll = (formula: string, dice: number[], total: number, extra: Record<string, unknown> = {}) => ({ formula, dice_results: dice, total, ...extra });
  assert.deepEqual(naturalMark(roll('1d20+5', [20], 25, { outcome: { kind: 'attack', critical: true } })), { kind: 'crit', die: 20, text: 'КРИТ · 20', total: null });
  assert.deepEqual(naturalMark(roll('2d20dis+3', [1, 17], 4, { label: 'Атака: Лук' })), { kind: 'fumble', die: 1, text: 'ПРОВАЛ · 1', total: null });
  assert.deepEqual(naturalMark(roll('1d20+7', [20], 27, { label: 'Спасбросок ЛОВ' })), { kind: 'crit', die: 20, text: 'КРИТ · 20', total: 27 }, 'a save keeps its total aside');
  assert.equal(naturalMark(roll('1d20+5', [19], 24, { outcome: { kind: 'attack', critical: true } }))?.text, 'КРИТ · 19', 'improved critical');
  assert.equal(naturalMark(roll('1d20+2', [20], 22, { label: 'Инициатива' })), null);
  assert.equal(naturalMark(roll('1d20+5', [12], 17)), null);
  assert.equal(naturalMark(roll('8d6', [6, 6, 6, 6, 6, 6, 6, 6], 48)), null);
});
