// Ambience loops → Opus in WebM: a headless Microsoft Edge decodes the source (decodeAudioData) and encodes Opus
// (WebCodecs), the page writes the WebM container. Called by build-sfx.mjs --ambience; OCHAG_BROWSER names another
// Chromium-based browser.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const RENDERER = String.raw`
const concat = parts => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};
// Every element size takes 8 bytes (EBMLMaxSizeLength 8), which keeps the writer simple.
const size8 = size => {
  const bytes = new Uint8Array(8);
  bytes[0] = 0x01;
  let value = size;
  for (let index = 7; index >= 1; index--) { bytes[index] = value % 256; value = Math.floor(value / 256); }
  return bytes;
};
const el = (id, ...parts) => { const body = concat(parts); return concat([new Uint8Array(id), size8(body.length), body]); };
const uint = value => { const out = []; do { out.unshift(value % 256); value = Math.floor(value / 256); } while (value > 0); return new Uint8Array(out); };
const f64 = value => { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value); return bytes; };
const str = text => new TextEncoder().encode(text);

function muxWebm({ chunks, head, channels, durationMs, preSkip }) {
  const ebml = el([0x1A, 0x45, 0xDF, 0xA3],
    el([0x42, 0x86], uint(1)), el([0x42, 0xF7], uint(1)), el([0x42, 0xF2], uint(4)), el([0x42, 0xF3], uint(8)),
    el([0x42, 0x82], str('webm')), el([0x42, 0x87], uint(4)), el([0x42, 0x85], uint(2)));
  const info = el([0x15, 0x49, 0xA9, 0x66],
    el([0x2A, 0xD7, 0xB1], uint(1000000)), el([0x44, 0x89], f64(durationMs)),
    el([0x4D, 0x80], str('Ochag')), el([0x57, 0x41], str('Ochag')));
  const tracks = el([0x16, 0x54, 0xAE, 0x6B], el([0xAE],
    el([0xD7], uint(1)), el([0x73, 0xC5], uint(1)), el([0x83], uint(2)), el([0x86], str('A_OPUS')),
    el([0x63, 0xA2], head), el([0x56, 0xAA], uint(Math.round(preSkip / 48000 * 1e9))), el([0x56, 0xBB], uint(80000000)),
    el([0xE1], el([0xB5], f64(48000)), el([0x9F], uint(channels)))));
  const clusters = [];
  let current = null;
  for (const chunk of chunks) {
    const ms = Math.round(chunk.ts / 1000);
    if (!current || ms - current.start > 5000) {
      if (current) clusters.push(el([0x1F, 0x43, 0xB6, 0x75], el([0xE7], uint(current.start)), ...current.blocks));
      current = { start: ms, blocks: [] };
    }
    const rel = ms - current.start;
    current.blocks.push(el([0xA3], new Uint8Array([0x81, (rel >> 8) & 0xff, rel & 0xff, 0x80]), chunk.data));
  }
  if (current) clusters.push(el([0x1F, 0x43, 0xB6, 0x75], el([0xE7], uint(current.start)), ...current.blocks));
  return concat([ebml, el([0x18, 0x53, 0x80, 0x67], info, tracks, ...clusters)]);
}

const toBase64 = bytes => { let text = ''; for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return btoa(text); };

