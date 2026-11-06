import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_ROWS, FEATURE_BUTTONS, FEATURE_TOGGLES, MULTIATTACK, choiceHead, choiceInput, featureButton, featureChips, featureHead, featureToggle, hasChoice, headIcon,
  isReady, maneuverToggles, multiattackOf, passiveIcon, rowActions, type CardFeature,
} from '../../src/actionBar/featureCards.ts';

const make = (over: Partial<CardFeature>): CardFeature => ({
  id: 'second-wind', name: 'Второе дыхание', detail: '1к10 + уровень', active: false, available: true, reason: null, resource: null, ...over,
});

test('simple buttons show detail, uses left and the reason', () => {
  const card = featureButton(make({ resource: { current: 1, max: 1 }, reason: 'не в бою' }), false);
  assert.deepEqual(card, { icon: 'heartPlus', label: 'Второе дыхание', note: '1к10 + уровень · 1/1 · не в бою', active: false, blocked: false });
  assert.equal(featureButton(make({ id: 'action-surge', name: 'Всплеск действий', detail: 'ещё действие' }), false).icon, 'bolt');
  assert.equal(featureButton(make({ id: 'wholeness-of-body', name: 'Путь открытой ладони: Целостность тела' }), false).label, 'Целостность тела');
  assert.equal(featureButton(make({ available: false }), false).blocked, true);
});

test('rage switches its label and hides the reason while raging', () => {
  assert.equal(featureButton(make({ id: 'rage', name: 'Ярость' }), false).label, 'Ярость');
  assert.equal(featureButton(make({ id: 'rage', name: 'Ярость' }), true).label, 'Ярость — в бешенство');
  const raging = featureButton(make({ id: 'rage', name: 'Ярость', active: true, reason: 'уже в ярости' }), true);
  assert.equal(raging.label, 'Закончить ярость');
  assert.equal(raging.note, '1к10 + уровень');
  assert.equal(raging.active, true);
});

test('channel divinity is locked while active and named without the prefix', () => {
  const card = featureButton(make({ id: 'turn-undead', name: 'Божественный канал: Изгнание нежити', detail: 'спасбросок МДР', active: true, resource: { current: 0, max: 1 } }), false);
  assert.equal(card.label, 'Изгнание нежити');
  assert.equal(card.note, 'Божественный канал · спасбросок МДР · 0/1');
  assert.equal(card.icon, 'holy');
  assert.equal(card.blocked, true);
});

test('aimed buttons hint at a map click when nothing blocks them', () => {
  const flurry = featureButton(make({ id: 'flurry-of-blows', name: 'Шквал ударов', detail: 'два удара; цель — выбранная', resource: { current: 3, max: 4 } }), false);
  assert.equal(flurry.label, 'Шквал ударов…');
  assert.equal(flurry.note, 'два удара · ци 3/4 · цель — щелчком по карте');
  const patient = featureButton(make({ id: 'patient-defense', name: 'Терпеливая оборона', detail: 'Уклонение', resource: { current: 3, max: 4 } }), false);
  assert.equal(patient.note, 'Уклонение · ци 3/4');
  const fear = featureButton(make({ id: 'intimidating-presence', name: 'Путь берсерка: Пугающее присутствие', detail: 'испуг, цель в 30 фт. — выбранная' }), false);
  assert.equal(fear.label, 'Пугающее присутствие…');
  assert.equal(fear.note, 'испуг · цель — щелчком по карте');
  assert.equal(featureButton(make({ id: 'intimidating-presence', name: 'x', detail: 'испуг', reason: 'действие потрачено' }), false).note, 'испуг · действие потрачено');
});

test('dragon wings can be folded even when not available', () => {
  const open = featureButton(make({ id: 'dragon-wings', name: 'Драконья кровь: Крылья', active: true, available: false }), false);
  assert.deepEqual([open.label, open.blocked, open.active], ['Сложить крылья', false, true]);
  const closed = featureButton(make({ id: 'dragon-wings', name: 'Драконья кровь: Крылья', available: false }), false);
  assert.deepEqual([closed.label, closed.blocked], ['Крылья', true]);
  assert.equal(featureButton(make({ id: 'countercharm', name: 'Контрочарование', detail: 'до конца хода', resource: { current: 1, max: 1 } }), false).note, 'до конца хода');
});

