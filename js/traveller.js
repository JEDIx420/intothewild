/* Small, continuous camp animations. Poses are local coordinates, in metres. */
export const REST_TIMING = Object.freeze({
  snack: Object.freeze({ enter: 4.4, exit: 2.4 }),
  sleep: Object.freeze({ enter: 4.8, fromSnack: 3.2, exit: 3 }),
});

export const restEntryDuration = rest => rest.fromSnack ? REST_TIMING.sleep.fromSnack : REST_TIMING[rest.kind].enter;

const C = {
  coat: [172, 91, 49], coatLight: [199, 117, 61], coatDark: [123, 65, 43],
  trousers: [70, 75, 68], boot: [62, 48, 39], sole: [41, 37, 33],
  skin: [218, 175, 134], skinShade: [183, 133, 99], hair: [66, 47, 37], dark: [43, 44, 40],
  hat: [182, 153, 101], hatRim: [212, 181, 123], hatBand: [96, 78, 49],
  pack: [94, 105, 74], packLight: [125, 137, 93], leather: [98, 71, 46],
  bag: [126, 147, 138], bagLight: [173, 185, 157], bagInside: [91, 112, 107],
  staff: [113, 85, 56], mug: [219, 218, 187], tea: [102, 70, 42],
  bread: [231, 190, 121], cloth: [168, 149, 111], lantern: [107, 86, 49], flame: [255, 220, 139],
};
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const ease = v => { const t = clamp(v); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const pointMix = (a, b, t) => a.map((v, i) => mix(v, b[i], t));
const offset = (p, f = 0, s = 0, u = 0) => [p[0] + f, p[1] + s, p[2] + u];
const copy = pose => Object.fromEntries(Object.entries(pose).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
function changed(pose, patch) {
  const result = { ...copy(pose), ...patch };
  if (!patch.hat && result.hatWorn === 1) {
    result.hat = offset(result.head, Math.sin(result.headTilt) * .17, 0, Math.cos(result.headTilt) * .17);
    result.hatTilt = result.headTilt;
  }
  return result;
}
function clip(frames, time) {
  if (time <= frames[0][0]) return copy(frames[0][1]);
  for (let i = 1; i < frames.length; i++) {
    if (time <= frames[i][0]) {
      const [a, pa] = frames[i - 1], [b, pb] = frames[i];
      // Carry momentum through intermediate poses and ease into reversals.
      const previous = frames[i - 2], next = frames[i + 1], span = b - a;
      const t = (time - a) / span, u = 1 - t;
      const tangent = (left, right) => left * right > 0 ? 2 * left * right / (left + right) : 0;
      const interpolate = (start, end, before, after) => {
        const speed = (end - start) / span;
        const incoming = previous ? tangent((start - before) / (a - previous[0]), speed) : 0;
        const outgoing = next ? tangent(speed, (after - end) / (next[0] - b)) : 0;
        return clamp(mix(start, end, ease(t)) + span * t * u * (u * incoming - t * outgoing),
          Math.min(start, end), Math.max(start, end));
      };
      return Object.fromEntries(Object.entries(pa).map(([key, start]) => {
        const end = pb[key], before = previous?.[1][key], after = next?.[1][key];
        return [key, Array.isArray(start)
          ? start.map((value, j) => interpolate(value, end[j], before?.[j], after?.[j]))
          : interpolate(start, end, before, after)];
      }));
    }
  }
  return copy(frames[frames.length - 1][1]);
}

function standing(p, moving = p.mode === 'walking', modeTime = finite(p.modeTime, 1)) {
  const amount = moving && !p.reducedMotion ? ease(modeTime / .4) : 0;
  const phase = finite(p.distance) * 6.1;
  const breath = p.reducedMotion ? 0 : Math.sin(finite(p.time) * 1.8) * .014;
  const bob = mix(breath, Math.cos(phase * 2) * .026, amount);
  const hip = 1.07 + bob, shoulder = 1.79 + bob;
  const arm = amount * Math.sin(phase) * .38 + (1 - amount) * .03 * Math.sin(finite(p.time) * .7);
  const pose = {
    hip: [-.015, 0, hip], shoulder: [.025, 0, shoulder], head: [.025, 0, shoulder + .34], headTilt: 0,
    lknee: [0, -.16, .58], rknee: [0, .16, .58], lankle: [0, -.165, .11], rankle: [0, .165, .11],
    ltoe: [.17, -.165, .075], rtoe: [.17, .165, .075],
    lelbow: [.02 - arm * .45, -.36, shoulder - .34], lhand: [.05 - arm, -.36, shoulder - .72],
    relbow: [.1 + arm * .16, .36, shoulder - .29], rhand: [.29 + arm * .23, .37, shoulder - .5],
    pack: [-.29, 0, hip + .42], packOpen: 0, straps: 1,
    roll: [-.29, 0, hip + .82], rollAmount: 1,
    staffA: [.46 + arm * .45, .42, .045], staffB: [.23 + arm * .2, .38, shoulder - .32],
    lantern: [-.23, -.31, hip - .02], hat: [.025, 0, shoulder + .51], hatTilt: 0, hatWorn: 1,
    cloth: 0, bag: 0, cover: 0, bread: 0, mug: 0, sideOffset: 0, restAmount: 0,
  };
  for (const [side, prefix] of [[-1, 'l'], [1, 'r']]) {
    const q = phase + (side === 1 ? Math.PI : 0);
    const swing = Math.sin(q) * amount;
    const lift = Math.max(0, Math.cos(q)) * (.21 + Math.max(0, finite(p.grade)) * .15) * amount;
    const foot = .32 * swing * (1 - Math.abs(finite(p.grade)) * .24);
    pose[`${prefix}knee`] = [foot * .47 + lift * .7, side * .16, .58 + lift * .38];
    pose[`${prefix}ankle`] = [foot, side * .165, .11 + lift];
    pose[`${prefix}toe`] = [foot + .17, side * .165, .075 + lift];
  }
  return pose;
}

function sitting(p) {
  return changed(standing(p, false), {
    hip: [-.04, 0, .43], shoulder: [-.1, 0, 1.17], head: [-.07, 0, 1.54],
    lknee: [.4, -.3, .23], rknee: [.4, .3, .23],
    lankle: [.72, -.2, .1], rankle: [.72, .2, .1], ltoe: [.88, -.2, .09], rtoe: [.88, .2, .09],
    lelbow: [.17, -.37, .83], lhand: [.35, -.28, .55],
    relbow: [.17, .35, .83], rhand: [.4, .29, .55],
    pack: [-.13, -.77, .35], packOpen: 0, straps: 0,
    roll: [-.13, -.77, .75], rollAmount: 1,
    staffA: [-.35, .72, .06], staffB: [1.12, .76, .06],
    lantern: [-.32, .59, .11], sideOffset: 1.12, restAmount: 1,
  });
}
function snackIdle(p, time) {
  const pose = sitting(p);
  const bite = p.reducedMotion ? .75 : (1 + Math.cos(time * Math.PI / 3.2)) / 2;
  const sip = p.reducedMotion ? 0 : Math.pow(Math.max(0, Math.sin(time * .65 - 1)), 3);
  const breath = p.reducedMotion ? 0 : Math.sin(finite(p.time) * 1.8) * .012;
  return changed(pose, {
    shoulder: offset(pose.shoulder, 0, 0, breath), head: offset(pose.head, -.012 * bite, 0, breath),
    lelbow: [.23, -.37, .85 + bite * .2], lhand: [.39 - bite * .24, -.28 + bite * .08, .78 + bite * .65],
    relbow: [.23, .36, .86 + sip * .14], rhand: [.41 - sip * .24, .29 - sip * .11, .72 + sip * .67],
    cloth: 1, bread: 1, mug: 1, packOpen: .75,
  });
}
function sleepIdle(p) {
  const breath = p.reducedMotion ? 0 : Math.sin(finite(p.time) * 1.3) * .012;
  return changed(sitting(p), {
    hip: [.2, 0, .27], shoulder: [-.37, 0, .29 + breath], head: [-.69, -.01, .31 + breath], headTilt: -Math.PI / 2,
    lknee: [.62, -.19, .27], rknee: [.63, .18, .24],
    lankle: [.88, -.14, .13], rankle: [.91, .15, .13], ltoe: [1.04, -.14, .1], rtoe: [1.07, .15, .1],
    lelbow: [-.33, -.28, .19], lhand: [-.61, -.13, .26], relbow: [-.25, .25, .17], rhand: [-.55, .09, .24],
    pack: [-.63, -.76, .35], packOpen: 0, roll: [1.05, 0, .09], rollAmount: .22,
    hat: [-.18, .69, .09], hatWorn: 0, hatTilt: 0,
    lantern: [-.89, .53, .12], staffA: [-.85, .89, .06], staffB: [.9, .93, .06],
    bag: 1, cover: 1,
  });
}

function entryFrames(p, rest) {
  const frozen = { ...p, time: finite(rest.entryElapsed, p.time), distance: finite(rest.entryDistance, p.distance) };
  const start = standing(frozen, rest.wasWalking, finite(rest.entryModeTime, 1));
  const ready = changed(standing(frozen, false), {
    sideOffset: .22, staffA: [-.35, .72, .06], staffB: [1.12, .76, .06],
    relbow: [.25, .38, 1.25], rhand: [.55, .4, .84],
  });
  const stretch = changed(ready, {
    shoulder: [.025, 0, 1.82], head: [.015, 0, 2.18],
    lelbow: [-.03, -.44, 2.08], lhand: [.04, -.23, 2.59],
    relbow: [-.03, .44, 2.08], rhand: [.04, .23, 2.59], sideOffset: .56,
  });
  const straps = changed(ready, {
    lhand: [-.12, -.32, 1.79], lelbow: [.21, -.43, 1.46],
    rhand: [-.16, .3, 1.7], relbow: [.2, .44, 1.44], sideOffset: .83,
  });
  const crouch = changed(sitting(frozen), {
    hip: [-.19, 0, .74], shoulder: [.02, 0, 1.33], head: [.08, 0, 1.68], headTilt: .2,
    lknee: [.3, -.23, .54], rknee: [.31, .23, .48],
    lankle: [-.02, -.21, .1], rankle: [.07, .21, .1], ltoe: [.16, -.21, .08], rtoe: [.24, .21, .08],
    lelbow: [-.05, -.45, 1.06], lhand: [-.13, -.7, .68], relbow: [.31, .31, 1], rhand: [.48, .26, .52],
    restAmount: .6, sideOffset: 1.12, lantern: [-.32, .59, .11],
  });
  const reach = changed(sitting(frozen), {
    head: [-.02, -.06, 1.5], headTilt: .23,
    lelbow: [-.03, -.48, .99], lhand: [-.12, -.77, .75],
    relbow: [.2, -.1, .91], rhand: [-.06, -.53, .67],
  });
  if (rest.kind === 'snack') {
    const open = changed(reach, { packOpen: 1, cloth: 1, lhand: [-.1, -.73, .85], rhand: [.05, -.58, .6] });
    const food = changed(sitting(frozen), {
      packOpen: .75, cloth: 1, bread: 1, mug: 1,
      lhand: [.34, -.3, 1.07], lelbow: [.1, -.37, .87],
      rhand: [.35, .29, .7], relbow: [.13, .35, .84],
    });
    return [[0, start], [.42, ready], [.96, stretch], [1.5, straps], [2.08, crouch],
      [2.65, changed(reach, { cloth: 1 })], [3.18, open], [3.72, food],
      [4.4, snackIdle({ ...frozen, time: finite(rest.entryElapsed, p.time) + 4.4 }, 0)]];
  }
  const unpack = changed(reach, {
    pack: [-.63, -.76, .35], roll: [-.62, -.06, .24], packOpen: .8,
    lhand: [-.65, -.23, .24], rhand: [-.55, .22, .24], head: [.06, 0, 1.44], headTilt: .35,
  });
  const unroll = changed(unpack, {
    shoulder: [.18, 0, 1.02], head: [.32, 0, 1.32],
    lelbow: [.2, -.34, .58], lhand: [.8, -.2, .18],
    relbow: [.28, .34, .62], rhand: [.91, .21, .2],
    roll: [1.05, 0, .09], rollAmount: .22, bag: 1, packOpen: 0,
  });
  const duration = restEntryDuration(rest);
  const asleep = sleepIdle({ ...frozen, time: frozen.time + duration });
  const curl = changed(asleep, {
    hip: [.19, 0, .39], shoulder: [-.27, 0, .62], head: [-.5, 0, .89], headTilt: -.67,
    lelbow: [-.37, -.31, .47], lhand: [-.53, -.11, .74],
    relbow: [-.1, .32, .4], rhand: [-.17, .35, .16],
    lknee: [.62, -.22, .4], rknee: [.63, .2, .36],
    cover: .2, hat: [-.16, .57, .25], hatTilt: -.25,
  });
  if (rest.fromSnack) {
    const current = activePose(frozen, rest.fromSnack);
    const stow = changed(current.restAmount < .6 ? crouch : reach, {
      cloth: current.cloth * .45, packOpen: .55,
    });
    return [[0, current], [.72, stow], [1.32, unpack], [1.95, unroll], [2.54, curl], [duration, asleep]];
  }
  return [[0, start], [.42, ready], [.96, stretch], [1.5, straps], [2.08, crouch],
    [2.7, unpack], [3.48, unroll], [4.1, curl], [duration, asleep]];
}

function activePose(p, rest, phase = rest.phase, time = rest.time) {
  if (phase === 'enter') return clip(entryFrames(p, rest), finite(time));
  return rest.kind === 'sleep' ? sleepIdle(p) : snackIdle(p, finite(time));
}
function exitPose(p, rest) {
  const elapsed = finite(rest.fromElapsed, finite(rest.entryElapsed) + restEntryDuration(rest) + finite(rest.fromTime));
  const start = activePose({ ...p, time: elapsed }, rest, rest.fromPhase || 'idle', finite(rest.fromTime));
  const end = standing(p, false);
  const duration = REST_TIMING[rest.kind].exit, time = finite(rest.time);
  // Cancelling before sitting never drags the traveller into a seated pose.
  if (start.hip[2] > .85 && start.restAmount < .55) {
    const recover = changed(end, {
      sideOffset: start.sideOffset * .75,
      lhand: [-.13, -.31, 1.76], lelbow: [.2, -.42, 1.43],
      rhand: [-.13, .31, 1.76], relbow: [.2, .42, 1.43],
      staffA: start.staffA, staffB: start.staffB,
    });
    return clip([[0, start], [duration * .57, recover], [duration, end]], time);
  }
  const seat = changed(sitting(p), {
    sideOffset: start.sideOffset, cloth: start.cloth, bag: start.bag, rollAmount: start.rollAmount,
    roll: start.roll, cover: 0, pack: start.pack,
    hat: start.hat, hatWorn: start.hatWorn, hatTilt: start.hatTilt,
    lhand: [-.09, -.68, .67], lelbow: [-.03, -.46, .92],
    rhand: [.03, -.53, .69], relbow: [.2, -.08, .91], packOpen: .65,
  });
  const packed = changed(seat, {
    cloth: 0, bag: 0, cover: 0, packOpen: 0, roll: offset(seat.pack, 0, 0, .4), rollAmount: 1,
    head: [-.01, -.05, 1.48], headTilt: .15,
    lhand: offset(seat.pack, .02, .02, .41), rhand: offset(seat.pack, .08, .25, .29),
    hatWorn: 1,
  });
  const rise = changed(end, {
    hip: [-.11, 0, .84], shoulder: [.04, 0, 1.55], head: [.08, 0, 1.89],
    lknee: [.23, -.19, .55], rknee: [.21, .19, .53],
    pack: [-.28, -.2, 1.13], roll: [-.28, -.2, 1.53], straps: .5,
    lhand: [-.15, -.29, 1.48], lelbow: [.22, -.42, 1.14],
    rhand: [-.12, .27, 1.48], relbow: [.22, .4, 1.14],
    sideOffset: start.sideOffset * .6, restAmount: .3,
    staffA: seat.staffA, staffB: seat.staffB, lantern: [-.23, -.31, .8],
  });
  return clip([[0, start], [duration * .25, seat], [duration * .51, packed],
    [duration * .77, rise], [duration, end]], time);
}

/** Pure local pose; safe to sample out of order or resume halfway through. */
export function sampleTraveller(options = {}) {
  const p = { ...options, time: finite(options.time), distance: finite(options.distance), grade: finite(options.grade) };
  const rest = options.rest;
  if (rest && REST_TIMING[rest.kind]) {
    return rest.phase === 'exit' ? exitPose(p, rest) : activePose(p, rest);
  }
  // Old render callers can still ask for a settled resting pose directly.
  if (rest === undefined && options.mode === 'snack') return snackIdle(p, finite(options.modeTime));
  if (rest === undefined && options.mode === 'sleep') return sleepIdle(p);
  return standing(p);
}

/** Draw one sampled pose at the original small traveller scale. */
export function drawTraveller(r, options = {}) {
  const pose = options.pose || sampleTraveller(options);
  const x = finite(options.x), y = finite(options.y), z = finite(options.z), yaw = finite(options.yaw, -Math.PI / 2);
  const fx = Math.cos(yaw), fy = Math.sin(yaw), sx = -fy, sy = fx;
  const grade = clamp(finite(options.grade), -.65, .65);
  const lean = clamp(grade * .36, -.16, .2) * (1 - pose.restAmount);
  const P = (point, grounded = false) => {
    const f = point[0] + (grounded ? 0 : lean * Math.max(0, point[2] - .95));
    const xx = x + fx * f + sx * point[1], yy = y + fy * f + sy * point[1];
    const ground = typeof options.groundAt === 'function' ? finite(options.groundAt(xx, yy), z) : z + point[0] * grade;
    const groundBlend = typeof grounded === 'number' ? mix(grounded, 1, pose.restAmount) : grounded ? 1 : pose.restAmount;
    return [xx, yy, z + point[2] + (ground - z) * groundBlend];
  };
  const ball = (point, radius, color) => r.sphere(...P(point), radius, color);
  const oval = (point, a, b, c, color) => r.ellipsoid(...P(point), a, b, c, color);
  const bone = (a, b, radius, endRadius, color, grounded = false) => {
    const ends = Array.isArray(grounded) ? grounded : [grounded, grounded];
    r.capsule(P(a, ends[0]), P(b, ends[1]), radius, endRadius, color);
  };
  r.shadow(x, y, z, mix(.39, .7, pose.restAmount), 1);

  if (pose.cloth > .001) oval([.2, 0, .025], .58 * pose.cloth, .65 * pose.cloth, .035, C.cloth);
  if (pose.bag > .001) {
    // Overlapping low cushions follow the traveller's heading on a slope.
    const length = 1.77 * pose.bag;
    for (let i = 0; i <= 8; i++) {
      const f = -.71 + length * i / 8;
      oval([f, 0, .055], Math.min(.22, length * .3), .36, .055, C.bagInside);
    }
  }
  bone(pose.staffA, pose.staffB, .027, .025, C.staff, true);

  for (const [prefix, side] of [['l', -1], ['r', 1]]) {
    const hip = offset(pose.hip, 0, side * .145, 0), knee = pose[`${prefix}knee`], ankle = pose[`${prefix}ankle`], toe = pose[`${prefix}toe`];
    bone(hip, knee, .15, .115, C.trousers, [false, .55]);
    bone(knee, ankle, .115, .075, C.trousers, [.55, true]);
    bone(offset(ankle, -.065, 0, -.02), toe, .095, .09, C.boot, true);
    bone(offset(ankle, -.07, 0, -.075), offset(toe, .01, 0, -.04), .055, .055, C.sole, true);
  }
  bone(offset(pose.hip, 0, 0, .05), pose.shoulder, .29 - pose.cover * .04, .33 - pose.cover * .09, C.coat);
  oval(offset(pose.hip, -.04, 0, .06), .335, .255, .18, C.coatDark);
  bone(offset(pose.hip, .09, -.23, .22), offset(pose.shoulder, .015, -.26, -.03), .055, .075, C.coatLight);
  for (const [prefix, side] of [['l', -1], ['r', 1]]) {
    bone(offset(pose.shoulder, -.015, side * .32, -.015), pose[`${prefix}elbow`], .12, .09, C.coat);
    bone(pose[`${prefix}elbow`], pose[`${prefix}hand`], .088, .065, C.coatLight);
    ball(pose[`${prefix}hand`], .071, C.skin);
  }
  bone(pose.shoulder, pointMix(pose.shoulder, pose.head, .52), .105, .095, C.skin);
  const H = (f, s, u) => offset(pose.head, f * Math.cos(pose.headTilt) + u * Math.sin(pose.headTilt), s,
    u * Math.cos(pose.headTilt) - f * Math.sin(pose.headTilt));
  oval(pose.head, .185, .19, .22, C.skin);
  oval(H(-.072, 0, .055), .18, .155, .17, C.hair);
  ball(H(.175, .01, -.015), .055, C.skinShade);
  if (pose.cover < .8) ball(H(.125, -.12, .035), .022, C.dark);

  // The pack, its moving flap and the bedroll remain real props throughout.
  oval(pose.pack, .28, .19, .35, C.pack);
  const flap = offset(pose.pack, -.18 * pose.packOpen, 0, .23 + .2 * pose.packOpen);
  oval(offset(pose.pack, 0, 0, .26), .2, .14, .045, pose.packOpen > .3 ? C.leather : C.pack);
  oval(flap, .29, .2, .1 - pose.packOpen * .045, C.packLight);
  for (const side of [-1, 1]) {
    bone(offset(pose.pack, -.17, side * .17, .27), offset(pose.pack, -.18, side * .17, -.23), .025, .025, C.leather);
    if (pose.straps > .01) bone(offset(pose.shoulder, -.1, side * .25, .015), offset(pose.hip, .205, side * .235, .23), .027 * pose.straps, .027 * pose.straps, C.leather);
  }
  bone(offset(pose.roll, 0, -.3, 0), offset(pose.roll, 0, .3, 0), .105 * pose.rollAmount, .105 * pose.rollAmount, C.bag);
  ball(offset(pose.roll, 0, .31, 0), .08 * pose.rollAmount, C.bagLight);

  if (pose.cover > .001) {
    for (let i = 0; i <= 6; i++) {
      const f = -.39 + i * .2, rise = .19 + Math.sin((i + 1) / 8 * Math.PI) * .1;
      oval([f, .08 * (1 - pose.cover), .08 + rise * pose.cover], .25, .31 * pose.cover, .245 * pose.cover, C.bagLight);
    }
    bone([-.36, -.3 * pose.cover, .29 * pose.cover], [-.36, .3 * pose.cover, .29 * pose.cover], .045 * pose.cover, .045 * pose.cover, C.bag);
    bone([.82, -.28 * pose.cover, .19 * pose.cover], [.82, .28 * pose.cover, .19 * pose.cover], .027 * pose.cover, .027 * pose.cover, C.bag);
  }
  oval(pose.hat, .345, .305, .045, C.hatRim);
  oval(offset(pose.hat, -.025, 0, .08), .22, .21, .12, C.hat);
  oval(offset(pose.hat, -.025, 0, .022), .224, .214, .035, C.hatBand);
  if (pose.bread > .001) oval(offset(pose.lhand, .04, 0, .055), .115 * pose.bread, .08 * pose.bread, .06 * pose.bread, C.bread);
  if (pose.mug > .001) {
    const m = offset(pose.rhand, .015, .025, .055);
    bone(offset(m, 0, 0, -.055), offset(m, 0, 0, .07), .073 * pose.mug, .08 * pose.mug, C.mug);
    oval(offset(m, 0, 0, .07), .055 * pose.mug, .055 * pose.mug, .015, C.tea);
    bone(offset(m, .065, 0, .025), offset(m, .105, 0, .025), .025, .025, C.mug);
    if (!options.reducedMotion) {
      const steam = (finite(options.time) * .35) % 1;
      if (steam < .7) ball(offset(m, -.025 * Math.sin(steam * 8), 0, .18 + steam * .18), .015, C.mug);
    }
  }
  bone(offset(pose.lantern, 0, 0, -.07), offset(pose.lantern, 0, 0, .1), .065, .065, C.lantern);
  ball(offset(pose.lantern, 0, -.025, .035), options.night ? .061 : .045, C.flame);
  bone(offset(pose.lantern, -.05, 0, .1), offset(pose.lantern, 0, 0, .17), .014, .014, C.lantern);
  bone(offset(pose.lantern, .05, 0, .1), offset(pose.lantern, 0, 0, .17), .014, .014, C.lantern);
}
