import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {normalizeServerUrl, isInternetName} = require('../../../desktop/main/server-url.cjs') as {
  normalizeServerUrl: (value: unknown) => string;
  isInternetName: (hostname: string) => boolean;
};

test('a dictated home-network address gets http:// and the default port', () => {
  assert.equal(normalizeServerUrl('26.34.12.5'), 'http://26.34.12.5:3000');
  assert.equal(normalizeServerUrl('26.34.12.5:4000'), 'http://26.34.12.5:4000');
  assert.equal(normalizeServerUrl(' http://192.168.1.10:3000/ '), 'http://192.168.1.10:3000');
  assert.equal(normalizeServerUrl('http://192.168.1.10'), 'http://192.168.1.10:3000');
  assert.equal(normalizeServerUrl('pc.local'), 'http://pc.local:3000');
  assert.equal(normalizeServerUrl('localhost'), 'http://localhost:3000');
});

test('an internet name gets https:// and keeps the standard port', () => {
  assert.equal(normalizeServerUrl('game.trycloudflare.com'), 'https://game.trycloudflare.com');
  assert.equal(normalizeServerUrl('https://example.org'), 'https://example.org');
  assert.equal(normalizeServerUrl('https://example.org:8443'), 'https://example.org:8443');
});

test('anything but a bare address and port is rejected', () => {
  for (const bad of ['', '   ', 'ftp://host', 'http://user:pw@host:3000', 'http://host:3000/path', 'http://host:3000/?a=1', 'http://host:3000/#x', 'x'.repeat(301), 42, null]) {
    assert.throws(() => normalizeServerUrl(bad), String(bad).slice(0, 30));
  }
});

test('internet names are dotted, not IP addresses and not home-network names', () => {
  assert.equal(isInternetName('example.org'), true);
  assert.equal(isInternetName('game.trycloudflare.com'), true);
  for (const name of ['localhost', '192.168.1.10', '[::1]', 'fe80::1', 'pc.local', 'nas.lan', 'box.home.arpa', 'router.home', 'srv.internal']) {
    assert.equal(isInternetName(name), false, name);
  }
});
