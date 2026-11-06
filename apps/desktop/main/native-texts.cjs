const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain } = require('electron');
const { validateSender } = require('./senders.cjs');

// Windows' own dialogs and window titles are out of the page translator's reach: the page sends its translations
// of these texts (apps/client/src/i18n/nativeTexts.ts), and they are kept for the next start's error box.
let texts = {};

const storePath = () => path.join(app.getPath('userData'), 'native-texts.json');

function loadNativeTexts() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) texts = parsed;
  } catch {
  }
}

function nativeText(text) {
  const value = texts[text];
  return typeof value === 'string' && value.trim() ? value : text;
}

function registerNativeTextHandlers(ctx) {
  ipcMain.handle('locales:nativeTexts', (event, input) => {
    validateSender(ctx, event);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;

    const next = {};
    for (const [key, value] of Object.entries(input).slice(0, 100)) {
      if (typeof value === 'string' && key.length <= 200 && value.length <= 200) next[key] = value;
    }

    texts = next;
    fs.promises.writeFile(storePath(), JSON.stringify(next)).catch(() => {});
  });
}

module.exports = { loadNativeTexts, nativeText, registerNativeTextHandlers };
