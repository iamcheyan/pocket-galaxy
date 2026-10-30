// Game rules: harvest, scan, idle income, risk, repair, achievements, and the
// full discover → harvest → upgrade → expand loop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS,
  SAVE_VERSION,
  buyUpgrade,
  createNewGame,
  evaluateAchievements,
  expandGalaxy,
  harvest,
  idleTick,
  rating,
  ratingLabel,
  repairHull,
  riskRng,
  rollRisk,
  scanBody,
} from '../../src/core/game.ts';
import { cargoCap } from '../../src/core/upgrades.ts';
import { distanceFromCore, scannerReach } from '../../src/core/galaxy.ts';
import { createRng } from '../../src/core/rng.ts';

const NOW = 1_700_000_000_000;

test('new games start with the documented resources and version', () => {
  const game = createNewGame('medium', 1, NOW);
  assert.equal(game.version, SAVE_VERSION);
  assert.deepEqual(game.resources, { energy: 80, mineral: 60, science: 20 });
  assert.equal(game.hull, 100);
  assert.equal(game.galaxy.bodies.length, 260);
  assert.equal(game.discoveredTotal, 0);
  assert.equal(game.paused, false);
});

test('harvest yields typed resources and depletes the deposit', () => {
  const game = createNewGame('medium', 7, NOW);
  const body = game.galaxy.bodies.find((candidate) => distanceFromCore(candidate) < 0.3);
  assert.ok(body);
  const before = body.deposit;
  const result = harvest(game, body.id, 10);
  assert.equal(result.ok, true);
  const after = result.state.galaxy.bodies[body.id]!;
  assert.equal(after.deposit, before - 10);
  assert.equal(after.discovered, true);
  const gained = result.gained.energy + result.gained.mineral + result.gained.science;
  assert.ok(gained > 0, 'harvest must yield something');
  assert.equal(result.state.resourcesCollected, gained);
  assert.equal(result.state.stats.harvested, 1);
  assert.notEqual(result.state, game, 'state must be replaced, not mutated');
});

test('harvest is capped by the remaining deposit', () => {
  const game = createNewGame('small', 3, NOW);
  const body = game.galaxy.bodies.find((candidate) => distanceFromCore(candidate) < 0.25)!;
  const first = harvest(game, body.id, 9999);
  assert.equal(first.ok, true);
  assert.equal(first.body?.deposit, 0);
  const second = harvest(first.state, body.id, 10);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'depleted');
});

test('harvest refuses out-of-range and paused states', () => {
  const game = createNewGame('medium', 4, NOW);
  const far = game.galaxy.bodies.find(
    (candidate) => distanceFromCore(candidate) > scannerReach(game.galaxy, 0) + 0.1,
  )!;
  assert.equal(harvest(game, far.id).reason, 'out-of-range');
  const paused = { ...game, paused: true };
  const near = game.galaxy.bodies.find((candidate) => distanceFromCore(candidate) < 0.2)!;
  assert.equal(harvest(paused, near.id).reason, 'paused');
});

test('mining level raises yield for the same deposit cost', () => {
  const game = createNewGame('medium', 9, NOW);
  const body = game.galaxy.bodies.find((candidate) => candidate.kind === 'asteroid' && distanceFromCore(candidate) < 0.4)!;
  const plain = harvest(game, body.id, 10);
  const upgraded = harvest({ ...game, upgrades: { ...game.upgrades, mining: 5 } }, body.id, 10);
  assert.ok(upgraded.gained.mineral > plain.gained.mineral);
  assert.equal(plain.state.galaxy.bodies[body.id]!.deposit, upgraded.state.galaxy.bodies[body.id]!.deposit);
});

test('cargo cap truncates harvested resources', () => {
  const game = createNewGame('medium', 10, NOW);
  const body = game.galaxy.bodies.find((candidate) => distanceFromCore(candidate) < 0.3)!;
  const capped = harvest({ ...game, resources: { energy: cargoCap(0), mineral: 0, science: 0 } }, body.id, 50);
  assert.ok(capped.state.resources.energy <= cargoCap(0));
});

