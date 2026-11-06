import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  BOSS_TEMPLATE, bossProblems, classFeatures, isUndeadOrFiend, phaseThreshold, phasesCrossed, rageDamageBonus,
  smiteDice, sneakAttackDice, sneakAttackRuling, type BossPhase,
} from './class-features.ts';
import {conditionState, d20Ruling} from '../combat/conditions.ts';

test('features by class and level', () => {
  assert.deepEqual(classFeatures('barbarian', 1).map(feature => feature.id), ['rage', 'unarmored-defense']);
  assert.deepEqual(classFeatures('fighter', 1).map(feature => feature.id), ['second-wind']);
  assert.deepEqual(classFeatures('fighter', 2).map(feature => feature.id), ['second-wind', 'action-surge']);
  assert.deepEqual(classFeatures('rogue', 1).map(feature => feature.id), ['sneak-attack']);
  assert.deepEqual(classFeatures('rogue', 2).map(feature => feature.id), ['cunning-action', 'sneak-attack']);
  assert.deepEqual(classFeatures('paladin', 1).map(feature => feature.id), ['lay-on-hands'], 'Divine Smite comes at 2nd level');
  assert.deepEqual(classFeatures('paladin', 2).map(feature => feature.id), ['divine-smite', 'lay-on-hands']);
  assert.deepEqual(classFeatures('paladin', 3).map(feature => feature.id), ['divine-smite', 'sacred-weapon', 'lay-on-hands', 'turn-the-unholy']);
  assert.deepEqual(classFeatures('paladin', 3, 'other').map(feature => feature.id), ['divine-smite', 'lay-on-hands'], 'another oath — no Devotion features');
  assert.deepEqual(classFeatures('monk', 2).map(feature => feature.id), ['flurry-of-blows', 'patient-defense', 'step-of-the-wind', 'unarmored-movement', 'unarmored-defense-monk']);
  assert.deepEqual(classFeatures('druid', 1), []);
  assert.deepEqual(classFeatures('druid', 2).map(feature => feature.id), ['wild-shape', 'natural-recovery']);
  assert.deepEqual(classFeatures('bard', 1).map(feature => feature.id), ['bardic-inspiration']);
  assert.deepEqual(classFeatures('cleric', 1).map(feature => feature.id), ['disciple-of-life'], 'Channel Divinity comes at 2nd level');
  assert.deepEqual(classFeatures('cleric', 2).map(feature => feature.id), ['turn-undead', 'disciple-of-life', 'preserve-life']);
  assert.deepEqual(classFeatures('cleric', 2, 'other').map(feature => feature.id), ['turn-undead'], 'another domain — no Life features');
  assert.deepEqual(classFeatures('monk', 1).map(feature => feature.id), ['unarmored-defense-monk']);
  assert.deepEqual(classFeatures('wizard', 20).map(feature => feature.id), ['arcane-recovery', 'sculpt-spells', 'empowered-evocation', 'spell-mastery', 'signature-spells', 'potent-cantrip', 'overchannel']);
  assert.deepEqual(classFeatures('wizard', 20, 'other').map(feature => feature.id), ['arcane-recovery', 'spell-mastery', 'signature-spells'], 'another school — no Sculpt Spells');
  assert.deepEqual(classFeatures(null, 5), []);
});

test('rage, sneak attack and smite numbers (PHB 2014)', () => {
  assert.deepEqual([1, 8, 9, 15, 16, 20].map(rageDamageBonus), [2, 2, 3, 3, 4, 4]);
  assert.deepEqual([1, 2, 3, 4, 5, 10, 19, 20].map(sneakAttackDice), [1, 1, 2, 2, 3, 5, 10, 10]);
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(level => smiteDice(level, false)), [2, 3, 4, 5, 5, 5], 'no more than 5d8');
  assert.equal(smiteDice(4, true), 6, 'undead and fiends take 1d8 more, even past the cap');
  assert.ok(isUndeadOrFiend('нежить'));
  assert.ok(isUndeadOrFiend('Исчадие (демон), хаотично-злой.'));
  assert.ok(!isUndeadOrFiend('гуманоид (гоблиноид)'));
  assert.ok(!isUndeadOrFiend(null));
});

