// Ambience loops → Opus in WebM: a hidden Electron window decodes OGG (decodeAudioData) and encodes Opus (WebCodecs); the WebM container is written here.
//   electron scripts/encode-ambience.cjs <jobs.json>   (jobs: [{from, to, bitrate}])

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
  return { base64: toBase64(webm), seconds: frames / 48000, decodedSeconds: check.duration, size: webm.length, energy, described: Boolean(description), secure: isSecureContext };
};
true;
`;

app.whenReady().then(async () => {
  const jobs = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));
  const page = path.join(os.tmpdir(), `ochag-encode-${process.pid}.html`);
  fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>encode</title>');
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadFile(page);
  await win.webContents.executeJavaScript(RENDERER);
  let failed = 0;
  for (const job of jobs) {
    try {
      const input = fs.readFileSync(job.from).toString('base64');
      const result = await win.webContents.executeJavaScript(`encodeOpusWebm(${JSON.stringify(input)}, ${Number(job.bitrate) || 64000})`);
      if (!(result.decodedSeconds > result.seconds - 0.5) || !(result.energy > 0)) throw new Error(`проверка не прошла: ${JSON.stringify({ ...result, base64: undefined })}`);
      fs.writeFileSync(job.to, Buffer.from(result.base64, 'base64'));
      console.log(`${path.basename(job.to)}: ${(fs.statSync(job.from).size / 1024) | 0} КБ → ${(result.size / 1024) | 0} КБ, ${result.decodedSeconds.toFixed(2)} с`);
    } catch (error) {
      failed++;
      console.error(`${path.basename(job.to)}: ${error && error.message ? error.message : error}`);
    }
  }
  fs.rmSync(page, { force: true });
  app.exit(failed ? 1 : 0);
});
