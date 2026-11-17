import { pathAt, riverAt } from './world.js?v=10';
import { SPECIES, REACTIONS } from './bestiary.js?v=10';

const TAU = Math.PI * 2;
const QUARTER = Math.PI / 2;
const TYPES = {
  fox: { along: 2.2, across: 1.15, move: 2.8, rest: 1.65, stride: .66, action: 'trot' },
  deer: { along: 2.65, across: 1.25, move: 4.3, rest: 2.8, stride: 1.05, action: 'walk' },
  stag: { along: 2.8, across: 1.4, move: 5, rest: 2.1, stride: 1.15, action: 'walk' },
  rabbit: { along: 1.55, across: .85, move: 3, rest: 1.8, stride: .5, action: 'hop' },
  bird: { along: 2.8, across: 1.6, move: 2.65, rest: 2, stride: .3, action: 'flutter' },
  spirit: { along: 2.35, across: 1.65, move: 4.5, rest: .1, stride: 1, action: 'drift' },
  horse: { along: 3.2, across: 1.4, move: 4.4, rest: 3.5, stride: 1.3, action: 'walk' },
  unicorn: { along: 2.6, across: 1.2, move: 5.6, rest: 4.8, stride: 1.3, action: 'walk' },
  wolf: { along: 2.8, across: 1.25, move: 3.7, rest: 2.4, stride: .9, action: 'trot' },
  bear: { along: 2.25, across: 1, move: 6.7, rest: 4.4, stride: 1.1, action: 'amble' },
  boar: { along: 2.1, across: 1.1, move: 4.5, rest: 3.2, stride: .65, action: 'trot' },
  badger: { along: 1.65, across: .9, move: 4.8, rest: 3.4, stride: .5, action: 'snuffle' },
  squirrel: { along: 1.75, across: 1.1, move: 2.8, rest: 3.1, stride: .4, action: 'hop' },
  goat: { along: 2.1, across: 1.1, move: 4.2, rest: 4.1, stride: .75, action: 'climb' },
  lynx: { along: 2.35, across: 1.2, move: 5.1, rest: 3.7, stride: .75, action: 'prowl' },
  owl: { along: 2.8, across: 1.8, move: 5.8, rest: 5, stride: 1, action: 'glide' },
  eagle: { along: 3.2, across: 2.6, move: 7.4, rest: .5, stride: 1, action: 'soar' },
  otter: { along: .6, across: 2.2, move: 3.8, rest: 1.8, stride: .65, action: 'swim' },
  duck: { along: .45, across: 1.8, move: 6.1, rest: 2.1, stride: .7, action: 'paddle' },
  heron: { along: 1.5, across: .7, move: 6.5, rest: 5.1, stride: .8, action: 'wade' },
  crocodile: { along: 1.2, across: .7, move: 8.5, rest: 10.5, stride: .8, action: 'crawl' },
  frog: { along: .85, across: .6, move: 3.3, rest: 4.6, stride: .3, action: 'hop' },
  fish: { along: .35, across: 2.4, move: 3.5, rest: .6, stride: .5, action: 'swim' },
  butterfly: { along: 1.7, across: 1.4, move: 4.8, rest: .3, stride: .5, action: 'flutter' },
  dragonfly: { along: 1.8, across: 1.6, move: 2.8, rest: 2.4, stride: .6, action: 'hover' },
};
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const identity = e => e.id ?? `${e.variant}:${e.seed}:${e.s}:${e.side}`;
function random(seed, salt) {
  let n = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  n = Math.imul(n ^ n >>> 16, 0x7feb352d);
  n = Math.imul(n ^ n >>> 15, 0x846ca68b);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}

// Integrating the ellipse's tangent ties the legs to travelled distance instead
// of the clock. A pause therefore also pauses the walk cycle.
function arcLength(angle, along, across) {
  const turns = Math.floor(angle / TAU);
  const end = angle - turns * TAU;
  const perimeter = Math.PI * (3 * (along + across)
    - Math.sqrt((3 * along + across) * (along + 3 * across)));
  const step = end / 12;
  let sum = 0;
  for (let i = 0; i <= 12; i++) {
    const a = i * step;
    const tangent = Math.hypot(along * Math.cos(a), across * Math.sin(a));
    sum += tangent * (i === 0 || i === 12 ? 1 : i % 2 ? 4 : 2);
  }
  return turns * perimeter + sum * step / 3;
}

