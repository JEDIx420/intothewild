import { terrainAt, trailProfileAt, riverAt, biomeAt } from './world.js?v=3';
import { rgb, hash, noise, clamp, lerp, SIN, COS, R2 } from './pixel.js?v=3';

const GRASS = [[118, 140, 88], [108, 131, 78], [151, 133, 85], [201, 213, 205]];
const SHADOW_STEPS = [3, 6, 10, 16, 24];
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

/** A bounded, textured heightfield. The world grows; the render allocation does not. */
export class LandscapeTerrain {
  constructor(seed) {
    this.seed = seed;
    this.radius = 60;
    this.step = 1;
    this.key = '';
    this.count = 0;
    this.rows = [];
  }

  prepare(state, r) {
    // Include elevated shoulders behind the flat viewport corners as well as
    // the foreground. A high ridge can hide the ground behind it correctly.
    const halfWidth = r.width / (2 * r.scale);
    const vertical = Math.max(r.oy, r.height - r.oy) / (r.scale * SIN);
    this.radius = clamp(Math.ceil((halfWidth + vertical) / R2 + 25), 40, 84);
    const x0 = Math.floor(r.cameraX) - this.radius;
    const s0 = Math.floor(state.distance) - this.radius;
    const n = this.radius * 2 + 1;
    const key = `${x0}:${s0}:${n}`;
    if (this.key === key) return;
    this.key = key;
    this.x0 = x0; this.s0 = s0; this.count = n;
    const length = n * n;
    if (!this.ground || this.ground.length !== length) {
      this.ground = new Float32Array(length);
      this.heights = new Float32Array(length);
      this.light = new Float32Array(length);
      this.steepness = new Float32Array(length);
      this.grain = new Float32Array(length);
      this.screenX = new Float32Array(length);
      this.screenY = new Float32Array(length);
      this.depth = new Float32Array(length);
    }
    this.rows = [];
    for (let j = 0; j <= (n - 1) * 4; j++) {
      const s = s0 + j * .25, profile = trailProfileAt(s, this.seed);
      let meadow = 0, enchanted = 0, stream = 0, weight = 0;
      // Blend the ground palette across a broad transition. Biome names can
      // change at one point; the earth must never acquire a straight seam.
      for (let offset = -8; offset <= 8; offset++) {
        const part = 9 - Math.abs(offset), biome = biomeAt(s + offset, this.seed);
        weight += part;
        if (biome === 'meadow') meadow += part;
        else if (biome === 'enchanted') enchanted += part;
        else if (biome === 'stream') stream += part;
      }
      this.rows.push({ ...profile, norm: 1 / Math.hypot(1, profile.slope),
        river: riverAt(s, this.seed), meadow: meadow / weight,
        enchanted: enchanted / weight, stream: stream / weight });
    }
    this.hasWater = this.rows.some(row => row.river !== null);
    const offset = (this.seed % 10000) / 100;
    for (let j = 0; j < n; j++) {
      const s = s0 + j, row = this.rows[j * 4];
      for (let k = 0; k < n; k++) {
        const x = x0 + k, i = j * n + k, base = terrainAt(s, x, this.seed);
        this.ground[i] = base;
        let z = this._walkSurface(s, x, base, row);
        const river = row.river;
        if (river && Math.abs(s - river.center + Math.sin(x * .34) * .28) < river.width * .5
          && Math.abs((x - row.x) * row.norm) > 1.28) z = Math.max(z, river.level);
        this.heights[i] = z;
        this.grain[i] = noise(x * .4 + offset, s * .4);
      }
    }
    for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      const i = j * n + k;
      const left = this.heights[j * n + Math.max(0, k - 1)];
      const right = this.heights[j * n + Math.min(n - 1, k + 1)];
      const back = this.heights[Math.max(0, j - 1) * n + k];
      const ahead = this.heights[Math.min(n - 1, j + 1) * n + k];
      const dx = (right - left) / (k > 0 && k < n - 1 ? 2 : 1);
      const ds = (ahead - back) / (j > 0 && j < n - 1 ? 2 : 1);
      const normalLength = Math.sqrt(1 + dx * dx + ds * ds);
      this.light[i] = clamp((.45 * dx - .55 * ds + .704) / normalLength, .18, 1);
      this.steepness[i] = Math.hypot(dx, ds);
    }
    // Distant shoulders cast a soft shadow into the valley. Normal lighting
    // alone makes even a tall ridge look painted onto a flat meadow.
    for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      const i = j * n + k, height = this.heights[i];
      let shade = 0;
      for (const distance of SHADOW_STEPS) {
        const x = Math.round(k - distance * .635);
        const s = Math.round(j + distance * .773);
        if (x < 0 || s >= n) continue;
        const rise = this.heights[s * n + x] - height;
        shade = Math.max(shade, clamp((rise - distance * .72) / (distance * .45), 0, 1));
      }
      this.light[i] *= 1 - shade * .53;
    }
  }

  row(s) {
    return this.rows[clamp(Math.round((s - this.s0) * 4), 0, this.rows.length - 1)];
  }

  height(s, x) {
    if (!this.ground || x < this.x0 || s < this.s0
      || x > this.x0 + this.count - 1 || s > this.s0 + this.count - 1) return terrainAt(s, x, this.seed);
    const gx = clamp(x - this.x0, 0, this.count - 1.00001);
    const gy = clamp(s - this.s0, 0, this.count - 1.00001);
    const ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy, i = iy * this.count + ix;
    return lerp(lerp(this.ground[i], this.ground[i + 1], fx),
      lerp(this.ground[i + this.count], this.ground[i + this.count + 1], fx), fy);
  }

  _walkSurface(s, x, base, row) {
    if (!row.river) return base;
    const side = Math.abs((x - row.x) * row.norm);
    // Keep a full-width level deck, then feather the dirt approaches into the
    // bank. The same rule is used for the mesh, traveller feet and staff.
    const influence = 1 - smooth((side - 1.3) / .55);
    return lerp(base, row.height, influence);
  }

  surface(s, x) {
    const profile = trailProfileAt(s, this.seed);
    const row = { ...profile, river: riverAt(s, this.seed), norm: 1 / Math.hypot(1, profile.slope) };
    return this._walkSurface(s, x, this.height(s, x), row);
  }

  draw(state, env, r) {
    const waterFrame = this.hasWater ? Math.floor(state.elapsed * 12) : 0;
    const cacheKey = `${this.key}:${r.width}:${r.height}:${r.ox}:${r.oy}:${r.scale}:${r.cameraX}:${r.cameraY}:${r.cameraZ}:${env.seasonIndex}:${waterFrame}`;
    if (this.cacheKey === cacheKey && this.cachedPixels?.length === r.pixels.length) {
      r.pixels.set(this.cachedPixels);
      r.depth.set(this.cachedDepth);
      r.groundZ.set(this.cachedDepth);
      return;
    }
    this.env = env;
    this.time = state.elapsed;
    this.baseGrass = GRASS[env.seasonIndex] || GRASS[0];
    this.seedOffset = (this.seed % 10000) / 100;
    const n = this.count, px = this.screenX, py = this.screenY, pd = this.depth;
    for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      const i = j * n + k;
      const x = this.x0 + k - r.cameraX;
      const y = -(this.s0 + j) - r.cameraY;
      const z = this.heights[i] - r.cameraZ;
      const u = (x - y) / R2, v = (x + y) / R2;
      px[i] = r.ox + u * r.scale;
      py[i] = r.oy + (v * SIN - z * COS) * r.scale;
      pd[i] = v * COS + z * SIN;
    }
    for (let j = 0; j < n - 1; j++) for (let k = 0; k < n - 1; k++) {
      const a = j * n + k, b = a + 1, c = a + n, d = c + 1;
      this._triangle(a, b, c, r);
      this._triangle(b, d, c, r);
    }
    r.groundZ.set(r.depth);
    if (this.cachedPixels?.length !== r.pixels.length) {
      this.cachedPixels = new Uint32Array(r.pixels.length);
      this.cachedDepth = new Float32Array(r.depth.length);
    }
    this.cachedPixels.set(r.pixels);
    this.cachedDepth.set(r.depth);
    this.cacheKey = cacheKey;
  }

  _triangle(a, b, c, r) {
    const ax = this.screenX[a], ay = this.screenY[a];
    const bx = this.screenX[b], by = this.screenY[b];
    const cx = this.screenX[c], cy = this.screenY[c];
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(r.width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(r.height - 1, Math.ceil(Math.max(ay, by, cy)));
    if (x0 > x1 || y0 > y1) return;
    const area = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(area) < .00001) return;
    const inv = 1 / area;
    const dax = (by - cy) * inv, day = (cx - bx) * inv;
    const dbx = (cy - ay) * inv, dby = (ax - cx) * inv;
    const n = this.count;
    const xa = this.x0 + a % n, xb = this.x0 + b % n, xc = this.x0 + c % n;
    const sa = this.s0 + Math.floor(a / n), sb = this.s0 + Math.floor(b / n), sc = this.s0 + Math.floor(c / n);
    const da = this.depth[a], db = this.depth[b], dc = this.depth[c];
    const ha = this.heights[a], hb = this.heights[b], hc = this.heights[c];
    const la = this.light[a], lb = this.light[b], lc = this.light[c];
    const ga = this.grain[a], gb = this.grain[b], gc = this.grain[c];
    const ea = this.steepness[a], eb = this.steepness[b], ec = this.steepness[c];
    for (let y = y0; y <= y1; y++) {
      let wa = dax * (x0 + .5 - cx) + day * (y + .5 - cy);
      let wb = dbx * (x0 + .5 - cx) + dby * (y + .5 - cy);
      let index = y * r.width + x0;
      for (let x = x0; x <= x1; x++, index++, wa += dax, wb += dbx) {
        const wc = 1 - wa - wb;
        if (wa < -.000001 || wb < -.000001 || wc < -.000001) continue;
        const depth = wa * da + wb * db + wc * dc;
        if (depth <= r.depth[index]) continue;
        const wx = wa * xa + wb * xb + wc * xc;
        const s = wa * sa + wb * sb + wc * sc;
        r.pixels[index] = this._color(wx, s,
          wa * ha + wb * hb + wc * hc,
          wa * la + wb * lb + wc * lc,
          wa * ga + wb * gb + wc * gc,
          wa * ea + wb * eb + wc * ec);
        r.depth[index] = depth;
      }
    }
  }

  _color(x, s, height, light, coarse, steep) {
    const row = this.row(s), env = this.env;
    const side = (x - row.x) * row.norm;
    const fine = hash(Math.floor(x * 17) + this.seedOffset, Math.floor(s * 17));
    const grit = (fine - .5) * 12;
    const onPath = Math.abs(side) < row.width + (coarse - .5) * .2;
    const river = row.river;
    const water = river && Math.abs(s - river.center + Math.sin(x * .34) * .28) < river.width * .5;
    let red, green, blue;
    if (water) {
      if (Math.abs(side) < 1.27) {
        const plank = ((s * 4.4) % 1 + 1) % 1;
        const seam = plank < .11;
        red = seam ? 91 : 157 + grit;
        green = seam ? 76 : 128 + grit;
        blue = seam ? 59 : 88 + grit;
      } else {
        const ripples = Math.sin(x * 4.1 + s * 7.3 + this.time * 1.5)
          + Math.sin(x * 1.8 - s * 3.1 - this.time * .7);
        const bank = Math.abs(s - river.center) / (river.width * .5);
        red = 57 + bank * 23 + coarse * 16;
        green = 113 + bank * 25 + coarse * 14;
        blue = 126 + bank * 15;
        if (ripples > 1.48 && fine > .38) { red += 58; green += 48; blue += 39; }
        if (env.seasonIndex === 3) { red += 49; green += 42; blue += 36; }
      }
    } else if (onPath) {
      const stone = fine > .976 ? 24 : fine < .024 ? -18 : 0;
      const grain = (coarse - .5) * 15 + grit + stone;
      red = 183 + grain - row.mountain * 10;
      green = 166 + grain - row.mountain * 5;
      blue = 126 + grain + row.mountain * 5;
      if (env.seasonIndex === 3) { red += 14; green += 19; blue += 28; }
    } else {
      const shade = (coarse - .5) * 24 + grit;
      const grass = this.baseGrass;
      red = grass[0] + shade;
      green = grass[1] + shade;
      blue = grass[2] + shade;
      red += row.meadow * 12 - row.enchanted * 12 - row.stream * 8;
      green += row.meadow * 9 - row.enchanted * 9 + row.stream * 2;
      blue += row.meadow * 2 - row.enchanted * 2 + row.stream * 8;
      // Exposed stone on the upper shoulders makes actual relief legible.
      const rock = row.mountain * smooth((height - row.height - .8) / 3.2)
        * smooth((coarse + steep * 1.8 - .3) / .5);
      const strata = Math.sin(height * 2.6 + s * .11 + x * .07 + coarse * 2.8);
      const ledge = strata > .8 ? 3 : strata < -.72 ? -5 : 0;
      red = lerp(red, 146 + grit + ledge, rock);
      green = lerp(green, 147 + grit + ledge * .92, rock);
      blue = lerp(blue, 137 + grit + ledge * .78, rock);
      const snow = smooth((height - row.height - (env.seasonIndex === 3 ? 4 : 11)) / 4.5) * row.mountain;
      red = lerp(red, 219 + grit * .5, snow);
      green = lerp(green, 225 + grit * .5, snow);
      blue = lerp(blue, 215 + grit * .5, snow);
      if (fine > .978) { red += 17; green += 17; blue += 9; }
      if (fine < .023) { red -= 19; green -= 15; blue -= 10; }
    }
    const slopeLight = (light - .704) * 128;
    return rgb(red + slopeLight, green + slopeLight * .92, blue + slopeLight * .72);
  }
}
