import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAction, emptyEffect, emptyTemplate, type SpellTemplate } from './spell-template.ts';
import { engineFormula, templateCastPlan } from './spell-template-engine.ts';
import { acDelta, conditionGuard, damageDefense, rollMods, speedFrom, spellModsOf } from './spell-mods.ts';

const context = { slotLevel: 3, characterLevel: 5 };

test('engine formulas: one dice group first, numbers for @level and @slot, other dice by average', () => {
  assert.deepEqual(engineFormula('8к6', context), { formula: '8d6', approximated: false });
  assert.deepEqual(engineFormula('1к8 + @mod', context), { formula: '1d8+@mod', approximated: false });
  assert.deepEqual(engineFormula('2к6 + 1к6 + @круг', context), { formula: '3d6+3', approximated: false });
  assert.deepEqual(engineFormula('2к6 + 1к4', context), { formula: '2d6+2', approximated: true });
  assert.deepEqual(engineFormula('5', context), { formula: '1d1+4', approximated: false });
  assert.equal(engineFormula('огонь', context), null);
});

function strike(): SpellTemplate {
  const t = emptyTemplate();
  t.passport = { ...t.passport, name: 'Ледяная цепь', level: 2 };
  const hit = emptyAction('Удар');
  hit.check = { ...hit.check, kind: 'attack', attackRange: 'ranged' };
  const cold = emptyEffect('damage');
  Object.assign(cold.values, { formula: '2к8', damageType: 'cold' });
  const slow = emptyEffect('speed');
  Object.assign(slow.values, { mode: 'minus', feet: 10, lasts: 'caster-next-start' });
  const ac = emptyEffect('ac');
  Object.assign(ac.values, { mode: 'floor', value: 15 });
  hit.outcomes.hit = [cold, slow, ac];
  const wall = emptyEffect('wall');
  hit.outcomes.miss = [wall];
  t.actions = [hit];
  t.scaling = [{ id: 's1', what: 'damage', per: 'two-slots', ref: cold.id, amount: '1к8', steps: [] }];
  return t;
}

test('plan: the main action becomes mechanics, short effects become riders, the rest — spell mods or manual', () => {
  const plan = templateCastPlan(strike(), { slotLevel: 4, characterLevel: 7 });
  assert.equal(plan.mechanics.attack, 'ranged');
  assert.equal(plan.mechanics.damageFormula, '3d8', '+1d8 for every two slot levels above 2nd');
  assert.equal(plan.mechanics.damageType, 'cold');
  assert.deepEqual(plan.riders, [{ kind: 'slowed', feet: 10, expires: 'caster-start' }]);
  assert.deepEqual(plan.mods.map(mod => [mod.kind, mod.values.mode, mod.values.value]), [['ac', 'floor', 15]]);
  assert.ok(plan.manual.some(line => /промах: стена/.test(line)), JSON.stringify(plan.manual));
  assert.equal(plan.single, true);
});

test('plan: cantrip scaling is left to the engine, a zone lifts its inner action into mechanics', () => {
  const bolt = strike();
  bolt.passport.level = 0;
  bolt.scaling = [{ id: 's1', what: 'damage', per: 'cantrip', ref: '', amount: '1к8', steps: [] }];
  const plan = templateCastPlan(bolt, { slotLevel: 0, characterLevel: 11 });
  assert.equal(plan.mechanics.damageFormula, '2d8');
  assert.equal(plan.mechanics.cantripScaling, true);

  const moon = emptyTemplate();
  moon.passport = { ...moon.passport, name: 'Лунный луч', level: 2 };
  moon.duration = { ...moon.duration, kind: 'minutes', value: 1, concentration: true };
  moon.targeting = { ...moon.targeting, kind: 'area', shape: 'cylinder', sizeFeet: 5, heightFeet: 40 };
  const inner = emptyAction('Свет луны');
  inner.when = 'zone-enter-or-start';
  inner.who = 'entering';
  inner.check = { ...inner.check, kind: 'save', ability: 'constitution' };
  const burn = emptyEffect('damage');
  Object.assign(burn.values, { formula: '2к10', damageType: 'radiant' });
  inner.outcomes.fail = [burn];
  inner.successHalf = true;
  const zone = emptyEffect('zone');
  zone.actions = [inner];
  const holder = emptyAction('Луч');
  holder.who = 'area';
  holder.outcomes.always = [zone];
  moon.actions = [holder];
  moon.scaling = [{ id: 's2', what: 'damage', per: 'slot', ref: burn.id, amount: '1к10', steps: [] }];
  const moonPlan = templateCastPlan(moon, { slotLevel: 3, characterLevel: 5 });
  assert.equal(moonPlan.mechanics.createsZone, true);
  assert.deepEqual([moonPlan.mechanics.save, moonPlan.mechanics.halfOnSave, moonPlan.mechanics.damageFormula], ['constitution', true, '3d10']);
  assert.deepEqual(moonPlan.area, { shape: 'circle', sizeFeet: 5, widthFeet: null, fromSelf: false });
  assert.equal(moonPlan.cylinderFeet, 40);
});

