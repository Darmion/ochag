import {test} from 'node:test';
import assert from 'node:assert/strict';
import {aimedSpellArea, bestAreaPlacement, spellArea} from './area-placement.ts';

test('spell areas from the SRD text', () => {
  assert.deepEqual(spellArea('Each creature in a 20-foot-radius sphere centered on that point must make a dexterity saving throw.', '150 feet'),
    {shape: 'circle', sizeFeet: 20, widthFeet: null, fromSelf: false});
  assert.deepEqual(spellArea('Each creature in a 15-foot cone must make a dexterity saving throw.', 'Self'), {shape: 'cone', sizeFeet: 15, widthFeet: null, fromSelf: true});
  assert.deepEqual(spellArea('A wave of thunderous force sweeps out from you. Each creature in a 15-foot cube originating from you', 'Self'),
    {shape: 'square', sizeFeet: 15, widthFeet: null, fromSelf: true});
  assert.deepEqual(spellArea('A stroke of lightning forming a line 100 feet long and 5 feet wide blasts out from you', 'Self'),
    {shape: 'line', sizeFeet: 100, widthFeet: 5, fromSelf: true});
  assert.equal(spellArea('You hurl a mote of fire at a creature or object within range.', '120 feet'), null);
});

test('the area a player aims: not attacks, single targets, light or darkness', () => {
  const none = {attack: false, single: false, riders: [] as string[]};
  assert.deepEqual(aimedSpellArea({desc: 'Each creature in a 20-foot-radius sphere centered on that point', range: '150 feet'}, none),
    {shape: 'circle', sizeFeet: 20, widthFeet: null, fromSelf: false});
  assert.equal(aimedSpellArea({desc: 'You touch one object. It sheds bright light in a 20-foot radius', range: 'Touch'}, {...none, riders: ['light']}), null);
  assert.equal(aimedSpellArea({desc: 'Magical darkness spreads from a point you choose within range to fill a 15-foot-radius sphere', range: '60 feet'}, {...none, riders: ['darkness']}), null);
  assert.equal(aimedSpellArea({desc: 'Make a ranged spell attack. On a hit the target and each creature within a 5-foot radius', range: '60 feet'}, {...none, attack: true}), null);
  assert.equal(aimedSpellArea({desc: 'A creature of your choice within a 10-foot radius', range: '30 feet'}, {...none, single: true}), null);
  assert.equal(aimedSpellArea({desc: 'You hurl a mote of fire at a creature or object within range.', range: '120 feet'}, none), null);
});

test('the best place: the most enemies, no allies', () => {
  const dims = {widthCells: 20, heightCells: 20};
  const caster = {id: 'mage', x: -8.5, z: 0.5, size: 'medium'};
  const bodies = [
    {id: 'a', x: 3.5, z: 0.5, size: 'medium', side: 'enemy' as const},
    {id: 'b', x: 4.5, z: 1.5, size: 'medium', side: 'enemy' as const},
    {id: 'c', x: 5.5, z: 0.5, size: 'medium', side: 'enemy' as const},
    {id: 'far', x: -6.5, z: 8.5, size: 'medium', side: 'enemy' as const},
    {id: 'friend', x: -7.5, z: 0.5, size: 'medium', side: 'ally' as const},
  ];
  const fireball = bestAreaPlacement({dims, feetPerUnit: 5, caster, area: {shape: 'circle', sizeFeet: 10, widthFeet: null, fromSelf: false}, rangeFeet: 150, bodies});
  assert.deepEqual(fireball?.enemies.sort(), ['a', 'b', 'c'], 'three in one blast');
  const near = bestAreaPlacement({dims, feetPerUnit: 5, caster, area: {shape: 'circle', sizeFeet: 10, widthFeet: null, fromSelf: false}, rangeFeet: 150,
    bodies: [{id: 'x', x: -5.5, z: 0.5, size: 'medium', side: 'enemy'}, {id: 'friend', x: -6.5, z: 0.5, size: 'medium', side: 'ally'}]});
  assert.equal(near, null, 'the only spot would hit the friend');
  assert.equal(bestAreaPlacement({dims, feetPerUnit: 5, caster, area: {shape: 'circle', sizeFeet: 10, widthFeet: null, fromSelf: false}, rangeFeet: 30, bodies: bodies.filter(b => b.id !== 'far')}), null);
  const cone = bestAreaPlacement({dims, feetPerUnit: 5, caster: {id: 'mage', x: 0.5, z: 0.5, size: 'medium'}, area: {shape: 'cone', sizeFeet: 15, widthFeet: null, fromSelf: true}, rangeFeet: null,
    bodies: [{id: 'a', x: 2.5, z: 0.5, size: 'medium', side: 'enemy'}, {id: 'b', x: 3.5, z: 0.5, size: 'medium', side: 'enemy'}, {id: 'friend', x: -1.5, z: 0.5, size: 'medium', side: 'ally'}]});
  assert.deepEqual(cone?.enemies.sort(), ['a', 'b']);
  assert.ok(cone!.direction < 45 || cone!.direction > 315, `facing +x: ${cone!.direction}`);
  const line = bestAreaPlacement({dims, feetPerUnit: 5, caster: {id: 'mage', x: 0.5, z: 0.5, size: 'medium'}, area: {shape: 'line', sizeFeet: 100, widthFeet: 5, fromSelf: true}, rangeFeet: null,
    bodies: [{id: 'a', x: 0.5, z: 3.5, size: 'medium', side: 'enemy'}, {id: 'b', x: 0.5, z: 7.5, size: 'medium', side: 'enemy'}, {id: 'c', x: 5.5, z: 0.5, size: 'medium', side: 'enemy'}]});
  assert.deepEqual(line?.enemies.sort(), ['a', 'b']);
});
