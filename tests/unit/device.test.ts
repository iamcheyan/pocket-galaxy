// Capability detection, layout resolution, quality budgets, and the adaptive
// quality hysteresis. All inputs are injected; nothing reads the real device.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AdaptiveQuality,
  LAYOUTS,
  detectCapabilities,
  qualityBudget,
  resolveLayout,
  type Capabilities,
  type MatchMediaLike,
} from '../../src/core/device.ts';

const mediaFor = (matches: string[]): MatchMediaLike => (query) =>
  ({ matches: matches.some((entry) => query.includes(entry)) });

const caps = (overrides: Partial<Capabilities> = {}): Capabilities => ({
  width: 390,
  height: 844,
  dpr: 2,
  touch: true,
  coarsePointer: true,
  hover: false,
  gamepad: false,
  eink: false,
  reducedMotion: false,
  cores: 2,
  memoryGb: 1,
  refreshHz: 60,
  ...overrides,
});

test('touch and e-ink are read from media queries, not from user agent', () => {
  const touchCaps = detectCapabilities(
    { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' },
    mediaFor(['pointer: coarse']),
    { width: 390, height: 844, dpr: 3 },
  );
  assert.equal(touchCaps.touch, true);
  assert.equal(touchCaps.hover, false);
  assert.equal(touchCaps.coarsePointer, true);

  const einkCaps = detectCapabilities(
    { userAgent: 'anything', maxTouchPoints: 5 },
    mediaFor(['monochrome']),
    { width: 720, height: 1280, dpr: 1 },
  );
  assert.equal(einkCaps.eink, true);
  assert.equal(einkCaps.refreshHz, 15);
});

test('maxTouchPoints alone implies touch support', () => {
  const detected = detectCapabilities({ maxTouchPoints: 2 }, null, { width: 800, height: 600, dpr: 1 });
  assert.equal(detected.touch, true);
  assert.equal(detected.eink, false);
  assert.equal(detected.cores, 2, 'fallback core count');
});

test('auto layout resolves desktop, tablet, handheld and eink from measurements', () => {
  assert.equal(resolveLayout('auto', caps({ width: 1280, height: 800, touch: false, coarsePointer: false })).id, 'desktop');
  assert.equal(resolveLayout('auto', caps({ width: 720, height: 720 })).id, 'tablet');
  assert.equal(resolveLayout('auto', caps({ width: 390, height: 844 })).id, 'handheld');
  assert.equal(resolveLayout('auto', caps({ eink: true, width: 1404, height: 1872 })).id, 'eink');
  assert.equal(resolveLayout('auto', caps({ width: 900, height: 500, touch: false, coarsePointer: false })).id, 'desktop');
});

test('an explicit layout always wins, including on mismatched hardware', () => {
  assert.equal(resolveLayout('eink', caps({ width: 1920, height: 1080 })).id, 'eink');
  assert.equal(resolveLayout('handheld', caps({ width: 1920, height: 1080 })).id, 'handheld');
  assert.equal(resolveLayout('desktop', caps({ width: 390, height: 844 })).id, 'desktop');
  assert.equal(LAYOUTS.handheld.panelWidth, 0);
  assert.ok(LAYOUTS.eink.minTouchTarget >= LAYOUTS.handheld.minTouchTarget);
});

test('quality budgets degrade monotonically', () => {
  const high = qualityBudget('high', false);
  const medium = qualityBudget('medium', false);
  const low = qualityBudget('low', false);
  const ink = qualityBudget('high', true);

  assert.ok(high.particles > medium.particles && medium.particles > low.particles);
  assert.ok(high.starfield > medium.starfield && medium.starfield > low.starfield);
  assert.ok(high.maxBodiesRendered > medium.maxBodiesRendered && medium.maxBodiesRendered > low.maxBodiesRendered);
  assert.equal(high.glow, true);
  assert.equal(medium.glow, false);
  assert.equal(low.trails, false);
  assert.equal(ink.particles, 0);
  assert.equal(ink.monochrome, true, 'e-ink budget must be monochrome');
  assert.equal(high.monochrome, false);
  assert.equal(low.monochrome, false);
  assert.equal(ink.glow, false);
  assert.equal(ink.trails, false);
  assert.equal(ink.targetFrameMs, 66);
});

test('adaptive quality drops after sustained slow frames and recovers later', () => {
  const adaptive = new AdaptiveQuality('high', true);
  for (let index = 0; index < 44; index++) {
    assert.equal(adaptive.sample(55), 'high', 'hysteresis window not yet met');
  }
  assert.equal(adaptive.sample(55), 'medium');
  for (let index = 0; index < 45; index++) adaptive.sample(55);
  assert.equal(adaptive.current(), 'low');
  // Fast frames need a much longer streak to climb back.
  for (let index = 0; index < 239; index++) adaptive.sample(12);
  assert.equal(adaptive.current(), 'low');
  assert.equal(adaptive.sample(12), 'medium');
});

test('adaptive quality does not flap on isolated slow frames', () => {
  const adaptive = new AdaptiveQuality('high', true);
  for (let index = 0; index < 200; index++) {
    adaptive.sample(index % 10 === 0 ? 60 : 16);
  }
  assert.equal(adaptive.current(), 'high');
});

test('manual override pins the level and resets streak counters', () => {
  const adaptive = new AdaptiveQuality('high', true);
  for (let index = 0; index < 45; index++) adaptive.sample(50);
  assert.equal(adaptive.current(), 'medium');
  adaptive.override('low');
  assert.equal(adaptive.current(), 'low');
  // The pre-override slow streak must not immediately demote from 'low', and a
  // short fast streak must not promote either.
  for (let index = 0; index < 100; index++) adaptive.sample(10);
  assert.equal(adaptive.current(), 'low');

  const disabled = new AdaptiveQuality('high', false);
  for (let index = 0; index < 400; index++) disabled.sample(80);
  assert.equal(disabled.current(), 'high');
});
