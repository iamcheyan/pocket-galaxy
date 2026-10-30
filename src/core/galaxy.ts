// Galaxy generation. Sizes scale with the chosen galaxy scale; positions use a
// spiral-arm distribution so the map reads as a galaxy rather than a scatter
// plot, and every value is derived from the seed (replayable benchmarks).

import { createRng, type Rng } from './rng.ts';
import type { Body, BodyKind, Galaxy, GalaxyScale } from './types.ts';

export const BODY_KINDS: readonly BodyKind[] = [
  'star',
  'planet',
  'asteroid',
  'comet',
  'blackhole',
  'nebula',
  'ruins',
];

export const GALAXY_SCALES: Record<GalaxyScale, { bodies: number; reveal: number; label: string }> = {
  small: { bodies: 90, reveal: 0.34, label: 'Small' },
  medium: { bodies: 260, reveal: 0.48, label: 'Medium' },
  large: { bodies: 620, reveal: 0.62, label: 'Large' },
  huge: { bodies: 1200, reveal: 0.76, label: 'Huge' },
  massive: { bodies: 2400, reveal: 0.9, label: 'Massive' },
};

// Relative spawn weight per kind. Black holes stay rare — they are the
// resource-dense hazard nodes, not filler.
const WEIGHTS: Record<BodyKind, number> = {
  star: 12,
  planet: 34,
  asteroid: 24,
  comet: 11,
  blackhole: 4,
  nebula: 9,
  ruins: 6,
};

const PREFIXES = [
  'Aegis', 'Kepler', 'Vela', 'Orion', 'Lyra', 'Cygni', 'Draco', 'Helios',
  'Nyx', 'Rigel', 'Ankaa', 'Mira', 'Tethys', 'Zephyr', 'Caelum', 'Iris',
];
const SUFFIXES = ['Prime', 'Minor', 'Major', 'Deep', 'Rest', 'Drift', 'Halo', 'Verge'];

export function bodyName(seed: number): string {
  const rng = createRng(seed);
  return `${rng.pick(PREFIXES)} ${rng.pick(SUFFIXES)}`;
}

/**
 * Catalog designations. With 16 x 8 = 128 possible names, a 2 400-body galaxy
 * would otherwise repeat every name ~19 times, making "the Cygni Prime" an
 * ambiguous reference. The catalog is unique per galaxy and stable for a seed.
 */
const CATALOG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function catalogCode(seed: number, attempt = 0): string {
  let value = (seed + attempt * 2654435761) >>> 0;
  let code = '';
  for (let index = 0; index < 4; index++) {
    code += CATALOG_ALPHABET[value % CATALOG_ALPHABET.length];
    value = Math.floor(value / CATALOG_ALPHABET.length);
  }
  return `${code.slice(0, 2)}-${code.slice(2)}`;
}

function pickKind(rng: Rng, armIndex: number, total: number): BodyKind {
  // Outer arms skew toward dust (asteroids), the core toward stars and ruins.
  const outer = armIndex / Math.max(1, total - 1);
  const weights = { ...WEIGHTS };
  weights.asteroid *= 0.6 + outer * 1.4;
  weights.star *= 1.6 - outer;
  weights.ruins *= 1.4 - outer * 0.7;
  weights.blackhole *= 0.5 + outer * 1.5;
  let total_ = 0;
  for (const kind of BODY_KINDS) total_ += weights[kind];
  let roll = rng.next() * total_;
  for (const kind of BODY_KINDS) {
    roll -= weights[kind];
    if (roll <= 0) return kind;
  }
  return 'planet';
}

const DEPOSITS: Record<BodyKind, [number, number]> = {
  star: [60, 120],
  planet: [40, 90],
  asteroid: [25, 60],
  comet: [30, 70],
  blackhole: [90, 180],
  nebula: [35, 80],
  ruins: [45, 100],
};

