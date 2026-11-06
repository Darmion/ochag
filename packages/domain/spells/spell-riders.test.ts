import { test } from 'node:test';
import assert from 'node:assert/strict';
import spells from '../srd/spells.json' with { type: 'json' };
import { distributeShots, hitPointPool, projectileCount, projectileRule, sleepers, spellCylinderFeet, spellRiders, targetLimit } from './spell-riders.ts';
import { bardicDie, destroyUndeadCr, unarmoredAfterLevel, unarmoredDefense } from '../character/class-features.ts';
import { mergedClassResources } from '../srd/progression.ts';

const list = (Array.isArray(spells) ? spells : (spells as any).spells) as Array<{ index: string; level: number; desc: string; higherLevel?: string | null }>;
const spell = (index: string) => list.find(entry => entry.index === index)!;
const kinds = (index: string) => spellRiders(spell(index).desc).map(rider => rider.kind);

test('effects beyond damage, read from the SRD text', () => {
  assert.deepEqual(spellRiders(spell('ray-of-frost').desc), [{ kind: 'slowed', feet: 10, expires: 'caster-start' }]);
  assert.deepEqual(kinds('shocking-grasp'), ['no_reactions']);
  assert.deepEqual(kinds('chill-touch'), ['no_healing']);
  assert.deepEqual(kinds('guiding-bolt'), ['guided']);
  assert.deepEqual(kinds('vicious-mockery'), ['mocked']);
  assert.deepEqual(spellRiders(spell('bless').desc), [{ kind: 'blessed', die: 4 }]);
  assert.deepEqual(spellRiders(spell('bane').desc), [{ kind: 'baned', die: 4 }]);
  assert.deepEqual(spellRiders(spell('hunters-mark').desc), [{ kind: 'marked', dice: '1d6' }]);
  assert.deepEqual(kinds('faerie-fire'), ['outlined', 'light'], 'outlined and glowing (dim 10 ft)');
  assert.deepEqual(spellRiders(spell('thunderwave').desc), [{ kind: 'push', feet: 10 }]);
  assert.deepEqual(kinds('fireball'), [], 'plain damage');
});

test('light from the SRD text: radii, the torch, the daylight sphere, dim-only lights', () => {
  const light = (index: string) => spellRiders(spell(index).desc).find(rider => rider.kind === 'light') ?? null;
  assert.deepEqual(light('light'), { kind: 'light', bright: 20, dim: 20, replaces: true }, 'recasting «Свет» puts out the old one');
  assert.deepEqual(light('produce-flame'), { kind: 'light', bright: 10, dim: 10, replaces: false });
  assert.deepEqual(light('flame-blade'), { kind: 'light', bright: 10, dim: 10, replaces: false });
  assert.deepEqual(light('fire-shield'), { kind: 'light', bright: 10, dim: 10, replaces: false });
  assert.deepEqual(light('continual-flame'), { kind: 'light', bright: 20, dim: 20, replaces: false }, 'as bright as a torch');
  assert.deepEqual(light('daylight'), { kind: 'light', bright: 60, dim: 60, replaces: false });
  assert.deepEqual(light('dancing-lights'), { kind: 'light', bright: 0, dim: 10, replaces: false });
  assert.deepEqual(light('faerie-fire'), { kind: 'light', bright: 0, dim: 10, replaces: false });
  for (const index of ['flaming-sphere', 'moonbeam', 'guiding-bolt', 'branding-smite', 'holy-aura', 'hallow', 'symbol', 'fireball']) {
    assert.equal(light(index), null, `${index}: not the target's own light`);
  }
});

test('darkness and daylight from the SRD text', () => {
  assert.deepEqual(spellRiders(spell('darkness').desc), [{ kind: 'darkness', radius: 15, dispelsLight: 2 }]);
  assert.deepEqual(spellRiders(spell('daylight').desc).map(rider => rider.kind), ['light', 'dispel_darkness']);
  assert.deepEqual(spellRiders(spell('daylight').desc).find(rider => rider.kind === 'dispel_darkness'), { kind: 'dispel_darkness', upTo: 3 });
  assert.deepEqual(kinds('hallow'), [], 'its light is not a sphere of its own');
});

test('cylinder heights from the SRD text', () => {
  assert.deepEqual(['flame-strike', 'ice-storm', 'moonbeam', 'sleet-storm', 'reverse-gravity', 'call-lightning', 'fireball'].map(index => spellCylinderFeet(spell(index).desc)), [40, 40, 40, 20, 100, null, null]);
});

