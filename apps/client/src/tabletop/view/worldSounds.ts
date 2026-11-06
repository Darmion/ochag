import type { Ref } from 'vue';
import type { WallStyle, WallSegment } from '../scene';
import { glideMs } from '../grid';
import { sceneSurface } from '../ambience';
import { type SfxEvent, playSfx, playSteps } from '../sfx';
import type { SceneObjectDTO, SceneDetail } from './types';

export type WorldSoundsDeps = {
  sceneDetail: Ref<SceneDetail | null>;
};

export function useWorldSounds({ sceneDetail }: WorldSoundsDeps) {
  function openingSound(name: string, open: boolean): SfxEvent {
    if (/ворот|решётк|решетк|gate|portcullis/i.test(name)) return open ? 'gate-open' : 'gate-close';
    if (/двер|door|люк|hatch|калитк/i.test(name)) return open ? 'door-open' : 'door-close';
    return open ? 'chest-open' : 'chest-close';
  }
  const strikeSound = (style: WallStyle | undefined): SfxEvent => (style === 'wood' || style === 'hedge' ? 'strike-wood' : 'strike-stone');

  function playWorldSounds(before: SceneObjectDTO[], after: SceneObjectDTO[], wallsBefore: WallSegment[], wallsAfter: WallSegment[]) {
    if (!before.length) return;
    const old = new Map(before.map(object => [object.id, object]));
    const surface = sceneSurface(sceneDetail.value?.ambience);
    let walkers = 0;
    for (const object of after) {
      const was = old.get(object.id);
      if (!was) continue;
      const state = object.state;
      const prev = was.state;
      if (state && prev) {
        if (state.openable && prev.openable && state.open !== prev.open) playSfx(openingSound(object.name, state.open));
        else if (prev.locked === true && state.locked === false) playSfx('unlock');
        if (state.light?.lit && prev.light && !prev.light.lit) playSfx('torch-light');
      }
      if (object.kind === 'object' && object.hp && was.hp && object.hp.current < was.hp.current) {
        playSfx(/камен|скал|стату|stone|rock|statue/i.test(object.name) ? 'strike-stone' : 'strike-wood');
      }
      if (object.kind !== 'object' && !object.parent_object_id && walkers < 2) {
        const cells = Math.hypot(object.world_x - was.world_x, object.world_z - was.world_z);
        if (cells >= 0.5 && cells <= 30) {
          walkers++;
          playSteps(cells, { surface, durationMs: glideMs(cells) });
        }
      }
    }
    const oldWalls = new Map(wallsBefore.map(wall => [wall.id, wall]));
    for (const wall of wallsAfter) {
      const was = oldWalls.get(wall.id);
      if (!was) continue;
      if (wall.kind === 'door' && Boolean(wall.open) !== Boolean(was.open)) playSfx(wall.open ? 'door-open' : 'door-close');
      else if (was.locked === true && wall.locked === false) playSfx('unlock');
      const hurt = (typeof wall.hp === 'number' && typeof was.hp === 'number' && wall.hp < was.hp)
        || (wall.broken && !was.broken) || (wall.condition !== undefined && wall.condition !== was.condition && Boolean(wall.condition));
      if (hurt) playSfx(strikeSound(wall.style));
    }
  }

  return { playWorldSounds };
}
