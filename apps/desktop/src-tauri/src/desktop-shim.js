// window.desktop: preload.cjs runs on top of contextBridge, ipcRenderer and webFrame defined here (named after the Electron
// modules it was first written for).
(() => {
  if (window.desktop) return;
  const tauri = () => window.__TAURI_INTERNALS__;
  // Calls travel as one binary frame each way: a u32 header length, the JSON header with {__ochagBlob: n} where bytes were
  // and their lengths in "blobs", then the bytes (bridge::read_frame). Events still bring the rare bytes as base64.
  const BLOB = '__ochagBlob';
  const BYTES = '__ochagBytes';

  const pack = (value, blobs) => {
    if (value instanceof ArrayBuffer) return (blobs.push(new Uint8Array(value)), { [BLOB]: blobs.length - 1 });
    if (ArrayBuffer.isView(value)) return (blobs.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)), { [BLOB]: blobs.length - 1 });
    if (Array.isArray(value)) return value.map(entry => pack(entry, blobs));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, pack(entry, blobs)]));
    return value;
  };
  const toFrame = header => {
    const blobs = [];
    const packed = pack(header, blobs);
    packed.blobs = blobs.map(blob => blob.byteLength);
    const text = new TextEncoder().encode(JSON.stringify(packed));
    const frame = new Uint8Array(4 + text.byteLength + blobs.reduce((sum, blob) => sum + blob.byteLength, 0));
    new DataView(frame.buffer).setUint32(0, text.byteLength, true);
    frame.set(text, 4);
    let offset = 4 + text.byteLength;
    for (const blob of blobs) {
      frame.set(blob, offset);
      offset += blob.byteLength;
    }
    return frame;
  };
  const unpack = (value, blobs) => {
    if (Array.isArray(value)) return value.map(entry => unpack(entry, blobs));
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 1 && keys[0] === BLOB && blobs[value[BLOB]]) return blobs[value[BLOB]];
      if (keys.length === 1 && keys[0] === BYTES && typeof value[BYTES] === 'string') {
        const text = atob(value[BYTES]);
        const bytes = new Uint8Array(text.length);
        for (let at = 0; at < text.length; at++) bytes[at] = text.charCodeAt(at);
        return bytes.buffer;
      }
      return Object.fromEntries(keys.map(key => [key, unpack(value[key], blobs)]));
    }
    return value;
  };
  const fromFrame = data => {
    const buffer = data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer;
    const size = new DataView(buffer).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, size)));
    const blobs = [];
    let offset = 4 + size;
    for (const length of header.blobs ?? []) {
      blobs.push(buffer.slice(offset, offset + length));
      offset += length;
    }
    return unpack(header.value, blobs);
  };
  const decode = value => unpack(value, []);

  // Tauri rejects with a bare string; Electron rejected with an Error, and the client shows `cause.message` only for Errors.
  const asError = cause => (cause instanceof Error ? cause : new Error(typeof cause === 'string' ? cause : String(cause?.message ?? cause)));

  const unlisteners = new Map();
  const ipcRenderer = {
    invoke: (channel, ...args) => tauri().invoke('desktop_invoke', toFrame({ channel, args })).then(fromFrame, cause => { throw asError(cause); }),
    on(channel, listener) {
      unlisteners.set(listener, window.__TAURI__.event.listen(channel, event => listener({}, ...decode(event.payload ?? []))));
      return ipcRenderer;
    },
    removeListener(_channel, listener) {
      const unlisten = unlisteners.get(listener);
      unlisteners.delete(listener);
      void unlisten?.then(stop => stop());
      return ipcRenderer;
    },
  };

  let zoom = 1;
  const webFrame = {
    setZoomFactor(factor) {
      zoom = factor;
      void tauri().invoke('set_zoom', { factor });
    },
    getZoomFactor: () => zoom,
  };

  const contextBridge = {
    exposeInMainWorld(key, api) {
      Object.defineProperty(window, key, { value: Object.freeze(api), configurable: false, writable: false });
    },
  };

  /*PRELOAD*/

  // Links leave for the browser; the shell checks them against its list. F11 is full screen in the players' window.
  window.open = url => {
    void tauri().invoke('open_external', { url: String(url) });
    return null;
  };
  if (new URLSearchParams(location.search).get('view') === 'player') {
    window.addEventListener('keydown', event => {
      if (event.key !== 'F11') return;
      event.preventDefault();
      void tauri().invoke('toggle_fullscreen');
    }, true);
  }
})();
