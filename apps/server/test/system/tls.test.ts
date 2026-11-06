import {test} from 'node:test';
import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import {createRequire} from 'node:module';
import {request} from 'node:https';
import tls from 'node:tls';
import type {AddressInfo} from 'node:net';
import WebSocket from 'ws';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

const require = createRequire(import.meta.url);
const certificates = require('../../../desktop/host/certificate.cjs') as {
  createSelfSignedCertificate(options?: {commonName?: string; now?: Date}): {cert: string; key: string};
  fingerprintOf(pem: string): string;
  shortCode(fingerprint: string): string;
  sameFingerprint(a: string, b: string): boolean;
  peerCertificate(host: string, port: number): Promise<{fingerprint: string; authorized: boolean}>;
};

test('self-signed certificate is valid X.509 with the expected names and lifetime', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  const {cert, key} = certificates.createSelfSignedCertificate({commonName: 'Ochag GM-PC', now});
  const x509 = new X509Certificate(cert);

  assert.equal(x509.subject, 'CN=Ochag GM-PC');
  assert.equal(x509.issuer, x509.subject);
  assert.ok(x509.verify(x509.publicKey), 'signed with its own key');
  assert.ok(x509.checkPrivateKey(require('node:crypto').createPrivateKey(key)));
  assert.equal(x509.subjectAltName, 'DNS:localhost, IP Address:127.0.0.1');
  assert.equal(x509.publicKey.asymmetricKeyType, 'ec');
  assert.equal(new Date(x509.validFrom).toISOString(), '2026-10-05T12:00:00.000Z');
  assert.equal(new Date(x509.validTo).toISOString(), '2036-10-06T12:00:00.000Z');

  const other = certificates.createSelfSignedCertificate({now});
  assert.notEqual(certificates.fingerprintOf(other.cert), certificates.fingerprintOf(cert));
  assert.equal(new X509Certificate(other.cert).subject, 'CN=Ochag');

  const late = new X509Certificate(certificates.createSelfSignedCertificate({now: new Date('2045-01-01T00:00:00Z')}).cert);
  assert.equal(new Date(late.validTo).toISOString(), '2055-01-01T00:00:00.000Z');
});

test('short code and fingerprint comparison', () => {
  const fingerprint = 'A1:B2:C3:D4:E5:F6:07:18:' + Array(24).fill('00').join(':');
  assert.equal(certificates.shortCode(fingerprint), 'A1B2-C3D4-E5F6-0718');
  assert.ok(certificates.sameFingerprint(fingerprint, fingerprint.toLowerCase().replaceAll(':', '')));
  assert.ok(!certificates.sameFingerprint(fingerprint, fingerprint.replace('A1', 'A2')));
  assert.ok(!certificates.sameFingerprint('', ''), 'empty never matches');
  assert.ok(!certificates.sameFingerprint('A1B2', 'A1B2'), 'a prefix is not a fingerprint');
});

test('TLS handshake: pinned by fingerprint, untrusted by the system store', async t => {
  const {cert, key} = certificates.createSelfSignedCertificate({commonName: 'TTRPG test'});
  const server = tls.createServer({cert, key}, socket => socket.end('ok'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const {port} = server.address() as AddressInfo;

  const peer = await certificates.peerCertificate('127.0.0.1', port);
  assert.equal(peer.fingerprint, certificates.fingerprintOf(cert));
  assert.equal(peer.authorized, false, 'not issued by a known root');

  const authorized = await new Promise<boolean>((resolve, reject) => {
    const socket = tls.connect({host: '127.0.0.1', port, ca: cert, servername: 'localhost'}, () => {
      resolve(socket.authorized);
      socket.end();
    });
    socket.once('error', reject);
  });
  assert.equal(authorized, true);

  await assert.rejects(certificates.peerCertificate('127.0.0.1', 1), /ECONNREFUSED/);
});

test('the server answers HTTPS and WSS with the generated certificate', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const {cert, key} = certificates.createSelfSignedCertificate({commonName: 'TTRPG test'});
  const app = await buildApp(db, {https: {cert, key}});
  t.after(() => app.close());
  await app.listen({host: '127.0.0.1', port: 0});
  const {port} = app.server.address() as AddressInfo;

  const health = await new Promise<{status: number; body: any}>((resolve, reject) => {
    const req = request({host: '127.0.0.1', port, path: '/health', ca: cert, servername: 'localhost'}, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({status: res.statusCode ?? 0, body: JSON.parse(text)}));
    });
    req.once('error', reject);
    req.end();
  });
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');

  await assert.rejects(new Promise((resolve, reject) => {
    const req = request({host: '127.0.0.1', port, path: '/health'}, resolve);
    req.once('error', reject);
    req.end();
  }), /self-signed|SELF_SIGNED/i);

  const opened = await new Promise<boolean>((resolve, reject) => {
    const options: WebSocket.ClientOptions & {servername: string} = {ca: cert, servername: 'localhost'};
    const socket = new WebSocket(`wss://127.0.0.1:${port}/live`, options);
    socket.once('open', () => { resolve(true); socket.close(); });
    socket.once('error', reject);
  });
  assert.equal(opened, true);

  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
});
