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

function pack(r, P, forward, side, z, scale = 1) {
  const p = P(forward, side, z);
  oval(r, p, .28 * scale, .19 * scale, .35 * scale, C.pack);
  oval(r, [p[0], p[1] - .025 * scale, p[2] + .23 * scale], .29 * scale, .2 * scale, .1 * scale, C.packLight);
  bone(r, P(forward, side - .3, z + .4), P(forward, side + .3, z + .4), .105 * scale, .105 * scale, C.bedroll);
  ball(r, P(forward, side + .31, z + .4), .08 * scale, C.bedrollLight);
  for (const offset of [-.17, .17]) {
    bone(r, P(forward - .17, side + offset, z + .27), P(forward - .18, side + offset, z - .23), .025 * scale, .025 * scale, C.leather);
  }
}

function hat(r, P, z, forward = 0) {
  oval(r, P(forward, 0, z), .345, .305, .045, C.hatRim);
  oval(r, P(forward - .025, 0, z + .08), .22, .21, .12, C.hat);
  oval(r, P(forward - .025, 0, z + .022), .224, .214, .035, C.hatBand);
}

function head(r, P, z, forward = 0, turn = 0) {
  oval(r, P(forward, turn * .035, z), .185, .19, .235, C.skin);
  oval(r, P(forward - .072, turn * .035, z + .055), .18, .155, .17, C.hair);
  ball(r, P(forward + .175, .01 + turn * .025, z - .015), .055, C.skinShade);
  ball(r, P(forward + .125, -.12, z + .035), .022, C.dark);
  hat(r, P, z + .17, forward);
}

function lantern(r, P, forward, side, z, night) {
  const p = P(forward, side, z);
  bone(r, [p[0], p[1], p[2] - .07], [p[0], p[1], p[2] + .1], .065, .065, C.lantern);
  ball(r, [p[0], p[1] - .025, p[2] + .035], night ? .061 : .045, C.flame);
  bone(r, [p[0] - .05, p[1], p[2] + .1], [p[0], p[1], p[2] + .17], .014, .014, C.lantern);
  bone(r, [p[0] + .05, p[1], p[2] + .1], [p[0], p[1], p[2] + .17], .014, .014, C.lantern);
}

function standingTraveller(r, p) {
  const walking = p.mode === 'walking';
  const phase = p.distance * 6.1;
  const movement = walking && !p.reducedMotion;
  const breath = Math.sin(p.time * 1.8) * .014;
  const bob = movement ? Math.cos(phase * 2) * .026 : breath;
  const P = localFrame(p.x, p.y, p.z, -Math.PI / 2);
  const hip = 1.07 + bob, shoulder = 1.79 + bob;
  r.shadow(p.x, p.y, p.z, .39, 1);

  // Each ankle passes through a planted phase, then rises on its return.
  for (const side of [-1, 1]) {
    const q = phase + (side === 1 ? Math.PI : 0);
    const swing = movement ? Math.sin(q) : 0;
    const lift = movement ? Math.max(0, Math.cos(q)) * .21 : 0;
    const footA = .32 * swing;
    const h = P(0, side * .145, hip);
    const knee = P(footA * .47 + lift * .7, side * .16, .58 + lift * .38);
    const ankle = P(footA, side * .165, .11 + lift);
    bone(r, h, knee, .15, .115, C.trousers);
    bone(r, knee, ankle, .115, .075, C.trousers);
    bone(r, P(footA - .065, side * .165, .09 + lift), P(footA + .17, side * .165, .075 + lift), .095, .09, C.boot);
    bone(r, P(footA - .07, side * .165, .035 + lift), P(footA + .18, side * .165, .035 + lift), .055, .055, C.bootSole);
  }

  bone(r, P(-.015, 0, hip + .05), P(.025, 0, shoulder), .29, .33, C.coat);
  oval(r, P(-.055, 0, hip + .06), .335, .255, .21, C.coatDark);
  bone(r, P(.075, -.23, hip + .22), P(.04, -.26, shoulder - .03), .055, .075, C.coatLight);
  pack(r, P, -.29, 0, hip + .42);
  for (const side of [-1, 1]) {
    bone(r, P(-.08, side * .25, shoulder + .015), P(.19, side * .235, hip + .23), .027, .027, C.leather);
  }

  // The stick arm has a smaller swing; the free arm counterbalances the legs.
  const armSwing = movement ? Math.sin(phase) * .38 : .03 * Math.sin(p.time * .7);
  const leftElbow = P(.02 - armSwing * .45, -.36, shoulder - .34);
  const leftHand = P(.05 - armSwing, -.36, shoulder - .72);
  bone(r, P(.01, -.32, shoulder - .015), leftElbow, .12, .095, C.coat);
  bone(r, leftElbow, leftHand, .088, .065, C.coatLight);
  ball(r, leftHand, .071, C.skin);

  const rightElbow = P(.1 + armSwing * .16, .36, shoulder - .29);
  const rightHand = P(.29 + armSwing * .23, .37, shoulder - .5);
  bone(r, P(.01, .32, shoulder - .015), rightElbow, .12, .095, C.coat);
  bone(r, rightElbow, rightHand, .09, .06, C.coatLight);
  bone(r, P(.46 + armSwing * .45, .42, .045), P(.23 + armSwing * .2, .38, shoulder - .32), .027, .024, C.staff);
  ball(r, rightHand, .073, C.skin);
  bone(r, P(.02, 0, shoulder - .01), P(.015, 0, shoulder + .18), .105, .095, C.skin);
  head(r, P, shoulder + .34, .025, Math.sin(p.time * .3));
  lantern(r, P, -.23, -.31, hip - .02, p.night);
}

