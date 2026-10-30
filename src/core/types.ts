// Shared domain types. Kept dependency-free so every core module is unit
// testable in Node and reusable by the renderer.

export type ResourceKind = 'energy' | 'mineral' | 'science';

export type BodyKind =
  | 'star'
  | 'planet'
  | 'asteroid'
  | 'comet'
  | 'blackhole'
  | 'nebula'
  | 'ruins';

export type GalaxyScale = 'small' | 'medium' | 'large' | 'huge' | 'massive';

export type UpgradeId = 'engine' | 'scanner' | 'shield' | 'cargo' | 'mining' | 'speed';

export type RiskKind = 'storm' | 'radiation' | 'pirates' | 'anomaly';

export type Resources = Record<ResourceKind, number>;

export type UpgradeLevels = Record<UpgradeId, number>;

export interface Body {
  id: number;
  kind: BodyKind;
  /** Galaxy-space position, normalised to the unit disc: -1..1. */
  x: number;
  y: number;
  /** Visual radius in logical pixels at zoom 1. */
  size: number;
  seed: number;
  /** Human-readable name; not unique — see `catalog`. */
  name: string;
  /** Stable, unique per galaxy (e.g. "KX-1187"). */
  catalog: string;
  scanned: boolean;
  discovered: boolean;
  /** Remaining harvest units. */
  deposit: number;
  capacity: number;
}

export interface Galaxy {
  scale: GalaxyScale;
  seed: number;
  bodies: Body[];
  /** How many bodies the current scanner radius can reach (derived, cached). */
  revealRadius: number;
}

export interface RiskEvent {
  kind: RiskKind;
  title: string;
  detail: string;
  hullDelta: number;
  resourcesDelta: Partial<Resources>;
}

export interface Achievement {
  id: string;
  title: string;
  detail: string;
  unlocked: boolean;
}

export interface Stats {
  playTimeMs: number;
  travelDistance: number;
  bodiesScanned: number;
  harvested: number;
  upgradesBought: number;
  peakFps: number;
  avgFps: number;
  sessions: number;
}

export interface GameState {
  version: number;
  createdAt: number;
  updatedAt: number;
  resources: Resources;
  hull: number;
  upgrades: UpgradeLevels;
  galaxy: Galaxy;
  /** Body ids that have been fully explored, for stats/achievements. */
  discoveredTotal: number;
  visitedPlanets: number;
  scienceCollected: number;
  resourcesCollected: number;
  riskLog: Array<{ kind: RiskKind; at: number }>;
  stats: Stats;
  /** Frame counter of the simulation, monotonic. */
  tick: number;
  paused: boolean;
}

export interface Settings {
  theme: 'light' | 'dark' | 'oled';
  layout: 'auto' | 'handheld' | 'tablet' | 'desktop' | 'eink';
  quality: 'auto' | 'high' | 'medium' | 'low';
  animations: boolean;
  particles: boolean;
  showPerf: boolean;
  gamepadMap: Record<string, number>;
  audio: boolean;
}

export interface SaveEnvelope {
  schema: 'pocket-galaxy';
  version: number;
  savedAt: number;
  state: GameState;
  settings: Settings;
}
