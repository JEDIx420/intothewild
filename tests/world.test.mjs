import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createJourney, stepJourney, setActivity, environment, pathAt, terrainAt,
  biomeAt, riverAt, TrailWorld, serializeJourney, restoreJourney,
} from '../js/world.js';

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

test('sleep reaches the next 07:00 after seven real seconds without changing location', () => {
  for (const [start, target] of [[8, 31], [6, 7], [7, 31], [23, 31]]) {
    const state = createJourney();
    state.time = start;
    state.distance = 19;
    setActivity(state, 'sleep');
    advance(state, 3);
    assert.ok(state.time >= start && state.time < target);
    assert.equal(state.mode, 'sleep');
    advance(state, 4);
    assert.equal(state.time, target);
    assert.equal(state.distance, 19);
    assert.equal(state.mode, 'paused');
  }
});

test('a cancelled sleep keeps current time and never later jumps to its abandoned target', () => {
  const state = createJourney();
  setActivity(state, 'sleep');
  advance(state, 2);
  const cancelTime = state.time;
  setActivity(state, 'snack');
  advance(state, 6);
  close(state.time, cancelTime + 6 * .08);
  assert.equal(state.mode, 'snack');
  assert.equal(state.distance, 0);
});

test('save and resume retain a journey and an in-progress sleep without offline progression', () => {
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
  setActivity(state, 'sleep');
  advance(state, 2.3);
  const sleeping = restoreJourney(serializeJourney(state));
  assert.deepEqual(sleeping, state);
  advance(state, 4.7);
  advance(sleeping, 4.7);
  assert.deepEqual(sleeping, state);
  assert.equal(sleeping.mode, 'paused');
  assert.ok(serializeJourney(sleeping).length < 900);
  assert.equal(createJourney(state.seed).distance, 0);
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
    assert.ok(world.entities.length <= 110);
    assert.equal(new Set(world.entities.map(entity => entity.id)).size, world.entities.length);
    const center = Math.floor(distance / 18);
    assert.deepEqual([...world.chunks.keys()].sort((a, b) => a - b), [center - 2, center - 1, center, center + 1, center + 2]);
    for (const chunk of world.chunks.values()) {
      assert.ok(chunk.entities.length <= 22);
      for (const entity of chunk.entities) {
        assert.ok(entity.s >= chunk.start && entity.s < chunk.end);
        if (entity.kind === 'tree') assert.ok(Math.abs(entity.side) > 2.5);
      }
    }
  }
});

test('opening guarantees wildlife and a magical encounter within the first 35 seconds of walking', () => {
  const world = new TrailWorld(1);
  assert.ok(world.entities.some(entity => entity.variant === 'fox' && entity.s === 5 && entity.side === 2.5));
  assert.ok(world.entities.some(entity => entity.variant === 'spirit' && entity.s >= 0 && entity.s / 1.15 < 35));
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
  assert.deepEqual(new Set(changes.map(change => change.biome)), new Set(['forest', 'stream', 'meadow', 'mountain', 'enchanted']));
});

test('path and terrain stay continuous through region changes, and mountain elevations remain modest', () => {
  const seed = 532;
  close(pathAt(0, seed), 0);
  for (let s = -40; s < 1600; s += .37) {
    assert.ok(Math.abs(pathAt(s + .001, seed) - pathAt(s - .001, seed)) < .001);
    for (const side of [-8, 0, 8]) {
      const elevation = terrainAt(s, side, seed);
      assert.ok(elevation >= -.15 && elevation <= 2);
      assert.ok(Math.abs(terrainAt(s + .001, side, seed) - terrainAt(s - .001, side, seed)) < .002);
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
  close(terrainAt(river.center, pathAt(river.center, seed), seed), -.13);
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