function snackingTraveller(r, p) {
  const P = localFrame(p.x, p.y, p.z, -Math.PI / 2);
  const breath = Math.sin(p.time * 1.8) * .012;
  const sip = p.reducedMotion ? .25 : Math.pow(Math.max(0, Math.sin(p.modeTime * .9 - 1)), 3);
  r.shadow(p.x, p.y, p.z, .57, 1);
  oval(r, P(.18, 0, .025), .58, .65, .035, C.cloth);
  for (const side of [-1, 1]) {
    const hip = P(-.05, side * .14, .43);
    const knee = P(.4, side * .3, .23);
    const ankle = P(.72, side * .2, .1);
    bone(r, hip, knee, .15, .13, C.trousers);
    bone(r, knee, ankle, .13, .085, C.trousers);
    bone(r, ankle, P(.88, side * .2, .09), .105, .09, C.boot);
  }
  bone(r, P(-.04, 0, .5), P(-.1, 0, 1.17 + breath), .28, .31, C.coat);
  oval(r, P(-.08, 0, .54), .33, .24, .18, C.coatDark);
  head(r, P, 1.54 + breath, -.07, -.25);
  const mouthHand = P(.39 - sip * .24, -.28 + sip * .08, .89 + sip * .55);
  const elbow = P(.23, -.37, .85 + sip * .2);
  bone(r, P(-.07, -.31, 1.13), elbow, .115, .085, C.coat);
  bone(r, elbow, mouthHand, .085, .062, C.coatLight);
  ball(r, mouthHand, .07, C.skin);
  bone(r, [mouthHand[0], mouthHand[1] - .05, mouthHand[2]], [mouthHand[0], mouthHand[1] - .05, mouthHand[2] + .13], .075, .08, C.mug);
  ball(r, [mouthHand[0], mouthHand[1] - .05, mouthHand[2] + .13], .055, C.tea);
  bone(r, P(-.07, .31, 1.12), P(.2, .35, .83), .115, .08, C.coat);
  bone(r, P(.2, .35, .83), P(.45, .29, .52), .08, .06, C.coatLight);
  ball(r, P(.45, .29, .52), .07, C.skin);
  oval(r, P(.5, .28, .57), .12, .085, .055, C.bread);
  pack(r, P, -.1, -.77, .37, .95);
  bone(r, P(-.35, .7, .06), P(1.12, .75, .06), .027, .025, C.staff);
  lantern(r, P, -.23, .6, .1, p.night);
  if (p.night || sip < .1) {
    const steam = p.reducedMotion ? 0 : Math.floor(p.time * 3) % 3;
    r.plot(mouthHand[0], mouthHand[1] - .05, mouthHand[2] + .28 + steam * .04, C.cream);
  }
}

