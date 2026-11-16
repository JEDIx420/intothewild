// Manual in-world visual and click QA, not part of npm test.
import fs from 'node:fs';
import { ForestScene } from '../js/scene.js';
import { createJourney, TrailWorld } from '../js/world.js';

globalThis.matchMedia = () => ({ matches: false });
const seed = Number(process.argv[3] || 12345), world = new TrailWorld(seed);
let house = null;
for (let s = 30; s < 1600 && !house; s += 42) {
  world.update(s, 65);
  house = world.entities.find(e => e.kind === 'home');
}
if (!house) throw new Error('No home on this trail');
const canvas = {
  clientWidth: 1120, clientHeight: 600,
  getContext() { return { createImageData(w, h) { return { data: new Uint8ClampedArray(w*h*4) }; }, putImageData() {} }; },
};
const state = createJourney(seed); state.distance = house.s - 4; state.elapsed = 12;
const scene = new ForestScene(canvas, seed);
const start = performance.now(); scene.draw(state);
const r = scene.r, pixels = Buffer.alloc(r.width*r.height*3);
for (let i = 0; i < r.width*r.height; i++) {
  const c = r.pixels[i]; pixels[i*3]=c&255; pixels[i*3+1]=(c>>8)&255; pixels[i*3+2]=(c>>16)&255;
}
const file = process.argv[2] || '/tmp/itw-scene.ppm';
fs.writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${r.width} ${r.height}\n255\n`), pixels]));
const people = scene.hitTargets.filter(t => t.entity.kind === 'resident');
if (!people.length) throw new Error(`No clickable resident at home ${house.s}`);
const response = scene.interactEntity(people[0].id, state);
if (!response?.message) throw new Error('Resident failed to respond');
console.log({file,home:house.variant,at:house.s,renderMs:Math.round(performance.now()-start),targets:people.length,dialogue:response.message});
