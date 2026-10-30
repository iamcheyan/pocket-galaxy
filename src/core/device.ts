// Device capability detection and layout selection. Everything is derived from
// runtime capabilities (screen, pointer, hover, e-ink hints, frame budget) —
// no device name ever influences gameplay or layout.

export type LayoutId = 'handheld' | 'tablet' | 'desktop' | 'eink';

export interface Capabilities {
  width: number;
  height: number;
  dpr: number;
  touch: boolean;
  coarsePointer: boolean;
  hover: boolean;
  gamepad: boolean;
  eink: boolean;
  reducedMotion: boolean;
  cores: number;
  memoryGb: number;
  refreshHz: number;
}

export interface LayoutSpec {
  id: LayoutId;
  label: string;
  /** Side panel width in CSS px; 0 means stacked below the map. */
  panelWidth: number;
  hud: 'compact' | 'standard' | 'full';
  minTouchTarget: number;
  showSparkline: boolean;
}

export const LAYOUTS: Record<LayoutId, LayoutSpec> = {
  handheld: {
    id: 'handheld',
    label: 'Handheld',
    panelWidth: 0,
    hud: 'compact',
    minTouchTarget: 44,
    showSparkline: false,
  },
  tablet: {
    id: 'tablet',
    label: 'Tablet',
    panelWidth: 300,
    hud: 'standard',
    minTouchTarget: 44,
    showSparkline: true,
  },
  eink: {
    id: 'eink',
    label: 'E-Ink',
    panelWidth: 0,
    hud: 'compact',
    minTouchTarget: 52,
    showSparkline: false,
  },
  desktop: {
    id: 'desktop',
    label: 'Desktop',
    panelWidth: 360,
    hud: 'full',
    minTouchTarget: 36,
    showSparkline: true,
  },
};

export interface NavigatorLike {
  userAgent?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
  getGamepads?: () => ArrayLike<unknown>;
}

export interface MatchMediaLike {
  (query: string): { matches: boolean };
}

export function detectCapabilities(
  nav: NavigatorLike,
  matchMedia: MatchMediaLike | null,
  viewport: { width: number; height: number; dpr: number },
): Capabilities {
  const media = (query: string) => matchMedia?.(query).matches ?? false;
  const touch = (nav.maxTouchPoints ?? 0) > 0 || media('(pointer: coarse)');
  // E-ink is not exposed as a standard media feature. We honor the explicit
  // "monochrome"/"e-ink" hints a reader OS may supply and otherwise fall back
  // to a conservative high-latency + low-refresh heuristic the user can
  // override in Settings.
  const eink = media('(monochrome)') || media('(update: slow)');
  return {
    width: viewport.width,
    height: viewport.height,
    dpr: viewport.dpr,
    touch,
    coarsePointer: media('(pointer: coarse)'),
    hover: media('(hover: hover)'),
    gamepad: typeof nav.getGamepads === 'function',
    eink,
    reducedMotion: media('(prefers-reduced-motion: reduce)'),
    cores: nav.hardwareConcurrency ?? 2,
    memoryGb: nav.deviceMemory ?? 1,
    refreshHz: eink ? 15 : 60,
  };
}

/**
 * Chooses a layout from measured viewport + capabilities. Explicit user
 * override wins; 'auto' always resolves from capabilities.
 */
export function resolveLayout(
  mode: 'auto' | LayoutId,
  caps: Capabilities,
): LayoutSpec {
  if (mode !== 'auto') return LAYOUTS[mode];
  if (caps.eink) return LAYOUTS.eink;
  const shortSide = Math.min(caps.width, caps.height);
  if (caps.width >= 1024 && caps.height >= 600) return LAYOUTS.desktop;
  if (shortSide >= 600) return LAYOUTS.tablet;
  if (caps.coarsePointer || caps.touch) return LAYOUTS.handheld;
  return caps.width >= 900 ? LAYOUTS.desktop : LAYOUTS.handheld;
}

export type QualityLevel = 'high' | 'medium' | 'low';

export interface QualityBudget {
  level: QualityLevel;
  /** E-ink renders in grayscale with high-contrast ink, never colour. */
  monochrome: boolean;
  particles: number;
  starfield: number;
  trails: boolean;
  glow: boolean;
  shadows: boolean;
  maxBodiesRendered: number;
  targetFrameMs: number;
  /** Animation speed multiplier applied to ambient motion. */
  motionScale: number;
}

export function qualityBudget(level: QualityLevel, eink: boolean): QualityBudget {
  if (eink) {
    return {
      level,
      monochrome: true,
      particles: 0,
      starfield: 40,
      trails: false,
      glow: false,
      shadows: false,
      maxBodiesRendered: 400,
      targetFrameMs: 66,
      motionScale: 0.25,
    };
  }
  if (level === 'low') {
    return {
      level,
      monochrome: false,
      particles: 90,
      starfield: 120,
      trails: false,
      glow: false,
      shadows: false,
      maxBodiesRendered: 600,
      targetFrameMs: 33,
      motionScale: 0.6,
    };
  }
  if (level === 'medium') {
    return {
      level,
      monochrome: false,
      particles: 320,
      starfield: 260,
      trails: true,
      glow: false,
      shadows: false,
      maxBodiesRendered: 1400,
      targetFrameMs: 20,
      motionScale: 0.85,
    };
  }
  return {
    level,
    monochrome: false,
    particles: 900,
    starfield: 420,
    trails: true,
    glow: true,
    shadows: true,
    maxBodiesRendered: 4000,
    targetFrameMs: 17,
    motionScale: 1,
  };
}

/**
 * Adaptive quality controller: hysteresis keeps it from flapping between
 * levels every frame. Feed it smoothed frame time; it returns the next level.
 */
export class AdaptiveQuality {
  private level: QualityLevel;
  private lowStreak = 0;
  private highStreak = 0;
  private readonly enabled: boolean;

  constructor(initial: QualityLevel = 'high', enabled = true) {
    this.level = initial;
    this.enabled = enabled;
  }

  current(): QualityLevel {
    return this.level;
  }

  /** @returns the level after this sample (may be unchanged). */
  sample(frameMs: number): QualityLevel {
    if (!this.enabled) return this.level;
    const order: QualityLevel[] = ['low', 'medium', 'high'];
    const index = order.indexOf(this.level);
    if (frameMs > 40) {
      this.lowStreak += 1;
      this.highStreak = 0;
    } else if (frameMs < 19) {
      this.highStreak += 1;
      this.lowStreak = 0;
    } else {
      this.lowStreak = 0;
      this.highStreak = 0;
    }
    if (this.lowStreak >= 45 && index > 0) {
      this.level = order[index - 1] as QualityLevel;
      this.lowStreak = 0;
    } else if (this.highStreak >= 240 && index < order.length - 1) {
      this.level = order[index + 1] as QualityLevel;
      this.highStreak = 0;
    }
    return this.level;
  }

  override(level: QualityLevel): void {
    this.level = level;
    this.lowStreak = 0;
    this.highStreak = 0;
  }
}
