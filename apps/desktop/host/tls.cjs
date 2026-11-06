// Players pin the GM's self-signed certificate by fingerprint on first connect; Chromium (net.fetch, the window's WebSocket) accepts it only when pinned.
// Chromium caches certificate checks, so an unpinned certificate is inspected via node:tls first.
const {app, session} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const {createSelfSignedCertificate, fingerprintOf, shortCode, sameFingerprint, peerCertificate} = require('./certificate.cjs');

const MAX_TRUSTED = 50;

let ownCertificate = null;
let trusted = null;

function tlsDir() {
  return path.join(app.getPath('userData'), 'tls');
}

function trustedPath() {
  return path.join(app.getPath('userData'), 'trusted-servers.json');
}

// Created once in LAN mode and never changed, so players do not have to re-check the code.
async function ensureServerCertificate() {
  if (ownCertificate) return ownCertificate;

  const certPath = path.join(tlsDir(), 'server-cert.pem');
  const keyPath = path.join(tlsDir(), 'server-key.pem');
  let cert;

  try {
    cert = await fs.readFile(certPath, 'utf8');
    await fs.access(keyPath);
  } catch {
    const created = createSelfSignedCertificate({commonName: `Ochag ${os.hostname()}`});
    await fs.mkdir(tlsDir(), {recursive: true});
    await fs.writeFile(keyPath, created.key, {encoding: 'utf8', mode: 0o600});
    await fs.writeFile(certPath, created.cert, 'utf8');
    cert = created.cert;
  }

  const fingerprint = fingerprintOf(cert);
  ownCertificate = {certPath, keyPath, fingerprint, code: shortCode(fingerprint)};
  return ownCertificate;
}

async function loadOwnCertificate() {
  try {
    const cert = await fs.readFile(path.join(tlsDir(), 'server-cert.pem'), 'utf8');
    const fingerprint = fingerprintOf(cert);
    ownCertificate = {
      certPath: path.join(tlsDir(), 'server-cert.pem'),
      keyPath: path.join(tlsDir(), 'server-key.pem'),
      fingerprint,
      code: shortCode(fingerprint),
    };
  } catch {
  }
}

async function readTrusted() {
  if (trusted) return trusted;
  try {
    const saved = JSON.parse(await fs.readFile(trustedPath(), 'utf8'));
    trusted = Array.isArray(saved.servers)
      ? saved.servers.filter(entry => typeof entry?.host === 'string' && typeof entry?.fingerprint === 'string')
      : [];
  } catch {
    trusted = [];
  }
  return trusted;
}

function hostKey(hostname) {
  return String(hostname).replace(/^\[|\]$/g, '').toLowerCase();
}

// Pinned per host name without the port: Chromium passes only the host to the certificate check.
async function pinnedFingerprint(hostname) {
  return (await readTrusted()).find(entry => entry.host === hostKey(hostname))?.fingerprint ?? null;
}

async function isPinned(hostname) {
  return Boolean(await pinnedFingerprint(hostname));
}

async function trustServer(hostname, fingerprint) {
  const list = await readTrusted();
  const host = hostKey(hostname);
  trusted = [{host, fingerprint, trustedAt: new Date().toISOString()}, ...list.filter(entry => entry.host !== host)].slice(0, MAX_TRUSTED);
  await fs.writeFile(trustedPath(), JSON.stringify({servers: trusted}, null, 2), 'utf8');
  installCertificateCheck();
  await session.defaultSession.closeAllConnections();
}

async function inspectServerCertificate(origin) {
  const url = new URL(origin);
  const host = hostKey(url.hostname);
  const peer = await peerCertificate(host, Number(url.port || 443));
  const code = shortCode(peer.fingerprint);

  if (peer.authorized) return {trusted: true, fingerprint: peer.fingerprint, code};
  if (ownCertificate && sameFingerprint(peer.fingerprint, ownCertificate.fingerprint)) return {trusted: true, fingerprint: peer.fingerprint, code};

  const pinned = await pinnedFingerprint(host);
  if (pinned && sameFingerprint(pinned, peer.fingerprint)) return {trusted: true, fingerprint: peer.fingerprint, code};

  return {trusted: false, changed: Boolean(pinned), fingerprint: peer.fingerprint, code};
}

// Normal chain of trust as usual; our own and pinned certificates are accepted; the rest is left to Chromium.
function installCertificateCheck() {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (request.errorCode === 0) {
      callback(-3);
      return;
    }

    let fingerprint;
    try {
      fingerprint = fingerprintOf(request.certificate.data);
    } catch {
      callback(-3);
      return;
    }

    if (ownCertificate && sameFingerprint(fingerprint, ownCertificate.fingerprint)) {
      callback(0);
      return;
    }

    const pinned = (trusted ?? []).find(entry => entry.host === hostKey(request.hostname));
    callback(pinned && sameFingerprint(pinned.fingerprint, fingerprint) ? 0 : -3);
  });
}

async function initTls() {
  await Promise.all([loadOwnCertificate(), readTrusted()]);
  installCertificateCheck();
}

function ownCertificateInfo() {
  return ownCertificate ? {fingerprint: ownCertificate.fingerprint, code: ownCertificate.code} : null;
}

module.exports = {initTls, ensureServerCertificate, ownCertificateInfo, inspectServerCertificate, isPinned, trustServer, sameFingerprint, shortCode};
