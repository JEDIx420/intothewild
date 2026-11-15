import { Raster, hash, clamp, lerp } from './pixel.js?v=5';

const LEAF = [
  [[51, 85, 57], [91, 126, 69], [147, 169, 99]],
  [[39, 74, 55], [77, 112, 61], [128, 151, 79]],
  [[106, 65, 43], [165, 107, 47], [208, 160, 76]],
  [[83, 106, 96], [145, 164, 150], [219, 227, 214]],
];
const EVERGREEN = new Set(['pine', 'spruce', 'cedar', 'cypress']);
const shapeOf = {
  oak: [5.2, 2.05, 1.15], beech: [6.1, 1.85, 1.35], birch: [6.6, 1.25, 1.55],
  aspen: [7.1, 1.05, 1.55], maple: [5.4, 2.15, 1.16], rowan: [4.6, 1.45, 1.2],
};

/** A small family of botanical silhouettes, each with independent branching. */
export function makeTreeSprite(kind, season, variant, size, renderScale) {
  const r = new Raster(160, 168, renderScale);
  r.ox = 80; r.oy = 154; r.clear();
  const rand = salt => hash(variant * 71 + salt, kind.length * 19 + salt * .13);
  const scale = size * (.93 + rand(2) * .14), white = kind === 'birch' || kind === 'aspen';
  const bark = white ? [184, 181, 149] : kind === 'willow' ? [110, 108, 74] : [111, 88, 62];
  const twig = white ? [112, 119, 98] : [92, 76, 56];
  const point = (x, y, z) => [x * scale, y * scale, z * scale];
  const branch = (a, b, radius = .12, tip = .035, color = bark) => r.capsule(point(...a), point(...b), radius * scale, tip * scale, color, 'rough');
  const leaf = (x, y, z, radius, n, evergreen = false) => {
    if (season === 3 && !evergreen && rand(n + 930) < .86) return;
    const palette = LEAF[season];
    const tone = rand(n + 220) + (z - 3.5) * .11;
    let color = palette[tone > .83 ? 2 : tone > .4 ? 1 : 0];
    if (evergreen && season !== 3) color = [[43, 76, 62], [65, 102, 74], [107, 134, 89]][tone > .86 ? 2 : tone > .42 ? 1 : 0];
    if (kind === 'aspen' && season < 2) color = [color[0] + 15, color[1] + 13, color[2] + 4];
    if (kind === 'maple' && season === 2) color = [color[0] + 12, color[1] - 17, color[2] - 7];
    if (kind === 'willow' && season < 2) color = [color[0] + 16, color[1] + 6, color[2] - 4];
    r.sphere(...point(x, y, z), radius * scale, color, 'rough');
  };
  const leanX = (rand(3) - .5) * .55, leanY = (rand(4) - .5) * .45;
  for (let j = 0; j < 4; j++) {
    const a = j * 1.73 + rand(5);
    branch([0, 0, .16], [Math.cos(a) * .65, Math.sin(a) * .65, .015], .15, .035);
  }
  if (kind === 'snag') {
    branch([0, 0, 0], [leanX, leanY, 5.8], .28, .065, [125, 118, 94]);
    for (let j = 0; j < 7; j++) {
      const a = j * 2.38 + rand(11), z = 1.6 + j * .48;
      const tip = [Math.cos(a) * (1.1 - j * .06), Math.sin(a) * .95, z + .42];
      branch([leanX * z / 6, leanY * z / 6, z], tip, .115 - j * .01, .025);
      branch(tip, [tip[0] * 1.15, tip[1] * 1.16, tip[2] + .55], .04, .012);
    }
  } else if (kind === 'willow') {
    branch([0, 0, 0], [.35 + leanX, leanY, 3.8], .28, .11);
    for (let b = 0; b < 9; b++) {
      const a = b * 2.4 + rand(8), reach = 1.8 + rand(b + 20) * .65;
      const end = [Math.cos(a) * reach, Math.sin(a) * reach, 3.5 + rand(b + 42) * 1.1];
      branch([.22, 0, 2.35], end, .12, .035);
      for (let k = 0; k < 17; k++) {
        const t = k / 16, x = end[0] + Math.cos(a) * Math.sin(t * 2) * .25;
        const y = end[1] + Math.sin(a) * Math.sin(t * 2) * .25, z = end[2] - t * (2.1 + rand(b + 62) * .75);
        leaf(x, y, z, .19 + rand(k + b * 18) * .13, b * 30 + k);
        if (k % 4 === 0) leaf(x - .26, y + .1, z + .16, .29, b * 39 + k);
      }
    }
    for (let k = 0; k < 80; k++) {
      const a = rand(k + 130) * 6.283, rad = Math.sqrt(rand(k + 250)) * 1.8;
      leaf(Math.cos(a) * rad, Math.sin(a) * rad, 4.25 + rand(k + 300) * .8, .25, 500 + k);
    }
  } else if (EVERGREEN.has(kind)) {
    const height = kind === 'cypress' ? 7.4 : kind === 'spruce' ? 7.1 : kind === 'cedar' ? 5.7 : 6.4;
    const spread = kind === 'cypress' ? 1.1 : kind === 'spruce' ? 1.6 : kind === 'cedar' ? 2.3 : 2;
    branch([0, 0, 0], [leanX, leanY, height], .23, .025);
    for (let layer = 0; layer < 6; layer++) {
      const z = 1.4 + layer * (height - 1.5) / 6;
      const width = spread * (1 - layer / 7) * (.91 + rand(layer + 11) * .18);
      for (let b = 0; b < 4; b++) {
        const a = b * 1.57 + layer * 2.2 + rand(layer + 30);
        branch([0, 0, z], [Math.cos(a) * width, Math.sin(a) * width, z - .15], .065, .018);
      }
      const count = kind === 'cypress' ? 30 : 38;
      for (let k = 0; k < count; k++) {
        const n = layer * 43 + k, a = rand(n + 100) * 6.283, d = Math.sqrt(rand(n + 300)) * width;
        const zz = kind === 'cedar' ? z + rand(n + 440) * .36 : z + (1 - d / width) * .78;
        leaf(Math.cos(a) * d + leanX * z / height, Math.sin(a) * d + leanY * z / height, zz, .18 + rand(n + 600) * .16, n, true);
      }
    }
    if (kind === 'cypress') for (let k = 0; k < 4; k++) {
      const a = k * 2.3, radius = .6 + rand(k + 400) * .5;
      branch([Math.cos(a) * radius, Math.sin(a) * radius, 0], [Math.cos(a) * radius, Math.sin(a) * radius, .55], .11, .025);
    }
  } else {
    const [height, width, stretch] = shapeOf[kind] || shapeOf.oak;
    branch([0, 0, 0], [leanX, leanY, height - .5], white ? .18 : .27, .045);
    if (kind === 'birch') branch([.1, 0, .4], [-.55 + leanX, .35, height - .75], .14, .035);
    for (let b = 0; b < 8; b++) {
      const a = b * 2.4 + rand(9), z = 1.7 + b * .39;
      const reach = width * (.6 + rand(b + 20) * .33);
      const end = [Math.cos(a) * reach + leanX, Math.sin(a) * reach + leanY, Math.min(height, z + 1.5)];
      branch([leanX * z / height, leanY * z / height, z], end, .11 - b * .005, .025);
      if (season === 3) branch(end, [end[0] + Math.cos(a + .6) * .45, end[1] + Math.sin(a + .6) * .45, end[2] + .5], .03, .012);
    }
    for (let n = 0; n < 210; n++) {
      const a = rand(n + 100) * 6.283, tilt = rand(n + 400) * 2 - 1;
      const distance = Math.cbrt(rand(n + 600)), flat = Math.sqrt(1 - tilt * tilt);
      const z = height - 1.25 + tilt * distance * stretch;
      const lobe = .84 + .16 * Math.sin(a * 5 + variant);
      leaf(leanX + Math.cos(a) * flat * distance * width * lobe,
        leanY + Math.sin(a) * flat * distance * width, z,
        .21 + rand(n + 800) * .2, n);
    }
    if (white) for (let k = 0; k < 5; k++) {
      const z = .7 + k * .59;
      branch([leanX * z / height - .12, leanY * z / height - .08, z], [leanX * z / height + .1, leanY * z / height, z + .035], .025, .025, [84, 91, 76]);
    }
    if (kind === 'rowan' && season !== 3) for (let n = 0; n < 13; n++) {
      const a = n * 2.4, rad = .9 + rand(n + 510) * .6;
      r.sphere(...point(Math.cos(a) * rad, Math.sin(a) * rad, 3.5 + rand(n + 910) * .9), .075 * scale, [188, 80, 48]);
    }
  }
  r.shadeEdges();
  return r.sprite();
}