test('sneak attack: finesse or ranged, advantage or an ally by the target, no disadvantage, once a turn', () => {
  const base = {finesse: true, ranged: false, advantage: 'none' as const, allyNearTarget: false, usedThisTurn: false};
  assert.deepEqual(sneakAttackRuling({...base, advantage: 'adv'}), {ok: true, reason: 'преимущество'});
  assert.deepEqual(sneakAttackRuling({...base, allyNearTarget: true}), {ok: true, reason: 'союзник рядом с целью'});
  assert.equal(sneakAttackRuling(base).ok, false);
  assert.equal(sneakAttackRuling({...base, advantage: 'disadv', allyNearTarget: true}).ok, false, 'disadvantage spoils the ally clause');
  assert.equal(sneakAttackRuling({...base, finesse: false, advantage: 'adv'}).ok, false, 'a greataxe never sneaks');
  assert.equal(sneakAttackRuling({...base, finesse: false, ranged: true, advantage: 'adv'}).ok, true, 'a shortbow does');
  assert.match(sneakAttackRuling({...base, advantage: 'adv', usedThisTurn: true}).reason, /уже была/);
});

test('rage gives advantage on Strength checks and saves only', () => {
  const raging = conditionState(['raging']);
  assert.equal(d20Ruling({kind: 'save', ability: 'strength', own: raging}).advantage, 'adv');
  assert.equal(d20Ruling({kind: 'skill', ability: 'strength', own: raging}).advantage, 'adv');
  assert.ok(d20Ruling({kind: 'ability', ability: 'strength', own: raging}).reasons.includes('преимущество: ярость'));
  assert.equal(d20Ruling({kind: 'save', ability: 'dexterity', own: raging}).advantage, 'none');
  assert.equal(d20Ruling({kind: 'attack', ability: 'strength', own: raging}).advantage, 'none', 'Reckless Attack is not rage');
});

test('boss settings: legendary actions and phases are checked', () => {
  assert.deepEqual(bossProblems(BOSS_TEMPLATE), []);
  assert.deepEqual(bossProblems({legendaryActions: 0, options: [], phases: []}), []);
  const problems = bossProblems({
    legendaryActions: 2,
    options: [{name: 'Хвост', cost: 3, text: ''}, {name: ' ', cost: 1, text: ''}],
    phases: [
      {atPercent: 50, title: 'Ярость', text: '', public: true, done: false},
      {atPercent: 50, title: 'Ещё', text: '', public: true, done: false},
      {atPercent: 100, title: 'Сразу', text: '', public: true, done: false},
    ],
  });
  assert.ok(problems.some(problem => /«Хвост» стоит 3, а за раунд всего 2/.test(problem)), problems.join('\n'));
  assert.ok(problems.some(problem => /нужно название/.test(problem)));
  assert.ok(problems.some(problem => /Две фазы на 50 %/.test(problem)));
  assert.ok(problems.some(problem => /от 1 до 99 %/.test(problem)));
  assert.match(bossProblems({legendaryActions: 3, options: [], phases: []}).join(' '), /хотя бы один вариант/);
});

test('phases start when hit points fall past the threshold — once, top to bottom, not when the boss drops', () => {
  const phases: BossPhase[] = [
    {atPercent: 25, title: 'Последний рубеж', text: '', public: false, done: false},
    {atPercent: 50, title: 'Ярость', text: '', public: true, done: false},
  ];
  assert.equal(phaseThreshold(100, 50), 50);
  assert.equal(phaseThreshold(7, 10), 1, 'never below 1 hit point');
  assert.deepEqual(phasesCrossed(phases, 100, 80, 51), []);
  assert.deepEqual(phasesCrossed(phases, 100, 80, 50), [1]);
  assert.deepEqual(phasesCrossed(phases, 100, 80, 20), [1, 0], 'one blow past both — upper first');
  assert.deepEqual(phasesCrossed(phases, 100, 80, 0), [], 'a dropped boss has no phases left to start');
  assert.deepEqual(phasesCrossed(phases, 100, 40, 60), [], 'healing does not start a phase');
  assert.deepEqual(phasesCrossed([{...phases[1]!, done: true}], 100, 80, 40), [], 'a phase happens once');
});

