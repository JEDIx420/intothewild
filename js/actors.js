/*
 * Into the Wild — small, articulated inhabitants.
 * Geometry is drawn into the shared software rasteriser. No image assets,
 * animation timers, retained geometry, or external dependencies are used here.
 */

const TAU = Math.PI * 2;
const C = {
  coat: [172, 91, 49], coatLight: [199, 117, 61], coatDark: [123, 65, 43],
  trousers: [70, 75, 68], boot: [62, 48, 39], bootSole: [41, 37, 33],
  skin: [218, 175, 134], skinShade: [183, 133, 99], hair: [66, 47, 37],
  hat: [182, 153, 101], hatRim: [212, 181, 123], hatBand: [96, 78, 49],
  pack: [94, 105, 74], packLight: [125, 137, 93], leather: [98, 71, 46],
  bedroll: [126, 147, 138], bedrollLight: [173, 185, 157],
  staff: [113, 85, 56], mug: [219, 218, 187], tea: [102, 70, 42],
  bread: [231, 190, 121], cloth: [168, 149, 111],
  lantern: [107, 86, 49], flame: [255, 220, 139],
  fox: [183, 100, 52], foxLight: [212, 132, 68], foxDark: [111, 65, 43],
  cream: [225, 213, 179], dark: [43, 44, 40],
  deer: [146, 117, 77], deerLight: [182, 151, 103], hoof: [65, 60, 49],
  antler: [205, 193, 155], stag: [153, 171, 146], stagLight: [201, 215, 181],
  antlerGlow: [220, 247, 202], antlerTip: [244, 252, 211],
  rabbit: [148, 143, 122], rabbitLight: [197, 190, 163], ear: [186, 152, 130],
  bird: [79, 109, 115], birdChest: [199, 150, 105], birdWing: [62, 86, 94],
  spirit: [184, 221, 169], spiritLight: [224, 244, 193], spiritLeaf: [121, 166, 137],
};

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function localFrame(x, y, z, yaw, scale = 1) {
  const fx = Math.cos(yaw), fy = Math.sin(yaw), sx = -fy, sy = fx;
  return (forward, side, up) => [
    x + (fx * forward + sx * side) * scale,
    y + (fy * forward + sy * side) * scale,
    z + up * scale,
  ];
}

function ball(r, p, radius, color, mode = 'solid') {
  r.sphere(p[0], p[1], p[2], radius, color, mode);
}

function oval(r, p, rx, ry, rz, color, mode = 'solid') {
  r.ellipsoid(p[0], p[1], p[2], rx, ry, rz, color, mode);
}

function bone(r, a, b, radius, endRadius, color, mode = 'solid') {
  r.capsule(a, b, radius, endRadius, color, mode);
}

export { drawTraveller } from './traveller.js?v=10';

function walkingLegs(r, P, scale, motion, hips, width, height, color, lower, hoof, stride) {
  const moving = Math.min(1, motion.speed / .55);
  for (const forward of hips) for (const side of [-width, width]) {
    // Opposite diagonal feet move together in a gentle trot. During the stance
    // half the foot moves back relative to the body, then lifts on its return.
    const phase = motion.gait + ((forward > 0) === (side > 0) ? Math.PI : 0);
    const swing = Math.sin(phase) * stride * moving;
    const scratch = motion.activity === 'scratch' && forward < 0 && side < 0
      ? motion.alert * (.4 + Math.sin(motion.reactionProgress * 52) * .16) : 0;
    const lift = Math.max(0, Math.cos(phase)) * height * .2 * moving + scratch;
    const foot = forward + swing;
    const knee = forward + swing * .48 + (forward > 0 ? -.045 : .06);
    bone(r, P(forward, side, height), P(knee, side, height * .51 + lift * .4), .073 * scale, .047 * scale, color);
    bone(r, P(knee, side, height * .51 + lift * .4), P(foot, side, .065 + lift), .043 * scale, .028 * scale, lower);
    bone(r, P(foot, side, .065 + lift), P(foot + .09, side, .04 + lift), .052 * scale, .042 * scale, hoof);
  }
}

function deer(r, P, scale, t, seed, magical, resting, motion) {
  const body = magical ? C.stag : C.deer;
  const light = magical ? C.stagLight : C.deerLight;
  const graze = motion.graze * (magical ? .25 : 1);
  const up = graze < .5;
  const breath = Math.sin(t * 1.7 + seed) * .012;
  walkingLegs(r, P, scale, motion, [-.43, .42], .16, .91, body, body, C.hoof, .28);
  bone(r, P(-.4, 0, 1.02 + breath), P(.34, 0, 1.07 + breath), .265 * scale, .29 * scale, body);
  bone(r, P(-.25, -.1, .96), P(.33, -.1, .99), .19 * scale, .2 * scale, light);
  const headA = .64 + .4 * graze;
  const headZ = 1.69 - 1.21 * graze + Math.sin(t * .8 + seed) * .025 * (1 - graze);
  bone(r, P(.4, 0, 1.11), P(headA - .07, 0, headZ - .14), .18 * scale, .12 * scale, body);
  bone(r, P(headA - .09, 0, headZ), P(headA + .22, 0, headZ - .075), .14 * scale, .08 * scale, light);
  ball(r, P(headA + .245, 0, headZ - .075), .05 * scale, C.dark);
  for (const side of [-1, 1]) {
    bone(r, P(headA - .08, side * .095, headZ + .08), P(headA - .17, side * .25, headZ + .29), .07 * scale, .024 * scale, body);
    ball(r, P(headA + .015, side * .125, headZ + .025), .028 * scale, C.dark);
  }
  const tail = Math.sin(t * 2.2 + seed) * .1;
  bone(r, P(-.62, 0, 1.03), P(-.83, tail, 1.09), .075 * scale, .025 * scale, C.cream);
  if (magical) {
    const antler = C.antlerGlow;
    for (const side of [-1, 1]) {
      const base = P(headA - .13, side * .08, headZ + .12);
      const mid = P(headA - .25, side * .25, headZ + .52);
      const tip = P(headA - .39, side * .41, headZ + .81);
      bone(r, base, mid, .035 * scale, .027 * scale, antler);
      bone(r, mid, tip, .027 * scale, .012 * scale, antler);
      bone(r, P(headA - .2, side * .19, headZ + .38), P(headA + .06, side * .31, headZ + .6), .022 * scale, .009 * scale, C.antlerTip);
      bone(r, P(headA - .31, side * .33, headZ + .65), P(headA - .03, side * .43, headZ + .82), .019 * scale, .008 * scale, C.antlerTip);
      ball(r, tip, .035 * scale, C.antlerTip);
    }
    for (let n = 0; n < 3; n++) {
      const phase = t * .65 + n * TAU / 3 + seed;
      const mote = P(Math.cos(phase) * .55, Math.sin(phase) * .65, 1.5 + Math.sin(phase * 1.3) * .5);
      r.plot(mote[0], mote[1], mote[2], C.antlerTip);
    }
  } else if ((seed & 3) === 0 && up) {
    for (const side of [-1, 1]) {
      bone(r, P(headA - .13, side * .075, headZ + .13), P(headA - .25, side * .17, headZ + .43), .027 * scale, .012 * scale, C.antler);
      bone(r, P(headA - .19, side * .12, headZ + .29), P(headA + .025, side * .19, headZ + .42), .018 * scale, .009 * scale, C.antler);
    }
  }
}

