import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SRD_CONDITION_RULES, describeRule, lastsMinutes, linkedCodes, normalizeClause, repeatSaveOf, ruleClauses, stageIndex } from './condition-rules.ts';
import { conditionRollBonus, conditionState, incapacitatedReason, isIncapacitated } from './conditions.ts';

const srd = (code: string) => SRD_CONDITION_RULES.get(code)!;

test('SRD diseases and poisons are rules like the conditions: stages, links, courses, durations', () => {
  const rot = srd('sight_rot');
  assert.deepEqual([rot.kind, rot.stages?.length], ['disease', 5]);
  assert.deepEqual([stageIndex(rot, 9), stageIndex(rot, -2), stageIndex(srd('malice'), 3)], [4, 0, 0]);
  assert.equal(ruleClauses(rot, 0).filter(entry => entry.kind === 'roll-bonus').length, 2, 'the common clauses plus the first stage');
  assert.deepEqual([linkedCodes(rot, 4), linkedCodes(rot, 0)], [['blinded'], []]);
  const course = repeatSaveOf(rot)!;
  assert.deepEqual([course.ability, course.when, course.onFail], ['none', 'long-rest', 'worse']);
  const pale = repeatSaveOf(srd('pale_tincture'))!;
  assert.deepEqual([pale.when, pale.wins, pale.onFail, pale.damage, pale.damageType], ['day', 7, 'damage', '1d6', 'poison']);
  assert.deepEqual([lastsMinutes(srd('malice')), lastsMinutes(srd('oil_of_taggit')), lastsMinutes(srd('torpor'))], [60, 1440, null]);
  assert.equal(repeatSaveOf(srd('cackle_fever'))!.onWin, 'easier');
  assert.match(describeRule(rot), /Стадия 5 — слепота: .*Вместе с ним — состояние «ослеплён»\./);
});

test('a condition brings another along: crawler mucus paralyses, sight rot blinds at its last stage', () => {
  const mucus = conditionState(['crawler_mucus']);
  assert.ok(mucus.codes.has('poisoned') && mucus.codes.has('paralyzed'));
  assert.equal(mucus.linked?.get('paralyzed'), 'crawler_mucus');
  assert.deepEqual([isIncapacitated(mucus), incapacitatedReason(mucus)], [true, 'парализован']);
  assert.ok(conditionState(['sight_rot'], undefined, undefined, new Map([['sight_rot', 4]])).codes.has('blinded'));
  assert.equal(conditionState(['sight_rot']).codes.has('blinded'), false);
  const sources = new Map([['malice', new Set(['witch'])]]);
  assert.ok(conditionState(['malice'], undefined, sources).sources?.get('blinded')?.has('witch'), 'the source carries over to what it brings');
});

test('a roll bonus clause adds a plain number: sight rot takes 1 to 5 from attacks and sight checks', () => {
  assert.deepEqual(conditionRollBonus(conditionState(['sight_rot']), 'attack', null), { value: -1, reasons: ['Глазная гниль'] });
  const late = conditionState(['sight_rot'], undefined, undefined, new Map([['sight_rot', 3]]));
  assert.equal(conditionRollBonus(late, 'attack', null).value, -4);
  assert.equal(conditionRollBonus(late, 'skill', 'wisdom', 'sight').value, -4);
  assert.equal(conditionRollBonus(late, 'skill', 'wisdom', 'hearing').value, 0);
  assert.equal(conditionRollBonus(late, 'save', 'constitution').value, 0);
});

test('the course clause keeps old saved clauses meaning what they meant and refuses a broken damage formula', () => {
  const old = normalizeClause({ kind: 'repeat-save', values: { ability: 'constitution', dc: '12', when: 'long-rest', wins: '2', onFail: 'exhaustion' } })!;
  assert.equal(old.values.onWin, 'ends');
  assert.equal(describeRule({ clauses: [old] }), 'Спасбросок Телосложения (СЛ 12) после каждого долгого отдыха: 2 успеха снимают состояние, каждый провал — степень истощения.');
  assert.equal(normalizeClause({ kind: 'repeat-save', values: { onFail: 'damage', damage: 'rm -rf' } })!.values.damage, '1d6');
  assert.equal(normalizeClause({ kind: 'repeat-save', values: { onFail: 'damage', damage: '2к4+1' } })!.values.damage, '2к4+1');
  assert.equal(
    describeRule({ clauses: [srd('pale_tincture').clauses[1]!] }),
    'Спасбросок Телосложения (СЛ 16) каждый день по часам кампании: 7 успехов снимают состояние; провал — 1d6 урона, яд.',
  );
});

test('the migration lets the GM edit every SRD rule', () => {
  const sql = readFileSync(new URL('../../../db/migrations/117_mod_conditions.sql', import.meta.url), 'utf8');
  const listed = /\^\(custom_\[a-z0-9\]\{6,40\}\|mod_\[a-z0-9_\]\{2,40\}\|([a-z_|]+)\)\$/.exec(sql)![1]!.split('|');
  assert.deepEqual(listed.sort(), [...SRD_CONDITION_RULES.keys()].sort());
});