test('multiclass features: every class at its own level', async () => {
  const {classFeaturesFor, classLevelOf} = await import('./class-features.ts');
  const ids = classFeaturesFor([{id: 'fighter', level: 1}, {id: 'rogue', level: 2}]).map(feature => feature.id).sort();
  assert.deepEqual(ids, ['cunning-action', 'second-wind', 'sneak-attack'], 'no Action Surge at fighter 1');
  assert.equal(classLevelOf([{id: 'rogue', level: 3}, {id: 'fighter', level: 5}], 'rogue', 8), 3, 'sneak attack counts rogue levels');
  assert.equal(classLevelOf([], 'rogue', 8), 8, 'no classes parsed — the character level');
});

test('twelfth round: mindless rage, aura of devotion, wholeness of body, dark one\'s own luck, divine strike, legendary resistance', async () => {
  const {auraOfDevotion, darkLuckCanSave, divineStrikeDice, wholenessOfBodyHp} = await import('./class-features.ts');
  const {mergedClassResources} = await import('../srd/progression.ts');
  assert.ok(classFeatures('barbarian', 6).some(feature => feature.id === 'mindless-rage'));
  assert.ok(!classFeatures('barbarian', 6, 'other').some(feature => feature.id === 'mindless-rage'), 'another path — no mindless rage');
  assert.ok(classFeatures('paladin', 7).some(feature => feature.id === 'aura-of-devotion'));
  assert.deepEqual(auraOfDevotion([{id: 'paladin', level: 6}]), null);
  assert.deepEqual(auraOfDevotion([{id: 'paladin', level: 7}]), {feet: 10});
  assert.deepEqual(auraOfDevotion([{id: 'paladin', level: 18, subclass: 'devotion'}]), {feet: 30});
  assert.deepEqual(auraOfDevotion([{id: 'paladin', level: 9, subclass: 'other'}]), null);
  assert.equal(wholenessOfBodyHp(6), 18);
  assert.equal(darkLuckCanSave(11, 21), true);
  assert.equal(darkLuckCanSave(10, 21), false, 'd10 cannot close 11');
  assert.equal(darkLuckCanSave(21, 21), false, 'already a success');
  assert.deepEqual([7, 8, 13, 14].map(divineStrikeDice), [0, 1, 1, 2]);
  const names = (classes: any[]) => mergedClassResources(classes, {charisma: 0}).map(rule => rule.name);
  assert.ok(names([{id: 'warlock', level: 6, subclass: 'fiend'}]).includes('Удача тёмного'));
  assert.ok(!names([{id: 'warlock', level: 5, subclass: 'fiend'}]).includes('Удача тёмного'));
  assert.ok(names([{id: 'monk', level: 6, subclass: 'open-hand'}]).includes('Цельность тела'));
  assert.equal(BOSS_TEMPLATE.legendaryResistances, 3);
  assert.match(bossProblems({legendaryActions: 0, options: [], phases: [], legendaryResistances: 6}).join(' '), /Легендарного сопротивления в день — от 0 до 5/);
  assert.deepEqual(bossProblems({legendaryActions: 0, options: [], phases: [], legendaryResistances: 3}), []);
});

