import test from 'node:test';
import assert from 'node:assert/strict';
import { TrailWorld } from '../js/world.js';
import { HOMES_BY_BIOME, WORK_BY_HOME, ResidentDirector, residentPosition, residentName } from '../js/homesteads.js';

function collect(seed, length = 12000) {
  const world = new TrailWorld(seed), found = new Map();
  for (let s = 0; s < length; s += 54) {
    world.update(s, 65);
    for (const entity of world.entities) if (entity.kind === 'home' || entity.kind === 'resident') found.set(entity.id, entity);
  }
  return [...found.values()];
}

test('homesteads stay sparse, consistent across streaming, and belong in their biomes', () => {
  const entities = collect(12345);
  const homes = entities.filter(e => e.kind === 'home').sort((a, b) => a.s - b.s);
  const residents = entities.filter(e => e.kind === 'resident');
  assert.ok(homes.length >= 4 && homes.length <= 70, `expected sparse homes, got ${homes.length}`);
  for (let i = 1; i < homes.length; i++) assert.ok(homes[i].s - homes[i - 1].s > 105);
  for (const home of homes) {
    assert.ok(HOMES_BY_BIOME[home.biome].includes(home.variant));
    const neighbours = residents.filter(e => e.homesteadId === home.homesteadId);
    assert.ok(neighbours.length === 1 || neighbours.length === 2);
    for (const neighbour of neighbours) {
      assert.ok(WORK_BY_HOME[home.variant].includes(neighbour.variant));
      assert.equal(neighbour.s, home.s);
      assert.equal(neighbour.homeSeed, home.seed);
      assert.ok(Number.isFinite(residentPosition(neighbour, 0, 0, 0, 2).x));
    }
  }
  const again = collect(12345);
  assert.deepEqual(entities.filter(e => e.kind === 'home'), again.filter(e => e.kind === 'home'));
});

test('different trails feature a broad but never crowded variety of homes and jobs', () => {
  const all = [12, 1848, 54321, 8273].flatMap(seed => collect(seed, 18000));
  const homes = new Set(all.filter(e => e.kind === 'home').map(e => e.variant));
  const jobs = new Set(all.filter(e => e.kind === 'resident').map(e => e.variant));
  assert.deepEqual([...homes].sort(), Object.keys(WORK_BY_HOME).sort());
  assert.deepEqual([...jobs].sort(), [...new Set(Object.values(WORK_BY_HOME).flat())].sort());
});

test('residents wave or continue their work, respect cooldown and finish the gesture', () => {
  const director = new ResidentDirector();
  const resident = collect(12345).find(e => e.kind === 'resident');
  assert.ok(residentName(resident).includes(' the '));
  const acts = new Set();
  for (let i = 0; i < 24; i++) {
    const time = i * 2;
    const reaction = director.interact(resident, time);
    assert.ok(reaction.message && reaction.message.includes(residentName(resident).split(' ')[0]));
    assert.equal(director.interact(resident, time + .1), null);
    acts.add(reaction.action);
    assert.equal(director.sample(resident, time + 1.7), null);
  }
  assert.deepEqual([...acts].sort(), ['continue', 'wave']);
  director.prune([]);
  assert.equal(director.reactions.size, 0);
  assert.equal(director.counts.size, 0);
});
