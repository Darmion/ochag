import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weaponCard } from '../../src/actionBar/weapons.ts';
import { attackUsingView } from '../../src/actionBar/attackView.ts';

const sword = { id: 'sword', name: 'Меч', ability: 'str', proficient: true, range_feet: 5, weapon_kind: 'melee' as const };
const bow = { id: 'bow', name: 'Лук', ability: 'dex', proficient: true, range_feet: 150, long_range_feet: 600, weapon_kind: 'ranged' as const };
const dagger = { id: 'dagger', name: 'Кинжал', ability: 'dex', proficient: true, range_feet: 5, thrown_range_feet: 20, long_range_feet: 60, weapon_kind: 'melee' as const };
const plain = { distance: null, option: null, blocked: false, preview: '', bonus: false };

test('weapon cards mark targets out of reach or at disadvantage', () => {
  assert.deepEqual(weaponCard(sword, plain), { weapon: sword, blocked: false, outOfRange: false, title: '', range: '5 фут.', preview: '', bonusNote: null });
  const far = weaponCard(sword, { ...plain, distance: 30 });
  assert.deepEqual([far.outOfRange, far.title, far.range], [true, 'Цель дальше 5 фут. — подойдите ближе', '5 фут. · далеко']);
  assert.equal(weaponCard(bow, { ...plain, distance: 200 }).range, '150/600 фут. · с помехой');
  assert.equal(weaponCard(bow, { ...plain, distance: 100 }).range, '150/600 фут.');
  assert.equal(weaponCard(dagger, { ...plain, distance: 30 }).range, '5 фут., бросок 20/60 · с помехой');
  assert.equal(weaponCard(dagger, { ...plain, distance: 15 }).range, '5 фут., бросок 20/60');
  assert.equal(weaponCard(dagger, { ...plain, distance: 61 }).range, '5 фут., бросок 20/60 · далеко');
});

test('weapon cards explain the bonus action', () => {
  const option = { bonusLabel: 'второе лёгкое оружие', bonusReason: null };
  assert.equal(weaponCard(dagger, { ...plain, option, bonus: true }).bonusNote, 'бонусным: второе лёгкое оружие');
  assert.equal(weaponCard(dagger, { ...plain, option, bonus: false }).bonusNote, null);
  const blocked = weaponCard(sword, { ...plain, distance: 30, option: { bonusLabel: null, bonusReason: 'не лёгкое оружие' }, blocked: true, bonus: true });
  assert.deepEqual([blocked.title, blocked.bonusNote, blocked.outOfRange], ['не лёгкое оружие', 'бонусным — нельзя', true]);
  assert.equal(weaponCard(sword, { ...plain, blocked: true }).title, '');
});

test('the attack resource list says why bonus and reaction are closed', () => {
  const economy = { bonus: true, reaction: true };
  const enforced = { inCombat: true, current: true, enforced: true, weapons: [], readied: null, reactionReason: null };
  const open = attackUsingView({ economy, isActorTurn: true, options: null, bonusAllowed: true, reactionAllowed: true, bonusHint: '' });
  assert.deepEqual(open.options.map(option => [option.label, option.disabled]), [['действием «Атака»', false], ['бонусным действием', false], ['реакцией', false]]);
  assert.equal(open.note, '');
  const closed = attackUsingView({ economy, isActorTurn: true, options: enforced, bonusAllowed: false, reactionAllowed: false, bonusHint: '' });
  assert.deepEqual(closed.options.map(option => option.label), ['действием «Атака»', 'бонусным действием — нечем', 'реакцией — не подготовлена']);
  assert.deepEqual(closed.options.map(option => option.disabled), [false, true, true]);
  assert.match(closed.note, /^Бонусным — .*Реакцией — /);
  const readied = attackUsingView({
    economy: { bonus: false, reaction: true }, isActorTurn: false, options: { ...enforced, readied: { trigger: 'враг подойдёт' } },
    bonusAllowed: true, reactionAllowed: true, bonusHint: 'второе лёгкое оружие',
  });
  assert.deepEqual(readied.options.map(option => [option.label, option.disabled]), [
    ['действием «Атака»', true], ['бонусным действием — второе лёгкое оружие', true], ['реакцией — подготовленная: враг подойдёт', false],
  ]);
});
