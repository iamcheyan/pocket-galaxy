// Frame-time sampler. Pure bookkeeping: the renderer pushes real rAF timestamps
// and the overlay reads derived statistics. No synthetic FPS is ever invented.

export interface FrameSample {
  fps: number;
  avgFps: number;
  frameMs: number;
  avgFrameMs: number;
  worstMs: number;
  p95Ms: number;
  jank: number;
  window: number;
}

export class FrameMonitor {
  private readonly durations: number[] = [];
  private readonly cap: number;
  private last = 0;
  private totalFrames = 0;
  private totalMs = 0;
  private worst = 0;
  private peakFps = 0;
  private readonly ringFps: number[] = [];

  constructor(capacity = 120) {
    this.cap = capacity;
  }

  /** Record a rAF timestamp (ms, DOMHighResTimeStamp). */
  push(timestamp: number): void {
    if (this.last === 0) {
      this.last = timestamp;
      return;
    }
    const delta = timestamp - this.last;
    this.last = timestamp;
    if (delta <= 0 || delta > 2000) return; // tab was hidden or clock jumped
    this.durations.push(delta);
    if (this.durations.length > this.cap) this.durations.shift();
    this.totalFrames += 1;
    this.totalMs += delta;
    if (delta > this.worst) this.worst = delta;
    const instantFps = 1000 / delta;
    if (instantFps > this.peakFps && instantFps < 240) this.peakFps = instantFps;
    this.ringFps.push(instantFps);
    if (this.ringFps.length > 240) this.ringFps.shift();
  }

  markGap(): void {
    this.last = 0;
  }

  reset(): void {
    this.durations.length = 0;
    this.ringFps.length = 0;
    this.last = 0;
    this.totalFrames = 0;
    this.totalMs = 0;
    this.worst = 0;
    this.peakFps = 0;
  }

  sample(): FrameSample {
    const window = this.durations.length;
    if (window === 0) {
      return {
        fps: 0,
        avgFps: 0,
        frameMs: 0,
        avgFrameMs: 0,
        worstMs: 0,
        p95Ms: 0,
        jank: 0,
        window: 0,
      };
    }
    const last = this.durations[window - 1] as number;
    const sum = this.durations.reduce((acc, value) => acc + value, 0);
    const avg = sum / window;
    const sorted = [...this.durations].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] as number;
    const jank = this.durations.filter((value) => value > 33).length / window;
    return {
      fps: 1000 / last,
      avgFps: 1000 / avg,
      frameMs: last,
      avgFrameMs: avg,
      worstMs: this.worst,
      p95Ms: p95,
      jank,
      window,
    };
  }

  /** FPS history for the sparkline, oldest first. */
  history(): number[] {
    return this.ringFps.slice(-60);
  }

  totals(): { frames: number; avgFps: number; peakFps: number; worstMs: number } {
    return {
      frames: this.totalFrames,
      avgFps: this.totalMs > 0 ? (this.totalFrames * 1000) / this.totalMs : 0,
      peakFps: this.peakFps,
      worstMs: this.worst,
    };
  }
}

export interface MemorySample {
  usedMb: number | null;
  limitMb: number | null;
  available: boolean;
  source: 'measureUserAgentSpecificMemory' | 'jsHeapSizeLimit' | 'unavailable';
}

interface PerformanceMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/** Reads real memory only where the platform exposes it; never estimates. */
export function readMemory(): MemorySample {
  const performanceWithMemory: Performance & { memory?: PerformanceMemory } = performance;
  const memory = performanceWithMemory.memory;
  if (memory) {
    return {
      usedMb: Math.round((memory.usedJSHeapSize / 1048576) * 10) / 10,
      limitMb: Math.round(memory.jsHeapSizeLimit / 1048576),
      available: true,
      source: 'jsHeapSizeLimit',
    };
  }
  return { usedMb: null, limitMb: null, available: false, source: 'unavailable' };
}

/**
 * Chromium-only precise heap measurement. Resolves to null when the API is
 * absent (Firefox/Safari) so the overlay can honestly print "n/a".
 */
export async function measurePreciseMemory(): Promise<MemorySample> {
  const perf = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
  };
  if (typeof perf.measureUserAgentSpecificMemory !== 'function') return readMemory();
  try {
    const result = await perf.measureUserAgentSpecificMemory();
    return {
      usedMb: Math.round((result.bytes / 1048576) * 10) / 10,
      limitMb: null,
      available: true,
      source: 'measureUserAgentSpecificMemory',
    };
  } catch {
    return readMemory();
  }
}

export interface DrawStats {
  entities: number;
  particles: number;
  drawCalls: number;
  updateMs: number;
  renderMs: number;
}

/** Rolling per-frame cost tracker for the developer overlay. */
export class CostMonitor {
  private update = 0;
  private render = 0;
  private drawCalls = 0;
  private entities = 0;
  private particles = 0;
  private samples = 0;
  private readonly updateRing: number[] = [];
  private readonly renderRing: number[] = [];

  record(entry: DrawStats): void {
    this.update += entry.updateMs;
    this.render += entry.renderMs;
    this.drawCalls = entry.drawCalls;
    this.entities = entry.entities;
    this.particles = entry.particles;
    this.samples += 1;
    this.updateRing.push(entry.updateMs);
    this.renderRing.push(entry.renderMs);
    if (this.updateRing.length > 120) this.updateRing.shift();
    if (this.renderRing.length > 120) this.renderRing.shift();
  }

  /** Averages since the previous call and resets the accumulators. */
  take(): DrawStats {
    const sampleCount = Math.max(1, this.samples);
    const stats: DrawStats = {
      entities: this.entities,
      particles: this.particles,
      drawCalls: this.drawCalls,
      updateMs: this.update / sampleCount,
      renderMs: this.render / sampleCount,
    };
    this.update = 0;
    this.render = 0;
    this.samples = 0;
    return stats;
  }

  avgRender(): number {
    if (this.renderRing.length === 0) return 0;
    return this.renderRing.reduce((a, b) => a + b, 0) / this.renderRing.length;
  }

  avgUpdate(): number {
    if (this.updateRing.length === 0) return 0;
    return this.updateRing.reduce((a, b) => a + b, 0) / this.updateRing.length;
  }
}