function fox(r, P, scale, t, seed, resting, motion) {
  const breathe = Math.sin(t * 2.3 + seed) * .009;
  walkingLegs(r, P, scale, motion, [-.34, .35], .13, .48, C.fox, C.foxDark, C.dark, .2);
  bone(r, P(-.35, 0, .52 + breathe), P(.3, 0, .53 + breathe), .2 * scale, .215 * scale, C.fox);
  bone(r, P(.22, 0, .46), P(.46, 0, .66), .16 * scale, .13 * scale, C.cream);
  const turn = Math.sin(t * .9 + seed) * (motion.speed < .08 ? .13 : .025);
  const dip = motion.graze * .28;
  ball(r, P(.46, turn, .73 - dip), .18 * scale, C.foxLight);
  bone(r, P(.49, turn, .72 - dip), P(.82, turn, .6 - dip), .115 * scale, .035 * scale, C.foxLight);
  ball(r, P(.83, turn, .605 - dip), .039 * scale, C.dark);
  bone(r, P(.58, turn, .63 - dip), P(.78, turn, .575 - dip), .07 * scale, .025 * scale, C.cream);
  for (const side of [-1, 1]) {
    bone(r, P(.41, side * .11 + turn, .82 - dip), P(.36, side * .16 + turn, 1.05 - dip), .075 * scale, .012 * scale, C.foxDark);
    bone(r, P(.43, side * .115 + turn, .84 - dip), P(.38, side * .15 + turn, 1.01 - dip), .047 * scale, .009 * scale, C.foxLight);
    ball(r, P(.565, side * .145 + turn, .765 - dip), .025 * scale, C.dark);
  }
  const sway = Math.sin(t * (motion.speed > .1 ? 2.2 : 1.1) + seed) * .22;
  bone(r, P(-.45, 0, .55), P(-.87, sway, .41), .13 * scale, .17 * scale, C.fox);
  bone(r, P(-.87, sway, .41), P(-1.13, sway * 1.4, .49), .17 * scale, .08 * scale, C.foxLight);
  bone(r, P(-1.11, sway * 1.4, .49), P(-1.32, sway * 1.6, .56), .085 * scale, .014 * scale, C.cream);
}

function rabbit(r, P, scale, t, seed, motion) {
  if (motion.rear > 0) {
    const ground = P, up = motion.rear;
    P = (f, s, z) => ground(f - up * z * .38, s, z + up * Math.max(0, f + .2) * .5);
  }
  const sniff = Math.sin(t * 5 + seed) * .013;
  const tuck = Math.min(1, motion.hop / .24);
  bone(r, P(-.15, 0, .25), P(.13, 0, .31), .225 * scale, .18 * scale, C.rabbit);
  for (const side of [-1, 1]) {
    ball(r, P(-.15, side * .16, .17), .15 * scale, C.rabbit);
    bone(r, P(-.1 - tuck * .13, side * .18, .065 + tuck * .05), P(.1 - tuck * .16, side * .18, .055 + tuck * .04), .065 * scale, .05 * scale, C.rabbitLight);
    bone(r, P(.24, side * .1, .22), P(.27 + tuck * .09, side * .1, .05 + tuck * .08), .055 * scale, .035 * scale, C.rabbitLight);
  }
  ball(r, P(.28 + sniff, 0, .42), .16 * scale, C.rabbitLight);
  ball(r, P(.43 + sniff, 0, .39), .025 * scale, C.ear);
  for (const side of [-1, 1]) {
    const twitch = Math.pow(Math.max(0, Math.sin(t * .7 + seed + side)), 8) * .15 - tuck * .25;
    bone(r, P(.23, side * .065, .5), P(.13 + twitch, side * .1, .91), .052 * scale, .022 * scale, C.rabbit);
    bone(r, P(.24, side * .068, .56), P(.145 + twitch, side * .1, .86), .021 * scale, .011 * scale, C.ear);
    ball(r, P(.34 + sniff, side * .125, .47), .025 * scale, C.dark);
  }
  ball(r, P(-.36, 0, .29), .085 * scale, C.cream);
}

function bird(r, P, scale, t, seed, motion) {
  const flying = motion.hop > .03;
  const twitch = flying ? .27 + Math.sin(t * 24 + seed) * .24 : Math.max(0, Math.sin(t * .9 + seed) - .93) * 3;
  const peck = motion.graze * Math.pow(Math.max(0, Math.sin(t * 7 + seed)), 2) * .15;
  bone(r, P(-.09, 0, .22), P(.1, 0, .31), .13 * scale, .115 * scale, C.bird);
  ball(r, P(.17, 0, .4 - peck), .105 * scale, C.bird);
  ball(r, P(.14, -.065, .29), .085 * scale, C.birdChest);
  bone(r, P(.24, 0, .4 - peck), P(.35, 0, .39 - peck), .032 * scale, .009 * scale, C.hatRim);
  for (const side of [-1, 1]) {
    bone(r, P(0, side * .09, .29), P(-.1, side * (flying ? .42 : .13 + twitch), .25 + twitch), .065 * scale, .023 * scale, C.birdWing);
    bone(r, P(0, side * .055, .12), P(.04, side * .065, .025), .016 * scale, .012 * scale, C.dark);
    ball(r, P(.205, side * .08, .43 - peck), .018 * scale, C.dark);
  }
  bone(r, P(-.17, 0, .21), P(-.4, 0, .28), .058 * scale, .014 * scale, C.birdWing);
}

