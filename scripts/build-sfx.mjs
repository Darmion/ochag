// Copies the TomMusic SFX pack into apps/client/public/sfx; --ambience also re-encodes the ambience loops via encode-ambience.cjs.
//   node scripts/build-sfx.mjs [--ambience]

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACK = join(ROOT, 'assets', 'Free Fantasy SFX Pack By TomMusic', 'OGG Files');
const OUT = join(ROOT, 'apps', 'client', 'public', 'sfx');

const range = (n, make) => Array.from({ length: n }, (_, index) => make(index + 1));
const SWORD = 'SFX/Attacks/Sword Attacks Hits and Blocks';
const BOW = 'SFX/Attacks/Bow Attacks Hits and Blocks';
const SPELLS = 'SFX/Spells';
const DOORS = 'SFX/Doors Gates and Chests';

export const SHORT = [
  ...range(3, n => [`attack/sword-swing-${n}.ogg`, `${SWORD}/Sword Attack ${n}.ogg`]),
  ...range(3, n => [`attack/sword-hit-${n}.ogg`, `${SWORD}/Sword Impact Hit ${n}.ogg`]),
  ...range(3, n => [`attack/sword-blocked-${n}.ogg`, `${SWORD}/Sword Blocked ${n}.ogg`]),
  ...range(3, n => [`attack/sword-parry-${n}.ogg`, `${SWORD}/Sword Parry ${n}.ogg`]),
  ...range(2, n => [`attack/sword-unsheath-${n}.ogg`, `${SWORD}/Sword Unsheath ${n}.ogg`]),
  ...range(2, n => [`attack/sword-sheath-${n}.ogg`, `${SWORD}/Sword Sheath ${n}.ogg`]),
  ...range(2, n => [`attack/bow-shot-${n}.ogg`, `${BOW}/Bow Attack ${n}.ogg`]),
  ...range(3, n => [`attack/bow-hit-${n}.ogg`, `${BOW}/Bow Impact Hit ${n}.ogg`]),
  ...range(3, n => [`attack/bow-blocked-${n}.ogg`, `${BOW}/Bow Blocked ${n}.ogg`]),
  ...range(3, n => [`spell/fireball-${n}.ogg`, `${SPELLS}/Fireball ${n}.ogg`]),
  ...range(2, n => [`spell/fire-buff-${n}.ogg`, `${SPELLS}/Firebuff ${n}.ogg`]),
  ...range(2, n => [`spell/fire-spray-${n}.ogg`, `${SPELLS}/Firespray ${n}.ogg`]),
  ...range(2, n => [`spell/ice-barrage-${n}.ogg`, `${SPELLS}/Ice Barrage ${n}.ogg`]),
  ...range(2, n => [`spell/ice-freeze-${n}.ogg`, `${SPELLS}/Ice Freeze ${n}.ogg`]),
  ...range(2, n => [`spell/ice-throw-${n}.ogg`, `${SPELLS}/Ice Throw ${n}.ogg`]),
  ...range(2, n => [`spell/ice-wall-${n}.ogg`, `${SPELLS}/Ice Wall ${n}.ogg`]),
  ...range(2, n => [`spell/rock-swarm-${n}.ogg`, `${SPELLS}/Rock Meteor Swarm ${n}.ogg`]),
  ...range(2, n => [`spell/rock-throw-${n}.ogg`, `${SPELLS}/Rock Meteor Throw ${n}.ogg`]),
  ...range(2, n => [`spell/rock-wall-${n}.ogg`, `${SPELLS}/Rock Wall ${n}.ogg`]),
  ...range(3, n => [`spell/impact-${n}.ogg`, `${SPELLS}/Spell Impact ${n}.ogg`]),
  ...range(2, n => [`spell/water-spray-${n}.ogg`, `${SPELLS}/Waterspray ${n}.ogg`]),
  ...range(2, n => [`spell/wave-${n}.ogg`, `${SPELLS}/Wave Attack ${n}.ogg`]),
  ...range(2, n => [`object/chest-open-${n}.ogg`, `${DOORS}/Chest Open ${n}.ogg`]),
  ...range(2, n => [`object/chest-close-${n}.ogg`, `${DOORS}/Chest Close ${n}.ogg`]),
  ...range(2, n => [`object/door-open-${n}.ogg`, `${DOORS}/Door Open ${n}.ogg`]),
  ...range(2, n => [`object/door-close-${n}.ogg`, `${DOORS}/Door Close ${n}.ogg`]),
  ['object/gate-open-1.ogg', `${DOORS}/Gate Open.ogg`],
  ['object/gate-close-1.ogg', `${DOORS}/Gate Close.ogg`],
  ['object/portcullis-1.ogg', `${DOORS}/Portcullis Gate.ogg`],
  ['object/unlock-1.ogg', `${DOORS}/Lock Unlock.ogg`],
  ...range(4, n => [`object/chop-${n}.ogg`, `SFX/Chopping and Mining/chop ${n}.ogg`]),
  ...range(5, n => [`object/mine-${n}.ogg`, `SFX/Chopping and Mining/mine ${n}.ogg`]),
  ...range(2, n => [`object/torch-light-${n}.ogg`, `SFX/Torch/Light Torch ${n}.ogg`]),
  ...['Dirt', 'Stone', 'Water', 'Wood'].flatMap(surface => [
    ...range(5, n => [`steps/${surface.toLowerCase()}-walk-${n}.ogg`, `SFX/Footsteps/${surface}/${surface} Walk ${n}.ogg`]),
    ...range(5, n => [`steps/${surface.toLowerCase()}-chain-walk-${n}.ogg`, `SFX/Footsteps/${surface}/${surface} Chain Walk ${n}.ogg`]),
  ]),
];

