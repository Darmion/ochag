const {app, safeStorage} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

const MAX_ENTRIES = 20;

function filePath() {
  return path.join(app.getPath('userData'), 'saved-logins.json');
}

async function read() {
  try {
    const saved = JSON.parse(await fs.readFile(filePath(), 'utf8'));

    return {
      autoLogin: saved.autoLogin !== false,
      lastId: typeof saved.lastId === 'string' ? saved.lastId : null,
      entries: Array.isArray(saved.entries) ? saved.entries.filter(e => e && typeof e.id === 'string') : [],
    };
  } catch {
    return {autoLogin: true, lastId: null, entries: []};
  }
}

async function write(state) {
  await fs.mkdir(app.getPath('userData'), {recursive: true});
  await fs.writeFile(filePath(), JSON.stringify(state, null, 2), 'utf8');
}

function publicView(state) {
  return {
    autoLogin: state.autoLogin,
    lastId: state.lastId,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    entries: state.entries.map(({id, serverUrl, username, hostName, serverId, savedAt}) => ({
      id, serverUrl, username, hostName: hostName ?? null, serverId: serverId ?? null, savedAt,
    })),
  };
}

async function list() {
  return publicView(await read());
}

async function remember({serverUrl, username, password, hostName, serverId}) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Шифрование Windows недоступно — пароль не сохранён.');
  }

  const state = await read();
  const key = username.trim().toLowerCase();
  const existing = state.entries.find(e => e.username.toLowerCase() === key && (e.serverUrl === serverUrl || (serverId && e.serverId === serverId)));
  const entry = {
    id: existing?.id ?? crypto.randomUUID(),
    serverUrl,
    username: username.trim(),
    password: safeStorage.encryptString(password).toString('base64'),
    hostName: hostName ?? existing?.hostName ?? null,
    serverId: serverId ?? existing?.serverId ?? null,
    savedAt: new Date().toISOString(),
  };

  state.entries = [entry, ...state.entries.filter(e => e.id !== entry.id)].slice(0, MAX_ENTRIES);
  state.lastId = entry.id;
  await write(state);
  return publicView(state);
}

async function markUsed(id, {hostName, serverId} = {}) {
  const state = await read();
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return publicView(state);

  if (hostName) entry.hostName = hostName;
  if (serverId) entry.serverId = serverId;
  state.lastId = id;
  await write(state);
  return publicView(state);
}

async function moveServer(id, serverUrl) {
  const state = await read();
  const entry = state.entries.find(e => e.id === id);
  if (!entry || entry.serverUrl === serverUrl) return publicView(state);

  const key = entry.username.toLowerCase();
  state.entries = state.entries.filter(e => e.id === id || !(e.serverUrl === serverUrl && e.username.toLowerCase() === key));
  entry.serverUrl = serverUrl;
  await write(state);
  return publicView(state);
}

async function forget(id) {
  const state = await read();
  state.entries = state.entries.filter(e => e.id !== id);
  if (state.lastId === id) state.lastId = null;
  await write(state);
  return publicView(state);
}

async function clearLast() {
  const state = await read();
  state.lastId = null;
  await write(state);
  return publicView(state);
}

async function setAutoLogin(enabled) {
  const state = await read();
  state.autoLogin = enabled === true;
  await write(state);
  return publicView(state);
}

async function secretFor(id) {
  const entry = (await read()).entries.find(e => e.id === id);
  if (!entry) throw new Error('Сохранённый вход не найден.');

  return {
    serverUrl: entry.serverUrl,
    username: entry.username,
    password: safeStorage.decryptString(Buffer.from(entry.password, 'base64')),
  };
}

module.exports = {list, remember, markUsed, moveServer, forget, clearLast, setAutoLogin, secretFor};