function spirit(r, P, scale, t, seed) {
  const hover = 1.05 + Math.sin(t * 1.7 + seed) * .16;
  ball(r, P(0, 0, hover), .2 * scale, C.spirit);
  ball(r, P(.065, -.065, hover + .025), .13 * scale, C.spiritLight);
  for (const side of [-1, 1]) {
    bone(r, P(-.025, side * .1, hover + .11), P(-.1, side * .24, hover + .4), .07 * scale, .009 * scale, C.spiritLeaf);
    ball(r, P(.16, side * .075, hover + .035), .023 * scale, C.dark);
  }
  for (let n = 0; n < 4; n++) {
    const phase = t * .8 + seed + n * TAU / 4;
    const mote = P(Math.cos(phase) * .36, Math.sin(phase) * .36, hover + Math.sin(phase * 2) * .18);
    r.plot(mote[0], mote[1], mote[2], C.spiritLight);
  }
}

// The new inhabitants deliberately have different proportions and outlines:
// long horse necks, low badger bodies, tufted lynx ears, a crocodile's broad
// snout, and large bird wings remain readable at the traveller's small scale.
function horse(r, P, scale, t, seed, motion, unicorn = false) {
  const coats = [[129, 83, 54], [171, 142, 103], [95, 91, 81], [209, 205, 181]];
  const coat = unicorn ? [217, 225, 210] : coats[seed % coats.length];
  const mane = unicorn ? [156, 183, 190] : seed % 4 === 3 ? [126, 126, 111] : [56, 47, 40];
  const rear = motion.rear, angle = rear * .65;
  const R = (f, s, z) => P(-.63 + (f + .63) * Math.cos(angle) - z * Math.sin(angle), s,
    (f + .63) * Math.sin(angle) + z * Math.cos(angle));
  walkingLegs(r, R, scale, motion, [-.59, .53], .235, 1.12, coat, mane, unicorn ? [132, 156, 157] : C.hoof, .36);
  bone(r, R(-.55, 0, 1.24), R(.43, 0, 1.29), .37 * scale, .37 * scale, coat);
  const dip = motion.graze * (unicorn ? .7 : 1) - (motion.activity === 'call' ? motion.alert * .09 : 0);
  bone(r, R(.42, 0, 1.35), R(.69 + dip * .45, 0, 1.98 - dip * 1.25), .28 * scale, .19 * scale, coat);
  bone(r, R(.7 + dip * .45, 0, 2.02 - dip * 1.25), R(1.02 + dip * .45, 0, 1.72 - dip * 1.25), .19 * scale, .13 * scale, coat);
  ball(r, R(1.02 + dip * .45, 0, 1.73 - dip * 1.25), .13 * scale, unicorn ? [166, 183, 175] : [81, 71, 63]);
  bone(r, R(.82 + dip * .45, -.04, 1.99 - dip * 1.25), R(.99 + dip * .45, -.04, 1.79 - dip * 1.25), .055 * scale, .035 * scale, C.cream);
  for (const side of [-1, 1]) {
    bone(r, R(.6 + dip * .45, side * .12, 2.12 - dip * 1.25), R(.57 + dip * .45, side * .16, 2.38 - dip * 1.25), .065 * scale, .022 * scale, coat);
    ball(r, R(.8 + dip * .45, side * .16, 1.99 - dip * 1.25), .028 * scale, C.dark);
  }
  for (let k = 0; k < 5; k++) {
    const z = 1.43 + k * .13, f = .34 + k * .055 + dip * .35;
    bone(r, R(f, .015, z - dip * (k / 5)), R(f - .13, .04, z - .18 - dip * (k / 5)), .08 * scale, .025 * scale, mane);
  }
  const swish = Math.sin(t * 1.7 + seed) * .23;
  bone(r, R(-.83, 0, 1.33), R(-1.1, swish, .92), .13 * scale, .14 * scale, mane);
  bone(r, R(-1.1, swish, .92), R(-1.18, swish * 1.4, .41), .14 * scale, .045 * scale, mane);
  if (unicorn) {
    // One slim, gently lit horn makes the small silhouette readable. The rest
    // remains a quiet animal, with occasional glints rather than a light cloud.
    const horn = [231, 237, 194], tip = [247, 247, 212];
    const base = R(.79 + dip * .45, 0, 2.08 - dip * 1.25);
    const middle = R(.87 + dip * .58, 0, 2.45 - dip * 1.42);
    const point = R(.95 + dip * .72, 0, 2.82 - dip * 1.6);
    bone(r, base, middle, .055 * scale, .032 * scale, horn, 'glow');
    bone(r, middle, point, .032 * scale, .006 * scale, tip, 'glow');
    for (let k = 0; k < 3; k++) {
      const phase = t * .9 + seed * .013 + k * 2.3;
      if (Math.sin(phase) < .72) continue;
      const glint = k === 0 ? R(.3 + Math.sin(phase) * .1, -.15, 1.64)
        : R(k === 1 ? -.58 : .52, k === 1 ? -.31 : .31, .12 + Math.sin(phase * 1.3) * .035);
      r.plot(...glint, [219, 236, 207]);
      if (Math.sin(phase) > .94) r.plot(glint[0], glint[1], glint[2] + .08, tip);
    }
  }
}

