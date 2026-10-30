// Application store. One mutable root object plus a listener set; screens read
// it and call actions, and the rAF loop renders from it. Deliberately not a
// reactive framework: the map repaints from the same object the HUD reads.

import {
  buyUpgrade,
  createNewGame,
  evaluateAchievements,
  expandGalaxy,
  harvest,
  idleTick,
  pickBodyAt,
  rating,
  ratingLabel,
  repairHull,
  riskRng,
  rollRisk,
  scanBody,
} from '../core/game.ts';
import { revealedBodies } from '../core/galaxy.ts';
import {
  AdaptiveQuality,
  detectCapabilities,
  qualityBudget,
  resolveLayout,
  type Capabilities,
  type LayoutId,
  type LayoutSpec,
  type QualityBudget,
  type QualityLevel,
} from '../core/device.ts';
import {
  appendHistory,
  clearSave,
  defaultSettings,
  mirrorSave,
  readMirror,
  readSave,
  readSettings,
  writeSave,
  writeSettings,
} from '../core/save.ts';
import { FrameMonitor, CostMonitor, type FrameSample, type DrawStats } from '../perf/monitor.ts';
import { advanceParticles, type Camera, type Particle } from '../render/canvas.ts';
import type { Body, GameState, GalaxyScale, Settings, UpgradeId } from '../core/types.ts';
import type { InputRouter } from '../ui/input.ts';

export type PageId = 'galaxy' | 'ship' | 'benchmark' | 'showcase' | 'achievements' | 'settings';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'bad';
  at: number;
}

export interface InputLogEntry {
  source: string;
  action: string;
  detail: string;
  at: number;
}

export interface StoreState {
  page: PageId;
  game: GameState;
  settings: Settings;
  camera: Camera;
  selectedId: number | null;
  hoverId: number | null;
  particles: Particle[];
  toasts: Toast[];
  inputLog: InputLogEntry[];
  saveStatus: string;
  lastSavedAt: number;
  /** How this session began ("new game" | "loaded"), immutable for the session. */
  sessionOrigin: 'new game' | 'loaded' | 'mirror';
  caps: Capabilities;
  layout: LayoutSpec;
  budget: QualityBudget;
  adaptiveLevel: QualityLevel;
  manualQuality: QualityLevel | null;
  perfVisible: boolean;
  devVisible: boolean;
  sample: FrameSample;
  stats: DrawStats;
  fpsHistory: number[];
  gamepad: { connected: boolean; id: string; buttons: number[] };
  paused: boolean;
  modal: null | { title: string; body: string; actions: Array<{ label: string; run: () => void }> };
  contextMenu: null | { x: number; y: number; bodyId: number | null };
}

type Listener = () => void;

const NOW = () => Date.now();

export class Store {
  state: StoreState;
  readonly monitor = new FrameMonitor(120);
  readonly cost = new CostMonitor();
  private readonly adaptive = new AdaptiveQuality('high', true);
  private readonly listeners = new Set<Listener>();
  private readonly inputListeners = new Set<Listener>();
  private toastSeq = 0;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private mirrorTimer: ReturnType<typeof setTimeout> | undefined;
  private lastIdleAt = NOW();
  private lastFpsUpdate = 0;
  saveStatus = '';

