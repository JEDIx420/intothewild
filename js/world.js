// Pure journey rules and deterministic scenery. No DOM, timers or network state.
import { SPECIES } from './bestiary.js?v=6';
import { REST_TIMING, restEntryDuration } from './traveller.js?v=7';
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
    mode: 'paused', modeTime: 0, rest: null, seen: [], sound: false,
  };
}

function nextMorning(time) {
  const morning = Math.floor(time / 24) * 24 + 7;
  return morning > time + 1e-9 ? morning : morning + 24;
}

export function setActivity(state, mode) {
  if (!state || !MODES.has(mode)) return state;
  if (state.rest?.phase === 'exit') {
    // A second request changes where to go next, never restarts the recovery.
    state.rest.nextMode = mode;
    return state;
  }
  if (state.mode === mode) return state;
  sleepSessions.delete(state);
  if (state.rest?.kind === 'snack' && mode === 'sleep') {
    const fromSnack = state.rest;
    state.mode = 'sleep';
    state.modeTime = 0;
    state.rest = { kind: 'sleep', phase: 'enter', time: 0, wasWalking: false,
      entryDistance: state.distance, entryElapsed: state.elapsed, entryModeTime: 0, fromSnack };
    return state;
  }
  if (state.rest) {
    const rest = state.rest;
    rest.fromPhase = rest.phase;
    rest.fromTime = rest.time;
    rest.fromElapsed = state.elapsed;
    rest.phase = 'exit';
    rest.time = 0;
    rest.nextMode = mode;
    return state;
  }
  const wasWalking = state.mode === 'walking';
  const entryModeTime = state.modeTime;
  state.mode = mode;
  state.modeTime = 0;
  if (mode === 'snack' || mode === 'sleep') {
    state.rest = { kind: mode, phase: 'enter', time: 0, wasWalking,
      entryDistance: state.distance, entryElapsed: state.elapsed, entryModeTime };
  }
  return state;
}