function wolf(r, P, scale, t, seed, motion) {
  const fur = [125, 132, 120], back = [84, 93, 85], chest = [183, 182, 155];
  walkingLegs(r, P, scale, motion, [-.43, .43], .17, .64, fur, back, C.dark, .27);
  bone(r, P(-.47, 0, .73), P(.37, 0, .78), .25 * scale, .29 * scale, fur);
  bone(r, P(-.4, .025, .88), P(.28, .025, .95), .17 * scale, .2 * scale, back, 'rough');
  bone(r, P(.24, 0, .76), P(.5, 0, 1.02), .24 * scale, .19 * scale, chest);
  const call = motion.activity === 'call' ? motion.alert * .3 : 0, dip = motion.graze * .35;
  ball(r, P(.54, 0, 1.06 - dip + call), .2 * scale, fur);
  bone(r, P(.59, 0, 1.05 - dip + call), P(.94, 0, .94 - dip + call * 1.6), .13 * scale, .06 * scale, fur);
  ball(r, P(.95, 0, .94 - dip + call * 1.6), .05 * scale, C.dark);
  for (const side of [-1, 1]) {
    bone(r, P(.48, side * .12, 1.17 - dip + call), P(.43, side * .17, 1.42 - dip + call), .075 * scale, .013 * scale, back);
    ball(r, P(.65, side * .145, 1.11 - dip + call), .027 * scale, [222, 190, 105]);
  }
  const sway = Math.sin(t * 1.3 + seed) * .17;
  bone(r, P(-.64, 0, .75), P(-1.01, sway, .43), .14 * scale, .19 * scale, fur);
  bone(r, P(-1.01, sway, .43), P(-1.28, sway * 1.2, .3), .19 * scale, .04 * scale, back);
}

function bear(r, P, scale, t, seed, motion) {
  const fur = [104, 79, 57], light = [143, 111, 76], muzzle = [174, 147, 103];
  const R = (f, s, z) => P(f - motion.rear * z * .4, s, z + motion.rear * Math.max(0, f + .6) * .85);
  for (const front of [-.52, .5]) for (const side of [-.28, .28]) {
    const phase = motion.gait + (front * side > 0 ? Math.PI : 0), moving = Math.min(1, motion.speed / .5);
    const swing = Math.sin(phase) * .24 * moving, lift = Math.max(0, Math.cos(phase)) * .1 * moving;
    const scratch = motion.activity === 'scratch' && front < 0 && side < 0 ? motion.alert * (.35 + Math.sin(t * 14) * .12) : 0;
    bone(r, R(front, side, .78), R(front + swing * .5, side, .4 + scratch), .17 * scale, .13 * scale, fur);
    bone(r, R(front + swing * .5, side, .4 + scratch), R(front + swing, side, .11 + lift + scratch), .13 * scale, .105 * scale, fur);
    bone(r, R(front + swing - .06, side, .09 + lift + scratch), R(front + swing + .15, side, .07 + lift + scratch), .115 * scale, .09 * scale, [65, 55, 45]);
  }
  bone(r, R(-.52, 0, .95), R(.44, 0, 1.12), .45 * scale, .48 * scale, fur, 'rough');
  ball(r, R(.32, 0, 1.32), .34 * scale, light, 'rough');
  const dip = motion.graze * .3;
  ball(r, R(.72, 0, 1.12 - dip), .31 * scale, fur);
  bone(r, R(.78, 0, 1.04 - dip), R(1.06, 0, 1.01 - dip), .2 * scale, .14 * scale, muzzle);
  ball(r, R(1.15, 0, 1.03 - dip), .08 * scale, C.dark);
  for (const side of [-1, 1]) {
    ball(r, R(.62, side * .24, 1.36 - dip), .105 * scale, fur);
    ball(r, R(.64, side * .24, 1.38 - dip), .06 * scale, [67, 53, 43]);
    ball(r, R(.91, side * .2, 1.18 - dip), .031 * scale, C.dark);
  }
  ball(r, R(-.9, 0, .94), .1 * scale, fur);
}

function boar(r, P, scale, t, seed, motion) {
  const fur = [111, 100, 80], crest = [72, 67, 54];
  walkingLegs(r, P, scale, motion, [-.4, .36], .2, .46, fur, crest, C.dark, .2);
  bone(r, P(-.45, 0, .62), P(.27, 0, .73), .31 * scale, .36 * scale, fur, 'rough');
  const dip = motion.graze * .22;
  bone(r, P(.34, 0, .65 - dip), P(.8, 0, .42 - dip), .24 * scale, .12 * scale, fur);
  oval(r, P(.83, 0, .42 - dip), .1 * scale, .13 * scale, .1 * scale, [151, 126, 97]);
  for (const side of [-1, 1]) {
    bone(r, P(.36, side * .15, .78 - dip), P(.2, side * .24, 1.02 - dip), .09 * scale, .03 * scale, crest);
    ball(r, P(.53, side * .17, .64 - dip), .027 * scale, C.dark);
    bone(r, P(.65, side * .12, .39 - dip), P(.77, side * .2, .53 - dip), .035 * scale, .01 * scale, C.cream);
  }
  for (let n = 0; n < 7; n++) bone(r, P(-.45 + n * .12, 0, .87 + n * .01), P(-.49 + n * .12, 0, 1.02 + n * .01), .035 * scale, .008 * scale, crest);
  const curl = Math.sin(t * 2 + seed) * .08;
  bone(r, P(-.73, 0, .64), P(-.92, curl, .74), .035 * scale, .02 * scale, crest);
  bone(r, P(-.92, curl, .74), P(-.92, curl + .06, .84), .02 * scale, .01 * scale, crest);
}

function badger(r, P, scale, t, seed, motion) {
  const fur = [133, 136, 122], dark = [50, 55, 48];
  walkingLegs(r, P, scale, motion, [-.29, .29], .18, .27, dark, dark, dark, .14);
  bone(r, P(-.34, 0, .37), P(.22, 0, .4), .24 * scale, .22 * scale, fur, 'rough');
  const dip = motion.graze * .13;
  bone(r, P(.27, 0, .38 - dip), P(.67, 0, .21 - dip), .17 * scale, .055 * scale, C.cream);
  for (const side of [-1, 1]) {
    bone(r, P(.3, side * .11, .48 - dip), P(.6, side * .05, .29 - dip), .066 * scale, .027 * scale, dark);
    ball(r, P(.3, side * .13, .53 - dip), .055 * scale, C.cream);
    ball(r, P(.49, side * .095, .36 - dip), .025 * scale, C.dark);
  }
  ball(r, P(.7, 0, .21 - dip), .037 * scale, dark);
  bone(r, P(-.52, 0, .38), P(-.78, .05, .3), .075 * scale, .035 * scale, fur);
}

