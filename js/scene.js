import { Raster, rgb, hash, lerp, clamp } from './pixel.js?v=3';
import { pathAt, trailProfileAt, biomeAt, riverAt, environment, TrailWorld } from './world.js?v=3';
import { LandscapeTerrain } from './landscape.js?v=3';
import { drawTraveller, drawCreature } from './actors.js?v=3';
import { sampleWildlife } from './wildlife.js?v=3';

const PAPER = rgb(250, 249, 246);
const LEAVES = [
  [[49, 83, 62], [91, 126, 75], [150, 169, 103]],
  [[38, 70, 57], [72, 106, 65], [123, 144, 80]],
  [[94, 65, 51], [154, 104, 54], [202, 151, 78]],
  [[84, 107, 102], [151, 168, 158], [218, 225, 211]],
];
const CROWN = [[.1, 0, 3.9, 1.5], [-1.2, -.7, 3.4, 1.1], [1.35, .55, 3.6, 1.25], [-.6, 1, 4.1, 1.1], [.8, -1, 4.2, 1.1], [.2, .1, 5, 1]];
const SPECIES = { fox: 'Red fox', deer: 'Woodland deer', rabbit: 'Wild rabbit', bird: 'Woodland bird', stag: 'Moonlit stag', spirit: 'Lantern spirit' };

