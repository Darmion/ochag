import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLIENT = join(ROOT, 'apps', 'client', 'src');
export const SERVER_ROOTS = ['apps/server/src', 'apps/desktop', 'packages/domain', 'packages/importer', 'mods'].map(dir => join(ROOT, ...dir.split('/')));
const require = createRequire(join(ROOT, 'apps', 'client', 'package.json'));
let parseSfc;
let babel;
function loadParsers() {
  parseSfc ??= require('@vue/compiler-sfc').parse;
  babel ??= require('@babel/parser');
}

const CYRILLIC = /[А-Яа-яЁё]/;
const SKIP_ATTRIBUTES = new Set(['class', 'style', 'id', 'key', 'ref', 'name', 'value', 'for', 'type', 'src', 'href', 'accept', 'pattern', 'lang', 'role', 'slot']);
const MATCHING = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'split', 'replace', 'replaceAll', 'test', 'match', 'search', 'has', 'get', 'getItem', 'setItem', 'removeItem']);
const SKIP_FILES = new Set(['itemArt.ts']);
// Russian spell description samples the parser reads; the rules dialog shows them as they are (translate="no").
const PARSER_SAMPLES = new Set(['example', 'higher']);
const PLURAL_CALL = /(?<![\w.$])tn\(\s*[^,()]+,\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'locales' && entry.name !== 'node_modules') files.push(...walk(path));
    } else if (/\.(vue|ts|cjs)$/.test(entry.name) && entry.name !== 'i18nCore.ts' && !entry.name.endsWith('.d.ts') && !entry.name.endsWith('.test.ts') && !SKIP_FILES.has(entry.name)) {
      files.push(path);
    } else if (entry.name === 'artLibrary.json' || entry.name === 'library.json') {
      files.push(path);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

const condense = text => text.replace(/\s+/g, ' ').trim();

// Placeholder name comes from the expression: hp → {hp}, character.hpMax → {hpMax}, otherwise {value}.
function placeholderName(node) {
  if (!node) return 'value';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    if (!node.computed && node.property.type === 'Identifier') return node.property.name;
    if (node.computed && /^(Identifier|MemberExpression|TSAsExpression|TSNonNullExpression)$/.test(node.property.type)) return placeholderName(node.property);
    return placeholderName(node.object);
  }
  if (node.type === 'LogicalExpression') return placeholderName(node.left);
  if (node.type === 'TSNonNullExpression' || node.type === 'TSAsExpression') return placeholderName(node.expression);
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    const callee = node.callee;
    if (callee.type === 'Identifier' && /^(t|tn)$/.test(callee.name)) return 'text';
    if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'Math' && node.arguments[0]) return placeholderName(node.arguments[0]);
    if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
      if (/^(toFixed|toString|toLowerCase|toUpperCase|toLocaleString|toLocaleLowerCase|trim|join|padStart|padEnd|slice|repeat|at)$/.test(callee.property.name)) return placeholderName(callee.object);
      return callee.property.name;
    }
    if (callee.type === 'Identifier' && /^(String|Number|Math)$/.test(callee.name) && node.arguments[0]) return placeholderName(node.arguments[0]);
    if (callee.type === 'Identifier') return callee.name;
  }
  return 'value';
}

function joinParts(parts) {
  const used = new Map();
  let key = '';
  for (const part of parts) {
    if (typeof part === 'string') {
      key += part.replace(/\{/g, '{{').replace(/\}/g, '}}');
      continue;
    }
    let name = part.name;
    const seen = used.get(name);
    if (seen !== undefined && seen !== part.source) {
      let index = 2;
      while (used.has(`${name}${index}`) && used.get(`${name}${index}`) !== part.source) index++;
      name = `${name}${index}`;
    }
    used.set(name, part.source);
    key += `{${name}}`;
  }
  return key;
}

function parseScript(code, offset, plugins = ['typescript']) {
  try {
    return { ast: babel.parse(code, { sourceType: 'module', plugins, errorRecovery: true }), offset };
  } catch {
    return null;
  }
}

function parseExpression(code) {
  try {
    return babel.parseExpression(code, { plugins: ['typescript'] });
  } catch {
    return null;
  }
}

function visit(node, parent, fn) {
  if (!node || typeof node.type !== 'string') return;
  if (fn(node, parent) === false) return;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key.endsWith('Comments')) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === 'string') visit(child, node, fn);
    } else if (value && typeof value.type === 'string') {
      visit(value, node, fn);
    }
  }
}

