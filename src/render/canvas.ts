// Canvas renderer for the galaxy map. Reads theme colours from CSS custom
// properties so light/dark/OLED/e-ink all render correctly, and every visual
// effect (glow, trails, particles, shadows) is gated by the quality budget.

import type { Body, BodyKind, Galaxy } from '../core/types.ts';
import { distanceFromCore, scannerReach } from '../core/galaxy.ts';
import type { QualityBudget } from '../core/device.ts';

export interface ThemePalette {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
  accent3: string;
  border: string;
}

export function readPalette(root: HTMLElement = document.documentElement): ThemePalette {
  const style = getComputedStyle(root);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    bg: read('--bg-deep', '#070a10'),
    fg: read('--fg', '#e8eef8'),
    muted: read('--muted', '#8fa0b8'),
    accent: read('--accent', '#6ee7ff'),
    accent2: read('--accent-2', '#a78bfa'),
    accent3: read('--accent-3', '#fbbf24'),
    border: read('--border', '#24304a'),
  };
}

const KIND_COLOR_FALLBACK: Record<BodyKind, string> = {
  star: '#fbbf24',
  planet: '#6ee7ff',
  asteroid: '#8fa0b8',
  comet: '#7dd3fc',
  blackhole: '#a78bfa',
  nebula: '#c084fc',
  ruins: '#f9a8d4',
};

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  kind: ParticleKind;
}

export type ParticleKind = 'spark' | 'dust' | 'warp';

export interface SceneInput {
  galaxy: Galaxy;
  scannerLevel: number;
  camera: Camera;
  selectedId: number | null;
  hoverId: number | null;
  particles: Particle[];
  budget: QualityBudget;
  palette: ThemePalette;
  timeMs: number;
  showAll: boolean;
  panHint: { x: number; y: number } | null;
}

export interface SceneStats {
  entities: number;
  particles: number;
  drawCalls: number;
  renderMs: number;
}