window.encodeOpusWebm = async (base64, bitrate) => {
  const input = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const audio = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(input.buffer);
  const channels = Math.min(2, audio.numberOfChannels);
  const frames = audio.length;
  const chunks = [];
  let description = null;
  let failure = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ ts: chunk.timestamp, data });
      if (!description && meta && meta.decoderConfig && meta.decoderConfig.description) description = new Uint8Array(meta.decoderConfig.description);
    },
    error: error => { failure = error; },
  });
  encoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: channels, bitrate });
  for (let start = 0; start < frames; start += 48000) {
    const count = Math.min(48000, frames - start);
    const data = new Float32Array(count * channels);
    for (let channel = 0; channel < channels; channel++) data.set(audio.getChannelData(channel).subarray(start, start + count), channel * count);
    encoder.encode(new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: count, numberOfChannels: channels, timestamp: Math.round(start * 1e6 / 48000), data }));
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  let head = description;
  if (!head || head.length < 19 || String.fromCharCode(...head.subarray(0, 8)) !== 'OpusHead') {
    head = new Uint8Array(19);
    head.set(str('OpusHead'));
    head[8] = 1; head[9] = channels; head[10] = 312 & 0xff; head[11] = 312 >> 8;
    new DataView(head.buffer).setUint32(12, 48000, true);
  }
  const preSkip = head[10] | (head[11] << 8);
  const webm = muxWebm({ chunks, head, channels, durationMs: frames / 48, preSkip });
  const check = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(webm.slice().buffer);
  let energy = 0;
  const probe = check.getChannelData(0);
  for (let index = 0; index < probe.length; index += 97) energy += probe[index] * probe[index];
  return { base64: toBase64(webm), seconds: frames / 48000, decodedSeconds: check.duration, size: webm.length, energy };
};
true;
`;

const BROWSERS = [
  process.env.OCHAG_BROWSER,
  join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter(Boolean);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The browser writes its DevTools port into the profile folder once it listens.
async function startBrowser(profile, page) {
  const browser = BROWSERS.find(file => existsSync(file));
  if (!browser) throw new Error('Microsoft Edge не найден. Укажите браузер на Chromium в OCHAG_BROWSER.');
  const child = spawn(browser, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', pathToFileURL(page).href,
  ], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt++) await sleep(100);
  if (!existsSync(portFile)) {
    child.kill();
    throw new Error('Браузер не открыл порт отладки.');
  }
  const port = readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
  let target;
  for (let attempt = 0; attempt < 50 && !target; attempt++) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = targets.find(entry => entry.type === 'page' && entry.url.startsWith('file:'));
    if (!target) await sleep(100);
  }
  if (!target) {
    child.kill();
    throw new Error('Страница кодировщика не открылась.');
  }
  return { child, port, socketUrl: target.webSocketDebuggerUrl };
}

function devtools(socketUrl) {
  const socket = new WebSocket(socketUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  let next = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  });
  const opened = new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const send = async (method, params = {}) => {
    await opened;
    const id = ++next;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

// Browser.close lets Edge stop its helper processes, which hold the profile folder until then.
async function closeBrowser(port, child) {
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const browser = devtools(webSocketDebuggerUrl);
    await Promise.race([browser.send('Browser.close').catch(() => {}), sleep(2000)]);
    browser.close();
  } catch {
    // The browser is already gone.
  }
  await Promise.race([exited, sleep(5000)]);
  if (child.exitCode === null) child.kill();
}

// jobs: [{from, to, bitrate}]; returns how many failed.
export async function encodeAmbience(jobs) {
  const profile = mkdtempSync(join(tmpdir(), 'ochag-encode-'));
  const page = join(profile, 'encode.html');
  writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>encode</title>');
  const { child, port, socketUrl } = await startBrowser(profile, page);
  const tab = devtools(socketUrl);
  let failed = 0;
  try {
    await tab.evaluate(RENDERER);
    for (const job of jobs) {
      try {
        const input = readFileSync(job.from).toString('base64');
        const result = await tab.evaluate(`encodeOpusWebm(${JSON.stringify(input)}, ${Number(job.bitrate) || 64000})`);
        if (!(result.decodedSeconds > result.seconds - 0.5) || !(result.energy > 0)) {
          throw new Error(`проверка не прошла: ${JSON.stringify({ ...result, base64: undefined })}`);
        }
        writeFileSync(job.to, Buffer.from(result.base64, 'base64'));
        console.log(`${basename(job.to)}: ${(statSync(job.from).size / 1024) | 0} КБ → ${(result.size / 1024) | 0} КБ, ${result.decodedSeconds.toFixed(2)} с`);
      } catch (error) {
        failed++;
        console.error(`${basename(job.to)}: ${error?.message ?? error}`);
      }
    }
  } finally {
    tab.close();
    await closeBrowser(port, child);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10 });
    } catch {
      // A folder still held is left in %TEMP% for Windows to clear.
    }
  }
  return failed;
}
