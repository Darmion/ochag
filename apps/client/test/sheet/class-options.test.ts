import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLASS_OPTIONS, classText } from '../../src/rules/classOptions.ts';
import { CLASS_LABELS, SUBCLASSES, characterClassLevels, type ClassId } from '../../../../packages/domain/character/classes.ts';

// Each listed subclass must resolve to itself, not to the SRD default, or automation would silently use another subclass's features.
test('every subclass in the client list resolves to its own subclass in the domain', () => {
  for (const option of CLASS_OPTIONS) {
    const classId = (Object.entries(CLASS_LABELS) as Array<[ClassId, string]>).find(([, label]) => label === option.label)?.[0];
    assert.ok(classId, option.label);
    const rule = SUBCLASSES[classId!];
    for (const name of [...option.subclasses, ...option.others]) {
      const resolved = characterClassLevels({ class_name: classText(option.label, name), level: 20 });
      assert.equal(resolved.classes.length, 1, `${option.label} (${name}): one class, not ${JSON.stringify(resolved)}`);
      if (!rule) continue;
      const expected = rule.list.find(entry => entry.nameRu === name);
      assert.ok(expected, `${option.label}: «${name}» is in SUBCLASSES`);
      assert.equal(resolved.classes[0]!.subclass, expected!.id, `${option.label} (${name})`);
    }
    if (rule) {
      const listed = new Set([...option.subclasses, ...option.others]);
      for (const entry of rule.list) if (entry.id !== 'other') assert.ok(listed.has(entry.nameRu), `${option.label}: «${entry.nameRu}» is offered`);
    }
  }
});

test('old sheets keep working: «Другая клятва» still resolves, unknown text falls back to the generic entry', () => {
  assert.equal(characterClassLevels({ class_name: 'Паладин (Клятва чего-то своего)', level: 5 }).classes[0]!.subclass, 'other');
  assert.equal(characterClassLevels({ class_name: 'Паладин', level: 5 }).classes[0]!.subclass, 'devotion');
  assert.equal(characterClassLevels({ class_name: 'Жрец (Twilight Domain)', level: 5 }).classes[0]!.subclass, 'twilight');
  assert.equal(characterClassLevels({ class_name: 'Следопыт (Сумрачный странник)', level: 5 }).classes[0]!.subclass, 'gloom-stalker');
  assert.equal(characterClassLevels({ class_name: 'Паладин 3 (Клятвопреступник)', level: 3 }).classes[0]!.subclass, 'oathbreaker');
});
