import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAction, emptyEffect, emptyTemplate, type Scaling } from '../../../../packages/domain/spells/spell-template.ts';
import {
  checkActionBlocks, checkFacts, countSectionBadges, highlightPhrases, scalingSegments, sectionOfIssue, suggestedActions, summarizeSections,
} from '../../src/spellBuilder/overview.ts';
import type { SuggestionState } from '../../src/spellBuilder/types.ts';

const suggestion = (phrase: string, status: SuggestionState['status'] = 'suggested', path = 'casting.time'): SuggestionState => ({
  id: phrase, path, label: 'x', value: null, display: 'x', phrase, confidence: 'sure', status,
});
const same = (text: string) => text;

function zoneAction() {
  const zone = emptyAction('Зона');
  const effect = emptyEffect('zone');
  effect.actions.push(emptyAction('Внутри'));
  zone.outcomes.always = [effect];
  return zone;
}

test('description phrases of open suggestions are marked in reading order', () => {
  const text = 'Каждое существо в сфере радиусом 20 футов получает 8к6 урона огнём.';
  const parts = highlightPhrases(text, [suggestion('урона огнём'), suggestion('в сфере радиусом 20 футов … получает'), suggestion('8к6', 'accepted'), suggestion('огн')]);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts.filter(part => part.mark).map(part => part.text), ['в сфере радиусом 20 футов', 'получает', 'урона огнём']);
  assert.deepEqual(highlightPhrases('Каждое существо', [suggestion('КАЖДОЕ')]).filter(part => part.mark).map(part => part.text), ['Каждое']);
  assert.deepEqual(highlightPhrases(text, [suggestion('8к6', 'cleared')]), [{ text, mark: false }]);
});

test('an issue path points to its table section', () => {
  assert.equal(sectionOfIssue('Г2'), 'targeting');
  assert.equal(sectionOfIssue('Ж: Ещё удар'), 'commands');
  assert.equal(sectionOfIssue('При окончании, «Вспышка»'), 'ending');
  assert.equal(sectionOfIssue('Режим «Холод»'), 'options');
  assert.equal(sectionOfIssue('«Луч»: попадание'), 'actions');
});

test('section badges count errors, warnings and open suggestions', () => {
  const badges = countSectionBadges(
    { errors: [{ path: 'Г2' }, { path: 'Г3' }], warnings: [{ path: 'А1' }] },
    [suggestion('a', 'suggested', 'actions[+]'), suggestion('b', 'suggested', 'casting.time')],
  );
  assert.deepEqual(badges, {
    targeting: { errors: 2, warnings: 0, pending: 0 },
    passport: { errors: 0, warnings: 1, pending: 0 },
    actions: { errors: 0, warnings: 0, pending: 1 },
    casting: { errors: 0, warnings: 0, pending: 1 },
  });
});

test('a suggested action lists itself and the actions of its zone', () => {
  const entry = suggestion('x', 'suggested', 'actions[+]');
  entry.value = zoneAction();
  assert.deepEqual(suggestedActions(entry).map(item => `${item.depth}:${item.action.name}`), ['0:Зона', '1:Внутри']);
  assert.deepEqual(suggestedActions(suggestion('x')), []);
});

test('the check step lists actions of zones, modes and the ending', () => {
  const template = emptyTemplate();
  template.actions.push(zoneAction());
  template.options.modes.push({ id: 'm1', name: 'Холод', actions: [emptyAction('Режимное')] });
  template.ending.onEnd.push(emptyAction('Финал'));
  assert.deepEqual(checkActionBlocks(template).map(block => `${block.section}|${block.scope}|${block.scopeUser}|${block.depth}|${block.name}`), [
    'actions||false|0|Зона', 'actions|В зоне|false|1|Внутри', 'options|Холод|true|0|Режимное', 'ending|При окончании|false|0|Финал',
  ]);
});

test('scaling reads as what, how much, how and from which level', () => {
  const rule: Scaling = { id: 's', what: 'damage', per: 'slot', ref: '', amount: '1к6', steps: [] };
  assert.deepEqual(scalingSegments(rule, 3, same).map(segment => segment.text), ['урон', '1к6', 'за каждый круг выше', '3']);
  assert.equal(scalingSegments(rule, 3, text => text.toUpperCase())[1]!.text, '1К6');
  const steps: Scaling = { ...rule, per: 'steps', steps: [[4, '9к6'], [6, '11к6']] };
  assert.deepEqual(scalingSegments(steps, 3, same).map(segment => segment.text), ['урон', '4 → 9к6, 6 → 11к6', 'ступенями по кругу ячейки']);
});

test('collapsed sections and the check step summarize the template', () => {
  const template = emptyTemplate();
  template.actions.push(emptyAction('Луч'));
  template.options.modes.push({ id: 'm1', name: 'Холод', actions: [] });
  template.options.params.push({ id: 'p1', key: 'стихия', label: 'Стихия', kind: 'damage-type', options: [], chooser: 'caster' });
  template.scaling.push({ id: 's', what: 'damage', per: 'slot', ref: '', amount: '1к6', steps: [] });
  template.commands.push({ id: 'c1', name: 'Ещё удар', cost: 'bonus', when: 'after-cast', does: 'run-action', feet: 20, actionId: '', limit: 'turn', limitCount: 1 });
  const summary = summarizeSections(template, '3 круг', 'Воплощение', text => `[${text}]`);
  assert.deepEqual(summary.passport!.map(segment => segment.text), ['3 круг', 'Воплощение']);
  assert.deepEqual(summary.options!.map(segment => segment.text), ['режимов: 1', 'параметров: 1']);
  assert.deepEqual(summary.actions, [{ text: 'Луч', user: true }]);
  assert.match(summary.casting![0]!.text, /^\[.+\]$/);
  assert.deepEqual(summary.scaling!.map(segment => segment.text), ['урон', '[1к6]']);
  assert.deepEqual(checkFacts(template, same).map(fact => fact.label), ['Сотворение', 'Длительность', 'Цели', 'При сотворении выбирают', 'Режимы', 'Усиление на кругах', 'Команды']);
  template.ending.casterDown = true;
  assert.equal(checkFacts(template, same).at(-1)!.label, 'Кончается досрочно');
});
