type Pattern = {
  regex: RegExp;
  names: string[];
  raw: boolean[];
  value: string;
  weight: number;
  probe: string;
};

export type TranslationIndex = {
  exact: Map<string, string>;
  buckets: Map<string, Pattern[]>;
  lead: Pattern[];
};

const CYRILLIC = /[А-Яа-яЁё]/;
const CYRILLIC_ALL = /[А-Яа-яЁё]/g;
const CYRILLIC_RUN = /[А-Яа-яЁё]+(?:[\s-]+[А-Яа-яЁё]+)*/g;
const AFFIX_HEAD = /^(?:(?![{}])[\s\p{S}\p{P}])+/u;
const AFFIX_TAIL = /(?:(?![{}])[\s\p{S}\p{P}])+$/u;
const PLACEHOLDER = /(\{\{|\}\}|\{\w+\})/;

export function condense(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// A lone «/» text node beside an untranslated name (`«<span translate="no">…</span>» — …`) gets English quotes like its neighbour.
export function englishQuotes(text: string): string | null {
  return /[«»]/.test(text) && !CYRILLIC.test(text) ? text.replace(/«/g, '“').replace(/»/g, '”') : null;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unbrace = (text: string) => text.replace(/\{\{/g, '{').replace(/\}\}/g, '}');

function substitute(template: string, params: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (whole, name: string) => (params[name] === undefined ? whole : params[name]!))
    .replace(/\{\{/g, '{').replace(/\}\}/g, '}');
}

function compile(key: string, value: string): Pattern | null {
  const tokens = key.split(PLACEHOLDER).filter(token => token !== '');
  const names: string[] = [];
  let source = '^';
  let literal = '';
  let longest = '';
  let current = '';
  const raw: boolean[] = [];
  let previousWasPlaceholder = false;
  for (const token of tokens) {
    if (token === '{{' || token === '}}') {
      const brace = token[0]!;
      source += escapeRegex(brace);
      literal += brace;
      current += brace;
      continue;
    }
    const placeholder = /^\{(\w+)\}$/.exec(token);
    if (placeholder) {
      const glued = names.length > 0 && previousWasPlaceholder;
      if (glued) raw[raw.length - 1] = true;
      names.push(placeholder[1]!);
      raw.push(glued);
      source += '(.+?)';
      if (current.length > longest.length) longest = current;
      current = '';
      previousWasPlaceholder = true;
      continue;
    }
    if (token) previousWasPlaceholder = false;
    source += escapeRegex(token);
    literal += token;
    current += token;
  }
  if (current.length > longest.length) longest = current;
  source += '$';
  if (!names.length || literal.replace(/[\s\p{P}]/gu, '').length < 2 || !CYRILLIC.test(literal)) return null;
  return { regex: new RegExp(source, 's'), names, raw, value, weight: literal.length, probe: longest.trim() || longest };
}

const PAIRS: Array<[string, string]> = [['«', '»'], ['“', '”'], ['(', ')'], ['[', ']']];
function balanced(text: string): boolean {
  return PAIRS.every(([open, close]) => text.split(open).length === text.split(close).length);
}

function cyrillicLeft(text: string): number {
  return (text.match(CYRILLIC_ALL) ?? []).length;
}

function stripAffixes(text: string): string {
  const head = text.replace(AFFIX_HEAD, '');
  const both = head.replace(AFFIX_TAIL, '');
  if (balanced(both)) return both;
  return balanced(head) ? head : text;
}

export function buildIndex(entries: Iterable<[string, string]>): TranslationIndex {
  const exact = new Map<string, string>();
  const cores: Array<[string, string]> = [];
  const extra: Array<[string, string]> = [];
  const buckets = new Map<string, Pattern[]>();
  const lead: Pattern[] = [];
  const seen = new Set<string>();
  for (const [rawKey, value] of entries) {
    if (!value || typeof value !== 'string') continue;
    const key = condense(rawKey);
    if (!key || seen.has(key) || !CYRILLIC.test(key)) continue;
    seen.add(key);
    if (!/\{\w+\}/.test(key.replace(/\{\{|\}\}/g, ''))) {
      exact.set(unbrace(key), unbrace(value));
      cores.push([unbrace(key), unbrace(value)]);
      continue;
    }
    const short = / — \{\w+\}$/.exec(key);
    const shortValue = / — \{\w+\}$/.exec(value);
    if (short && shortValue) {
      const shorter = key.slice(0, short.index);
      if (!seen.has(shorter)) extra.push([shorter, value.slice(0, shortValue.index)]);
    }
    const bare = stripAffixes(key);
    if (bare !== key && /\{\w+\}/.test(bare) && !seen.has(bare)) extra.push([bare, stripAffixes(value)]);
    const pattern = compile(key, value);
    if (!pattern) continue;
    const head = key.split(PLACEHOLDER)[0] ?? '';
    if (head.length >= 2) {
      const bucket = head.slice(0, 2);
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket)!.push(pattern);
    } else {
      lead.push(pattern);
    }
  }
  for (const [key, value] of extra) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (!/\{\w+\}/.test(key)) {
      if (!exact.has(key)) exact.set(unbrace(key), unbrace(value));
      continue;
    }
    const pattern = compile(key, value);
    if (!pattern) continue;
    const head = key.split(PLACEHOLDER)[0] ?? '';
    if (head.length >= 2) {
      const bucket = head.slice(0, 2);
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket)!.push(pattern);
    } else {
      lead.push(pattern);
    }
  }
  for (const [key, value] of cores) {
    const keyCore = stripAffixes(key);
    const valueCore = stripAffixes(value);
    if (keyCore && keyCore !== key && valueCore && CYRILLIC.test(keyCore) && !exact.has(keyCore)) exact.set(keyCore, valueCore);
  }
  const byWeight = (a: Pattern, b: Pattern) => b.weight - a.weight;
  for (const list of buckets.values()) list.sort(byWeight);
  lead.sort(byWeight);
  return { exact, buckets, lead };
}

