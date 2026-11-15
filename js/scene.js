import { Raster, rgb, hash, lerp, clamp, SIN, COS, R2 } from './pixel.js?v=5';
import { pathAt, trailProfileAt, biomeAt, riverAt, waterAt, environment, TrailWorld } from './world.js?v=5';
import { LandscapeTerrain } from './landscape.js?v=5';
import { drawTraveller, drawCreature } from './actors.js?v=5';
import { WildlifeDirector } from './wildlife.js?v=5';
import { SPECIES } from './bestiary.js?v=5';
import { makeTreeSprite, drawGroundPlant } from './vegetation.js?v=5';

const PAPER = rgb(250, 249, 246);
export class ForestScene {
  constructor(canvas, seed) {
    this.canvas = canvas;
    this.seed = seed;
    this.world = new TrailWorld(seed);
    this.terrain = new LandscapeTerrain(seed);
    this.sprites = new Map(); this.active = []; this.visibleAnimals = [];
    this.wildlife = new WildlifeDirector(seed); this.hitTargets = []; this.lastState = null; this.ripples = [];
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize(canvas.clientWidth || 960, canvas.clientHeight || 460);
  }
  resize(cssWidth, cssHeight) {
    if (!(cssWidth > 0 && cssHeight > 0)) return;
    // Keep the original small pixel figures. A larger stage adds more world
    // pixels instead of magnifying and cropping the old square view.
    this.cssWidth = cssWidth; this.cssHeight = cssHeight;
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
    const band = Math.round(clamp(size, .65, 1.35) * 6) / 6;
    const key = `${kind}:${season}:${variant}:${band}`;
    if (this.sprites.has(key)) return this.sprites.get(key);
    const sprite = makeTreeSprite(kind, season, variant, band, this.r.scale);
    if (this.sprites.size >= 192) this.sprites.delete(this.sprites.keys().next().value);
    this.sprites.set(key, sprite);
    return sprite;
  }
  treeShadow(e, x, y, z, env) {
    const r = this.r, scale = e.scale || 1;
    r.shadow(x, y, z, .32 * scale, .7);
    if (e.variant === 'snag') return;
    const amount = (1 - env.night * .7) * (env.seasonIndex === 3 && !['pine', 'cedar', 'spruce', 'cypress'].includes(e.variant) ? .35 : 1);
    // A few overlapping, feathered foliage shadows follow the actual hillside.
    // The spaces between them leave the forest floor dappled with daylight.
    for (let k = 0; k < 6; k++) {
      const dx = 1.2 + hash(e.seed, k + 19) * 1.75, dy = .2 + (hash(e.seed, k + 31) - .5) * 1.7;
      const xx = x + dx * scale, yy = y + dy * scale;
      const ground = this.surface(-yy, xx);
      r.shadow(xx, yy, ground, (.65 + hash(k, e.seed) * .55) * scale, amount * .29);
    }
  }
  hitTest(cssX, cssY) {
    let chosen = null, nearest = Infinity;
    for (const target of this.hitTargets) {
      const distance = Math.hypot(cssX - target.cssX, cssY - target.cssY) / target.radius;
      if (distance <= 1 && distance < nearest) { chosen = target; nearest = distance; }
    }
    return chosen;
  }
  interactAt(cssX, cssY, state = this.lastState) {
    const target = this.hitTest(cssX, cssY);
    if (target && state) return this.interactWith(target.id, state);
    return state ? this.touchWater(cssX, cssY, state) : null;
  }
  touchWater(cssX, cssY, state) {
    const r = this.r, sx = cssX / this.cssWidth * r.width, sy = cssY / this.cssHeight * r.height;
    if (sx < 0 || sx >= r.width || sy < 0 || sy >= r.height) return null;
    const index = Math.floor(sy) * r.width + Math.floor(sx);
    if (Math.abs(r.depth[index] - r.groundZ[index]) > .12) return null;
    const planes = new Set();
    for (const row of this.terrain.rows) {
      if (row.river) planes.add(row.river.level);
      for (const pool of row.pools) planes.add(pool.level);
    }
    for (const level of planes) {
      const u = (sx - r.ox) / r.scale;
      const v = ((sy - r.oy) / r.scale + (level - r.cameraZ) * COS) / SIN;
      const x = r.cameraX + (u + v) / R2, y = r.cameraY + (v - u) / R2;
      const wet = waterAt(-y, x, this.seed);
      if (!wet || Math.abs(wet.level - level) > .025 || Math.abs(r.project(x, y, level).d - r.groundZ[index]) > .18) continue;
      if (this.ripples.length >= 12) this.ripples.shift();
      this.ripples.push({ x, s: -y, z: level, time: state.elapsed });
      return { id: 'water', species: 'water', name: 'The water', action: 'splash', sound: 'splash',
        message: wet.kind === 'swamp' ? 'Small ripples drift between the reeds.' : 'A little splash joins the current.' };
    }
    return null;
  }
  interactEntity(id, state = this.lastState) { return this.interactWith(id, state); }
  interactWith(id, state = this.lastState) {
    const target = this.hitTargets.find(value => value.id === id);
    if (!target || !state) return null;
    return this.wildlife.interact(target.entity, state.elapsed, this.travellerPosition);
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
      // Broken rock has planes and an irregular footprint, not stacked spheres.
      const gray = env.seasonIndex === 3 ? [177, 188, 178] : [119, 128, 115];
      const points = [];
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * Math.PI * 2, reach = (.44 + hash(seed, k + 8) * .27) * scale;
        const xx = x + Math.cos(a) * reach, yy = y + Math.sin(a) * reach * .75;
        points.push([xx, yy, this.surface(-yy, xx) + .025]);
      }
      const peak = [x + (hash(seed, 30) - .5) * .23, y + (hash(seed, 31) - .5) * .2, z + (.24 + hash(seed, 32) * .38) * scale];
      for (let k = 0; k < 6; k++) {
        const light = [1.12, 1.02, .77, .69, .86, 1.16][k];
        r.triangle(peak, points[k], points[(k + 1) % 6], gray.map(v => v * light));
      }
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
      drawGroundPlant(r, e, x, y, z, env, time, (xx, yy) => {
        const wet = e.kind === 'lily' ? waterAt(-yy, xx, this.seed) : null;
        return wet ? wet.level : this.surface(-yy, xx);
      }, this.reducedMotion);
    }
  }
  waterLife(state, env) {
    const r = this.r, time = state.elapsed;
    // Flowing threads and small expanding rings remain in world space. Ripples
    // are clipped to the water and use its depth, so banks occlude them naturally.
    const first = Math.floor((state.distance - this.terrain.radius) / 18), last = Math.ceil((state.distance + this.terrain.radius) / 18);
    for (let chunk = first; chunk <= last; chunk++) for (let n = 0; n < 6; n++) {
      const k = chunk * 6 + n;
      const s = chunk * 18 + hash(k, 812) * 18;
      const x = pathAt(s, state.seed) + (hash(k, 813) - .5) * 47;
      const wet = waterAt(s, x, this.seed);
      if (!wet) continue;
      const phase = (time * (wet.kind === 'swamp' ? .18 : .32) + hash(k, 814)) % 1;
      if (wet.kind === 'stream') {
        const xx = x + phase * 1.3;
        r.line([xx, -s, wet.level + .035], [xx + .3 + hash(k, 815) * .45, -s + .035, wet.level + .035], [149, 192, 178]);
      } else if (phase < .8) {
        const radius = phase * .65;
        for (let q = 0; q < 12; q++) {
          const a = q / 12 * Math.PI * 2;
          r.plot(x + Math.cos(a) * radius, -s + Math.sin(a) * radius, wet.level + .025, [130, 164, 132]);
        }
      }
    }
    this.ripples = this.ripples.filter(ripple => time - ripple.time < 2.3);
    for (const ripple of this.ripples) {
      const age = time - ripple.time, fade = clamp(1 - age / 2.3, 0, 1);
      for (let ring = 0; ring < 2; ring++) {
        const radius = .12 + age * .8 - ring * .25;
        if (radius <= 0) continue;
        const color = [lerp(78, 203, fade), lerp(132, 217, fade), lerp(137, 190, fade)];
        for (let k = 0; k < 24; k++) {
          const a = k / 24 * Math.PI * 2, b = (k + 1) / 24 * Math.PI * 2;
          const x = ripple.x + Math.cos(a) * radius, s = ripple.s - Math.sin(a) * radius;
          if (!waterAt(s, x, this.seed)) continue;
          r.line([x, -s, ripple.z + .035], [ripple.x + Math.cos(b) * radius, -ripple.s + Math.sin(b) * radius, ripple.z + .035], color);
        }
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
    this.lastState = state;
    const profile = trailProfileAt(state.distance, state.seed);
    r.cameraX = profile.x; r.cameraY = -state.distance; r.cameraZ = profile.height;
    this.terrain.prepare(state, r);
    r.clear(PAPER); this.terrain.draw(state, env, r);
    this.world.update(state.distance, this.terrain.radius);
    this.wildlife.prune(this.world.entities);
    const active = this.active; active.length = 0;
    for (const e of this.world.entities) {
      const motion = e.kind === 'animal' ? this.wildlife.sample(e, state.elapsed, state.seed) : null;
      const s = motion ? motion.s : e.s;
      const relative = s - state.distance;
      if (Math.abs(relative) > this.terrain.radius) continue;
      const x = motion ? motion.x : pathAt(s, state.seed) + e.side;
      const y = -s;
      if (e.kind !== 'animal' && e.kind !== 'tree' && e.kind !== 'lily') {
        const grade = this.terrain.gradeAt(s, x);
        if (grade > .95 && (e.kind !== 'grass' || grade > 1.45 || hash(e.seed, 442) > .2)) continue;
      }
      const aquatic = e.kind === 'animal' && SPECIES[e.variant]?.habitat === 'water';
      const wet = aquatic || e.kind === 'lily' ? waterAt(s, x, this.seed) : null;
      const z = aquatic ? (motion.waterLevel ?? wet?.level ?? e.water?.level ?? this.surface(s, x))
        : e.kind === 'lily' && (wet || e.water) ? (wet || e.water).level : this.surface(s, x);
      const point = r.project(x, y, z);
      const margin = e.kind === 'tree' ? 35 : e.kind === 'animal' ? 30 : 18;
      const crown = e.kind === 'tree' ? (['aspen', 'cypress', 'spruce', 'birch'].includes(e.variant) ? 8 : 6.5) * r.scale * (e.scale || 1) * .87 + 9 : 35;
      if (point.sx < -margin || point.sx > r.width + margin || point.sy < -8 || point.sy > r.height + crown) continue;
      if (e.kind === 'tree') this.treeShadow(e, x, y, z, env);
      if (e.kind === 'rock') r.shadow(x + .1, y, z, .5, .6);
      active.push({ e, x, y, z, motion });
    }
    r.applyShadows();
    const bridges = new Map();
    for (let s = state.distance - this.terrain.radius; s <= state.distance + this.terrain.radius; s += 4) {
      const river = riverAt(s, state.seed);
      if (river) bridges.set(river.center, river);
    }
    this.waterLife(state, env);
    for (const river of bridges.values()) this.bridge(river);
    const treeCount = active.filter(v => v.e.kind === 'tree').length;
    const resting = state.mode === 'snack' || state.mode === 'sleep';
    const normal = Math.hypot(1, profile.slope);
    const px = r.cameraX + (resting ? 1.12 / normal : 0);
    const py = r.cameraY + (resting ? 1.12 * profile.slope / normal : 0);
    const travellerGround = this.surface(-py, px);
    this.travellerPosition = { x: px, y: py };
    const protectedPoint = r.project(px, py, travellerGround + (resting ? .6 : 1.2));
    const pixelScale = r.scale / 12;
    r.cutaways = [{ x: protectedPoint.sx, y: protectedPoint.sy, d: protectedPoint.d, rx: (resting ? 25 : 18) * pixelScale, ry: (resting ? 20 : 27) * pixelScale }];
    for (const animal of active) {
      if (!animal.motion || Math.abs(animal.motion.s - state.distance) > 9) continue;
      const point = r.project(animal.x, animal.y, animal.z + .6 + animal.motion.hop);
      r.cutaways.push({ x: point.sx, y: point.sy, d: point.d, rx: 15 * pixelScale, ry: 15 * pixelScale });
    }
    this.visibleAnimals.length = 0; this.hitTargets.length = 0;
    for (const { e, x, y, z, motion } of active) {
      if (e.kind === 'tree') {
        const sprite = this.treeSprite(e.variant || 'oak', env.seasonIndex, Math.abs(e.seed | 0) % 16, e.scale || 1);
        const sway = this.reducedMotion ? 0 : (Math.sin(state.elapsed * .85 - x * .17 + y * .11) + .3 * Math.sin(state.elapsed * 1.4 + e.seed)) * 1.2 * pixelScale;
        r.blit(sprite, x, y, z, sway);
      } else if (e.kind === 'animal') {
        const near = Math.abs(motion.s - state.distance), kind = e.variant || 'deer';
        const species = SPECIES[kind] || { name: kind, height: 1, hitRadius: 1 };
        const location = r.project(x, y, z + (species.height || .7) * (e.scale || 1) * .5 + (motion.hop || 0));
        const extent = Math.ceil(Math.max(species.hitRadius || 1, species.height || 1) * (e.scale || 1) * r.scale + 7);
        const x0 = Math.max(0, Math.floor(location.sx - extent)), x1 = Math.min(r.width - 1, Math.ceil(location.sx + extent));
        const y0 = Math.max(0, Math.floor(location.sy - extent)), y1 = Math.min(r.height - 1, Math.ceil(location.sy + extent));
        const before = [];
        for (let iy = y0; iy <= y1; iy += 2) for (let ix = x0; ix <= x1; ix += 2) before.push(r.depth[iy * r.width + ix]);
        drawCreature(r, { x, y, z, time: state.elapsed, kind, seed: e.seed, scale: e.scale || 1, motion, groundAt: species.habitat === 'water' || species.habitat === 'air' ? null : (xx, yy) => this.surface(-yy, xx), resting: state.mode === 'snack', night: env.night > .4 });
        const samples = []; let k = 0;
        for (let iy = y0; iy <= y1; iy += 2) for (let ix = x0; ix <= x1; ix += 2) {
          const index = iy * r.width + ix, depth = r.depth[index];
          if (depth > before[k] + .00001) samples.push({ index, depth });
          k++;
        }
        if (near < 12 && samples.length) this.visibleAnimals.push({ id: e.id, kind, name: species.name, distance: near });
        const cssX = location.sx / r.width * this.cssWidth, cssY = location.sy / r.height * this.cssHeight;
        if (samples.length && cssX >= 0 && cssX <= this.cssWidth && cssY >= 0 && cssY <= this.cssHeight) {
          this.hitTargets.push({ id: e.id, name: species.name, cssX, cssY,
            radius: Math.max(21, (species.hitRadius || .8) * r.scale * this.cssWidth / r.width * (e.scale || 1)),
            entity: e, depth: location.d, samples });
        }
      } else this.smallProp(e, x, y, z, env, state.elapsed);
    }
    drawTraveller(r, { x: px, y: py, z: travellerGround, yaw: Math.atan2(-1, profile.slope), grade: profile.grade / normal, groundAt: (x, y) => this.surface(-y, x), time: state.elapsed, distance: state.distance, mode: state.mode, modeTime: state.modeTime, night: env.night > .4, reducedMotion: this.reducedMotion });
    this.hitTargets = this.hitTargets.filter(target => target.samples.some(sample => Math.abs(r.depth[sample.index] - sample.depth) < .001));
    this.hitTargets.sort((a, b) => b.depth - a.depth);
    r.applyShadows(); r.shadeEdges(); this.lighting(env); this.particles(state, env); r.present();
    this.lastStats = { renderMs: performance.now() - started, chunks: this.world.chunks.size, entities: this.world.entities.length, trees: treeCount, sprites: this.sprites.size, visible: active.length };
    return env;
  }
}
