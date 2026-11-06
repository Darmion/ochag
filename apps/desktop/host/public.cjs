const dgram = require('node:dgram');
const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');

const STUN_SERVERS = [['stun.l.google.com', 19302], ['stun.cloudflare.com', 3478], ['stun1.l.google.com', 19302]];
const LEASE_SECONDS = 3600;

function ipv4Parts(address) {
  const parts = String(address).split('.').map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function isPrivateIpv4(address) {
  const parts = ipv4Parts(address);
  if (!parts) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

function isCgnat(address) {
  const parts = ipv4Parts(address);
  return Boolean(parts && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

function globalIpv6() {
  const result = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv6' || entry.internal) continue;
      if (!/^[23]/i.test(entry.address)) continue;
      result.push({address: entry.address, interfaceName: name});
    }
  }
  return result;
}

function stunRequest(host, port, timeoutMs = 2500) {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    const id = crypto.randomBytes(12);
    const message = Buffer.alloc(20);
    message.writeUInt16BE(0x0001, 0); // Binding Request
    message.writeUInt16BE(0, 2);
    message.writeUInt32BE(0x2112a442, 4); // magic cookie
    id.copy(message, 8);
    const done = value => {
      clearTimeout(timer);
      try { socket.close(); } catch {  }
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    socket.on('error', () => done(null));
    socket.on('message', reply => {
      if (reply.length < 20 || reply.readUInt16BE(0) !== 0x0101 || !reply.subarray(8, 20).equals(id)) return;
      let offset = 20;
      let mapped = null;
      while (offset + 4 <= reply.length) {
        const type = reply.readUInt16BE(offset);
        const length = reply.readUInt16BE(offset + 2);
        const value = reply.subarray(offset + 4, offset + 4 + length);
        if ((type === 0x0020 || type === 0x0001) && value.length >= 8 && value[1] === 0x01) {
          const raw = Buffer.from(value.subarray(4, 8));
          if (type === 0x0020) for (let i = 0; i < 4; i++) raw[i] ^= [0x21, 0x12, 0xa4, 0x42][i];
          const address = [...raw].join('.');
          if (type === 0x0020 || !mapped) mapped = address;
        }
        offset += 4 + length + ((4 - (length % 4)) % 4);
      }
      done(mapped);
    });
    socket.send(message, port, host, error => { if (error) done(null); });
  });
}

async function publicIpv4() {
  for (const [host, port] of STUN_SERVERS) {
    const address = await stunRequest(host, port);
    if (address) return address;
  }
  return null;
}

function httpRequest(url, {method = 'GET', headers = {}, body = null, timeoutMs = 4000} = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {method, headers, timeout: timeoutMs}, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; if (text.length > 512 * 1024) request.destroy(); });
      response.on('end', () => resolve({status: response.statusCode ?? 0, text, localAddress: request.socket?.localAddress ?? null}));
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function localIpv4() {
  const result = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) result.push(entry.address);
    }
  }
  return result;
}

function discoverOn(address, locations, timeoutMs) {
  return new Promise(resolve => {
    const socket = dgram.createSocket({type: 'udp4', reuseAddr: true});
    const finish = () => {
      try { socket.close(); } catch {  }
      resolve();
    };
    socket.on('error', finish);
    socket.on('message', reply => {
      const location = /^location:\s*(\S+)/im.exec(reply.toString())?.[1];
      if (location && /^http:\/\//i.test(location)) locations.add(location);
    });
    socket.bind(0, address, () => {
      try { socket.setMulticastInterface(address); } catch {  }
      for (const target of ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2', 'urn:schemas-upnp-org:service:WANIPConnection:1']) {
        const search = `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${target}\r\n\r\n`;
        socket.send(search, 1900, '239.255.255.250', () => {});
      }
      setTimeout(finish, timeoutMs);
    });
  });
}

async function discoverGateways(timeoutMs = 2500) {
  const locations = new Set();
  await Promise.all(localIpv4().map(address => discoverOn(address, locations, timeoutMs)));
  return [...locations];
}

async function gatewayService(location) {
  const {text, localAddress} = await httpRequest(location);
  const base = /<URLBase>\s*([^<]+)\s*<\/URLBase>/i.exec(text)?.[1] ?? location;
  for (const block of text.split(/<service>/i).slice(1)) {
    const type = /<serviceType>\s*([^<]+)\s*<\/serviceType>/i.exec(block)?.[1];
    const control = /<controlURL>\s*([^<]+)\s*<\/controlURL>/i.exec(block)?.[1];
    if (type && control && /WAN(IP|PPP)Connection/i.test(type)) {
      return {type: type.trim(), controlUrl: new URL(control.trim(), base).href, localAddress: localAddress ? localAddress.replace(/^::ffff:/, '') : null, location};
    }
  }
  return null;
}

const xmlEscape = value => String(value).replace(/[<>&'"]/g, char => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'})[char]);

