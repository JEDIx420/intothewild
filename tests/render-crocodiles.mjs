// Manual screenshot QA: node tests/render-crocodiles.mjs /tmp/croc
import fs from 'node:fs';
import { ForestScene } from '../js/scene.js';
import { createJourney, TrailWorld } from '../js/world.js';
import { sampleWildlife } from '../js/wildlife.js';

globalThis.matchMedia = () => ({ matches: false });
const seed = 28, world = new TrailWorld(seed), seen = new Map();
for (let s = 0; s < 4500; s += 54) {
  world.update(s, 65);
  for (const e of world.entities) if (e.kind === 'animal' && e.variant === 'crocodile') seen.set(e.id, e);
}
const prefix = process.argv[2] || '/tmp/itw-croc';
for (const habitat of ['swamp', 'stream']) {
  const e = [...seen.values()].find(e => e.water.kind === habitat);
  if (!e) throw Error(`No ${habitat} crocodile`);
  const canvas = {clientWidth:1120,clientHeight:600,getContext(){return {createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(){}};}};
  for (const activity of ['bask','float']) {
    let elapsed = 0;
    while (elapsed < 80 && sampleWildlife(e,elapsed,seed).activity !== activity) elapsed += .3;
    if (elapsed >= 80) throw Error(`No ${activity} animation`);
    const pose = sampleWildlife(e,elapsed,seed);
    const state = createJourney(seed); state.distance = pose.s; state.elapsed = elapsed;
    const scene = new ForestScene(canvas,seed); scene.draw(state);
    const r = scene.r, buf=Buffer.alloc(r.width*r.height*3);
    for (let i=0;i<r.width*r.height;i++){const c=r.pixels[i];buf[i*3]=c&255;buf[i*3+1]=(c>>8)&255;buf[i*3+2]=(c>>16)&255;}
    const file = `${prefix}-${habitat}-${activity}.ppm`;
    fs.writeFileSync(file,Buffer.concat([Buffer.from(`P6\n${r.width} ${r.height}\n255\n`),buf]));
    const target = scene.hitTargets.find(t=>t.entity.id===e.id);
    console.log({file,habitat,activity,coords:[pose.s,pose.x],clickable:!!target,target:target && [target.cssX,target.cssY]});
  }
}