test('scan is one-shot and respects scanner range', () => {
  const game = createNewGame('medium', 13, NOW);
  const near = game.galaxy.bodies.find((candidate) => distanceFromCore(candidate) < 0.2)!;
  const first = scanBody(game, near.id);
  assert.equal(first.ok, true);
  assert.equal(first.state.stats.bodiesScanned, 1);
  assert.equal(first.state.discoveredTotal, 1);
  const again = scanBody(first.state, near.id);
  assert.equal(again.ok, false);

  const far = game.galaxy.bodies.find(
    (candidate) => distanceFromCore(candidate) > scannerReach(game.galaxy, 0) + 0.2,
  )!;
  assert.equal(scanBody(game, far.id).ok, false);
});

test('scanning a planet counts a visited planet exactly once', () => {
  const game = createNewGame('large', 17, NOW);
  const planet = game.galaxy.bodies.find(
    (candidate) => candidate.kind === 'planet' && distanceFromCore(candidate) < 0.3,
  )!;
  const scanned = scanBody(game, planet.id).state;
  assert.equal(scanned.visitedPlanets, 1);
  const harvested = harvest(scanned, planet.id).state;
  assert.equal(harvested.visitedPlanets, 1, 'discovery must not double count');
});

test('buyUpgrade spends resources and increments counters', () => {
  const game = createNewGame('medium', 2, NOW);
  const rich = { ...game, resources: { energy: 5000, mineral: 5000, science: 5000 } };
  const result = buyUpgrade(rich, 'scanner');
  assert.equal(result.ok, true);
  assert.equal(result.state.upgrades.scanner, 1);
  assert.ok(result.state.resources.energy < rich.resources.energy);
  assert.equal(result.state.stats.upgradesBought, 1);
  const poor = buyUpgrade({ ...game, resources: { energy: 0, mineral: 0, science: 0 } }, 'cargo');
  assert.equal(poor.ok, false);
  assert.equal(poor.reason, 'insufficient');
});

test('idle income scales with discovered stars and respects the cap', () => {
  const game = createNewGame('medium', 6, NOW);
  const stars = game.galaxy.bodies.filter((body) => body.kind === 'star').slice(0, 3);
  const withStars = {
    ...game,
    galaxy: {
      ...game.galaxy,
      bodies: game.galaxy.bodies.map((body) =>
        stars.some((star) => star.id === body.id) ? { ...body, discovered: true } : body,
      ),
    },
  };
  const ticked = idleTick(withStars, 1000);
  assert.equal(ticked.resources.energy, game.resources.energy + 1.5);
  const full = idleTick({ ...withStars, resources: { ...withStars.resources, energy: cargoCap(0) } }, 1000);
  assert.equal(full.resources.energy, cargoCap(0));
  const paused = idleTick({ ...withStars, paused: true }, 1000);
  assert.equal(paused.resources.energy, game.resources.energy);
});

test('risk rolls are deterministic per seed and shield reduces damage', () => {
  const game = createNewGame('medium', 31, NOW);
  const outcomesA: number[] = [];
  const outcomesB: number[] = [];
  for (let tick = 0; tick < 40; tick++) {
    const seeded = { ...game, tick };
    const a = rollRisk(seeded, riskRng(seeded));
    const b = rollRisk(seeded, riskRng(seeded));
    // updatedAt is wall-clock stamped, so compare the simulation fields only.
    const signature = (outcome: typeof a) =>
      outcome === null
        ? null
        : {
            event: outcome.event,
            hull: outcome.state.hull,
            resources: outcome.state.resources,
            risks: outcome.state.riskLog.map((entry) => entry.kind),
          };
    assert.deepEqual(signature(a), signature(b), 'same seed must give the same risk roll');
    if (a) {
      outcomesA.push(a.event.hullDelta);
      const shielded = rollRisk({ ...seeded, upgrades: { ...game.upgrades, shield: 10 } }, riskRng(seeded));
      outcomesB.push(shielded?.event.hullDelta ?? 0);
    }
  }
  assert.ok(outcomesA.length > 0, 'expected at least one risk event in 40 ticks');
  for (const delta of outcomesA) assert.ok(delta <= 0);
  const averageRaw = outcomesA.reduce((a, b) => a + b, 0) / outcomesA.length;
  const averageShielded = outcomesB.reduce((a, b) => a + b, 0) / outcomesB.length;
  assert.ok(averageShielded >= averageRaw, 'shield must not increase damage');
});

test('risk events never push hull or resources below zero', () => {
  const game = { ...createNewGame('medium', 33, NOW), hull: 2 };
  for (let tick = 0; tick < 200; tick++) {
    const seeded = { ...game, tick };
    const outcome = rollRisk(seeded, createRng(tick));
    if (!outcome) continue;
    assert.ok(outcome.state.hull >= 0);
    assert.ok(outcome.state.resources.energy >= 0);
    assert.ok(outcome.state.resources.mineral >= 0);
    assert.ok(outcome.state.resources.science >= 0);
  }
});

