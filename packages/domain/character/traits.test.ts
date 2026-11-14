import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  describeTraitEffect, normalizeTraitEffect, normalizeTraitEffects, sourced, traitHpPerLevel, traitPassive, traitRerollOnes, traitResistance,
  traitRollBonus, traitSaveAdvantages, traitSaveProficiency, traitSpeed,
} from './traits.ts';
import {characterTraitEffects, characterResistances} from './hero-traits.ts';
import {normalizeModFeat, normalizeModRace} from './mod-heroes.ts';

test('effects are checked: a wrong one says what is expected', () => {
  assert.deepEqual(normalizeTraitEffect({kind: 'save-advantage', condition: 'frightened', abilities: ['wisdom']}), {kind: 'save-advantage', condition: 'frightened', abilities: ['wisdom']});
  assert.deepEqual(normalizeTraitEffect({kind: 'save-advantage', condition: 'mod_shaken'}), {kind: 'save-advantage', condition: 'mod_shaken'});
  assert.match(normalizeTraitEffect({kind: 'save-advantage'}) as string, /против чего/);
  assert.match(normalizeTraitEffect({kind: 'save-advantage', condition: 'scared'}) as string, /состояние «scared»/);
  assert.match(normalizeTraitEffect({kind: 'resistance', damage: 'cold-iron'}) as string, /вид урона/);
  assert.match(normalizeTraitEffect({kind: 'speed', feet: 7}) as string, /кратное 5/);
  assert.match(normalizeTraitEffect({kind: 'roll-bonus', rolls: 'damage', value: 1}) as string, /attacks, checks, saves или initiative/);
  assert.deepEqual(normalizeTraitEffect({kind: 'roll-bonus', rolls: 'initiative', value: 2, abilities: ['dexterity']}), {kind: 'roll-bonus', rolls: 'initiative', value: 2}, 'initiative has no ability filter');
  assert.match(normalizeTraitEffect({kind: 'hp-per-level', value: 9}) as string, /от 1 до 5/);
  assert.match(normalizeTraitEffect({kind: 'fly'}) as string, /^эффект «fly»: kind — save-advantage, roll-bonus/);
  assert.match(normalizeTraitEffects(Array.from({length: 13}, () => ({kind: 'reroll-ones'}))) as string, /не больше 12/);
  assert.deepEqual(normalizeTraitEffects(undefined), []);
});

test('the rules read effects: every filter must hold, reasons are the trait names', () => {
  const effects = [
    ...sourced('Дварфийская устойчивость', [{kind: 'save-advantage', condition: 'poisoned'}, {kind: 'save-advantage', damage: 'poison'}, {kind: 'resistance', damage: 'poison'}]),
    ...sourced('Гномья хитрость', [{kind: 'save-advantage', magic: true, abilities: ['intelligence', 'wisdom', 'charisma']}]),
    ...sourced('Устойчивый (Сила)', [{kind: 'save-proficiency', ability: 'strength'}]),
    ...sourced('Меткий', [{kind: 'roll-bonus', rolls: 'attacks', value: 1}, {kind: 'roll-bonus', rolls: 'checks', value: -1, abilities: ['dexterity']}]),
    ...sourced('Мобильный', [{kind: 'speed', feet: 10}]),
    ...sourced('Наблюдательный', [{kind: 'passive', skill: 'perception', value: 5}]),
    ...sourced('Крепкий', [{kind: 'hp-per-level', value: 2}]),
  ] as ReturnType<typeof sourced>;
  assert.deepEqual(traitSaveAdvantages(effects, 'constitution', {condition: 'poisoned', damageType: 'poison'}), ['дварфийская устойчивость'], 'one reason per trait');
  assert.deepEqual(traitSaveAdvantages(effects, 'wisdom', {magic: true}), ['гномья хитрость']);
  assert.deepEqual(traitSaveAdvantages(effects, 'dexterity', {magic: true}), []);
  assert.deepEqual(traitSaveAdvantages(effects, 'wisdom', null), []);
  assert.equal(traitSaveProficiency(effects, 'strength'), 'устойчивый');
  assert.deepEqual(traitRollBonus(effects, 'attack', null), {value: 1, reasons: ['меткий +1']});
  assert.deepEqual(traitRollBonus(effects, 'skill', 'dexterity'), {value: -1, reasons: ['меткий −1']});
  assert.deepEqual(traitRollBonus(effects, 'skill', 'wisdom'), {value: 0, reasons: []});
  assert.deepEqual(traitSpeed(effects), {feet: 10, reasons: ['скорость +10 фт.: мобильный']});
  assert.equal(traitPassive(effects, 'perception'), 5);
  assert.equal(traitHpPerLevel(effects), 2);
  assert.equal(traitResistance(effects, 'poison'), 'Дварфийская устойчивость');
  assert.equal(traitRerollOnes(effects), null);
  assert.equal(describeTraitEffect({kind: 'save-advantage', condition: 'frightened', abilities: ['wisdom']}), 'Спасброски (Мудрости) против: испуган — с преимуществом');
  assert.equal(describeTraitEffect({kind: 'roll-bonus', rolls: 'initiative', value: 2}), '+2 к инициативе');
});

