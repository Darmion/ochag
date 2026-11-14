import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_ICONS, iconPath } from '../../src/ui/gameIcons.ts';

test('every icon is a set of valid path strings with known prefixes', () => {
  for (const [name, paths] of Object.entries(GAME_ICONS)) {
    assert.ok(paths.length > 0, `${name} has no paths`);
    for (const raw of paths) {
      const { d } = iconPath(raw);
      assert.match(d, /^M/, `${name}: a path must start with a move: ${raw}`);
      assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/, `${name}: unexpected characters or prefix in ${raw}`);
    }
  }
});

test('the prefixes: ~ is a fainter secondary part, * fills it', () => {
  assert.deepEqual(iconPath('M1 1h2'), { d: 'M1 1h2', filled: false, secondary: false });
  assert.deepEqual(iconPath('*M1 1h2'), { d: 'M1 1h2', filled: true, secondary: false });
  assert.deepEqual(iconPath('~M1 1h2'), { d: 'M1 1h2', filled: false, secondary: true });
  assert.deepEqual(iconPath('~*M1 1h2'), { d: 'M1 1h2', filled: true, secondary: true });
});

test('no two icon names share one drawing', () => {
  const seen = new Map<string, string>();
  for (const [name, paths] of Object.entries(GAME_ICONS)) {
    const drawing = paths.join('|');
    assert.equal(seen.get(drawing), undefined, `${name} draws the same as ${seen.get(drawing)}`);
    seen.set(drawing, name);
  }
});
