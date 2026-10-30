// Game rules: harvesting, scanning, risk events, achievements. All functions
// are pure (state in, new state out) so the unit tests exercise exactly the
// code the UI runs, and saves are plain JSON.

import { generateGalaxy, isWithinScanner, scannerReach, galaxyRating, nearestBody } from './galaxy.ts';
import { createRng, type Rng } from './rng.ts';
import {
  clampResources,
  purchaseUpgrade,
  cargoCap,
  totalUpgradeLevels,
  UPGRADES,
} from './upgrades.ts';
import type {
  Achievement,
  Body,
  BodyKind,
  GameState,
  GalaxyScale,
  ResourceKind,
  Resources,
  RiskEvent,
  RiskKind,
  UpgradeId,
} from './types.ts';

export const SAVE_VERSION = 3;

/** Which resources each body kind yields, by weight. */
export const YIELDS: Record<BodyKind, Partial<Record<ResourceKind, number>>> = {
  star: { energy: 1.0 },
  planet: { energy: 0.4, mineral: 0.6 },
  asteroid: { mineral: 1.0 },
  comet: { energy: 0.5, science: 0.5 },
  blackhole: { energy: 0.5, science: 0.8 },
  nebula: { science: 1.0 },
  ruins: { science: 0.8, mineral: 0.4 },
};

export const BODY_LABELS: Record<BodyKind, string> = {
  star: 'Star',
  planet: 'Planet',
  asteroid: 'Asteroid',
  comet: 'Comet',
  blackhole: 'Black Hole',
  nebula: 'Nebula',
  ruins: 'Ancient Ruins',
};

export const RISK_LABELS: Record<RiskKind, string> = {
  storm: 'Asteroid Storm',
  radiation: 'Radiation Zone',
  pirates: 'Pirate Signal',
  anomaly: 'Space Anomaly',
};

export function createNewGame(scale: GalaxyScale, seed: number, now: number): GameState {
  return {
    version: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    resources: { energy: 80, mineral: 60, science: 20 },
    hull: 100,
    upgrades: { engine: 0, scanner: 0, shield: 0, cargo: 0, mining: 0, speed: 0 },
    galaxy: generateGalaxy(scale, seed),
    discoveredTotal: 0,
    visitedPlanets: 0,
    scienceCollected: 0,
    resourcesCollected: 0,
    riskLog: [],
    stats: {
      playTimeMs: 0,
      travelDistance: 0,
      bodiesScanned: 0,
      harvested: 0,
      upgradesBought: 0,
      peakFps: 0,
      avgFps: 0,
      sessions: 1,
    },
    tick: 0,
    paused: false,
  };
}

function yieldFor(body: Body, miningLevel: number, units: number): Resources {
  const multiplier = 1 + miningLevel * 0.45;
  const weights = YIELDS[body.kind];
  const total = (weights.energy ?? 0) + (weights.mineral ?? 0) + (weights.science ?? 0);
  const gained: Resources = { energy: 0, mineral: 0, science: 0 };
  for (const kind of ['energy', 'mineral', 'science'] as const) {
    const share = (weights[kind] ?? 0) / (total || 1);
    gained[kind] = Math.max(0, Math.round(units * share * multiplier));
  }
  return gained;
}

export interface HarvestResult {
  ok: boolean;
  reason?: 'not-discovered' | 'out-of-range' | 'depleted' | 'paused';
  state: GameState;
  gained: Resources;
  body: Body | null;
}

/** Harvest from one body. Bounded by deposit and cargo capacity. */
export function harvest(state: GameState, bodyId: number, units = 12): HarvestResult {
  const empty: Resources = { energy: 0, mineral: 0, science: 0 };
  if (state.paused) return { ok: false, reason: 'paused', state, gained: empty, body: null };
  const body = state.galaxy.bodies.find((candidate) => candidate.id === bodyId) ?? null;
  if (!body) return { ok: false, reason: 'out-of-range', state, gained: empty, body: null };
  if (!body.discovered && !isWithinScanner(state.galaxy, body, state.upgrades.scanner)) {
    return { ok: false, reason: 'out-of-range', state, gained: empty, body };
  }
  if (body.deposit <= 0) return { ok: false, reason: 'depleted', state, gained: empty, body };
  const taken = Math.min(units, body.deposit);
  const gained = yieldFor(body, state.upgrades.mining, taken);
  const resources = clampResources(
    {
      energy: state.resources.energy + gained.energy,
      mineral: state.resources.mineral + gained.mineral,
      science: state.resources.science + gained.science,
    },
    state.upgrades,
  );
  const totalGained = gained.energy + gained.mineral + gained.science;
  const bodies = state.galaxy.bodies.map((candidate) =>
    candidate.id === bodyId
      ? { ...candidate, deposit: candidate.deposit - taken, discovered: true }
      : candidate,
  );
  const wasNew = !body.discovered;
  return {
    ok: true,
    gained,
    body: bodies[bodyId] ?? null,
    state: {
      ...state,
      galaxy: { ...state.galaxy, bodies },
      resources,
      discoveredTotal: state.discoveredTotal + (wasNew ? 1 : 0),
      visitedPlanets: state.visitedPlanets + (wasNew && body.kind === 'planet' ? 1 : 0),
      scienceCollected: state.scienceCollected + gained.science,
      resourcesCollected: state.resourcesCollected + totalGained,
      stats: {
        ...state.stats,
        harvested: state.stats.harvested + 1,
      },
      updatedAt: Date.now(),
    },
  };
}

