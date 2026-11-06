import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FEATS, greatWeaponReroll, hasFeat, knownFeats, knownFightingStyles, liveStyle} from './feats.ts';

test('feats: marked in «Умения» or found in the sheet text', () => {
  assert.deepEqual(knownFeats({feats: ['alert', 'war-caster', 'nonsense']}), ['alert', 'war-caster']);
  assert.deepEqual(knownFeats({text: {levels: {value: 'Уровень 4. Черта: Боевой заклинатель — преимущество на концентрацию.'}}}), ['war-caster']);
  assert.deepEqual(knownFeats({text: {feats: {value: 'Sharpshooter, Lucky (feat: Lucky), Resilient (Constitution)'}}}).sort(), ['lucky', 'resilient-constitution', 'sharpshooter'].sort());
  assert.deepEqual(knownFeats({text: {notes: {value: 'Стойкий (Мудрость)'}}}), ['resilient-wisdom']);
  assert.deepEqual(knownFeats({feats: [], text: {levels: {value: 'Черта: Меткий стрелок'}}}), [], 'marks win over the text');
  assert.deepEqual(knownFeats({text: {traits: {value: 'Везучий: единица перебрасывается'}}}), [], 'the halfling trait is not the feat');
  assert.deepEqual(knownFeats(null), []);
  assert.ok(hasFeat({feats: ['mobile']}, 'mobile'));
  assert.equal(new Set(FEATS.map(feat => feat.id)).size, FEATS.length);
});

test('fighting styles: builder, marks, text; archery and dueling from the builder are already in the weapons', () => {
  assert.deepEqual(knownFightingStyles({builder: {fightingStyle: 'archery'}}), {ids: ['archery'], baked: 'archery'});
  assert.equal(liveStyle({builder: {fightingStyle: 'archery'}}, 'archery'), false, 'baked into the bow');
  assert.equal(liveStyle({builder: {fightingStyle: 'great-weapon'}}, 'great-weapon'), true);
  assert.equal(liveStyle({text: {levels: {value: 'Боевой стиль: Стрельба — +2'}}}, 'archery'), true);
  assert.equal(liveStyle({text: {features: {value: 'Fighting Style: Two-Weapon Fighting'}}}, 'two-weapon'), true);
  assert.deepEqual(knownFightingStyles({fightingStyles: ['dueling'], builder: {fightingStyle: 'defense'}}).ids, ['defense', 'dueling']);
  assert.equal(liveStyle({fightingStyles: ['dueling']}, 'dueling'), true);
});

test('great weapon fighting rerolls 1 and 2 once', () => {
  const rolls = [1, 6];
  assert.deepEqual(greatWeaponReroll([1, 2, 5, 6], () => rolls.shift()!), {dice: [1, 6, 5, 6], rerolled: 2}, 'a new 1 stays');
  assert.deepEqual(greatWeaponReroll([3, 4], () => 6), {dice: [3, 4], rerolled: 0});
});

test('a Cyrillic feat name before punctuation is found', () => {
  assert.deepEqual(knownFeats({text: {levels: {value: 'Черта: Настороженный; Боевой стиль: Стрельба'}}}), ['alert']);
  assert.deepEqual(knownFeats({text: {levels: {value: 'Черта: Мобильный.'}}}), ['mobile']);
  assert.deepEqual(knownFeats({text: {levels: {value: 'настороженный взгляд'}}}), [], 'a lowercase word in a description is not the feat');
});

test('other translations and the new feats are found; resilient and durable are told apart', () => {
  assert.deepEqual(knownFeats({text: {feats: {value: 'Черты: Бдительный, Внимательный, Подвижный.'}}}).sort(), ['alert', 'mobile', 'observant']);
  assert.deepEqual(knownFeats({text: {feats: {value: 'Устойчивый (Сила)'}}}), ['resilient-strength']);
  assert.deepEqual(knownFeats({text: {feats: {value: 'Стойкий. Крепкий.'}}}).sort(), ['durable', 'tough']);
  assert.deepEqual(knownFeats({text: {feats: {value: 'Стойкий (Ловкость)'}}}), ['resilient-dexterity'], 'with an ability — resilient, not durable');
  assert.deepEqual(knownFeats({text: {feats: {value: 'Sentinel, Crossbow Expert, Spell Sniper, Savage Attacker, Heavy Armor Master, Inspiring Leader'}}}).sort(),
    ['crossbow-expert', 'heavy-armor-master', 'inspiring-leader', 'savage-attacker', 'sentinel', 'spell-sniper']);
  assert.deepEqual(knownFeats({text: {traits: {value: 'Свирепые атаки: ещё кость при крите'}}}), [], 'the half-orc trait is not «Дикарь»');
  assert.ok(FEATS.every(feat => feat.en.length > 0));
});

test('polearms and hand crossbows: by SRD index or by name', async () => {
  const {isHandCrossbow, isPolearm} = await import('./feats.ts');
  assert.equal(isPolearm({srd_index: 'glaive'}), true);
  assert.equal(isPolearm({srd_index: 'longsword', name: 'Копьё'}), false, 'the SRD index decides');
  assert.equal(isPolearm({name: 'Боевой посох'}), true);
  assert.equal(isPolearm({name: 'Копьё стражника'}), true);
  assert.equal(isPolearm({name: 'Кинжал'}), false);
  assert.equal(isHandCrossbow({srd_index: 'crossbow-hand'}), true);
  assert.equal(isHandCrossbow({name: 'Ручной арбалет'}), true);
  assert.equal(isHandCrossbow({name: 'Тяжёлый арбалет'}), false);
});

test('mage slayer and elemental adept: marked or found in the sheet text', async () => {
  const {knownFeats} = await import('./feats.ts');
  assert.deepEqual(knownFeats({feats: ['mage-slayer', 'elemental-adept-cold']}), ['mage-slayer', 'elemental-adept-cold']);
  assert.deepEqual(knownFeats({text: {feats: {value: 'Черта: Стихийный адепт (огонь). Убийца магов.'}}}), ['mage-slayer', 'elemental-adept-fire']);
  assert.deepEqual(knownFeats({text: {feats: {value: 'Feat: Elemental Adept (Lightning)'}}}), ['elemental-adept-lightning']);
  assert.deepEqual(knownFeats({text: {feats: {value: 'Стихийный адепт: звук'}}}), ['elemental-adept-thunder']);
  assert.deepEqual(knownFeats({text: {feats: {value: 'Стихийный адепт'}}}), [], 'without the element — not counted');
});
