/*
 * Pixel software rasterizer, adapted from Amir Mushich's Pixel Plays (MIT).
 * Original: https://github.com/amirmushichge/pixel-plays
 * The moving camera, ellipsoids, sprite cache and compositing are additions.
 * See THIRD_PARTY_NOTICES.md for the original license.
 */
export const SIN = 0.5, COS = Math.sqrt(3) / 2, R2 = Math.SQRT2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rgb = (r, g, b) => ((255 << 24) | (clamp(b, 0, 255) | 0) << 16 | (clamp(g, 0, 255) | 0) << 8 | (clamp(r, 0, 255) | 0)) >>> 0;
export function hash(x, y = 0) {
  let h = Math.imul((x * 4096) | 0, 374761393) ^ Math.imul((y * 4096) | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise(x, y) {
  const a = Math.floor(x), b = Math.floor(y);
  let u = x - a, v = y - b;
  u *= u * (3 - 2 * u); v *= v * (3 - 2 * v);
  return lerp(lerp(hash(a, b), hash(a + 1, b), u), lerp(hash(a, b + 1), hash(a + 1, b + 1), u), v);
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
export const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
const COOL = [43, 40, 68], WARM = [255, 232, 180];

export class Raster {
  constructor(width = 480, height = 340, scale = 12, canvas = null) {
    this.width = width; this.height = height; this.scale = scale;
    this.ox = width / 2; this.oy = height * .65;
    this.cameraX = 0; this.cameraY = 0; this.cameraZ = 0;
    this.pixels = new Uint32Array(width * height);
    this.depth = new Float32Array(width * height);
    this.groundZ = new Float32Array(width * height);
    this.shadows = new Uint8Array(width * height);
    this.ramps = new Map();
    if (canvas) {
      canvas.width = width; canvas.height = height;
      this.context = canvas.getContext('2d', { alpha: false });
      this.image = this.context.createImageData(width, height);
      this.pixels = new Uint32Array(this.image.data.buffer);
    }
  }
  clear(color = 0) {
    this.pixels.fill(color); this.depth.fill(-1e9); this.groundZ.fill(-1e9); this.shadows.fill(0);
  }
  project(x, y, z = 0) {
    x -= this.cameraX; y -= this.cameraY; z -= this.cameraZ;
    const u = (x - y) / R2, v = (x + y) / R2;
    return { sx: this.ox + u * this.scale, sy: this.oy + (v * SIN - z * COS) * this.scale, d: v * COS + z * SIN };
  }
  ramp(c) {
    const key = (c[0] | 0) * 65536 + (c[1] | 0) * 256 + (c[2] | 0);
    let r = this.ramps.get(key);
    if (r) return r;
    const mix = (m, t, k) => rgb(lerp(c[0] * m, t[0], k), lerp(c[1] * m, t[1], k), lerp(c[2] * m, t[2], k));
    r = [mix(.43, COOL, .27), mix(.62, COOL, .16), mix(.82, COOL, .04), rgb(...c), mix(1.09, WARM, .19)];
    // Palette keys are bounded even during smooth lighting/season transitions.
    if (this.ramps.size > 1600) this.ramps.clear();
    this.ramps.set(key, r); return r;
  }
  sphere(x, y, z, radius, color, mode = 'solid') {
    if (!(radius > 0)) return;
    const p = this.project(x, y, z), rp = Math.max(radius * this.scale, .65);
    const x0 = Math.max(0, Math.floor(p.sx - rp)), x1 = Math.min(this.width - 1, Math.ceil(p.sx + rp));
    const y0 = Math.max(0, Math.floor(p.sy - rp)), y1 = Math.min(this.height - 1, Math.ceil(p.sy + rp));
    const ramp = this.ramp(color), inv = 1 / rp;
    for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
      const dx = (ix + .5 - p.sx) * inv, dy = (iy + .5 - p.sy) * inv, n = dx * dx + dy * dy;
      if (n > 1) continue;
      const nz = Math.sqrt(1 - n), d = p.d + radius * nz, i = iy * this.width + ix;
      if (d <= this.depth[i]) continue;
      let light = -.55 * dx - .6 * dy + .58 * nz;
      if (mode === 'rough') light += (hash(ix, iy) - .5) * .5;
      if (dy > .35) light = Math.max(light, .12 + dy * .24);
      const step = mode === 'solid' ? 0 : (bayer(ix, iy) - .5) * .7;
      this.depth[i] = d;
      this.pixels[i] = mode === 'glow' ? rgb(...color) : ramp[clamp(Math.floor(light * 4.4 + .2 + step), mode === 'solid' ? 1 : 0, 4)];
    }
  }
  ellipsoid(x, y, z, rx, ry, rz, color, mode = 'solid') {
    if (Math.min(rx, ry, rz) <= 0) return;
    const p = this.project(x, y, z), a = (rx * rx + ry * ry) / 2;
    const b = (rx * rx - ry * ry) * SIN / 2, c = a * SIN * SIN + rz * rz * COS * COS;
    const det = Math.max(1e-10, a * c - b * b), ia = c / det, ib = -b / det, ic = a / det;
    const dd = (rx * rx - ry * ry) * COS / 2, ee = (a - rz * rz) * SIN * COS;
    const fd = Math.max(.0001, a * COS * COS + rz * rz * SIN * SIN - (dd * dd * ia + 2 * dd * ee * ib + ee * ee * ic));
    const du = dd * ia + ee * ib, dv = dd * ib + ee * ic;
    const sx = Math.sqrt(a) * this.scale, sy = Math.sqrt(c) * this.scale, ramp = this.ramp(color);
    for (let iy = Math.max(0, Math.floor(p.sy - sy)); iy <= Math.min(this.height - 1, Math.ceil(p.sy + sy)); iy++) {
      for (let ix = Math.max(0, Math.floor(p.sx - sx)); ix <= Math.min(this.width - 1, Math.ceil(p.sx + sx)); ix++) {
        const u = (ix + .5 - p.sx) / this.scale, v = (iy + .5 - p.sy) / this.scale;
        const q = ia * u * u + 2 * ib * u * v + ic * v * v;
        if (q > 1) continue;
        const d = p.d + du * u + dv * v + Math.sqrt(fd * (1 - q)), i = iy * this.width + ix;
        if (d <= this.depth[i]) continue;
        let light = -.55 * u / Math.sqrt(a) - .6 * v / Math.sqrt(c) + .58 * Math.sqrt(1 - q);
        if (mode === 'rough') light += (hash(ix, iy) - .5) * .45;
        this.depth[i] = d;
        this.pixels[i] = mode === 'glow' ? rgb(...color) : ramp[clamp(Math.floor(light * 4.4 + .2 + (mode === 'solid' ? 0 : (bayer(ix, iy) - .5) * .7)), 1, 4)];
      }
    }
  }
  capsule(a, b, r0, r1, color, mode = 'solid') {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.min(150, Math.max(1, Math.ceil(len / (Math.max(.035, Math.min(r0, r1)) * .62))));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      this.sphere(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(r0, r1, t), color, mode);
    }
  }
  plot(x, y, z, color) {
    const p = this.project(x, y, z), ix = Math.round(p.sx), iy = Math.round(p.sy);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
    const i = iy * this.width + ix;
    if (p.d < this.depth[i]) return;
    this.depth[i] = p.d; this.pixels[i] = Array.isArray(color) ? rgb(...color) : color;
  }
  // Soft contact shadows carry coverage, rather than a binary, stippled oval.
  // Canopy lobes are placed on the terrain by the scene; this small stamp also
  // serves feet, stones and creatures without painting over elevated objects.
  triangle(a, b, c, color) {
    const p = this.project(...a), q = this.project(...b), v = this.project(...c), ink = rgb(...color);
    const x0 = Math.max(0, Math.floor(Math.min(p.sx, q.sx, v.sx))), x1 = Math.min(this.width - 1, Math.ceil(Math.max(p.sx, q.sx, v.sx)));
    const y0 = Math.max(0, Math.floor(Math.min(p.sy, q.sy, v.sy))), y1 = Math.min(this.height - 1, Math.ceil(Math.max(p.sy, q.sy, v.sy)));
    const area = (q.sy - v.sy) * (p.sx - v.sx) + (v.sx - q.sx) * (p.sy - v.sy);
    if (Math.abs(area) < .00001) return;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const aa = ((q.sy - v.sy) * (x + .5 - v.sx) + (v.sx - q.sx) * (y + .5 - v.sy)) / area;
      const bb = ((v.sy - p.sy) * (x + .5 - v.sx) + (p.sx - v.sx) * (y + .5 - v.sy)) / area, cc = 1 - aa - bb;
      if (aa < 0 || bb < 0 || cc < 0) continue;
      const d = aa * p.d + bb * q.d + cc * v.d, i = y * this.width + x;
      if (d > this.depth[i]) { this.depth[i] = d; this.pixels[i] = ink; }
    }
  }
  line(a, b, color, width = 1) {
    const p = this.project(...a), q = this.project(...b);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(q.sx - p.sx), Math.abs(q.sy - p.sy))));
    const ink = Array.isArray(color) ? rgb(...color) : color;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, x = Math.round(lerp(p.sx, q.sx, t)), y = Math.round(lerp(p.sy, q.sy, t));
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
      const i = y * this.width + x, d = lerp(p.d, q.d, t);
      if (d >= this.depth[i]) { this.depth[i] = d; this.pixels[i] = ink; }
      if (width > 1 && x + 1 < this.width && d >= this.depth[i + 1]) { this.depth[i + 1] = d; this.pixels[i + 1] = ink; }
    }
  }
  shadow(x, y, z, radius, strength = 1) {
    const p = this.project(x, y, z), rx = Math.max(1, radius * this.scale), ry = Math.max(1, rx * .5);
    const opacity = clamp(strength * 55, 0, 92);
    for (let iy = Math.max(0, Math.floor(p.sy - ry)); iy <= Math.min(this.height - 1, Math.ceil(p.sy + ry)); iy++) {
      for (let ix = Math.max(0, Math.floor(p.sx - rx)); ix <= Math.min(this.width - 1, Math.ceil(p.sx + rx)); ix++) {
        const dx = (ix + .5 - p.sx) / rx, dy = (iy + .5 - p.sy) / ry;
        const q = dx * dx + dy * dy;
        if (q >= 1) continue;
        const i = iy * this.width + ix;
        if (Math.abs(this.groundZ[i] - p.d) > radius * 1.25 + .3) continue;
        const shade = opacity * (1 - q) * (1 - q);
        this.shadows[i] = Math.min(100, this.shadows[i] + shade);
      }
    }
  }
  applyShadows() {
    for (let i = 0; i < this.pixels.length; i++) {
      if (!this.shadows[i] || this.depth[i] < -1e8 || Math.abs(this.depth[i] - this.groundZ[i]) > .04) continue;
      const c = this.pixels[i], factor = 1 - this.shadows[i] / 255;
      this.pixels[i] = rgb((c & 255) * factor, (c >> 8 & 255) * factor, (c >> 16 & 255) * (factor + .025));
    }
    this.shadows.fill(0);
  }
  shadeEdges() {
    const w = this.width;
    for (let y = 1; y < this.height - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, d = this.depth[i];
      if (d < -1e8 || Math.abs(d - this.groundZ[i]) < .02) continue;
      const side = this.depth[i + 1], below = this.depth[i + w];
      if (d - side > .35 || d - below > .5) {
        const c = this.pixels[i];
        this.pixels[i] = rgb((c & 255) * .83, (c >> 8 & 255) * .81, (c >> 16 & 255) * .9);
      }
    }
  }
  sprite() {
    let x0 = this.width, x1 = -1, y0 = this.height, y1 = -1;
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      if (this.depth[y * this.width + x] < -1e8) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (x1 < x0) return { width: 0, height: 0, pixels: [], depth: [], ox: 0, oy: 0 };
    const w = x1 - x0 + 1, h = y1 - y0 + 1, p = new Uint32Array(w * h), d = new Float32Array(w * h);
    d.fill(-1e9);
    for (let y = 0; y < h; y++) {
      p.set(this.pixels.subarray((y + y0) * this.width + x0, (y + y0) * this.width + x0 + w), y * w);
      d.set(this.depth.subarray((y + y0) * this.width + x0, (y + y0) * this.width + x0 + w), y * w);
    }
    return { width: w, height: h, pixels: p, depth: d, ox: this.ox - x0, oy: this.oy - y0 };
  }
  blit(sprite, x, y, z = 0, sway = 0) {
    const p = this.project(x, y, z), left = p.sx - sprite.ox, top = p.sy - sprite.oy;
    const sw = sprite.width, sh = sprite.height, sd = sprite.depth, sp = sprite.pixels;
    // Sprites formerly rounded their screen position independently of the
    // heightfield. Subpixel coverage keeps their roots attached while the
    // camera moves, and lets a light breeze bend a crown without one-pixel
    // jumps. This does not change the world's native pixel scale.
    for (let iy = Math.max(0, Math.floor(top)); iy < Math.min(this.height, Math.ceil(top + sh)); iy++) {
      const sourceY = iy - top, row = Math.floor(sourceY), fy = sourceY - row;
      const bend = clamp((sprite.oy - sourceY - 19) / 45, 0, 1);
      const wind = sway * bend * bend;
      const start = left + wind;
      for (let ix = Math.max(0, Math.floor(start)); ix < Math.min(this.width, Math.ceil(start + sw)); ix++) {
        const sourceX = ix - start, col = Math.floor(sourceX), fx = sourceX - col;
        let coverage = 0, red = 0, green = 0, blue = 0, dz = 0;
        for (let yy = 0; yy < 2; yy++) {
          const sy = row + yy;
          if (sy < 0 || sy >= sh) continue;
          const wy = yy ? fy : 1 - fy;
          if (wy < .001) continue;
          for (let xx = 0; xx < 2; xx++) {
            const sx = col + xx;
            if (sx < 0 || sx >= sw) continue;
            const si = sy * sw + sx;
            if (sd[si] < -1e8) continue;
            const weight = wy * (xx ? fx : 1 - fx), color = sp[si];
            coverage += weight; dz += sd[si] * weight;
            red += (color & 255) * weight; green += (color >> 8 & 255) * weight; blue += (color >> 16 & 255) * weight;
          }
        }
        if (coverage < .035) continue;
        const d = p.d + dz / coverage, i = iy * this.width + ix;
        if (d <= this.depth[i]) continue;
        let visible = 1;
        for (const zone of this.cutaways || []) {
          if (d <= zone.d) continue;
          const dx = (ix - zone.x) / zone.rx, dy = (iy - zone.y) / zone.ry, q = dx * dx + dy * dy;
          if (q < 1) visible = Math.min(visible, 1 - .94 * Math.pow(1 - q, .35));
        }
        const old = this.pixels[i], remainder = 1 - coverage * visible;
        this.pixels[i] = rgb(red * visible + (old & 255) * remainder,
          green * visible + (old >> 8 & 255) * remainder,
          blue * visible + (old >> 16 & 255) * remainder);
        if (coverage * visible > .45) this.depth[i] = d;
      }
    }
  }
  present() { this.context?.putImageData(this.image, 0, 0); }
}
