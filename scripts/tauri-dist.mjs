// The Windows installer on Tauri: the client build, the stage folder (scripts/tauri-stage.mjs), then `tauri build` with the
// release config that ships the stage as resources. The installer is copied to release/Ochag-Setup-<version>.exe: a Latin
// name for GitHub, and the updater looks for «setup» and «.exe» in it.
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const npm = process.env.npm_execpath ?? join(root, 'node_modules/npm/bin/npm-cli.js');

function run(args, cwd = root) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run([npm, 'run', 'desktop:build']);
run([join(root, 'scripts/tauri-stage.mjs')]);
run([join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--config', 'src-tauri/tauri.release.conf.json'], join(root, 'apps/desktop'));

const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const bundle = join(root, 'apps/desktop/src-tauri/target/release/bundle/nsis');
const built = (await readdir(bundle)).find(name => name.endsWith('-setup.exe') && name.includes(`_${version}_`));
if (!built) throw new Error(`No installer for ${version} in ${bundle}.`);
await mkdir(join(root, 'release'), { recursive: true });
await copyFile(join(bundle, built), join(root, 'release', `Ochag-Setup-${version}.exe`));
console.log(`Installer: release/Ochag-Setup-${version}.exe`);