function sleepingTraveller(r, p) {
  const P = localFrame(p.x, p.y, p.z, -Math.PI / 2);
  const breath = p.reducedMotion ? 0 : Math.sin(p.time * 1.3) * .012;
  r.shadow(p.x, p.y, p.z, .75, 1);
  oval(r, P(.2, 0, .07), .43, 1.03, .07, C.bedroll);
  oval(r, P(.3, 0, .23 + breath), .35, .71, .2, C.bedrollLight);
  bone(r, P(-.19, -.32, .3 + breath), P(-.19, .32, .3 + breath), .075, .075, C.bedroll);
  bone(r, P(.72, -.29, .22), P(.72, .29, .22), .055, .055, C.bedroll);
  oval(r, P(-.65, 0, .13), .3, .25, .11, C.cloth);
  oval(r, P(-.65, -.015, .29), .195, .22, .17, C.skin);
  oval(r, P(-.76, .01, .3), .19, .135, .165, C.hair);
  ball(r, P(-.51, -.07, .29), .045, C.skinShade);
  bone(r, P(.88, -.16, .15), P(1.08, -.16, .12), .09, .08, C.boot);
  bone(r, P(.88, .16, .15), P(1.08, .16, .12), .09, .08, C.boot);
  pack(r, P, -.63, .61, .34, .9);
  const hp = P(-.18, -.68, .09);
  oval(r, hp, .34, .29, .045, C.hatRim);
  oval(r, [hp[0], hp[1], hp[2] + .08], .21, .2, .11, C.hat);
  bone(r, P(-.85, -.52, .06), P(.9, -.63, .06), .027, .025, C.staff);
  lantern(r, P, -.89, -.53, .12, true);
}

/** Draw a human traveller facing the forward direction (world -Y). */
export function drawTraveller(r, options = {}) {
  const p = {
    x: finite(options.x), y: finite(options.y), z: finite(options.z),
    time: finite(options.time), distance: finite(options.distance),
    mode: options.mode || 'paused', modeTime: finite(options.modeTime),
    night: !!options.night, reducedMotion: !!options.reducedMotion,
  };
  if (p.mode === 'sleep') sleepingTraveller(r, p);
  else if (p.mode === 'snack') snackingTraveller(r, p);
  else standingTraveller(r, p);
}

function walkingLegs(r, P, scale, motion, hips, width, height, color, lower, hoof, stride) {
  const moving = Math.min(1, motion.speed / .55);
  for (const forward of hips) for (const side of [-width, width]) {
    // Opposite diagonal feet move together in a gentle trot. During the stance
    // half the foot moves back relative to the body, then lifts on its return.
    const phase = motion.gait + ((forward > 0) === (side > 0) ? Math.PI : 0);
    const swing = Math.sin(phase) * stride * moving;
    const lift = Math.max(0, Math.cos(phase)) * height * .2 * moving;
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

/** Species-specific poses, anchored to the ground height supplied by the scene. */
export function drawCreature(r, options = {}) {
  const x = finite(options.x), y = finite(options.y), z = finite(options.z);
  const t = finite(options.time), seed = finite(options.seed) >>> 0;
  const scale = Math.max(.2, Math.min(3, finite(options.scale, 1)));
  const kind = options.kind || 'deer';
  const resting = !!options.resting;
  const source = options.motion || {};
  const motion = { speed: Math.max(0, finite(source.speed)), gait: finite(source.gait),
    hop: Math.max(0, finite(source.hop)), graze: Math.max(0, Math.min(1, finite(source.graze))) };
  // Mostly profile angles preserve the small silhouettes. The seed makes repeat
  // encounters recognisable without synchronising every head or tail movement.
  const yaw = finite(source.yaw, -.45 - ((seed % 1009) / 1009) * 1.1);
  const P = localFrame(x, y, z + motion.hop * scale, yaw, scale);
  r.shadow(x, y, z,
    (kind === 'deer' || kind === 'stag' ? .58 : kind === 'bird' ? .18 : .3) * scale, 1);
  const phaseSeed = (seed % 997) * .071;
  if (kind === 'fox') fox(r, P, scale, t, phaseSeed, resting, motion);
  else if (kind === 'rabbit') rabbit(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'bird') bird(r, P, scale, t, phaseSeed, motion);
  else if (kind === 'spirit') spirit(r, P, scale, t, phaseSeed);
  else deer(r, P, scale, t, seed, kind === 'stag', resting, motion);
}