export interface ScanResult {
  ok: boolean;
  state: GameState;
  body: Body | null;
}

/** Scanning marks a body discovered and counts toward the rating. */
export function scanBody(state: GameState, bodyId: number): ScanResult {
  const body = state.galaxy.bodies.find((candidate) => candidate.id === bodyId) ?? null;
  if (!body || body.scanned) return { ok: false, state, body };
  if (!isWithinScanner(state.galaxy, body, state.upgrades.scanner)) {
    return { ok: false, state, body };
  }
  const bodies = state.galaxy.bodies.map((candidate) =>
    candidate.id === bodyId
      ? { ...candidate, scanned: true, discovered: true }
      : candidate,
  );
  return {
    ok: true,
    body: bodies[bodyId] ?? null,
    state: {
      ...state,
      galaxy: { ...state.galaxy, bodies },
      discoveredTotal: state.discoveredTotal + (body.discovered ? 0 : 1),
      visitedPlanets: state.visitedPlanets + (body.kind === 'planet' && !body.discovered ? 1 : 0),
      stats: { ...state.stats, bodiesScanned: state.stats.bodiesScanned + 1 },
      updatedAt: Date.now(),
    },
  };
}

/** Expand the galaxy itself — the late-game "bigger map" step. */
export function expandGalaxy(state: GameState, nextScale: GalaxyScale, seed: number): GameState {
  return {
    ...state,
    galaxy: generateGalaxy(nextScale, seed),
    discoveredTotal: 0,
    updatedAt: Date.now(),
  };
}

export interface UpgradeResult {
  ok: boolean;
  reason?: 'max-level' | 'insufficient';
  state: GameState;
}

export function buyUpgrade(state: GameState, id: UpgradeId): UpgradeResult {
  const result = purchaseUpgrade(id, state.resources, state.upgrades);
  if (!result.ok) return { ok: false, reason: result.reason, state };
  return {
    ok: true,
    state: {
      ...state,
      resources: result.resources,
      upgrades: result.levels,
      stats: { ...state.stats, upgradesBought: state.stats.upgradesBought + 1 },
      updatedAt: Date.now(),
    },
  };
}

const RISK_TABLE: Array<{
  kind: RiskKind;
  detail: string;
  hull: [number, number];
  resources: Partial<Resources>;
}> = [
  {
    kind: 'storm',
    detail: 'Micro-impacts sand the hull but throw off mineral-rich debris.',
    hull: [6, 18],
    resources: { mineral: 14 },
  },
  {
    kind: 'radiation',
    detail: 'The shield absorbs the worst of it; sensors still gain data.',
    hull: [4, 12],
    resources: { science: 10 },
  },
  {
    kind: 'pirates',
    detail: 'A quick exchange. They take cargo, you keep the hull.',
    hull: [3, 10],
    resources: { energy: -18, mineral: -10 },
  },
  {
    kind: 'anomaly',
    detail: 'A pocket of folded space pays out in energy and science.',
    hull: [0, 4],
    resources: { energy: 22, science: 16 },
  },
];

export interface RiskOutcome {
  event: RiskEvent;
  state: GameState;
}

/** Roll a risk event; shield softens hull damage. Deterministic per seed+tick. */
export function rollRisk(state: GameState, rng: Rng): RiskOutcome | null {
  if (!rng.chance(0.16)) return null;
  const table = RISK_TABLE[rng.int(RISK_TABLE.length)] as (typeof RISK_TABLE)[number];
  const raw = Math.round(rng.range(table.hull[0], table.hull[1]));
  const shieldFactor = Math.max(0.3, 1 - state.upgrades.shield * 0.07);
  const hullDelta = -Math.round(raw * shieldFactor);
  const resourcesDelta: Partial<Resources> = {};
  for (const [key, value] of Object.entries(table.resources)) {
    resourcesDelta[key as ResourceKind] = Math.round(
      (value ?? 0) * (1 + state.upgrades.cargo * 0.04),
    );
  }
  const resources = clampResources(
    {
      energy: Math.max(0, state.resources.energy + (resourcesDelta.energy ?? 0)),
      mineral: Math.max(0, state.resources.mineral + (resourcesDelta.mineral ?? 0)),
      science: Math.max(0, state.resources.science + (resourcesDelta.science ?? 0)),
    },
    state.upgrades,
  );
  const event: RiskEvent = {
    kind: table.kind,
    title: RISK_LABELS[table.kind],
    detail: table.detail,
    hullDelta,
    resourcesDelta,
  };
  return {
    event,
    state: {
      ...state,
      resources,
      hull: Math.max(0, Math.min(100, state.hull + hullDelta)),
      riskLog: [...state.riskLog, { kind: table.kind, at: Date.now() }],
      updatedAt: Date.now(),
    },
  };
}

