import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {MIGRATIONS} from '../../../../scripts/migrations.ts';

test('the migration list covers db/migrations and the server expects its last version', async () => {
  const files = (await readdir(new URL('../../../../db/migrations/', import.meta.url))).filter(name => /^\d{3}_.+\.sql$/.test(name)).sort();
  assert.deepEqual(MIGRATIONS.map(([, file]) => file), files, 'every migration file is listed, in order');
  MIGRATIONS.forEach(([version, file], index) => {
    assert.equal(version, index + 1, `${file}: versions go 1, 2, 3…`);
    assert.equal(Number(file.slice(0, 3)), version, `${file}: the number in the name is its version`);
  });
  const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /MIGRATIONS\[MIGRATIONS\.length-1\]/, 'main.ts takes the version from the list');
  assert.doesNotMatch(main, /!== \d+\)/, 'no hand-written schema version left in main.ts');
});
