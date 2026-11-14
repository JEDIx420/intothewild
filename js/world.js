// Pure journey rules and deterministic scenery. No DOM, timers or network state.
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
  mountain: 'The high pass', enchanted: 'The enchanted grove',
};
const MIDDLE_BIOMES = [
  ['meadow', 'mountain', 'enchanted'], ['meadow', 'enchanted', 'mountain'],
  ['mountain', 'meadow', 'enchanted'], ['mountain', 'enchanted', 'meadow'],
  ['enchanted', 'meadow', 'mountain'], ['enchanted', 'mountain', 'meadow'],
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
  const slot = index % 5;
  if (slot === 0) return 'stream';
  if (slot === 4) return 'forest';
  const cycle = Math.floor(index / 5);
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
    if (biome !== 'mountain' && biome !== 'stream' && biome !== 'meadow') continue;
    // Broad foothills begin before the named mountain section and taper into
    // the next landscape, rather than making a raised platform at its border.
    const edge = biome === 'mountain' ? 20 : 19;
    const weight = smooth((position - boundary(index, seed) + edge) / (edge * 2))
      * (1 - smooth((position - boundary(index + 1, seed) + edge) / (edge * 2)));
    if (biome === 'mountain') mountain += weight;
    else valley += weight * (biome === 'stream' ? 1 : .65);
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
    const center = boundary(index, worldSeed) + 10;
    if (Math.abs(position - center) <= 7) {
      const level = routeShapeAt(center, worldSeed).height - .12;
      return { center, width: 2.7 + randomAt(worldSeed, index, 301) * .6,
        level, bridgeHeight: level + .26 };
    }
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
    slope: pathSlopeAt(position, seed), river: riverAt(position, seed) };
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
  const texture = shoulder * .24 * Math.sin(position * .085 + lateral * .12 + row.phase);
  let height = row.height + foothills + ridge + texture;
  if (row.river) {
    const distance = Math.abs(position - row.river.center);
    const weight = 1 - smooth((distance - row.river.width / 2) / (7 - row.river.width / 2));
    height = blend(height, row.river.level - .16, weight);
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

function makeChunk(index, seed) {
  const start = index * CHUNK_LENGTH;
  const random = randomSequence(hash(seed, index, 601));
  const entities = [];
  const add = (kind, variant, s, side, scale = 1) => {
    const ordinal = entities.length;
    entities.push({
      id: `${index}:${ordinal}:${kind}`, kind, variant, s, side, scale,
      seed: hash(seed, index, ordinal + 1000),
    });
  };
  for (let slot = 0; slot < 12; slot++) {
    const s = start + (slot + .1 + random() * .8) * (CHUNK_LENGTH / 12);
    const biome = biomeAt(s, seed);
    const side = (slot % 2 ? -1 : 1) * (3.1 + random() * 7);
    const choice = random();
    const scale = .8 + random() * .7;
    const river = riverAt(s, seed);
    if (river && Math.abs(s - river.center) < river.width / 2 + .4) continue;
    const treeChance = { forest: .88, enchanted: .84, stream: .66, meadow: .17, mountain: .25 }[biome];
    if (choice < treeChance) {
      const variant = biome === 'mountain' ? 'pine' : choice < .24 ? 'birch' : choice < .5 ? 'pine' : 'oak';
      add('tree', variant, s, side, scale);
    } else {
      const kind = biome === 'mountain' ? 'rock' : biome === 'enchanted' ? 'mushroom' : 'flowers';
      add(kind, kind === 'rock' ? 'granite' : kind === 'mushroom' ? 'glowing' : 'wild', s, side, scale);
    }
  }
  for (let slot = 0; slot < 6; slot++) {
    const s = start + random() * CHUNK_LENGTH;
    const side = (random() < .5 ? -1 : 1) * (1.8 + random() * 7.5);
    const choice = random();
    const biome = biomeAt(s, seed);
    const kind = choice < .16 ? 'log' : choice < .45 ? 'rock'
      : biome === 'forest' || biome === 'enchanted' ? 'mushroom' : 'flowers';
    const variant = kind === 'mushroom' ? (biome === 'enchanted' ? 'glowing' : 'red')
      : kind === 'rock' ? 'moss' : kind === 'flowers' ? 'wild' : 'fallen';
    const river = riverAt(s, seed);
    if (!river || Math.abs(s - river.center) > river.width / 2 + .3) add(kind, variant, s, side, .7 + random() * .5);
  }
  // Distant stands fill the wider view at the same small physical scale.
  // Jittered groves leave clearings and expose the terrain between canopies.
  for (const lane of [-4, -3, -2, 2, 3, 4]) for (let row = 0; row < 4; row++) {
    const s = start + (row + .14 + random() * .72) * (CHUNK_LENGTH / 4);
    const side = lane * 9.4 + (random() - .5) * 7.6;
    const biome = biomeAt(s, seed), river = riverAt(s, seed);
    if (river && Math.abs(s - river.center) < river.width / 2 + .6) continue;
    const grove = .5 + Math.sin(s * .11 + seed * .000001) * .27
      + Math.cos(side * .17 + s * .035) * .23;
    const chance = { forest: .64, enchanted: .7, stream: .53, meadow: .08, mountain: .18 }[biome]
      + grove * (biome === 'meadow' ? .14 : .24);
    const roll = random();
    if (roll < chance) {
      const variant = biome === 'mountain' || random() < .32 ? 'pine' : random() < .3 ? 'birch' : 'oak';
      add('tree', variant, s, side, .72 + random() * .65);
    } else if (random() < .55) {
      const kind = biome === 'mountain' ? 'rock' : biome === 'enchanted' ? 'mushroom' : 'flowers';
      add(kind, kind === 'rock' ? 'granite' : kind === 'mushroom' ? 'glowing' : 'wild', s, side, .7 + random() * .7);
    }
  }
  if (random() < .5) {
    const choices = ['fox', 'deer', 'rabbit', 'bird'];
    add('animal', choices[Math.floor(random() * choices.length)], start + 3 + random() * 12,
      (random() < .5 ? -1 : 1) * (2.7 + random() * 2.8), .85 + random() * .3);
  }
  if (index > 2 && randomAt(seed, index, 602) < .08) {
    add('animal', randomAt(seed, index, 603) < .5 ? 'spirit' : 'stag', start + 9, -3.8, 1.1);
  }
  if (index === 0) {
    add('animal', 'fox', 5, 2.5, 1);
    add('animal', 'rabbit', 10.5, -3.1, .85);
  }
  if (index === 1) add('animal', 'spirit', 29.2, -3.6, 1.15);
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