test('repair charges minerals and refuses when unaffordable', () => {
  const game = { ...createNewGame('medium', 8, NOW), hull: 50, resources: { energy: 0, mineral: 100, science: 0 } };
  const repaired = repairHull(game);
  assert.equal(repaired.ok, true);
  assert.equal(repaired.state.hull, 100);
  assert.equal(repaired.state.resources.mineral, 100 - repaired.cost);
  assert.equal(repairHull({ ...game, hull: 100 }).ok, false);
  assert.equal(repairHull({ ...game, resources: { energy: 0, mineral: 0, science: 0 } }).ok, false);
});

test('expanding replaces the map but keeps the ship', () => {
  const game = createNewGame('small', 41, NOW);
  const upgraded = { ...game, upgrades: { ...game.upgrades, engine: 4 }, hull: 77 };
  const expanded = expandGalaxy(upgraded, 'large', 99);
  assert.equal(expanded.galaxy.scale, 'large');
  assert.equal(expanded.galaxy.bodies.length, 620);
  assert.equal(expanded.galaxy.seed, 99);
  assert.equal(expanded.upgrades.engine, 4);
  assert.equal(expanded.hull, 77);
  assert.equal(expanded.discoveredTotal, 0);
});

test('rating labels map monotonically onto 0..100', () => {
  const labels = [0, 20, 38, 54, 68, 80, 92].map(ratingLabel);
  assert.deepEqual(labels, ['E', 'D', 'C', 'B', 'A', 'A+', 'S']);
});

test('achievements unlock from real state, not from flags', () => {
  const game = createNewGame('medium', 12, NOW);
  const locked = evaluateAchievements(game, { peakFps: 30 });
  assert.equal(locked.length, ACHIEVEMENTS.length);
  assert.ok(locked.every((entry) => !entry.unlocked));

  const explorer = evaluateAchievements({ ...game, discoveredTotal: 50 }, { peakFps: 30 });
  assert.equal(explorer.find((entry) => entry.id === 'explorer')?.unlocked, true);

  const lastLight = evaluateAchievements({ ...game, hull: 12 }, { peakFps: 30 });
  assert.equal(lastLight.find((entry) => entry.id === 'lastlight')?.unlocked, true);

  const perf = evaluateAchievements(game, { peakFps: 60 });
  assert.equal(perf.find((entry) => entry.id === 'perf')?.unlocked, true);

  const everything = evaluateAchievements(
    { ...game, upgrades: { engine: 1, scanner: 1, shield: 1, cargo: 1, mining: 1, speed: 1 } },
    { peakFps: 30 },
  );
  assert.equal(everything.find((entry) => entry.id === 'keeper')?.unlocked, true);
});

test('full loop: discover → harvest → upgrade → expand raises the rating', () => {
  let game = createNewGame('small', 77, NOW);
  const startRating = rating(game);
  assert.ok(startRating >= 0);

  const targets = game.galaxy.bodies
    .filter((body) => distanceFromCore(body) < scannerReach(game.galaxy, 0))
    .slice(0, 12);
  assert.ok(targets.length >= 5);
  for (const target of targets) {
    const scanned = scanBody(game, target.id);
    if (scanned.ok) game = scanned.state;
    const harvested = harvest(game, target.id, 40);
    if (harvested.ok) game = harvested.state;
  }
  assert.ok(game.discoveredTotal >= 5);
  assert.ok(game.resourcesCollected > 0);

  game = { ...game, resources: { energy: 4000, mineral: 4000, science: 4000 } };
  for (const id of ['scanner', 'mining', 'engine'] as const) {
    const bought = buyUpgrade(game, id);
    assert.equal(bought.ok, true, `expected to afford ${id}`);
    game = bought.state;
  }
  assert.equal(game.upgrades.scanner, 1);

  const afterUpgradeRating = rating(game);
  assert.ok(afterUpgradeRating > startRating, 'upgrades must raise the rating');

  game = expandGalaxy(game, 'large', 1234);
  assert.equal(game.galaxy.scale, 'large');
  assert.equal(game.upgrades.scanner, 1, 'ship survives expansion');
  assert.ok(game.galaxy.bodies.length > 260);
});
