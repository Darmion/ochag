import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

function clientFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'locales' ? [] : clientFiles(path);
    return /\.(vue|ts)$/.test(name) ? [path] : [];
  });
}

test('every external link the client opens is allowed by the desktop shell', () => {
  const windows = readFileSync(join(root, 'apps/desktop/main/windows.cjs'), 'utf8');
  const list = /const EXTERNAL_LINKS = new Set\(\[([^\]]+)\]\)/.exec(windows)?.[1] ?? '';
  const allowed = new Set([...list.matchAll(/'(https:\/\/[^']+)'/g)].map(match => match[1]!));
  const sources = clientFiles(join(root, 'apps/client/src')).map(file => readFileSync(file, 'utf8'));
  const opened = new Set(sources.flatMap(text => [
    ...[...text.matchAll(/href="(https:\/\/[^"]+)"[^>]*target="_blank"/g)].map(match => match[1]!),
    ...[...text.matchAll(/\w*Url\s*[:=]\s*'(https:\/\/[^']+)'/g)].map(match => match[1]!),
  ]));
  assert.ok(opened.has('https://github.com/Darmion/ochag/issues'), [...opened].join(', '));
  assert.ok(opened.has('https://aka.ms/vs/17/release/vc_redist.x64.exe'), [...opened].join(', '));
  assert.deepEqual([...opened].filter(url => !allowed.has(url)), [], 'links the shell would silently refuse to open');
});
