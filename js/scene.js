import { Raster, rgb, hash, noise, lerp, clamp, SIN, COS, R2, bayer } from './pixel.js';
import { pathAt, terrainAt, biomeAt, riverAt, environment, TrailWorld } from './world.js';
import { drawTraveller, drawCreature } from './actors.js';

const PAPER = rgb(250, 249, 246);
const LEAVES = [
  [[49, 83, 62], [91, 126, 75], [150, 169, 103]],
  [[38, 70, 57], [72, 106, 65], [123, 144, 80]],
  [[94, 65, 51], [154, 104, 54], [202, 151, 78]],
  [[84, 107, 102], [151, 168, 158], [218, 225, 211]],
];
const GRASS = [[124, 145, 90], [113, 132, 77], [157, 139, 88], [203, 214, 205]];
const CROWN = [[.1, 0, 3.9, 1.5], [-1.2, -.7, 3.4, 1.1], [1.35, .55, 3.6, 1.25], [-.6, 1, 4.1, 1.1], [.8, -1, 4.2, 1.1], [.2, .1, 5, 1]];
const SPECIES = { fox: 'Red fox', deer: 'Woodland deer', rabbit: 'Wild rabbit', bird: 'Woodland bird', stag: 'Moonlit stag', spirit: 'Lantern spirit' };

