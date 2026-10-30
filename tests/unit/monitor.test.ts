// Frame monitoring and rolling cost accounting. Sample values come from
// synthetic timestamps so the statistics are deterministic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CostMonitor, FrameMonitor } from '../../src/perf/monitor.ts';

const feed = (monitor: FrameMonitor, deltas: number[], start = 1000) => {
  let time = start;
  monitor.push(time);
  for (const delta of deltas) {
    time += delta;
    monitor.push(time);
  }
};

test('an empty monitor reports zeros instead of NaN', () => {
  const sample = new FrameMonitor().sample();
  assert.equal(sample.fps, 0);
  assert.equal(sample.avgFrameMs, 0);
  assert.equal(sample.window, 0);
  assert.equal(sample.jank, 0);
});

test('steady 60 Hz frames measure 60 FPS and zero jank', () => {
  const monitor = new FrameMonitor(120);
  feed(monitor, Array.from({ length: 59 }, () => 1000 / 60));
  const sample = monitor.sample();
  assert.ok(Math.abs(sample.avgFps - 60) < 0.1, `avgFps=${sample.avgFps}`);
  assert.ok(Math.abs(sample.fps - 60) < 0.1);
  assert.equal(sample.jank, 0);
  assert.equal(sample.window, 59);
});

test('jank ratio reflects frames slower than 33 ms', () => {
  const monitor = new FrameMonitor(120);
  feed(monitor, [16.7, 16.7, 50, 16.7, 16.7, 50, 16.7, 16.7]);
  const sample = monitor.sample();
  assert.equal(sample.window, 8);
  assert.equal(sample.jank, 2 / 8);
  assert.equal(sample.worstMs, 50);
  assert.ok(sample.p95Ms >= 16.7);
});

test('the window is bounded, and totals keep accumulating', () => {
  const monitor = new FrameMonitor(10);
  feed(monitor, Array.from({ length: 40 }, () => 20));
  assert.equal(monitor.sample().window, 10);
  assert.equal(monitor.totals().frames, 40);
  assert.ok(Math.abs(monitor.totals().avgFps - 50) < 0.01);
});

test('a hidden tab gap is dropped, not counted as one giant frame', () => {
  const monitor = new FrameMonitor(30);
  feed(monitor, [16, 16, 16]);
  monitor.push(100_000); // tab was hidden for minutes
  feed(monitor, [16], 100_016);
  // Three normal frames plus the two post-gap frames; the gap itself is dropped.
  assert.equal(monitor.sample().window, 5);
  assert.equal(monitor.sample().worstMs, 16);
  assert.ok(monitor.sample().avgFps > 55, 'one gap must not poison the average');
});

test('markGap and reset restore a clean slate', () => {
  const monitor = new FrameMonitor(30);
  feed(monitor, [16, 16]);
  monitor.markGap();
  feed(monitor, [16], 5000);
  assert.equal(monitor.sample().window, 3);
  monitor.reset();
  assert.equal(monitor.sample().window, 0);
  assert.equal(monitor.totals().frames, 0);
});

test('history is capped and ordered oldest → newest', () => {
  const monitor = new FrameMonitor(240);
  feed(monitor, Array.from({ length: 300 }, () => 16));
  const history = monitor.history();
  assert.equal(history.length, 60);
  assert.ok(history.every((fps) => Math.abs(fps - 62.5) < 0.01));
});

test('peak FPS ignores absurd sub-frame deltas', () => {
  const monitor = new FrameMonitor(30);
  feed(monitor, [16, 0.1, 16]);
  assert.ok(monitor.totals().peakFps <= 240, `peak=${monitor.totals().peakFps}`);
});

test('cost monitor averages update/render and resets between reads', () => {
  const monitor = new CostMonitor();
  monitor.record({ entities: 10, particles: 4, drawCalls: 3, updateMs: 2, renderMs: 6 });
  monitor.record({ entities: 12, particles: 6, drawCalls: 3, updateMs: 4, renderMs: 8 });
  const stats = monitor.take();
  assert.equal(stats.updateMs, 3);
  assert.equal(stats.renderMs, 7);
  assert.equal(stats.entities, 12);
  assert.equal(stats.particles, 6);
  assert.equal(stats.drawCalls, 3);

  monitor.record({ entities: 1, particles: 0, drawCalls: 2, updateMs: 5, renderMs: 1 });
  const second = monitor.take();
  assert.equal(second.updateMs, 5, 'accumulators restart after take()');
  assert.equal(second.renderMs, 1);
});

test('cost monitor survives take() with no recorded frames', () => {
  const stats = new CostMonitor().take();
  assert.equal(stats.updateMs, 0);
  assert.equal(stats.renderMs, 0);
});