test('SRD races and feats are data for the same engine', () => {
  const halfling = characterTraitEffects({sheet_extra: {builder: {race: 'halfling'}, feats: ['alert', 'resilient-wisdom']}});
  assert.equal(traitRerollOnes(halfling), 'везучий');
  assert.deepEqual(traitSaveAdvantages(halfling, 'wisdom', {condition: 'frightened'}), ['храбрый']);
  assert.deepEqual(traitRollBonus(halfling, 'initiative', 'dexterity').reasons, ['настороженный +5']);
  assert.equal(traitSaveProficiency(halfling, 'wisdom'), 'устойчивый');
  assert.deepEqual(characterResistances({sheet_extra: {builder: {race: 'tiefling'}}}), ['fire']);
  assert.deepEqual(characterResistances({sheet_extra: {builder: {race: 'dragonborn', ancestry: 'white'}}}), ['cold']);
});

test('a mod race and feat: checked, traits get ids, subrace numbers and hit points come from effects', () => {
  const {race, traits} = normalizeModRace({
    id: 'mod_reedfolk', name: 'Тростниковый', size: 'small', speed: 25, bonuses: {dexterity: 2}, darkvision: 30,
    traits: [{name: 'Болотная кожа', effects: [{kind: 'resistance', damage: 'poison'}]}],
    subraces: [{id: 'mod_reed_deep', name: 'Глубинный', bonuses: {wisdom: 1}, speed: 30, traits: [{name: 'Жабры', text: 'Дышит под водой.', effects: [{kind: 'hp-per-level', value: 1}]}]}],
  }, 'Болота');
  assert.deepEqual([race.size, race.speed, race.darkvision, race.resistances, race.modName], ['small', 25, 30, ['poison'], 'Болота']);
  assert.deepEqual(race.traits, [['Болотная кожа', 'Сопротивление: яд']], 'no text — the effects describe it');
  assert.deepEqual([race.subraces[0]!.speed, race.subraces[0]!.hpPerLevel], [30, 1]);
  assert.deepEqual(traits.map(trait => [trait.id, trait.races, trait.subraces ?? null]), [
    ['mod_reedfolk-t1', ['mod_reedfolk'], null], ['mod_reedfolk-t2', ['mod_reedfolk'], ['mod_reed_deep']],
  ]);
  assert.throws(() => normalizeModRace({id: 'reedfolk', name: 'Без приставки'}, 'Болота'), /id — mod_/);
  assert.throws(() => normalizeModRace({id: 'mod_big', name: 'Великан', size: 'large'}, 'Болота'), /size — small или medium/);
  assert.throws(() => normalizeModRace({id: 'mod_odd', name: 'Странный', bonuses: {luck: 2}}, 'Болота'), /bonuses\.luck/);
  assert.throws(() => normalizeModRace({id: 'mod_odd', name: 'Странный', weapons: ['laser']}, 'Болота'), /weapons — оружие SRD/);

  const feat = normalizeModFeat({id: 'mod_swimmer', name: 'Пловец', en: 'Swimmer', abilities: ['strength'], effects: [{kind: 'speed', feet: 5}]}, 'Болота');
  assert.deepEqual([feat.text, feat.abilities, feat.modName], ['Скорость +5 фт.', ['strength'], 'Болота']);
  assert.ok(feat.pattern.test('Черта: пловец') && feat.pattern.test('Feat: Swimmer'));
  assert.throws(() => normalizeModFeat({id: 'mod_ix', name: 'Икс', abilities: ['luck']}, 'Болота'), /abilities/);
});