function squirrel(r, P, scale, t, seed, motion) {
  const fur = [162, 94, 52], light = [207, 159, 101], stand = motion.rear || (motion.speed < .05 ? .35 : 0);
  const nibble = motion.activity === 'nibble' ? .065 + Math.sin(t * 9) * .012 : 0;
  bone(r, P(-.15, 0, .24), P(.13 - stand * .13, 0, .33 + stand * .28), .15 * scale, .12 * scale, fur);
  for (const side of [-1, 1]) {
    bone(r, P(-.12, side * .11, .2), P(.03, side * .13, .045), .067 * scale, .03 * scale, fur);
    bone(r, P(.13, side * .09, .31 + stand * .12), P(.3 - stand * .13, side * .07, .065 + stand * .42 + nibble), .035 * scale, .02 * scale, light);
  }
  ball(r, P(.25 - stand * .16, 0, .44 + stand * .27), .14 * scale, fur);
  ball(r, P(.38 - stand * .16, 0, .43 + stand * .27), .04 * scale, light);
  for (const side of [-1, 1]) {
    bone(r, P(.21 - stand * .16, side * .08, .53 + stand * .27), P(.17 - stand * .16, side * .1, .68 + stand * .27), .036 * scale, .008 * scale, fur);
    ball(r, P(.31 - stand * .16, side * .1, .48 + stand * .27), .023 * scale, C.dark);
  }
  const swish = Math.sin(t * 1.4 + seed) * .1;
  bone(r, P(-.27, 0, .26), P(-.56, swish, .57), .1 * scale, .18 * scale, fur);
  bone(r, P(-.56, swish, .57), P(-.6, swish * 1.3, 1.01), .18 * scale, .15 * scale, light, 'rough');
  bone(r, P(-.6, swish * 1.3, 1.01), P(-.35, swish, 1.1), .15 * scale, .05 * scale, fur);
  if (motion.activity === 'nibble') ball(r, P(.18, 0, .43), .055 * scale, [108, 79, 48]);
}

function goat(r, P, scale, t, seed, motion) {
  const fur = [155, 143, 117], light = [194, 184, 152], horn = [83, 78, 65];
  const R = (f, s, z) => P(f - motion.rear * z * .23, s, z + motion.rear * Math.max(0, f + .4) * .4);
  walkingLegs(r, R, scale, motion, [-.37, .37], .16, .68, fur, horn, C.hoof, .23);
  bone(r, R(-.4, 0, .81), R(.3, 0, .88), .26 * scale, .28 * scale, fur);
  const dip = motion.graze * .7;
  bone(r, R(.3, 0, .88), R(.52 + dip * .2, 0, 1.28 - dip), .19 * scale, .13 * scale, fur);
  bone(r, R(.53 + dip * .2, 0, 1.34 - dip), R(.78 + dip * .2, 0, 1.15 - dip), .14 * scale, .08 * scale, light);
  bone(r, R(.66 + dip * .2, 0, 1.12 - dip), R(.57 + dip * .2, 0, .85 - dip), .07 * scale, .008 * scale, horn);
  for (const side of [-1, 1]) {
    ball(r, R(.64 + dip * .2, side * .115, 1.3 - dip), .024 * scale, C.dark);
    bone(r, R(.45, side * .09, 1.41 - dip), R(.34, side * .14, 1.8 - dip), .066 * scale, .045 * scale, horn);
    bone(r, R(.34, side * .14, 1.8 - dip), R(-.02, side * .16, 1.93 - dip), .045 * scale, .025 * scale, horn);
    bone(r, R(-.02, side * .16, 1.93 - dip), R(-.19, side * .17, 1.68 - dip), .025 * scale, .008 * scale, horn);
    bone(r, R(.44, side * .1, 1.31 - dip), R(.32, side * .32, 1.4 - dip), .064 * scale, .019 * scale, light);
  }
  bone(r, R(-.62, 0, .88), R(-.76, Math.sin(t + seed) * .06, 1.05), .075 * scale, .025 * scale, light);
}

function lynx(r, P, scale, t, seed, motion) {
  if (motion.activity === 'stretch') {
    const ground = P, stretch = motion.graze;
    P = (f, s, z) => ground(f * (1 + stretch * .25), s, z * (1 - stretch * Math.max(0, f) * .5));
  }
  const fur = [162, 139, 99], light = [213, 197, 153], mark = [93, 83, 63];
  walkingLegs(r, P, scale, motion, [-.36, .34], .19, .67, fur, fur, light, .24);
  bone(r, P(-.41, 0, .79), P(.31, 0, .83), .24 * scale, .27 * scale, fur);
  const dip = motion.graze * .31;
  ball(r, P(.48, 0, 1.02 - dip), .22 * scale, fur);
  for (const side of [-1, 1]) {
    bone(r, P(.45, side * .13, 1.13 - dip), P(.38, side * .19, 1.36 - dip), .075 * scale, .017 * scale, fur);
    bone(r, P(.38, side * .19, 1.36 - dip), P(.34, side * .2, 1.49 - dip), .018 * scale, .006 * scale, C.dark);
    bone(r, P(.51, side * .13, .96 - dip), P(.4, side * .26, .88 - dip), .085 * scale, .018 * scale, light);
    ball(r, P(.62, side * .13, 1.05 - dip), .028 * scale, [198, 194, 97]);
  }
  ball(r, P(.68, 0, .98 - dip), .045 * scale, C.dark);
  bone(r, P(-.61, 0, .79), P(-.79, .05, .84), .085 * scale, .055 * scale, C.dark);
  for (let k = 0; k < 10; k++) ball(r, P(-.38 + (k % 5) * .15, (k < 5 ? -.2 : .2), .81 + (k % 2) * .08), .038 * scale, mark);
}

