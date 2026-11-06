import { ref, watch } from 'vue';

import { buildIndex, condense, createTranslator, englishQuotes, type Translator } from './domTranslateCore';
import { locale, translationEntries } from './i18n';
import { SOURCE_LOCALE } from './i18nCore';
import { NATIVE_TEXTS } from './nativeTexts';

const ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt', 'label'] as const;
const SKIP = 'script, style, textarea, code, pre, [contenteditable=""], [contenteditable="true"], [translate="no"], .notranslate';
const OWN_TEXT = 'textarea, [contenteditable=""], [contenteditable="true"]';
const NEVER = 'script, style, code, pre, [translate="no"], .notranslate';

type Shown = { original: string; shown: string };
const textRecords = new WeakMap<Text, Shown>();
const attributeRecords = new WeakMap<Element, Map<string, Shown>>();

let translator: Translator | null = null;
const translatorVersion = ref(0);
let observer: MutationObserver | null = null;
let srd: Array<[string, string]> = [];
let srdNames = new Map<string, string>();

const protectedGroups = new Map<string, Set<string>>();
let protectedNames = new Set<string>();
const creatureName = (text: string): string | null => {
  if (!protectedNames.has(text)) return null;
  const exact = srdNames.get(text);
  if (exact) return exact;
  const match = /^(.*?)((?:\s+\d+)?(?:\s+\([^()]*\))?(?:\s+\d+)?)$/.exec(text);
  const base = match?.[1] ?? text;
  const english = base && base !== text ? srdNames.get(base) : undefined;
  return english ? english + (match?.[2] ?? '') : null;
};
const isProtected = (text: string) => protectedNames.has(text);

export function protectNames(group: string, names: Iterable<string>) {
  const next = new Set([...names].map(name => condense(name)).filter(Boolean));
  const before = protectedGroups.get(group);
  if (before && before.size === next.size && [...next].every(name => before.has(name))) return;
  protectedGroups.set(group, next);
  protectedNames = new Set([...protectedGroups.values()].flatMap(set => [...set]));
  if (translator) {
    restoreTree(document.body);
    start();
  }
}

export function shownText(text: string): string {
  void translatorVersion.value;
  return translator?.translate(text) ?? text;
}

function skipped(element: Element | null): boolean {
  return !element || Boolean(element.closest(SKIP));
}

function translateText(node: Text) {
  const data = node.data;
  const record = textRecords.get(node);
  if (record && data === record.shown) return;
  if (!translator || skipped(node.parentElement)) return;
  const result = translator.translate(data) ?? (locale.value === 'en' ? englishQuotes(data.trim()) : null);
  if (result === null) {
    textRecords.delete(node);
    return;
  }
  const leading = /^\s*/.exec(data)![0];
  const trailing = /\s*$/.exec(data)![0];
  const shown = `${leading}${result}${trailing}`;
  textRecords.set(node, { original: data, shown });
  if (data !== shown) node.data = shown;
}

function translateAttribute(element: Element, name: string) {
  const value = element.getAttribute(name);
  if (value === null) return;
  let records = attributeRecords.get(element);
  const record = records?.get(name);
  if (record && value === record.shown) return;
  if (!translator || element.closest(NEVER) || element.parentElement?.closest(OWN_TEXT)) return;
  const result = translator.translate(value);
  if (result === null) {
    records?.delete(name);
    return;
  }
  if (!records) attributeRecords.set(element, (records = new Map()));
  records.set(name, { original: value, shown: result });
  if (value !== result) element.setAttribute(name, result);
}

function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateText(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    for (const name of ATTRIBUTES) if ((root as Element).hasAttribute(name)) translateAttribute(root as Element, name);
    if (skipped(root as Element)) return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      if (node.nodeType !== Node.ELEMENT_NODE || !(node as Element).matches(SKIP)) return NodeFilter.FILTER_ACCEPT;
      for (const name of ATTRIBUTES) if ((node as Element).hasAttribute(name)) translateAttribute(node as Element, name);
      return NodeFilter.FILTER_REJECT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) translateText(node as Text);
    else for (const name of ATTRIBUTES) if ((node as Element).hasAttribute(name)) translateAttribute(node as Element, name);
  }
}

function restoreTree(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const record = textRecords.get(node as Text);
      if (record && (node as Text).data === record.shown) (node as Text).data = record.original;
      textRecords.delete(node as Text);
      continue;
    }
    const records = attributeRecords.get(node as Element);
    if (!records) continue;
    for (const [name, record] of records) if ((node as Element).getAttribute(name) === record.shown) (node as Element).setAttribute(name, record.original);
    attributeRecords.delete(node as Element);
  }
}

function start() {
  translator = createTranslator(buildIndex([...translationEntries.value, ...srd]), { isProtected, name: creatureName, shielded: () => protectedNames });
  translatorVersion.value += 1;
  translateTree(document.body);
  if (observer) return;
  observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') translateText(mutation.target as Text);
      else if (mutation.type === 'attributes' && mutation.attributeName) translateAttribute(mutation.target as Element, mutation.attributeName);
      else for (const node of mutation.addedNodes) translateTree(node);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES] });
  sendNativeTexts();
}

function stop() {
  observer?.disconnect();
  observer = null;
  translator = null;
  translatorVersion.value += 1;
  restoreTree(document.body);
  sendNativeTexts();
}

function sendNativeTexts() {
  const send = window.desktop?.locales?.nativeTexts;
  if (!send) return;
  void send(Object.fromEntries(NATIVE_TEXTS.map(text => [text, translator?.translate(text) ?? text]))).catch(() => undefined);
}

export function installDomTranslation() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  watch([locale, translationEntries], () => {
    if (locale.value === SOURCE_LOCALE) {
      stop();
      return;
    }
    start();
    if (!srd.length) {
      void import('../locales/srd-en.json').then(module => {
        srd = Object.entries((module.default ?? module) as Record<string, string>);
        srdNames = new Map(srd.map(([key, value]) => [condense(key), value]));
        if (locale.value !== SOURCE_LOCALE) start();
      }).catch(() => undefined);
    }
  }, { immediate: true });
}