test('the button list and passive icons', () => {
  assert.equal(FEATURE_BUTTONS.size, 18);
  assert.equal(FEATURE_BUTTONS.has('bardic-inspiration'), false);
  assert.equal(passiveIcon({ id: 'sneak-attack', name: 'Скрытая атака' }), 'dagger');
  assert.equal(passiveIcon({ id: 'unarmored-defense', name: 'Защита без доспехов' }), 'shield');
  assert.equal(passiveIcon({ id: 'darkvision', name: 'Раса: Тёмное зрение' }), 'person');
  assert.equal(passiveIcon({ id: 'extra-attack', name: 'Дополнительная атака' }), 'sparkle');
});

test('row heads show icon, short name and the note', () => {
  assert.deepEqual(featureHead(make({ id: 'bardic-inspiration', name: 'Вдохновение барда', detail: 'к8, кому — выбранная цель', resource: { current: 2, max: 3 } })), { icon: 'music', label: 'Вдохновение барда', note: 'к8 · 2/3' });
  assert.equal(featureHead(make({ id: 'step-of-the-wind', name: 'Поступь ветра', resource: { current: 3, max: 5 } })).note, 'ци 3/5');
  assert.equal(featureHead(make({ id: 'step-of-the-wind', name: 'Поступь ветра' })).note, '');
  assert.equal(featureHead(make({ id: 'lay-on-hands', name: 'Наложение рук', resource: { current: 20, max: 25 } })).note, 'запас 20/25');
  const presence = featureHead(make({ id: 'draconic-presence', name: 'Драконья кровь: Драконье присутствие', detail: 'аура', resource: { current: 5, max: 10 } }));
  assert.deepEqual([presence.label, presence.note], ['Драконье присутствие', 'аура · очки 5/10']);
  assert.equal(featureHead(make({ id: 'frenzy', name: 'Путь берсерка: Бешенство', detail: 'атака бонусным' })).note, 'атака бонусным');
  assert.equal(featureHead(make({ id: 'open-hand-technique', name: 'Путь открытой ладони: Техника' })).label, 'Техника');
  assert.equal(featureHead(make({ id: 'cunning-action', name: 'Хитрое действие' })).note, null);
  assert.deepEqual(featureHead(make({ id: 'feats', name: 'Черты' })), { icon: 'star', label: 'Черты', note: null });
  assert.equal(featureHead(make({ id: 'signature-spells', name: 'Фирменные заклинания' })).icon, 'sparkle');
  assert.equal(headIcon('metamagic'), 'sparkle');
  assert.equal(headIcon('eldritch-invocations'), 'sparkle');
});

test('choice heads show points and the detail only where it helps', () => {
  assert.deepEqual(choiceHead(make({ id: 'metamagic', name: 'Метамагия', resource: { current: 4, max: 5 } })), { icon: 'sparkle', label: 'Метамагия', points: 'очки 4/5', detail: null });
  assert.deepEqual(choiceHead(make({ id: 'hunters-prey', name: 'Охотник: Добыча охотника', detail: '' })), { icon: 'target', label: 'Добыча охотника', points: null, detail: '' });
  assert.equal(choiceHead(make({ id: 'combat-superiority', name: 'Превосходство', resource: { current: 3, max: 4 } })).points, 'кости 3/4');
  assert.equal(choiceHead(make({ id: 'eldritch-invocations', name: 'Воззвания', detail: '2 из 2' })).detail, null);
  assert.equal(choiceInput('hunters-prey'), 'radio');
  assert.equal(choiceInput('elemental-affinity'), 'radio');
  assert.equal(choiceInput('metamagic'), 'checkbox');
});

test('action rows list their buttons and what each one calls', () => {
  assert.deepEqual([...ACTION_ROWS], ['step-of-the-wind', 'draconic-presence', 'cunning-action']);
  assert.deepEqual(rowActions('step-of-the-wind').map(action => [action.label, action.icon, action.call]), [
    ['Рывок', 'run', { kind: 'feature', id: 'step-of-the-wind', mode: 'dash' }],
    ['Отход', 'door', { kind: 'feature', id: 'step-of-the-wind', mode: 'disengage' }],
  ]);
  assert.deepEqual(rowActions('draconic-presence').map(action => [action.label, action.icon]), [['Аура страха', null], ['Аура очарования', null]]);
  assert.deepEqual(rowActions('cunning-action').map(action => action.call), [
    { kind: 'standard', action: 'dash', using: 'bonus' },
    { kind: 'standard', action: 'disengage', using: 'bonus' },
    { kind: 'stealth', action: 'hide', using: 'bonus' },
  ]);
  assert.equal([...ACTION_ROWS].some(id => FEATURE_BUTTONS.has(id) || FEATURE_TOGGLES.has(id)), false);
  assert.deepEqual(rowActions('rage'), []);
});