test('thirteenth round: aura of courage, improved smite, brutal critical, relentless rage, reliable talent, monk 7/10', async () => {
  const {RELENTLESS_RAGE_MAX, auraOfCourage, brutalCriticalDice, relentlessRageDc} = await import('./class-features.ts');
  const {mergedClassResources} = await import('../srd/progression.ts');
  const ids = (classId: string, level: number) => classFeatures(classId as any, level).map(feature => feature.id);
  assert.ok(ids('paladin', 10).includes('aura-of-courage'));
  assert.ok(!ids('paladin', 10).includes('improved-divine-smite'));
  assert.ok(ids('paladin', 11).includes('improved-divine-smite'));
  assert.deepEqual(auraOfCourage([{id: 'paladin', level: 9}]), null);
  assert.deepEqual(auraOfCourage([{id: 'paladin', level: 10}]), {feet: 10});
  assert.deepEqual(auraOfCourage([{id: 'paladin', level: 18}]), {feet: 30});
  assert.ok(ids('barbarian', 9).includes('brutal-critical'));
  assert.ok(ids('barbarian', 11).includes('relentless-rage'));
  assert.deepEqual([8, 9, 13, 17].map(brutalCriticalDice), [0, 1, 2, 3]);
  assert.deepEqual([0, 1, 2].map(relentlessRageDc), [10, 15, 20]);
  const rage = mergedClassResources([{id: 'barbarian', level: 11}], {charisma: 0}).find(rule => rule.name === 'Непреклонная ярость');
  assert.equal(rage?.max, RELENTLESS_RAGE_MAX);
  assert.equal(rage?.recharge, 'short');
  assert.ok(!mergedClassResources([{id: 'barbarian', level: 10}], {charisma: 0}).some(rule => rule.name === 'Непреклонная ярость'));
  assert.ok(ids('rogue', 11).includes('reliable-talent'));
  assert.ok(!ids('rogue', 10).includes('reliable-talent'));
  assert.ok(ids('monk', 7).includes('stillness-of-mind'));
  assert.equal(classFeatures('monk', 7).find(feature => feature.id === 'stillness-of-mind')?.use, 'action');
  assert.ok(ids('monk', 10).includes('purity-of-body'));
});

test('fourteenth round: speed, half proficiency, save proficiency, song of rest, survivor, indomitable, cleansing touch', async () => {
  const {featureSaveProficiency, halfProficiency, songOfRestDie, survivorHeal, unarmoredMovementFeet} = await import('./class-features.ts');
  const {mergedClassResources} = await import('../srd/progression.ts');
  const ids = (classId: string, level: number, subclass?: string) => classFeatures(classId as any, level, subclass).map(feature => feature.id);
  assert.deepEqual([1, 2, 6, 10, 14, 18].map(unarmoredMovementFeet), [0, 10, 15, 20, 25, 30]);
  assert.ok(ids('barbarian', 5).includes('fast-movement') && !ids('barbarian', 4).includes('fast-movement'));
  assert.ok(ids('barbarian', 7).includes('feral-instinct'));
  assert.ok(ids('barbarian', 18).includes('indomitable-might'));
  assert.deepEqual(halfProficiency([{id: 'bard', level: 2}], 'wisdom', 2), {value: 1, reason: 'мастер на все руки +1'});
  assert.deepEqual(halfProficiency([{id: 'bard', level: 1}], 'wisdom', 2), null, 'from 2nd level');
  assert.deepEqual(halfProficiency([{id: 'fighter', level: 7}], 'strength', 3), {value: 2, reason: 'выдающийся атлет +2'}, 'rounded up');
  assert.deepEqual(halfProficiency([{id: 'fighter', level: 7}], 'wisdom', 3), null, 'only STR, DEX, CON');
  assert.deepEqual(halfProficiency([{id: 'fighter', level: 7, subclass: 'battle-master'}], 'strength', 3), null, 'Champion only');
  assert.deepEqual(halfProficiency([{id: 'fighter', level: 7}, {id: 'bard', level: 2}], 'dexterity', 5), {value: 3, reason: 'выдающийся атлет +3'}, 'the larger, not both');
  assert.equal(featureSaveProficiency([{id: 'monk', level: 14}], 'charisma'), 'алмазная душа');
  assert.equal(featureSaveProficiency([{id: 'monk', level: 13}], 'charisma'), null);
  assert.equal(featureSaveProficiency([{id: 'rogue', level: 15}], 'wisdom'), 'скользкий ум');
  assert.equal(featureSaveProficiency([{id: 'rogue', level: 15}], 'charisma'), null);
  assert.ok(ids('rogue', 18).includes('elusive'));
  assert.deepEqual([1, 2, 9, 13, 17].map(songOfRestDie), [0, 6, 8, 10, 12]);
  assert.equal(survivorHeal(20, 60, 2), 7);
  assert.equal(survivorHeal(31, 60, 2), 0, 'more than half');
  assert.equal(survivorHeal(0, 60, 2), 0, 'not at 0');
  assert.equal(survivorHeal(29, 30, 2), 0);
  assert.equal(survivorHeal(15, 30, 2), 7);
  assert.ok(ids('fighter', 18).includes('survivor') && !ids('fighter', 18, 'battle-master').includes('survivor'));
  assert.ok(ids('fighter', 9).includes('indomitable'));
  const rules = (classes: any[], charisma = 0) => mergedClassResources(classes, {charisma});
  assert.equal(rules([{id: 'fighter', level: 13}]).find(rule => rule.name === 'Упорный')?.max, 2);
  assert.equal(rules([{id: 'paladin', level: 14}], 3).find(rule => rule.name === 'Очищающее касание')?.max, 3);
  assert.equal(rules([{id: 'paladin', level: 14}], -1).find(rule => rule.name === 'Очищающее касание')?.max, 1, 'at least once');
  assert.ok(!rules([{id: 'paladin', level: 13}], 3).some(rule => rule.name === 'Очищающее касание'));
  assert.equal(classFeatures('paladin', 14).find(feature => feature.id === 'cleansing-touch')?.use, 'action');
});

