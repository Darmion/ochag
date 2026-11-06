import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('phone static serving: /phone redirects, /phone/ and its assets are served', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ttrpg-phone-'));
  t.after(() => rm(dir, {recursive: true, force: true}));

  await writeFile(path.join(dir, 'phone.html'), '<!doctype html><title>phone</title>');
  await mkdir(path.join(dir, 'assets'));
  await writeFile(path.join(dir, 'assets', 'app.js'), 'console.log(1)');

  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());

  await t.test('without clientDistDir, /phone does not exist', async () => {
    const app = await buildApp(db, {});
    try {
      assert.equal((await app.inject('/phone')).statusCode, 404);
      assert.equal((await app.inject('/phone/')).statusCode, 404);
    } finally { await app.close(); }
  });

  const app = await buildApp(db, {clientDistDir: dir});
  t.after(() => app.close());

  await t.test('/phone redirects to /phone/ — a bare path would break the built index.html\'s relative asset URLs', async () => {
    const response = await app.inject('/phone');
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, '/phone/');
  });

  await t.test('/phone/ serves the client\'s index.html, never cached', async () => {
    const response = await app.inject('/phone/');
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /<title>phone<\/title>/);
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  await t.test('/phone/assets/... serves the built client\'s own files', async () => {
    const response = await app.inject('/phone/assets/app.js');
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'console.log(1)');
  });

  await t.test('a missing asset under /phone/ is a plain 404, not the index.html fallback', async () => {
    assert.equal((await app.inject('/phone/assets/missing.js')).statusCode, 404);
  });

  await t.test('GET /phone/... is exempt from the rate limit: static files of the phone\'s own bundle should never compete with its API calls for the same budget', async () => {
    const limited = await buildApp(db, {clientDistDir: dir, rateMax: 2});
    try {
      for (let i = 0; i < 5; i++) assert.equal((await limited.inject('/phone/')).statusCode, 200);
      for (let i = 0; i < 5; i++) assert.equal((await limited.inject('/phone/assets/app.js')).statusCode, 200);
      assert.equal((await limited.inject('/health')).statusCode, 200);
      assert.equal((await limited.inject('/health')).statusCode, 200);
      assert.equal((await limited.inject('/health')).statusCode, 429);
    } finally { await limited.close(); }
  });
});
