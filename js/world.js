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

export function pathAt(s, seed = DEFAULT_SEED) {
  const position = finite(s);
  const worldSeed = seedOf(seed);
  const a = randomAt(worldSeed, 0, 201) * TAU;
  const b = randomAt(worldSeed, 0, 202) * TAU;
  return (Math.sin(position * .026 + a) - Math.sin(a)) * 1.8
    + (Math.sin(position * .063 + b) - Math.sin(b)) * .55;
}

export function riverAt(s, seed = DEFAULT_SEED) {
  const position = finite(s);
  const worldSeed = seedOf(seed);
  const region = regionAt(position, worldSeed);
  for (let index = Math.max(0, region - 1); index <= region + 1; index++) {
    if (regionBiome(index, worldSeed) !== 'stream') continue;
    const center = boundary(index, worldSeed) + 10;
    if (Math.abs(position - center) <= 7) {
      return { center, width: 2.7 + randomAt(worldSeed, index, 301) * .6 };
    }
  }
  return null;
}

export function terrainAt(s, side, seed = DEFAULT_SEED) {
  const position = finite(s);
  const worldSeed = seedOf(seed);
  const lateral = finite(side) - pathAt(position, worldSeed);
  const phase = randomAt(worldSeed, 0, 401) * TAU;
  const shoulder = smooth((Math.abs(lateral) - 1.3) / 6.7);
  let mountain = 0;
  const region = regionAt(position, worldSeed);
  for (let index = Math.max(0, region - 1); index <= region + 1; index++) {
    if (regionBiome(index, worldSeed) !== 'mountain') continue;
    mountain += smooth((position - boundary(index, worldSeed) + 12) / 24)
      * (1 - smooth((position - boundary(index + 1, worldSeed) + 12) / 24));
  }
  let height = .17 + .065 * Math.sin(position * .053 + phase)
    + .04 * Math.sin(position * .019 + phase * .7)
    + shoulder * .08 * Math.sin(position * .085 + lateral * .15 + phase)
    + mountain * (.86 + shoulder * (.68 + .1 * Math.sin(position * .11 + phase)));
  const river = riverAt(position, worldSeed);
  if (river) {
    const distance = Math.abs(position - river.center);
    const weight = 1 - smooth((distance - river.width / 2) / (7 - river.width / 2));
    height = blend(height, -.13, weight);
  }
  return clamp(height, -.15, 2);
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
    this.centerChunk = null;
    this.update(0);
  }

  update(distance = 0) {
    const center = Math.floor(clamp(finite(distance), -MAX_DISTANCE, MAX_DISTANCE) / CHUNK_LENGTH);
    if (center === this.centerChunk) return this.entities;
    for (const index of this.chunks.keys()) if (Math.abs(index - center) > 2) this.chunks.delete(index);
    for (let index = center - 2; index <= center + 2; index++) {
      if (!this.chunks.has(index)) this.chunks.set(index, makeChunk(index, this.seed));
    }
    this.centerChunk = center;
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