export class ForestScene {
  constructor(canvas, seed) {
    this.r = new Raster(480, 340, 12, canvas);
    this.r.oy = 218;
    this.seed = seed; this.world = new TrailWorld(seed);
    this.sprites = new Map(); this.active = []; this.visibleAnimals = [];
    this.grid = new Float32Array(97 * 97); this.gridKey = '';
    this.heightRows = 97; this.step = .5;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.inverseX = new Float32Array(480 * 340); this.inverseY = new Float32Array(480 * 340);
    for (let y = 0; y < 340; y++) for (let x = 0; x < 480; x++) {
      const u = (x + .5 - this.r.ox) / 12, v = (y + .5 - this.r.oy) / (12 * SIN), i = y * 480 + x;
      this.inverseX[i] = (u + v) / R2; this.inverseY[i] = (v - u) / R2;
    }
    this.shades = new Uint32Array(256 * 3);
  }
  updateGrid(state) {
    const x = Math.floor(pathAt(state.distance, state.seed) * 2) / 2 - 24;
    const s = Math.floor(state.distance * 2) / 2 - 24;
    const key = `${x}:${s}`;
    if (key === this.gridKey) return;
    this.gridKey = key; this.gridX = x; this.gridS = s;
    for (let j = 0; j < 97; j++) for (let k = 0; k < 97; k++) {
      this.grid[j * 97 + k] = terrainAt(s + j * .5, x + k * .5, state.seed);
    }
    // Along-trail samples avoid repeating trigonometry for each ground pixel.
    this.rows = [];
    for (let j = 0; j < 194; j++) {
      const v = s + j * .25;
      this.rows.push({ path: pathAt(v, state.seed), biome: biomeAt(v, state.seed), river: riverAt(v, state.seed) });
    }
  }
  height(s, x) {
    const gx = clamp((x - this.gridX) * 2, 0, 95.999), gy = clamp((s - this.gridS) * 2, 0, 95.999);
    const ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy, i = iy * 97 + ix;
    return lerp(lerp(this.grid[i], this.grid[i + 1], fx), lerp(this.grid[i + 97], this.grid[i + 98], fx), fy);
  }
  row(s) { return this.rows[clamp(Math.floor((s - this.gridS) * 4), 0, 193)]; }
  surface(s, x) {
    let h = this.height(s, x);
    const river = riverAt(s, this.seed);
    if (river && Math.abs(s - river.center) < river.width * .5 + .4 && Math.abs(x - pathAt(s, this.seed)) < 1.3) h = .18;
    return h;
  }
  ground(state, env) {
    const r = this.r, w = r.width, seedOffset = (state.seed % 10000) / 100;
    const baseGrass = GRASS[env.seasonIndex] || GRASS[0];
    const time = state.elapsed;
    for (let iy = 75; iy < r.height; iy++) for (let ix = 7; ix < w - 7; ix++) {
      const i = iy * w + ix, bx = this.inverseX[i], by = this.inverseY[i];
      if (Math.abs(bx) > 24 || Math.abs(by) > 24) continue;
      let x = bx, y = by, z = 0;
      for (let iteration = 0; iteration < 3; iteration++) {
        z = this.height(state.distance - y, x + r.cameraX) - r.cameraZ;
        const delta = z * COS / (SIN * R2);
        x = bx + delta; y = by + delta;
      }
      const edge = Math.pow(Math.pow(Math.abs(x) / 16.2, 4) + Math.pow(Math.abs(y) / 14.4, 4), .25);
      if (edge > 1.025) continue;
      const wx = x + r.cameraX, s = state.distance - y;
      const fine = hash(Math.floor(wx * 12) + seedOffset, Math.floor(s * 12));
      if (edge > .94 && (edge - .94) / .085 > fine) continue;
      const row = this.row(s), side = wx - row.path;
      const coarse = noise(wx * .42 + seedOffset, s * .42), grit = (fine - .5) * 13;
      const pathEdge = 1.02 + (noise(wx * 1.1, s * .8) - .5) * .29;
      const onPath = Math.abs(side) < pathEdge;
      let red, green, blue;
      let actualHeight = z + r.cameraZ;
      const river = row.river;
      const water = river && Math.abs(s - river.center + Math.sin(wx * .34) * .28) < river.width * .5;
      if (water) {
        if (Math.abs(side) < 1.27) {
          const plank = Math.floor(s * 4.4), grain = hash(plank, Math.floor(wx * 18)) * 9;
          const seam = ((s * 4.4) % 1 + 1) % 1 < .10;
          red = seam ? 91 : 158 + grain; green = seam ? 76 : 128 + grain; blue = seam ? 59 : 87 + grain;
          actualHeight = .18;
        } else {
          const ripple = Math.sin(wx * 4.1 + s * 7.3 + time * 1.5) + Math.sin(wx * 1.8 - s * 3.1 - time * .7);
          const bank = Math.abs(s - river.center) / (river.width * .5);
          red = 64 + bank * 26 + coarse * 17; green = 119 + bank * 23 + coarse * 16; blue = 127 + bank * 17;
          if (ripple > 1.48 && fine > .38) { red += 57; green += 48; blue += 38; }
          if (env.seasonIndex === 3) { red += 52; green += 44; blue += 39; }
        }
      } else if (onPath) {
        const stone = fine > .979 ? 24 : fine < .023 ? -19 : 0;
        const trail = (coarse - .5) * 18 + grit + stone;
        red = 185 + trail; green = 169 + trail; blue = 132 + trail;
        if (env.seasonIndex === 3) { red += 12; green += 17; blue += 24; }
      } else {
        let shade = (coarse - .5) * 31 + grit;
        if (row.biome === 'enchanted') shade -= 16;
        red = baseGrass[0] + shade; green = baseGrass[1] + shade; blue = baseGrass[2] + shade;
        if (row.biome === 'mountain') { red += 9; green -= 2; blue += 16; }
        if (row.biome === 'meadow') { red += 12; green += 9; blue += 2; }
        if (row.biome === 'stream') { red -= 9; green += 1; blue += 8; }
        if (fine > .977) { red += 21; green += 21; blue += 11; }
        if (fine < .025) { red -= 24; green -= 17; blue -= 12; }
      }
      if (edge > .96) { red += 8; green += 8; blue += 6; }
      r.pixels[i] = rgb(red, green, blue);
      r.depth[i] = (x + y) / R2 * COS + (actualHeight - r.cameraZ) * SIN;
    }
    r.groundZ.set(r.depth);
  }
  treeSprite(kind, season, variant, size) {
    const band = size < .85 ? .78 : size > 1.12 ? 1.16 : .98;
    const key = `${kind}:${season}:${variant}:${band}`;
    if (this.sprites.has(key)) return this.sprites.get(key);
    const r = new Raster(142, 150, 12); r.ox = 71; r.oy = 139; r.clear();
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
    for (const side of [-1.35, 1.35]) {
      for (const s of [s0, river.center, s1]) {
        const x = pathAt(s, this.seed) + side;
        r.capsule([x, -s, .08], [x, -s, .89], .075, .06, timber, 'rough');
      }
      r.capsule([pathAt(s0, this.seed) + side, -s0, .78], [pathAt(s1, this.seed) + side, -s1, .78], .055, .055, highlight, 'rough');
    }
  }
  smallProp(e, x, y, z, env, time) {
    const r = this.r, scale = e.scale || 1, seed = e.seed;
    if (e.kind === 'rock') {
      const gray = env.seasonIndex === 3 ? [182, 193, 184] : [123, 132, 119];
      const mountain = biomeAt(e.s, this.seed) === 'mountain' && Math.abs(e.side) > 3;
      const size = scale * (mountain ? 2.5 : 1);
      r.ellipsoid(x, y, z + .24 * size, .61 * size, .4 * size, .38 * size, gray, 'rough');
      if (mountain) {
        r.ellipsoid(x + .22, y - .18, z + .71 * size, .39 * size, .32 * size, .51 * size, [141, 146, 136], 'rough');
        r.ellipsoid(x + .16, y - .1, z + 1.1 * size, .26 * size, .21 * size, .22 * size, env.seasonIndex === 3 ? [223, 227, 215] : [164, 165, 146], 'rough');
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
    const intensity = env.night > .4 ? 23 : 10;
    for (let k = 0; k < intensity; k++) {
      const x = r.cameraX + (hash(k, 90) - .5) * 23 + Math.sin(t * .18 + k) * .7;
      const s = state.distance + (hash(k, 91) - .5) * 23 + Math.cos(t * .15 + k) * .6;
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
        const sx = 35 + ((hash(k, 28) * 405 + t * (snow ? 4 : leaf ? 7 : 15)) % 405);
        const sy = 60 + ((hash(k, 29) * 250 + t * (snow ? 10 : leaf ? 15 : 130)) % 250);
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
      r.pixels[i] = rgb((c & 255) * red + dusk * 16 + dawn * 5, (c >> 8 & 255) * green + dusk * 3, (c >> 16 & 255) * blue + night * 12 - dusk * 4);
    }
  }
  draw(state) {
    const started = performance.now(), env = environment(state), r = this.r;
    this.updateGrid(state);
    r.cameraX = pathAt(state.distance, state.seed); r.cameraY = -state.distance;
    r.cameraZ = this.surface(state.distance, r.cameraX) * .7;
    r.clear(PAPER); this.ground(state, env);
    this.world.update(state.distance);
    const active = this.active; active.length = 0;
    for (const e of this.world.entities) {
      const relative = e.s - state.distance;
      if (Math.abs(relative) > 24) continue;
      const x = pathAt(e.s, state.seed) + e.side, y = -e.s, dx = x - r.cameraX, dy = y - r.cameraY;
      const edge = Math.pow(Math.pow(Math.abs(dx) / 15, 4) + Math.pow(Math.abs(dy) / 13.6, 4), .25);
      if (edge > .98) continue;
      const z = this.surface(e.s, x);
      if (e.kind === 'tree') r.shadow(x + 2.1, y + .5, z, (e.scale || 1) * 1.7);
      if (e.kind === 'rock') r.shadow(x + .3, y, z, .6);
      active.push({ e, x, y, z });
    }
    r.shadow(r.cameraX + .5, r.cameraY, this.surface(state.distance, r.cameraX), .6);
    r.applyShadows();
    const bridges = new Map();
    for (let s = state.distance - 20; s <= state.distance + 20; s += 4) {
      const river = riverAt(s, state.seed);
      if (river && Math.abs(river.center - state.distance) + river.width * .5 < 12.5) bridges.set(river.center, river);
    }
    for (const river of bridges.values()) this.bridge(river);
    const treeCount = active.filter(v => v.e.kind === 'tree').length;
    const resting = state.mode === 'snack' || state.mode === 'sleep';
    const travellerGround = this.surface(state.distance, r.cameraX + (resting ? 1.12 : 0));
    const protectedPoint = r.project(r.cameraX + (resting ? 1.12 : 0), r.cameraY, travellerGround + (resting ? .6 : 1.2));
    r.cutaways = [{ x: protectedPoint.sx, y: protectedPoint.sy, d: protectedPoint.d, rx: resting ? 25 : 18, ry: resting ? 20 : 27 }];
    this.visibleAnimals.length = 0;
    for (const { e, x, y, z } of active) {
      if (e.kind === 'tree') {
        const sprite = this.treeSprite(e.variant || 'oak', env.seasonIndex, Math.abs(e.seed | 0) % 3, e.scale || 1);
        const sway = this.reducedMotion ? 0 : Math.sin(Math.floor(state.elapsed * 8) / 8 * .8 + e.seed) * 1.1;
        r.blit(sprite, x, y, z, sway);
      } else if (e.kind === 'animal') {
        const near = Math.abs(e.s - state.distance), kind = e.variant || 'deer';
        const approach = state.mode === 'snack' && near < 8 ? clamp(state.modeTime / 5, 0, 1) * .8 : 0;
        const ax = lerp(x, r.cameraX + Math.sign(e.side) * 1.8, approach);
        const ay = y + (kind === 'bird' ? Math.sin(state.elapsed * .38 + e.seed) * .3 : Math.sin(state.elapsed * .23 + e.seed) * .13);
        const az = this.surface(-ay, ax);
        drawCreature(r, { x: ax, y: ay, z: az, time: state.elapsed, kind, seed: e.seed, scale: e.scale || 1, resting: state.mode === 'snack', night: env.night > .4 });
        if (near < 8) this.visibleAnimals.push({ id: e.id, kind, name: SPECIES[kind] || kind, distance: near });
      } else this.smallProp(e, x, y, z, env, state.elapsed);
    }
    const offset = state.mode === 'snack' || state.mode === 'sleep' ? 1.12 : 0;
    const px = r.cameraX + offset, py = r.cameraY, pz = this.surface(state.distance, px);
    drawTraveller(r, { x: px, y: py, z: pz, time: state.elapsed, distance: state.distance, mode: state.mode, modeTime: state.modeTime, night: env.night > .4, reducedMotion: this.reducedMotion });
    r.applyShadows(); r.shadeEdges(); this.lighting(env); this.particles(state, env); r.present();
    this.lastStats = { renderMs: performance.now() - started, chunks: this.world.chunks.size, entities: this.world.entities.length, trees: treeCount, sprites: this.sprites.size, visible: active.length };
    return env;
  }
}