test('plan: steps grow by the slot level; presets map to the engine', () => {
  const t = emptyTemplate();
  t.passport = { ...t.passport, name: 'Подмога', level: 2 };
  const help = emptyAction('Подмога');
  const hp = emptyEffect('max-hp');
  hp.values.formula = '5';
  const ward = emptyEffect('preset');
  ward.values.preset = 'mirror-images';
  help.outcomes.always = [hp, ward];
  t.actions = [help];
  t.scaling = [{ id: 's', what: 'bonus', per: 'steps', ref: hp.id, amount: '', steps: [[3, '10'], [4, '15']] }];
  assert.deepEqual(templateCastPlan(t, { slotLevel: 2, characterLevel: 3 }).riders, [{ kind: 'aid', bonus: 5 }]);
  const plan = templateCastPlan(t, { slotLevel: 4, characterLevel: 7 });
  assert.deepEqual(plan.riders, [{ kind: 'aid', bonus: 15 }]);
  assert.deepEqual(plan.codes, [{ code: 'mirror_images', parameters: { images: 3 } }]);
});

test('spell mods: AC floor, speed, rolls, defense and condition immunity', () => {
  const mods = spellModsOf([
    { id: '1', parameters: { kind: 'ac', sourceName: 'Ледяной панцирь', values: { mode: 'floor', value: 17 } } },
    { id: '2', parameters: { kind: 'speed', sourceName: 'Быстрые ноги', values: { mode: 'plus', feet: 10 } } },
    { id: '3', parameters: { kind: 'speed', sourceName: 'Ускорение', values: { mode: 'double' } } },
    { id: '4', parameters: { kind: 'checks', sourceName: 'Ясный ум', values: { roll: 'save', ability: 'wisdom', mode: 'advantage' } } },
    { id: '5', parameters: { kind: 'attack-rolls', sourceName: 'Благо', values: { whose: 'own', mode: 'die', die: '4', once: true } } },
    { id: '6', parameters: { kind: 'defense', sourceName: 'Кожа', values: { mode: 'resistance', types: ['nonmagical-physical'] } } },
    { id: '7', parameters: { kind: 'defense', sourceName: 'Отвага', values: { mode: 'condition-immunity', conditions: ['frightened'] } } },
  ]);
  assert.equal(acDelta(mods, 12, 2).delta, 5);
  assert.equal(acDelta(mods, 18, 2).delta, 0, 'a floor does not lower');
  assert.equal(speedFrom(mods, 30).feet, 80);
  assert.deepEqual(rollMods(mods, 'save', 'wisdom', null).advantages, ['ясный ум']);
  assert.deepEqual(rollMods(mods, 'save', 'dexterity', null).advantages, []);
  const attack = rollMods(mods, 'attack', null, null);
  assert.deepEqual([attack.dice, attack.spentDice, attack.spentRuling], [[{ sides: 4, sign: 1, label: 'благо' }], ['5'], []]);
  assert.equal(damageDefense(mods, 'slashing', false).resisted, true);
  assert.equal(damageDefense(mods, 'slashing', true).resisted, false, 'magical blows pass');
  assert.equal(conditionGuard(mods, 'frightened'), 'Отвага');
});
