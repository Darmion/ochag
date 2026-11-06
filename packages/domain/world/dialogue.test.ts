import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dialogueProblems, nextNode, type DialogueNode} from './dialogue.ts';

const isSkill = (skill: string) => ['persuasion', 'intimidation'].includes(skill);
const tree: DialogueNode[] = [
  {id: 'start', text: 'Чего надо?', options: [
    {id: 'ask', label: 'Где барон?', next: 'baron'},
    {id: 'press', label: 'Говори, или пожалеешь.', next: null, check: {skill: 'intimidation', dc: 12, success: 'baron', failure: 'angry'}},
    {id: 'bye', label: 'Ничего.', next: null},
  ]},
  {id: 'baron', speaker: 'Трактирщик', text: 'Уехал к мельнице.', options: []},
  {id: 'angry', text: 'Вон отсюда!', options: []},
];

test('a sound tree has no problems', () => {
  assert.deepEqual(dialogueProblems(tree, 'start', isSkill), []);
});

test('broken links, duplicate codes, unknown skills and bad DCs are named', () => {
  const broken: DialogueNode[] = [
    {id: 'start', text: 'Да?', options: [{id: 'a', label: 'Дальше', next: 'nowhere'}, {id: 'a', label: 'Убедить', next: null, check: {skill: 'luck', dc: 50, success: null, failure: 'start'}}]},
    {id: 'start', text: '', options: []},
  ];
  const problems = dialogueProblems(broken, 'start', isSkill);
  assert.ok(problems.some(p => p.includes('«nowhere»')));
  assert.ok(problems.some(p => p.includes('повторяется')));
  assert.ok(problems.some(p => p.includes('«luck»')));
  assert.ok(problems.some(p => p.includes('СЛ')));
  assert.ok(problems.some(p => p.includes('пустая')));
  assert.deepEqual(dialogueProblems([], 'start', isSkill), ['В разговоре нет ни одной реплики.']);
  assert.ok(dialogueProblems(tree, 'missing', isSkill).some(p => p.includes('Начальной')));
});

test('a check goes its own way on success and on failure', () => {
  const press = tree[0]!.options[1]!;
  assert.equal(nextNode(press, true), 'baron');
  assert.equal(nextNode(press, false), 'angry');
  assert.equal(nextNode(tree[0]!.options[0]!, null), 'baron');
  assert.equal(nextNode(tree[0]!.options[2]!, null), null, 'the end');
});
