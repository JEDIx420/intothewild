import test from 'node:test';
import assert from 'node:assert/strict';
import { createJourney, setActivity, stepJourney, serializeJourney, restoreJourney } from '../js/world.js';
import { sampleTraveller, drawTraveller, REST_TIMING, restEntryDuration } from '../js/traveller.js';
import { Raster, rgb } from '../js/pixel.js';

const sample = (state, extra = {}) => sampleTraveller({ ...state, time: state.elapsed, ...extra });
function advance(state, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) stepJourney(state, 1 / 60);
}
function difference(a, b) {
  return Math.max(...Object.keys(a).flatMap(key => Array.isArray(a[key])
    ? a[key].map((value, i) => Math.abs(value - b[key][i])) : Math.abs(a[key] - b[key])));
}

test('starting or interrupting either rest action preserves the exact visible pose', () => {
  for (const reducedMotion of [false, true]) for (const grade of [-.5, 0, .5]) {
    for (const kind of ['snack', 'sleep']) for (const stopAt of [.1, 1, 2.5, 4.1, REST_TIMING[kind].enter + 2]) {
      const state = createJourney();
      setActivity(state, 'walking'); advance(state, .2);
      const extra = { grade, reducedMotion }, before = sample(state, extra);
      setActivity(state, kind);
      assert.ok(difference(before, sample(state, extra)) < 1e-10, `${kind} snaps when walking ends`);
      advance(state, stopAt);
      const seated = sample(state, extra);
      setActivity(state, 'walking');
      assert.ok(difference(seated, sample(state, extra)) < 1e-10, `${kind} snaps when cancelled at ${stopAt}s`);
      advance(state, .3);
      const restored = restoreJourney(serializeJourney(state));
      assert.ok(difference(sample(state, extra), sample(restored, extra)) < 1e-10, 'reload changes the recovery pose');
    }
  }
});

test('joints and props move continuously across preparation, idle and recovery seams', () => {
  for (const reducedMotion of [false, true]) for (const kind of ['snack', 'sleep']) {
    const state = createJourney();
    setActivity(state, kind);
    let previous = sample(state, { reducedMotion });
    let largestStep = 0;
    const seconds = REST_TIMING[kind].enter + 2 + REST_TIMING[kind].exit + 1;
    for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) {
      if (frame === Math.round((REST_TIMING[kind].enter + 2) * 60)) setActivity(state, 'walking');
      stepJourney(state, 1 / 60);
      const pose = sample(state, { reducedMotion });
      for (const value of Object.values(pose).flat()) assert.ok(Number.isFinite(value));
      largestStep = Math.max(largestStep, difference(previous, pose));
      previous = pose;
    }
    // At the native scale this allows fast hand movement, but not a one-frame
    // standing/seated swap, a prop teleport, or the former sideways jump.
    assert.ok(largestStep < .15, `${kind} moved ${largestStep} units in one frame`);
    assert.equal(state.mode, 'walking');
  }
});

test('sleep starts at the current snack pose and a seated traveller stays low', () => {
  for (const reducedMotion of [false, true]) for (const at of [.2, 2.5, 6]) {
    const state = createJourney();
    const extra = { reducedMotion, grade: .3 };
    setActivity(state, 'snack');
    advance(state, at);
    let previous = sample(state, extra);
    setActivity(state, 'sleep');
    assert.equal(state.mode, 'sleep');
    assert.equal(state.rest.phase, 'enter');
    assert.ok(difference(previous, sample(state, extra)) < 1e-10);
    const duration = restEntryDuration(state.rest);
    for (let i = 0; i < Math.round(duration * 60); i++) {
      stepJourney(state, 1 / 60);
      const pose = sample(state, extra);
      assert.ok(difference(previous, pose) < .15);
      if (at >= 2.5) assert.ok(pose.hip[2] < .6, 'the traveller stood up during the switch');
      previous = pose;
      if (i === 45) {
        const restored = restoreJourney(serializeJourney(state));
        assert.ok(difference(pose, sample(restored, extra)) < 1e-10, 'reloading changes the switch pose');
        setActivity(restored, 'walking');
        assert.ok(difference(pose, sample(restored, extra)) < 1e-10, 'cancelling the switch changes the pose');
      }
    }
    assert.equal(state.rest.phase, 'idle');
    assert.equal(previous.cover, 1);
  }
});

test('the bag is laid out before the traveller lies down, and food is handled after sitting', () => {
  for (const kind of ['snack', 'sleep']) {
    const state = createJourney();
    setActivity(state, kind);
    advance(state, 2.5);
    const preparing = sample(state);
    assert.ok(preparing.hip[2] < .6, 'preparation should include a seated pose');
    assert.ok(preparing.pack[2] < .5, 'the backpack should reach the ground');
    assert.equal(preparing.cover, 0);
    assert.equal(preparing.bread, 0);
    advance(state, REST_TIMING[kind].enter - 2.5);
    const resting = sample(state);
    if (kind === 'sleep') {
      assert.equal(resting.bag, 1); assert.equal(resting.cover, 1);
      assert.ok(resting.head[2] < .4);
    } else {
      assert.equal(resting.bread, 1); assert.equal(resting.mug, 1);
      const firstHand = resting.lhand;
      advance(state, 1.5);
      assert.ok(Math.hypot(...sample(state).lhand.map((value, i) => value - firstHand[i])) > .15,
        'eating should continue after the setup animation');
    }
  }
});

test('all camp phases render at the small native scale on ascending and descending ground', () => {
  const r = new Raster(120, 100, 10);
  r.oy = 76;
  for (const grade of [-.4, 0, .4]) for (const kind of ['snack', 'sleep']) {
    const state = createJourney(); setActivity(state, kind);
    for (let frame = 0; frame < 21; frame++) {
      if (frame === 14) setActivity(state, 'walking');
      r.clear(rgb(105, 135, 82));
      drawTraveller(r, { ...state, time: state.elapsed, grade, groundAt: (x, y) => -y * grade });
      const drawn = r.depth.filter(value => value > -1e8);
      assert.ok(drawn.length > 35 && drawn.length < 1300, `${kind} disappeared or changed scale`);
      for (const value of drawn) assert.ok(Number.isFinite(value));
      advance(state, .4);
    }
  }
});

test('boots and trouser ankles share the same terrain height on an incline', () => {
  for (const grade of [-.5, .5]) {
    const calls = [];
    const r = { shadow() {}, sphere() {}, ellipsoid() {}, capsule: (...args) => calls.push(args) };
    const options = {
      time: 12.3, distance: 8.4, grade, modeTime: 2, reducedMotion: false,
      x: 0, y: 0, z: 0, yaw: 0, mode: 'walking', rest: null,
      groundAt: (x, y) => x * grade + y * .2,
    };
    const pose = sampleTraveller(options);
    drawTraveller(r, { ...options, pose });
    for (const prefix of ['l', 'r']) {
      const ankle = pose[`${prefix}ankle`];
      const expected = ankle[2] + options.groundAt(ankle[0], ankle[1]);
      assert.ok(calls.some(([, end, radius, endRadius]) => radius === .115 && endRadius === .075
        && Math.abs(end[2] - expected) < 1e-9), `${prefix} ankle must meet its grounded boot`);
    }
  }
});
