import { terrainAt, trailProfileAt, riverAt, biomeAt, swampPoolsAt } from './world.js?v=6';
import { Raster, rgb, hash, noise, clamp, lerp, SIN, COS, R2 } from './pixel.js?v=6';

const GRASS = [[111, 137, 81], [103, 127, 74], [147, 132, 80], [199, 211, 200]];
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
    this.padding = 64;
    this.anchor = null;
  }

  prepare(state, r) {
    // Orthographic projection changes by one translation when the camera
    // walks. Keep a padded, world-anchored terrain image for several seconds,
    // instead of shading the same quarter-million ground pixels every frame.
    const old = this.anchor, pad = this.padding;
    if (old && old.width === r.width && old.height === r.height && old.scale === r.scale) {
      const shift = this._shift(r);
      if (Math.abs(shift.x) < pad - 8 && Math.abs(shift.y) < pad - 8) return;
    }
    this.anchor = { width: r.width, height: r.height, scale: r.scale,
      cameraX: r.cameraX, cameraY: r.cameraY, cameraZ: r.cameraZ };
    const width = r.width + pad * 2, height = r.height + pad * 2;
    if (!this.tile || this.tile.width !== width || this.tile.height !== height || this.tile.scale !== r.scale) this.tile = new Raster(width, height, r.scale);
    const tile = this.tile;
    tile.ox = r.ox + pad; tile.oy = r.oy + pad;
    tile.cameraX = r.cameraX; tile.cameraY = r.cameraY; tile.cameraZ = r.cameraZ;
    // Every anchor uses the same world pixel lattice. Refreshing the padded
    // image therefore cannot change the phase of its grass and rock texture.
    const originX = tile.ox - (r.cameraX - r.cameraY) / R2 * r.scale;
    const originY = tile.oy - ((r.cameraX + r.cameraY) / R2 * SIN - r.cameraZ * COS) * r.scale;
    this.anchor.offsetX = originX - Math.floor(originX);
    this.anchor.offsetY = originY - Math.floor(originY);
    tile.ox -= this.anchor.offsetX; tile.oy -= this.anchor.offsetY;
    const halfWidth = tile.width / (2 * r.scale);
    const vertical = Math.max(tile.oy, tile.height - tile.oy) / (r.scale * SIN);
    this.radius = clamp(Math.ceil((halfWidth + vertical) / R2 + 25), 40, 100);
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
      this.patch = new Float32Array(length);
      this.screenX = new Float32Array(length);
      this.screenY = new Float32Array(length);
      this.depth = new Float32Array(length);
    }
    this.rows = [];
    for (let j = 0; j <= (n - 1) * 4; j++) {
      const s = s0 + j * .25, profile = trailProfileAt(s, this.seed);
      let meadow = 0, enchanted = 0, stream = 0, swamp = 0, weight = 0;
      // Blend the ground palette across a broad transition. Biome names can
      // change at one point; the earth must never acquire a straight seam.
      for (let offset = -8; offset <= 8; offset++) {
        const part = 9 - Math.abs(offset), biome = biomeAt(s + offset, this.seed);
        weight += part;
        if (biome === 'meadow') meadow += part;
        else if (biome === 'enchanted') enchanted += part;
        else if (biome === 'stream') stream += part;
        else if (biome === 'swamp') swamp += part;
      }
      this.rows.push({ ...profile, norm: 1 / Math.hypot(1, profile.slope),
        river: riverAt(s, this.seed), meadow: meadow / weight,
        enchanted: enchanted / weight, stream: stream / weight, swamp: swamp / weight, pools: swampPoolsAt(s, this.seed) });
    }
    this.hasWater = this.rows.some(row => row.river !== null || row.pools.length);
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
        for (const pool of row.pools) {
          if (((x - pool.x) / pool.rx) ** 2 + ((s - pool.s) / pool.rs) ** 2 < 1) z = Math.max(z, pool.level);
        }
        this.heights[i] = z;
        this.grain[i] = noise(x * .49 + offset, s * .49);
        this.patch[i] = noise(x * .115 + offset + 19, s * .115 - 31);
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

  gradeAt(s, x) {
    return Math.hypot(this.height(s, x + .5) - this.height(s, x - .5),
      this.height(s + .5, x) - this.height(s - .5, x));
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

  _shift(r) {
    const a = this.anchor;
    return {
      x: ((a.cameraX - a.cameraY) - (r.cameraX - r.cameraY)) / R2 * r.scale + a.offsetX,
      y: (((a.cameraX + a.cameraY) - (r.cameraX + r.cameraY)) / R2 * SIN + (r.cameraZ - a.cameraZ) * COS) * r.scale + a.offsetY,
      depth: ((a.cameraX + a.cameraY) - (r.cameraX + r.cameraY)) / R2 * COS + (a.cameraZ - r.cameraZ) * SIN,
    };
  }

  draw(state, env, r) {
    this.tile.clear(rgb(250, 249, 246));
    this._paint(state, env, this.tile);
    const shift = this._shift(r), pad = this.padding;
    const startX = pad - shift.x, startY = pad - shift.y;
    const ix = Math.floor(startX), iy = Math.floor(startY), fx = startX - ix, fy = startY - iy;
    const a = (1 - fx) * (1 - fy), b = fx * (1 - fy), c = (1 - fx) * fy, d = fx * fy;
    const w = this.tile.width, pixels = this.cachedPixels, depth = this.cachedDepth;
    for (let y = 0; y < r.height; y++) {
      let src = (iy + y) * w + ix, dest = y * r.width;
      for (let x = 0; x < r.width; x++, src++, dest++) {
        const p = pixels[src], q = pixels[src + 1], u = pixels[src + w], v = pixels[src + w + 1];
        const red = (p & 255) * a + (q & 255) * b + (u & 255) * c + (v & 255) * d;
        const green = (p >> 8 & 255) * a + (q >> 8 & 255) * b + (u >> 8 & 255) * c + (v >> 8 & 255) * d;
        const blue = (p >> 16 & 255) * a + (q >> 16 & 255) * b + (u >> 16 & 255) * c + (v >> 16 & 255) * d;
        r.pixels[dest] = ((255 << 24) | (blue | 0) << 16 | (green | 0) << 8 | (red | 0)) >>> 0;
        r.depth[dest] = depth[src] * a + depth[src + 1] * b + depth[src + w] * c + depth[src + w + 1] * d + shift.depth;
      }
    }
    r.groundZ.set(r.depth);
  }

  _paint(state, env, r) {
    const waterFrame = Math.floor(state.elapsed * 16);
    const cacheKey = `${this.key}:${r.width}:${r.height}:${r.ox}:${r.oy}:${r.scale}:${r.cameraX}:${r.cameraY}:${r.cameraZ}:${env.seasonIndex}`;
    this.env = env;
    this.time = state.elapsed;
    if (this.cacheKey === cacheKey && this.cachedPixels?.length === r.pixels.length) {
      // A still camera only recolours the visible water fragments. Rebuilding
      // every hillside just to move a few ripples wastes most of a frame.
      if (waterFrame !== this.waterFrame) {
        for (const index of this.waterIndices || []) {
          const base = index * 4;
          this.cachedPixels[index] = this._color(this.waterData[base], this.waterData[base + 1], 0,
            this.waterData[base + 2], this.waterData[base + 3], 0, 0);
        }
        this.waterFrame = waterFrame;
      }
      r.pixels.set(this.cachedPixels);
      r.depth.set(this.cachedDepth);
      r.groundZ.set(this.cachedDepth);
      return;
    }
    if (this.waterMask?.length !== r.pixels.length) {
      this.waterMask = new Uint8Array(r.pixels.length);
      this.waterData = new Float32Array(r.pixels.length * 4);
    } else this.waterMask.fill(0);
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
    this.waterIndices = [];
    for (let index = 0; index < this.waterMask.length; index++) if (this.waterMask[index]) this.waterIndices.push(index);
    this.waterVisible = this.waterIndices.length > 0;
    this.waterFrame = waterFrame;
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
    const pa = this.patch[a], pb = this.patch[b], pc = this.patch[c];
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
          wa * ea + wb * eb + wc * ec, wa * pa + wb * pb + wc * pc);
        r.depth[index] = depth;
        this.waterMask[index] = this.colorIsWater ? 1 : 0;
        if (this.colorIsWater) {
          const base = index * 4;
          this.waterData[base] = wx; this.waterData[base + 1] = s;
          this.waterData[base + 2] = wa * la + wb * lb + wc * lc;
          this.waterData[base + 3] = wa * ga + wb * gb + wc * gc;
        }
      }
    }
  }

  _color(x, s, height, light, coarse, steep, patch) {
    const row = this.row(s), env = this.env;
    this.colorIsWater = false;
    const side = (x - row.x) * row.norm;
    const fine = hash(Math.floor(x * 6) + this.seedOffset, Math.floor(s * 6));
    const grit = (fine - .5) * 7;
    const pathEdge = row.width + (coarse - .5) * .29;
    const onPath = Math.abs(side) < pathEdge;
    const river = row.river;
    const channel = river && Math.abs(s - river.center + Math.sin(x * .34) * .28) < river.width * .5;
    let pool = null, poolRadius = 0;
    if (!channel) for (const candidate of row.pools) {
      const q = ((x - candidate.x) / candidate.rx) ** 2 + ((s - candidate.s) / candidate.rs) ** 2;
      if (q < 1) { pool = candidate; poolRadius = Math.sqrt(q); break; }
    }
    let red, green, blue;
    if (channel || pool) {
      this.colorIsWater = true;
      if (channel && Math.abs(side) < 1.27) {
        this.colorIsWater = false;
        const plank = ((s * 4.4) % 1 + 1) % 1;
        const seam = plank < .11;
        red = seam ? 91 : 157 + grit;
        green = seam ? 76 : 128 + grit;
        blue = seam ? 59 : 88 + grit;
      } else {
        const bank = pool ? poolRadius : Math.abs(s - river.center + Math.sin(x * .34) * .28) / (river.width * .5);
        const shallow = smooth((bank - .48) / .5);
        const velocity = pool ? .27 : 1.4;
        const flow = x * 5.8 - this.time * velocity + Math.sin(s * 3.1) * .6;
        const ripples = Math.sin(flow) + Math.sin(x * 1.7 - s * 7.8 - this.time * velocity * .49);
        red = (pool ? 62 : 48) + shallow * 36 + coarse * 13;
        green = (pool ? 101 : 106) + shallow * 32 + coarse * 14;
        blue = (pool ? 84 : 119) + shallow * (pool ? 13 : 10);
        if (ripples > 1.6) { red += 43; green += 40; blue += 27; }
        // Fine current ribbons gather against irregular banks and stones.
        if (!pool && bank > .84 && Math.sin(flow * .7 + s * 9) > .65) { red += 42; green += 35; blue += 25; }
        if (env.seasonIndex === 3) { red += 43; green += 36; blue += 32; }
      }
    } else if (onPath) {
      const stone = fine > .976 ? 24 : fine < .024 ? -18 : 0;
      const grain = (coarse - .5) * 15 + grit + stone;
      red = 183 + grain - row.mountain * 10;
      green = 166 + grain - row.mountain * 5;
      blue = 126 + grain + row.mountain * 5;
      if (env.seasonIndex === 3) { red += 14; green += 19; blue += 28; }
    } else {
      const shade = (coarse - .5) * 21 + (patch - .5) * 27 + grit;
      const grass = this.baseGrass;
      red = grass[0] + shade;
      green = grass[1] + shade;
      blue = grass[2] + shade;
      red += row.meadow * 12 - row.enchanted * 12 - row.stream * 8 - row.swamp * 10;
      green += row.meadow * 9 - row.enchanted * 9 + row.stream * 2 - row.swamp * 4;
      blue += row.meadow * 2 - row.enchanted * 2 + row.stream * 8 - row.swamp * 3;
      // Broad clumps of rich grass, dry seed heads and exposed leaf-litter
      // break up the ground at different scales. These are anchored to world
      // coordinates, so walking reveals a landscape instead of screen noise.
      const moss = smooth((.43 - patch) * 4) * (1 - row.mountain * .7);
      red = lerp(red, 79 + shade, moss * .6);
      green = lerp(green, 113 + shade, moss * .6);
      blue = lerp(blue, 65 + shade, moss * .6);
      const earth = smooth((patch - .64) * 5) * smooth((coarse - .42) * 4);
      const bare = env.seasonIndex === 3 ? .1 : earth * .65;
      red = lerp(red, 148 + grit, bare);
      green = lerp(green, 137 + grit, bare);
      blue = lerp(blue, 94 + grit, bare);
      const verge = (1 - smooth((Math.abs(side) - pathEdge) / .35)) * (env.seasonIndex === 3 ? .2 : .45);
      red = lerp(red, 146 + shade, verge); green = lerp(green, 143 + shade, verge); blue = lerp(blue, 85 + shade, verge);
      // Exposed stone on the upper shoulders makes actual relief legible.
      const rock = row.mountain * smooth((height - row.height - .8) / 3.2)
        * smooth((coarse + steep * 1.8 - .3) / .5);
      const strata = Math.sin(height * 1.8 + s * .18 + x * .13 + coarse * 3.8);
      const ledge = strata > .8 ? 6 : strata < -.72 ? -10 : 0;
      red = lerp(red, 139 + grit + ledge, rock);
      green = lerp(green, 143 + grit + ledge * .92, rock);
      blue = lerp(blue, 137 + grit + ledge * .78, rock);
      const snow = smooth((height - row.height - (env.seasonIndex === 3 ? 4 : 11)) / 4.5) * row.mountain;
      red = lerp(red, 219 + grit * .5, snow);
      green = lerp(green, 225 + grit * .5, snow);
      blue = lerp(blue, 215 + grit * .5, snow);
      if (fine > .985) { red += 10; green += 11; blue += 5; }
      if (fine < .015) { red -= 12; green -= 9; blue -= 6; }
    }
    const slopeLight = (light - .704) * 128;
    return rgb(red + slopeLight, green + slopeLight * .92, blue + slopeLight * .72);
  }
}