test('choice rows read picked options and ready reactions from the feature', () => {
  const feats = make({ id: 'feats', name: 'Черты', choices: [{ value: 'lucky', label: 'Везунчик', active: true }, { value: 'tough', label: 'Крепкий' }], ready: ['lucky'] });
  assert.deepEqual([hasChoice(feats, 'lucky'), hasChoice(feats, 'tough'), hasChoice(feats, 'alert')], [true, false, false]);
  assert.deepEqual([isReady(feats, 'lucky'), isReady(make({}), 'lucky')], [true, false]);
  const superiority = make({ id: 'combat-superiority', name: 'Превосходство', choices: [{ value: 'riposte', label: 'Ответный удар', active: true }, { value: 'parry', label: 'Парирование' }] });
  assert.deepEqual(maneuverToggles(superiority).map(toggle => toggle.key), ['riposte']);
  const both = make({ id: 'combat-superiority', name: 'Превосходство', choices: [{ value: 'riposte', label: 'Ответный удар', active: true }, { value: 'parry', label: 'Парирование', active: true }] });
  assert.deepEqual(maneuverToggles(both).map(toggle => toggle.label), ['Парирование', 'Ответный удар']);
  const hunter = (value: string) => make({ id: 'hunter-multiattack', name: 'Мультиатака', choices: [{ value, label: value, active: true }] });
  assert.equal(multiattackOf(hunter('volley')), 'volley');
  assert.equal(multiattackOf(hunter('whirlwind')), 'whirlwind');
  assert.equal(multiattackOf(hunter('other')), null);
  assert.equal(MULTIATTACK.volley.label, 'Залп по цели…');
});

test('chips list picked choices and offer the rest', () => {
  const feats = featureChips(make({ id: 'feats', name: 'Черты', choices: [
    { value: 'alert', label: 'Бдительный', active: true, count: 0 },
    { value: 'tough', label: 'Крепкий', hint: 'хиты' },
  ] }));
  assert.deepEqual(feats.chips, [{ value: 'alert', name: 'Бдительный', label: 'Бдительный', hint: undefined, spent: true }]);
  assert.deepEqual(feats.add, { placeholder: '+ черта…', ariaLabel: 'Добавить черту', options: [{ value: 'tough', label: 'Крепкий — хиты' }] });
  const signature = (active: boolean) => featureChips(make({ id: 'signature-spells', name: 'Фирменные заклинания', choices: [
    { value: 'a', label: 'Огненный шар', active: true, count: 0 },
    { value: 'b', label: 'Молния', active },
    { value: 'c', label: 'Стена огня' },
  ] }));
  assert.equal(signature(true).chips[0]!.label, 'Огненный шар · потрачено');
  assert.equal(signature(true).add, null);
  assert.equal(signature(false).add?.options.length, 2);
  assert.equal(featureChips(make({ id: 'fighting-styles', name: 'Стили', choices: [{ value: 'defense', label: 'Оборона', active: true }] })).add, null);
});

test('ready toggles keep their own short notes', () => {
  assert.deepEqual(featureToggle(make({ id: 'protection-style', name: 'Боевой стиль «Защита»', detail: 'не наготове' })), { icon: 'shield', label: 'Боевой стиль «Защита»', note: null, active: false });
  assert.equal(featureToggle(make({ id: 'deflect-missiles', name: 'Отражение снарядов', detail: 'наготове: урон меньше на 1к10' })).note, 'урон меньше на 1к10');
  assert.equal(featureToggle(make({ id: 'deflect-missiles', name: 'Отражение снарядов', detail: 'не наготове: урон меньше на 1к10' })).note, 'урон меньше на 1к10');
  assert.equal(featureToggle(make({ id: 'deflect-missiles', name: 'Отражение снарядов', detail: '' })).note, '');
  const retaliation = featureToggle(make({ id: 'retaliation', name: 'Путь берсерка: Возмездие', active: true }));
  assert.deepEqual([retaliation.label, retaliation.note, retaliation.active], ['Возмездие', 'ранили в 5 фт. — реакцией удар', true]);
  assert.equal(featureToggle(make({ id: 'uncanny-dodge', name: 'Невероятное уклонение' })).note, 'урон попавшей атаки вдвое, реакцией');
  assert.equal(featureToggle(make({ id: 'cutting-words', name: 'Острые слова', detail: 'наготове: кость вдохновения', resource: { current: 2, max: 3 } })).note, 'кость вдохновения · 2/3');
  assert.equal(FEATURE_TOGGLES.size, 5);
  assert.equal([...FEATURE_TOGGLES].some(id => FEATURE_BUTTONS.has(id)), false);
});
