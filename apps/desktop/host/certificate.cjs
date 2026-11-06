// No Electron dependency: tested in apps/desktop/test.
const crypto = require('node:crypto');
const tls = require('node:tls');

function derLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

const sequence = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
const explicit = (number, ...parts) => tlv(0xa0 + number, ...parts);
const octetString = bytes => tlv(0x04, bytes);
const bitString = bytes => tlv(0x03, Buffer.from([0]), bytes);
const utf8String = text => tlv(0x0c, Buffer.from(text, 'utf8'));

function objectId(dotted) {
  const [first, second, ...rest] = dotted.split('.').map(Number);
  const bytes = [40 * first + second];
  for (const value of rest) {
    const chunk = [];
    for (let left = value; ; left = Math.floor(left / 128)) {
      chunk.unshift(left & 0x7f);
      if (left < 128) break;
    }
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80;
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function positiveInteger(bytes) {
  let value = bytes;
  while (value.length > 1 && value[0] === 0 && !(value[1] & 0x80)) value = value.subarray(1);
  if (value[0] & 0x80) value = Buffer.concat([Buffer.from([0]), value]);
  return tlv(0x02, value);
}

function certificateTime(date) {
  const digits = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(digits.slice(2))) : tlv(0x18, Buffer.from(digits));
}

const ECDSA_WITH_SHA256 = sequence(objectId('1.2.840.10045.4.3.2'));
const VALID_YEARS = 10;

function toPem(label, der) {
  const lines = der.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

function createSelfSignedCertificate({commonName, now = new Date()} = {}) {
  const {privateKey, publicKey} = crypto.generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  const name = sequence(set(sequence(objectId('2.5.4.3'), utf8String(commonName || 'Ochag'))));
  const notBefore = new Date(now.getTime() - 24 * 3600 * 1000);
  const notAfter = new Date(now);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + VALID_YEARS);

  const subjectAltName = sequence(
    objectId('2.5.29.17'),
    octetString(sequence(tlv(0x82, Buffer.from('localhost')), tlv(0x87, Buffer.from([127, 0, 0, 1])))),
  );

  const tbsCertificate = sequence(
    explicit(0, positiveInteger(Buffer.from([2]))),
    positiveInteger(crypto.randomBytes(16)),
    ECDSA_WITH_SHA256,
    name,
    sequence(certificateTime(notBefore), certificateTime(notAfter)),
    name,
    publicKey.export({type: 'spki', format: 'der'}),
    explicit(3, sequence(subjectAltName)),
  );

  const signature = crypto.sign('sha256', tbsCertificate, privateKey);
  const certificate = sequence(tbsCertificate, ECDSA_WITH_SHA256, bitString(signature));

  return {
    cert: toPem('CERTIFICATE', certificate),
    key: privateKey.export({type: 'pkcs8', format: 'pem'}),
  };
}

function fingerprintOf(pem) {
  return new crypto.X509Certificate(pem).fingerprint256;
}

function shortCode(fingerprint) {
  const hex = String(fingerprint).replace(/[^0-9a-f]/gi, '').toUpperCase().slice(0, 16);
  return hex.match(/.{4}/g)?.join('-') ?? '';
}

function sameFingerprint(a, b) {
  const clean = value => String(value ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return clean(a).length === 64 && clean(a) === clean(b);
}

function peerCertificate(host, port, {timeoutMs = 5000} = {}) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      rejectUnauthorized: false,
      ...(/^[\d.]+$/.test(host) || host.includes(':') ? {} : {servername: host}),
    });
    const timer = setTimeout(() => socket.destroy(new Error('TLS handshake timed out')), timeoutMs);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const certificate = socket.getPeerX509Certificate();
      const result = certificate
        ? {fingerprint: certificate.fingerprint256, authorized: socket.authorized, subject: certificate.subject}
        : null;
      socket.end();
      if (result) resolve(result);
      else reject(new Error('Сервер не прислал сертификат.'));
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

module.exports = {createSelfSignedCertificate, fingerprintOf, shortCode, sameFingerprint, peerCertificate};