export function rating(state: GameState): number {
  return galaxyRating(
    state.galaxy,
    state.discoveredTotal,
    totalUpgradeLevels(state.upgrades),
    state.upgrades.scanner,
  );
}

export function ratingLabel(score: number): string {
  if (score >= 92) return 'S';
  if (score >= 80) return 'A+';
  if (score >= 68) return 'A';
  if (score >= 54) return 'B';
  if (score >= 38) return 'C';
  if (score >= 20) return 'D';
  return 'E';
}

/** Repair costs minerals; useful after a bad run of risk events. */
export function repairHull(state: GameState): { ok: boolean; state: GameState; cost: number } {
  const missing = 100 - state.hull;
  if (missing <= 0) return { ok: false, state, cost: 0 };
  const cost = Math.ceil(missing * 0.8);
  if (state.resources.mineral < cost) return { ok: false, state, cost };
  return {
    ok: true,
    cost,
    state: {
      ...state,
      hull: 100,
      resources: { ...state.resources, mineral: state.resources.mineral - cost },
      updatedAt: Date.now(),
    },
  };
}

export interface AchievementSpec {
  id: string;
  title: string;
  detail: string;
  test: (state: GameState, ctx: { peakFps: number }) => boolean;
}

export const ACHIEVEMENTS: readonly AchievementSpec[] = [
  {
    id: 'explorer',
    title: 'Explorer',
    detail: 'Discover 50 bodies',
    test: (state) => state.discoveredTotal >= 50,
  },
  {
    id: 'scientist',
    title: 'Scientist',
    detail: 'Collect 1,000 science',
    test: (state) => state.scienceCollected >= 1000,
  },
  {
    id: 'builder',
    title: 'Galaxy Builder',
    detail: 'Reach 2,000+ bodies in view (Massive galaxy)',
    test: (state) => state.galaxy.bodies.length >= 2000,
  },
  {
    id: 'perf',
    title: 'Performance Master',
    detail: 'Sustain 58+ FPS as the observed peak',
    test: (_state, ctx) => ctx.peakFps >= 58,
  },
  {
    id: 'lastlight',
    title: 'Last Light',
    detail: 'Survive below 20 hull',
    test: (state) => state.hull > 0 && state.hull <= 20,
  },
  {
    id: 'keeper',
    title: 'Galaxy Keeper',
    detail: 'Upgrade every ship system at least once',
    test: (state) => Object.values(state.upgrades).every((level) => level >= 1),
  },
];

export function evaluateAchievements(
  state: GameState,
  ctx: { peakFps: number },
): Achievement[] {
  return ACHIEVEMENTS.map((spec) => ({
    id: spec.id,
    title: spec.title,
    detail: spec.detail,
    unlocked: spec.test(state, ctx),
  }));
}

/** Passive idle income: each discovered star trickles energy. */
export function idleTick(state: GameState, dtMs: number): GameState {
  if (state.paused) return state;
  const stars = state.galaxy.bodies.filter((body) => body.discovered && body.kind === 'star').length;
  if (stars === 0) return { ...state, tick: state.tick + 1 };
  const perSecond = stars * 0.5;
  const gain = (perSecond * dtMs) / 1000;
  const energy = Math.min(cargoCap(state.upgrades.cargo), state.resources.energy + gain);
  return {
    ...state,
    resources: { ...state.resources, energy },
    tick: state.tick + 1,
  };
}

/** Nearest selectable body under a galaxy-space point, respecting the scanner. */
export function pickBodyAt(
  state: GameState,
  point: { x: number; y: number },
  radius: number,
): Body | null {
  const reach = scannerReach(state.galaxy, state.upgrades.scanner);
  return nearestBody(
    state.galaxy,
    point,
    (body) => body.scanned || Math.hypot(body.x, body.y) <= reach,
    radius,
  );
}

export function riskRng(state: GameState): Rng {
  return createRng((state.galaxy.seed ^ (state.tick * 2654435761)) >>> 0);
}

export { UPGRADES, cargoCap };