export class GalaxyRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private stars: Array<{ x: number; y: number; r: number; a: number }> = [];
  private starfieldSeed = -1;
  private starfieldCount = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('2D canvas context unavailable');
    this.ctx = context;
  }

  resize(width: number, height: number, dpr: number): void {
    const nextDpr = Math.min(3, Math.max(1, dpr));
    const pixelWidth = Math.max(1, Math.round(width * nextDpr));
    const pixelHeight = Math.max(1, Math.round(height * nextDpr));
    if (pixelWidth === this.canvas.width && pixelHeight === this.canvas.height && nextDpr === this.dpr) {
      this.width = width;
      this.height = height;
      return;
    }
    this.width = width;
    this.height = height;
    this.dpr = nextDpr;
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    this.starfieldSeed = -1;
  }

  /** Galaxy-space → CSS-pixel transform for hit testing in the UI layer. */
  project(galaxyPoint: { x: number; y: number }, camera: Camera): { x: number; y: number } {
    const scale = (Math.min(this.width, this.height) / 2.35) * camera.zoom;
    return {
      x: this.width / 2 + (galaxyPoint.x - camera.x) * scale,
      y: this.height / 2 + (galaxyPoint.y - camera.y) * scale,
    };
  }

  unproject(screenPoint: { x: number; y: number }, camera: Camera): { x: number; y: number } {
    const scale = (Math.min(this.width, this.height) / 2.35) * camera.zoom;
    return {
      x: (screenPoint.x - this.width / 2) / scale + camera.x,
      y: (screenPoint.y - this.height / 2) / scale + camera.y,
    };
  }

  render(scene: SceneInput): SceneStats {
    const started = performance.now();
    const ctx = this.ctx;
    const { palette, budget, camera } = scene;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, this.width, this.height);

    let drawCalls = 1;
    drawCalls += this.drawStarfield(palette, budget, scene.timeMs, camera);

    const scale = (Math.min(this.width, this.height) / 2.35) * camera.zoom;
    const reach = scannerReach(scene.galaxy, scene.scannerLevel);
    const center = this.project({ x: 0, y: 0 }, camera);

    // Reach ring: the scanner boundary.
    if (budget.level !== 'low' || scene.galaxy.scale === 'small') {
      ctx.beginPath();
      ctx.arc(center.x, center.y, reach * scale, 0, Math.PI * 2);
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 1;
      ctx.setLineDash(budget.trails ? [6, 8] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      drawCalls += 1;
    }

    const visible: Body[] = [];
    for (const body of scene.galaxy.bodies) {
      if (!scene.showAll) {
        const distance = distanceFromCore(body);
        const reachable = body.scanned || distance <= reach;
        // Out-of-range bodies still render as faint dust so the galaxy reads as
        // a whole, but they are not selectable.
        if (!reachable && scene.galaxy.bodies.length > 900) continue;
      }
      const screen = this.project(body, camera);
      if (screen.x < -60 || screen.y < -60 || screen.x > this.width + 60 || screen.y > this.height + 60) continue;
      visible.push(body);
      if (visible.length >= budget.maxBodiesRendered) break;
    }

    for (const body of visible) {
      const screen = this.project(body, camera);
      const color = KIND_COLOR_FALLBACK[body.kind];
      const reachable = body.scanned || distanceFromCore(body) <= reach;
      const radius = Math.max(1.2, body.size * (camera.zoom * 0.5 + 0.6));
      const alpha = reachable ? 1 : 0.28;

      ctx.globalAlpha = alpha;
      if (body.kind === 'nebula') {
        if (budget.level === 'high' && budget.glow) {
          const gradient = ctx.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius * 2.4);
          gradient.addColorStop(0, `${color}55`);
          gradient.addColorStop(1, `${color}00`);
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, radius * 2.4, 0, Math.PI * 2);
          ctx.fill();
          drawCalls += 1;
        }
        ctx.fillStyle = `${color}2e`;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (body.kind === 'star') {
        if (budget.glow && budget.shadows) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 14;
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (body.kind === 'blackhole') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = palette.bg;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius * 0.72, 0, Math.PI * 2);
        ctx.fill();
      } else if (body.kind === 'asteroid') {
        ctx.fillStyle = color;
        ctx.fillRect(screen.x - radius * 0.45, screen.y - radius * 0.45, radius * 0.9, radius * 0.9);
      } else if (body.kind === 'comet') {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(screen.x + radius, screen.y);
        ctx.lineTo(screen.x - radius * 1.8, screen.y - radius * 0.7);
        ctx.lineTo(screen.x - radius * 1.8, screen.y + radius * 0.7);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
        ctx.fill();
        if (body.kind === 'ruins') {
          ctx.strokeStyle = palette.border;
          ctx.stroke();
        }
      }
      drawCalls += 1;

      if (body.discovered) {
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Selection + hover rings are drawn last so they are never occluded.
    const marker = (bodyId: number | null, color: string, pulse: boolean) => {
      if (bodyId === null) return;
      const body = scene.galaxy.bodies.find((candidate) => candidate.id === bodyId);
      if (!body) return;
      const screen = this.project(body, camera);
      const radius = Math.max(6, body.size * (camera.zoom * 0.5 + 0.6)) + 8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      if (pulse) ctx.globalAlpha = 0.6 + Math.sin(scene.timeMs / 260) * 0.35;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      drawCalls += 1;
    };
    marker(scene.hoverId, palette.muted, false);
    marker(scene.selectedId, palette.accent, budget.trails);

    drawCalls += this.drawParticles(scene, scale);

    if (scene.panHint) {
      ctx.strokeStyle = palette.accent;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(scene.panHint.x, scene.panHint.y);
      ctx.lineTo(scene.panHint.x + 18, scene.panHint.y);
      ctx.moveTo(scene.panHint.x, scene.panHint.y);
      ctx.lineTo(scene.panHint.x, scene.panHint.y + 18);
      ctx.stroke();
      ctx.globalAlpha = 1;
      drawCalls += 1;
    }

    // Vignette for depth, skipped when glow/shadows are off (low budget/e-ink).
    if (budget.glow && this.width > 300) {
      const gradient = ctx.createRadialGradient(
        this.width / 2,
        this.height / 2,
        Math.min(this.width, this.height) * 0.25,
        this.width / 2,
        this.height / 2,
        Math.max(this.width, this.height) * 0.75,
      );
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(1, `${palette.bg}cc`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.width, this.height);
      drawCalls += 1;
    }

    return {
      entities: visible.length,
      particles: scene.particles.length,
      drawCalls,
      renderMs: performance.now() - started,
    };
  }

  private drawStarfield(
    palette: ThemePalette,
    budget: QualityBudget,
    timeMs: number,
    camera: Camera,
  ): number {
    const count = budget.starfield;
    if (this.starfieldSeed !== count) {
      this.starfieldSeed = count;
      this.starfieldCount = count;
      let seed = 0x9e3779b9;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      this.stars = Array.from({ length: count }, () => ({
        x: random(),
        y: random(),
        r: 0.4 + random() * 1.2,
        a: 0.15 + random() * 0.5,
      }));
    }
    const ctx = this.ctx;
    ctx.fillStyle = palette.fg;
    const drift = (timeMs * 0.000004 * camera.zoom) % 1;
    for (const star of this.stars) {
      ctx.globalAlpha = star.a;
      const x = ((star.x - camera.x * 0.08 + drift) % 1 + 1) % 1 * this.width;
      const y = ((star.y - camera.y * 0.08) % 1 + 1) % 1 * this.height;
      ctx.fillRect(x, y, star.r, star.r);
    }
    ctx.globalAlpha = 1;
    return Math.ceil(this.stars.length / 120);
  }

  private drawParticles(scene: SceneInput, scale: number): number {
    const { particles, palette, budget } = scene;
    if (particles.length === 0) return 0;
    const ctx = this.ctx;
    let drawCalls = 0;
    for (const particle of particles) {
      const screen = this.project(particle, scene.camera);
      const alpha = Math.max(0, particle.life / particle.maxLife);
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle =
        particle.kind === 'spark'
          ? palette.accent3
          : particle.kind === 'warp'
            ? palette.accent2
            : palette.muted;
      const size = particle.kind === 'dust' ? 1 : 2.2;
      if (budget.trails && particle.kind === 'warp') {
        ctx.fillRect(screen.x - 1, screen.y - scale * 0.01, size, size * 2.4);
      } else {
        ctx.fillRect(screen.x, screen.y, size, size);
      }
      drawCalls += 1;
    }
    ctx.globalAlpha = 1;
    return Math.ceil(drawCalls / 40);
  }

  /** Fire a burst of harvest particles at a body's screen position. */
  static burst(
    body: Body,
    camera: Camera,
    renderer: GalaxyRenderer,
    budget: QualityBudget,
    rng: () => number,
  ): Particle[] {
    const count = Math.min(64, Math.round(budget.particles / 18) + 6);
    const origin = renderer.project(body, camera);
    return Array.from({ length: count }, () => {
      const angle = rng() * Math.PI * 2;
      const speed = 0.02 + rng() * 0.06;
      return {
        x: body.x,
        y: body.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 700 + rng() * 500,
        maxLife: 1200,
        kind: 'spark' as ParticleKind,
      };
    }).map((particle) => ({ ...particle, x: body.x, y: body.y }));
  }
}

/** Advances particles and drops the expired ones. dtMs is real elapsed time. */
export function advanceParticles(particles: Particle[], dtMs: number, budget: QualityBudget): Particle[] {
  if (particles.length === 0) return particles;
  const limit = Math.max(0, budget.particles);
  const next: Particle[] = [];
  for (const particle of particles) {
    const life = particle.life - dtMs;
    if (life <= 0) continue;
    next.push({
      ...particle,
      x: particle.x + particle.vx * dtMs * 0.001,
      y: particle.y + particle.vy * dtMs * 0.001,
      life,
    });
  }
  return next.length > limit ? next.slice(next.length - limit) : next;
}
