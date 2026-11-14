import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleWildlife } from '../js/wildlife.js';
import { drawCreature } from '../js/actors.js';
import { riverAt, createJourney, stepJourney } from '../js/world.js';

const species = ['fox', 'deer', 'stag', 'rabbit', 'bird', 'spirit'];
const entity = (variant, seed = 271) => ({ kind: 'animal', variant, s: 5, side: 2.5, seed, scale: 1 });

test('wildlife keeps moving while the traveller rests, with repeatable bounded patrols', () => {
  for (const kind of species) {
    const e = entity(kind);
    const original = { ...e };
    const state = createJourney(42);
    let previous = sampleWildlife(e, state.elapsed, state.seed);
    const initial = previous;
    let travelled = 0, farthest = 0, stops = 0;
    for (let i = 0; i < 900; i++) {
      stepJourney(state, .1);
      const pose = sampleWildlife(e, state.elapsed, state.seed);
      travelled += Math.hypot(pose.x - previous.x, pose.y - previous.y);
      farthest = Math.max(farthest, Math.hypot(pose.x - initial.x, pose.y - initial.y));
      if (pose.speed < .001) stops++;
      assert.ok(Math.abs(pose.s - e.s) < 3.2);
      assert.ok(Math.abs(pose.side - e.side) < 1.9);
      assert.deepEqual(pose, sampleWildlife(e, state.elapsed, state.seed));
      previous = pose;
    }
    assert.equal(state.distance, 0);
    assert.ok(travelled > 12, `${kind} must actually wander`);
    assert.ok(farthest > 2, `${kind} must visibly leave its starting place`);
    assert.ok(stops > 0, `${kind} must have resting beats`);
    assert.deepEqual(e, original);
  }
});

test('walking, stopping, hopping and patrol wraparounds remain continuous', () => {
  for (const kind of species) for (const seed of [0, 47, 0xffffffff]) {
    const e = entity(kind, seed);
    let previous = sampleWildlife(e, 0, 42);
    for (let i = 1; i <= 6000; i++) {
      const pose = sampleWildlife(e, i / 50, 42);
      for (const [key, value] of Object.entries(pose)) {
        if (typeof value === 'number') assert.ok(Number.isFinite(value), `${kind}.${key}`);
      }
      assert.ok(Math.hypot(pose.x - previous.x, pose.y - previous.y) < .09, `${kind} teleported`);
      assert.ok(Math.abs(pose.hop - previous.hop) < .08, `${kind} jumped vertically`);
      assert.ok(pose.hop >= 0 && pose.speed >= 0 && pose.speed < 4.5);
      previous = pose;
    }
  }
});

test('land animals and landing birds remain on the bank even with a river-channel spawn', () => {
  for (const worldSeed of [1, 42, 561]) {
    let river;
    for (let s = 35; s < 65; s++) river ||= riverAt(s, worldSeed);
    assert.ok(river);
    for (const kind of species.filter(value => value !== 'spirit')) {
      for (const offset of [-5, -1, 0, 1, 5]) {
        const e = { ...entity(kind), s: river.center + offset };
        for (let t = 0; t <= 60; t += .17) {
          const pose = sampleWildlife(e, t, worldSeed);
          assert.ok(Math.abs(pose.s - river.center) >= river.width * .5 + .69);
          assert.equal(Math.sign(pose.s - river.center), offset < 0 ? -1 : 1);
        }
      }
    }
  }
});

test('rabbit travel coincides with its leaps and gait freezes when animals stop', () => {
  let airborne = 0, grounded = 0;
  for (let t = 0; t < 45; t += .02) {
    const pose = sampleWildlife(entity('rabbit'), t, 42);
    if (pose.hop > .01) airborne++;
    if (pose.hop === 0) {
      grounded++;
      assert.equal(pose.speed, 0);
    }
    if (pose.speed === 0) {
      const next = sampleWildlife(entity('rabbit'), t + .00001, 42);
      assert.ok(Math.abs(next.gait - pose.gait) < .000001);
    }
  }
  assert.ok(airborne > 500 && grounded > 500);
});

test('all animated poses and legacy calls produce finite render geometry', () => {
  let count = 0;
  const check = (...args) => {
    for (const value of args.flat(Infinity)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
    count++;
  };
  const r = { sphere: check, ellipsoid: check, capsule: check, shadow: check, plot: check };
  for (const kind of species) {
    drawCreature(r, { kind });
    for (let time = 0; time < 40; time += .11) {
      const e = entity(kind);
      const motion = sampleWildlife(e, time, 42);
      drawCreature(r, { kind, x: motion.x, y: motion.y, z: .2, time, motion, seed: e.seed });
    }
  }
  assert.ok(count > 40000);
});
