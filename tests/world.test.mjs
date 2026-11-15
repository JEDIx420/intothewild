import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createJourney, stepJourney, setActivity, environment, pathAt, terrainAt,
  biomeAt, riverAt, waterAt, swampPoolsAt, pathSlopeAt, trailProfileAt, TrailWorld, serializeJourney, restoreJourney,
} from '../js/world.js';
import { REST_TIMING } from '../js/traveller.js';

function advance(state, seconds) {
  const steps = Math.round(seconds * 10);
  for (let index = 0; index < steps; index++) stepJourney(state, .1);
}
function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be close to ${expected}`);
}

test('new journey starts quietly at morning; invalid frame deltas cannot move or age it', () => {
  const state = createJourney(123);
  assert.equal(state.mode, 'paused');
  assert.equal(state.sound, false);
  assert.equal(state.time, 8);
  const original = serializeJourney(state);
  for (const delta of [-1, 0, NaN, Infinity, -Infinity]) stepJourney(state, delta);
  assert.equal(serializeJourney(state), original);
  setActivity(state, 'walking');
  stepJourney(state, 1000);
  close(state.distance, .115);
  close(state.time, 8.008);
});

test('walking moves only forward; pausing and snacking preserve the place while time passes', () => {
  const state = createJourney(5);
  setActivity(state, 'walking');
  advance(state, 20);
  close(state.distance, 23);
  const place = state.distance;
  const time = state.time;
  setActivity(state, 'snack');
  advance(state, 40);
  assert.equal(state.mode, 'snack');
  assert.equal(state.distance, place);
  assert.ok(state.time > time);
  setActivity(state, 'paused');
  advance(state, 4);
  assert.equal(state.distance, place);
  setActivity(state, 'backwards');
  assert.equal(state.mode, 'paused');
  setActivity(state, 'walking');
  advance(state, 1);
  assert.ok(state.distance > place);
});

test('snack and sleep take several seconds to settle in, without moving or accelerating the clock', () => {
  for (const kind of ['snack', 'sleep']) {
    const state = createJourney(5);
    setActivity(state, 'walking');
    advance(state, 3);
    const place = state.distance, time = state.time;
    setActivity(state, kind);
    assert.equal(state.rest.phase, 'enter');
    assert.equal(state.rest.wasWalking, true);
    assert.ok(REST_TIMING[kind].enter >= 3 && REST_TIMING[kind].enter <= 5);
    advance(state, 3);
    assert.equal(state.rest.phase, 'enter');
    const progress = state.rest.time;
    setActivity(state, kind);
    assert.equal(state.rest.time, progress, 'a repeated request must not restart preparation');
    advance(state, REST_TIMING[kind].enter - 3);
    assert.equal(state.rest.phase, 'idle');
    assert.equal(state.distance, place);
    close(state.time, time + REST_TIMING[kind].enter * .08);
  }
});

test('sleep prepares first, reaches the next morning while asleep, then visibly wakes without travelling', () => {
  for (const [start, target] of [[8, 31], [6, 7], [6.8, 31], [7, 31], [23, 31]]) {
    const state = createJourney();
    state.time = start;
    state.distance = 19;
    setActivity(state, 'sleep');
    advance(state, REST_TIMING.sleep.enter);
    close(state.time, start + REST_TIMING.sleep.enter * .08);
    assert.equal(state.rest.phase, 'idle');
    advance(state, 3);
    assert.ok(state.time >= start && state.time < target);
    assert.equal(state.mode, 'sleep');
    advance(state, 4);
    close(state.time, target);
    assert.equal(state.distance, 19);
    assert.equal(state.mode, 'sleep', 'morning starts recovery instead of teleporting upright');
    assert.equal(state.rest.phase, 'exit');
    advance(state, REST_TIMING.sleep.exit);
    assert.equal(state.mode, 'paused');
    assert.equal(state.rest, null);
    assert.equal(state.distance, 19);
    close(state.time, target + REST_TIMING.sleep.exit * .08);
  }
});

test('cancelling sleep during preparation or actual sleep abandons its morning target', () => {
  for (const cancelAt of [2, REST_TIMING.sleep.enter + 2]) {
    const state = createJourney();
    setActivity(state, 'sleep');
    advance(state, cancelAt);
    const cancelTime = state.time;
    setActivity(state, 'snack');
    assert.equal(state.rest.phase, 'exit');
    assert.equal(state.rest.nextMode, 'snack');
    const recoveryAndSnack = REST_TIMING.sleep.exit + REST_TIMING.snack.enter + 10;
    advance(state, recoveryAndSnack);
    close(state.time, cancelTime + recoveryAndSnack * .08);
    assert.equal(state.mode, 'snack');
    assert.equal(state.rest.phase, 'idle');
    assert.equal(state.distance, 0);
  }
});

test('walking waits for packing and standing after cancellations throughout either rest sequence', () => {
  for (const kind of ['snack', 'sleep']) for (const cancelAt of [.2, 2.1, REST_TIMING[kind].enter - .1, REST_TIMING[kind].enter + 2]) {
    const state = createJourney();
    state.distance = 17;
    setActivity(state, kind);
    advance(state, cancelAt);
    const phase = state.rest.phase, phaseTime = state.rest.time;
    setActivity(state, 'walking');
    assert.equal(state.rest.phase, 'exit');
    assert.equal(state.rest.fromPhase, phase);
    close(state.rest.fromTime, phaseTime);
    advance(state, REST_TIMING[kind].exit - .1);
    assert.equal(state.rest.phase, 'exit');
    assert.equal(state.distance, 17);
    stepJourney(state, .1);
    assert.equal(state.mode, 'walking');
    assert.equal(state.rest, null);
    close(state.distance, 17);
    stepJourney(state, .1);
    close(state.distance, 17.115);
  }
});

test('rapid activity changes update the destination without restarting recovery or causing delayed sleep', () => {
  const state = createJourney();
  setActivity(state, 'snack');
  advance(state, REST_TIMING.snack.enter + 1);
  setActivity(state, 'sleep');
  advance(state, .4);
  const phaseTime = state.rest.time, fromTime = state.rest.fromTime, clock = state.time;
  for (const requested of ['walking', 'sleep', 'snack', 'walking', 'paused']) {
    setActivity(state, requested);
    assert.equal(state.rest.phase, 'exit');
    assert.equal(state.rest.time, phaseTime);
    assert.equal(state.rest.fromTime, fromTime);
    assert.equal(state.rest.nextMode, requested);
  }
  advance(state, REST_TIMING.snack.exit - .4 + 15);
  assert.equal(state.mode, 'paused');
  assert.equal(state.rest, null);
  assert.equal(state.distance, 0);
  close(state.time, clock + (REST_TIMING.snack.exit - .4 + 15) * .08);
});

test('save and resume retain a journey without offline progression', () => {
  const state = createJourney(0xfedcba98);
  setActivity(state, 'walking');
  advance(state, 12);
  state.seen = ['fox', 'spirit'];
  state.sound = true;
  const resumed = restoreJourney(serializeJourney(state));
  assert.deepEqual(resumed, state);
  stepJourney(state, .1);
  stepJourney(resumed, .1);
  assert.deepEqual(resumed, state);
  assert.equal(createJourney(state.seed).distance, 0);
});

test('saving any preparation, idle or recovery phase preserves its clock, pose timing and next action', () => {
  for (const kind of ['snack', 'sleep']) for (const phase of ['enter', 'idle', 'exit']) {
    const state = createJourney(0xfedcba98);
    state.distance = 127;
    state.seen = ['fox', 'unicorn'];
    setActivity(state, kind);
    advance(state, phase === 'enter' ? 2.3 : REST_TIMING[kind].enter + 2.3);
    if (phase === 'exit') {
      setActivity(state, 'walking');
      advance(state, .7);
    }
    assert.equal(state.rest.phase, phase);
    const saved = serializeJourney(state), resumed = restoreJourney(saved);
    assert.deepEqual(resumed, state);
    assert.ok(saved.length < 1200, 'rest timing must not turn a small save into an animation recording');
    for (let step = 0; step < 180; step++) {
      stepJourney(state, .1);
      stepJourney(resumed, .1);
      assert.deepEqual(resumed, state, `${kind} ${phase} diverged after reload at frame ${step}`);
    }
  }
});

test('legacy saves retain their journey and migrate resting modes without replaying preparation', () => {
  const legacy = {
    version: 1, seed: 73, distance: 420, time: 14, elapsed: 500,
    mode: 'snack', modeTime: 12.5, seen: ['fox', 'deer'], sound: true,
  };
  const snack = restoreJourney(legacy);
  assert.equal(snack.seed, legacy.seed);
  assert.equal(snack.distance, legacy.distance);
  assert.equal(snack.time, legacy.time);
  assert.deepEqual(snack.seen, legacy.seen);
  assert.equal(snack.rest.kind, 'snack');
  assert.equal(snack.rest.phase, 'idle');
  close(snack.rest.time, 12.5);
  const progress = 2.3 / 7, smoothProgress = progress * progress * (3 - 2 * progress);
  const oldSleep = { ...legacy, mode: 'sleep', modeTime: 2.3,
    time: 8 + (31 - 8) * smoothProgress, sleep: { start: 8, target: 31 } };
  const sleeping = restoreJourney(oldSleep);
  assert.equal(sleeping.rest.kind, 'sleep');
  assert.equal(sleeping.rest.phase, 'idle');
  close(sleeping.rest.time, 2.3);
  close(sleeping.time, oldSleep.time);
  assert.equal(sleeping.distance, 420);
  advance(sleeping, 4.7);
  close(sleeping.time, 31);
  assert.equal(sleeping.rest.phase, 'exit');
});

test('corrupt, old and oversized saves fall back safely; invalid fields and encounter history are bounded', () => {
  for (const raw of ['{broken', null, [], { version: 9 }, 'x'.repeat(16385)]) {
    assert.deepEqual(restoreJourney(raw), createJourney());
  }
  const bad = restoreJourney({
    version: 1, seed: NaN, distance: -88, time: -50, elapsed: Infinity,
    mode: 'fly', modeTime: -10, sound: 'yes',
    seen: [null, {}, 'a'.repeat(121), ...Array.from({ length: 100 }, (_, n) => `animal-${n}`), 'animal-99'],
  });
  assert.equal(bad.distance, 0);
  assert.equal(bad.time, 0);
  assert.equal(bad.elapsed, 0);
  assert.equal(bad.mode, 'paused');
  assert.equal(bad.sound, false);
  assert.equal(bad.seen.length, 48);
  assert.equal(new Set(bad.seen).size, 48);
  const brokenSleep = restoreJourney({ ...createJourney(), mode: 'sleep', modeTime: 3, sleep: { start: 8, target: -10 } });
  assert.equal(brokenSleep.mode, 'paused');
  assert.equal(brokenSleep.time, 8);
});

test('world generation is repeatable regardless of traversal order and changes with the seed', () => {
  const direct = new TrailWorld(734);
  direct.update(123);
  const wandering = new TrailWorld(734);
  for (const distance of [5000, 0, 57, 9999, 123]) wandering.update(distance);
  assert.deepEqual(wandering.entities, direct.entities);
  assert.notDeepEqual(new TrailWorld(735).entities, new TrailWorld(734).entities);
  const retained = direct.update(123.1);
  assert.strictEqual(retained, direct.entities);
});

test('streaming retains exactly five chunks with bounded entities, including scenery behind the start', () => {
  const world = new TrailWorld(28);
  assert.deepEqual([...world.chunks.keys()], [-2, -1, 0, 1, 2]);
  assert.ok(world.entities.some(entity => entity.s < 0));
  for (let iteration = 0; iteration < 180; iteration++) {
    const distance = iteration * 1031.7;
    world.update(distance);
    assert.equal(world.chunks.size, 5);
    assert.ok(world.entities.length <= 400);
    assert.equal(new Set(world.entities.map(entity => entity.id)).size, world.entities.length);
    const center = Math.floor(distance / 18);
    assert.deepEqual([...world.chunks.keys()].sort((a, b) => a - b), [center - 2, center - 1, center, center + 1, center + 2]);
    for (const chunk of world.chunks.values()) {
      assert.ok(chunk.entities.length <= 80);
      for (const entity of chunk.entities) {
        assert.ok(entity.s >= chunk.start && entity.s < chunk.end);
        if (entity.kind === 'tree') assert.ok(Math.abs(entity.side) > 2.5);
      }
    }
  }
});

test('opening introduces one fox, leaving the next stretch quiet and magic unforced', () => {
  const world = new TrailWorld(1);
  const opening = world.entities.filter(entity => entity.kind === 'animal' && entity.s >= 0 && entity.s < 35);
  assert.equal(opening.length, 1);
  assert.equal(opening[0].variant, 'fox');
  assert.equal(opening[0].s, 5);
  assert.equal(opening[0].mystical, false);
});

test('biomes form coherent stretches and the first stream follows the opening forest', () => {
  const seed = 81;
  assert.equal(biomeAt(-100, seed), 'forest');
  assert.equal(biomeAt(0, seed), 'forest');
  let previous = biomeAt(0, seed);
  let lastChange = 0;
  const changes = [];
  for (let s = 1; s < 2000; s++) {
    const biome = biomeAt(s, seed);
    if (biome !== previous) {
      changes.push({ s, biome });
      if (lastChange) assert.ok(s - lastChange >= 49 && s - lastChange <= 71);
      lastChange = s;
      previous = biome;
    }
  }
  assert.equal(changes[0].biome, 'stream');
  assert.ok(changes[0].s >= 38 && changes[0].s <= 44);
  assert.deepEqual(new Set(changes.map(change => change.biome)), new Set(['forest', 'stream', 'meadow', 'mountain', 'swamp', 'enchanted']));
});

test('winding paths and elevated terrain remain continuous through region changes', () => {
  const seed = 532;
  close(pathAt(0, seed), 0);
  for (let s = -40; s < 1600; s += .37) {
    assert.ok(Math.abs(pathAt(s + .001, seed) - pathAt(s - .001, seed)) < .0026);
    for (const side of [-8, 0, 8]) {
      const elevation = terrainAt(s, side, seed);
      assert.ok(elevation >= -3 && elevation <= 38);
      assert.ok(Math.abs(terrainAt(s + .001, side, seed) - terrainAt(s - .001, side, seed)) < .008);
    }
  }
});

test('river crossing metadata matches a narrow river and a smooth bed suitable for the bridge', () => {
  const seed = 42;
  let river;
  for (let s = 35; s < 65; s++) river ||= riverAt(s, seed);
  assert.ok(river);
  assert.ok(river.width >= 2.7 && river.width <= 3.3);
  assert.ok(river.center >= 48 && river.center <= 53);
  assert.equal(riverAt(river.center + 7.01, seed), null);
  close(terrainAt(river.center, pathAt(river.center, seed), seed), river.level - .16);
  close(trailProfileAt(river.center, seed).height, river.bridgeHeight);
  close(river.bridgeHeight - river.level, .26);
  const edge = river.center + 7;
  assert.ok(Math.abs(terrainAt(edge - .001, 0, seed) - terrainAt(edge + .001, 0, seed)) < .002);
});

test('environment produces a five-minute day, two-day seasons and stable seeded weather', () => {
  const state = createJourney(111);
  advance(state, 300);
  close(state.time, 32);
  state.time = 0;
  assert.equal(environment(state).night, 1);
  state.time = 12;
  assert.equal(environment(state).daylight, 1);
  for (const [time, season] of [[47.9, 'spring'], [48, 'summer'], [96, 'autumn'], [144, 'winter'], [192, 'spring']]) {
    state.time = time;
    assert.equal(environment(state).season, season);
    assert.deepEqual(environment(state), environment({ ...state }));
  }
});


test('a wider view streams bounded deterministic chunks and scenery on both hillsides', () => {
  const world = new TrailWorld(42);
  world.update(0, 60);
  assert.equal(world.chunks.size, 9);
  assert.ok(world.entities.some(e => e.side < -30 && e.kind === 'tree'));
  assert.ok(world.entities.some(e => e.side > 30 && e.kind === 'tree'));
  const initial = JSON.stringify(world.entities);
  for (const distance of [120, 7000, 107, 1e8, 0]) {
    world.update(distance, 60);
    assert.equal(world.chunks.size, 9);
    assert.ok(world.entities.length <= 720);
    assert.ok(world.entities.every(e => Math.abs(e.side) < 44));
  }
  assert.equal(JSON.stringify(world.entities), initial);
  world.update(0, 36);
  assert.equal(world.chunks.size, 5);
  world.update(0, 84);
  assert.equal(world.chunks.size, 11);
  assert.ok(world.entities.length <= 880);
  world.update(0, 1e9);
  assert.equal(world.chunks.size, 11);
});

test('the route visibly winds, climbs into passes and descends into valleys', () => {
  for (const seed of [1, 42, 81, 532, 0xffffffff]) {
    let low = Infinity, high = -Infinity, climb = 0, descent = 0, bend = 0;
    for (let s = 0; s < 620; s += .5) {
      const profile = trailProfileAt(s, seed);
      low = Math.min(low, profile.height); high = Math.max(high, profile.height);
      climb = Math.max(climb, profile.grade); descent = Math.min(descent, profile.grade);
      bend = Math.max(bend, Math.abs(pathAt(s + 10, seed) - (pathAt(s, seed) + pathAt(s + 20, seed)) / 2));
      assert.ok(Math.abs(profile.grade) < .7, 'the trail must remain a walkable slope');
      assert.ok(profile.width > .6 && profile.width < 1.1);
      close(pathSlopeAt(s, seed), (pathAt(s + .0001, seed) - pathAt(s - .0001, seed)) / .0002, 1e-7);
    }
    assert.ok(high - low > 10, 'passes and valleys need meaningful vertical relief');
    assert.ok(climb > .25 && descent < -.25, 'the route must both climb and descend');
    assert.ok(bend > 1.5, 'the path must have visible bends within one landscape');
  }
});


test('mountain ridges have visible relief behind the trail and lower foreground foothills', () => {
  for (const seed of [1, 42, 81, 532, 0xffffffff]) {
    let highestFar = 0, highestNear = 0;
    for (let s = 175; s <= 210; s += 1) {
      const profile = trailProfileAt(s, seed);
      for (const offset of [14, 18, 22, 26]) {
        highestFar = Math.max(highestFar, terrainAt(s, profile.x - offset, seed) - profile.height);
        highestNear = Math.max(highestNear, terrainAt(s, profile.x + offset, seed) - profile.height);
      }
    }
    assert.ok(highestFar > 12, 'distant ridgelines must rise several tree heights above the trail');
    assert.ok(highestNear < 5, 'foreground terrain should not hide the traveller in a trench');
  }
});

test('wetland pools have real basins, dry trails and continuous banks', () => {
  for (const seed of [1, 42, 532]) {
    const pools = new Map();
    for (let s = 220; s < 285; s += .5) {
      for (const pool of swampPoolsAt(s, seed)) pools.set(pool.id, pool);
      assert.equal(waterAt(s, pathAt(s, seed), seed), null, 'the traveller keeps a dry route through wetlands');
    }
    assert.ok(pools.size >= 4);
    for (const pool of pools.values()) {
      assert.equal(waterAt(pool.s, pool.x, seed)?.kind, 'swamp');
      close(terrainAt(pool.s, pool.x, seed), pool.level - pool.depth);
      const outer = pool.x + pool.rx * 1.5;
      assert.equal(waterAt(pool.s, outer, seed), null);
      assert.ok(Math.abs(terrainAt(pool.s, outer + .001, seed) - terrainAt(pool.s, outer - .001, seed)) < .01);
      assert.ok(terrainAt(pool.s, outer, seed) > pool.level);
    }
  }
});

test('long journeys retain all 25 species, 12 tree silhouettes, water life and occasional horse herds', () => {
  const world = new TrailWorld(28), species = new Set(), trees = new Set();
  let horses = false, waterLife = false, crocodiles = false;
  for (let distance = 0; distance < 12000; distance += 54) {
    world.update(distance);
    const herds = new Map();
    for (const e of world.entities) {
      if (e.kind === 'tree') trees.add(e.variant);
      if (e.kind !== 'animal') continue;
      species.add(e.variant);
      if (e.variant === 'horse' && e.group) herds.set(e.group, (herds.get(e.group) || 0) + 1);
      if (e.variant === 'fish' || e.variant === 'otter') {
        assert.ok(['stream', 'swamp'].includes(e.water?.kind)); waterLife = true;
      }
      if (e.variant === 'crocodile') {
        assert.equal(e.water?.kind, 'swamp'); crocodiles = true;
      }
    }
    horses ||= [...herds.values()].some(count => count >= 3);
  }
  assert.equal(species.size, 25);
  assert.equal(trees.size, 12);
  assert.ok(horses && waterLife && crocodiles);
});

test('encounters leave long quiet gaps, small families, sparse water life and genuinely rare magic', () => {
  for (const seed of [1, 28, 42, 532, createJourney().seed]) {
    const world = new TrailWorld(seed), animals = new Map();
    for (let distance = 0; distance < 12000; distance += 72) {
      world.update(distance);
      for (const e of world.entities) if (e.kind === 'animal' && e.s >= 0 && e.s < 12000) animals.set(e.id, e);
    }
    const all = [...animals.values()];
    assert.ok(all.length > 150 && all.length < 420, 'the full variety must stay much more spread out');
    const encounters = new Map(), groups = new Map(), waterResidents = new Map();
    for (const e of all) {
      if (e.encounter) encounters.set(e.encounter, e.encounterS);
      if (e.group) groups.set(e.group, (groups.get(e.group) || 0) + 1);
      if (e.water) {
        const waterId = e.water.id || `river:${e.water.center}`;
        waterResidents.set(waterId, (waterResidents.get(waterId) || 0) + 1);
      }
    }
    const positions = [...encounters.values()].sort((a, b) => a - b);
    for (let n = 1; n < positions.length; n++) assert.ok(positions[n] - positions[n - 1] >= 33.9);
    assert.ok([...groups.values()].every(count => count <= 3));
    assert.ok([...waterResidents.values()].every(count => count <= 2));
    const magical = all.filter(e => e.mystical).sort((a, b) => a.s - b.s);
    assert.ok(magical.length > 0 && magical.length < all.length * .13);
    for (let n = 1; n < magical.length; n++) assert.ok(magical[n].s - magical[n - 1].s >= 225.9);
    assert.ok(magical.every(e => ['unicorn', 'stag', 'spirit'].includes(e.variant) && !e.group));
  }
});