function largeBird(r, P, scale, t, seed, motion, owl) {
  const fur = owl ? [146, 128, 95] : [109, 86, 60], light = owl ? [218, 203, 160] : [177, 144, 89];
  const flying = motion.hop > .2 || ['fly', 'rise'].includes(motion.activity);
  bone(r, P(-.15, 0, .35), P(.08, 0, .55), .22 * scale, .18 * scale, fur);
  const ruffle = motion.activity === 'ruffle' ? motion.alert : 0;
  const wing = flying ? (owl ? 1.04 : 1.45) : .25 + ruffle * .23;
  const flap = flying ? Math.sin(t * (owl ? 7 : 4) + seed) * .22 : Math.sin(t * 17) * ruffle * .17;
  for (const side of [-1, 1]) {
    bone(r, P(-.03, side * .16, .49), P(-.16, side * wing * .62, .4 + flap), .12 * scale, .12 * scale, fur);
    bone(r, P(-.16, side * wing * .62, .4 + flap), P(-.34, side * wing, .35 + flap * 1.7), .12 * scale, .025 * scale, fur);
    if (flying) for (let k = 0; k < 3; k++) bone(r, P(-.26 - k * .07, side * wing * .8, .38 + flap * 1.5), P(-.47 - k * .08, side * (wing + .08 - k * .08), .33 + flap * 1.8), .04 * scale, .012 * scale, light);
    bone(r, P(0, side * .1, .25), P(.1, side * .12, flying ? .21 : .035), .025 * scale, .019 * scale, [174, 140, 75]);
  }
  if (owl) {
    ball(r, P(.12, 0, .77), .25 * scale, fur);
    for (const side of [-1, 1]) {
      ball(r, P(.29, side * .115, .79), .12 * scale, light);
      ball(r, P(.34, side * .115, .8), .05 * scale, [231, 187, 76]);
      ball(r, P(.365, side * .115, .8), .024 * scale, C.dark);
    }
    bone(r, P(.32, 0, .75), P(.39, 0, .69), .035 * scale, .009 * scale, C.hatRim);
  } else {
    ball(r, P(.25, 0, .66), .15 * scale, light);
    bone(r, P(.35, 0, .65), P(.49, 0, .6), .055 * scale, .025 * scale, [202, 169, 81]);
    bone(r, P(.49, 0, .6), P(.47, 0, .54), .025 * scale, .008 * scale, [202, 169, 81]);
    for (const side of [-1, 1]) ball(r, P(.33, side * .1, .7), .026 * scale, C.dark);
  }
  for (const side of [-1, 0, 1]) bone(r, P(-.26, side * .05, .29), P(-.62, side * .11, .26), .065 * scale, .029 * scale, fur);
}

function otter(r, P, scale, t, seed, motion) {
  const fur = [115, 91, 65], light = [185, 164, 120];
  const dip = motion.dive * .58 - (motion.activity === 'listen' ? motion.alert * .13 : 0);
  bone(r, P(-.42, 0, .17 - dip), P(.28, 0, .2 - dip), .17 * scale, .2 * scale, fur);
  ball(r, P(.43, 0, .33 - dip), .19 * scale, fur);
  ball(r, P(.57, 0, .28 - dip), .11 * scale, light);
  ball(r, P(.66, 0, .31 - dip), .04 * scale, C.dark);
  for (const side of [-1, 1]) {
    ball(r, P(.39, side * .15, .46 - dip), .052 * scale, fur);
    ball(r, P(.54, side * .125, .38 - dip), .024 * scale, C.dark);
    for (const front of [-.32, .23]) bone(r, P(front, side * .12, .12 - dip), P(front - .1, side * .27, .03 - dip), .058 * scale, .026 * scale, fur);
    for (let k = 0; k < 2; k++) bone(r, P(.58, side * .09, .28 - dip), P(.55 + k * .08, side * .27, .28 - dip), .008 * scale, .004 * scale, C.cream);
  }
  const swish = Math.sin(t * 3 + seed) * (.16 + motion.splash * .2);
  bone(r, P(-.54, 0, .16 - dip), P(-.89, swish, .07 - dip), .13 * scale, .06 * scale, fur);
  bone(r, P(-.89, swish, .07 - dip), P(-1.15, swish * 1.6, .025 - dip), .06 * scale, .015 * scale, fur);
}

function duck(r, P, scale, t, seed, motion) {
  const male = seed % 3 !== 0, body = male ? [175, 178, 161] : [155, 132, 92];
  const green = male ? [53, 105, 79] : [139, 120, 84], dip = motion.dive;
  bone(r, P(-.26, 0, .22 + dip * .09), P(.12, 0, .24 - dip * .08), .2 * scale, .22 * scale, body);
  bone(r, P(.14, 0, .25 - dip * .12), P(.28, 0, .5 - dip * .4), .1 * scale, .08 * scale, male ? [122, 86, 65] : body);
  ball(r, P(.29, 0, .55 - dip * .4), .13 * scale, green);
  bone(r, P(.37, 0, .52 - dip * .4), P(.55, 0, .5 - dip * .4), .06 * scale, .04 * scale, [207, 175, 83]);
  for (const side of [-1, 1]) {
    ball(r, P(.35, side * .09, .59 - dip * .4), .021 * scale, C.dark);
    const flap = motion.splash * Math.sin(t * 13) * .3;
    bone(r, P(-.06, side * .14, .31), P(-.27, side * (.22 + motion.splash * .24), .25 + flap), .085 * scale, .025 * scale, [104, 115, 105]);
  }
  bone(r, P(-.4, 0, .26), P(-.59, 0, .37 + dip * .35), .07 * scale, .02 * scale, male ? C.dark : body);
}

