import test from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES, SPECIES_KEYS, REACTIONS } from '../js/bestiary.js';
import { WildlifeDirector, sampleWildlife } from '../js/wildlife.js';
import { drawCreature } from '../js/actors.js';
import { riverAt, pathAt } from '../js/world.js';

const seed = 42;
const pool = { kind: 'swamp', s: 30, x: 12, rx: 4, rs: 2.8, level: .5, center: 30, width: 5.6 };
function inhabitant(kind, id = kind) {
  const e = { id, kind: 'animal', variant: kind, s: 5, side: 3.5, seed: 271, scale: SPECIES[kind].scale };
  if (SPECIES[kind].habitat === 'water') Object.assign(e, { s: pool.s, side: pool.x - pathAt(pool.s, seed), water: pool });
  if (SPECIES[kind].habitat === 'bank') Object.assign(e, { s: pool.s, side: pool.x + pool.rx + 1 - pathAt(pool.s, seed), water: pool });
  return e;
}

test('every inhabitant has a distinct sequence of touch responses and ignores accidental double taps', () => {
  assert.ok(SPECIES_KEYS.length >= 24);
  for (const kind of SPECIES_KEYS) {
    const director = new WildlifeDirector(seed), e = inhabitant(kind), actions = new Set();
    for (let n = 0; n < REACTIONS[kind].length; n++) {
      const t = n * 20;
      const response = director.interact(e, t, { x: 0, y: -5 });
      assert.equal(response.species, kind);
      assert.ok(response.message.length > 15);
      actions.add(response.action);
      assert.equal(director.interact(e, t + .1, { x: 0, y: -5 }), null);
    }
    assert.ok(actions.size >= 4, `${kind} needs several different behaviours`);
  }
});

