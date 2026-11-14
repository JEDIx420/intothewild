// Pure journey rules and deterministic scenery. No DOM, timers or network state.
import { SPECIES } from './bestiary.js?v=4';
const DEFAULT_SEED = 0x1d70a11d;
const TAU = Math.PI * 2;
const HOURS_PER_SECOND = 24 / 300;
const WALK_SPEED = 1.15;
const SLEEP_SECONDS = 7;
const CHUNK_LENGTH = 18;
const MAX_DISTANCE = 1e9;
const MAX_TIME = 1e9;
const MODES = new Set(['paused', 'walking', 'snack', 'sleep']);
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const BIOME_LABELS = {
  forest: 'Whispering woods', stream: 'Silverbrook', meadow: 'The open meadows',
  mountain: 'The high pass', swamp: 'The willow wetlands', enchanted: 'The enchanted grove',
};
const MIDDLE_BIOMES = [
  ['meadow', 'mountain', 'swamp', 'enchanted'], ['swamp', 'meadow', 'enchanted', 'mountain'],
  ['mountain', 'meadow', 'swamp', 'enchanted'], ['meadow', 'swamp', 'mountain', 'enchanted'],
  ['enchanted', 'mountain', 'meadow', 'swamp'], ['swamp', 'enchanted', 'meadow', 'mountain'],
];
const sleepSessions = new WeakMap();

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const seedOf = seed => finite(seed, DEFAULT_SEED) >>> 0;
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const blend = (a, b, amount) => a + (b - a) * amount;

