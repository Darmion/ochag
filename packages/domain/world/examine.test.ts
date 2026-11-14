import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDcs, defaultExamine, defaultExamineSkill, partDc, revealedParts } from './examine.ts';

test('the usual knowledge skill by creature type; objects take Investigation', () => {
  assert.deepEqual(['undead', 'beast', 'dragon', 'humanoid', null].map(type => defaultExamineSkill(false, type)), ['religion', 'nature', 'arcana', 'history', 'investigation']);
  assert.equal(defaultExamineSkill(true, null), 'investigation');
  assert.deepEqual(defaultExamine(true, null), { skill: 'investigation', dc: 10, dcs: {}, text: '' });
});

test('a part takes the GM\'s own DC, or the base DC with its usual offset; one roll opens what it meets', () => {
  const settings = { skill: 'arcana', dc: 14, dcs: cleanDcs({ hp: 20, ac: 'x', text: 0, defenses: null }), text: '' };
  assert.deepEqual(settings.dcs, { hp: 20 }, 'only whole DCs from 1 to 40 are kept');
  assert.deepEqual([partDc(settings, 'kind'), partDc(settings, 'hp'), partDc(settings, 'abilities'), partDc(settings, 'defenses')], [9, 20, 16, 19]);
  assert.deepEqual(revealedParts(settings, 15), ['kind', 'ac', 'conditions', 'text']);
  assert.deepEqual(revealedParts(settings, 8), []);
});
