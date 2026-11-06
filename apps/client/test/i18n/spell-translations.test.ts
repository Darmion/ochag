import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../../packages/domain/srd/${name}`, import.meta.url), 'utf8'));
const raw = read('spells.json');
const spells: Array<{ index: string; name: string; desc: string; higherLevel: string | null }> = Array.isArray(raw) ? raw : raw.spells;
const ru: Record<string, { name: string; desc: string; higherLevel?: string }> = read('spells.ru.json');

test('every SRD spell has a Russian name and text', () => {
  const missing = spells.filter(spell => !ru[spell.index]?.name || !ru[spell.index]?.desc?.trim()).map(spell => spell.index);
  assert.deepEqual(missing, []);
  assert.deepEqual(Object.keys(ru).filter(index => !spells.some(spell => spell.index === index)), [], 'no stray entries');
});

test('names are unique; «at higher levels» is there exactly when SRD has it; Latin only in dice', () => {
  const names = Object.values(ru).map(entry => entry.name);
  assert.equal(new Set(names).size, names.length, 'two spells with one Russian name');
  for (const spell of spells) {
    const entry = ru[spell.index]!;
    assert.equal(Boolean(entry.higherLevel), Boolean(spell.higherLevel), spell.index);
    for (const text of [entry.name, entry.desc, entry.higherLevel ?? '']) {
      assert.equal(/[A-Za-z]{2,}/.test(text.replace(/\b\d*d\d+\b/g, '')), false, `${spell.index}: ${text.slice(0, 80)}`);
    }
  }
});

test('names follow dnd.su', () => {
  assert.deepEqual(
    ['healing-word', 'guidance', 'sleep', 'thunderwave', 'hideous-laughter', 'arcane-hand'].map(index => ru[index]!.name),
    ['Лечащее слово', 'Указание', 'Усыпление', 'Волна грома', 'Жуткий смех', 'Магическая длань'],
  );
});
