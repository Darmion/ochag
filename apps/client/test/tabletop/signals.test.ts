import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIGNAL_COLORS, signalColor } from '../../src/tabletop/signals.ts';

test('a participant always gets the same signal colour', () => {
  const id = '42a15037-5aa6-47ca-81ec-9688867e625b';
  assert.equal(signalColor(id), signalColor(id));
});

test('signal colours come from the palette', () => {
  for (const id of ['', 'a', 'master', '69032531-dde1-4ad5-8bb9-6402176e9ebd']) {
    assert.ok(SIGNAL_COLORS.includes(signalColor(id)), id);
  }
});

test('different participants spread over the palette', () => {
  const used = new Set(Array.from({ length: 64 }, (_, index) => signalColor(`user-${index}`)));
  assert.ok(used.size >= SIGNAL_COLORS.length - 1, String(used.size));
});