// One unhurried amphibious cycle: sunning, sliding in, drifting on the water,
// and returning to the same bank. All coordinates stay in world space.
function crocodileLife(e, elapsed, worldSeed) {
  const water = e.water || riverAt(e.s, worldSeed), seed = finite(e.seed) >>> 0;
  const t = Math.max(0, finite(elapsed));
  if (!water) return null;
  const river = water.kind !== 'swamp';
  const bankS = river ? water.center + (e.waterBank || (e.s < water.center ? -1 : 1)) * (water.width * .5 + 1.05) : e.s;
  const bankX = pathAt(bankS, worldSeed) + e.side;
  const waterS = river ? water.center + (e.waterBank || 1) * water.width * .08 : water.s;
  const waterX = river ? pathAt(waterS, worldSeed) + (e.side < 0 ? -1 : 1) * Math.max(2.5, Math.abs(e.side))
    : water.x - (water.bank || 1) * water.rx * .32;
  const phase = (t + random(seed, 202) * 34) % 34;
  const entering = phase >= 15 && phase < 19, leaving = phase >= 29 && phase < 33;
  const wet = phase >= 19 && phase < 29;
  const progress = entering ? smooth((phase - 15) / 4) : wet ? 1 : leaving ? 1 - smooth((phase - 29) / 4) : 0;
  const angle = Math.max(0, phase - 19) * .5 + random(seed, 203) * TAU;
  const swimBlend = wet ? smooth((phase - 19) / 1.4) * smooth((29 - phase) / 1.4) : 0;
  const sx = Math.sin(angle) * (river ? water.width * .13 : Math.min(water.rs * .27, 1.8)) * swimBlend;
  const dx = Math.cos(angle) * (river ? .38 : Math.min(water.rx * .2, 1.1)) * swimBlend;
  const s = bankS + (waterS - bankS) * progress + sx * progress;
  const x = bankX + (waterX - bankX) * progress + dx * progress;
  const speed = wet ? .19 : entering || leaving ? .72 : 0;
  return { s, x, y: -s, side: x - pathAt(s, worldSeed),
    yaw: wet ? angle + Math.PI * .5 : Math.atan2(-(waterS - bankS), waterX - bankX),
    speed, gait: t * speed * 1.5, hop: 0, graze: 0, rear: 0, alert: 0, dive: 0,
    splash: (entering || leaving) && progress > .5 && progress < .92 ? .24 : 0,
    activity: wet ? 'float' : entering || leaving ? 'slide' : 'bask',
    swimming: wet || progress > .8, waterLevel: water.level,
    submerge: wet ? .1 + Math.sin(t * .8 + seed) * .025 : 0,
  };
}

/**
 * A repeatable, bounded little life around a creature's spawn.
 * World coordinates use +s along the trail, -Y in the renderer. Elapsed game
 * time is independent of walking, so inhabitants keep living during a rest.
 */
