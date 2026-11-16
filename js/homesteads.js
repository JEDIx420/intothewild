/* Into the Wild — rare handcrafted homes and the small lives around them.
 * All art is world-space geometry in the same pixel rasteriser as the forest.
 */
export const HOMES_BY_BIOME = Object.freeze({
  forest: ['cabin', 'cottage', 'burrow', 'treehouse'],
  stream: [],
  meadow: ['cottage', 'burrow', 'cabin'],
  mountain: ['stone', 'cabin'],
  swamp: ['stilt', 'cottage'],
  enchanted: ['burrow', 'treehouse', 'cottage'],
});
export const WORK_BY_HOME = Object.freeze({
  cabin: ['woodcutter', 'firekeeper', 'musician', 'reader'],
  cottage: ['gardener', 'baker', 'musician', 'firekeeper'],
  burrow: ['gardener', 'baker', 'reader', 'musician'],
  stone: ['firekeeper', 'woodcutter', 'stargazer', 'reader'],
  stilt: ['fisher', 'lanternkeeper', 'firekeeper', 'musician'],
  treehouse: ['musician', 'lanternkeeper', 'stargazer', 'gardener'],
});

const TAU = Math.PI * 2;
const C = {
  cedar: [121, 85, 58], cedarLight: [160, 113, 72], cedarDark: [81, 58, 46],
  plaster: [207, 191, 152], plasterShade: [164, 151, 122],
  stone: [123, 127, 119], stoneLight: [158, 161, 149], stoneDark: [82, 94, 91],
  slate: [74, 98, 110], slateLight: [111, 132, 132],
  thatch: [174, 143, 82], straw: [219, 185, 111], reed: [132, 123, 79],
  moss: [94, 134, 77], mossLight: [139, 163, 92], earth: [97, 80, 58],
  door: [91, 62, 43], doorLight: [157, 105, 61], window: [111, 152, 152],
  windowGlow: [247, 195, 112], amber: [255, 218, 146], brass: [203, 172, 92],
  smoke: [157, 163, 153], flower: [244, 198, 141], leaf: [104, 143, 76],
  skin: [222, 181, 135], skinShade: [171, 118, 83], boot: [63, 55, 45],
  hair: [76, 51, 42], shirt: [166, 106, 69], linen: [211, 191, 152],
  trousers: [71, 87, 76], cap: [121, 113, 78], iron: [86, 94, 90],
};
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const finite = (n, d = 0) => Number.isFinite(n) ? n : d;
const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
function random(seed, salt) {
  let n = ((seed >>> 0) ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function tint(color, factor) { return color.map(c => Math.min(255, c * factor)); }
function frame(x, y, z, yaw, scale = 1) {
  const f = Math.cos(yaw), g = Math.sin(yaw), sx = -g, sy = f;
  return (front, side, up) => [x + (f * front + sx * side) * scale,
    y + (g * front + sy * side) * scale, z + up * scale];
}
const houseYaw = seed => .59 + random(seed, 21) * .39;
function bone(r, a, b, radius, color, tip = radius) { r.capsule(a, b, radius, tip, color); }
function ball(r, p, radius, color, mode = 'solid') { r.sphere(p[0], p[1], p[2], radius, color, mode); }
function oval(r, p, a, b, c, color, mode = 'solid') { r.ellipsoid(p[0], p[1], p[2], a, b, c, color, mode); }
function quad(r, a, b, c, d, color) { r.triangle(a, b, c, color); r.triangle(a, c, d, color); }

function block(r, P, f0, f1, s0, s1, z0, z1, colors) {
  const A = P(f0, s0, z0), B = P(f1, s0, z0), C1 = P(f1, s1, z0), D = P(f0, s1, z0);
  const E = P(f0, s0, z1), F = P(f1, s0, z1), G = P(f1, s1, z1), H = P(f0, s1, z1);
  quad(r, A, B, F, E, colors[1] || colors[0]);
  quad(r, B, C1, G, F, colors[0]);
  quad(r, C1, D, H, G, colors[2] || colors[0]);
  quad(r, D, A, E, H, colors[2] || colors[0]);
  quad(r, E, F, G, H, colors[3] || colors[0]);
}

function pathStones(r, P, seed, count = 5) {
  for (let i = 0; i < count; i++) {
    const f = 2.65 + i * .67, s = Math.sin(i * .9 + seed) * .28;
    oval(r, P(f, s, .045), .34 + random(seed, i + 2) * .13, .31, .045,
      i % 2 ? [174, 159, 129] : [189, 173, 143], 'rough');
  }
}
function window(r, P, f, s, z, night) {
  const front = f + .035;
  oval(r, P(front, s, z), .11, .47, .49, C.cedarDark);
  oval(r, P(front + .07, s, z), .08, .34, .35, night ? C.windowGlow : C.window);
  bone(r, P(front + .1, s - .4, z), P(front + .1, s + .4, z), .034, C.cedarLight);
  bone(r, P(front + .1, s, z - .37), P(front + .1, s, z + .36), .033, C.cedarLight);
  if (night) ball(r, P(front + .18, s - .09, z - .07), .095, C.amber, 'glow');
}
function archedDoor(r, P, f, color = C.door) {
  bone(r, P(f, 0, .48), P(f, 0, 1.67), .57, C.cedarDark, .57);
  bone(r, P(f + .09, 0, .46), P(f + .09, 0, 1.58), .46, color, .46);
  for (const s of [-.2, .19]) bone(r, P(f + .48, s, .42), P(f + .48, s, 1.49), .017, C.cedarLight);
  ball(r, P(f + .53, -.21, 1.04), .065, C.brass);
}
function gableRoof(r, P, seed, variant, season) {
  const isThatch = variant === 'cottage' || variant === 'stilt';
  const top = variant === 'stone' ? 4.12 : 4.28;
  const eaves = variant === 'stilt' ? 3.52 : 2.94;
  const back = -2.62, front = 2.63;
  const roof = variant === 'stone' ? C.slate : variant === 'cabin' ? C.cedarDark : isThatch ? C.thatch : C.slateLight;
  const ridge = [P(back, 0, top), P(front, 0, top)];
  for (const side of [-1, 1]) {
    const edge0 = P(back - .32, side * 3.22, eaves), edge1 = P(front + .38, side * 3.22, eaves);
    quad(r, edge0, edge1, ridge[1], ridge[0], tint(roof, side > 0 ? .88 : 1.08));
    bone(r, edge0, edge1, isThatch ? .14 : .08, isThatch ? C.straw : C.cedarDark);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 7; col++) {
      const f = back + .15 + col * .73 + (row % 2) * .33;
      const s = side * (.55 + row * .67);
      const z = top - (top - eaves) * Math.abs(s) / 3.22 + .028;
      const hue = isThatch ? (random(seed, row * 19 + col) < .35 ? C.straw : C.thatch)
        : tint(roof, .85 + random(seed, row * 19 + col + side * 100) * .32);
      bone(r, P(f, s, z), P(f + (isThatch ? .28 : .45), s + side * .06, z - .025),
        isThatch ? .035 : .023, hue);
    }
  }
  bone(r, ridge[0], ridge[1], isThatch ? .12 : .075, isThatch ? C.straw : C.cedarLight);
  if (season === 3) for (const side of [-1, 1]) for (let j = 0; j < 4; j++) {
    const f = back + .4 + j * 1.25, s = side * (1 + random(seed, j + 800) * 1.8);
    const z = top - (top - eaves) * Math.abs(s) / 3.22 + .05;
    oval(r, P(f, s, z), .49, .35, .055, [220, 226, 213]);
  }
}
function smoke(r, P, seed, time, start) {
  for (let i = 0; i < 4; i++) {
    const phase = (time * .15 + random(seed, i + 90) + i * .21) % 1;
    oval(r, P(start[0] + Math.sin(phase * 5 + seed) * .25, start[1], start[2] + phase * 2.1),
      .1 + phase * .12, .1 + phase * .12, .055 + phase * .08, C.smoke);
  }
}
function garden(r, P, seed, night) {
  for (let i = 0; i < 9; i++) {
    const f = 2 + random(seed, i + 201) * 2.7, s = (i % 2 ? 1 : -1) * (2.5 + random(seed, i + 202) * 1.3);
    bone(r, P(f, s, .05), P(f, s, .3 + random(seed, i + 203) * .22), .022, C.leaf);
    ball(r, P(f, s, .36 + random(seed, i + 203) * .2), .095, i % 3 === 0 ? C.flower : i % 3 === 1 ? [234, 217, 151] : [178, 160, 196]);
  }
  if (night) for (let i = 0; i < 2; i++) ball(r, P(2.4 + i * .6, 2.6, .6 + i * .3), .028, C.amber, 'glow');
}
function lantern(r, P, f, s, z, night, time) {
  const sway = Math.sin(time * .95 + s) * .06;
  bone(r, P(f, s, z + .24), P(f + sway, s, z -.13), .027, C.cedarDark);
  ball(r, P(f + sway, s, z -.2), .16, night ? C.amber : C.brass, night ? 'glow' : 'solid');
  bone(r, P(f + sway, s, z -.41), P(f + sway, s, z -.42), .13, C.cedarDark);
}
function houseFurniture(r, P, seed, variant, night, time) {
  pathStones(r, P, seed, variant === 'stilt' ? 3 : 5);
  if (variant !== 'stone') garden(r, P, seed, night);
  // A little stack of firewood or basket beside the entrance.
  for (let k = 0; k < 3; k++) {
    bone(r, P(2.55 + k * .14, -2.8, .15 + k * .17), P(3.25 + k * .14, -2.78, .15 + k * .17),
      .13, C.cedarDark);
    ball(r, P(3.25 + k * .14, -2.78, .15 + k * .17), .13, C.cedarLight);
  }
  lantern(r, P, 2.75, 2.43, 2.25, night, time);
}

/** Draws a distinct miniature home, with rooted foundation and living details. */
export function drawHome(r, options = {}) {
  const { x = 0, y = 0, z = 0, seed = 0, variant = 'cabin', time = 0,
    seasonIndex = 0, night = false, scale = 1 } = options;
  const yaw = houseYaw(seed), P = frame(x, y, z, yaw, scale);
  r.shadow(x, y, z, 3.9 * scale, .6);
  if (variant === 'burrow') {
    // A grass-roofed earth mound with a proud circular front door.
    oval(r, P(-.35, 0, .81), 3.7, 3.43, 1.23, C.earth, 'rough');
    oval(r, P(-.5, 0, 1.22), 3.76, 3.48, 1.37,
      seasonIndex === 3 ? [158, 177, 150] : C.moss, 'rough');
    for (let i = 0; i < 11; i++) {
      const f = -2.7 + random(seed, i + 35) * 5, s = (random(seed, i + 36) - .5) * 5.7;
      ball(r, P(f, s, 2.29 + Math.sin(i * 2) * .1), .21 + random(seed, i + 37) * .2, C.mossLight);
    }
    oval(r, P(3.1, 0, 1.05), .2, 1.02, 1.07, C.cedarDark);
    oval(r, P(3.23, 0, 1.05), .15, .86, .91, C.doorLight);
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * TAU, b = (i + 1) / 20 * TAU;
      bone(r, P(3.31, Math.cos(a) * .95, 1.05 + Math.sin(a) * .96),
        P(3.31, Math.cos(b) * .95, 1.05 + Math.sin(b) * .96), .07, C.brass);
    }
    for (let i = -2; i <= 2; i++) bone(r, P(3.4, i * .28, .45), P(3.4, i * .28, 1.6), .02, C.door);
    ball(r, P(3.48, -.27, 1.04), .09, C.brass);
    for (const side of [-1, 1]) {
      ball(r, P(2.65, side * 2.1, 1.57), .53, C.cedarDark);
      ball(r, P(2.86, side * 2.1, 1.57), .36, night ? C.windowGlow : C.window);
      ball(r, P(2.99, side * 2.1, 1.55), .10, C.brass);
    }
    smoke(r, P, seed, time, [-1.85, 1.7, 2.65]);
    houseFurniture(r, P, seed, variant, night, time);
    return;
  }
  if (variant === 'treehouse') {
    bone(r, P(-.75, 0, .2), P(-.74, 0, 5.5), .46, C.cedarDark, .36);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * TAU;
      bone(r, P(-.74, 0, 3.2), P(-.74 + Math.cos(a) * 2.3, Math.sin(a) * 1.8, 5.7), .12, C.cedar);
      ball(r, P(-.74 + Math.cos(a) * 2.3, Math.sin(a) * 1.8, 5.5), .85, C.moss);
    }
    block(r, P, -2.9, 2.65, -3.1, 3.1, 2.22, 2.46,
      [C.cedar, C.cedarDark, C.cedarLight, C.cedarLight]);
    for (const side of [-1, 1]) {
      bone(r, P(2.54, side * 3.05, 2.45), P(2.54, side * 3.05, 3.4), .075, C.cedar);
      bone(r, P(2.54, side * 3.05, 3.4), P(-2.5, side * 3.05, 3.4), .055, C.cedar);
    }
    for (let i = 0; i < 8; i++) bone(r, P(2.87, -1.4, .15 + i * .31), P(2.87, -.5, .15 + i * .31), .045, C.cedarLight);
    for (const s of [-1.5, -.35]) bone(r, P(2.87, s, .05), P(2.87, s, 2.6), .04, C.cedarDark);
  }
  const stilt = variant === 'stilt', raised = variant === 'treehouse' ? 2.28 : stilt ? 1.14 : 0;
  if (stilt) {
    for (const f of [-2.1, 2.1]) for (const s of [-2.5, 2.5]) bone(r, P(f, s, -.05), P(f, s, 1.48), .19, C.cedarDark);
    block(r, P, -2.65, 2.65, -3.2, 3.2, 1.03, 1.22,
      [C.cedar, C.cedarDark, C.cedarLight, C.cedarLight]);
  }
  const wall = variant === 'stone' ? C.stone : variant === 'cottage' ? C.plaster : C.cedar;
  const trim = variant === 'stone' ? C.stoneLight : variant === 'cottage' ? C.cedarLight : C.cedarDark;
  block(r, P, -2.18, 2.18, -2.58, 2.58, .14 + raised, 2.92 + raised,
    [wall, tint(wall, .87), tint(wall, 1.09), trim]);
  for (let i = -2; i <= 2; i++) {
    const s = i * 1.03;
    bone(r, P(2.22, s, .22 + raised), P(2.22, s, 2.72 + raised),
      variant === 'stone' ? .06 : .048, trim);
  }
  if (variant === 'cabin' || variant === 'stilt' || variant === 'treehouse') {
    for (let row = 0; row < 5; row++) {
      const zz = raised + .4 + row * .44;
      bone(r, P(2.26, -2.55, zz), P(2.26, 2.55, zz), .048, C.cedarDark);
    }
  } else if (variant === 'stone') for (let row = 0; row < 6; row++) {
    const zz = raised + .35 + row * .39;
    bone(r, P(2.26, -2.55, zz), P(2.26, 2.55, zz), .027, C.stoneDark);
  }
  const doorP = (f, s, u) => P(f, s, u + raised);
  archedDoor(r, doorP, 2.28 + (variant === 'treehouse' ? .05 : 0), C.door);
  for (const s of [-1.7, 1.7]) window(r, P, 2.32, s, raised + 1.8, night);
  if (variant === 'cottage') {
    for (const s of [-2.39, 2.39]) {
      bone(r, P(2.4, s, .5), P(2.4, s, 2.6), .08, C.cedarLight);
      for (let j = 0; j < 3; j++) ball(r, P(2.45, s * .96, .65 + j * .45), .16, C.leaf);
    }
  }
  if (variant === 'stone') {
    block(r, P, -1.3, -.64, 1.48, 2.08, 2.55, 4.75,
      [C.stone, C.stoneDark, C.stoneLight, C.stoneLight]);
    smoke(r, P, seed, time, [-.96, 1.78, 4.8]);
  } else if (variant === 'cabin' || variant === 'cottage') {
    block(r, P, -1.4, -.85, 1.55, 2.08, 2.4, 4.68,
      [C.cedar, C.cedarDark, C.cedarLight, C.stone]);
    smoke(r, P, seed, time, [-1.12, 1.83, 4.75]);
  }
  // The same roof construction is shifted above a stilt or tree platform.
  const roofP = (f, s, u) => P(f, s, u + raised);
  gableRoof(r, roofP, seed, variant, seasonIndex);
  if (stilt) {
    for (let row = 0; row < 4; row++) bone(r, P(2.85 + row * .65, -.9, .11 + raised - row * .27),
      P(2.85 + row * .65, 1, .11 + raised - row * .27), .05, C.cedarLight);
  }
  houseFurniture(r, P, seed, variant, night, time);
}