function isConsoleCall(node) {
  const callee = node?.callee;
  return callee?.type === 'MemberExpression' && callee.object?.type === 'Identifier' && callee.object.name === 'console';
}

function isDataUse(node, parent) {
  if (!parent) return false;
  if (parent.type === 'ImportDeclaration' || parent.type === 'ExportAllDeclaration' || parent.type === 'ExportNamedDeclaration' || parent.type === 'ImportExpression') return true;
  if ((parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod' || parent.type === 'ClassProperty' || parent.type === 'TSPropertySignature') && parent.key === node && !parent.computed) return true;
  if (parent.type === 'ObjectProperty' && parent.value === node && !parent.computed && parent.key.type === 'Identifier' && PARSER_SAMPLES.has(parent.key.name)) return true;
  if (parent.type === 'TSLiteralType' || parent.type === 'TSEnumMember') return true;
  if (parent.type === 'BinaryExpression' && ['===', '!==', '==', '!=', 'in'].includes(parent.operator)) return true;
  if (parent.type === 'SwitchCase' && parent.test === node) return true;
  if ((parent.type === 'CallExpression' || parent.type === 'OptionalCallExpression' || parent.type === 'NewExpression')) {
    if (isConsoleCall(parent)) return true;
    const callee = parent.callee;
    if (callee.type === 'Identifier' && callee.name === 'RegExp') return true;
    const method = (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && !callee.computed && callee.property.type === 'Identifier' ? callee.property.name : null;
    if (method && MATCHING.has(method) && parent.arguments[0] === node) return true;
    if ((method === 'replace' || method === 'replaceAll') && node.type === 'StringLiteral' && node.value.length <= 2) return true;
  }
  if (parent.type === 'MemberExpression' && parent.computed && parent.property === node) return true;
  return false;
}

function stringsOfAst(ast, offset, add) {
  const consumed = new Set();
  visit(ast, null, (node, parent) => {
    if (consumed.has(node)) return false;
    if (node.type === 'CallExpression' && isConsoleCall(node)) return false;
    if (node.type === 'TSTypeAnnotation' || node.type === 'TSTypeAliasDeclaration' || node.type === 'TSInterfaceDeclaration') return false;
    if (node.type === 'BinaryExpression' && node.operator === '+' && !(parent?.type === 'BinaryExpression' && parent.operator === '+')) {
      const operands = [];
      const flatten = item => (item.type === 'BinaryExpression' && item.operator === '+' ? (flatten(item.left), flatten(item.right)) : operands.push(item));
      flatten(node);
      const hasText = operands.some(item => item.type === 'StringLiteral' && CYRILLIC.test(item.value));
      if (hasText && operands.some(item => item.type === 'StringLiteral') && !isDataUse(node, parent)) {
        const parts = [];
        for (const item of operands) {
          if (item.type === 'StringLiteral') parts.push(item.value);
          else if (item.type === 'TemplateLiteral') item.quasis.forEach((quasi, index) => { parts.push(quasi.value.cooked ?? quasi.value.raw); if (item.expressions[index]) parts.push({ name: placeholderName(item.expressions[index]), source: srcOf(item.expressions[index]) }); });
          else parts.push({ name: placeholderName(item), source: srcOf(item) });
        }
        add(joinParts(parts), offset + node.start);
        for (const item of operands) {
          if (item.type !== 'StringLiteral' && item.type !== 'TemplateLiteral') stringsOfAst(item, offset, add);
          else if (item.type === 'TemplateLiteral') for (const expression of item.expressions) stringsOfAst(expression, offset, add);
        }
        return false;
      }
    }
    if (node.type === 'StringLiteral' && CYRILLIC.test(node.value) && !isDataUse(node, parent)) add(node.value, offset + node.start);
    if (node.type === 'TemplateLiteral' && node.quasis.some(quasi => CYRILLIC.test(quasi.value.cooked ?? quasi.value.raw)) && !isDataUse(node, parent) && parent?.type !== 'TaggedTemplateExpression') {
      const parts = [];
      node.quasis.forEach((quasi, index) => {
        parts.push(quasi.value.cooked ?? quasi.value.raw);
        if (node.expressions[index]) parts.push({ name: placeholderName(node.expressions[index]), source: srcOf(node.expressions[index]) });
      });
      add(joinParts(parts), offset + node.start);
    }
    return true;
  });
}

let currentSource = '';
function srcOf(node) {
  return node && node.start !== undefined ? currentSource.slice(node.start, node.end) : '';
}

function stringsOfCode(code, offset, add, plugins) {
  const parsed = parseScript(code, offset, plugins);
  if (!parsed) return;
  const previous = currentSource;
  currentSource = code;
  stringsOfAst(parsed.ast.program, offset, add);
  currentSource = previous;
}

function stringsOfExpression(code, offset, add) {
  const expression = parseExpression(code);
  if (!expression) return;
  const previous = currentSource;
  currentSource = code;
  stringsOfAst(expression, offset, add);
  currentSource = previous;
}

function stringsOfTemplate(root, add) {
  const visitElement = node => {
    for (const prop of node.props ?? []) {
      if (prop.type === 6 && prop.value && CYRILLIC.test(prop.value.content) && !SKIP_ATTRIBUTES.has(prop.name) && !prop.name.startsWith('data-')) {
        add(condense(prop.value.content), prop.value.loc.start.offset);
      }
      if (prop.type === 7 && prop.exp && prop.name !== 'for' && prop.name !== 'slot') {
        const code = prop.exp.content ?? prop.exp.loc?.source;
        if (code && CYRILLIC.test(code)) stringsOfExpression(code, prop.exp.loc.start.offset, add);
      }
      if (prop.type === 7 && prop.name === 'for' && prop.exp) {
        const code = prop.exp.loc?.source ?? '';
        const source = code.split(/\s+(?:in|of)\s+/).slice(1).join(' in ');
        if (CYRILLIC.test(source)) stringsOfExpression(source, prop.exp.loc.start.offset, add);
      }
    }
    let run = [];
    const flush = () => {
      if (run.some(part => part.type === 2 && CYRILLIC.test(part.content))) {
        const parts = [];
        for (const part of run) {
          if (part.type === 2) parts.push(part.content.replace(/\s+/g, ' '));
          else {
            const code = part.content.content ?? part.content.loc?.source ?? '';
            parts.push({ name: placeholderName(parseExpression(code)), source: code.trim() });
          }
        }
        const first = parts.findIndex(part => typeof part !== 'string' || part.trim());
        if (first >= 0) {
          if (typeof parts[0] === 'string') parts[0] = parts[0].trimStart();
          const last = parts.length - 1;
          if (typeof parts[last] === 'string') parts[last] = parts[last].trimEnd();
          const key = joinParts(parts.filter(part => part !== ''));
          if (key) add(key, run[0].loc.start.offset);
        }
      }
      for (const part of run) {
        if (part.type === 5) {
          const code = part.content.content ?? part.content.loc?.source ?? '';
          if (CYRILLIC.test(code)) stringsOfExpression(code, part.content.loc.start.offset, add);
        }
      }
      run = [];
    };
    for (const child of node.children ?? []) {
      if (child.type === 2 || child.type === 5) run.push(child);
      else {
        flush();
        if (child.type === 1) visitElement(child);
      }
    }
    flush();
  };
  visitElement(root);
}

function libraryLabels(text, add) {
  const data = JSON.parse(text);
  const groups = Array.isArray(data) ? data : data.groups ?? [];
  for (const group of groups) {
    if (group.label) add(group.label, 0);
    if (group.section) add(group.section, 0);
    for (const item of group.items ?? []) if (item.label) add(item.label, 0);
  }
}

export function collectStrings(root = CLIENT) {
  loadParsers();
  const strings = new Map();
  for (const file of walk(root)) {
    const path = (file.startsWith(CLIENT) ? relative(CLIENT, file) : relative(ROOT, file)).replace(/\\/g, '/');
    const text = readFileSync(file, 'utf8');
    if (!CYRILLIC.test(text)) continue;
    const add = (raw, at) => {
      const key = raw.replace(/\r\n/g, '\n');
      if (!key.trim() || !CYRILLIC.test(key)) return;
      if (/^\s*(SELECT|UPDATE|INSERT|DELETE|WITH)\b/.test(key)) return;
      let entry = strings.get(key);
      if (!entry) strings.set(key, (entry = { files: [], first: { file: path, at }, plural: false }));
      if (!entry.files.includes(path)) entry.files.push(path);
    };
    if (file.endsWith('.json')) {
      libraryLabels(text, add);
      continue;
    }
    if (file.endsWith('.vue')) {
      const { descriptor } = parseSfc(text, { filename: file, ignoreEmpty: true });
      for (const block of [descriptor.script, descriptor.scriptSetup]) {
        if (block) stringsOfCode(block.content, block.loc.start.offset, add, block.lang === 'ts' || block.lang === 'tsx' ? ['typescript'] : []);
      }
      if (descriptor.template?.ast) stringsOfTemplate(descriptor.template.ast, add);
    } else {
      stringsOfCode(text, 0, add, ['typescript']);
    }
    for (const match of text.matchAll(PLURAL_CALL)) {
      const key = match[2].replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
      const entry = strings.get(key);
      if (entry) entry.plural = true;
      else strings.set(key, { files: [path], first: { file: path, at: match.index }, plural: true });
    }
  }
  return strings;
}

export const SHARED_GROUP = 'Общие — встречаются в нескольких файлах';
export const GONE_GROUP = 'Больше нет в коде — перевод сохранён, чтобы не пропал';
export const ENGLISH_META = { code: 'en', name: 'English', base: null };
export const ABOUT = [
  'Встроенный английский «Очага» (docs/I18N.md). Слева — русский текст по умолчанию: это ключ, его не меняйте. Справа — перевод.',
  'Пустая строка "" — ещё не переведено: в интерфейсе останется русский текст.',
  '{имя} — подстановка (число, имя, название): перенесите её в перевод как есть, порядок слов — любой. {{ и }} — просто фигурные скобки.',
  'Разделы — файлы, где встречается строка («Общие» — в нескольких местах). На перевод не влияют: одинаковый текст переводится один раз.',
  'Перевод виден там, где интерфейс уже подключён к переводу (t() в коде); остальные строки заработают, когда их компонент переведут на t(), — ключ останется тем же.',
  'Посмотреть сразу: npm run dev — обновляется на лету; или скопируйте файл в папку языков («Настройки интерфейса» → «Язык» → «Папка языков») и нажмите «Обновить список».',
  'Новые строки добавляет npm run i18n:extract (пустыми); уже переведённое он не трогает.',
];

const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const isPluralForms = (key, value) => isObject(value) && (key.includes('|') || Object.keys(value).every(form => PLURAL_FORMS.includes(form)));

export function flattenLocaleFile(file) {
  const entries = new Map();
  if (!isObject(file)) return entries;
  for (const [key, value] of Object.entries(file)) {
    if (key.startsWith('$')) continue;
    if (isObject(value) && !isPluralForms(key, value)) {
      for (const [inner, text] of Object.entries(value)) if (!entries.has(inner)) entries.set(inner, text);
    } else if (!entries.has(key)) {
      entries.set(key, value);
    }
  }
  return entries;
}

export const isTranslated = value => (typeof value === 'string' ? value !== '' : isObject(value) && Object.values(value).some(text => typeof text === 'string' && text !== ''));

export function mergeEnglishFile(previous, strings) {
  const old = flattenLocaleFile(previous);
  const groups = new Map();
  const ordered = [...strings].sort(([, a], [, b]) => a.first.file.localeCompare(b.first.file) || a.first.at - b.first.at);
  for (const [key, entry] of ordered) {
    const group = entry.files.length > 1 ? SHARED_GROUP : entry.first.file;
    if (!groups.has(group)) groups.set(group, {});
    groups.get(group)[key] = old.has(key) ? old.get(key) : entry.plural ? { one: '', other: '' } : '';
  }
  const gone = {};
  for (const [key, value] of old) if (!strings.has(key) && isTranslated(value)) gone[key] = value;
  const file = { $meta: isObject(previous?.$meta) ? previous.$meta : ENGLISH_META, $about: ABOUT };
  if (groups.has(SHARED_GROUP)) file[SHARED_GROUP] = groups.get(SHARED_GROUP);
  for (const name of [...groups.keys()].filter(name => name !== SHARED_GROUP).sort((a, b) => a.localeCompare(b))) file[name] = groups.get(name);
  if (Object.keys(gone).length) file[GONE_GROUP] = gone;
  return file;
}

export function englishStats(file) {
  const entries = flattenLocaleFile(file);
  let done = 0;
  for (const value of entries.values()) if (isTranslated(value)) done++;
  return { total: entries.size, done };
}
