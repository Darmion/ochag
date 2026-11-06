import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bestiaryPortrait, artImageId, artImageUrl, classCrest, heroPortraitPaths, isArtImageId, npcPortraitPath, objectImageId,
} from '../../src/art/portraitArt.ts';
import { SRD_MONSTERS } from '../../../../packages/domain/srd/monsters.ts';
import { builtWithPack as built, pathOfUrl, useArtPack } from './artPack.ts';

const builtUrl = (url: string) => built(pathOfUrl(url));

useArtPack(true);

test('with the ai-art pack every bestiary monster has a portrait, found by the name the bestiary gives it', () => {
  for (const monster of SRD_MONSTERS) {
    const path = npcPortraitPath(monster.nameRu);
    assert.equal(path, `portraits/bestiary/${monster.index}`, monster.nameRu);
    assert.ok(built(path!), path!);
    assert.equal(bestiaryPortrait(monster.index), `/art/${path}.webp`, monster.index);
    assert.equal(npcPortraitPath(`${monster.nameRu} 3`), path, `${monster.nameRu} 3`);
    assert.equal(npcPortraitPath(monster.name), path, monster.name);
  }
  assert.equal(npcPortraitPath('Гоблин-вожак 2'), 'portraits/bestiary/goblin-boss');
  assert.equal(npcPortraitPath('Гоблин 2'), 'portraits/bestiary/goblin');
  assert.equal(npcPortraitPath('Гоблинский шаман'), null);
  assert.equal(npcPortraitPath('Волкодав'), null);
  assert.equal(npcPortraitPath('Лютоволк'), 'portraits/bestiary/dire-wolf');
  assert.equal(npcPortraitPath('Оживленные доспехи'), 'portraits/bestiary/animated-armor');
  assert.equal(npcPortraitPath(''), null);
});

test('common townsfolk by the start of the name; women before men', () => {
  assert.equal(npcPortraitPath('Торговка рыбой'), 'portraits/npc/merchant-female');
  assert.equal(npcPortraitPath('Торговец Ахмед'), 'portraits/npc/merchant-male');
  assert.equal(npcPortraitPath('Горожанка'), 'portraits/npc/townsperson-female');
  assert.equal(npcPortraitPath('Житель деревни'), 'portraits/npc/townsperson-male');
  assert.equal(npcPortraitPath('Стражница у ворот'), 'portraits/npc/guard-female');
  assert.equal(npcPortraitPath('Стражник 2'), 'portraits/bestiary/guard');
  assert.equal(npcPortraitPath('Старый торговец'), null);
  for (const path of ['merchant-female', 'merchant-male', 'townsperson-female', 'townsperson-male', 'guard-female', 'guard-male']) {
    assert.ok(built(`portraits/npc/${path}`), path);
  }
});

test('an object shows its own picture; an NPC without one — the portrait by name; heroes and things — nothing', () => {
  assert.equal(objectImageId({ kind: 'npc', name: 'Гоблин 2', image_asset_id: 'asset-1' }), 'asset-1');
  const id = objectImageId({ kind: 'npc', name: 'Гоблин 2', image_asset_id: null });
  assert.equal(id, artImageId('portraits/bestiary/goblin'));
  assert.ok(isArtImageId(id!));
  assert.equal(artImageUrl(id!), '/art/portraits/bestiary/goblin.webp');
  assert.ok(!isArtImageId('0f8e3c1a-1111-4222-8333-444455556666'));
  assert.equal(objectImageId({ kind: 'character', name: 'Волк', image_asset_id: null }), null);
  assert.equal(objectImageId({ kind: 'object', name: 'Мимик', image_asset_id: null }), null);
  assert.equal(objectImageId({ kind: 'npc', name: 'Безымянный', image_asset_id: null }), null);
});

test('hero portraits by race, class crests and race signs are built', () => {
  assert.deepEqual(heroPortraitPaths('elf'), ['portraits/heroes/elf-male', 'portraits/heroes/elf-female']);
  assert.equal(heroPortraitPaths('custom').length, 18);
  assert.equal(heroPortraitPaths(null).length, 18);
  for (const path of heroPortraitPaths(null)) assert.ok(built(path), path);
  for (const id of ['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard']) {
    assert.ok(builtUrl(classCrest(id)!), id);
  }
  assert.equal(classCrest('artificer'), null);
});

test('without the ai-art pack: no portraits or crests — a letter is shown instead', () => {
  useArtPack(false);
  try {
    assert.equal(bestiaryPortrait('goblin'), null);
    assert.equal(npcPortraitPath('Гоблин 2'), null);
    assert.equal(npcPortraitPath('Торговец Ахмед'), null);
    assert.equal(objectImageId({ kind: 'npc', name: 'Гоблин 2', image_asset_id: null }), null);
    assert.equal(artImageUrl(artImageId('portraits/bestiary/goblin')), null);
    assert.deepEqual(heroPortraitPaths(null), []);
    assert.equal(classCrest('bard'), null);
    assert.equal(artImageUrl(artImageId('items/weapons/daggers/dagger')), '/art/items/weapons/daggers/dagger.webp');
  } finally {
    useArtPack(true);
  }
});