const NAMES = ['Elowen', 'Mira', 'Alder', 'Tamsin', 'Bram', 'Rowan', 'Fenn', 'Orla',
  'Pip', 'Maeve', 'Lio', 'Juniper', 'Cora', 'Nell', 'Finn', 'Edda'];
const JOBS = {
  firekeeper: { title: 'firekeeper', action: 'tends a little fire' },
  musician: { title: 'musician', action: 'plays a tune' },
  woodcutter: { title: 'woodcutter', action: 'splits kindling' },
  gardener: { title: 'gardener', action: 'tends the flowers' },
  baker: { title: 'baker', action: 'warms a kettle' },
  fisher: { title: 'fisher', action: 'watches the water' },
  lanternkeeper: { title: 'lantern keeper', action: 'lights the lanterns' },
  stargazer: { title: 'stargazer', action: 'watches the sky' },
  reader: { title: 'reader', action: 'turns a page' },
};
export const RESIDENT_JOBS = Object.freeze(JOBS);
export function residentName(entity) {
  const e = entity || {}, person = NAMES[Math.floor(random(e.seed || 0, 53) * NAMES.length)];
  return `${person} the ${JOBS[e.variant]?.title || 'neighbour'}`;
}

export function residentPose(entity, elapsed = 0, reaction = null) {
  const e = entity || {}, time = Math.max(0, finite(elapsed));
  const seed = e.seed || 0, job = e.variant || 'gardener';
  const s = (e.member || 0) === 0 ? -1.4 : 2.1;
  const front = (e.homeVariant === 'burrow' ? 4.9 : 4.0) + (e.member || 0) * .25;
  const pace = job === 'fisher' ? .6 : .34;
  const wander = Math.sin(time * .38 + seed) * pace;
  const cycle = time * ({ musician: 2.5, woodcutter: 1.65, gardener: 1.1,
    baker: .9, reader: .45, fisher: .7, firekeeper: .95, lanternkeeper: 1.1, stargazer: .4 }[job] || 1) + random(seed, 55) * TAU;
  const wave = reaction?.action === 'wave' ? Math.sin(Math.PI * clamp((time - reaction.at) / 1.6)) : 0;
  const glance = reaction?.action === 'continue' ? Math.sin(Math.PI * clamp((time - reaction.at) / 1.1)) * .16 : 0;
  return { front: front + wander, side: s, cycle, wave, glance, job, seed, yaw: houseYaw(seed ^ 0x692b),
    breath: Math.sin(time * 1.55 + seed) * .015 };
}