test('touches, mid-reaction touches, and the return to wandering never teleport an animal', () => {
  for (const kind of SPECIES_KEYS) {
    const director = new WildlifeDirector(seed), e = inhabitant(kind);
    let before = director.sample(e, 0);
    for (let tick = 0; tick < 1000; tick++) {
      const t = tick / 50;
      if ([0, 100, 450].includes(tick)) {
        const old = director.sample(e, t);
        director.interact(e, t, { x: old.x - 2.5, y: old.y + 2.5 });
        const atTouch = director.sample(e, t);
        assert.ok(Math.hypot(old.x - atTouch.x, old.y - atTouch.y, old.hop - atTouch.hop) < 1e-8, `${kind} jumped at the touch`);
      }
      const pose = director.sample(e, t);
      for (const [key, value] of Object.entries(pose)) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${kind}.${key}`);
      assert.ok(Math.hypot(pose.x - before.x, pose.y - before.y) < .23, `${kind} travelled discontinuously at ${t}`);
      assert.ok(Math.abs(pose.hop - before.hop) < .27, `${kind} jumped vertically at ${t}`);
      before = pose;
    }
  }
});

test('swimming wildlife remains in water and on its own side of the stream bridge during reactions', () => {
  let stream;
  for (let s = 35; s < 65; s++) stream ||= riverAt(s, seed);
  assert.ok(stream);
  for (const kind of ['duck', 'otter', 'fish']) for (const sign of [-1, 1]) {
    const e = { ...inhabitant(kind), s: stream.center, side: sign * 3.2, water: stream };
    const director = new WildlifeDirector(seed);
    for (let tick = 0; tick < 1200; tick++) {
      const t = tick / 30;
      if (tick % 120 === 0) director.interact(e, t, { x: pathAt(stream.center, seed), y: -stream.center });
      const p = director.sample(e, t);
      assert.ok(Math.abs(p.s - stream.center) <= stream.width * .4 + 1e-8);
      assert.ok((p.x - pathAt(p.s, seed)) * sign >= 2 - 1e-8, `${kind} entered the bridge`);
      assert.equal(p.waterLevel, stream.level);
    }
  }
});

test('pool swimmers remain inside the oval and basking animals remain on its bank', () => {
  for (const kind of ['duck', 'otter', 'fish', 'crocodile', 'frog', 'heron']) {
    const e = inhabitant(kind), director = new WildlifeDirector(seed);
    for (let tick = 0; tick < 1200; tick++) {
      const t = tick / 30;
      if (tick % 150 === 0) director.interact(e, t, { x: pool.x, y: -pool.s });
      const p = director.sample(e, t);
      const radius = Math.hypot((p.x - pool.x) / pool.rx, (p.s - pool.s) / pool.rs);
      assert.ok(kind === 'crocodile' ? p.swimming ? radius < 1 : Number.isFinite(radius)
        : SPECIES[kind].habitat === 'water' ? radius <= .86 + 1e-8 : radius >= 1.04 - 1e-8,
      `${kind} left its habitat: ${radius}`);
    }
  }
});

test('flying insects and eagles retain their altitude during every touch response', () => {
  for (const kind of ['eagle', 'butterfly', 'dragonfly']) {
    const e = inhabitant(kind), director = new WildlifeDirector(seed);
    for (let action = 0; action < REACTIONS[kind].length; action++) {
      const start = action * 20;
      director.interact(e, start, { x: 0, y: -5 });
      for (let age = 0; age < 12; age += .1) {
        const motion = director.sample(e, start + age);
        assert.ok(motion.hop >= (kind === 'eagle' ? 1.9 : kind === 'butterfly' ? .59 : .29), `${kind} landed during ${action}`);
      }
    }
  }
});

test('crocodiles spend long natural pauses basking between their slow movements', () => {
  const e = inhabitant('crocodile');
  let basking = 0, moving = 0;
  for (let time = 0; time < 60; time += .1) {
    const motion = sampleWildlife(e, time, seed);
    if (motion.activity === 'bask' && motion.speed === 0) basking++;
    if (motion.speed > .01) moving++;
  }
  assert.ok(basking > 220 && moving > 150);
});

test('crocodiles alternate between a rooted bank and actual pond water without teleporting', () => {
  const e = { ...inhabitant('crocodile'), water: pool, side: pool.x + pool.rx + .9, s: pool.s, seed: 524 };
  const director = new WildlifeDirector(seed);
  const activities = new Set(); let last = null;
  for (let time = 0; time < 100; time += .05) {
    const motion = director.sample(e, time);
    activities.add(motion.activity);
    if (last) assert.ok(Math.hypot(motion.x-last.x, motion.s-last.s) < .35, 'crocodile position jumped');
    if (motion.swimming) {
      const q = Math.hypot((motion.x-pool.x)/pool.rx, (motion.s-pool.s)/pool.rs);
      assert.ok(q < 1, `swimmer outside pond ${q}`);
    }
    last = motion;
  }
  assert.ok(activities.has('bask') && activities.has('float') && activities.has('slide'));
  const choices = new Set();
  for (let i = 0; i < 12; i++) {
    const time = 150+i*11;
    const response = director.interact(e, time, {x:0,y:-4}); choices.add(response.action);
    for (let elapsed = time; elapsed < time+8; elapsed += .1) {
      const motion = director.sample(e, elapsed);
      assert.ok(Number.isFinite(motion.x) && Number.isFinite(motion.s));
    }
  }
  assert.ok(choices.has('gape') && choices.has('rush') && choices.has('splash'));
});

test('touching a horse creates a shared herd response and streamed-out encounters release their state', () => {
  const director = new WildlifeDirector(seed);
  const herd = Array.from({ length: 4 }, (_, n) => ({ ...inhabitant('horse', `horse-${n}`), group: 'herd-1', side: 3 + n, seed: 4 + n }));
  for (const e of herd) director.sample(e, 0);
  director.interact(herd[0], 0, { x: 0, y: 0 });
  assert.equal(director.reactions.size, 4);
  for (let n = 0; n < 500; n++) director.interact(inhabitant('fox', `fox-${n}`), n * 2, { x: 0, y: 0 });
  assert.ok(director.known.size <= director.limit);
  assert.ok(director.reactions.size <= director.limit);
  assert.ok(director.counts.size <= director.limit);
  director.prune([]);
  assert.equal(director.known.size + director.reactions.size + director.counts.size, 0);
});

test('all species and response poses produce finite geometry, including uneven ground', () => {
  let primitives = 0;
  const check = (...args) => {
    for (const value of args.flat(Infinity)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
    primitives++;
  };
  const r = { sphere: check, ellipsoid: check, capsule: check, shadow: check, plot: check };
  for (const kind of SPECIES_KEYS) {
    const director = new WildlifeDirector(seed), e = inhabitant(kind);
    drawCreature(r, { kind });
    for (let tick = 0; tick < 300; tick++) {
      const t = tick / 15;
      if (tick % 40 === 0) director.interact(e, t, { x: 0, y: 0 });
      const motion = director.sample(e, t);
      drawCreature(r, { kind, scale: e.scale, x: motion.x, y: motion.y, z: .3, time: t, seed: e.seed, motion,
        groundAt: (x, y) => .3 + Math.sin(x * .3 + y * .2) * .2 });
    }
  }
  assert.ok(primitives > 150000);
  assert.ok(Array.from({ length: 200 }, (_, n) => sampleWildlife(inhabitant('fish'), n / 10, seed)).some(p => p.hop > .7), 'trout should also leap without a touch');
});
