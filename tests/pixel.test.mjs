import test from 'node:test';
import assert from 'node:assert/strict';
import { Raster, rgb } from '../js/pixel.js';
import { LandscapeTerrain } from '../js/landscape.js';
import { createJourney, environment, trailProfileAt } from '../js/world.js';

function stamp(width, height, points, origin) {
  const r = new Raster(width, height, 10);
  r.ox = origin[0]; r.oy = origin[1]; r.clear();
  for (const [x, y] of points) { r.pixels[y * width + x] = rgb(220, 220, 220); r.depth[y * width + x] = 1; }
  return r.sprite();
}
function centroid(r, from = 0, to = r.height) {
  let weight = 0, sum = 0;
  for (let y = from; y < to; y++) for (let x = 0; x < r.width; x++) {
    const value = r.pixels[y * r.width + x] & 255;
    weight += value; sum += x * value;
  }
  return sum / weight;
}

test('a cached tree follows fractional camera movement instead of waiting then jumping a pixel', () => {
  const sprite = stamp(12, 12, Array.from({ length: 16 }, (_, i) => [4 + i % 4, 4 + Math.floor(i / 4)]), [6, 8]);
  const r = new Raster(80, 60, 10), positions = [];
  for (let step = 0; step <= 8; step++) {
    const shift = step / 8;
    r.clear(rgb(0, 0, 0));
    r.cameraX = -shift / (Math.SQRT2 * r.scale); r.cameraY = shift / (Math.SQRT2 * r.scale);
    r.blit(sprite, 0, 0, 0);
    positions.push(centroid(r));
  }
  for (let i = 1; i < positions.length; i++) assert.ok(Math.abs(positions[i] - positions[i - 1] - .125) < .015);
});

test('wind bends the crown while keeping the roots fixed', () => {
  const points = [];
  for (let y = 9; y < 20; y++) for (let x = 9; x < 17; x++) points.push([x, y]);
  for (let y = 60; y < 76; y++) for (let x = 12; x < 14; x++) points.push([x, y]);
  const sprite = stamp(28, 80, points, [13, 76]);
  const r = new Raster(120, 120, 10); r.ox = 60; r.oy = 100;
  r.clear(rgb(0, 0, 0)); r.blit(sprite, 0, 0, 0, 0);
  const roots = centroid(r, 84, 101), crown = centroid(r, 30, 50);
  r.clear(rgb(0, 0, 0)); r.blit(sprite, 0, 0, 0, 1.3);
  assert.equal(centroid(r, 84, 101), roots);
  assert.ok(centroid(r, 30, 50) > crown + 1);
});

test('contact shadows feather smoothly and never shade an elevated foreground object', () => {
  const r = new Raster(80, 60, 10); r.clear(rgb(150, 170, 130)); r.depth.fill(0); r.groundZ.fill(0);
  r.shadow(0, 0, 0, 1.3);
  assert.ok(new Set(r.shadows).size > 15, 'the shadow has graded coverage, not a binary dark ellipse');
  const center = Math.round(r.oy) * r.width + Math.round(r.ox), before = r.pixels[center];
  r.depth[center] = 1;
  r.applyShadows();
  assert.equal(r.pixels[center], before);
});

test('refreshing a translated terrain cache preserves the world pixel grid and depth', () => {
  const state = createJourney(), terrain = new LandscapeTerrain(state.seed), r = new Raster(240, 140, 8);
  const render = () => {
    const p = trailProfileAt(state.distance, state.seed);
    r.cameraX = p.x; r.cameraY = -state.distance; r.cameraZ = p.height;
    terrain.prepare(state, r); r.clear(rgb(250, 249, 246)); terrain.draw(state, environment(state), r);
  };
  render(); state.distance = 2.73; render();
  const pixels = r.pixels.slice(), depth = r.depth.slice();
  terrain.anchor = null; terrain.key = ''; render();
  let error = 0, depthError = 0;
  for (let i = 0; i < pixels.length; i++) {
    error += Math.abs((pixels[i] & 255) - (r.pixels[i] & 255));
    depthError += Math.abs(depth[i] - r.depth[i]);
    assert.ok(Number.isFinite(r.depth[i]) && r.depth[i] > -1e8);
  }
  assert.ok(error / pixels.length < .05);
  assert.ok(depthError / pixels.length < .0001);
});
