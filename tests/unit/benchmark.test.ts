// Benchmark scoring and report formatting. Scores must be derived from frame
// counts and the scene table, so these tests fail if either drifts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BENCHMARK_SIZES,
  PERFECT_SCORE,
  formatReport,
  maxStable,
  rateScore,
  summarize,
  type BenchmarkResult,
  type BenchmarkStep,
} from '../../src/perf/benchmark.ts';

const step = (objects: number, avgFps: number, frames = 100, minFps = avgFps): BenchmarkStep => ({
  objects,
  durationMs: 1800,
  frames,
  avgFps,
  minFps,
  p95FrameMs: 1000 / Math.max(1, avgFps),
  score: Math.round((objects * avgFps) / 100),
});

const meta = {
  version: 1 as const,
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:01:00.000Z',
  userAgent: 'test-agent',
  viewport: '1280x800',
  dpr: 1,
  hardware: { cores: 8, memoryGb: 8 },
};

test('scene sizes are the documented fixed ladder', () => {
  assert.deepEqual([...BENCHMARK_SIZES], [100, 500, 1000, 3000, 5000, 10000]);
});

test('the perfect score is the sum of every scene at 60 FPS', () => {
  assert.equal(PERFECT_SCORE, 11760);
  const perfect = BENCHMARK_SIZES.map((size) => step(size, 60));
  const result = summarize([...perfect], meta, null);
  assert.equal(result.rating, 'S+');
  assert.equal(result.maxStableObjects, 10000);
  assert.equal(result.averageFps, 60);
});

test('actual measured rates produce lower grades, monotonically', () => {
  const run = (fps: number) =>
    rateScore(BENCHMARK_SIZES.reduce((sum, size) => sum + Math.round((size * fps) / 100), 0));
  const grades = [60, 50, 40, 28, 15, 6].map(run);
  const order = ['S+', 'S', 'A+', 'A', 'B', 'C', 'D'];
  for (let index = 1; index < grades.length; index++) {
    assert.ok(
      order.indexOf(grades[index] as string) >= order.indexOf(grades[index - 1] as string),
      `grade regressed: ${grades.join(' > ')}`,
    );
  }
});

test('maxStable only counts sizes that sustained 24 FPS', () => {
  const steps = [step(100, 60), step(500, 55), step(1000, 40), step(3000, 24), step(5000, 21), step(10000, 12)];
  assert.equal(maxStable(steps), 3000);
});

test('maxStable refuses to extrapolate when even the smallest scene is slow', () => {
  assert.equal(maxStable([step(100, 18)]), 0);
  assert.equal(maxStable([]), 0);
});

test('summarize weights average FPS by frames actually rendered', () => {
  const result = summarize([step(100, 60, 300), step(10000, 20, 100)], meta, 128);
  assert.equal(result.averageFps, Math.round(((60 * 300 + 20 * 100) / 400) * 10) / 10);
  assert.equal(result.peakMemoryMb, 128);
  // score = round(objects * fps / 100) per scene: 60 + 2000.
  assert.equal(result.galaxyScore, 2060);
});

test('missing memory is reported as null with an explanatory note', () => {
  const result = summarize([step(100, 60)], meta, null);
  assert.equal(result.peakMemoryMb, null);
  assert.ok(result.notes.some((note) => note.includes('Memory unavailable')));
});

test('a slow scene is called out by name in the notes', () => {
  const result = summarize([step(100, 60), step(10000, 8)], meta, null);
  assert.ok(result.notes.some((note) => note.includes('10000 objects')), JSON.stringify(result.notes));
});

test('formatReport is paste-ready and quotes the real numbers', () => {
  const result: BenchmarkResult = summarize([step(100, 59.5), step(10000, 31.2)], meta, 142);
  const report = formatReport(result);
  for (const needle of [
    '# Pocket Galaxy Benchmark',
    'test-agent',
    '1280x800 @1x',
    'Galaxy Score:',
    'Device Rating:',
    'Max Stable Objects:',
    'Peak Memory: 142 MB',
    '59.5',
    '31.2',
  ]) {
    assert.ok(report.includes(needle), `missing "${needle}"`);
  }
  assert.ok(!report.includes('undefined'));
});
