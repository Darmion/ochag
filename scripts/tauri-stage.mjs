// Gathers what the Tauri installer ships next to the program: the host and server files, production node_modules and Node
// itself (the server stays on Node, see docs/internal/TAURI.md). Run after `npm run desktop:build`.
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const stage = join(root, 'apps/desktop/src-tauri/target/stage');
const app = join(stage, 'app');

const PARTS = [
  'apps/desktop/bridge.cjs', 'apps/desktop/bridge', 'apps/desktop/host', 'apps/desktop/main',
  'apps/client/dist', 'apps/server', 'packages', 'scripts', 'mods', 'db', 'branding',
  'package.json', 'package-lock.json', 'LICENSE.md', 'NOTICE.md',
];

// Tests, sources of art and anything private stay out of the installer.
function wanted(source) {
  const path = relative(root, source).split(sep).join('/');
  const name = basename(source);
  if (/\.test\.(ts|mjs|cjs|js)$/.test(name)) return false;
  if (/(^|\/)(test|tests|__tests__)(\/|$)/.test(path) && !path.startsWith('apps/client/dist')) return false;
  return !/(^|\/)(node_modules|\.git)(\/|$)/.test(path);
}

// electron-builder's default filter for node_modules, which the Electron builds shipped with: what packages carry but
// never run. It looks at the top of each package only, as its globs did.
const PACKAGE_FILES = new Set(['CHANGELOG.md', 'README.md', 'README', 'readme.md', 'readme']);
const PACKAGE_DIRS = new Set(['test', '__tests__', 'tests', 'powered-test', 'example', 'examples']);

// Files npm has just written can be held for a moment by OneDrive or an antivirus scan (EBUSY).
const remove = path => rm(path, { recursive: true, force: true, maxRetries: 10 });

async function prune(modules) {
  for (const entry of await readdir(modules, { withFileTypes: true })) {
    const path = join(modules, entry.name);
    if (entry.name === '.bin' || (entry.isFile() && entry.name.endsWith('.d.ts'))) {
      await remove(path);
    } else if (entry.isDirectory()) {
      for (const inner of await readdir(path, { withFileTypes: true })) {
        if (inner.isDirectory() ? PACKAGE_DIRS.has(inner.name) : PACKAGE_FILES.has(inner.name)) {
          await remove(join(path, inner.name));
        }
      }
      await pruneNested(path);
    }
  }
}

async function pruneNested(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules') await prune(join(dir, entry.name));
    else await pruneNested(join(dir, entry.name));
  }
}

await remove(stage);
await mkdir(app, { recursive: true });
for (const part of PARTS) {
  const source = join(root, part);
  await stat(source);
  await cp(source, join(app, part), { recursive: true, filter: wanted });
}

const npm = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const install = spawnSync(process.execPath, [npm, 'ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: app, stdio: 'inherit' });
if (install.status !== 0) throw new Error('npm ci --omit=dev failed in the stage folder.');
await prune(join(app, 'node_modules'));

await mkdir(join(stage, 'node'), { recursive: true });
await cp(process.execPath, join(stage, 'node', 'node.exe'));
console.log(`Stage ready: ${relative(root, stage)} (Node ${process.version}).`);