test('elusive: no advantage on an attack against the target', async () => {
  const {conditionState: state} = await import('../combat/conditions.ts');
  const prone = state(['prone']);
  const plain = d20Ruling({kind: 'attack', ability: 'strength', own: state([]), target: prone, targetWithin5ft: true});
  assert.equal(plain.advantage, 'adv');
  const elusive = d20Ruling({kind: 'attack', ability: 'strength', own: state([]), target: prone, targetWithin5ft: true, requested: 'adv', noAdvantage: 'неуловимость цели'});
  assert.equal(elusive.advantage, 'none');
  assert.ok(elusive.reasons.includes('без преимущества: неуловимость цели'));
  const both = d20Ruling({kind: 'attack', ability: 'strength', own: state(['poisoned']), target: prone, targetWithin5ft: true, noAdvantage: 'неуловимость цели'});
  assert.equal(both.advantage, 'disadv', 'advantage is gone, disadvantage stays');
  const save = d20Ruling({kind: 'save', ability: 'strength', own: state([]), requested: 'adv', noAdvantage: 'неуловимость цели'});
  assert.equal(save.advantage, 'adv', 'only attacks');
});

test('divine intervention: 7 days after an answer, a long rest after silence', async () => {
  const {DIVINE_INTERVENTION_COOLDOWN, divineInterventionBlock} = await import('./class-features.ts');
  assert.equal(divineInterventionBlock(null, 0, null), null);
  assert.match(divineInterventionBlock({at: 0, success: true}, 60, null)!, /через 7 дн\./);
  assert.equal(divineInterventionBlock({at: 0, success: true}, DIVINE_INTERVENTION_COOLDOWN, null), null);
  assert.match(divineInterventionBlock({at: 100, success: false}, 200, 50)!, /после долгого отдыха/);
  assert.equal(divineInterventionBlock({at: 100, success: false}, 700, 600), null);
  assert.ok(classFeatures('cleric', 10).some(feature => feature.id === 'divine-intervention'));
  assert.ok(classFeatures('rogue', 20).some(feature => feature.id === 'stroke-of-luck'));
});

