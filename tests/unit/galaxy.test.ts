// Galaxy generation, scanner reach, and rating. Every assertion is against a
// real generated galaxy, so a distribution/geometry regression fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GALAXY_SCALES,
  distanceFromCore,
  galaxyRating,
  generateGalaxy,
  isWithinScanner,
  nearestBody,
  revealedBodies,
  scannerReach,
} from '../../src/core/galaxy.ts';

test('generation is deterministic for a given seed', () => {
  const a = generateGalaxy('medium', 42);
  const b = generateGalaxy('medium', 42);
  assert.deepEqual(
    a.bodies.map((body) => [body.kind, body.x, body.y, body.deposit]),
    b.bodies.map((body) => [body.kind, body.x, body.y, body.deposit]),
  );
  const c = generateGalaxy('medium', 43);
  assert.notDeepEqual(a.bodies[0], c.bodies[0]);
});

test('body counts follow the scale table exactly', () => {
  for (const [scale, spec] of Object.entries(GALAXY_SCALES)) {
    const galaxy = generateGalaxy(scale as keyof typeof GALAXY_SCALES, 7);
    assert.equal(galaxy.bodies.length, spec.bodies, scale);
    assert.equal(galaxy.revealRadius, spec.reveal);
  }
});

test('every body stays inside the unit disc and keeps a positive deposit', () => {
  const galaxy = generateGalaxy('large', 99);
  for (const body of galaxy.bodies) {
    assert.ok(Math.abs(body.x) <= 1 && Math.abs(body.y) <= 1, `${body.name} out of bounds`);
    assert.ok(body.deposit > 0);
    assert.equal(body.capacity, body.deposit);
    assert.ok(body.size > 0);
    assert.ok(body.name.length > 0);
    assert.equal(body.scanned, false);
    assert.equal(body.discovered, false);
  }
});

test('all seven body kinds appear in a medium galaxy', () => {
  const kinds = new Set(generateGalaxy('medium', 5).bodies.map((body) => body.kind));
  for (const kind of ['star', 'planet', 'asteroid', 'comet', 'blackhole', 'nebula', 'ruins']) {
    assert.ok(kinds.has(kind as never), `missing kind ${kind}`);
  }
});

test('scanner reach grows with level and saturates at 1.6', () => {
  const galaxy = generateGalaxy('small', 1);
  const base = scannerReach(galaxy, 0);
  assert.equal(base, galaxy.revealRadius);
  assert.ok(scannerReach(galaxy, 3) > base);
  assert.equal(scannerReach(galaxy, 999), 1.6);
});

test('reveal filters strictly by radius plus body size tolerance', () => {
  const galaxy = generateGalaxy('medium', 11);
  const revealed = revealedBodies(galaxy, 0);
  const reach = scannerReach(galaxy, 0);
  for (const body of revealed) {
    assert.ok(distanceFromCore(body) <= reach + body.size / 200);
  }
  // Upgrading the scanner must reveal a superset, never reshuffle.
  const upgraded = new Set(revealedBodies(galaxy, 4).map((body) => body.id));
  for (const body of revealed) assert.ok(upgraded.has(body.id));
});

test('scanned bodies stay visible outside scanner range', () => {
  const galaxy = generateGalaxy('medium', 12);
  const reach = scannerReach(galaxy, 0);
  const far = galaxy.bodies.find((body) => distanceFromCore(body) > reach + 0.15);
  assert.ok(far, 'expected at least one far body');
  const scanned = { ...far, scanned: true };
  const patched = { ...galaxy, bodies: galaxy.bodies.map((body) => (body.id === scanned.id ? scanned : body)) };
  assert.ok(revealedBodies(patched, 0).some((body) => body.id === scanned.id));
  // The geometric predicate stays honest: the body is still out of range.
  assert.equal(isWithinScanner(patched, scanned, 0), false);
});

test('nearestBody respects the radius and the filter', () => {
  const galaxy = generateGalaxy('small', 3);
  const target = galaxy.bodies[4]!;
  const near = nearestBody(galaxy, { x: target.x, y: target.y }, () => true, 0.2);
  assert.equal(near?.id, target.id);
  assert.equal(nearestBody(galaxy, { x: target.x, y: target.y }, () => false, 0.2), null);
  assert.equal(nearestBody(galaxy, { x: 5, y: 5 }, () => true, 0.2), null);
});

test('galaxy rating is bounded and monotonic in discoveries', () => {
  const galaxy = generateGalaxy('medium', 21);
  const low = galaxyRating(galaxy, 0, 0, 0);
  const mid = galaxyRating(galaxy, 100, 10, 2);
  const high = galaxyRating(galaxy, galaxy.bodies.length, 60, 10);
  assert.ok(low >= 0 && low <= 100);
  assert.ok(mid > low);
  assert.ok(high > mid);
  assert.ok(high <= 100);
});

test('rating rewards full coverage more in a larger galaxy', () => {
  const small = generateGalaxy('small', 21);
  const medium = generateGalaxy('medium', 21);
  const smallScore = galaxyRating(small, small.bodies.length, 5, 1);
  const mediumScore = galaxyRating(medium, medium.bodies.length, 5, 1);
  assert.ok(mediumScore > smallScore, 'scale bonus applies at equal coverage');
});