export const AMBIENCE = [
  ...['Beach', 'Cave', 'Sea'].flatMap(place => [
    [`ambience/${place.toLowerCase()}.webm`, `BGS Loops/${place}/${place}.ogg`],
    [`ambience/${place.toLowerCase()}-rain.webm`, `BGS Loops/${place}/${place} Rain.ogg`],
    [`ambience/${place.toLowerCase()}-storm.webm`, `BGS Loops/${place}/${place} Storm.ogg`],
  ]),
  ...[['Forest Day', 'Forest Day', 'forest-day'], ['Forest Night', 'Forest Night', 'forest-night'], ['Interior Day', 'Inside Day', 'inside-day'], ['Interior Night', 'Inside Night', 'inside-night']].flatMap(([folder, name, id]) => [
    [`ambience/${id}.webm`, `BGS Loops/${folder}/${name}.ogg`],
    [`ambience/${id}-rain.webm`, `BGS Loops/${folder}/${name} Rain.ogg`],
    [`ambience/${id}-storm.webm`, `BGS Loops/${folder}/${name} Storm.ogg`],
  ]),
  ['ambience/river.webm', 'SFX/Waterfalls Rivers and Streams/River Loop.ogg'],
  ['ambience/stream.webm', 'SFX/Waterfalls Rivers and Streams/River Stream Loop.ogg'],
  ['ambience/waterfall.webm', 'SFX/Waterfalls Rivers and Streams/Waterfall Loop.ogg'],
];

if (import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href || process.argv[1]?.endsWith('build-sfx.mjs')) {
  if (!existsSync(PACK)) {
    console.error(`Нет набора звуков: ${PACK}`);
    process.exit(1);
  }
  let copied = 0;
  for (const [to, from] of SHORT) {
    const target = join(OUT, to);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(PACK, from), target);
    copied++;
  }
  console.log(`Короткие звуки: ${copied}.`);

  if (process.argv.includes('--ambience')) {
    const jobs = AMBIENCE.map(([to, from]) => ({ from: join(PACK, from), to: join(OUT, to), bitrate: 64000 }));
    for (const job of jobs) mkdirSync(dirname(job.to), { recursive: true });
    const jobsFile = join(tmpdir(), `ochag-ambience-${process.pid}.json`);
    writeFileSync(jobsFile, JSON.stringify(jobs));
    const require = createRequire(join(ROOT, 'package.json'));
    const electron = require('electron');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(electron, [join(ROOT, 'scripts', 'encode-ambience.cjs'), jobsFile], { stdio: 'inherit', env });
    process.exit(result.status ?? 1);
  }
}