  constructor() {
    const settings = readSettings();
    const saved = readSave();
    const caps = detectCapabilities(
      navigator,
      typeof matchMedia === 'function' ? (query: string) => matchMedia(query) : null,
      {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      },
    );
    const game = saved?.state ?? createNewGame('medium', Math.floor(Math.random() * 0xffffffff), NOW());
    const layout = resolveLayout(settings.layout, caps);
    const manual = settings.quality === 'auto' ? null : settings.quality;
    this.state = {
      page: 'galaxy',
      game,
      settings: saved ? saved.settings : settings,
      camera: { x: 0, y: 0, zoom: 1 },
      selectedId: null,
      hoverId: null,
      particles: [],
      toasts: [],
      inputLog: [],
      saveStatus: saved ? 'loaded' : 'new game',
      lastSavedAt: saved?.savedAt ?? 0,
      sessionOrigin: saved ? 'loaded' : 'new game',
      caps,
      layout,
      budget: qualityBudget(manual ?? 'high', caps.eink),
      adaptiveLevel: manual ?? 'high',
      manualQuality: manual,
      perfVisible: settings.showPerf,
      devVisible: false,
      sample: this.monitor.sample(),
      stats: { entities: 0, particles: 0, drawCalls: 0, updateMs: 0, renderMs: 0 },
      fpsHistory: [],
      gamepad: { connected: false, id: '', buttons: [] },
      paused: game.paused,
      modal: null,
      contextMenu: null,
    };
    if (manual) this.adaptive.override(manual);
    if (settings.layout !== 'auto') {
      this.state.layout = resolveLayout(settings.layout, caps);
    }
    if (!saved) this.persist('new game');
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const listener of this.listeners) listener();
  }

  /* ------------------------------ navigation ------------------------------ */

  navigate(page: PageId): void {
    this.state.page = page;
    this.state.contextMenu = null;
    this.emit();
  }

  /* -------------------------------- game --------------------------------- */

  harvestBody(bodyId: number): void {
    const result = harvest(this.state.game, bodyId);
    this.state.game = result.state;
    if (!result.ok) {
      if (result.reason === 'depleted') this.toast('Deposit exhausted', 'warn');
      else if (result.reason === 'out-of-range') this.toast('Out of scanner range', 'warn');
      return;
    }
    const gained = `${result.gained.energy > 0 ? `+${result.gained.energy} energy ` : ''}${
      result.gained.mineral > 0 ? `+${result.gained.mineral} mineral ` : ''
    }${result.gained.science > 0 ? `+${result.gained.science} science` : ''}`.trim();
    if (gained) this.toast(gained, 'info');
    this.spawnBurst(result.body);
    this.queueSave();
    this.emit();
  }

  scan(bodyId: number | null): void {
    const targetId = bodyId ?? this.state.selectedId;
    if (targetId === null) {
      this.toast('No target selected', 'warn');
      return;
    }
    const before = this.state.game;
    const result = scanBody(before, targetId);
    if (!result.ok) {
      this.toast(before.galaxy.bodies[targetId]?.scanned ? 'Already scanned' : 'Out of range', 'warn');
      return;
    }
    this.state.game = result.state;
    this.toast(`Scanned ${result.body?.name ?? 'target'}`, 'info');
    this.queueSave();
    this.emit();
  }

  buy(id: UpgradeId): void {
    const result = buyUpgrade(this.state.game, id);
    if (!result.ok) {
      this.toast(result.reason === 'max-level' ? 'Already max level' : 'Not enough resources', 'warn');
      return;
    }
    this.state.game = result.state;
    this.toast(`${id} upgraded`, 'info');
    this.queueSave();
    this.emit();
  }

  repair(): void {
    const result = repairHull(this.state.game);
    if (!result.ok) {
      this.toast(result.cost === 0 ? 'Hull already intact' : `Need ${result.cost} mineral`, 'warn');
      return;
    }
    this.state.game = result.state;
    this.toast(`Hull repaired (-${result.cost} mineral)`, 'info');
    this.queueSave();
    this.emit();
  }

  togglePause(): void {
    this.state.paused = !this.state.paused;
    this.state.game = { ...this.state.game, paused: this.state.paused };
    this.toast(this.state.paused ? 'Paused' : 'Resumed', 'info');
    this.emit();
  }

  restart(scale: GalaxyScale): void {
    const seed = Math.floor(Math.random() * 0xffffffff);
    this.state.game = createNewGame(scale, seed, NOW());
    this.state.paused = false;
    this.state.selectedId = null;
    this.state.particles = [];
    this.state.camera = { x: 0, y: 0, zoom: 1 };
    this.monitor.reset();
    this.state.sessionOrigin = 'new game';
    clearSave();
    this.persist(`new ${scale} galaxy`);
    this.emit();
  }

  expand(scale: GalaxyScale): void {
    if (scale === this.state.game.galaxy.scale) {
      this.toast('Already exploring this scale', 'warn');
      return;
    }
    const seed = Math.floor(Math.random() * 0xffffffff);
    this.state.game = expandGalaxy(this.state.game, scale, seed);
    this.state.selectedId = null;
    this.state.particles = [];
    this.state.camera = { x: 0, y: 0, zoom: 1 };
    this.toast(`Galaxy expanded: ${scale}`, 'info');
    this.queueSave();
    this.emit();
  }

  selectAt(galaxyPoint: { x: number; y: number }, radius: number): Body | null {
    const body = pickBodyAt(this.state.game, galaxyPoint, radius);
    this.state.selectedId = body?.id ?? null;
    this.emit();
    return body;
  }

  selectBody(id: number | null): void {
    this.state.selectedId = id;
    this.emit();
  }

  currentBody(): Body | null {
    const id = this.state.selectedId;
    if (id === null) return null;
    return this.state.game.galaxy.bodies[id] ?? null;
  }

  visibleBodies(): Body[] {
    return revealedBodies(this.state.game.galaxy, this.state.game.upgrades.scanner);
  }

  /* ------------------------------- runtime ------------------------------- */

  /** Called from the rAF loop with the DOMHighResTimeStamp. */
  frame(timestamp: number, dtMs: number): void {
    this.monitor.push(timestamp);
    const sample = this.monitor.sample();
    this.state.sample = sample;
    this.state.fpsHistory = this.monitor.history();

    if (this.state.manualQuality === null) {
      const level = this.adaptive.sample(sample.avgFrameMs);
      if (level !== this.state.adaptiveLevel) {
        this.state.adaptiveLevel = level;
        this.state.budget = qualityBudget(level, this.state.caps.eink);
        if (this.state.settings.particles === false) {
          this.state.budget = { ...this.state.budget, particles: 0 };
        }
        this.toast(
          level === 'low'
            ? 'Adaptive quality: low (frame time > 40 ms)'
            : level === 'medium'
              ? 'Adaptive quality: medium'
              : 'Adaptive quality: high',
          'warn',
        );
        this.emit();
      }
    }

    if (!this.state.paused) {
      this.state.particles = advanceParticles(this.state.particles, dtMs, this.state.budget);
      const now = NOW();
      const idleDt = now - this.lastIdleAt;
      if (idleDt >= 1000) {
        this.lastIdleAt = now;
        this.state.game = idleTick(this.state.game, idleDt);
        this.state.game.stats.playTimeMs += idleDt;
        const risk = rollRisk(this.state.game, riskRng(this.state.game));
        if (risk) {
          this.state.game = risk.state;
          this.toast(
            `${risk.event.title}: ${risk.event.hullDelta} hull${Object.entries(risk.event.resourcesDelta)
              .map(([key, value]) => `, ${value > 0 ? '+' : ''}${value} ${key}`)
              .join('')}`,
            risk.event.hullDelta <= -10 ? 'bad' : 'warn',
          );
          this.queueSave();
          this.emit();
        }
      }
      this.state.game.stats.travelDistance =
        this.state.game.stats.travelDistance + Math.hypot(this.state.camera.x, this.state.camera.y) * 0.001;
    }

    if (timestamp - this.lastFpsUpdate > 900) {
      this.lastFpsUpdate = timestamp;
      if (sample.avgFps > this.state.game.stats.peakFps && sample.avgFps < 240) {
        this.state.game.stats.peakFps = Math.round(sample.avgFps * 10) / 10;
      }
      const previous = this.state.game.stats.avgFps;
      this.state.game.stats.avgFps =
        previous === 0 ? Math.round(sample.avgFps * 10) / 10 : Math.round((previous * 0.85 + sample.avgFps * 0.15) * 10) / 10;
    }
  }

  /** Set by the settings screen: returns true when it consumed a rebind press. */
  onGamepadButton: ((button: number) => boolean) | null = null;

  /** Set by main.ts after the input router exists. */
  router: InputRouter | null = null;

  /** Injects a synthetic pad through the real polling path (probe parity). */
  injectGamepadProbe = (): void => {
    this.router?.simulateGamepadButton(0);
  };

  recordCost(stats: DrawStats): void {
    this.cost.record(stats);
    this.state.stats = {
      entities: stats.entities,
      particles: stats.particles,
      drawCalls: stats.drawCalls,
      updateMs: this.cost.avgUpdate(),
      renderMs: this.cost.avgRender(),
    };
  }

  spawnBurst(body: Body | null): void {
    if (!body || this.state.budget.particles === 0) return;
    const count = Math.min(48, Math.round(this.state.budget.particles / 20) + 4);
    let seed = body.seed >>> 0;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const particles: Particle[] = Array.from({ length: count }, () => {
      const angle = random() * Math.PI * 2;
      const speed = 0.02 + random() * 0.07;
      return {
        x: body.x,
        y: body.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 700 + random() * 500,
        maxLife: 1200,
        kind: 'spark',
      };
    });
    this.state.particles = [...this.state.particles, ...particles].slice(-this.state.budget.particles);
  }

  /* -------------------------------- camera ------------------------------- */

  pan(dx: number, dy: number): void {
    const scale = this.state.layout.id === 'desktop' ? 0.0016 : 0.0022;
    this.state.camera = {
      ...this.state.camera,
      x: this.state.camera.x - (dx * scale) / this.state.camera.zoom,
      y: this.state.camera.y - (dy * scale) / this.state.camera.zoom,
    };
    this.emit();
  }

  zoomAt(factor: number): void {
    this.state.camera = {
      ...this.state.camera,
      zoom: Math.max(0.45, Math.min(3.4, this.state.camera.zoom * factor)),
    };
    this.emit();
  }

  resetView(): void {
    this.state.camera = { x: 0, y: 0, zoom: 1 };
    this.emit();
  }

  /* ------------------------------- settings ------------------------------ */

  updateSettings(patch: Partial<Settings>): void {
    this.state.settings = { ...this.state.settings, ...patch };
    writeSettings(this.state.settings);
    if (patch.layout) this.state.layout = resolveLayout(patch.layout, this.state.caps);
    if (patch.quality) {
      this.state.manualQuality = patch.quality === 'auto' ? null : patch.quality;
      this.state.adaptiveLevel = this.state.manualQuality ?? this.state.adaptiveLevel;
      if (this.state.manualQuality) this.adaptive.override(this.state.manualQuality);
      this.state.budget = qualityBudget(this.state.adaptiveLevel, this.state.caps.eink);
    }
    if (patch.particles !== undefined) {
      this.state.budget = { ...this.state.budget, particles: patch.particles ? qualityBudget(this.state.adaptiveLevel, this.state.caps.eink).particles : 0 };
    }
    if (patch.showPerf !== undefined) this.state.perfVisible = patch.showPerf;
    if (patch.gamepadMap) this.state.settings = { ...this.state.settings, gamepadMap: patch.gamepadMap };
    this.applyDocumentFlags();
    this.queueSave();
    this.emit();
  }

  setQuality(level: QualityLevel | null, trigger: string): void {
    this.state.manualQuality = level;
    if (level) {
      this.adaptive.override(level);
      this.state.adaptiveLevel = level;
    }
    this.state.budget = qualityBudget(this.state.adaptiveLevel, this.state.caps.eink);
    if (this.state.settings.particles === false) {
      this.state.budget = { ...this.state.budget, particles: 0 };
    }
    this.state.particles = this.state.particles.slice(0, this.state.budget.particles);
    this.state.settings = { ...this.state.settings, quality: level ?? 'auto' };
    writeSettings(this.state.settings);
    this.toast(`Quality ${level ?? `auto (${this.state.adaptiveLevel})`} · ${trigger}`, 'info');
    this.emit();
  }

  applyDocumentFlags(): void {
    const html = document.documentElement;
    html.dataset.theme = this.state.settings.theme;
    html.dataset.layout = this.state.layout.id;
    html.dataset.quality = this.state.adaptiveLevel;
    html.dataset.anim = this.state.settings.animations ? 'on' : 'off';
  }

  refreshLayout(): void {
    const caps = detectCapabilities(
      navigator,
      typeof matchMedia === 'function' ? (query: string) => matchMedia(query) : null,
      { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
    );
    this.state.caps = caps;
    this.state.layout = resolveLayout(this.state.settings.layout, caps);
    this.applyDocumentFlags();
    this.emit();
  }

  /* -------------------------------- misc --------------------------------- */

  toast(text: string, tone: Toast['tone'] = 'info'): void {
    this.toastSeq += 1;
    const toast: Toast = { id: this.toastSeq, text, tone, at: NOW() };
    this.state.toasts = [...this.state.toasts.slice(-3), toast];
    setTimeout(() => {
      this.state.toasts = this.state.toasts.filter((candidate) => candidate.id !== toast.id);
      this.emit();
    }, 2600);
  }

  /**
   * Input logging is high frequency. Listeners update just the debug panel; the
   * full screen is never rebuilt here, or a pointerup during a tap would tear
   * down the pressed button before its click event fired.
   */
  logInput(entry: InputLogEntry): void {
    this.state.inputLog = [...this.state.inputLog.slice(-60), entry];
    for (const listener of this.inputListeners) listener();
  }

  onInputLog(listener: () => void): () => void {
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  achievements() {
    return evaluateAchievements(this.state.game, { peakFps: this.state.game.stats.peakFps });
  }

  score(): { value: number; label: string } {
    const value = rating(this.state.game);
    return { value, label: ratingLabel(value) };
  }

  queueSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persist('autosave'), 600);
  }

  persist(reason: string): void {
    const outcome = writeSave(this.state.game, this.state.settings);
    this.state.saveStatus = `${outcome.status}${outcome.bytes ? ` · ${(outcome.bytes / 1024).toFixed(1)} KB` : ''} · ${reason}`;
    this.state.lastSavedAt = outcome.at;
    appendHistory({
      at: outcome.at,
      score: this.score().value,
      fps: Math.round(this.state.sample.avgFps),
      bodies: this.state.game.galaxy.bodies.length,
    });
    clearTimeout(this.mirrorTimer);
    this.mirrorTimer = setTimeout(() => {
      void mirrorSave(this.state.game, this.state.settings);
    }, 1200);
    this.emit();
  }

  async restoreFromMirror(): Promise<void> {
    const mirror = await readMirror();
    if (!mirror) {
      this.toast('No IndexedDB mirror found', 'warn');
      return;
    }
    this.state.game = mirror.state;
    this.state.settings = mirror.settings;
    this.applyDocumentFlags();
    this.state.sessionOrigin = 'mirror';
    this.state.saveStatus = `restored from IndexedDB mirror · ${new Date(mirror.savedAt).toLocaleTimeString()}`;
    this.toast('Restored from IndexedDB mirror', 'info');
    this.emit();
  }

  wipeSave(): void {
    clearSave();
    this.state.saveStatus = 'localStorage cleared';
    this.state.sessionOrigin = 'new game';
    this.toast('Save cleared', 'warn');
    this.emit();
  }
}
