const {app} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const net = require('node:net');

function configPath() {
  return path.join(app.getPath('userData'), 'host-config.json');
}

function generateSecret() {
  return crypto.randomBytes(24).toString('base64url');
}

async function findFreePort(startPort) {
  for (let port = startPort; port < startPort + 20; port++) {
    // eslint-disable-next-line no-await-in-loop
    const free = await new Promise(resolve => {
      const tester = net.createServer();
      tester.once('error', () => resolve(false));
      tester.once('listening', () => tester.close(() => resolve(true)));
      tester.listen(port, '127.0.0.1');
    });

    if (free) return port;
  }

  throw new Error(`Не удалось найти свободный порт начиная с ${startPort}.`);
}

async function loadOrCreateHostConfig() {
  let saved = {};

  try {
    saved = JSON.parse(await fs.readFile(configPath(), 'utf8'));
  } catch {
    saved = {};
  }

  const config = {
    postgresPassword: typeof saved.postgresPassword === 'string' ? saved.postgresPassword : generateSecret(),
    appPassword: typeof saved.appPassword === 'string' ? saved.appPassword : generateSecret(),
    postgresPort: Number.isInteger(saved.postgresPort) ? saved.postgresPort : await findFreePort(5433),
    serverPort: Number.isInteger(saved.serverPort) ? saved.serverPort : await findFreePort(3000),
    lanMode: saved.lanMode === true,
    lanTls: saved.lanTls !== false,
    autoBackupHours: [0, 6, 12, 24, 72, 168].includes(saved.autoBackupHours) ? saved.autoBackupHours : 24,
    autoBackupKeep: Number.isInteger(saved.autoBackupKeep) && saved.autoBackupKeep >= 1 && saved.autoBackupKeep <= 50 ? saved.autoBackupKeep : 7,
  };
  config.tunnelMode = ['off', 'quick', 'named'].includes(saved.tunnelMode) ? saved.tunnelMode : 'off';
  config.tunnelTokenEnc = typeof saved.tunnelTokenEnc === 'string' ? saved.tunnelTokenEnc : null;
  config.tunnelPublicUrl = typeof saved.tunnelPublicUrl === 'string' ? saved.tunnelPublicUrl : null;
  config.tunnelProtocol = saved.tunnelProtocol === 'http2' ? 'http2' : 'auto';
  config.tunnelPort = Number.isInteger(saved.tunnelPort) ? saved.tunnelPort : await findFreePort(config.serverPort + 80);
  config.publicMode = saved.publicMode === true;
  config.publicUpnp = saved.publicUpnp !== false;
  config.publicPort = Number.isInteger(saved.publicPort) && saved.publicPort >= 1 && saved.publicPort <= 65535 ? saved.publicPort : config.serverPort;

  await fs.mkdir(app.getPath('userData'), {recursive: true});
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8');

  return config;
}

async function saveHostConfig(config) {
  await fs.mkdir(app.getPath('userData'), {recursive: true});
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8');
}

module.exports = {loadOrCreateHostConfig, saveHostConfig};