test('seventeenth round: arcanum levels, wizard spell picks, feral senses', async () => {
  const {mysticArcanumLevels, spellPicks} = await import('./class-features.ts');
  const {conditionState: state} = await import('../combat/conditions.ts');
  assert.deepEqual(mysticArcanumLevels(10), []);
  assert.deepEqual(mysticArcanumLevels(11), [6]);
  assert.deepEqual(mysticArcanumLevels(16), [6, 7, 8]);
  assert.deepEqual(mysticArcanumLevels(20), [6, 7, 8, 9]);
  assert.deepEqual(spellPicks(null), {mastery: [], signature: []});
  assert.deepEqual(spellPicks({spellPicks: {mastery: ['a', 'b', 'c'], signature: ['d', 7]}}), {mastery: ['a', 'b'], signature: ['d']});
  for (const [klass, level, id] of [['ranger', 14, 'vanish'], ['ranger', 18, 'feral-senses'], ['warlock', 11, 'mystic-arcanum'], ['wizard', 18, 'spell-mastery'], ['wizard', 20, 'signature-spells'], ['sorcerer', 20, 'sorcerous-restoration']] as const) {
    assert.ok(classFeatures(klass, level).some(feature => feature.id === id), id);
    assert.ok(!classFeatures(klass, level - 1).some(feature => feature.id === id), `${id} before ${level}`);
  }
  const unseen = d20Ruling({kind: 'attack', ability: 'dexterity', own: state(['blinded']), target: state(['invisible'])});
  assert.equal(unseen.advantage, 'disadv');
  const feral = d20Ruling({kind: 'attack', ability: 'dexterity', own: state(['blinded']), target: state(['invisible']), ignoreUnseen: true});
  assert.equal(feral.advantage, 'none', 'neither own blindness nor the invisible target imposes disadvantage');
});

test('eighteenth round: hide in plain sight, blindsense, beast spells by level', () => {
  for (const [klass, level, id] of [['ranger', 10, 'hide-in-plain-sight'], ['rogue', 14, 'blindsense'], ['druid', 18, 'beast-spells']] as const) {
    assert.ok(classFeatures(klass, level).some(feature => feature.id === id), id);
    assert.ok(!classFeatures(klass, level - 1).some(feature => feature.id === id), `${id} before ${level}`);
  }
});