test('projectiles: rays, darts and beams', () => {
  const ray = projectileRule(spell('scorching-ray'))!;
  assert.deepEqual(ray, { base: 3, noun: 'ray', perSlotFrom: 2, byLevel: null });
  assert.deepEqual([2, 3, 5].map(slot => projectileCount(ray, slot, 5)), [3, 4, 6]);
  const dart = projectileRule(spell('magic-missile'))!;
  assert.deepEqual([1, 2, 4].map(slot => projectileCount(dart, slot, 3)), [3, 4, 6]);
  const beam = projectileRule(spell('eldritch-blast'))!;
  assert.deepEqual([1, 4, 5, 11, 17].map(level => projectileCount(beam, 0, level)), [1, 1, 2, 3, 4]);
  assert.equal(projectileRule(spell('fire-bolt')), null);
  assert.deepEqual(distributeShots(3, ['a']), ['a', 'a', 'a']);
  assert.deepEqual(distributeShots(3, ['a', 'b']), ['a', 'b', 'a']);
  assert.deepEqual(distributeShots(3, ['a', 'b'], ['b', 'b']), ['b', 'b'], 'fewer shots than allowed — as chosen');
  assert.deepEqual(distributeShots(2, ['a'], ['a', 'a', 'a']), { error: 'Снарядов всего 2, а назначено 3.' });
  assert.deepEqual(distributeShots(2, ['a'], ['c']), { error: 'Снаряд назначен не выбранной цели.' });
});

test('target limits and the sleep pool', () => {
  assert.deepEqual([1, 2, 3].map(slot => targetLimit(spell('bless'), slot)), [3, 4, 5]);
  assert.equal(targetLimit(spell('fireball'), 3), null);
  assert.deepEqual(hitPointPool(spell('sleep')), { dice: '5d8', perSlot: '2d8' });
  const chosen = sleepers(20, [
    { id: 'big', hp: 15 }, { id: 'small', hp: 5 }, { id: 'zombie', hp: 3, immune: true }, { id: 'mid', hp: 12 }, { id: 'out', hp: 0 },
  ]).map(entry => entry.id);
  assert.deepEqual(chosen, ['small', 'mid'], 'lowest first; the 15 no longer fits; the undead and the fallen do not count');
});

test('class numbers: bardic die, destroy undead, unarmored defence once, merged resources', () => {
  assert.deepEqual([1, 4, 5, 9, 10, 15, 20].map(bardicDie), [6, 6, 8, 8, 10, 12, 12]);
  assert.deepEqual([4, 5, 8, 11, 14, 17].map(destroyUndeadCr), [null, 0.5, 1, 2, 3, 4]);
  const scores = { dexterity: 14, constitution: 16, wisdom: 12 };
  assert.deepEqual(unarmoredDefense([{ id: 'barbarian', level: 3 }, { id: 'monk', level: 1 }], scores), { classId: 'barbarian', ability: 'constitution', shield: true, ac: 15 });
  assert.equal(unarmoredDefense([{ id: 'monk', level: 2 }, { id: 'barbarian', level: 1 }], scores)!.ac, 13, 'the first class decides');
  assert.equal(unarmoredDefense([{ id: 'wizard', level: 2 }], scores), null);
  const grown = { dexterity: 14, constitution: 18, wisdom: 12 };
  const barbarian = [{ id: 'barbarian' as const, level: 4 }];
  assert.equal(unarmoredAfterLevel({ ac: 15, before: { classes: barbarian, scores }, after: { classes: barbarian, scores: grown } }), 16);
  assert.equal(unarmoredAfterLevel({ ac: 17, before: { classes: barbarian, scores }, after: { classes: barbarian, scores: grown } }), 18, 'with a shield');
  assert.equal(unarmoredAfterLevel({ ac: 18, before: { classes: barbarian, scores }, after: { classes: barbarian, scores: grown } }), null, 'armour or magic — left alone');
  const wizard = [{ id: 'wizard' as const, level: 3 }];
  assert.equal(unarmoredAfterLevel({ ac: 12, before: { classes: wizard, scores }, after: { classes: [...wizard, { id: 'barbarian', level: 1 }], scores } }), 15);
  assert.equal(unarmoredAfterLevel({ ac: 15, before: { classes: barbarian, scores }, after: { classes: [...barbarian, { id: 'monk', level: 1 }], scores } }), null, 'no second unarmored defence');
  const merged = mergedClassResources([{ id: 'cleric', level: 6 }, { id: 'paladin', level: 3 }], { charisma: 1 });
  assert.equal(merged.filter(rule => rule.name === 'Божественный канал').length, 1);
  assert.equal(merged.find(rule => rule.name === 'Божественный канал')!.max, 2);
});

