// Ambient declarations for platform APIs that TypeScript's DOM lib omits.

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface Performance {
  /** Chromium-only; undefined elsewhere (the UI prints "n/a" then). */
  readonly memory?: PerformanceMemory;
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number; breakdown: unknown[] }>;
}
