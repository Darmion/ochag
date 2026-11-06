import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stepPose, type Pose} from './tug.ts';

const start: Pose = {x: 0, y: 0, z: 0, rotationY: 0, scale: 1};

function run(pose: Pose, pulls: Parameters<typeof stepPose>[1], steps: number, maxStep = 10): Pose {
  let current = pose;
  for (let i = 0; i < steps; i++) current = stepPose(current, pulls, maxStep);
  return current;
}

test('a single puller is followed closely', () => {
  const pose = run(start, [{target: {x: 4, y: 0, z: 0}}], 6);
  assert.ok(Math.abs(pose.x - 4) < 0.01);
});

test('equal opposite pulls cancel out', () => {
  const pose = run(start, [{target: {x: 5, y: 0, z: 0}}, {target: {x: -5, y: 0, z: 0}}], 20);
  assert.ok(Math.abs(pose.x) < 1e-9);
});

test('whoever pulls farther wins ground; equilibrium is the mean of targets', () => {
  const pulls = [{target: {x: 6, y: 0, z: 0}}, {target: {x: -2, y: 0, z: 0}}];
  const first = stepPose(start, pulls, 10);
  assert.ok(first.x > 0, 'moves toward the stronger pull');
  const settled = run(start, pulls, 60);
  assert.ok(Math.abs(settled.x - 2) < 1e-6);
});

test('pulling together moves faster than alone, and speed is capped', () => {
  const alone = stepPose(start, [{target: {x: 10, y: 0, z: 0}}], 100);
  const together = stepPose(start, [{target: {x: 10, y: 0, z: 0}}, {target: {x: 10, y: 0, z: 0}}, {target: {x: 10, y: 0, z: 0}}], 100);
  assert.ok(together.x >= alone.x - 1e-9);
  const capped = stepPose(start, [{target: {x: 100, y: 0, z: 0}}], 0.75);
  assert.ok(Math.abs(capped.x - 0.75) < 1e-9);
});

test('rotation is a circular mean and scale an average of what holders set', () => {
  const pose = stepPose(start, [
    {target: {x: 0, y: 0, z: 0}, rotationY: 350, scale: 1},
    {target: {x: 0, y: 0, z: 0}, rotationY: 10, scale: 2},
    {target: {x: 0, y: 0, z: 0}},
  ], 1);
  assert.ok(pose.rotationY < 0.001 || pose.rotationY > 359.999);
  assert.equal(pose.scale, 1.5);
});
