import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {readVisualMods} = require('../../../desktop/host/visual-mods.cjs');
const examples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../examples/mods');

test('visual mods: styles with inlined pictures; outside paths and remote links do not load', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ochag-visual-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const mod = async (folder: string, manifest: Record<string, unknown>, files: Record<string, string> = {}) => {
    await mkdir(path.join(dir, folder), {recursive: true});
    await writeFile(path.join(dir, folder, 'mod.json'), JSON.stringify(manifest));
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, folder, name)), {recursive: true});
      await writeFile(path.join(dir, folder, name), content);
    }
  };
  await writeFile(path.join(dir, 'secret.png'), 'not yours');
  await mod('a-theme', {id: 'theme', name: 'Тема', version: '1.0', kind: 'visual', styles: ['css/main.css']}, {
    'css/main.css': ':root{--x:url("../img/dot.svg")} .a{background:url(../../secret.png)} .b{background:url(https://example.com/x.png)} .c{background:url(missing.png)}',
    'img/dot.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  });
  await mod('b-mechanics', {id: 'rules', name: 'Правила', version: '1.0'}, {'index.js': 'export default () => {}'});
  await mod('c-escape', {id: 'escape', name: 'Побег', version: '1.0', kind: 'visual', styles: ['../a-theme/css/main.css']});
  await mod('d-js', {id: 'scripty', name: 'Скрипт', version: '1.0', kind: 'visual', styles: ['run.js']}, {'run.js': 'alert(1)'});
  await mod('e-off', {id: 'off', name: 'Выключен', version: '1.0', kind: 'visual', enabled: false, styles: ['a.css']}, {'a.css': 'body{}'});
  await mod('f-bad', {id: 'Bad!', name: 'Плохой', version: '1.0', kind: 'visual', styles: ['a.css']}, {'a.css': 'body{}'});

  const mods = await readVisualMods(dir);
  assert.deepEqual(mods.map((entry: any) => entry.id), ['theme', 'escape', 'scripty', 'off', 'Bad!'], 'the mechanics mod is the server’s');
  const theme = mods[0];
  assert.equal(theme.error, null);
  assert.match(theme.css, /--x:url\("data:image\/svg\+xml;base64,/, 'a picture next to the style is inlined');
  assert.match(theme.css, /\.a\{background:none\}/, 'a file outside the mod folder is not read');
  assert.match(theme.css, /url\(https:\/\/example\.com\/x\.png\)/, 'a remote link is left alone — the page’s CSP blocks it');
  assert.match(theme.css, /\.c\{background:none\}/, 'a missing picture — none');
  assert.match(mods[1].error, /внутри папки мода/);
  assert.match(mods[2].error, /файл \.css/);
  assert.equal(mods[3].off, true);
  assert.match(mods[4].error, /id/);
});

test('visual mods: the «Лесная ночь» example reads with its leaves inlined', async () => {
  const [forest] = await readVisualMods(examples);
  assert.equal(forest.id, 'forest-night');
  assert.deepEqual(forest.translations.en, {name: 'Forest Night', author: 'Example from docs/MODS.md', description: 'Dark green windows and panels with a leaf texture.'});
  assert.equal(forest.error, null);
  assert.match(forest.css, /--parchment-background: url\("data:image\/svg\+xml;base64,/);
  assert.match(forest.css, /html:root\[data-ui\]\[data-skin\]/);
});

test('visual mods: no folder — an empty list', async () => {
  assert.deepEqual(await readVisualMods(path.join(tmpdir(), 'ochag-no-such-visual-mods')), []);
});