function heron(r, P, scale, t, seed, motion) {
  const fur = [151, 164, 156], dark = [74, 91, 89], light = [219, 221, 196];
  const flying = motion.hop > .15;
  for (const side of [-1, 1]) {
    const step = Math.sin(motion.gait + (side > 0 ? Math.PI : 0)) * Math.min(.2, motion.speed * .3);
    bone(r, P(-.03, side * .075, .91), P(.06 + step, side * .08, .46), .025 * scale, .018 * scale, [139, 124, 84]);
    bone(r, P(.06 + step, side * .08, .46), P(flying ? -.42 : step, side * .08, flying ? .5 : .025), .018 * scale, .012 * scale, [139, 124, 84]);
  }
  bone(r, P(-.24, 0, 1.04), P(.18, 0, 1.12), .19 * scale, .18 * scale, fur);
  const dip = motion.graze;
  bone(r, P(.2, 0, 1.15), P(.33 + dip * .24, 0, 1.48 - dip * .65), .087 * scale, .072 * scale, light);
  bone(r, P(.33 + dip * .24, 0, 1.48 - dip * .65), P(.15 + dip * .55, 0, 1.74 - dip * .94), .072 * scale, .06 * scale, light);
  ball(r, P(.28 + dip * .55, 0, 1.79 - dip * .94), .11 * scale, light);
  bone(r, P(.36 + dip * .55, 0, 1.77 - dip * .94), P(.73 + dip * .6, 0, 1.71 - dip * 1.04), .045 * scale, .007 * scale, [186, 158, 83]);
  for (const side of [-1, 1]) {
    ball(r, P(.34 + dip * .55, side * .075, 1.82 - dip * .94), .021 * scale, [206, 184, 89]);
    bone(r, P(.21 + dip * .55, side * .07, 1.83 - dip * .94), P(-.06 + dip * .55, side * .09, 1.75 - dip * .94), .025 * scale, .006 * scale, dark);
    const flap = flying ? Math.sin(t * 5) * .24 : 0;
    bone(r, P(-.07, side * .13, 1.13), P(-.35, side * (flying ? 1.17 : .22), 1.06 + flap), .12 * scale, .03 * scale, fur);
  }
}

function crocodile(r, P, scale, t, seed, motion) {
  const back = [99, 126, 80], light = [162, 161, 99], dark = [55, 81, 54];
  if (motion.graze > 0) {
    const frame = P;
    P = (f, side, up) => frame(f, side, up + Math.max(0, Math.min(1, (f - .4) / 1.1)) * motion.graze * .17);
  }
  const sway = Math.sin(t * (motion.speed > .1 ? 3.1 : .6) + seed) * (.1 + motion.splash * .4);
  if (motion.swimming) {
    // Ripples around the ridged back make a submerged crocodile readable at
    // small scale, without turning it into a hovering land animal.
    const ripples = [151, 202, 189];
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5 + t * .15;
      r.plot(...P(Math.cos(a) * 1.9, Math.sin(a) * .67, .055), ripples);
    }
  }
  bone(r, P(-.6, 0, .24), P(.38, 0, .29), .34 * scale, .37 * scale, back, 'rough');
  bone(r, P(-.52, 0, .43), P(.31, 0, .47), .20 * scale, .19 * scale, light);
  for (const front of [-.5, .35]) for (const side of [-1, 1]) {
    const step = Math.sin(motion.gait + (front * side > 0 ? Math.PI : 0)) * Math.min(.15, motion.speed * .2);
    bone(r, P(front, side * .18, .22), P(front - .14, side * .42, .12), .075 * scale, .055 * scale, back);
    bone(r, P(front - .14, side * .42, .12), P(front + step, side * .45, .035), .055 * scale, .036 * scale, light);
  }
  bone(r, P(.42, 0, .28), P(.91, 0, .24), .28 * scale, .24 * scale, back);
  const gape = motion.gape || 0;
  bone(r, P(.83, 0, .22), P(1.56, 0, .17), .19 * scale, .14 * scale, light);
  bone(r, P(.83, 0, .3), P(1.56, 0, .29 + gape * .45), .18 * scale, .14 * scale, back);
  for (const side of [-1, 1]) {
    ball(r, P(.81, side * .22, .42), .092 * scale, dark);
    ball(r, P(.86, side * .26, .46), .042 * scale, [235, 195, 81]);
    for (let k = 0; k < 4; k++) ball(r, P(.98 + k * .12, side * .09, .22 + gape * (.1 + k * .065)), .019 * scale, C.cream);
  }
  for (let n = 0; n < 7; n++) for (const side of [-1, 1]) ball(r, P(-.65 + n * .18, side * .19, .53 - Math.abs(n - 3) * .012), .085 * scale, dark, 'rough');
  let last = [-.72, 0, .22];
  for (let n = 0; n < 5; n++) {
    const next = [-1.06 - n * .32, sway * (n + 1) * .6, .18 - n * .027];
    bone(r, P(...last), P(...next), (.21 - n * .038) * scale, (.17 - n * .035) * scale, n % 2 ? back : dark);
    last = next;
  }
}

function frog(r, P, scale, t, seed, motion) {
  const green = [98, 137, 67], light = [178, 183, 111];
  ball(r, P(0, 0, .12), .15 * scale, green);
  ball(r, P(.15, 0, .2), .13 * scale, green);
  for (const side of [-1, 1]) {
    bone(r, P(-.06, side * .1, .13), P(-.23, side * .2, .08), .071 * scale, .05 * scale, green);
    bone(r, P(-.23, side * .2, .08), P(-.07 + motion.hop * .5, side * .24, .025), .04 * scale, .015 * scale, light);
    bone(r, P(.16, side * .08, .13), P(.28, side * .16, .025), .025 * scale, .012 * scale, light);
    ball(r, P(.19, side * .09, .29), .057 * scale, light);
    ball(r, P(.225, side * .1, .305), .027 * scale, C.dark);
  }
  if (motion.activity === 'call') ball(r, P(.24, 0, .11), (.05 + motion.alert * .06) * scale, light);
}

function fish(r, P, scale, t, seed, motion) {
  const silver = motion.hop > .1 ? [194, 211, 192] : [90, 129, 119];
  const back = [64, 103, 100], flick = Math.sin(t * 12 + seed) * .09;
  const dip = motion.dive * .3;
  bone(r, P(-.26, 0, .1 - dip), P(.23, 0, .12 - dip), .095 * scale, .08 * scale, silver);
  bone(r, P(-.2, .005, .16 - dip), P(.16, .005, .17 - dip), .04 * scale, .04 * scale, back);
  for (const side of [-1, 1]) {
    bone(r, P(-.32, flick, .1 - dip), P(-.54, flick + side * .12, .1 - dip), .045 * scale, .025 * scale, back);
    bone(r, P(.02, side * .04, .09 - dip), P(-.08, side * .17, .045 - dip), .026 * scale, .008 * scale, [153, 163, 126]);
    ball(r, P(.22, side * .065, .14 - dip), .018 * scale, C.dark);
  }
  bone(r, P(-.05, 0, .16 - dip), P(-.1, 0, .31 - dip), .055 * scale, .01 * scale, back);
}