export class ForestScene {
  constructor(canvas, seed) {
    this.canvas = canvas;
    this.seed = seed;
    this.world = new TrailWorld(seed);
    this.terrain = new LandscapeTerrain(seed);
    this.sprites = new Map(); this.active = []; this.visibleAnimals = [];
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize(canvas.clientWidth || 960, canvas.clientHeight || 460);
  }
  resize(cssWidth, cssHeight) {
    if (!(cssWidth > 0 && cssHeight > 0)) return;
    // Keep the original small pixel figures. A larger stage adds more world
    // pixels instead of magnifying and cropping the old square view.
    const renderScale = 10;
    const pixelScale = Math.max((cssWidth <= 600 ? .9 : 1.4) * 12 / renderScale,
      Math.sqrt(cssWidth * cssHeight / 400000));
    const width = Math.max(240, Math.round(cssWidth / pixelScale));
    const height = Math.max(120, Math.round(cssHeight / pixelScale));
    if (this.r?.width === width && this.r?.height === height) return;
    this.r = new Raster(width, height, renderScale, this.canvas);
    this.r.ox = width * .5; this.r.oy = height * .62;
    this.edgeFade = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const edgeDistance = Math.min(x / Math.max(8, width * .018),
        (width - 1 - x) / Math.max(8, width * .018),
        y / Math.max(8, height * .05), (height - 1 - y) / Math.max(8, height * .035));
      const t = clamp(edgeDistance, 0, 1);
      this.edgeFade[y * width + x] = 1 - t * t * (3 - 2 * t);
    }
  }
  height(s, x) { return this.terrain.height(s, x); }
  surface(s, x) { return this.terrain.surface(s, x); }
  treeSprite(kind, season, variant, size) {
    const band = size < .85 ? .78 : size > 1.12 ? 1.16 : .98;
    const key = `${kind}:${season}:${variant}:${band}`;
    if (this.sprites.has(key)) return this.sprites.get(key);
    const pixelScale = this.r.scale / 12;
    const r = new Raster(Math.ceil(142 * pixelScale), Math.ceil(150 * pixelScale), this.r.scale);
    r.ox = 71 * pixelScale; r.oy = 139 * pixelScale; r.clear();
    const scale = band, bark = kind === 'birch' ? [179, 178, 150] : [104, 83, 65];
    const twig = [82, 70, 59], colors = LEAVES[season];
    r.capsule([0, 0, 0], [.15 * scale, .08, 2.8 * scale], .24 * scale, .11 * scale, bark, 'rough');
    for (let j = 0; j < 4; j++) {
      const a = j * 1.7 + variant;
      r.capsule([0, 0, .17], [Math.cos(a) * .65, Math.sin(a) * .65, .01], .14, .04, bark, 'rough');
    }
    if (kind === 'pine') {
      r.capsule([.15, 0, 2.2 * scale], [.05, 0, 6.1 * scale], .12, .025, bark, 'rough');
      for (let level = 0; level < 5; level++) {
        const z = (1.9 + level * .8) * scale, spread = (1.65 - level * .25) * scale;
        for (let j = 0; j < 55; j++) {
          const a = hash(j + level * 91, variant + 7) * Math.PI * 2;
          const rad = Math.sqrt(hash(j + level * 21, variant + 9)) * spread;
          const zz = z + (1 - rad / spread) * .8;
          const col = season === 3 && hash(j, level) > .67 ? colors[2] : season === 2 ? [74, 99, 68] : [58 + level * 5, 91 + level * 4, 73 + level * 3];
          r.sphere(Math.cos(a) * rad, Math.sin(a) * rad, zz, (.17 + hash(j, 17) * .19) * scale, col, 'rough');
        }
      }
    } else {
      for (let j = 0; j < 7; j++) {
        const a = j * 2.4 + variant, z = (1.6 + j * .31) * scale;
        const tip = [Math.cos(a) * (1.05 + (j % 2) * .35) * scale, Math.sin(a) * 1.15 * scale, z + 1.25 * scale];
        r.capsule([.12, 0, z], tip, .12 * scale, .04 * scale, bark, 'rough');
        if (season === 3) {
          r.capsule(tip, [tip[0] + .4 * Math.cos(a - .8), tip[1] + .4 * Math.sin(a - .8), tip[2] + .55], .035, .018, twig, 'solid');
          r.capsule(tip, [tip[0] + .4 * Math.cos(a + .8), tip[1] + .4 * Math.sin(a + .8), tip[2] + .45], .035, .018, twig, 'solid');
        }
      }
      for (let n = 0; n < 265; n++) {
        if (season === 3 && hash(n, variant + 88) < .72) continue;
        const k = n + variant * 719, [cx, cy, cz, spread] = CROWN[n % CROWN.length];
        const a = hash(k, 7) * 6.283, tilt = hash(k, 8) * 2 - 1, d = Math.cbrt(hash(k, 9)) * spread, flat = Math.sqrt(1 - tilt * tilt);
        const x = cx + Math.cos(a) * flat * d, y = cy + Math.sin(a) * flat * d, z = cz + tilt * d * .8;
        const tone = hash(k, 10) + (z - 4.2) * .22 + (d / spread - .5) * .3;
        let color = colors[tone > .73 ? 2 : tone > .31 ? 1 : 0];
        if (kind === 'birch' && season < 2) color = [color[0] + 10, color[1] + 9, color[2]];
        r.sphere(x * scale, y * scale, z * scale, (.21 + hash(k, 11) * .21) * scale, color, 'rough');
      }
    }
    r.shadeEdges();
    const sprite = r.sprite();
    if (this.sprites.size >= 72) this.sprites.delete(this.sprites.keys().next().value);
    this.sprites.set(key, sprite); return sprite;
  }
  bridge(river) {
    const r = this.r, s0 = river.center - river.width * .5 - .55, s1 = river.center + river.width * .5 + .55;
    const timber = [128, 101, 72], highlight = [164, 139, 95];
    const deck = river.bridgeHeight;
    for (const side of [-1.35, 1.35]) {
      const rail = [];
      for (const s of [s0, river.center, s1]) {
        const profile = trailProfileAt(s, this.seed), normal = Math.hypot(1, profile.slope);
        const x = profile.x + side / normal, y = -s + side * profile.slope / normal;
        r.capsule([x, y, deck - .1], [x, y, deck + .71], .075, .06, timber, 'rough');
        rail.push([x, y, deck + .6]);
      }
      for (let n = 1; n < rail.length; n++) r.capsule(rail[n - 1], rail[n], .055, .055, highlight, 'rough');
    }
  }
  smallProp(e, x, y, z, env, time) {
    const r = this.r, scale = e.scale || 1, seed = e.seed;
    if (e.kind === 'rock') {
      const gray = env.seasonIndex === 3 ? [182, 193, 184] : [123, 132, 119];
      const mountain = biomeAt(e.s, this.seed) === 'mountain' && Math.abs(e.side) > 3;
      const size = scale * (mountain ? 1.65 : 1);
      r.ellipsoid(x, y, z + .24 * size, .61 * size, .4 * size, .38 * size, gray, 'rough');
      if (mountain) {
        r.ellipsoid(x + .22, y - .18, z + .43 * size, .44 * size, .37 * size, .29 * size, [141, 146, 136], 'rough');
        r.ellipsoid(x + .16, y - .1, z + .65 * size, .26 * size, .25 * size, .15 * size, env.seasonIndex === 3 ? [223, 227, 215] : [164, 165, 146], 'rough');
      } else r.sphere(x - .2, y + .05, z + .3, .2, [101, 124, 76], 'rough');
    } else if (e.kind === 'log') {
      r.capsule([x - .9, y, z + .2], [x + .9, y + .4, z + .21], .23, .26, [99, 77, 59], 'rough');
      r.sphere(x + .92, y + .4, z + .22, .22, [167, 139, 99], 'rough');
      for (let k = 0; k < 6; k++) r.sphere(x - .6 + k * .24, y + .18, z + .41, .14, [91, 120, 66], 'rough');
    } else if (e.kind === 'mushroom') {
      for (let k = 0; k < 4; k++) {
        const dx = (hash(seed + k, 5) - .5) * .9, dy = (hash(seed + k, 6) - .5) * .8, h = .2 + hash(k, seed) * .16;
        r.capsule([x + dx, y + dy, z], [x + dx, y + dy, z + h], .035, .03, [210, 194, 157]);
        r.ellipsoid(x + dx, y + dy, z + h, .13, .13, .08, env.night > .5 ? [127, 197, 161] : [184, 104, 71], env.night > .5 ? 'glow' : 'solid');
      }
    } else {
      for (let k = 0; k < 9; k++) {
        const dx = (hash(seed + k, 5) - .5) * 1.5, dy = (hash(seed + k, 9) - .5) * 1.1;
        const h = .18 + hash(k, seed) * .35;
        const sway = this.reducedMotion ? 0 : Math.sin(time * 1.2 + k) * .035;
        r.capsule([x + dx, y + dy, z], [x + dx + sway, y + dy, z + h], .025, .018, [83, 111, 65]);
        if (env.seasonIndex !== 3) r.sphere(x + dx + sway, y + dy, z + h, .055, k % 3 ? [222, 205, 144] : [180, 162, 191]);
      }
    }
  }
  particles(state, env) {
    const r = this.r, t = state.elapsed;
    const intensity = Math.round((env.night > .4 ? 23 : 10) * Math.sqrt(r.width * r.height / 163200));
    for (let k = 0; k < intensity; k++) {
      const x = r.cameraX + (hash(k, 90) - .5) * this.terrain.radius * 1.2 + Math.sin(t * .18 + k) * .7;
      const s = state.distance + (hash(k, 91) - .5) * this.terrain.radius * 1.2 + Math.cos(t * .15 + k) * .6;
      const z = this.height(s, x) + .7 + hash(k, 12) * 2.1 + Math.sin(t + k) * .22;
      const blink = Math.sin(t * 1.3 + k * 2.5);
      if (env.night > .4) {
        if (blink > -.15) {
          r.sphere(x, -s, z, .045, [223, 225, 151], 'glow');
          if (blink > .75) r.plot(x + .08, -s, z, [146, 188, 124]);
        }
      } else if (env.seasonIndex === 0 && k < 5) {
        r.plot(x, -s, z, [236, 211, 170]);
        r.plot(x + .1 * Math.sin(t * 12 + k), -s, z + .07, [247, 231, 192]);
      }
    }
    if (this.reducedMotion) return;
    if (env.weather === 'rain' || env.weather === 'snow' || env.seasonIndex === 2) {
      const snow = env.weather === 'snow', leaf = env.seasonIndex === 2 && env.weather !== 'rain';
      const count = snow ? 65 : leaf ? 16 : 55;
      for (let k = 0; k < count; k++) {
        const sx = 8 + ((hash(k, 28) * (r.width - 16) + t * (snow ? 4 : leaf ? 7 : 15)) % (r.width - 16));
        const sy = 30 + ((hash(k, 29) * (r.height - 40) + t * (snow ? 10 : leaf ? 15 : 130)) % (r.height - 40));
        const ix = sx | 0, iy = sy | 0, i = iy * r.width + ix;
        if (r.depth[i] < -1e8) continue;
        r.pixels[i] = snow ? rgb(238, 241, 233) : leaf ? rgb(185, 130, 68) : rgb(162, 183, 180);
        if (!snow && !leaf && iy > 1) r.pixels[i - r.width] = rgb(156, 178, 177);
      }
    }
  }
  lighting(env) {
    const r = this.r, night = env.night;
    const dusk = Math.max(0, 1 - Math.abs(env.hour - 18) / 2.7), dawn = Math.max(0, 1 - Math.abs(env.hour - 7) / 2.1);
    const red = lerp(1, .43, night), green = lerp(1, .53, night), blue = lerp(1, .75, night);
    for (let i = 0; i < r.pixels.length; i++) {
      if (r.depth[i] < -1e8) continue;
      const c = r.pixels[i];
      const haze = clamp((-r.depth[i] - 5) / 65, 0, 1) * (env.weather === 'mist' ? .34 : .12);
      const cr = lerp((c & 255) * red + dusk * 16 + dawn * 5, lerp(208, 58, night), haze);
      const cg = lerp((c >> 8 & 255) * green + dusk * 3, lerp(219, 73, night), haze);
      const cb = lerp((c >> 16 & 255) * blue + night * 12 - dusk * 4, lerp(208, 94, night), haze);
      const edge = this.edgeFade[i];
      r.pixels[i] = rgb(lerp(cr, 250, edge), lerp(cg, 249, edge), lerp(cb, 246, edge));
    }
  }
  draw(state) {
    const started = performance.now(), env = environment(state), r = this.r;
    const profile = trailProfileAt(state.distance, state.seed);
    r.cameraX = profile.x; r.cameraY = -state.distance; r.cameraZ = profile.height;
    this.terrain.prepare(state, r);
    r.clear(PAPER); this.terrain.draw(state, env, r);
    this.world.update(state.distance, this.terrain.radius);
    const active = this.active; active.length = 0;
    for (const e of this.world.entities) {
      const motion = e.kind === 'animal' ? sampleWildlife(e, state.elapsed, state.seed) : null;
      const s = motion ? motion.s : e.s;
      const relative = s - state.distance;
      if (Math.abs(relative) > this.terrain.radius) continue;
      const x = motion ? motion.x : pathAt(s, state.seed) + e.side;
      const y = -s, z = this.surface(s, x);
      const point = r.project(x, y, z);
      if (point.sx < -85 || point.sx > r.width + 85 || point.sy < -15 || point.sy > r.height + 110) continue;
      if (e.kind === 'tree') r.shadow(x + 2.1, y + .5, z, (e.scale || 1) * 1.7);
      if (e.kind === 'rock') r.shadow(x + .3, y, z, .6);
      active.push({ e, x, y, z, motion });
    }
    r.shadow(r.cameraX + .5, r.cameraY, this.surface(state.distance, r.cameraX), .6);
    r.applyShadows();
    const bridges = new Map();
    for (let s = state.distance - this.terrain.radius; s <= state.distance + this.terrain.radius; s += 4) {
      const river = riverAt(s, state.seed);
      if (river) bridges.set(river.center, river);
    }
    for (const river of bridges.values()) this.bridge(river);
    const treeCount = active.filter(v => v.e.kind === 'tree').length;
    const resting = state.mode === 'snack' || state.mode === 'sleep';
    const normal = Math.hypot(1, profile.slope);
    const px = r.cameraX + (resting ? 1.12 / normal : 0);
    const py = r.cameraY + (resting ? 1.12 * profile.slope / normal : 0);
    const travellerGround = this.surface(-py, px);
    const protectedPoint = r.project(px, py, travellerGround + (resting ? .6 : 1.2));
    const pixelScale = r.scale / 12;
    r.cutaways = [{ x: protectedPoint.sx, y: protectedPoint.sy, d: protectedPoint.d, rx: (resting ? 25 : 18) * pixelScale, ry: (resting ? 20 : 27) * pixelScale }];
    for (const animal of active) {
      if (!animal.motion || Math.abs(animal.motion.s - state.distance) > 9) continue;
      const point = r.project(animal.x, animal.y, animal.z + .6 + animal.motion.hop);
      r.cutaways.push({ x: point.sx, y: point.sy, d: point.d, rx: 15 * pixelScale, ry: 15 * pixelScale });
    }
    this.visibleAnimals.length = 0;
    for (const { e, x, y, z, motion } of active) {
      if (e.kind === 'tree') {
        const sprite = this.treeSprite(e.variant || 'oak', env.seasonIndex, Math.abs(e.seed | 0) % 3, e.scale || 1);
        const sway = this.reducedMotion ? 0 : Math.sin(Math.floor(state.elapsed * 8) / 8 * .8 + e.seed) * 1.1 * pixelScale;
        r.blit(sprite, x, y, z, sway);
      } else if (e.kind === 'animal') {
        const near = Math.abs(motion.s - state.distance), kind = e.variant || 'deer';
        drawCreature(r, { x, y, z, time: state.elapsed, kind, seed: e.seed, scale: e.scale || 1, motion, resting: state.mode === 'snack', night: env.night > .4 });
        if (near < 8) this.visibleAnimals.push({ id: e.id, kind, name: SPECIES[kind] || kind, distance: near });
      } else this.smallProp(e, x, y, z, env, state.elapsed);
    }
    drawTraveller(r, { x: px, y: py, z: travellerGround, yaw: Math.atan2(-1, profile.slope), grade: profile.grade / normal, groundAt: (x, y) => this.surface(-y, x), time: state.elapsed, distance: state.distance, mode: state.mode, modeTime: state.modeTime, night: env.night > .4, reducedMotion: this.reducedMotion });
    r.applyShadows(); r.shadeEdges(); this.lighting(env); this.particles(state, env); r.present();
    this.lastStats = { renderMs: performance.now() - started, chunks: this.world.chunks.size, entities: this.world.entities.length, trees: treeCount, sprites: this.sprites.size, visible: active.length };
    return env;
  }
}