export function drawGroundPlant(r, e, x, y, z, env, time, groundAt, reducedMotion) {
  const kind = e.kind, scale = e.scale || 1, seed = e.seed;
  const rand = salt => hash(seed + salt, salt * .317);
  const winter = env.seasonIndex === 3, autumn = env.seasonIndex === 2;
  const green = winter ? [160, 174, 153] : autumn ? [126, 125, 66] : [80, 117, 61];
  const light = winter ? [218, 224, 208] : autumn ? [175, 153, 81] : [137, 161, 82];
  const wind = reducedMotion ? 0 : (Math.sin(time * 1.25 - x * .19 + y * .15) + .4 * Math.sin(time * 2.1 - x * .31)) * .12;
  if (kind === 'lily') {
    for (let k = 0; k < 5; k++) {
      const dx = (rand(k + 3) - .5) * 1.8, dy = (rand(k + 8) - .5) * 1.4;
      r.ellipsoid(x + dx, y + dy, z + .025, .22, .18, .025, [102, 137, 75]);
      if (k === 1 && !winter) { r.sphere(x + dx, y + dy, z + .09, .08, [226, 194, 187]); r.plot(x + dx, y + dy, z + .16, [240, 216, 128]); }
    }
    return;
  }
  if (kind === 'bush') {
    for (let k = 0; k < 15; k++) {
      const a = rand(k + 70) * 6.283, d = Math.sqrt(rand(k + 80)) * .75 * scale;
      const dx = Math.cos(a) * d, dy = Math.sin(a) * d, zz = groundAt(x + dx, y + dy);
      r.sphere(x + dx + wind * .5, y + dy, zz + .22 + (1 - d / (.8 * scale)) * .4, .21 * scale, k % 4 ? green : light, 'rough');
      if (!winter && k % 5 === 0) r.sphere(x + dx + wind * .5, y + dy - .08, zz + .48, .045, [168, 71, 62]);
    }
    return;
  }
  const count = kind === 'fern' ? 7 : kind === 'reeds' ? 8 : kind === 'flowers' ? 10 : 15;
  for (let k = 0; k < count; k++) {
    const dx = (rand(k + 5) - .5) * (kind === 'grass' ? 2.2 : 1.2) * scale;
    const dy = (rand(k + 9) - .5) * (kind === 'grass' ? 1.8 : 1) * scale;
    const zz = groundAt(x + dx, y + dy), a = rand(k + 15) * 6.283;
    const h = (kind === 'reeds' ? .9 + rand(k + 20) * .7 : kind === 'fern' ? .42 + rand(k + 20) * .3 : .19 + rand(k + 20) * .4) * scale;
    const lean = wind * h + Math.cos(a) * .16;
    const base = [x + dx, y + dy, zz], mid = [x + dx + lean * .25, y + dy, zz + h * .55];
    const tip = [x + dx + lean, y + dy + Math.sin(a) * .1, zz + h];
    r.line(base, mid, green); r.line(mid, tip, k % 3 ? green : light);
    if (kind === 'fern') {
      for (let j = 1; j <= 4; j++) {
        const t = j / 5, stem = [lerp(base[0], tip[0], t), lerp(base[1], tip[1], t), zz + h * t];
        const spread = Math.sin(t * Math.PI) * .28 * scale;
        for (const side of [-1, 1]) r.line(stem, [stem[0] + Math.cos(a) * spread * side + lean * .15, stem[1] + Math.sin(a) * spread * side, stem[2] + .07], j % 2 ? green : light);
      }
    } else if (kind === 'reeds') {
      if (k % 3 === 0) r.line([tip[0], tip[1], tip[2] - .22], tip, [118, 88, 54], 2);
      r.line(mid, [mid[0] + .29 + wind, mid[1] - .1, mid[2] + .16], light);
    } else if (kind === 'flowers' && !winter) {
      const palette = [[222, 204, 132], [171, 157, 198], [229, 224, 195], [202, 135, 131]];
      r.sphere(...tip, .055 + rand(k + 60) * .025, palette[Math.floor(rand(seed) * palette.length)]);
    } else if (k % 3 === 0 && !winter) {
      r.line(mid, [tip[0] + Math.cos(a) * .14, tip[1] + Math.sin(a) * .14, tip[2] * .45 + mid[2] * .55], light);
    }
  }
}