function hash(seed, index, salt = 0) {
  let value = (seed ^ Math.imul(index | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca77)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

const randomAt = (seed, index, salt = 0) => hash(seed, index, salt) / 4294967296;
function randomSequence(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let next = Math.imul(value ^ (value >>> 15), value | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function firstBoundary(seed) { return 38 + randomAt(seed, 0, 101) * 5; }
function boundary(index, seed) {
  return firstBoundary(seed) + index * 60 + (index === 0 ? 0 : (randomAt(seed, index, 102) - .5) * 10);
}
function regionBiome(index, seed) {
  if (index < 0) return 'forest';
  const slot = index % 6;
  if (slot === 0) return 'stream';
  if (slot === 5) return 'forest';
  const cycle = Math.floor(index / 6);
  const arrangement = cycle === 0 ? 0 : Math.floor(randomAt(seed, cycle, 103) * MIDDLE_BIOMES.length);
  return MIDDLE_BIOMES[arrangement][slot - 1];
}
function regionAt(position, seed) {
  if (position < firstBoundary(seed)) return -1;
  let index = Math.max(0, Math.floor((position - firstBoundary(seed)) / 60));
  if (position < boundary(index, seed)) index--;
  else if (position >= boundary(index + 1, seed)) index++;
  return index;
}

export function biomeAt(s, seed = DEFAULT_SEED) {
  const worldSeed = seedOf(seed);
  return regionBiome(regionAt(finite(s), worldSeed), worldSeed);
}

function mountainBandAt(position, seed) {
  const region = regionAt(position, seed), edge = 20;
  let weight = 0, derivative = 0;
  const slope = value => value <= 0 || value >= 1 ? 0 : 6 * value * (1 - value);
  for (let index = Math.max(0, region - 1); index <= region + 1; index++) {
    if (regionBiome(index, seed) !== 'mountain') continue;
    const a = (position - boundary(index, seed) + edge) / (edge * 2);
    const b = (position - boundary(index + 1, seed) + edge) / (edge * 2);
    weight += smooth(a) * (1 - smooth(b));
    derivative += (slope(a) * (1 - smooth(b)) - smooth(a) * slope(b)) / (edge * 2);
  }
  return { weight, derivative };
}

// Several smooth bends create a trail whose direction visibly changes within a
// single view, while +s always advances along the journey.
export function pathAt(s, seed = DEFAULT_SEED) {
  const position = finite(s), worldSeed = seedOf(seed);
  const a = randomAt(worldSeed, 0, 201) * TAU;
  const b = randomAt(worldSeed, 0, 202) * TAU;
  const c = randomAt(worldSeed, 0, 203) * TAU;
  const mountain = mountainBandAt(position, worldSeed).weight;
  return (Math.sin(position * .072 + a) - Math.sin(a)) * 4.6
    + (Math.sin(position * .17 + b) - Math.sin(b)) * 1.7
    + (Math.sin(position * .029 + c) - Math.sin(c)) * 1.1
    + mountain * 2.9 * Math.sin(position * .18 + c);
}

export function pathSlopeAt(s, seed = DEFAULT_SEED) {
  const position = finite(s), worldSeed = seedOf(seed);
  const mountain = mountainBandAt(position, worldSeed);
  const turn = position * .18 + randomAt(worldSeed, 0, 203) * TAU;
  return Math.cos(position * .072 + randomAt(worldSeed, 0, 201) * TAU) * .3312
    + Math.cos(position * .17 + randomAt(worldSeed, 0, 202) * TAU) * .289
    + Math.cos(position * .029 + randomAt(worldSeed, 0, 203) * TAU) * .0319
    + mountain.weight * .522 * Math.cos(turn) + mountain.derivative * 2.9 * Math.sin(turn);
}

function routeShapeAt(position, seed) {
  const phase = randomAt(seed, 0, 401) * TAU;
  const second = randomAt(seed, 0, 402) * TAU;
  let mountain = 0, valley = 0;
  const region = regionAt(position, seed);
  for (let index = Math.max(0, region - 1); index <= region + 1; index++) {
    const biome = regionBiome(index, seed);
    if (biome !== 'mountain' && biome !== 'stream' && biome !== 'meadow' && biome !== 'swamp') continue;
    // Broad foothills begin before the named mountain section and taper into
    // the next landscape, rather than making a raised platform at its border.
    const edge = biome === 'mountain' ? 20 : 19;
    const weight = smooth((position - boundary(index, seed) + edge) / (edge * 2))
      * (1 - smooth((position - boundary(index + 1, seed) + edge) / (edge * 2)));
    if (biome === 'mountain') mountain += weight;
    else valley += weight * (biome === 'stream' || biome === 'swamp' ? 1 : .65);
  }
  const rolling = 1.9 * Math.sin(position * .055 + phase)
    + .65 * Math.sin(position * .103 + second);
  const height = 1.5 + rolling - valley * 1.3
    + mountain * (8.4 + 1.6 * Math.sin(position * .075 + second));
  return { phase, second, mountain, valley, height };
}

export function riverAt(s, seed = DEFAULT_SEED) {
  const position = finite(s), worldSeed = seedOf(seed);
  const region = regionAt(position, worldSeed);
  for (let index = Math.max(0, region - 1); index <= region + 1; index++) {
    if (regionBiome(index, worldSeed) !== 'stream') continue;
    for (const offset of [10, 40]) {
      const center = boundary(index, worldSeed) + offset;
      if (Math.abs(position - center) <= 7) {
        const level = routeShapeAt(center, worldSeed).height - .12;
        return { kind: 'stream', center, width: 2.7 + randomAt(worldSeed, index, 301 + offset) * .6,
          level, depth: .16, flow: 1, bridgeHeight: level + .26 };
      }
    }
  }
  return null;
}

// Wetland pools are world-space basins, never decals on top of the trail.
// A small cache covers nearby regions, keeping even an endless trip bounded.
const poolCache = new Map();
function poolsInRegion(index, seed) {
  const key = `${seed}:${index}`;
  if (poolCache.has(key)) return poolCache.get(key);
  const pools = [];
  if (regionBiome(index, seed) === 'swamp') {
    for (const offset of [13, 40]) for (const bank of [-1, 1]) {
      const salt = offset * 2 + bank;
      const s = boundary(index, seed) + offset + randomAt(seed, index, 710 + salt) * 4;
      const rx = 4.2 + randomAt(seed, index, 720 + salt) * 1.8;
      const rs = 6 + randomAt(seed, index, 730 + salt) * 2.4;
      const trailXs = [-rs, -rs / 2, 0, rs / 2, rs].map(ds => pathAt(s + ds, seed));
      const edgeX = bank > 0 ? Math.max(...trailXs) : Math.min(...trailXs);
      const x = edgeX + bank * (rx + 3.6 + randomAt(seed, index, 740 + salt) * 2);
      const level = Math.min(...[-rs, 0, rs].map(ds => routeShapeAt(s + ds, seed).height)) - .28;
      pools.push({ id: `pool:${index}:${offset}:${bank}`, kind: 'swamp', s, x, rx, rs,
        center: s, width: rs * 2, level, depth: .32, flow: .12, bank });
    }
  }
  if (poolCache.size >= 24) poolCache.delete(poolCache.keys().next().value);
  poolCache.set(key, pools);
  return pools;
}

export function swampPoolsAt(s, seed = DEFAULT_SEED) {
  const position = finite(s), worldSeed = seedOf(seed), region = regionAt(position, worldSeed);
  const pools = [];
  for (let index = Math.max(0, region - 1); index <= region + 1; index++) {
    for (const pool of poolsInRegion(index, worldSeed)) {
      if (Math.abs(position - pool.s) <= pool.rs * 1.5) pools.push(pool);
    }
  }
  return pools;
}

export function swampPoolAt(s, seed = DEFAULT_SEED, bank = 1) {
  return swampPoolsAt(s, seed).filter(pool => pool.bank === Math.sign(bank || 1))
    .sort((a, b) => Math.abs(a.s - s) - Math.abs(b.s - s))[0] || null;
}

export function waterAt(s, x, seed = DEFAULT_SEED) {
  const position = finite(s), lateral = finite(x), worldSeed = seedOf(seed);
  const river = riverAt(position, worldSeed);
  if (river && Math.abs(position - river.center + Math.sin(lateral * .34) * .28) < river.width / 2
    && Math.abs((lateral - pathAt(position, worldSeed)) / Math.hypot(1, pathSlopeAt(position, worldSeed))) > 1.3) return river;
  for (const pool of swampPoolsAt(position, worldSeed)) {
    const normalized = Math.hypot((lateral - pool.x) / pool.rx, (position - pool.s) / pool.rs);
    if (normalized < 1) return { ...pool, normalized, depth: pool.depth * smooth((1 - normalized) * 5) };
  }
  return null;
}

// The height-grid builder samples a row at a time. Reusing its immutable row
// parameters avoids repeating the biome and river calculations for every x.
let lastTerrainRow = null;
function terrainRowAt(position, seed) {
  if (lastTerrainRow?.s === position && lastTerrainRow.seed === seed) return lastTerrainRow;
  const shape = routeShapeAt(position, seed);
  lastTerrainRow = { ...shape, s: position, seed, x: pathAt(position, seed),
    slope: pathSlopeAt(position, seed), river: riverAt(position, seed), pools: swampPoolsAt(position, seed) };
  return lastTerrainRow;
}

export function terrainAt(s, x, seed = DEFAULT_SEED) {
  const position = finite(s), worldSeed = seedOf(seed);
  const row = terrainRowAt(position, worldSeed);
  const lateral = (finite(x) - row.x) / Math.hypot(1, row.slope);
  const away = Math.max(0, Math.abs(lateral) - 1.5);
  // Peaks rise behind the trail, with lower foreground foothills that leave
  // the small traveller visible. A wandering crest makes an actual ridgeline,
  // with a saddle and visible descent on its far side rather than a plateau.
  const shoulder = 1 - Math.exp(-away * away / (19 * 19));
  const foothills = shoulder * (2.3 + row.mountain * 1.5
    + .65 * Math.sin(position * .06 + row.phase));
  const crest = -19 - 3.3 * Math.sin(position * .062 + row.phase);
  const ridgeProfile = Math.exp(-(((lateral - crest) / 10.5) ** 2));
  const peak = 14.5 + 3.5 * Math.sin(position * .105 + row.second);
  const clearTrail = smooth(away / 5);
  const ridge = row.mountain * ridgeProfile * peak * clearTrail;
  const texture = shoulder * (.24 * Math.sin(position * .085 + lateral * .12 + row.phase)
    + .16 * Math.sin(position * .47 + lateral * .65) * Math.sin(position * .19 - lateral * .33));
  const hummocks = clearTrail * (1 - row.mountain * .5) * (1 - row.valley * .35)
    * (.7 * Math.sin(position * .26 + lateral * .32 + row.phase)
      + .26 * Math.sin(position * .5 - lateral * .46 + row.second));
  let height = row.height + foothills + ridge + texture + hummocks;
  if (row.river) {
    const distance = Math.abs(position - row.river.center);
    const weight = 1 - smooth((distance - row.river.width / 2) / (7 - row.river.width / 2));
    height = blend(height, row.river.level - .16, weight);
  }
  for (const pool of row.pools) {
    const radius = Math.hypot((x - pool.x) / pool.rx, (position - pool.s) / pool.rs);
    const carve = 1 - smooth((radius - 1) / .5);
    if (carve > 0) height = blend(height, pool.level - pool.depth, carve);
  }
  return height;
}

function walkingHeightAt(s, seed) {
  const row = terrainRowAt(s, seed);
  const ground = terrainAt(s, row.x, seed);
  if (!row.river) return ground;
  const distance = Math.abs(s - row.river.center), bank = row.river.width / 2;
  // A short approach joins each bank to the wooden deck without a step down
  // into the stream. Root uses this profile for the trail and the traveller.
  const deck = 1 - smooth((distance - bank - .45) / 2.2);
  return blend(ground, row.river.bridgeHeight, deck);
}

export function trailProfileAt(s, seed = DEFAULT_SEED) {
  const position = finite(s), worldSeed = seedOf(seed);
  const row = terrainRowAt(position, worldSeed);
  const width = .9 - row.mountain * .2 + row.valley * .1
    + .065 * Math.sin(position * .13 + row.phase);
  return { x: row.x, slope: row.slope, height: walkingHeightAt(position, worldSeed),
    grade: (walkingHeightAt(position + .2, worldSeed) - walkingHeightAt(position - .2, worldSeed)) / .4,
    width, mountain: row.mountain, valley: row.valley };
}

export function createJourney(seed = DEFAULT_SEED) {
  return {
    version: 1, seed: seedOf(seed), distance: 0, time: 8, elapsed: 0,
    mode: 'paused', modeTime: 0, seen: [], sound: false,
  };
}

function nextMorning(time) {
  const morning = Math.floor(time / 24) * 24 + 7;
  return morning > time + 1e-9 ? morning : morning + 24;
}

export function setActivity(state, mode) {
  if (!state || !MODES.has(mode) || state.mode === mode) return state;
  sleepSessions.delete(state);
  state.mode = mode;
  state.modeTime = 0;
  if (mode === 'sleep') sleepSessions.set(state, { start: state.time, target: nextMorning(state.time) });
  return state;
}

export function stepJourney(state, dt) {
  if (!state || !Number.isFinite(dt) || dt <= 0) return state;
  const delta = Math.min(dt, .1);
  state.elapsed += delta;
  state.modeTime += delta;
  if (state.mode === 'sleep') {
    let session = sleepSessions.get(state);
    if (!session) {
      state.modeTime = delta;
      session = { start: state.time, target: nextMorning(state.time) };
      sleepSessions.set(state, session);
    }
    const progress = clamp(state.modeTime / SLEEP_SECONDS, 0, 1);
    state.time = blend(session.start, session.target, smooth(progress));
    if (state.modeTime >= SLEEP_SECONDS - 1e-9) {
      state.time = session.target;
      state.mode = 'paused';
      state.modeTime = 0;
      sleepSessions.delete(state);
    }
  } else {
    state.time += delta * HOURS_PER_SECOND;
    if (state.mode === 'walking') state.distance += delta * WALK_SPEED;
  }
  if (state.seen.length > 48) state.seen.splice(0, state.seen.length - 48);
  return state;
}

export function environment(state) {
  const time = Math.max(0, finite(state?.time, 8));
  const seed = seedOf(state?.seed);
  const hour = time % 24;
  const seasonIndex = Math.floor(time / 48) % 4;
  const season = SEASONS[seasonIndex];
  const daylight = smooth((hour - 5) / 3) * (1 - smooth((hour - 17) / 3));
  const biome = biomeAt(state?.distance, seed);
  const roll = randomAt(seed, Math.floor(time / 12), 501);
  let weather = 'clear';
  if (season === 'winter' && roll < .3) weather = 'snow';
  else if (roll < (season === 'summer' ? .1 : .2)) weather = 'rain';
  else if (roll < (season === 'summer' ? .2 : .45)) weather = 'mist';
  return {
    biome, biomeLabel: BIOME_LABELS[biome], season, seasonIndex, hour,
    day: Math.floor(time / 24) + 1, night: 1 - daylight, daylight, weather,
    period: hour >= 5 && hour < 8 ? 'dawn' : hour >= 8 && hour < 17 ? 'day'
      : hour >= 17 && hour < 20 ? 'dusk' : 'night',
  };
}

const TREE_TYPES = {
  forest: ['oak', 'beech', 'birch', 'maple', 'cedar', 'aspen', 'rowan', 'pine'],
  stream: ['willow', 'birch', 'aspen', 'beech', 'oak'],
  meadow: ['oak', 'rowan', 'aspen', 'birch'],
  mountain: ['pine', 'spruce', 'cedar', 'snag'],
  swamp: ['willow', 'cypress', 'snag', 'aspen'],
  enchanted: ['maple', 'cedar', 'oak', 'willow', 'rowan', 'birch'],
};
const LAND_FAUNA = {
  forest: ['fox', 'deer', 'rabbit', 'squirrel', 'bird', 'badger', 'boar', 'wolf', 'bear', 'owl'],
  stream: ['heron', 'bird', 'deer', 'rabbit', 'butterfly', 'dragonfly'],
  meadow: ['horse', 'deer', 'rabbit', 'butterfly', 'bird', 'fox', 'eagle'],
  mountain: ['goat', 'goat', 'eagle', 'lynx', 'wolf', 'bear', 'bird'],
  swamp: ['heron', 'dragonfly', 'frog', 'bird', 'boar'],
  enchanted: ['stag', 'spirit', 'butterfly', 'deer', 'owl', 'fox'],
};

function makeChunk(index, seed) {
  const start = index * CHUNK_LENGTH;
  const random = randomSequence(hash(seed, index, 601));
  const entities = [];
  const choose = array => array[Math.floor(random() * array.length)];
  const add = (kind, variant, s, side, scale = 1, extra = {}) => {
    const ordinal = entities.length;
    const entity = {
      id: `${index}:${ordinal}:${kind}`, kind, variant,
      s: clamp(s, start + .05, start + CHUNK_LENGTH - .05), side, scale,
      seed: hash(seed, index, ordinal + 1000), ...extra,
    };
    entities.push(entity); return entity;
  };
  const animal = (variant, s, side, extra = {}) => add('animal', variant, s, side,
    (SPECIES[variant]?.scale || 1) * (.9 + random() * .18), extra);
  const plant = (s, side, far = false) => {
    const biome = biomeAt(s, seed), x = pathAt(s, seed) + side;
    const water = waterAt(s, x, seed);
    if (water) {
      if (water.kind === 'swamp' && random() < .65) add('lily', 'water', s, side, .8 + random() * .5, { water });
      return;
    }
    const grove = .5 + Math.sin(s * .11 + seed * .000001) * .27 + Math.cos(side * .17 + s * .035) * .23;
    let chance = { forest: .68, enchanted: .68, stream: .48, meadow: .08, mountain: .24, swamp: .4 }[biome];
    chance += far ? grove * .15 : grove * .05;
    // Trees give way to exposed ridges rather than growing out of cliff faces.
    const profile = trailProfileAt(s, seed);
    if (biome === 'mountain' && terrainAt(s, x, seed) - profile.height > 7) chance *= .18;
    if (random() < chance) {
      add('tree', choose(TREE_TYPES[biome]), s, side, .7 + random() * .75);
    } else if (!far || random() < .45) {
      const kind = biome === 'mountain' ? choose(['rock', 'grass', 'bush'])
        : biome === 'swamp' ? choose(['reeds', 'fern', 'bush'])
        : biome === 'forest' || biome === 'enchanted' ? choose(['fern', 'bush', 'mushroom', 'grass'])
        : choose(['flowers', 'grass', 'bush']);
      add(kind, kind === 'rock' ? 'slate' : kind === 'mushroom' && biome === 'enchanted' ? 'glowing' : 'wild', s, side, .7 + random() * .6);
    }
  };
  // Mixed groves leave a readable trail and genuine openings between trees.
  for (let slot = 0; slot < 12; slot++) {
    const s = start + (slot + .1 + random() * .8) * 1.5;
    plant(s, (slot % 2 ? -1 : 1) * (3.2 + random() * 7.8));
  }
  for (const lane of [-4, -3, -2, 2, 3, 4]) for (let row = 0; row < (Math.abs(lane) === 4 ? 2 : 4); row++) {
    const s = start + (row + .14 + random() * .72) * (Math.abs(lane) === 4 ? 9 : 4.5);
    plant(s, lane * 9.4 + (random() - .5) * 7.6, true);
  }
  // Low plants form different, irregular patches along each bank of the trail.
  for (let slot = 0; slot < 17; slot++) {
    const s = start + random() * CHUNK_LENGTH;
    const side = (slot % 2 ? -1 : 1) * (1.55 + random() * (slot < 12 ? 9 : 27));
    const biome = biomeAt(s, seed), water = waterAt(s, pathAt(s, seed) + side, seed);
    if (water) {
      if (water.kind === 'swamp') add('lily', 'water', s, side, .8 + random() * .5, { water });
      continue;
    }
    const roll = random();
    const kind = biome === 'swamp' ? (roll < .55 ? 'reeds' : 'fern')
      : biome === 'mountain' ? (roll < .22 ? 'rock' : roll < .8 ? 'grass' : 'flowers')
      : biome === 'forest' || biome === 'enchanted'
        ? (roll < .35 ? 'fern' : roll < .68 ? 'grass' : roll < .83 ? 'mushroom' : roll < .94 ? 'bush' : 'log')
        : (roll < .55 ? 'grass' : roll < .9 ? 'flowers' : 'bush');
    add(kind, kind === 'flowers' ? choose(['white', 'blue', 'gold', 'pink']) : kind === 'mushroom' && biome === 'enchanted' ? 'glowing' : 'wild', s, side, .65 + random() * .75);
  }

  // Each stretch has its own residents. Encounters are dispersed, never a zoo
  // placed at one point, and larger animals have smaller family groups.
  const centerBiome = biomeAt(start + 9, seed);
  const encounters = centerBiome === 'meadow' ? 2 : 3;
  for (let slot = 0; slot < encounters; slot++) {
    const s = start + 3 + slot * 5 + random() * 2;
    const biome = biomeAt(s, seed), variant = choose(LAND_FAUNA[biome]);
    const side = (random() < .5 ? -1 : 1) * (2.8 + random() * 4.5);
    if (waterAt(s, pathAt(s, seed) + side, seed)) continue;
    if (variant === 'horse') {
      const group = `herd:${index}:${slot}`, count = 3 + Math.floor(random() * 2);
      for (let k = 0; k < count; k++) animal('horse', s + k * .8, side + (k % 2) * 1.5, { group });
    } else if (variant === 'goat' && random() < .6) {
      const group = `goats:${index}:${slot}`;
      for (let k = 0; k < 2; k++) animal('goat', s + k * 1.2, side + k * .9, { group });
    } else animal(variant, s, side);
  }
  if (centerBiome === 'meadow' && index % 3 === 0 && !entities.some(e => e.variant === 'horse')) {
    for (let k = 0; k < 3; k++) animal('horse', start + 7 + k * 1.2, -4.8 - (k % 2) * 1.6, { group: `herd:${index}` });
  }

  // Every actual stream crossing has swimmers, a bird on the bank and reeds.
  const rivers = new Map();
  for (let s = start; s < start + CHUNK_LENGTH; s += 2) {
    const river = riverAt(s, seed);
    if (river && river.center >= start && river.center < start + CHUNK_LENGTH) rivers.set(river.center, river);
  }
  for (const water of rivers.values()) {
    for (const [kind, side] of [['fish', -4.2], ['fish', 6.8], ['duck', 4.4], ['otter', -7.5]]) {
      animal(kind, water.center, side, { water });
    }
    animal('heron', water.center - water.width / 2 - 1, 5.8, { water });
    for (const bank of [-1, 1]) for (const side of [-7, 3.8, 8]) {
      const s = water.center + bank * (water.width / 2 + .8);
      if (s >= start && s < start + CHUNK_LENGTH) add('reeds', 'bank', s, side, 1);
    }
  }
  const pools = new Map();
  for (let s = start; s < start + CHUNK_LENGTH; s += 3) for (const pool of swampPoolsAt(s, seed)) {
    if (pool.s >= start && pool.s < start + CHUNK_LENGTH) pools.set(pool.id, pool);
  }
  for (const water of pools.values()) {
    const side = water.x - pathAt(water.s, seed);
    animal('crocodile', water.s, side + water.bank * (water.rx + .6), { water });
    animal('frog', water.s + 2, side + water.bank * (water.rx + .3), { water });
    animal('dragonfly', water.s - 1, side, { water });
    animal('duck', water.s, side, { water });
    for (let k = 0; k < 3; k++) add('lily', 'water', water.s + (k - 1) * 1.5, side + (k - 1) * 1.1, .9, { water });
    for (const direction of [-1, 1]) add('reeds', 'wetland', water.s, side + direction * (water.rx + .4), 1.2);
  }
  if (index === 0) {
    animal('fox', 5, 2.5);
    animal('rabbit', 10.5, -3.1);
    animal('squirrel', 14, 4.5);
  }
  if (index === 1) {
    animal('deer', 22, -4.5);
    animal('spirit', 29.2, -3.6);
    animal('bird', 32, 3.5);
  }
  return { index, start, end: start + CHUNK_LENGTH, entities };
}

export class TrailWorld {
  constructor(seed = DEFAULT_SEED) {
    this.seed = seedOf(seed);
    this.chunks = new Map();
    this.entities = [];
    this.chunkLength = CHUNK_LENGTH;
    this.centerChunk = null; this.radiusChunks = null;
    this.update(0);
  }

  update(distance = 0, radius = 36) {
    const center = Math.floor(clamp(finite(distance), -MAX_DISTANCE, MAX_DISTANCE) / CHUNK_LENGTH);
    const span = clamp(Math.ceil(finite(radius, 36) / CHUNK_LENGTH), 2, 5);
    if (center === this.centerChunk && span === this.radiusChunks) return this.entities;
    for (const index of this.chunks.keys()) if (Math.abs(index - center) > span) this.chunks.delete(index);
    for (let index = center - span; index <= center + span; index++) {
      if (!this.chunks.has(index)) this.chunks.set(index, makeChunk(index, this.seed));
    }
    this.centerChunk = center; this.radiusChunks = span;
    this.entities = [...this.chunks.values()].flatMap(chunk => chunk.entities)
      .sort((a, b) => a.s - b.s || a.id.localeCompare(b.id));
    return this.entities;
  }
}

function cleanSeen(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const unique = new Set();
  for (let index = value.length - 1; index >= 0 && result.length < 48; index--) {
    const item = value[index];
    if (typeof item !== 'string' || item.length === 0 || item.length > 120 || unique.has(item)) continue;
    unique.add(item);
    result.push(item);
  }
  return result.reverse();
}

function validatedSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1) return createJourney();
  const state = createJourney(raw.seed);
  state.distance = clamp(finite(raw.distance), 0, MAX_DISTANCE);
  state.time = clamp(finite(raw.time, 8), 0, MAX_TIME);
  state.elapsed = clamp(finite(raw.elapsed), 0, 1e10);
  state.mode = MODES.has(raw.mode) ? raw.mode : 'paused';
  state.modeTime = clamp(finite(raw.modeTime), 0, state.mode === 'sleep' ? SLEEP_SECONDS : 1e10);
  state.seen = cleanSeen(raw.seen);
  state.sound = typeof raw.sound === 'boolean' ? raw.sound : false;
  if (state.mode === 'sleep') {
    const start = raw.sleep?.start;
    const target = raw.sleep?.target;
    const expected = blend(start, target, smooth(state.modeTime / SLEEP_SECONDS));
    if (Number.isFinite(start) && Number.isFinite(target) && start >= 0 && target <= MAX_TIME
      && target > start && Math.abs(target - nextMorning(start)) < 1e-7
      && Math.abs(state.time - expected) < 1e-6 && state.modeTime < SLEEP_SECONDS) {
      sleepSessions.set(state, { start, target });
    } else {
      state.mode = 'paused';
      state.modeTime = 0;
    }
  }
  return state;
}

export function serializeJourney(state) {
  const source = state && typeof state === 'object' ? state : createJourney();
  const session = sleepSessions.get(source);
  const clean = validatedSnapshot({ ...source, sleep: session });
  const output = { ...clean };
  const cleanSession = sleepSessions.get(clean);
  if (cleanSession) output.sleep = cleanSession;
  return JSON.stringify(output);
}

export function restoreJourney(raw) {
  try {
    if (typeof raw === 'string') {
      if (raw.length > 16384) return createJourney();
      raw = JSON.parse(raw);
    }
    return validatedSnapshot(raw);
  } catch {
    return createJourney();
  }
}
