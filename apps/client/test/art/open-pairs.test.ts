import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boardImageId, openArtChoices, openArtFor} from '../../src/art/openPairs.ts';

const library = readFileSync(new URL('../../src/art/artLibrary.json', import.meta.url), 'utf8');

test('a closed chest from the library has its open picture, and every pair is in the library', () => {
  assert.equal(openArtFor('scene/containers/chests/chest-wooden-closed'), 'scene/containers/chests/chest-wooden-open');
  assert.equal(openArtFor('scene/containers/chests/mimic-closed'), 'scene/containers/chests/mimic-open');
  assert.equal(openArtFor('scene/containers/barrel'), null, 'a barrel does not open');
  const choices = openArtChoices('scene/containers/chests/chest-royal-closed');
  assert.equal(choices[0], 'scene/containers/chests/chest-royal-gems', 'its own pair first');
  assert.equal(new Set(choices).size, choices.length);
  for (const path of choices) assert.ok(library.includes(`"${path}"`), `${path} is in the art library`);
});

test('the board shows the open picture only while the object is open', () => {
  const chest = {image_open_asset_id: 'lid', state: {open: false}};
  assert.equal(boardImageId(chest, 'closed'), 'closed');
  assert.equal(boardImageId({...chest, state: {open: true}}, 'closed'), 'lid');
  assert.equal(boardImageId({image_open_asset_id: null, state: {open: true}}, 'closed'), 'closed', 'no second picture — the same one');
});
