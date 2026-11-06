import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';

const {missingVcRuntime, isDllNotFound, vcRuntimeError} = createRequire(import.meta.url)('../../../desktop/host/vc-runtime.cjs');

test('the GM server checks for the Visual C++ runtime the embedded PostgreSQL needs', () => {
  const root = 'C:\\Windows';
  const present = (names: string[]) => (file: string) => names.some(name => file === path.join(root, 'System32', name));

  assert.deepEqual(missingVcRuntime({systemRoot: root, exists: present(['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'])}), []);
  assert.deepEqual(missingVcRuntime({systemRoot: root, exists: present([])}), ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']);
  assert.deepEqual(missingVcRuntime({systemRoot: root, exists: present(['vcruntime140.dll'])}), ['vcruntime140_1.dll', 'msvcp140.dll'], 'an old 2015 runtime without vcruntime140_1 is not enough');

  assert.equal(isDllNotFound(new Error('Postgres init script failed (code: 3221225781, signal: null)')), true);
  assert.equal(isDllNotFound(new Error('Postgres init script failed (code: 1, signal: null)')), false);
  assert.equal(isDllNotFound(undefined), false);

  const error = vcRuntimeError();
  assert.equal(error.code, 'vc-runtime');
  assert.match(error.message, /Microsoft Visual C\+\+ Redistributable \(x64\)/);
});