async function soap(service, action, args = {}) {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${service.type}">${Object.entries(args).map(([key, value]) => `<${key}>${xmlEscape(value)}</${key}>`).join('')}</u:${action}></s:Body></s:Envelope>`;
  const {status, text} = await httpRequest(service.controlUrl, {
    method: 'POST',
    headers: {'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${service.type}#${action}"`, 'Content-Length': Buffer.byteLength(body)},
    body,
  });
  if (status !== 200) {
    const code = /<errorCode>\s*(\d+)\s*<\/errorCode>/i.exec(text)?.[1];
    const description = /<errorDescription>\s*([^<]+)\s*<\/errorDescription>/i.exec(text)?.[1];
    const error = new Error(description ? `${description} (${code})` : `роутер ответил ${status}`);
    error.upnpCode = code ? Number(code) : null;
    throw error;
  }
  return text;
}

const tag = (text, name) => new RegExp(`<${name}>\\s*([^<]*)\\s*</${name}>`, 'i').exec(text)?.[1]?.trim() ?? null;

let gateway = null;
let mapping = null;
let renewTimer = null;

async function findGateway() {
  if (gateway) return gateway;
  for (const location of await discoverGateways()) {
    try {
      const service = await gatewayService(location);
      if (service) { gateway = service; return service; }
    } catch {
    }
  }
  return null;
}

async function routerExternalIp(service) {
  try {
    return tag(await soap(service, 'GetExternalIPAddress'), 'NewExternalIPAddress');
  } catch {
    return null;
  }
}

async function addMapping(service, externalPort, internalPort) {
  const args = lease => ({
    NewRemoteHost: '', NewExternalPort: externalPort, NewProtocol: 'TCP', NewInternalPort: internalPort,
    NewInternalClient: service.localAddress, NewEnabled: 1, NewPortMappingDescription: 'Ochag game server', NewLeaseDuration: lease,
  });
  try {
    await soap(service, 'AddPortMapping', args(LEASE_SECONDS));
  } catch (error) {
    if (error.upnpCode !== 725) throw error;
    await soap(service, 'AddPortMapping', args(0));
  }
}

async function mapPort(externalPort, internalPort) {
  const service = await findGateway();
  if (!service?.localAddress) return {ok: false, message: 'Роутер не отвечает по UPnP (выключен в его настройках или не поддерживается) — пробросьте порт вручную.'};
  try {
    await addMapping(service, externalPort, internalPort);
  } catch (error) {
    return {ok: false, message: `Роутер отказал в пробросе порта: ${error instanceof Error ? error.message : error}. Пробросьте порт вручную.`};
  }
  mapping = {externalPort, internalPort, internalClient: service.localAddress, since: Date.now()};
  clearInterval(renewTimer);
  renewTimer = setInterval(() => { void addMapping(service, externalPort, internalPort).catch(() => {}); }, 30 * 60_000);
  return {ok: true, message: `Порт ${externalPort} роутера проброшен на ${service.localAddress}:${internalPort}.`};
}

async function unmapPort() {
  clearInterval(renewTimer);
  renewTimer = null;
  const current = mapping;
  mapping = null;
  if (!current || !gateway) return;
  try {
    await soap(gateway, 'DeletePortMapping', {NewRemoteHost: '', NewExternalPort: current.externalPort, NewProtocol: 'TCP'});
  } catch {
  }
}

async function inspectPublic(options) {
  gateway = null;
  const [publicIp, service] = await Promise.all([publicIpv4(), findGateway()]);
  const routerIp = service ? await routerExternalIp(service) : null;
  let verdict = 'unknown';
  if (routerIp && isCgnat(routerIp)) verdict = 'cgnat';
  else if (routerIp && isPrivateIpv4(routerIp)) verdict = 'double-nat';
  else if (routerIp && publicIp && routerIp !== publicIp) verdict = 'mismatch';
  else if (routerIp && publicIp && routerIp === publicIp) verdict = 'white';
  const blocked = verdict === 'cgnat' || verdict === 'double-nat';
  const mapped = options.upnp && service && !blocked ? await mapPort(options.externalPort, options.internalPort) : null;
  if (!options.upnp) await unmapPort();
  return {
    checkedAt: Date.now(),
    publicIp,
    routerIp,
    upnp: service ? {available: true, localAddress: service.localAddress} : {available: false, localAddress: null},
    verdict,
    mapping: mapping ? {...mapping} : null,
    mapMessage: mapped?.message ?? null,
    ipv6: globalIpv6(),
  };
}

module.exports = {inspectPublic, unmapPort, publicIpv4, globalIpv6, isPrivateIpv4, isCgnat};