test('more text: temporary hit points, heroism, a bonus to AC, sanctuary; monk dice, wild shape limits, protection style', async () => {
  const { tempHpPerSlot } = await import('./spell-riders.ts');
  const { martialArtsDie, wildShapeLimit, hasProtectionStyle } = await import('../character/class-features.ts');
  assert.deepEqual(spellRiders(spell('false-life').desc), [{ kind: 'temp_hp', dice: '1d4+4', perSlot: 0 }]);
  assert.equal(tempHpPerSlot(spell('false-life').higherLevel), 5);
  assert.deepEqual(kinds('heroism'), ['heroism']);
  assert.deepEqual(spellRiders(spell('shield-of-faith').desc), [{ kind: 'ac_bonus', bonus: 2 }]);
  assert.deepEqual(kinds('sanctuary'), ['sanctuary']);
  assert.deepEqual(kinds('shield'), [], 'the Shield reaction is its own thing');
  assert.deepEqual([1, 4, 5, 10, 11, 17].map(martialArtsDie), [4, 4, 6, 6, 8, 10]);
  assert.deepEqual([2, 4, 8].map(level => wildShapeLimit(level).cr), [0.25, 0.5, 1]);
  assert.equal(wildShapeLimit(2).swim, false);
  assert.equal(hasProtectionStyle({ builder: { fightingStyle: 'protection' } }), true);
  assert.equal(hasProtectionStyle({ text: { levels: { value: 'Уровень 2. Боевой стиль: Защита — со щитом…' } } }), true);
  assert.equal(hasProtectionStyle({ builder: { fightingStyle: 'defense' } }), false);
});

test('aid and mage armor from the text; the ki save DC; monk features by level', async () => {
  const { aidPerSlot } = await import('./spell-riders.ts');
  const { kiSaveDc, classFeatures } = await import('../character/class-features.ts');
  assert.deepEqual(spellRiders(spell('aid').desc), [{ kind: 'aid', bonus: 5 }]);
  assert.equal(aidPerSlot(spell('aid').higherLevel), 5);
  assert.deepEqual(spellRiders(spell('mage-armor').desc), [{ kind: 'mage_armor', base: 13 }]);
  assert.equal(kiSaveDc(3, 3), 14);
  assert.ok(classFeatures('monk', 3).some(feature => feature.id === 'deflect-missiles'));
  assert.ok(!classFeatures('monk', 4).some(feature => feature.id === 'stunning-strike'));
  assert.ok(classFeatures('monk', 5).some(feature => feature.id === 'stunning-strike'));
});

test('dispel magic and lesser restoration from the text; the Champion crit range; warlock invocations', async () => {
  const { deriveSpellMechanics } = await import('./spell-mechanics.ts');
  const { critRange, knownInvocations, classFeatures } = await import('../character/class-features.ts');
  const { attackOutcome } = await import('../combat/conditions.ts');
  const { hitChance } = await import('../dice/dice.ts');
  assert.deepEqual(spellRiders(spell('dispel-magic').desc), [{ kind: 'dispel', upTo: 3 }]);
  assert.deepEqual(spellRiders(spell('lesser-restoration').desc), [{ kind: 'restore', conditions: ['blinded', 'deafened', 'paralyzed', 'poisoned'] }]);
  const restoration = spell('lesser-restoration') as any;
  assert.equal(deriveSpellMechanics(restoration).condition, null, 'it ends conditions, it does not blind');
  assert.equal(deriveSpellMechanics(spell('blindness-deafness') as any).condition, 'blinded');

  assert.deepEqual([[], [{ id: 'fighter', level: 2 }], [{ id: 'fighter', level: 3 }], [{ id: 'fighter', level: 15 }], [{ id: 'rogue', level: 9 }]].map(classes => critRange(classes as any)), [20, 20, 19, 18, 20]);
  assert.deepEqual(attackOutcome(19, 19, 30, false, 19), { hit: true, critical: true });
  assert.deepEqual(attackOutcome(19, 19, 30, false), { hit: false, critical: false });
  assert.equal(hitChance(0, 30, 'none', 19), 0.1);
  assert.equal(hitChance(0, 30, 'none', 18), 0.15);

  assert.deepEqual(knownInvocations({ invocations: ['repelling-blast'] }), ['repelling-blast']);
  assert.deepEqual(knownInvocations({ text: { features: { value: 'Воззвания: Мучительный взрыв, Дьявольское зрение' } } }), ['agonizing-blast', 'devils-sight'], 'from an LSS sheet');
  assert.deepEqual(knownInvocations({ invocations: [], text: { features: { value: 'Мучительный взрыв' } } }), [], 'marked — the text no longer counts');
  assert.ok(classFeatures('rogue', 5).some(feature => feature.id === 'uncanny-dodge'));
  assert.ok(classFeatures('rogue', 7).some(feature => feature.id === 'evasion'));
  assert.ok(classFeatures('monk', 7).some(feature => feature.id === 'evasion-monk'));
  assert.ok(classFeatures('warlock', 2).some(feature => feature.id === 'eldritch-invocations'));
  assert.ok(classFeatures('fighter', 3).some(feature => feature.id === 'improved-critical'));
});