export function residentPosition(entity, x, y, z, elapsed = 0, groundAt = null) {
  const pose = residentPose(entity, elapsed);
  const origin = frame(x, y, z, houseYaw(entity.homeSeed || entity.seed || 0), 1);
  const base = origin(pose.front, pose.side, 0);
  return { x: base[0], y: base[1], z: typeof groundAt === 'function' ? groundAt(base[0], base[1]) : z };
}

function fire(r, P, time, seed, bright = true) {
  r.shadow(...P(0, 0, 0), .48, .55);
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8;
    ball(r, P(Math.cos(a) * .52, Math.sin(a) * .5, .1), .17, i % 2 ? C.stone : C.stoneLight, 'rough');
  }
  bone(r, P(-.43, -.13, .18), P(.42, .18, .18), .11, C.cedarDark);
  bone(r, P(.38, -.18, .19), P(-.38, .2, .2), .1, C.cedar);
  if (bright) for (let i = 0; i < 3; i++) {
    const flicker = .3 + .14 * Math.sin(time * 8 + seed * .1 + i * 2);
    oval(r, P((i - 1) * .11, Math.sin(time * 3 + i) * .06, .21 + flicker * .35),
      .1, .1, flicker, i === 1 ? C.amber : [231, 122, 60], 'glow');
  }
  smoke(r, P, seed, time, [0, 0, .67]);
}

