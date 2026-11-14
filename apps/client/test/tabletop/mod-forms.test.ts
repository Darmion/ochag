import assert from 'node:assert/strict';
import { test } from 'node:test';

import { modFormBody, modFormDefaults, modFormIcon, modFormPath, modFormProblems, type ModForm } from '../../src/campaign/modForms.ts';

const form: ModForm = {
  id: 'ash-whirl', modId: 'ash-folk', modName: 'Пепельный народ', title: 'Пепельный вихрь', description: '', icon: 'fog',
  who: 'gm', scope: 'campaign', submit: 'Поднять вихрь',
  fields: [
    { key: 'target', label: 'Кого обжечь', hint: '', type: 'character', who: 'any', required: true, default: null },
    { key: 'dice', label: 'Сила вихря', hint: '', type: 'select', options: [{ value: '1d6', label: '1d6' }, { value: '2d6', label: '2d6' }], required: false, default: '2d6' },
    { key: 'rounds', label: 'Раунды', hint: '', type: 'number', min: 1, max: 5, step: 1, required: false, default: null },
    { key: 'note', label: 'Заметка', hint: '', type: 'text', maxLength: 20, placeholder: '', required: false, default: '' },
  ],
};

test('a mod window starts from its defaults and names what is still missing', () => {
  const values = modFormDefaults(form);
  assert.deepEqual(values, { target: null, dice: '2d6', rounds: null, note: '' });
  assert.deepEqual(modFormProblems(form, values), ['Кого обжечь']);
  assert.deepEqual(modFormProblems(form, { ...values, target: 'id-1', rounds: 9 }), ['Раунды'], 'a number outside its range');
  assert.deepEqual(modFormProblems(form, { ...values, target: 'id-1' }), []);
});

test('the request body drops empty values and adds the figure only for a creature window', () => {
  assert.deepEqual(modFormBody(form, { target: 'id-1', dice: '1d6', rounds: null, note: '' }, 'hero'), { target: 'id-1', dice: '1d6' });
  assert.deepEqual(modFormBody({ ...form, scope: 'character', fields: [] }, {}, 'hero'), { characterId: 'hero' });
  assert.equal(modFormPath('camp', form), '/campaigns/camp/mods/ash-folk/forms/ash-whirl');
});

test('an unknown icon falls back to the mods icon', () => {
  assert.equal(modFormIcon(form), 'fog');
  assert.equal(modFormIcon({ icon: 'dragonHead3000' }), 'puzzle');
  assert.equal(modFormIcon({ icon: '' }), 'puzzle');
});
