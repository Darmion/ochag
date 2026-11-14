// What the host modules share: data paths, channel handlers, Windows-protected storage, fetch with pinned certificates,
// dialogs and folders through the Tauri shell. bridge.cjs fills it from the shell's init message before it loads any
// module that takes from it. The names follow Electron's, which these handlers were first written for.
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { Agent, buildConnector } = require('undici');

const runtime = module.exports;

function pemOf(raw) {
  return `-----BEGIN CERTIFICATE-----\n${raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
}

function installRuntime(init, protocol) {
  const handlers = new Map();
  const paths = {
    userData: init.dataDir,
    appData: init.appData ?? process.env.APPDATA ?? os.homedir(),
    temp: os.tmpdir(),
    home: os.homedir(),
    documents: init.documents ?? path.join(os.homedir(), 'Documents'),
    downloads: init.downloads ?? path.join(os.homedir(), 'Downloads'),
    desktop: init.desktop ?? path.join(os.homedir(), 'Desktop'),
  };

  const app = {
    isPackaged: Boolean(init.packaged),
    getPath: name => {
      if (!paths[name]) throw new Error(`Unknown path: ${name}`);
      return paths[name];
    },
    getAppPath: () => init.appRoot,
    getVersion: () => init.version,
    quit: () => protocol.notify('app.quit'),
  };

  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
  };

  // Windows-protected storage as the Electron build kept it: AES-256-GCM under a key that DPAPI guards in «Local State»,
  // records start with «v10». The shell unwraps the key and hands it over, so logins saved by older builds still open.
  const key = init.osCryptKey ? Buffer.from(init.osCryptKey, 'base64') : null;
  const PREFIX = Buffer.from('v10');
  const safeStorage = {
    isEncryptionAvailable: () => Boolean(key && key.length === 32),
    encryptString(text) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование Windows недоступно.');
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
      const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
      return Buffer.concat([PREFIX, nonce, data, cipher.getAuthTag()]);
    },
    decryptString(input) {
      const buffer = Buffer.from(input);
      if (!safeStorage.isEncryptionAvailable() || buffer.length < 3 + 12 + 16 || !buffer.subarray(0, 3).equals(PREFIX)) {
        throw new Error('Не удалось расшифровать сохранённые данные.');
      }
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(3, 15));
      decipher.setAuthTag(buffer.subarray(buffer.length - 16));
      return Buffer.concat([decipher.update(buffer.subarray(15, buffer.length - 16)), decipher.final()]).toString('utf8');
    },
  };

  // The host decides about self-signed certificates by fingerprint (host/tls.cjs): every connection asks it.
  let verifyProc = null;
  let agent = null;
  function pinnedAgent() {
    // A resumed TLS session shows no peer certificate, so there would be nothing to check: every connection does a full handshake.
    const connect = buildConnector({ rejectUnauthorized: false, maxCachedSessions: 0 });
    return new Agent({
      connect(options, callback) {
        connect(options, (error, socket) => {
          if (error || !socket.encrypted) {
            callback(error, socket);
            return;
          }
          const authorized = socket.authorized === true;
          const raw = socket.getPeerCertificate?.()?.raw;
          const decide = verdict => {
            if (verdict === 0 || (verdict === -3 && authorized)) callback(null, socket);
            else {
              socket.destroy();
              callback(Object.assign(new Error('net::ERR_CERT_AUTHORITY_INVALID'), { code: 'CERT_UNTRUSTED' }));
            }
          };
          if (!verifyProc || !raw) {
            decide(authorized ? 0 : -2);
            return;
          }
          verifyProc({ hostname: options.hostname, certificate: { data: pemOf(raw) }, errorCode: authorized ? 0 : -202 }, decide);
        });
      },
    });
  }
  // undici hides the reason («fetch failed», cause ECONNREFUSED); host/network.cjs reads it from the message.
  const net = {
    fetch: async (url, options = {}) => {
      agent ??= pinnedAgent();
      try {
        return await fetch(url, { ...options, dispatcher: agent });
      } catch (error) {
        const cause = error?.cause;
        if (!cause || !(error instanceof Error)) throw error;
        throw Object.assign(new Error(`${error.message}: ${cause.code ?? ''} ${cause.message ?? ''}`.trim()), { name: error.name, cause });
      }
    },
  };
  const session = {
    defaultSession: {
      setCertificateVerifyProc: proc => { verifyProc = proc; },
      closeAllConnections: async () => {
        const old = agent;
        agent = null;
        await old?.close().catch(() => {});
      },
    },
  };

  const dialog = {
    showOpenDialog: (_window, options) => protocol.call('dialog.open', options ?? {}),
    showSaveDialog: (_window, options) => protocol.call('dialog.save', options ?? {}),
  };

  const shell = {
    openPath: async target => {
      try {
        await protocol.call('shell.openPath', { path: target });
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    showItemInFolder: target => protocol.notify('shell.reveal', { path: target }),
  };

  // WebView2 asks about a certificate it could not verify (the page's own fetch or WebSocket): the same check as above.
  const checkCertificate = (hostname, pem) => new Promise(resolve => {
    if (!verifyProc || typeof hostname !== 'string' || typeof pem !== 'string') {
      resolve(false);
      return;
    }
    verifyProc({ hostname, certificate: { data: pem }, errorCode: -202 }, verdict => resolve(verdict === 0));
  });

  Object.assign(runtime, { app, ipcMain, safeStorage, net, session, dialog, shell, handlers, checkCertificate });
}

runtime.installRuntime = installRuntime;
