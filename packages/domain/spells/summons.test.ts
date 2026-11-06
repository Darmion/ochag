import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findMonster} from '../world/bestiary.ts';
import {
  CONJURE_OPTIONS, FAMILIAR_FORMS, STEED_FORMS, conjureCount, polymorphLimit, shapeForms, shapeProblem, spellShape, spellSummon, summonProblem,
} from './summons.ts';

test('every familiar and steed form is in the bestiary', () => {
  for (const index of [...FAMILIAR_FORMS, ...STEED_FORMS]) assert.ok(findMonster(index), index);
  assert.equal(findMonster('owl')!.speedNote, 'летая 60 фт.');
});

test('summons: forms, concentration, how many animals', () => {
  assert.deepEqual(spellSummon('find-familiar'), {kind: 'familiar', forms: FAMILIAR_FORMS, concentration: false});
  assert.equal(spellSummon('find-steed')!.kind, 'steed');
  const conjure = spellSummon('conjure-animals')!;
  assert.equal(conjure.concentration, true);
  assert.ok(conjure.forms.includes('wolf') && conjure.forms.includes('polar-bear') && !conjure.forms.includes('giant-scorpion'), 'beasts up to CR 2');
  assert.equal(spellSummon('fireball'), null);
  assert.equal(CONJURE_OPTIONS.length, 4);
  assert.deepEqual([conjureCount(0, 3), conjureCount(1, 3), conjureCount(2, 4), conjureCount(3, 3)], [1, 2, 4, 8]);
  assert.deepEqual([conjureCount(3, 5), conjureCount(0, 7), conjureCount(1, 9)], [16, 3, 8], 'higher slots: x2, x3, x4');
  assert.equal(conjureCount(7, 3), null);
});

test('what may be summoned', () => {
  const conjure = spellSummon('conjure-animals')!;
  assert.equal(summonProblem(conjure, findMonster('wolf'), 3), null, 'eight wolves of CR 1/4');
  assert.match(summonProblem(conjure, findMonster('brown-bear'), 2)!, /1\/2/, 'a brown bear is CR 1');
  assert.match(summonProblem(conjure, findMonster('wolf'), null)!, /сколько/);
  assert.match(summonProblem(spellSummon('find-familiar')!, findMonster('wolf'), null)!, /формы/);
  assert.equal(summonProblem(spellSummon('find-steed')!, findMonster('warhorse'), null), null);
});

test('shapes: polymorph up to the target CR or level, animal shapes up to CR 4 and Large', () => {
  const polymorph = spellShape('polymorph')!;
  assert.equal(polymorphLimit({challenge_rating: '0.250', level: null}), 0.25);
  assert.equal(polymorphLimit({challenge_rating: null, level: 5}), 5);
  assert.equal(shapeProblem(polymorph, findMonster('brown-bear'), {challenge_rating: null, level: 3}), null);
  assert.match(shapeProblem(polymorph, findMonster('polar-bear'), {challenge_rating: 1, level: null})!, /выше/);
  assert.match(shapeProblem(polymorph, findMonster('goblin'), {level: 5})!, /облика/, 'beasts only');
  const animal = spellShape('animal-shapes')!;
  assert.ok(shapeForms(animal).every(beast => beast.cr <= 4 && beast.size !== 'huge'));
  assert.ok(!shapeForms(animal).some(beast => beast.index === 'giant-elk'), 'Huge is too big');
  assert.equal(spellShape('fireball'), null);
});
