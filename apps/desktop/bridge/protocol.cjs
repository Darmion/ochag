// Messages between the Tauri shell and this host process over stdin/stdout. A message is one line of JSON; bytes inside it
// (an uploaded picture, a downloaded model) are replaced by {__ochagBlob: n} and follow the line raw, their lengths listed
// in "blobs". Everything the host prints goes to stderr, so log lines never mix into the stream.
const util = require('node:util');

const writeOut = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encoding, callback) => process.stderr.write(chunk, encoding, callback);
for (const name of ['log', 'info', 'debug']) console[name] = (...args) => process.stderr.write(`${util.format(...args)}\n`);

const BLOB = '__ochagBlob';

function pack(value, blobs) {
  if (value instanceof ArrayBuffer) {
    blobs.push(Buffer.from(value));
    return { [BLOB]: blobs.length - 1 };
  }
  if (ArrayBuffer.isView(value)) {
    blobs.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    return { [BLOB]: blobs.length - 1 };
  }
  if (Array.isArray(value)) return value.map(entry => pack(entry, blobs));
  if (value && typeof value === 'object') {
    if (value instanceof Error) return { message: value.message };
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, pack(entry, blobs)]));
  }
  return value;
}

function unpack(value, blobs) {
  if (Array.isArray(value)) return value.map(entry => unpack(entry, blobs));
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === BLOB && Number.isInteger(value[BLOB]) && blobs[value[BLOB]]) {
      const blob = blobs[value[BLOB]];
      return blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
    }
    return Object.fromEntries(keys.map(key => [key, unpack(value[key], blobs)]));
  }
  return value;
}

function send(message) {
  const blobs = [];
  const header = pack(message, blobs);
  if (blobs.length) header.blobs = blobs.map(blob => blob.length);
  writeOut(`${JSON.stringify(header)}\n`);
  for (const blob of blobs) writeOut(blob);
}

const pending = new Map();
let nextCall = 0;
const listeners = { invoke: null, event: [] };
let resolveInit;
const init = new Promise(resolve => { resolveInit = resolve; });

// A request to the Rust shell (a dialog, a window, a link); resolves with its reply.
function call(method, params = {}) {
  const id = `h${++nextCall}`;
  send({ type: 'call', id, method, params });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function notify(method, params = {}) {
  send({ type: 'call', method, params });
}

function emitTo(target, channel, payload) {
  send({ type: 'send', target, channel, payload });
}

function onInvoke(handler) {
  listeners.invoke = handler;
}

function onEvent(handler) {
  listeners.event.push(handler);
}

function dispatch(message) {
  if (message.type === 'init') resolveInit(message);
  else if (message.type === 'reply') {
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.ok) waiting.resolve(message.value);
    else waiting.reject(new Error(String(message.error ?? 'Команда окна не выполнена.')));
  } else if (message.type === 'invoke') {
    Promise.resolve()
      .then(() => listeners.invoke(message))
      .then(value => send({ type: 'result', id: message.id, ok: true, value: value === undefined ? null : value }))
      .catch(error => send({ type: 'result', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }));
  } else if (message.type === 'event') {
    for (const handler of listeners.event) handler(message);
  }
}

// The reader: lines of JSON, and after a line with "blobs" exactly that many raw bytes, filled chunk by chunk.
let text = Buffer.alloc(0);
let awaiting = null;
process.stdin.on('data', chunk => {
  let rest = chunk;
  while (rest.length) {
    if (awaiting) {
      const take = Math.min(rest.length, awaiting.data.length - awaiting.filled);
      rest.copy(awaiting.data, awaiting.filled, 0, take);
      awaiting.filled += take;
      rest = rest.subarray(take);
      if (awaiting.filled < awaiting.data.length) return;
      const { header, lengths, data } = awaiting;
      awaiting = null;
      const blobs = [];
      let offset = 0;
      for (const length of lengths) {
        blobs.push(data.subarray(offset, offset + length));
        offset += length;
      }
      dispatch(unpack(header, blobs));
      continue;
    }
    const end = rest.indexOf(10);
    if (end < 0) {
      text = Buffer.concat([text, rest]);
      return;
    }
    const line = Buffer.concat([text, rest.subarray(0, end)]).toString('utf8');
    text = Buffer.alloc(0);
    rest = rest.subarray(end + 1);
    let header;
    try {
      header = JSON.parse(line);
    } catch {
      continue;
    }
    const lengths = Array.isArray(header.blobs) ? header.blobs.filter(length => Number.isInteger(length) && length >= 0) : [];
    delete header.blobs;
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (total > 0) awaiting = { header, lengths, data: Buffer.allocUnsafe(total), filled: 0 };
    else dispatch(unpack(header, lengths.map(() => Buffer.alloc(0))));
  }
});
process.stdin.on('end', () => {
  for (const handler of listeners.event) handler({ type: 'event', name: 'shell-gone' });
});

module.exports = { init, call, notify, emitTo, onInvoke, onEvent };