export function sampleWildlife(entity, elapsed = 0, worldSeed) {
  const e = entity || {};
  const kind = e.variant || e.kind || 'deer';
  const type = TYPES[kind] || TYPES.deer;
  const seed = finite(e.seed) >>> 0;
  const t = Math.max(0, finite(elapsed));
  if (kind === 'crocodile' && e.water) return crocodileLife(e, t, worldSeed);
  const along = type.along * (.9 + random(seed, 11) * .2);
  const across = type.across * (.9 + random(seed, 12) * .2);
  const move = type.move * (.94 + random(seed, 13) * .12);
  const rest = type.rest * (.85 + random(seed, 14) * .3);
  const stepDuration = move + rest;
  const localTime = t + random(seed, 15) * stepDuration * 4;
  const leg = Math.floor(localTime / stepDuration);
  const within = localTime - leg * stepDuration;
  const raw = clamp(within / move);
  const phase = random(seed, 16) * TAU;
  let progress = smooth(raw);
  let rate = within < move ? 6 * raw * (1 - raw) / move : 0;
  let hop = 0;

  if (['rabbit', 'squirrel', 'frog'].includes(kind) && within < move) {
    // Rabbits move only during each leap, with a short planted beat between
    // hops; their bodies never skate along the ground while their feet rest.
    const hops = kind === 'squirrel' ? 4 : kind === 'frog' ? 2 : 3;
    const jump = raw * hops;
    const whole = Math.floor(jump);
    const u = (jump - whole) / .72;
    progress = (whole + smooth(u)) / hops;
    rate = u < 1 ? 6 * u * (1 - u) / (.72 * move) : 0;
    hop = u < 1 ? Math.sin(Math.PI * u) * (kind === 'squirrel' ? .19 : kind === 'frog' ? .27 : .34) : 0;
  } else if (kind === 'bird') {
    hop = within < move ? Math.sin(Math.PI * raw) * .95 : 0;
  } else if (kind === 'eagle') {
    hop = 2.5 + Math.sin(t * .45 + seed) * .55;
  } else if (kind === 'owl') {
    hop = within < move ? Math.sin(Math.PI * raw) * 1.6 : 0;
  } else if (kind === 'butterfly' || kind === 'dragonfly') {
    hop = (kind === 'butterfly' ? .75 : .45) + Math.sin(t * 2.4 + seed) * .15;
  }

  const angle = phase + (leg + progress) * QUARTER;
  const velocity = rate * QUARTER;
  let center = finite(e.s);
  const river = e.water || riverAt(center, worldSeed);
  const aquatic = SPECIES[kind]?.habitat === 'water';
  if (river && river.kind !== 'swamp' && !aquatic && !['spirit', 'eagle', 'butterfly', 'dragonfly'].includes(kind)) {
    // Even a spawn in the channel is moved onto its nearest bank. The entire
    // patrol remains on that bank, including the body and feet at the turn.
    const bank = river.width * .5 + .7;
    center = center < river.center
      ? Math.min(center, river.center - bank - along)
      : Math.max(center, river.center + bank + along);
  }

  let s = center + Math.sin(angle) * along;
  let side = finite(e.side) + Math.cos(angle) * across;
  let x = pathAt(s, worldSeed) + side;
  let ds = Math.cos(angle) * along;
  let dside = -Math.sin(angle) * across;
  if (aquatic && river) {
    const radiusS = river.kind === 'swamp' ? Math.min(along, river.rs * .68) : river.width * .28;
    const radiusX = river.kind === 'swamp' ? Math.min(across, river.rx * .68) : across;
    s = (river.kind === 'swamp' ? river.s : river.center) + Math.sin(angle) * radiusS;
    x = (river.kind === 'swamp' ? river.x : pathAt(e.s, worldSeed) + finite(e.side)) + Math.cos(angle) * radiusX;
    if (river.kind !== 'swamp') {
      const bank = finite(e.side) < 0 ? -1 : 1;
      x = pathAt(s, worldSeed) + bank * Math.max(2, Math.abs(x - pathAt(s, worldSeed)));
    }
    side = x - pathAt(s, worldSeed);
    ds = Math.cos(angle) * radiusS;
    dside = -Math.sin(angle) * radiusX;
  } else if (river?.kind === 'swamp') {
    // Basking animals stay outside an oval pool until an interaction asks for
    // a splash. This also keeps their feet from skating over the water.
    const nx = (x - river.x) / river.rx, ns = (s - river.s) / river.rs;
    const q = Math.hypot(nx, ns);
    if (q < 1.09 && q > .001) {
      x = river.x + nx / q * river.rx * 1.09;
      s = river.s + ns / q * river.rs * 1.09;
      side = x - pathAt(s, worldSeed);
    }
  }
  const trailSlope = (pathAt(s + .01, worldSeed) - pathAt(s - .01, worldSeed)) / .02;
  const dx = dside + (aquatic && river ? 0 : ds * trailSlope);
  const speed = Math.hypot(dx, ds) * velocity;
  const restProgress = clamp((within - move) / rest);
  const graze = within > move
    ? smooth(restProgress / .22) * smooth((1 - restProgress) / .22)
    : 0;
  let activity = within < move ? type.action : kind === 'crocodile' ? 'bask' : 'look';
  if (graze > .1) activity = ['fox', 'wolf', 'bear', 'boar', 'badger', 'lynx'].includes(kind) ? 'sniff'
    : kind === 'bird' || kind === 'heron' ? 'peck' : kind === 'crocodile' ? 'bask'
    : kind === 'squirrel' ? 'nibble' : ['owl', 'eagle', 'frog'].includes(kind) ? 'look'
    : aquatic ? 'float' : 'graze';
  let splash = 0;
  if (kind === 'fish') {
    const cycle = 6.5 + random(seed, 49) * 4, jumpTime = (t + random(seed, 50) * cycle) % cycle;
    const jump = jumpTime / .9;
    if (jump < 1) hop = Math.sin(jump * Math.PI) * .95;
    if (jumpTime > .8 && jumpTime < 1.5) splash = Math.sin((jumpTime - .8) / .7 * Math.PI);
  }
  return {
    s, side, x, y: -s, yaw: Math.atan2(-ds, dx), speed,
    gait: arcLength(angle, along, across) / type.stride * TAU,
    hop, activity, graze, rear: kind === 'squirrel' && graze > .1 ? graze * .6 : 0, alert: 0, dive: 0, splash,
    waterLevel: aquatic && river ? river.level : undefined,
  };
}