/** Draw a little person continuing their chosen task, with a brief optional wave. */
export function drawResident(r, options = {}) {
  const { entity = {}, time = 0, reaction = null, x = 0, y = 0, z = 0, groundAt,
    night = false, reducedMotion = false } = options;
  const pose = residentPose(entity, time, reaction), scale = (entity.scale || 1) * .78;
  const origin = frame(x, y, z, houseYaw(entity.homeSeed || entity.seed || 0), 1);
  const base = origin(pose.front, pose.side, 0);
  const ground = typeof groundAt === 'function' ? groundAt(base[0], base[1]) : z;
  const shiftX = base[0], shiftY = base[1], yaw = pose.yaw;
  const P = frame(shiftX, shiftY, ground, yaw, scale);
  const job = pose.job, motion = reducedMotion ? 0 : Math.sin(pose.cycle);
  const lean = job === 'gardener' ? .27 + .1 * motion : job === 'fisher' ? -.08 : 0;
  const sit = job === 'reader' ? .45 : 0;
  const hip = 1 - sit * .48, shoulder = 1.57 - sit * .42;
  const skin = random(entity.seed || 0, 57) < .25 ? [177, 123, 93] : C.skin;
  const shirt = [C.shirt, [110, 132, 100], [140, 112, 133], [110, 119, 144]][Math.floor(random(entity.seed || 0, 58) * 4)];
  r.shadow(shiftX, shiftY, ground, .32 * scale, .9);
  if (job === 'firekeeper' || job === 'baker') {
    const fireP = frame(shiftX + 1.4, shiftY + .55, ground, yaw, scale);
    fire(r, fireP, time, entity.seed || 0, job === 'firekeeper' || night);
  }
  if (job === 'gardener') for (let i = 0; i < 4; i++) {
    const f = .75 + i * .27, s = -.75 + Math.sin(i) * .2;
    bone(r, P(f, s, .04), P(f, s, .31), .018, C.leaf);
    ball(r, P(f, s, .35), .095, i % 2 ? C.flower : C.mossLight);
  }
  if (job === 'woodcutter') {
    bone(r, P(.95, -.4, .08), P(1.55, -.3, .24), .22, C.cedarDark);
    ball(r, P(1.55, -.3, .24), .22, C.cedarLight);
  }
  if (job === 'reader') {
    bone(r, P(-.3, -.55, .3), P(.5, -.55, .3), .11, C.cedarDark);
    bone(r, P(-.3, .45, .3), P(.5, .45, .3), .11, C.cedarDark);
  }
  for (const side of [-1, 1]) {
    const hipP = P(-.08, side * .13, hip);
    const knee = P(.15 + sit * .27, side * .16, .54 - sit * .28);
    const ankle = P(.06 + sit * .5, side * .16, .1);
    bone(r, hipP, knee, .125 * scale, C.trousers);
    bone(r, knee, ankle, .09 * scale, C.trousers);
    bone(r, ankle, P(.18 + sit * .5, side * .16, .08), .083 * scale, C.boot);
  }
  bone(r, P(-.04 + lean * .15, 0, hip), P(.05 + lean, 0, shoulder + pose.breath), .27 * scale, shirt);
  oval(r, P(.04 + lean, 0, shoulder - .19), .24 * scale, .27 * scale, .18 * scale,
    job === 'baker' || job === 'gardener' ? C.linen : shirt);
  const hands = [];
  for (const side of [-1, 1]) {
    const shoulderP = P(.03 + lean, side * .3, shoulder);
    const work = Math.sin(pose.cycle + side) * (reducedMotion ? .05 : .24);
    const wave = side > 0 ? pose.wave : 0;
    const elbow = P(.23 + lean + work * .45, side * (.42 + wave * .2), shoulder - .3 + wave * .45);
    const hand = P(.43 + lean + work, side * (.38 + wave * .21),
      shoulder - .64 + wave * 1.04 + (job === 'musician' ? .32 : 0) + (job === 'woodcutter' && side < 0 ? Math.max(0, motion) * .5 : 0));
    bone(r, shoulderP, elbow, .107 * scale, shirt);
    bone(r, elbow, hand, .078 * scale, shirt);
    ball(r, hand, .072 * scale, skin);
    hands.push(hand);
  }
  const head = P(.1 + lean + pose.glance, 0, shoulder + .31 + pose.breath);
  oval(r, head, .175 * scale, .18 * scale, .21 * scale, skin);
  oval(r, P(.025 + lean + pose.glance, 0, shoulder + .39 + pose.breath), .17 * scale, .17 * scale, .12 * scale, C.hair);
  ball(r, P(.24 + lean + pose.glance, -.1, shoulder + .32), .021 * scale, C.cedarDark);
  if (random(entity.seed || 0, 59) < .65) {
    oval(r, P(.03 + lean, 0, shoulder + .54), .28 * scale, .27 * scale, .045 * scale, C.cap);
    oval(r, P(.02 + lean, 0, shoulder + .62), .19 * scale, .19 * scale, .11 * scale, C.cap);
  }
  if (job === 'musician') {
    oval(r, P(.42, 0, 1.12), .16 * scale, .37 * scale, .35 * scale, C.cedarLight);
    bone(r, P(.42, .03, 1.32), P(.42, -.05, 1.87), .1 * scale, C.cedarDark);
    for (let i = -1; i <= 1; i++) bone(r, P(.59, i * .07, .9), P(.59, i * .07, 1.6), .012 * scale, C.brass);
    for (let i = 0; i < 2; i++) {
      const a = time * .68 + i * Math.PI;
      const q = P(.45 + Math.sin(a) * .27, -.6, 1.7 + (a % TAU) * .18);
      ball(r, q, .043 * scale, night ? C.amber : C.window);
      bone(r, q, [q[0] + .08, q[1], q[2] + .14], .015 * scale, night ? C.amber : C.window);
    }
  } else if (job === 'woodcutter') {
    bone(r, hands[0], P(.65 + motion * .25, -.4, 1.32 + Math.max(0, motion) * .55), .039 * scale, C.cedarDark);
    bone(r, P(.64 + motion * .25, -.47, 1.3 + Math.max(0, motion) * .55),
      P(.93 + motion * .25, -.45, 1.29 + Math.max(0, motion) * .55), .12 * scale, C.iron);
  } else if (job === 'fisher') {
    bone(r, hands[1], P(1.4, .35, 2.4), .025 * scale, C.cedar);
    bone(r, P(1.4, .35, 2.4), P(1.55, .3, .4 + .13 * motion), .011 * scale, C.linen);
  } else if (job === 'gardener') {
    oval(r, P(.6, -.23, .7), .19 * scale, .15 * scale, .16 * scale, C.stoneLight);
    bone(r, P(.68, -.2, .85), P(.95, -.2, .66), .038 * scale, C.iron);
  } else if (job === 'reader') {
    quad(r, P(.39, -.28, .92), P(.39, 0, .97), P(.39, 0, 1.2), P(.39, -.28, 1.16), C.linen);
    quad(r, P(.39, 0, .97), P(.39, .28, .92), P(.39, .28, 1.16), P(.39, 0, 1.2), C.plaster);
  } else if (job === 'lanternkeeper') {
    ball(r, P(.68, .32, 1.16 + .24 * motion), .16 * scale, night ? C.amber : C.brass, night ? 'glow' : 'solid');
    bone(r, P(.68, .32, 1.36 + .24 * motion), P(.68, .32, 1.5 + .24 * motion), .024 * scale, C.cedarDark);
  } else if (job === 'baker') {
    oval(r, P(.63, .25, .93), .25 * scale, .22 * scale, .15 * scale, C.stone);
    oval(r, P(.63, .25, 1.05), .13 * scale, .13 * scale, .035 * scale, C.amber);
  } else if (job === 'stargazer') {
    bone(r, hands[1], P(.75, .35, 2.2 + .16 * motion), .042 * scale, shirt);
  }
  return { x: shiftX, y: shiftY, z: ground, head: head, height: 1.9 * scale };
}

