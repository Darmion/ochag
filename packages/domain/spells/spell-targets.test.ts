import {test} from 'node:test';
import assert from 'node:assert/strict';
import {creatureTypeFromText, spellTargetRules, targetTypeProblem} from './spell-targets.ts';

test('creature types from the bestiary text and the sheet', () => {
  assert.equal(creatureTypeFromText('гуманоид (гоблиноид)'), 'humanoid');
  assert.equal(creatureTypeFromText('нежить'), 'undead');
  assert.equal(creatureTypeFromText('зверь'), 'beast');
  assert.equal(creatureTypeFromText('undead'), 'undead');
  assert.equal(creatureTypeFromText('Humanoid (elf)'), 'humanoid');
  assert.equal(creatureTypeFromText(''), null);
  assert.equal(creatureTypeFromText('нечто'), null);
});

test('what a spell text asks of its target', () => {
  assert.deepEqual(spellTargetRules('Choose a humanoid that you can see within range. The target must succeed on a wisdom saving throw'), {only: 'humanoid', excluded: [], mustSee: true});
  assert.deepEqual(spellTargetRules('A creature you touch regains a number of hit points. This spell has no effect on undead or constructs.'), {only: null, excluded: ['undead', 'construct'], mustSee: false});
  assert.deepEqual(spellTargetRules('This spell lets you convince a beast that you mean it no harm.'), {only: 'beast', excluded: [], mustSee: false});
  assert.deepEqual(spellTargetRules('You hurl a mote of fire at a creature or object within range.'), {only: null, excluded: [], mustSee: false});
  assert.equal(spellTargetRules('Выберите гуманоида, которого вы видите в пределах дистанции.').only, 'humanoid', 'own spells in Russian');
  assert.equal(spellTargetRules('Выберите гуманоида, которого вы видите в пределах дистанции.').mustSee, true);
  const hold = spellTargetRules('Choose a humanoid that you can see within range.');
  assert.match(targetTypeProblem(hold, 'beast')!, /только на гуманоида, а это зверь/);
  assert.equal(targetTypeProblem(hold, 'humanoid'), null);
  assert.equal(targetTypeProblem(hold, null), null, 'unknown type — allowed');
  assert.match(targetTypeProblem(spellTargetRules('no effect on undead or constructs'), 'undead')!, /не действует на нежить и конструкт/);
});