const MOTIONS = {
  rush: { duration: 2.25, distance: 2, recovery: 3.5 },
  flee: { duration: 3.2, distance: 5.6, recovery: 5.5 },
  bound: { duration: 3.1, distance: 4.5, recovery: 4.8 },
  stepAway: { duration: 4, distance: 2.2, recovery: 4.5 },
  approach: { duration: 3.5, distance: -2.8, recovery: 4.4 },
  circle: { duration: 4.6, distance: 1.35, recovery: 3.1 },
  fly: { duration: 4.7, distance: 5, recovery: 5.5 },
  hop: { duration: 2.4, distance: 1.1, recovery: 3.2 },
  pounce: { duration: 2.3, distance: 1.4, recovery: 3.3 },
  jump: { duration: 1.5, distance: .65, recovery: 2.8 },
  rise: { duration: 3.6, distance: .5, recovery: 4 },
};

function constrainWater(pose, entity, worldSeed) {
  const water = entity.water || riverAt(entity.s, worldSeed) || riverAt(pose.s, worldSeed);
  if (entity.variant === 'crocodile' && water) {
    pose.swimming = water.kind === 'swamp'
      ? Math.hypot((pose.x-water.x)/water.rx, (pose.s-water.s)/water.rs) < .96
      : Math.abs(pose.s-water.center) < water.width * .45;
    pose.y = -pose.s;
    pose.side = pose.x - pathAt(pose.s, worldSeed);
    pose.waterLevel = water.level;
    return pose;
  }
  if (SPECIES[entity.variant]?.habitat === 'water' && water) {
    if (water.kind === 'swamp') {
      const dx = (pose.x - water.x) / water.rx, ds = (pose.s - water.s) / water.rs;
      const q = Math.hypot(dx, ds);
      if (q > .86) { pose.x = water.x + dx / q * water.rx * .86; pose.s = water.s + ds / q * water.rs * .86; }
    } else {
      pose.s = Math.max(water.center - water.width * .38, Math.min(water.center + water.width * .38, pose.s));
      const bank = finite(entity.side) < 0 ? -1 : 1;
      pose.x = pathAt(pose.s, worldSeed) + bank * Math.max(2, Math.abs(pose.x - pathAt(pose.s, worldSeed)));
    }
    pose.waterLevel = water.level;
  } else if (water && water.kind !== 'swamp' && SPECIES[entity.variant]?.habitat !== 'air') {
    const side = entity.s < water.center ? -1 : 1;
    const minimum = water.width * .5 + .7;
    pose.s = side < 0 ? Math.min(pose.s, water.center - minimum) : Math.max(pose.s, water.center + minimum);
  } else if (water?.kind === 'swamp' && SPECIES[entity.variant]?.habitat !== 'air') {
    const dx = (pose.x - water.x) / water.rx, ds = (pose.s - water.s) / water.rs;
    const q = Math.hypot(dx, ds);
    if (q < 1.04 && q > .001) { pose.x = water.x + dx / q * water.rx * 1.04; pose.s = water.s + ds / q * water.rs * 1.04; }
  }
  pose.y = -pose.s;
  pose.side = pose.x - pathAt(pose.s, worldSeed);
  return pose;
}

/** Stateful touch reactions over deterministic autonomous wildlife.
 * Positions are sampled at the touch and blended back into the animal's normal
 * life afterwards. Neither tapping nor the end of a reaction teleports it.
 */
