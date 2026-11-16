// Manual art QA: node tests/render-homesteads.mjs [output.ppm]
import fs from 'node:fs';
import { Raster } from '../js/pixel.js';
import { drawHome, drawResident } from '../js/homesteads.js';

const W = 1050, H = 600;
const r = new Raster(W, H, 12);
r.ox = W * .5; r.oy = H * .58;
r.clear(0xffd6d9cb);
const variants = ['cabin','cottage','burrow','stone','stilt','treehouse'];
const jobs = ['woodcutter','gardener','reader','firekeeper','fisher','musician'];
for (let i = 0; i < variants.length; i++) {
  const col = i % 3, row = Math.floor(i / 3);
  const hx = (col - 1) * 26, hy = (row - .5) * 38;
  // Local ground for this card: a little meadow beneath the whole model.
  for (let u = -7; u <= 7; u += 1) for (let v = -7; v <= 7; v += 1) {
    r.ellipsoid(u + hx, v + hy, -.05, .75, .75, .05, [177, 193, 150]);
  }
  drawHome(r,{ x:hx,y:hy,z:0,seed:182+i*33,variant:variants[i],scale:1,seasonIndex:0,time:14,night:i===4 });
  drawResident(r,{ entity:{id:`person${i}`,seed:50+i*100,homeSeed:182+i*33,variant:jobs[i],homeVariant:variants[i],scale:1,member:0},
    x:hx,y:hy,z:0,time:14,groundAt:()=>0,night:i===4 });
}
const pixels = Buffer.alloc(W * H * 3);
for (let i = 0; i < W*H; i++) {
  const c = r.pixels[i]; pixels[i*3] = c & 255; pixels[i*3+1]=(c >> 8)&255; pixels[i*3+2]=(c >> 16)&255;
}
const path = process.argv[2] || '/tmp/intothewild-homes.ppm';
fs.writeFileSync(path, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), pixels]));
process.stdout.write(`${path}\n`);
