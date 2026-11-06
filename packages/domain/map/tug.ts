export type Vec3 = { x: number; y: number; z: number };

export type Pull = {
  target: Vec3;
  rotationY?: number;
  scale?: number;
};

export type Pose = Vec3 & { rotationY: number; scale: number };

// Several pullers get a smaller gain each so the sum stays below 1 and the object does not overshoot and jitter.
function gainFor(pullers: number): number {
  return pullers <= 1 ? 0.8 : Math.min(0.5, 0.9 / pullers);
}

function circularMeanDegrees(values: number[]): number {
  let sin = 0;
  let cos = 0;

  for (const value of values) {
    const radians = (value * Math.PI) / 180;
    sin += Math.sin(radians);
    cos += Math.cos(radians);
  }

  const degrees = (Math.atan2(sin, cos) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

export function stepPose(pose: Pose, pulls: Pull[], maxStep: number): Pose {
  if (pulls.length === 0) return pose;

  const gain = gainFor(pulls.length);
  let dx = 0;
  let dy = 0;
  let dz = 0;

  for (const pull of pulls) {
    dx += (pull.target.x - pose.x) * gain;
    dy += (pull.target.y - pose.y) * gain;
    dz += (pull.target.z - pose.z) * gain;
  }

  const length = Math.hypot(dx, dy, dz);

  if (length > maxStep) {
    const factor = maxStep / length;
    dx *= factor;
    dy *= factor;
    dz *= factor;
  }

  const rotations = pulls.map(pull => pull.rotationY).filter((value): value is number => value !== undefined);
  const scales = pulls.map(pull => pull.scale).filter((value): value is number => value !== undefined);

  return {
    x: pose.x + dx,
    y: pose.y + dy,
    z: pose.z + dz,
    rotationY: rotations.length ? circularMeanDegrees(rotations) : pose.rotationY,
    scale: scales.length ? scales.reduce((sum, value) => sum + value, 0) / scales.length : pose.scale,
  };
}

export function samePose(a: Pose, b: Pose, epsilon = 1e-3): boolean {
  return Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.z - b.z) < epsilon &&
    Math.abs(a.rotationY - b.rotationY) < epsilon &&
    Math.abs(a.scale - b.scale) < epsilon;
}
