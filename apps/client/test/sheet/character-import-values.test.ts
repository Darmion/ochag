import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProposal, differs, display, parseFieldValue } from '../../src/characterImport/values.ts';
import type { Draft } from '../../src/characterImport/types.ts';

const draft = (current: Record<string, any> | null): Draft => ({
  id: 'd1',
  draft_revision: 1,
  proposed_document: {},
  field_mapping: [
    { key: 'name', label: 'Имя', sourcePath: 'name.value', sourceValue: 'Лиена' },
    { key: 'speed_feet', label: 'Скорость', sourcePath: 'vitality.speed.value', sourceValue: 30 },
  ],
  warnings: [],
  current,
});

test('parseFieldValue keeps the name as text and reads the rest as numbers', () => {
  assert.equal(parseFieldValue('name', '12'), '12');
  assert.equal(parseFieldValue('name', ''), '');
  assert.equal(parseFieldValue('speed_feet', '32.5'), 32.5);
  assert.equal(parseFieldValue('speed_feet', ''), null);
});

test('display shows missing values, text as is and the rest as JSON', () => {
  assert.equal(display(null), 'Не указано');
  assert.equal(display(undefined), 'Не указано');
  assert.equal(display('Лиена'), 'Лиена');
  assert.equal(display(0), '0');
  assert.equal(display({ a: 1 }), '{"a":1}');
});

test('differs compares the final value with the current one', () => {
  const update = draft({ name: 'Лира', speed_feet: 30 });
  assert.equal(differs(draft(null), { name: 'Лира' }, {}, 'name'), false);
  assert.equal(differs(update, { name: 'Лира' }, {}, 'name'), false);
  assert.equal(differs(update, { name: 'Лиена' }, {}, 'name'), true);
  assert.equal(differs(update, { name: 'Лиена' }, { name: true }, 'name'), false);
});

test('buildProposal takes kept fields and extras from the current character', () => {
  const update = draft({ name: 'Лира', speed_feet: 25, sheet_extra: { old: true } });
  const proposal = { name: 'Лиена', speed_feet: 30, sheet_extra: { unused: true } };
  const kept = buildProposal(update, proposal, { name: true }, true, { fresh: true });
  assert.deepEqual(kept, { name: 'Лира', speed_feet: 30, sheet_extra: { old: true } });
  assert.deepEqual(buildProposal(update, proposal, {}, false, { fresh: true }), { name: 'Лиена', speed_feet: 30, sheet_extra: { fresh: true } });
  assert.equal(proposal.name, 'Лиена');
});

test('buildProposal ignores the keep flags of a new character', () => {
  const result = buildProposal(draft(null), { name: 'Лиена' }, { name: true }, true, { fresh: true });
  assert.deepEqual(result, { name: 'Лиена', sheet_extra: { fresh: true } });
});