const COMMENTS = {
  firekeeper: ['keeps the little fire alive.', 'coaxes another ember into the morning air.'],
  musician: ['keeps playing a wandering tune.', 'finds the next few notes on the strings.'],
  woodcutter: ['returns to the careful rhythm of the axe.', 'stacks another piece of kindling.'],
  gardener: ['waters the flowers along the fence.', 'gently straightens a bent stem.'],
  baker: ['tends a kettle that smells of warm herbs.', 'stirs something good over the coals.'],
  fisher: ['watches a ripple beneath the reeds.', 'waits patiently beside the water.'],
  lanternkeeper: ['shields a flame from the breeze.', 'checks the glow inside a little lantern.'],
  stargazer: ['keeps watching the changing sky.', 'points out a cloud shaped like a ship.'],
  reader: ['turns another page of a weathered book.', 'follows a line with one finger.'],
};

export class ResidentDirector {
  constructor() { this.reactions = new Map(); this.counts = new Map(); }
  prune(entities) {
    const known = new Set(entities.filter(e => e.kind === 'resident').map(e => e.id));
    for (const id of this.reactions.keys()) if (!known.has(id)) this.reactions.delete(id);
    for (const id of this.counts.keys()) if (!known.has(id)) this.counts.delete(id);
  }
  sample(entity, elapsed) {
    const reaction = this.reactions.get(entity.id);
    if (reaction && elapsed - reaction.at >= 1.6) { this.reactions.delete(entity.id); return null; }
    return reaction || null;
  }
  interact(entity, elapsed) {
    if (!entity || entity.kind !== 'resident') return null;
    const existing = this.reactions.get(entity.id);
    if (existing && elapsed - existing.at < .52) return null;
    const count = (this.counts.get(entity.id) || 0) + 1;
    this.counts.set(entity.id, count);
    const wave = random(entity.seed, count * 33 + 4) < .6;
    const action = wave ? 'wave' : 'continue';
    this.reactions.set(entity.id, { action, at: elapsed, count });
    const name = residentName(entity), job = entity.variant;
    const words = COMMENTS[job] || COMMENTS.gardener;
    const phrase = words[Math.floor(random(entity.seed, count * 41 + 5) * words.length)];
    return { id: entity.id, species: 'resident', name, action, sound: wave ? 'rustle' : null,
      message: wave ? `${name.split(' ')[0]} smiles and gives you a little wave, then ${phrase}`
        : `${name.split(' ')[0]} ${phrase} The traveller watches a moment.` };
  }
}
