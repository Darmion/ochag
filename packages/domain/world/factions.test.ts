import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanBonuses, cleanRestrictions, cleanRights, effectiveFactions, factionBonus, pairKey, relationBetween, restrictedBetween, sharedRight,
  type FactionInfo, type FactionPair,
} from './factions.ts';
import {groupFrom, nextGroup} from '../combat/turn-groups.ts';

const system = {party: 'party', enemies: 'enemies'};
const pairs = (entries: Array<[string, string, FactionPair['relation'], string[]?]>) =>
  new Map(entries.map(([a, b, relation, restrictions = []]) => [pairKey(a, b), {relation, restrictions}]));

test('effective factions: own groups first, otherwise by kind and disposition', () => {
  assert.deepEqual(effectiveFactions([], {kind: 'character', disposition: null}, system), ['party']);
  assert.deepEqual(effectiveFactions([], {kind: 'npc', disposition: 'friendly'}, system), ['party']);
  assert.deepEqual(effectiveFactions([], {kind: 'npc', disposition: 'hostile'}, system), ['enemies']);
  assert.deepEqual(effectiveFactions([], {kind: 'npc', disposition: 'neutral'}, system), []);
  assert.deepEqual(effectiveFactions([], {kind: 'object', disposition: null}, system), []);
  assert.deepEqual(effectiveFactions(['cult'], {kind: 'character', disposition: null}, system), ['cult'], 'own groups replace the default');
});

test('relations: a shared group makes allies, an enemy pair wins over an allied one', () => {
  const matrix = pairs([['party', 'enemies', 'enemy'], ['party', 'guild', 'ally'], ['guild', 'cult', 'enemy']]);
  assert.equal(relationBetween(['party'], ['party'], matrix), 'ally');
  assert.equal(relationBetween(['party'], ['enemies'], matrix), 'enemy');
  assert.equal(relationBetween(['party'], ['guild'], matrix), 'ally');
  assert.equal(relationBetween(['party'], ['cult'], matrix), 'neutral', 'no pair — neutral');
  assert.equal(relationBetween([], ['party'], matrix), 'neutral', 'no groups — neutral to everyone');
  assert.equal(relationBetween(['party', 'cult'], ['party'], matrix), 'ally');
  assert.equal(relationBetween(['party', 'cult'], ['cult'], matrix), 'ally');
  assert.equal(relationBetween(['party', 'guild'], ['cult'], matrix), 'enemy');
  assert.equal(relationBetween(['enemies'], ['party'], matrix), 'enemy', 'order does not matter');
});

test('restrictions and rights between creatures', () => {
  const matrix = pairs([['party', 'guild', 'neutral', ['block-passage', 'no-trade']]]);
  assert.equal(restrictedBetween(['party'], ['guild'], matrix, 'no-trade'), true);
  assert.equal(restrictedBetween(['guild'], ['party', 'cult'], matrix, 'block-passage'), true);
  assert.equal(restrictedBetween(['party'], ['guild'], matrix, 'no-opportunity'), false);
  assert.equal(restrictedBetween(['party'], ['party'], matrix, 'no-trade'), false, 'not within one group');

  const factions = new Map<string, FactionInfo>([
    ['party', {id: 'party', name: 'Отряд', system: 'party', rights: ['shared-vision', 'see-hp'], bonuses: [{kind: 'attack', value: 1}]}],
    ['guild', {id: 'guild', name: 'Гильдия', system: null, rights: ['control'], bonuses: [{kind: 'attack', value: 2}, {kind: 'ac', value: -1}]}],
  ]);
  assert.equal(sharedRight(['party'], ['party', 'guild'], factions, 'see-hp'), true);
  assert.equal(sharedRight(['party'], ['guild'], factions, 'see-hp'), false, 'no shared group');
  assert.equal(sharedRight(['party', 'guild'], ['guild'], factions, 'see-hp'), false, 'the shared group lacks the right');
  assert.deepEqual(factionBonus(['party', 'guild'], factions, 'attack'), {value: 3, reasons: ['фракция «Отряд» +1', 'фракция «Гильдия» +2']});
  assert.deepEqual(factionBonus(['guild'], factions, 'ac'), {value: -1, reasons: ['фракция «Гильдия» -1']});
  assert.deepEqual(factionBonus(['party'], factions, 'save'), {value: 0, reasons: []});
});

test('cleaning rights, restrictions and bonuses', () => {
  assert.deepEqual(cleanRights(['control', 'nonsense', 'shared-vision']), ['shared-vision', 'control']);
  assert.deepEqual(cleanRestrictions(['no-trade', 'x']), ['no-trade']);
  assert.deepEqual(cleanBonuses([{kind: 'attack', value: 2}, {kind: 'attack', value: 5}, {kind: 'ac', value: 30}, {kind: 'luck', value: 1}, {kind: 'save', value: 0}]),
    [{kind: 'attack', value: 2}, {kind: 'ac', value: 10}]);
  assert.deepEqual(cleanBonuses('nope'), []);
});

test('group turns by allies: every newcomer must be allied with the whole group', () => {
  const groups = [['party'], ['party', 'guild'], ['guild'], ['cult'], ['cult']];
  const matrix = pairs([['party', 'cult', 'enemy']]);
  const sides = groups.map(() => null);
  const allied = (i: number, j: number) => relationBetween(groups[i]!, groups[j]!, matrix) === 'ally';
  assert.deepEqual(groupFrom(sides, 0, true, allied), [0, 1], 'party, then party+guild; the guild alone is not allied with the party member');
  assert.deepEqual(groupFrom(sides, 2, true, allied), [2], 'guild and cult — neutral');
  assert.deepEqual(groupFrom(sides, 3, true, allied), [3, 4]);
  assert.deepEqual(nextGroup(sides, [0, 1], true, allied), {indices: [2], wrapped: false});
  assert.deepEqual(nextGroup(sides, [3, 4], true, allied), {indices: [0, 1], wrapped: true});
  assert.deepEqual(groupFrom(sides, 0, false, allied), [0], 'group turns off');
});
