// UI sweep of the table: at each window size and UI scale every panel and popover must be on screen, unobscured and not overflowing.
// Needs the app with --remote-debugging-port=9333 (CDP_PORT) and an open table scene with tokens.
//   node scripts/ui-sweep.mjs [WxH,...] [scales in %]
//   node scripts/ui-sweep.mjs 1920x1080,1366x768,1280x720,1024x700 100,125
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WebSocket = createRequire(import.meta.url)('ws');

const VIEWPORTS = (process.argv[2] ?? '1920x1080,1366x768,1280x720,1024x700').split(',').map(v => v.split('x').map(Number));
const SCALES = (process.argv[3] ?? '100,125').split(',').map(Number);
const OUT = process.env.UI_SWEEP_OUT ?? join(tmpdir(), 'ttrpg-ui-sweep');
const TAG = process.env.CDP_COMBAT ? 'бой' : 'мир';
const CELLS = ['Атака', 'Магия', 'Умения', 'Проверки', 'Действия', 'Отдых', 'Обыскать', 'Торговать', 'Даровать'];
const SECTIONS = ['Сцены', 'Объекты', 'Заметки', 'Встречи', 'Задания', 'Фракции'];
const SHEET_TABS = ['Герой', 'Магия', 'Снаряжение', 'Другое', 'Правка листа'];
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT ?? 9333}/json/list`)).json();
  const page = targets.find(t => t.type === 'page' && t.url.startsWith('file:') && !t.url.includes('view=player'));
  if (!page) throw new Error('Нет окна приложения: ' + JSON.stringify(targets.map(t => t.url)));
  const socket = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let id = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    const waiter = message.id && pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id;
    const timer = setTimeout(() => { pending.delete(messageId); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(messageId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error('eval: ' + JSON.stringify(result.exceptionDetails).slice(0, 600));
    return result.result.value;
  };
  const screenshot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const key = async (code, keyText) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: keyText });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: keyText });
  };
  const rightClick = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
  };
  return { send, evaluate, screenshot, key, rightClick, close: () => socket.close() };
}

const cdp = await connect();

await cdp.evaluate(`(() => {
  const describe = el => {
    if (!el) return 'ничего';
    const owner = el.closest('.game-window,.sheet-overlay,.modal-overlay,.action-popover,.game-console,.game-tool-rail,.game-initiative,.game-portraits,.game-location,.game-topbar,.token-menu,.rail-more-menu,canvas');
    const base = owner || el;
    return base.tagName.toLowerCase() + '.' + [...base.classList].slice(0, 2).join('.');
  };
  const label = el => (el.getAttribute?.('aria-label') || el.textContent || el.className || el.tagName).toString().trim().replace(/\\s+/g, ' ').slice(0, 40);
  // Descendants sticking out of el (overflow: visible does not clip them); a vertically scrolling box only counts sideways overflow.
  window.__overflow = el => {
    const box = el.getBoundingClientRect();
    const own = getComputedStyle(el);
    const scrollsY = /(auto|scroll)/.test(own.overflowY);
    if (scrollsY && /(auto|scroll)/.test(own.overflowX)) return [];
    const out = [];
    for (const child of el.querySelectorAll('*')) {
      const cs = getComputedStyle(child);
      // The window's resize handle sits on the edge on purpose.
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed' || child.getAttribute('role') === 'separator') continue;
      const r = child.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // Clipped or scrolled by an ancestor: intended.
      let clipped = false;
      for (let p = child.parentElement; p && p !== el; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(ps.overflowX + ps.overflowY) || ps.position === 'fixed') { clipped = true; break; }
      }
      if (clipped) continue;
      const over = scrollsY ? Math.max(box.left - r.left, r.right - box.right) : Math.max(box.left - r.left, r.right - box.right, box.top - r.top, r.bottom - box.bottom);
      if (over > 3) out.push(label(child) + ' (+' + Math.round(over) + 'px)');
      if (out.length >= 4) break;
    }
    return out;
  };
  // Taller than its box with no visible scrollbar: the buttons below seem to vanish.
  window.__hiddenScroll = el => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const scrolls = /(auto|scroll)/.test(cs.overflowY);
    const clipped = el.scrollHeight > el.clientHeight + 4;
    if (!clipped) return null;
    if (!scrolls) return 'обрезано по высоте на ' + (el.scrollHeight - el.clientHeight) + 'px';
    return cs.scrollbarWidth === 'none' ? 'не помещается на ' + (el.scrollHeight - el.clientHeight) + 'px, а полосы прокрутки нет' : null;
  };
  // Items inside one panel overlapping each other (buttons, lists, badges).
  window.__innerOverlaps = (el, selector) => {
    const items = [...el.querySelectorAll(selector)].filter(item => item.offsetParent && item.getBoundingClientRect().width > 4);
    const out = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      if (items[i].contains(items[j]) || items[j].contains(items[i])) continue;
      const a = items[i].getBoundingClientRect(), b = items[j].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 3 && h > 3) out.push(label(items[i]) + ' × ' + label(items[j]));
      if (out.length >= 3) return out;
    }
    return out;
  };
  window.__probe = (el, name, opts = {}) => {
    if (!el) return opts.required ? { name, ok: false, why: 'нет элемента' } : { name, ok: true, skipped: true, why: 'нет на экране' };
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return { name, ok: !opts.required, skipped: true, why: 'скрыт' };
    const r = el.getBoundingClientRect();
    const vw = innerWidth, vh = innerHeight;
    const rect = [r.left, r.top, r.width, r.height].map(Math.round);
    if (r.width < 4 || r.height < 4) return { name, ok: false, why: 'нулевой размер', rect };
    const left = Math.max(0, r.left), right = Math.min(vw, r.right), top = Math.max(0, r.top), bottom = Math.min(vh, r.bottom);
    if (right - left < 4 || bottom - top < 4) return { name, ok: false, why: 'за краем экрана', rect };
    const outside = [r.left < -1 && 'слева', r.top < -1 && 'сверху', r.right > vw + 1 && 'справа', r.bottom > vh + 1 && 'снизу'].filter(Boolean);
    const cx = left + (right - left) / 2;
    const covered = [];
    for (const [where, x, y] of [['верх', cx, top + Math.min(14, (bottom - top) / 4)], ['центр', cx, top + (bottom - top) / 2], ['низ', cx, bottom - Math.min(14, (bottom - top) / 4)]]) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !el.contains(hit)) covered.push(where + ': ' + describe(hit));
    }
    const overflow = opts.noOverflow ? [] : window.__overflow(el);
    const hscroll = opts.scrollBox ? (() => { const box = el.querySelector(opts.scrollBox) ?? el; return box.scrollWidth > box.clientWidth + 2 ? 'горизонтальная прокрутка ' + (box.scrollWidth - box.clientWidth) + 'px' : null; })() : null;
    const hidden = opts.clipBox ? window.__hiddenScroll(opts.clipBox === true ? el : el.querySelector(opts.clipBox)) : null;
    const inner = opts.inner ? window.__innerOverlaps(el, opts.inner) : [];
    const ok = !covered.length && !outside.length && !overflow.length && !hscroll && !hidden && !inner.length;
    return { name, ok, rect, ...(outside.length ? { cut: outside.join(',') } : {}), ...(covered.length ? { covered } : {}), ...(overflow.length ? { overflow } : {}), ...(hscroll ? { hscroll } : {}), ...(hidden ? { hidden } : {}), ...(inner.length ? { inner } : {}) };
  };
  // Table panels overlapping each other.
  window.__overlaps = () => {
    const parts = [['лента', '.game-tool-rail'], ['плашка сцены', '.game-location'], ['очередь хода', '.game-initiative'], ['портреты', '.game-portraits'], ['нижняя панель', '.game-console'], ['верхняя панель', '.game-topbar'], ['выделено', '.multi-bar:not(.as-menu)']]
      .map(([name, selector]) => [name, document.querySelector(selector)])
      .filter(([, el]) => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 4);
    const out = [];
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i][1].getBoundingClientRect(), b = parts[j][1].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 4 && h > 4) out.push(parts[i][0] + ' × ' + parts[j][0] + ' (' + Math.round(w) + '×' + Math.round(h) + ')');
    }
    return out;
  };
  window.__visibleWindows = () => [...document.querySelectorAll('.game-window')].filter(w => getComputedStyle(w).display !== 'none');
  window.__overlay = () => [...document.querySelectorAll('.sheet-overlay,.modal-overlay,.factions-dialog')].find(o => getComputedStyle(o).display !== 'none') ?? null;
  // Not Escape: at the table it also clears the selected creature.
  window.__closeAll = async () => {
    for (let i = 0; i < 4; i++) {
      const overlay = window.__overlay();
      if (!overlay) break;
      const close = [...overlay.querySelectorAll('button')].find(b => /закрыть/i.test(b.getAttribute('aria-label') ?? '') || ['✕', '×', 'Закрыть'].includes(b.textContent.trim()));
      if (close) close.click(); else overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
    }
    for (const w of window.__visibleWindows()) w.querySelector('.game-window-close')?.click();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
  };
  return true;
})()`);

const report = [];
const safe = text => text.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60);
async function record(where, result) {
  report.push({ where, ...result });
  if (!result.ok && !result.skipped) await cdp.screenshot(`fail-${safe(where)}-${safe(result.name)}`);
}

async function setSize(width, height, scale) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.evaluate(`(window.desktop?.zoom?.set(${scale / 100}), true)`);
  await sleep(1200);
}

async function sweep(where) {
  await cdp.evaluate('window.__closeAll()');
  await sleep(400);
  for (const [name, selector, opts] of [
    ['лента', '.game-tool-rail', { required: true, clipBox: '.rail-scroll' }], ['плашка сцены', '.game-location', {}], ['очередь хода', '.game-initiative', {}],
    ['портреты', '.game-portraits', { clipBox: true }], ['нижняя панель', '.game-console', { required: true, clipBox: '.cat-row', scrollBox: '.game-log-lines' }],
    ['верхняя панель', '.game-topbar', { inner: 'button, select, .connection-badge, .topbar-brand' }],
  ]) await record(where, await cdp.evaluate(`window.__probe(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(name)}, ${JSON.stringify(opts)})`));
  const overlaps = await cdp.evaluate('window.__overlaps()');
  report.push({ where, name: 'панели стола не наезжают', ok: !overlaps.length, ...(overlaps.length ? { overlaps } : {}) });
  if (overlaps.length) await cdp.screenshot(`fail-${safe(where)}-overlap`);
  await cdp.screenshot(`overview-${safe(where)}`);

  await cdp.evaluate(`document.querySelector('.game-portraits .portrait')?.click()`);
  await sleep(600);
  const cells = await cdp.evaluate(`[...document.querySelectorAll('.game-console button')].filter(b => !b.disabled && b.offsetParent).map(b => b.textContent.trim().replace(/\\s+/g, ' '))`);
  for (const cell of CELLS) {
    const label = cells.find(text => text === cell || text.startsWith(cell));
    if (!label) continue;
    await cdp.evaluate('window.__closeAll()');
    await cdp.evaluate(`[...document.querySelectorAll('.game-console button')].find(b => !b.disabled && b.offsetParent && b.textContent.trim().replace(/\\s+/g, ' ') === ${JSON.stringify(label)})?.click()`);
    await sleep(700);
    await record(where, await cdp.evaluate(`(() => {
      const popover = document.querySelector('.action-popover');
      if (popover) return window.__probe(popover, ${JSON.stringify('ячейка: ' + cell)});
      const overlay = window.__overlay();
      if (overlay) return window.__probe(overlay.firstElementChild, ${JSON.stringify('ячейка: ' + cell + ' (окно)')}, { scrollBox: '.modal-card' });
      return { name: ${JSON.stringify('ячейка: ' + cell)}, ok: true, skipped: true, why: 'сразу действие' };
    })()`));
  }

  for (const [button, selector, name] of [['Звук', '.sound-popover', 'попап «Звук»'], ['Ещё', '.rail-more-menu:not(.rail-sound)', 'меню «Ещё»']]) {
    await cdp.evaluate('window.__closeAll()');
    await cdp.evaluate(`document.querySelector('.game-tool-rail button[aria-label=${JSON.stringify(button)}]')?.click()`);
    await sleep(600);
    await record(where, await cdp.evaluate(`window.__probe(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(name)})`));
  }

  for (const section of SECTIONS) {
    await cdp.evaluate('window.__closeAll()');
    const clicked = await cdp.evaluate(`(() => { const b = document.querySelector('.game-tool-rail button[aria-label=${JSON.stringify(section)}]'); if (!b) return false; b.click(); return true; })()`);
    if (!clicked) continue;
    await sleep(900);
    await record(where, await cdp.evaluate(`(() => {
      const overlay = window.__overlay();
      if (overlay) return window.__probe(overlay.querySelector('.modal-card, .factions-card') ?? overlay.firstElementChild, ${JSON.stringify('окно: ' + section)}, { scrollBox: '.modal-card, .factions-card' });
      const opened = window.__visibleWindows();
      if (!opened.length) return { name: ${JSON.stringify('окно: ' + section)}, ok: false, why: 'ничего не открылось' };
      return window.__probe(opened[0], ${JSON.stringify('окно: ' + section)}, { scrollBox: '.game-window-body' });
    })()`));
  }

  await cdp.evaluate('window.__closeAll()');
  const token = await cdp.evaluate(`JSON.stringify([...document.querySelectorAll('.token-label')].map(e => e.getBoundingClientRect()).find(r => r.width > 0 && r.top > 80 && r.bottom < innerHeight - 200 && r.left > 120 && r.right < innerWidth - 160) ?? null)`);
  const at = JSON.parse(token);
  if (at) {
    await cdp.rightClick(at.x + at.width / 2, at.y + at.height + 18);
    await sleep(800);
    await record(where, await cdp.evaluate(`window.__probe(document.querySelector('.token-menu .menu-box') ?? document.querySelector('.token-menu'), 'меню фишки')`));
  }

  await cdp.evaluate('window.__closeAll()');
  await cdp.evaluate(`document.querySelector('.game-portraits .portrait')?.click()`);
  await sleep(500);
  if (await cdp.evaluate(`(() => { const b = document.querySelector('.game-tool-rail button[aria-label="Лист"]'); if (!b) return false; b.click(); return true; })()`)) {
    await sleep(1500);
    for (const tab of SHEET_TABS) {
      const ok = await cdp.evaluate(`(() => { const b = [...document.querySelectorAll('.sheet-tabs button')].find(b => b.textContent.trim().endsWith(${JSON.stringify(tab)})); if (!b) return false; b.click(); return true; })()`);
      if (!ok) continue;
      await sleep(700);
      await record(where, await cdp.evaluate(`window.__probe(document.querySelector('.sheet-parchment'), ${JSON.stringify('лист: ' + tab)}, { scrollBox: '.sheet-parchment' })`));
      await cdp.screenshot(`sheet-${safe(where)}-${safe(tab)}`);
    }
  }
  await cdp.evaluate('window.__closeAll()');
}

const startScale = await cdp.evaluate(`window.desktop?.zoom?.get?.() ?? 1`);
for (const [width, height] of VIEWPORTS) {
  for (const scale of SCALES) {
    await setSize(width, height, scale);
    await sweep(`${TAG} ${width}x${height} ${scale}%`);
  }
}
await cdp.send('Emulation.clearDeviceMetricsOverride');
await cdp.evaluate(`(window.desktop?.zoom?.set(${startScale}), true)`);
writeFileSync(join(OUT, `report-${safe(TAG)}.json`), JSON.stringify(report, null, 2));
cdp.close();

const fails = report.filter(entry => !entry.ok);
console.log(`Проверено ${report.length}, неудач ${fails.length}. Отчёт: ${join(OUT, `report-${safe(TAG)}.json`)}`);
for (const entry of fails) console.log('НЕУДАЧА', entry.where, '·', entry.name, JSON.stringify({ why: entry.why, cut: entry.cut, covered: entry.covered, overflow: entry.overflow, hscroll: entry.hscroll, hidden: entry.hidden, inner: entry.inner, overlaps: entry.overlaps, rect: entry.rect }));
process.exitCode = fails.length ? 1 : 0;
