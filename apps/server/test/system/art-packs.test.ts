import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {readArtPacks, readArtPackSection} = require('../../../desktop/host/art-packs.cjs');
const {loadMods} = await import('../../src/system/mods.ts');
const bundled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../mods');

test('art packs: sections, library groups, names; outside files and other kinds are left out', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ochag-art-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const mod = async (folder: string, manifest: Record<string, unknown>, files: Record<string, string> = {}) => {
    await mkdir(path.join(dir, folder), {recursive: true});
    await writeFile(path.join(dir, folder, 'mod.json'), JSON.stringify(manifest));
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, folder, name)), {recursive: true});
      await writeFile(path.join(dir, folder, name), content);
    }
  };
  await mod('a-portraits', {id: 'portraits', name: 'Портреты', version: '1.0', kind: 'art', library: 'library.json', translations: {en: {name: 'Portraits', sections: {bestiary: 'Bestiary', nope: 'x'}, extra: 1}, 'bad code!': {name: 'x'}}, sections: [
    {id: 'bestiary', name: 'Бестиарий', paths: ['portraits/bestiary/']},
    {id: 'items', name: 'Предметы', paths: ['items/']},
  ]}, {
    'art/portraits/bestiary/goblin.webp': 'RIFF-goblin',
    'art/portraits/bestiary/wolf.png': 'PNG-wolf',
    'art/items/gear/rope.webp': 'RIFF-rope',
    'art/notes.txt': 'not a picture',
    'library.json': JSON.stringify({groups: [{id: 'portraits/bestiary', label: 'Портреты · Бестиарий', section: 'Портреты', items: [
      {path: 'portraits/bestiary/goblin', label: 'Гоблин', names: ['Гоблин', 'goblin']},
      {path: 'portraits/bestiary/missing', label: 'Нет файла'},
    ]}]}),
  });
  await mod('b-visual', {id: 'theme', name: 'Тема', version: '1.0', kind: 'visual', styles: ['a.css']}, {'a.css': ''});
  await mod('c-broken', {id: 'broken', name: 'Без разделов', version: '1.0', kind: 'art'});
  await mod('d-escape', {id: 'escape', name: 'Побег', version: '1.0', kind: 'art', library: '../a-portraits/library.json', sections: [{id: 'all', name: 'Всё', paths: ['']}]});

  const packs = await readArtPacks([{dir, bundled: false}]);
  assert.deepEqual(packs.map((pack: any) => pack.id), ['portraits', 'broken', 'escape']);
  const [portraits, broken, escape] = packs;
  assert.equal(portraits.error, null);
  assert.equal(portraits.bundled, false);
  assert.deepEqual(portraits.translations, {en: {name: 'Portraits', sections: {bestiary: 'Bestiary'}}});
  assert.deepEqual(portraits.sections.map((section: any) => [section.id, section.count]), [['bestiary', 2], ['items', 1]]);
  assert.deepEqual(portraits.groups[0].items, [{path: 'portraits/bestiary/goblin', label: 'Гоблин', names: ['Гоблин', 'goblin']}]);
  assert.deepEqual(portraits.groups[1].items.map((item: any) => item.path), ['items/gear/rope', 'portraits/bestiary/wolf']);
  assert.match(broken.error, /sections/);
  assert.match(escape.error, /внутри папки мода|paths/);

  const files = await readArtPackSection([{dir, bundled: false}], 'portraits', 'bestiary');
  assert.deepEqual(files.map((file: any) => [file.path, file.type, Buffer.from(file.data, 'base64').toString()]), [
    ['portraits/bestiary/goblin', 'image/webp', 'RIFF-goblin'],
    ['portraits/bestiary/wolf', 'image/png', 'PNG-wolf'],
  ]);
  await assert.rejects(readArtPackSection([{dir, bundled: false}], 'portraits', 'nope'), /нет раздела/);
  await assert.rejects(readArtPackSection([{dir, bundled: false}], 'nope', 'bestiary'), /нет/);

  const server = await loadMods(dir);
  assert.deepEqual(server.list, []);
});

test('art packs: the bundled «ai-art» pack reads whole, off until turned on, every section has pictures', async () => {
  const [pack] = await readArtPacks([{dir: bundled, bundled: true}]);
  assert.equal(pack.id, 'ai-art');
  assert.equal(pack.error, null);
  assert.equal(pack.bundled, true);
  assert.doesNotMatch(pack.description, /helloiamsinan|стил/);
  assert.equal(pack.translations.en.name, 'AI-drawn pictures');
  assert.doesNotMatch(pack.translations.en.description, /helloiamsinan|style/);
  assert.deepEqual(Object.keys(pack.translations.en.sections), ['bestiary', 'heroes', 'townsfolk', 'classes', 'races', 'items', 'scene', 'symbols']);
  assert.deepEqual(pack.sections.map((section: any) => section.id), ['bestiary', 'heroes', 'townsfolk', 'classes', 'races', 'items', 'scene', 'symbols']);
  for (const section of pack.sections) assert.ok(section.count > 0, section.id);
  assert.equal(pack.sections.reduce((sum: number, section: any) => sum + section.count, 0), 212);
  assert.equal(pack.groups.flatMap((group: any) => group.items).length, 212);
  assert.ok(!pack.groups.some((group: any) => group.id === 'other'));
  const named = pack.groups.flatMap((group: any) => group.items).filter((item: any) => item.names);
  assert.equal(named.length, 78);
  const classes = await readArtPackSection([{dir: bundled, bundled: true}], 'ai-art', 'classes');
  assert.equal(classes.length, 12);
  assert.ok(classes.every((file: any) => file.type === 'image/webp' && file.data.length > 100));
});
