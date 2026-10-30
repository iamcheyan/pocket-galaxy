// Benchmark harness. Renders N synthetic bodies for a fixed duration in the
// live renderer and reports measured throughput. Every number comes from real
// rAF timestamps recorded in this browser session — there is no lookup table of
// "expected" scores anywhere in this repository.

import { FrameMonitor } from './monitor.ts';

export interface BenchmarkStep {
  objects: number;
  durationMs: number;
  frames: number;
  avgFps: number;
  minFps: number;
  p95FrameMs: number;
  score: number;
}

export interface BenchmarkResult {
  version: 1;
  startedAt: string;
  finishedAt: string;
  userAgent: string;
  viewport: string;
  dpr: number;
  hardware: { cores: number; memoryGb: number };
  steps: BenchmarkStep[];
  rating: string;
  galaxyScore: number;
  maxStableObjects: number;
  averageFps: number;
  peakMemoryMb: number | null;
  notes: string[];
}

export const BENCHMARK_SIZES = [100, 500, 1000, 3000, 5000, 10000] as const;

export const BENCHMARK_DURATION_MS = 1800;

export interface BenchmarkRenderFn {
  (objects: number, elapsedMs: number, index: number): void;
}

/** One step: run the caller's render loop for `durationMs` of real time. */
export async function runStep(
  objects: number,
  durationMs: number,
  render: BenchmarkRenderFn,
  monitor: FrameMonitor,
): Promise<BenchmarkStep> {
  monitor.reset();
  const finished = Promise.withResolvers<void>();
  const start = performance.now();
  let index = 0;
  const frame = (timestamp: number) => {
    monitor.push(timestamp);
    render(objects, timestamp - start, index);
    index += 1;
    if (timestamp - start < durationMs) requestAnimationFrame(frame);
    else finished.resolve();
  };
  requestAnimationFrame(frame);
  await finished.promise;
  const totals = monitor.totals();
  const sample = monitor.sample();
  const history = monitor.history();
  const minFps = history.length > 0 ? Math.min(...history) : 0;
  // Score: objects scaled by sustained frame rate. 10k objects at 60 FPS scores
  // higher than 10k at 20 FPS, and 10k at 20 FPS still beats 100 at 60 FPS.
  const score = Math.round((objects * totals.avgFps) / 100);
  return {
    objects,
    durationMs: Math.round(performance.now() - start),
    frames: totals.frames,
    avgFps: Math.round(totals.avgFps * 10) / 10,
    minFps: Math.round(minFps * 10) / 10,
    p95FrameMs: Math.round(sample.p95Ms * 100) / 100,
    score,
  };
}

/**
 * Perfect run: every scene at the 60 Hz display cap.
 * sum(100,500,1000,3000,5000,10000) * 60 / 100 = 11760.
 * Thresholds are fractions of that ceiling, so the grade stays meaningful on
 * both a slow handheld and a fast desktop instead of saturating at "D".
 */
export const PERFECT_SCORE = (BENCHMARK_SIZES.reduce((sum, size) => sum + size, 0) * 60) / 100;

export function rateScore(galaxyScore: number): string {
  const ratio = galaxyScore / PERFECT_SCORE;
  if (ratio >= 0.94) return 'S+';
  if (ratio >= 0.85) return 'S';
  if (ratio >= 0.76) return 'A+';
  if (ratio >= 0.63) return 'A';
  if (ratio >= 0.45) return 'B';
  if (ratio >= 0.22) return 'C';
  return 'D';
}

/**
 * Stable object count = the largest size at which the run kept at least 24 FPS
 * on average. Refusing to extrapolate matters: an unstable size is reported as
 * such instead of guessed.
 */
export function maxStable(steps: BenchmarkStep[]): number {
  let stable = 0;
  for (const step of steps) {
    if (step.avgFps >= 24) stable = Math.max(stable, step.objects);
  }
  return stable;
}

export function summarize(
  steps: BenchmarkStep[],
  meta: Omit<BenchmarkResult, 'steps' | 'rating' | 'galaxyScore' | 'maxStableObjects' | 'averageFps' | 'peakMemoryMb' | 'notes'>,
  peakMemoryMb: number | null,
): BenchmarkResult {
  const galaxyScore = steps.reduce((sum, step) => sum + step.score, 0);
  const withFrames = steps.filter((step) => step.frames > 0);
  const averageFps =
    withFrames.length === 0
      ? 0
      : withFrames.reduce((sum, step) => sum + step.avgFps * step.frames, 0) /
        withFrames.reduce((sum, step) => sum + step.frames, 0);
  const notes: string[] = [];
  if (peakMemoryMb === null) {
    notes.push('Memory unavailable: this browser exposes no heap API.');
  }
  const slowest = [...withFrames].sort((a, b) => a.avgFps - b.avgFps)[0];
  if (slowest && slowest.avgFps < 20) {
    notes.push(`Below 20 FPS at ${slowest.objects} objects (${slowest.avgFps} avg).`);
  }
  return {
    ...meta,
    steps,
    rating: rateScore(galaxyScore),
    galaxyScore,
    maxStableObjects: maxStable(steps),
    averageFps: Math.round(averageFps * 10) / 10,
    peakMemoryMb,
    notes,
  };
}

/** Plain-text report, ready to paste into an issue or a bug report. */
export function formatReport(result: BenchmarkResult): string {
  const header = [
    '# Pocket Galaxy Benchmark',
    `Date: ${result.finishedAt}`,
    `Browser: ${result.userAgent}`,
    `Viewport: ${result.viewport} @${result.dpr}x`,
    `CPU cores: ${result.hardware.cores}  Memory hint: ${result.hardware.memoryGb} GB`,
    '',
    'objects  frames  avgFps  minFps  p95ms   score',
  ];
  const rows = result.steps.map(
    (step) =>
      `${String(step.objects).padStart(7)}  ${String(step.frames).padStart(6)}  ${step.avgFps
        .toFixed(1)
        .padStart(6)}  ${step.minFps.toFixed(1).padStart(6)}  ${step.p95FrameMs
        .toFixed(2)
        .padStart(6)}  ${String(step.score).padStart(6)}`,
  );
  const footer = [
    '',
    `Galaxy Score: ${result.galaxyScore}`,
    `Device Rating: ${result.rating}`,
    `Max Stable Objects: ${result.maxStableObjects}`,
    `Average FPS: ${result.averageFps}`,
    `Peak Memory: ${result.peakMemoryMb === null ? 'n/a' : `${result.peakMemoryMb} MB`}`,
  ];
  if (result.notes.length > 0) {
    footer.push('', 'Notes:', ...result.notes.map((note) => `- ${note}`));
  }
  return [...header, ...rows, ...footer].join('\n');
}
