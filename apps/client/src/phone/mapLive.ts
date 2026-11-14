export type Placement = { id: string; world_x: number; world_z: number };

// One reload for a burst of messages; a message that comes while a reload runs asks for one more after it.
export function coalesce(run: () => Promise<unknown> | unknown, delayMs = 200, wait: (fn: () => void, ms: number) => unknown = setTimeout) {
  let scheduled = false;
  let running = false;
  let again = false;
  const start = async () => {
    scheduled = false;
    running = true;
    try {
      await run();
    } finally {
      running = false;
      if (again) {
        again = false;
        trigger();
      }
    }
  };
  function trigger() {
    if (running) { again = true; return; }
    if (scheduled) return;
    scheduled = true;
    wait(() => { void start(); }, delayMs);
  }
  return trigger;
}

// A short buzz when the turn becomes one's own; browsers without vibration (iOS Safari) simply have no `vibrate`.
export function buzzOnTurn(wasMine: boolean, isMine: boolean, vibrate: ((pattern: number[]) => unknown) | undefined): boolean {
  if (wasMine || !isMine || !vibrate) return false;
  vibrate([120, 60, 120]);
  return true;
}

export function applyPose(objects: Placement[], pose: { kind?: unknown; id?: unknown; x?: unknown; z?: unknown }): boolean {
  if (pose.kind !== 'object' || typeof pose.x !== 'number' || typeof pose.z !== 'number' || !Number.isFinite(pose.x) || !Number.isFinite(pose.z)) return false;
  const object = objects.find(entry => entry.id === pose.id);
  if (!object || (object.world_x === pose.x && object.world_z === pose.z)) return false;
  object.world_x = pose.x;
  object.world_z = pose.z;
  return true;
}