type Scored = { result: string; left: number; weight: number };

export type Translator = {
  translate(text: string): string | null;
};

export function createTranslator(
  index: TranslationIndex,
  options: { cacheLimit?: number; isProtected?: (text: string) => boolean; name?: (text: string) => string | null; shielded?: () => Iterable<string> } = {},
): Translator {
  const cacheLimit = options.cacheLimit ?? 8000;
  const cache = new Map<string, string | null>();
  const flippedCase = (text: string): string | null => {
    if (text.length < 3) return null;
    const first = text[0]!;
    const lower = first === first.toLowerCase();
    const other = index.exact.get((lower ? first.toUpperCase() : first.toLowerCase()) + text.slice(1));
    if (!other) return null;
    return (lower ? other[0]!.toLowerCase() : other[0]!.toUpperCase()) + other.slice(1);
  };
  const translate = (raw: string, depth: number): string | null => {
    if (!CYRILLIC.test(raw)) return null;
    const text = condense(raw);
    const named = options.name?.(text);
    if (named) return named;
    if (options.isProtected?.(text)) return null;
    if (depth === 0 && cache.has(text)) return cache.get(text)!;
    // Affixes stay, the middle is translated; an exact middle match beats a whole-string pattern («Спасбросок от смерти:» vs «Спасбросок {…}»).
    const lead = AFFIX_HEAD.exec(text)?.[0] ?? '';
    const tail = AFFIX_TAIL.exec(text.slice(lead.length))?.[0] ?? '';
    const core = text.slice(lead.length, text.length - tail.length);
    const wrapped = Boolean((lead || tail) && core && core !== text);
    const cuts: Array<[string, string, string]> = [];
    if (wrapped) {
      for (let size = 1; size <= tail.length; size += 1) {
        cuts.push(['', text.slice(0, text.length - size), text.slice(text.length - size)]);
        if (lead) cuts.push([lead, text.slice(lead.length, text.length - size), text.slice(text.length - size)]);
      }
      if (lead) cuts.push([lead, text.slice(lead.length), '']);
      for (let at = cuts.length - 1; at >= 0; at -= 1) if (!balanced(cuts[at]![1])) cuts.splice(at, 1);
    }
    let result = index.exact.get(text) ?? null;
    for (const [before, middle, after] of cuts) {
      if (result !== null) break;
      if (middle && index.exact.has(middle)) result = `${before}${index.exact.get(middle)}${after}`;
    }
    if (result === null) {
      let best: Scored | null = byPattern(text, depth);
      for (const [before, middle, after] of cuts) {
        const inner = middle ? byPattern(middle, depth) : null;
        if (inner && (!best || inner.left < best.left || (inner.left === best.left && inner.weight > best.weight))) {
          best = { ...inner, result: `${before}${inner.result}${after}` };
        }
      }
      if (best) result = best.result;
    }
    if (result === null) result = flippedCase(text);
    if (result === null && wrapped) {
      const inner = translate(core, depth);
      if (inner !== null) result = `${lead}${inner}${tail}`;
    }
    if (result === null) {
      const noted = /^(.*\S)\s+\(([^()]*)\)$/s.exec(text);
      if (noted) {
        const head = translate(noted[1]!, depth);
        const note = translate(noted[2]!, depth);
        if (head !== null || note !== null) result = `${head ?? noted[1]} (${note ?? noted[2]})`;
      }
    }
    for (const separator of [' · ', ' → ', ' — ', ': ', '; ', ', ']) {
      if (!text.includes(separator)) continue;
      if (result !== null && !CYRILLIC.test(result)) break;
      const first = text.indexOf(separator);
      const splits = [text.split(separator)];
      // «Name — reason — hint»: the reason after the first separator is often a whole key of its own.
      if (text.indexOf(separator, first + separator.length) >= 0) splits.push([text.slice(0, first), text.slice(first + separator.length)]);
      for (const parts of splits) {
        const translated = parts.map(part => translate(part, depth));
        if (!translated.some(part => part !== null)) continue;
        const joined = parts.map((part, at) => translated[at] ?? part).join(separator);
        if (result === null || cyrillicLeft(joined) < cyrillicLeft(result)) result = joined;
      }
    }
    if (result === null || CYRILLIC.test(result)) {
      const byWords = (source: string) => source.replace(CYRILLIC_RUN, run => (options.isProtected?.(run) ? null : index.exact.get(run) ?? flippedCase(run)) ?? run);
      const fromResult = result !== null ? byWords(result) : null;
      const fromText = byWords(text);
      const best = fromResult !== null && cyrillicLeft(fromResult) <= cyrillicLeft(fromText) ? fromResult : fromText;
      if (best !== (result ?? text) && (result === null || cyrillicLeft(best) < cyrillicLeft(result))) result = best;
    }
    if (depth === 0) {
      if (cache.size >= cacheLimit) cache.clear();
      cache.set(text, result);
    }
    return result;
  };
  const byPattern = (text: string, depth: number): Scored | null => {
    let result: Scored | null = null;
    {
      const candidates = [...(index.buckets.get(text.slice(0, 2)) ?? []), ...index.lead.filter(pattern => !pattern.probe || text.includes(pattern.probe))];
      let best: { result: string; left: number; weight: number } | null = null;
      for (const pattern of candidates) {
        const match = pattern.regex.exec(text);
        if (!match) continue;
        const params: Record<string, string> = {};
        let left = 0;
        pattern.names.forEach((name, position) => {
          const value = match[position + 1] ?? '';
          const translated = depth < 2 && !pattern.raw[position] ? translate(value, depth + 1) : null;
          params[name] = translated ?? value;
          left += ((translated ?? value).match(CYRILLIC_ALL) ?? []).length;
        });
        if (!best || left < best.left || (left === best.left && pattern.weight > best.weight)) {
          best = { result: substitute(pattern.value, params), left, weight: pattern.weight };
        }
      }
      if (best) result = best;
    }
    return result;
  };
  // A user's name inside a longer text («Жалобы, список 2») is hidden behind a marker first, or the word-by-word fallback translates its ordinary words.
  const shield = (text: string): string | null => {
    const names = options.shielded?.();
    if (!names || !CYRILLIC.test(text)) return translate(text, 0);
    const whole = condense(text);
    const alone = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(name)}(?![\\p{L}\\p{N}])`, 'gu');
    const found = [...names]
      .filter(name => name.length >= 2 && name !== whole && CYRILLIC.test(name) && text.includes(name) && alone(name).test(text) && !options.name?.(name))
      .sort((a, b) => b.length - a.length);
    if (!found.length) return translate(text, 0);
    const marker = (at: number) => `⁣${at}⁣`;
    const masked = found.reduce((out, name, at) => out.replace(alone(name), marker(at)), text);
    const result = translate(masked, 0);
    return result === null ? null : found.reduce((out, name, at) => out.split(marker(at)).join(name), result);
  };
  return { translate: shield };
}