test('one-creature spells for Twinned Spell; metamagic, the aura of protection, arcane recovery; barbarian 2', async () => {
  const { singleTarget } = await import('./spell-riders.ts');
  const { arcaneRecoveryProblem, auraOfProtection, classFeatures, knownMetamagic, metamagicCost } = await import('../character/class-features.ts');
  const one = (index: string, slot?: number) => singleTarget(spell(index) as any, spell(index).level, slot ?? spell(index).level);
  for (const index of ['fire-bolt', 'hold-person', 'haste', 'cure-wounds', 'healing-word', 'invisibility', 'dispel-magic', 'polymorph']) assert.ok(one(index), index);
  for (const index of ['fireball', 'bless', 'magic-missile', 'scorching-ray', 'eldritch-blast', 'acid-splash', 'chain-lightning', 'shield', 'sleep', 'wall-of-stone', 'mass-healing-word']) assert.ok(!one(index), index);
  assert.ok(!one('hold-person', 3), 'one more humanoid at 3rd level — not twinnable');

  assert.deepEqual([metamagicCost('quickened', 5), metamagicCost('twinned', 0), metamagicCost('twinned', 3)], [2, 1, 3]);
  assert.deepEqual(knownMetamagic({ metamagic: ['twinned'] }), ['twinned']);
  assert.deepEqual(knownMetamagic({ text: { features: { value: 'Метамагия: Ускоренное заклинание, Осторожное заклинание' } } }), ['quickened', 'careful']);

  assert.equal(auraOfProtection([{ id: 'paladin', level: 5 }], 3), null);
  assert.deepEqual(auraOfProtection([{ id: 'paladin', level: 6 }], 3), { feet: 10, bonus: 3 });
  assert.deepEqual(auraOfProtection([{ id: 'paladin', level: 18 }], -1), { feet: 30, bonus: 1 }, 'at least +1');

  assert.equal(arcaneRecoveryProblem(5, [2, 1]), null);
  assert.match(arcaneRecoveryProblem(5, [3, 1])!, /больше 3/);
  assert.match(arcaneRecoveryProblem(20, [6])!, /6-го/);
  assert.deepEqual(classFeatures('barbarian', 2).map(feature => feature.id), ['rage', 'reckless-attack', 'danger-sense', 'unarmored-defense']);
  assert.ok(classFeatures('paladin', 6).some(feature => feature.id === 'aura-of-protection'));
  assert.ok(classFeatures('sorcerer', 3).some(feature => feature.id === 'metamagic'));
  assert.ok(!classFeatures('sorcerer', 2).some(feature => feature.id === 'metamagic'));
});

test('round 27: haste, slow and the stupor of hypnotic pattern by their SRD text', () => {
  assert.deepEqual(spellRiders("the target's speed is doubled, it gains a +2 bonus to AC, it has advantage on dexterity saving throws").map(rider => rider.kind), ['hasted']);
  assert.deepEqual(spellRiders("An affected target's speed is halved, it takes a -2 penalty to AC and dexterity saving throws, and it can't use reactions.").map(rider => rider.kind), ['slow_spell']);
  assert.deepEqual(spellRiders('While charmed by this spell, the creature is incapacitated and has a speed of 0.').map(rider => rider.kind), ['stupor']);
});