function insect(r, P, scale, t, seed, dragonfly) {
  const flap = Math.abs(Math.sin(t * (dragonfly ? 36 : 13) + seed));
  const palette = [[207, 157, 71], [157, 149, 193], [206, 185, 128], [178, 113, 83]][seed % 4];
  bone(r, P(-.13, 0, .06), P(.13, 0, .08), .018 * scale, .023 * scale, dragonfly ? [82, 150, 166] : [74, 72, 57]);
  for (const side of [-1, 1]) for (const fore of [-1, 1]) {
    const extent = dragonfly ? .28 : .17 + flap * .08;
    bone(r, P(fore * .035, side * .02, .08), P(fore * .12, side * extent * (1 - flap * .4), .08 + flap * (dragonfly ? .03 : .16)), (dragonfly ? .018 : .065) * scale, (dragonfly ? .009 : .04) * scale, dragonfly ? [173, 200, 188] : palette);
  }
}

function waterTrace(r, x, y, z, scale, time, seed, amount) {
  if (amount < .04) return;
  const phase = (time * 1.3 + seed * .037) % 1;
  const radius = (.3 + phase * .65) * scale;
  const color = [171, 202, 188];
  for (let n = 0; n < 14; n++) {
    const a = n * TAU / 14;
    r.plot(x + Math.cos(a) * radius, y + Math.sin(a) * radius * .7, z + .035, color);
  }
  if (amount > .5) for (let n = 0; n < 4; n++) {
    const a = n * 2.4 + seed;
    ball(r, [x + Math.cos(a) * phase * .6, y + Math.sin(a) * phase * .5,
      z + Math.sin(phase * Math.PI) * amount * .5], .023 * scale, color);
  }
}

/** Species-specific poses, anchored to the ground height supplied by the scene. */
export function drawCreature(r, options = {}) {
  const x = finite(options.x), y = finite(options.y), z = finite(options.z);
  const t = finite(options.time), seed = finite(options.seed) >>> 0;
  const scale = Math.max(.2, Math.min(3, finite(options.scale, 1)));
  const kind = options.kind || 'deer';
  const resting = !!options.resting;
  const source = options.motion || {};
  const motion = { ...source, speed: Math.max(0, finite(source.speed)), gait: finite(source.gait),
    hop: Math.max(0, finite(source.hop)), graze: Math.max(0, Math.min(1, finite(source.graze))),
    rear: Math.max(0, Math.min(1, finite(source.rear))), alert: Math.max(0, finite(source.alert)),
    dive: Math.max(0, Math.min(1, finite(source.dive))), splash: Math.max(0, finite(source.splash)) };
  // Mostly profile angles preserve the small silhouettes. The seed makes repeat
  // encounters recognisable without synchronising every head or tail movement.
  const yaw = finite(source.yaw, -.45 - ((seed % 1009) / 1009) * 1.1);
  const dip = ['spirit', 'butterfly'].includes(kind) && motion.activity === 'bow' ? motion.graze * .3 : 0;
  let P = localFrame(x, y, z + (motion.hop - dip) * scale, yaw, scale);
  if (typeof options.groundAt === 'function' && !['fish', 'duck', 'otter', 'bird', 'owl', 'eagle', 'butterfly', 'dragonfly', 'spirit'].includes(kind)) {
    const frame = P, ahead = frame(.5, 0, 0), behind = frame(-.5, 0, 0);
    const grade = Math.max(-.55, Math.min(.55, (finite(options.groundAt(ahead[0], ahead[1]), z)
      - finite(options.groundAt(behind[0], behind[1]), z)) / scale));
    P = (f, side, up) => {
      const point = frame(f, side, up);
      const level = up < .17 ? finite(options.groundAt(point[0], point[1]), z) - z : f * grade * scale;
      point[2] += level;
      return point;
    };
  }
  if (!['fish', 'duck', 'otter', 'butterfly', 'dragonfly', 'spirit'].includes(kind) && !(kind === 'crocodile' && motion.swimming)) r.shadow(x, y, z,
    (['deer', 'stag', 'horse', 'unicorn', 'bear', 'crocodile'].includes(kind) ? .55 : kind === 'bird' ? .18 : .3) * scale, 1);
  const phaseSeed = (seed % 997) * .071;
  if (kind === 'fox') fox(r, P, scale, t, phaseSeed, resting, motion);
  else if (kind === 'rabbit') rabbit(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'bird') bird(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'spirit') spirit(r, P, scale, t, phaseSeed);
  else if (kind === 'horse') horse(r, P, scale, t, seed, motion);
  else if (kind === 'unicorn') horse(r, P, scale, t, seed, motion, true);
  else if (kind === 'wolf') wolf(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'bear') bear(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'boar') boar(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'badger') badger(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'squirrel') squirrel(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'goat') goat(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'lynx') lynx(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'owl' || kind === 'eagle') largeBird(r, P, scale, t, phaseSeed, motion, kind === 'owl');
  else if (kind === 'otter') otter(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'duck') duck(r, P, scale, t, seed, motion);
  else if (kind === 'heron') heron(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'crocodile') crocodile(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'frog') frog(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'fish') fish(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'butterfly' || kind === 'dragonfly') insect(r, P, scale, t, seed, kind === 'dragonfly');
  else deer(r, P, scale, t, seed, kind === 'stag', resting, motion);
  if (['fish', 'duck', 'otter'].includes(kind) || kind === 'crocodile' && motion.swimming || motion.splash > .1) waterTrace(r, x, y, z, scale, t, phaseSeed,
    Math.max(motion.splash, ['duck', 'otter'].includes(kind) ? Math.min(.35, motion.speed * .3) : 0));
}
