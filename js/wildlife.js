import { pathAt, riverAt } from './world.js?v=3';

const TAU = Math.PI * 2;
const QUARTER = Math.PI / 2;
const TYPES = {
  fox: { along: 2.2, across: 1.15, move: 2.8, rest: 1.65, stride: .66, action: 'trot' },
  deer: { along: 2.65, across: 1.25, move: 4.3, rest: 2.8, stride: 1.05, action: 'walk' },
  stag: { along: 2.8, across: 1.4, move: 5, rest: 2.1, stride: 1.15, action: 'walk' },
  rabbit: { along: 1.55, across: .85, move: 3, rest: 1.8, stride: .5, action: 'hop' },
  bird: { along: 2.8, across: 1.6, move: 2.65, rest: 2, stride: .3, action: 'flutter' },
  spirit: { along: 2.35, across: 1.65, move: 4.5, rest: .1, stride: 1, action: 'drift' },
};
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
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

  if (kind === 'rabbit' && within < move) {
    // Rabbits move only during each leap, with a short planted beat between
    // hops; their bodies never skate along the ground while their feet rest.
    const hops = 3;
    const jump = raw * hops;
    const whole = Math.floor(jump);
    const u = (jump - whole) / .72;
    progress = (whole + smooth(u)) / hops;
    rate = u < 1 ? 6 * u * (1 - u) / (.72 * move) : 0;
    hop = u < 1 ? Math.sin(Math.PI * u) * .34 : 0;
  } else if (kind === 'bird') {
    hop = within < move ? Math.sin(Math.PI * raw) * .95 : 0;
  }

  const angle = phase + (leg + progress) * QUARTER;
  const velocity = rate * QUARTER;
  let center = finite(e.s);
  const river = riverAt(center, worldSeed);
  if (river && kind !== 'spirit') {
    // Even a spawn in the channel is moved onto its nearest bank. The entire
    // patrol remains on that bank, including the body and feet at the turn.
    const bank = river.width * .5 + .7;
    center = center < river.center
      ? Math.min(center, river.center - bank - along)
      : Math.max(center, river.center + bank + along);
  }

  const s = center + Math.sin(angle) * along;
  const side = finite(e.side) + Math.cos(angle) * across;
  const x = pathAt(s, worldSeed) + side;
  const ds = Math.cos(angle) * along;
  const dside = -Math.sin(angle) * across;
  const trailSlope = (pathAt(s + .01, worldSeed) - pathAt(s - .01, worldSeed)) / .02;
  const dx = dside + ds * trailSlope;
  const speed = Math.hypot(dx, ds) * velocity;
  const restProgress = clamp((within - move) / rest);
  const graze = within > move
    ? smooth(restProgress / .22) * smooth((1 - restProgress) / .22)
    : 0;
  let activity = within < move ? type.action : 'look';
  if (graze > .1) activity = kind === 'fox' ? 'sniff' : kind === 'bird' ? 'peck' : 'graze';
  return {
    s, side, x, y: -s, yaw: Math.atan2(-ds, dx), speed,
    gait: arcLength(angle, along, across) / type.stride * TAU,
    hop, activity, graze,
  };
}