test('nineteenth round: capstones, subclass features, rage, falls', async () => {
  const domain = await import('./class-features.ts');
  for (const [klass, level, id] of [
    ['bard', 20, 'superior-inspiration'], ['monk', 20, 'perfect-self'], ['warlock', 20, 'eldritch-master'], ['barbarian', 15, 'persistent-rage'],
    ['barbarian', 20, 'primal-champion'], ['wizard', 6, 'potent-cantrip'], ['wizard', 14, 'overchannel'], ['warlock', 10, 'fiendish-resilience'],
    ['cleric', 17, 'supreme-healing'], ['ranger', 7, 'defensive-tactics'], ['ranger', 11, 'hunter-multiattack'], ['monk', 4, 'slow-fall'],
  ] as const) {
    assert.ok(classFeatures(klass, level).some(feature => feature.id === id), id);
    assert.ok(!classFeatures(klass, level - 1).some(feature => feature.id === id), `${id} before ${level}`);
  }
  assert.ok(classFeatures('sorcerer', 1).some(feature => feature.id === 'draconic-resilience'));
  assert.ok(!classFeatures('sorcerer', 1, 'wild-magic').some(feature => feature.id === 'draconic-resilience'), 'only the draconic bloodline');
  assert.ok(!classFeatures('wizard', 14, 'abjuration').some(feature => feature.id === 'overchannel'), 'only evocation');

  assert.equal(domain.rageEndsEarly(false, false), true);
  assert.equal(domain.rageEndsEarly(true, false), false);
  assert.equal(domain.rageEndsEarly(undefined, false), false);
  assert.equal(domain.rageEndsEarly(false, true), false);

  assert.deepEqual(domain.primalChampionScores({strength: 20, constitution: 22, dexterity: 14}), {strength: 24, constitution: 24, dexterity: 14});
  assert.deepEqual(domain.primalChampionScores({strength: 15, constitution: 16}), {strength: 19, constitution: 20});

  assert.equal(domain.overchannelSelfDice(0, 3), 0);
  assert.equal(domain.overchannelSelfDice(1, 3), 6);
  assert.equal(domain.overchannelSelfDice(2, 5), 15);

  assert.deepEqual([5, 10, 35, 200, 1000].map(domain.fallDamageDice), [0, 1, 3, 20, 20]);
  assert.equal(domain.slowFallReduction(4), 20);
  assert.equal(domain.slowFallReduction(11), 55);

  assert.deepEqual(domain.unarmoredDefense([{id: 'sorcerer', level: 3, subclass: 'draconic'}], {dexterity: 16, constitution: 10, wisdom: 10}), {classId: 'sorcerer', ability: null, shield: true, ac: 16});
  assert.equal(domain.unarmoredDefense([{id: 'sorcerer', level: 3, subclass: 'wild-magic'}], {dexterity: 16, constitution: 10, wisdom: 10}), null);
  assert.equal(domain.unarmoredDefense([{id: 'barbarian', level: 1}, {id: 'sorcerer', level: 1}], {dexterity: 14, constitution: 16, wisdom: 10})?.classId, 'barbarian', 'the first class formula');

  assert.deepEqual(domain.knownDefensiveTactics({defensiveTactics: ['steel-will', 'escape-the-horde']}), ['steel-will'], 'one tactic');
  assert.deepEqual(domain.knownDefensiveTactics({defensiveTactics: ['nonsense']}), []);
  assert.deepEqual(domain.knownHunterMultiattack({hunterMultiattack: ['whirlwind']}), ['whirlwind']);
  assert.deepEqual(domain.knownFiendishResilience({fiendishResilience: ['fire']}), ['fire']);
  assert.deepEqual(domain.knownFiendishResilience({fiendishResilience: ['love']}), []);
});

test('round 20: superior hunter’s defense choice, empty body resistance, subclass features by level', async () => {
  const domain = await import('./class-features.ts');
  const progression = await import('../srd/progression.ts');
  assert.deepEqual(domain.knownSuperiorDefense({superiorDefense: ['stand-against-the-tide', 'evasion']}), ['stand-against-the-tide'], 'one option');
  assert.deepEqual(domain.knownSuperiorDefense({superiorDefense: ['nonsense']}), []);
  assert.equal(domain.emptyBodyResists('fire'), true);
  assert.equal(domain.emptyBodyResists('force'), false);
  assert.equal(domain.emptyBodyResists(null), false);
  const ids = (classId: any, level: number) => domain.classFeatures(classId, level).map(feature => feature.id);
  assert.ok(ids('barbarian', 14).includes('retaliation') && !ids('barbarian', 13).includes('retaliation'));
  assert.ok(ids('ranger', 15).includes('superior-hunters-defense') && ids('ranger', 8).includes('lands-stride-ranger'));
  assert.ok(ids('monk', 17).includes('quivering-palm') && ids('monk', 18).includes('empty-body'));
  assert.ok(ids('warlock', 14).includes('hurl-through-hell') && ids('paladin', 20).includes('holy-nimbus'));
  assert.ok(ids('druid', 6).includes('lands-stride') && ids('sorcerer', 14).includes('dragon-wings') && ids('bard', 14).includes('peerless-skill'));
  const names = (classId: any, level: number, subclass: string) => progression.classResources(classId, level, {charisma: 3}, subclass).map(rule => rule.name);
  assert.ok(names('warlock', 14, 'fiend').includes('Бросок через ад') && !names('warlock', 13, 'fiend').includes('Бросок через ад'));
  assert.ok(names('paladin', 20, 'devotion').includes('Святой нимб') && !names('paladin', 19, 'devotion').includes('Святой нимб'));
});
