import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NATIVE_TEXTS} from '../../../client/src/i18n/nativeTexts.ts';

const desktop = fileURLToPath(new URL('../../../desktop/', import.meta.url));

function desktopFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return desktopFiles(path);
    return name.endsWith('.cjs') ? [path] : [];
  });
}

const sources = desktopFiles(desktop).map(file => readFileSync(file, 'utf8'));

test('every text of a Windows dialog or window title is in the page’s list to translate', () => {
  const used = new Set(sources.flatMap(text => [...text.matchAll(/nativeText\('([^']+)'\)/g)].map(match => match[1]!)));
  assert.ok(used.size >= 10, [...used].join(', '));
  assert.deepEqual([...used].filter(text => !NATIVE_TEXTS.includes(text)), [], 'texts the page would never translate');
  assert.deepEqual(NATIVE_TEXTS.filter(text => !used.has(text)), [], 'texts nothing shows any more');
});

test('every channel the preload invokes has a handler in the main process', () => {
  const preload = readFileSync(join(desktop, 'preload.cjs'), 'utf8');
  const invoked = new Set([...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match => match[1]!));
  const handled = new Set(sources.flatMap(text => [...text.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(match => match[1]!)));
  assert.ok(invoked.has('locales:nativeTexts'));
  assert.deepEqual([...invoked].filter(channel => !handled.has(channel)), []);
});