export function stepJourney(state, dt) {
  if (!state || !Number.isFinite(dt) || dt <= 0) return state;
  let remaining = Math.min(dt, .1);
  // Split a frame at phase boundaries so a low frame rate cannot skip a pose,
  // advance sleep before settling, or start walking before the pack is on.
  while (remaining > 1e-10) {
    const rest = state.rest;
    const asleep = rest?.kind === 'sleep' && rest.phase === 'idle';
    const duration = rest?.phase === 'enter' ? restEntryDuration(rest)
      : rest?.phase === 'exit' ? REST_TIMING[rest.kind].exit : asleep ? SLEEP_SECONDS : Infinity;
    const delta = Math.min(remaining, Math.max(0, duration - (rest?.time || 0)));
    state.elapsed += delta;
    state.modeTime += delta;
    if (rest) rest.time += delta;
    if (asleep) {
      let session = sleepSessions.get(state);
      if (!session) {
        session = { start: state.time, target: nextMorning(state.time) };
        sleepSessions.set(state, session);
      }
      state.time = blend(session.start, session.target, smooth(rest.time / SLEEP_SECONDS));
    } else {
      state.time += delta * HOURS_PER_SECOND;
      if (!rest && state.mode === 'walking') state.distance += delta * WALK_SPEED;
    }
    remaining -= delta;
    if (rest && rest.time >= duration - 1e-9) {
      if (rest.phase === 'enter') {
        rest.phase = 'idle'; rest.time = 0;
        if (rest.kind === 'sleep') sleepSessions.set(state, { start: state.time, target: nextMorning(state.time) });
      } else if (rest.phase === 'exit') {
        const next = rest.nextMode || 'paused';
        state.rest = null; state.mode = 'paused'; state.modeTime = 0;
        setActivity(state, next);
      } else {
        state.time = sleepSessions.get(state).target;
        setActivity(state, 'paused');
      }
    }
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
  forest: [['rabbit', 23], ['squirrel', 20], ['bird', 16], ['deer', 15], ['fox', 10], ['badger', 6], ['owl', 4], ['boar', 3], ['wolf', 2], ['bear', 1]],
  stream: [['bird', 28], ['butterfly', 20], ['dragonfly', 24], ['rabbit', 16], ['deer', 12]],
  meadow: [['horse', 18], ['deer', 18], ['rabbit', 20], ['butterfly', 20], ['bird', 16], ['fox', 6], ['eagle', 2]],
  mountain: [['goat', 40], ['eagle', 20], ['bird', 20], ['lynx', 8], ['wolf', 8], ['bear', 4]],
  swamp: [['heron', 20], ['dragonfly', 35], ['frog', 25], ['bird', 15], ['boar', 5]],
  enchanted: [['butterfly', 28], ['deer', 24], ['owl', 12], ['fox', 12], ['squirrel', 24]],
};
const ENCOUNTER_SPACING = 48;

function encounterAt(cell, seed) {
  const s = cell * ENCOUNTER_SPACING + 13 + randomAt(seed, cell, 701) * 14;
  // The opening has one fox. Everything after it uses the same spaced rules.
  if (s >= -20 && s < 35) return null;
  const biome = biomeAt(s, seed);
  // One possible magical visitor in each five-slot stretch, with some of those
  // stretches staying ordinary. Magic replaces a regular encounter; it never
  // adds a second creature or a herd beside it.
  const mystical = cell >= 2 && cell % 5 === 2 && randomAt(seed, Math.floor(cell / 5), 718) < .65;
  if (!mystical && randomAt(seed, cell, 702) >= .78) return null;
  let variant;
  if (mystical) {
    const choices = biome === 'forest' || biome === 'meadow' || biome === 'enchanted'
      ? ['unicorn', 'stag', 'spirit'] : ['spirit'];
    variant = choices[Math.floor(randomAt(seed, cell, 703) * choices.length)];
  } else {
    const choices = LAND_FAUNA[biome];
    let roll = randomAt(seed, cell, 703) * choices.reduce((sum, [, weight]) => sum + weight, 0);
    variant = choices[choices.length - 1][0];
    for (const [kind, weight] of choices) { roll -= weight; if (roll < 0) { variant = kind; break; } }
  }
  const side = (randomAt(seed, cell, 704) < .5 ? -1 : 1) * (3.2 + randomAt(seed, cell, 705) * 4.2);
  if (riverAt(s, seed) || waterAt(s, pathAt(s, seed) + side, seed)) return null;
  const count = variant === 'horse' ? 2 + (randomAt(seed, cell, 706) < .4 ? 1 : 0)
    : variant === 'goat' && randomAt(seed, cell, 706) < .25 ? 2 : 1;
  return { cell, s, side, variant, count, mystical };
}

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

  // Global encounter slots cross chunk boundaries cleanly. Empty slots leave
  // longer quiet stretches; nearby members of one family count as one sighting.
  for (let cell = Math.floor((start - 4) / ENCOUNTER_SPACING); cell <= Math.floor((start + CHUNK_LENGTH) / ENCOUNTER_SPACING); cell++) {
    const encounter = encounterAt(cell, seed);
    if (!encounter) continue;
    const { s, side, variant, count, mystical } = encounter;
    for (let member = 0; member < count; member++) {
      const position = s + member * 1.2;
      if (position < start || position >= start + CHUNK_LENGTH) continue;
      animal(variant, position, side + (member % 2) * 1.4, {
        encounter: `trail:${cell}`, encounterS: s, mystical,
        ...(count > 1 ? { group: `family:${cell}` } : {}),
      });
    }
  }

  // Rivers can be quiet too: an occasional trout or one visitor along a bank.
  const rivers = new Map();
  for (let s = start; s < start + CHUNK_LENGTH; s += 2) {
    const river = riverAt(s, seed);
    if (river && river.center >= start && river.center < start + CHUNK_LENGTH) rivers.set(river.center, river);
  }
  for (const water of rivers.values()) {
    const key = Math.floor(water.center * 10);
    if (randomAt(seed, key, 901) < .72) {
      animal('fish', water.center, randomAt(seed, key, 902) < .5 ? -4.2 : 6.8, { water });
    }
    if (randomAt(seed, key, 903) < .4) {
      const kind = ['duck', 'otter', 'heron'][Math.floor(randomAt(seed, key, 904) * 3)];
      animal(kind, kind === 'heron' ? water.center - water.width / 2 - 1 : water.center,
        randomAt(seed, key, 905) < .5 ? -6.3 : 5.8, { water });
    }
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
    const region = regionAt(water.s, seed), localPools = poolsInRegion(region, seed);
    const chosen = localPools[Math.floor(randomAt(seed, region, 911) * localPools.length)];
    if (chosen?.id === water.id && randomAt(seed, region, 912) < .7) {
      const roll = randomAt(seed, region, 913);
      const kind = roll < .55 ? 'crocodile' : roll < .75 ? 'heron' : roll < .9 ? 'otter' : 'duck';
      const bank = kind === 'crocodile' || kind === 'heron';
      animal(kind, water.s, side + (bank ? water.bank * (water.rx + .6) : 0), { water });
    }
    if (randomAt(seed, Math.floor(water.s * 10), 914) < .16) {
      const kind = randomAt(seed, Math.floor(water.s), 915) < .5 ? 'frog' : 'dragonfly';
      animal(kind, water.s + 1, side + (kind === 'frog' ? water.bank * (water.rx + .3) : 0), { water });
    }
    for (let k = 0; k < 3; k++) add('lily', 'water', water.s + (k - 1) * 1.5, side + (k - 1) * 1.1, .9, { water });
    for (const direction of [-1, 1]) add('reeds', 'wetland', water.s, side + direction * (water.rx + .4), 1.2);
  }
  if (index === 0) animal('fox', 5, 2.5, { encounter: 'opening', encounterS: 5, mystical: false });
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

function cleanRest(raw, state) {
  if (!raw || typeof raw !== 'object' || !REST_TIMING[raw.kind] || raw.kind !== state.mode
    || !['enter', 'idle', 'exit'].includes(raw.phase)) return null;
  const source = raw.kind === 'sleep' && raw.fromSnack?.kind === 'snack'
    && ['enter', 'idle'].includes(raw.fromSnack.phase)
    ? cleanRest(raw.fromSnack, { ...state, mode: 'snack' }) : null;
  const entryDuration = restEntryDuration({ kind: raw.kind, fromSnack: source });
  const phaseLimit = raw.phase === 'enter' ? entryDuration
    : raw.phase === 'exit' ? REST_TIMING[raw.kind].exit : raw.kind === 'sleep' ? SLEEP_SECONDS : 1e10;
  const rest = {
    kind: raw.kind, phase: raw.phase, time: clamp(finite(raw.time), 0, phaseLimit),
    wasWalking: raw.wasWalking === true,
    entryDistance: clamp(finite(raw.entryDistance, state.distance), 0, state.distance),
    entryElapsed: clamp(finite(raw.entryElapsed, state.elapsed), 0, state.elapsed),
    entryModeTime: clamp(finite(raw.entryModeTime), 0, 1e10),
  };
  if (source) rest.fromSnack = source;
  if (rest.phase === 'exit') {
    rest.fromPhase = raw.fromPhase === 'enter' ? 'enter' : 'idle';
    const limit = rest.fromPhase === 'enter' ? entryDuration
      : rest.kind === 'sleep' ? SLEEP_SECONDS : 1e10;
    rest.fromTime = clamp(finite(raw.fromTime), 0, limit);
    rest.fromElapsed = clamp(finite(raw.fromElapsed, state.elapsed), 0, state.elapsed);
    rest.nextMode = MODES.has(raw.nextMode) ? raw.nextMode : 'paused';
  }
  return rest;
}

function validatedSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1) return createJourney();
  const state = createJourney(raw.seed);
  state.distance = clamp(finite(raw.distance), 0, MAX_DISTANCE);
  state.time = clamp(finite(raw.time, 8), 0, MAX_TIME);
  state.elapsed = clamp(finite(raw.elapsed), 0, 1e10);
  state.mode = MODES.has(raw.mode) ? raw.mode : 'paused';
  state.modeTime = clamp(finite(raw.modeTime), 0, 1e10);
  state.seen = cleanSeen(raw.seen);
  state.sound = typeof raw.sound === 'boolean' ? raw.sound : false;
  if (state.mode === 'snack' || state.mode === 'sleep') {
    // Version-one saves predate the animated setup. Resume their seated pose
    // rather than replaying an entrance or discarding the existing journey.
    const legacy = !Object.hasOwn(raw, 'rest');
    state.rest = cleanRest(legacy ? {
      kind: state.mode, phase: 'idle', time: state.modeTime, wasWalking: false,
      entryDistance: state.distance, entryElapsed: Math.max(0, state.elapsed - state.modeTime), entryModeTime: 0,
    } : raw.rest, state);
    if (!state.rest) { state.mode = 'paused'; state.modeTime = 0; }
  }
  if (state.rest?.kind === 'sleep' && state.rest.phase === 'idle') {
    const start = raw.sleep?.start;
    const target = raw.sleep?.target;
    const expected = blend(start, target, smooth(state.rest.time / SLEEP_SECONDS));
    if (Number.isFinite(start) && Number.isFinite(target) && start >= 0 && target <= MAX_TIME
      && target > start && Math.abs(target - nextMorning(start)) < 1e-7
      && Math.abs(state.time - expected) < 1e-6 && state.rest.time < SLEEP_SECONDS) {
      sleepSessions.set(state, { start, target });
    } else {
      state.mode = 'paused';
      state.modeTime = 0;
      state.rest = null;
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