const SIZES: Record<BodyKind, [number, number]> = {
  star: [7, 12],
  planet: [5, 9],
  asteroid: [2, 4],
  comet: [3, 5],
  blackhole: [6, 9],
  nebula: [14, 26],
  ruins: [4, 7],
};

export function generateGalaxy(scale: GalaxyScale, seed: number): Galaxy {
  const config = GALAXY_SCALES[scale];
  const rng = createRng(seed);
  const bodies: Body[] = [];
  const usedCatalogs = new Set<string>();
  const arms = 3;
  for (let i = 0; i < config.bodies; i++) {
    const arm = i % arms;
    const progress = (i / config.bodies) ** 0.62;
    const angle = (arm / arms) * Math.PI * 2 + progress * Math.PI * 2.4 + rng.range(-0.22, 0.22);
    const radius = 0.08 + progress * 0.9 + rng.range(-0.06, 0.06);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * 0.92;
    const kind = pickKind(rng, i, config.bodies);
    const [minDeposit, maxDeposit] = DEPOSITS[kind];
    const [minSize, maxSize] = SIZES[kind];
    const deposit = Math.round(rng.range(minDeposit, maxDeposit));
    const bodySeed = Math.floor(rng.next() * 0xffffffff);
    let catalog = catalogCode(bodySeed);
    for (let attempt = 1; usedCatalogs.has(catalog); attempt++) {
      catalog = catalogCode(bodySeed, attempt);
    }
    usedCatalogs.add(catalog);
    bodies.push({
      id: i,
      kind,
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
      size: rng.range(minSize, maxSize),
      seed: bodySeed,
      name: bodyName(bodySeed),
      catalog,
      scanned: false,
      discovered: false,
      deposit,
      capacity: deposit,
    });
  }
  return { scale, seed, bodies, revealRadius: config.reveal };
}

/** Distance from the galactic core in galaxy units (0..~1.4). */
export function distanceFromCore(body: { x: number; y: number }): number {
  return Math.hypot(body.x, body.y);
}

/**
 * Scanner radius in galaxy units. Upgrading the scanner multiplies the reach;
 * the galaxy's own revealRadius sets the ceiling reachable at level 0.
 */
export function scannerReach(galaxy: Galaxy, scannerLevel: number): number {
  return Math.min(1.6, galaxy.revealRadius + scannerLevel * 0.09);
}

export function isWithinScanner(
  galaxy: Galaxy,
  body: Body,
  scannerLevel: number,
): boolean {
  return distanceFromCore(body) <= scannerReach(galaxy, scannerLevel) + body.size / 200;
}

/**
 * Bodies the player can currently see. Revealed bodies are the click targets;
 * everything else renders as unlabelled dust so the map still looks like a
 * galaxy.
 */
export function revealedBodies(galaxy: Galaxy, scannerLevel: number): Body[] {
  const reach = scannerReach(galaxy, scannerLevel);
  return galaxy.bodies.filter((body) => body.scanned || distanceFromCore(body) <= reach);
}

export function nearestBody(
  galaxy: Galaxy,
  point: { x: number; y: number },
  filter: (body: Body) => boolean,
  maxDistance = 0.12,
): Body | null {
  let best: Body | null = null;
  let bestDistance = maxDistance;
  for (const body of galaxy.bodies) {
    if (!filter(body)) continue;
    const distance = Math.hypot(body.x - point.x, body.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = body;
    }
  }
  return best;
}

/** Galaxy rating 0..100 driven by reach, upgrades and discoveries. */
export function galaxyRating(
  galaxy: Galaxy,
  discoveredTotal: number,
  upgradeSum: number,
  scannerLevel: number,
): number {
  const coverage = discoveredTotal / Math.max(1, galaxy.bodies.length);
  const scaleBonus = { small: 0, medium: 8, large: 16, huge: 24, massive: 32 }[galaxy.scale];
  const raw = coverage * 56 + Math.min(24, upgradeSum * 1.6) + scannerLevel * 3 + scaleBonus;
  return Math.max(0, Math.min(100, Math.round(raw)));
}