export class WildlifeDirector {
  constructor(seed) {
    this.seed = seed;
    this.known = new Map();
    this.reactions = new Map();
    this.counts = new Map();
    this.limit = 160;
  }
  sample(entity, elapsed = 0, worldSeed = this.seed) {
    const id = identity(entity);
    if (!this.known.has(id) && this.known.size >= this.limit) {
      const oldest = this.known.keys().next().value;
      this.known.delete(oldest); this.reactions.delete(oldest); this.counts.delete(oldest);
    }
    this.known.set(id, entity);
    const base = sampleWildlife(entity, elapsed, worldSeed), reaction = this.reactions.get(id);
    if (!reaction) return base;
    const age = Math.max(0, elapsed - reaction.start);
    const { duration, recovery } = reaction;
    if (age >= duration + recovery) { this.reactions.delete(id); return base; }
    const u = clamp(age / duration), release = smooth((age - duration) / recovery);
    const movement = smooth(Math.min(1, u / .82));
    const bell = Math.sin(Math.PI * u);
    let dx = reaction.dx * movement, dy = reaction.dy * movement;
    if (reaction.action === 'circle') {
      const a = u * TAU;
      dx = Math.sin(a) * reaction.distance;
      dy = (1 - Math.cos(a)) * reaction.distance * .65;
    }
    const from = reaction.from;
    let x = from.x + dx, y = from.y + dy;
    const blend = (a, b) => a + (b - a) * release;
    const moving = Math.hypot(dx, dy) > .02 || reaction.action === 'circle';
    const velocity = moving ? Math.abs(6 * Math.min(1, u / .82) * (1 - Math.min(1, u / .82)) / (.82 * duration)) * Math.abs(reaction.distance) : 0;
    const yaw = reaction.action === 'circle' ? Math.atan2(Math.sin(u * TAU) * .65, Math.cos(u * TAU))
      : moving ? Math.atan2(reaction.dy, reaction.dx) : reaction.action === 'listen' ? reaction.lookYaw : from.yaw;
    const angleDelta = Math.atan2(Math.sin(yaw - from.yaw), Math.cos(yaw - from.yaw));
    const cruising = ['eagle', 'butterfly', 'dragonfly'].includes(entity.variant);
    const height = cruising ? from.hop + (base.hop - from.hop) * smooth(u / .2) : from.hop * (1 - smooth(u / .15));
    const pose = { ...base, x: blend(x, base.x), y: blend(y, base.y), s: -blend(y, base.y),
      yaw: from.yaw + angleDelta * smooth(u / .16),
      speed: blend(reaction.action === 'circle' && u < 1 ? Math.abs(reaction.distance) * TAU / duration : velocity, base.speed),
      gait: from.gait + (reaction.action === 'circle' ? Math.abs(reaction.distance) * u * TAU : Math.hypot(dx, dy)) * TAU / (TYPES[entity.variant]?.stride || .8),
      graze: blend(0, base.graze), hop: blend(height, base.hop),
      rear: 0, alert: bell * (1 - release), dive: 0, splash: 0,
      activity: reaction.action, action: reaction.action, reactionProgress: u, reactionStrength: 1 - release,
    };
    const envelope = smooth(u / .18) * smooth((1 - u) / .24) * (1 - release);
    if (['rear', 'listen', 'nibble'].includes(reaction.action)) pose.rear = envelope * (reaction.action === 'rear' ? 1 : entity.variant === 'rabbit' || entity.variant === 'squirrel' ? .65 : 0);
    if (['sniff', 'graze', 'peck', 'bow', 'stretch'].includes(reaction.action)) pose.graze = envelope;
    if (['bound', 'hop', 'pounce'].includes(reaction.action)) {
      const jumps = reaction.action === 'pounce' ? 1 : reaction.action === 'hop' ? 2 : 4;
      pose.hop += Math.abs(Math.sin(Math.PI * Math.min(1, u / .82) * jumps)) * (reaction.action === 'pounce' ? .65 : .4) * (1 - release);
    }
    if (['fly', 'rise'].includes(reaction.action)) pose.hop += bell * (entity.variant === 'eagle' ? 2.6 : 1.7) * (1 - release);
    if (reaction.action === 'jump') { pose.hop += Math.max(0, Math.sin(Math.min(1, u / .72) * Math.PI)) * 1.4 * (1 - release); pose.splash = u > .65 ? Math.sin((u - .65) / .35 * Math.PI) : 0; }
    if (['dive', 'splash'].includes(reaction.action)) { pose.dive = reaction.action === 'dive' ? envelope : 0; pose.splash = envelope; }
    if (reaction.action === 'gape') pose.gape = envelope;
    if (entity.variant === 'crocodile' && reaction.action === 'rush') {
      const water = entity.water;
      if (water) {
        const targetS = water.kind === 'swamp' ? water.s : water.center;
        const targetX = water.kind === 'swamp' ? water.x - (water.bank || 1) * water.rx * .25
          : pathAt(targetS, worldSeed) + (entity.side < 0 ? -1 : 1) * Math.max(2.5, Math.abs(entity.side));
        const dive = smooth(u / .75) * (1 - release);
        pose.s = blend(from.s + (targetS - from.s) * dive, base.s);
        pose.x = blend(from.x + (targetX - from.x) * dive, base.x);
        pose.y = -pose.s;
        pose.swimming = dive > .72 || base.swimming;
        pose.submerge = dive * .1;
        pose.splash = Math.sin(Math.PI * smooth(u)) * (1 - release);
        pose.speed = Math.max(pose.speed, dive > .1 && dive < .95 ? 1.3 : 0);
      }
    }
    if (entity.variant === 'crocodile' && reaction.action === 'splash') pose.splash = Math.max(pose.splash, envelope);
    if (release > 0) {
      const delta = Math.atan2(Math.sin(base.yaw - pose.yaw), Math.cos(base.yaw - pose.yaw));
      pose.yaw += delta * release;
      pose.gait = blend(pose.gait, base.gait);
    }
    return constrainWater(pose, entity, worldSeed);
  }
  _start(entity, elapsed, player, selected, stagger = 0) {
    const id = identity(entity), from = this.sample(entity, elapsed, this.seed);
    const config = MOTIONS[selected.action] || { duration: 3.8, distance: 0, recovery: 3.8 };
    const px = finite(player?.x, from.x - 1), py = finite(player?.y, from.y + 1);
    const distance = Math.hypot(from.x - px, from.y - py);
    const heading = distance > .05 ? Math.atan2(from.y - py, from.x - px) : from.yaw;
    let amount = config.distance;
    if (selected.action === 'approach') amount = -Math.min(Math.abs(amount), Math.max(0, distance - 1.9));
    if (SPECIES[entity.variant]?.habitat === 'water' || entity.variant === 'crocodile') amount *= .55;
    if (['frog', 'butterfly', 'dragonfly', 'fish', 'squirrel'].includes(entity.variant)) amount *= .65;
    this.reactions.set(id, { ...config, from, action: selected.action, start: elapsed + stagger,
      dx: Math.cos(heading) * amount, dy: Math.sin(heading) * amount, distance: amount,
      lookYaw: Math.atan2(py - from.y, px - from.x) });
  }
  interact(entity, elapsed, player = {}) {
    if (!entity || entity.kind !== 'animal') return null;
    const id = identity(entity), previous = this.reactions.get(id);
    if (previous && elapsed - previous.start < 1.4) return null;
    const choices = REACTIONS[entity.variant] || REACTIONS.deer;
    const count = this.counts.get(id) || 0;
    const offset = Math.floor(random(entity.seed, 811) * choices.length);
    const selected = choices[(offset + count) % choices.length];
    this.counts.set(id, count + 1);
    this._start(entity, elapsed, player, selected);
    if (entity.group && ['horse', 'deer', 'goat', 'duck'].includes(entity.variant)) {
      let n = 0;
      for (const mate of this.known.values()) if (mate.group === entity.group && identity(mate) !== id && n < 6) {
        const action = ['bound', 'circle', 'flee', 'approach'].includes(selected.action) ? selected.action : n % 2 ? 'listen' : 'call';
        this._start(mate, elapsed, player, { ...selected, action }, .1 + n++ * .12);
      }
    }
    return { id, species: entity.variant, name: SPECIES[entity.variant]?.name || 'Woodland animal', ...selected };
  }
  prune(entities) {
    const keep = new Set(entities.filter(e => e.kind === 'animal').map(identity));
    for (const id of this.known.keys()) if (!keep.has(id)) { this.known.delete(id); this.reactions.delete(id); this.counts.delete(id); }
  }
}
