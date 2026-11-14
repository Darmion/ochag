import {test} from 'node:test';
import assert from 'node:assert/strict';
import {movesToTable, srdParityAll} from '../../src/spells/srd-parity.ts';

test('every SRD spell is cast by its table, and the table gives what the old text path gave, at every slot and hero level', () => {
  const results = srdParityAll();
  assert.equal(results.length, 319);
  const off = results.filter(result => !movesToTable(result)).map(result => `${result.index}: ${JSON.stringify(result.differences)}${result.zone ? ' (zone)' : ''}`);
  assert.deepEqual(off, [], 'an accepted difference goes to TEXT_ERRORS or ZONES_CHECKED with its reason');
});
