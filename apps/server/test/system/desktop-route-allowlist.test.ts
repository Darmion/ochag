import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(import.meta.url);

function desktopAllowlist(): RegExp {
  return (require('../../../desktop/main/api-routes.cjs') as {allowedRoute: RegExp}).allowedRoute;
}

function clientFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return clientFiles(path);
    return /\.(vue|ts)$/.test(name) ? [path] : [];
  });
}

test('every asset kind the server accepts can be uploaded through the desktop app', () => {
  const allowed = desktopAllowlist();
  const routes = readFileSync(join(root, 'apps/server/src/system/asset-routes.ts'), 'utf8');
  const list = /const ASSET_KINDS = \[([^\]]+)\]/.exec(routes)?.[1] ?? '';
  const kinds = [...list.matchAll(/'([a-z_]+)'/g)].map(match => match[1]!);
  assert.ok(kinds.includes('campaign_avatar') && kinds.includes('campaign_banner'), kinds.join(', '));
  const campaign = '0f8e3c1a-1111-4222-8333-444455556666';
  for (const kind of kinds) {
    assert.ok(allowed.test(`/campaigns/${campaign}/assets?kind=${kind}`), `kind=${kind} не пропускает api-routes.cjs`);
  }
  assert.ok(allowed.test(`/campaigns/${campaign}/appearance`));
  assert.ok(!allowed.test(`/campaigns/${campaign}/assets?kind=evil`));
  assert.ok(!allowed.test('/campaigns/x/assets?kind=audio&next=http://evil'));
});

test('every literal API path in the client passes the desktop allowlist', () => {
  const allowed = desktopAllowlist();
  const denied: string[] = [];
  let checked = 0;
  for (const file of clientFiles(join(root, 'apps/client/src'))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/[`'](\/(?:campaigns|srd|auth|me|health)[^`'\s]*)[`']/g)) {
      const route = match[1]!.replace(/\$\{[^}]*\}/g, 'abc123');
      if (/[?&=]abc123/.test(route)) continue;
      checked++;
      if (!allowed.test(route)) denied.push(`${route} (${file.slice(root.length)})`);
    }
  }
  assert.ok(checked > 200, `проверено только ${checked}`);
  assert.deepEqual(denied, []);
});
