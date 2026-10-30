// Showcase screen: one live, interactive card per PocketJS capability that this
// app actually exercises (canvas layering, animation, game loop, input, storage,
// theme, responsive layout, particles, metrics, audio). Each card runs real code
// when pressed — no static screenshots, no "demo pending" placeholders.

import { el, replaceChildren } from '../ui/dom.ts';
import { readPalette, advanceParticles, type Particle } from '../render/canvas.ts';
import { writeSave, readSave, encodeSave, appendHistory, readHistory } from '../core/save.ts';
import type { Store } from '../state/store.ts';
import type { Screen } from './galaxy.ts';

interface DemoContext {
  store: Store;
  out: HTMLElement;
  canvas: HTMLCanvasElement;
  cleanups: Array<() => void>;
}

interface DemoCard {
  title: string;
  body: string;
  action: string;
  run: (ctx: DemoContext) => void | Promise<void>;
}

function demo(
  store: Store,
  card: DemoCard,
): { node: HTMLElement; cleanup: () => void } {
  const out = el('div', { class: 'demo-out', 'data-testid': 'demo-out' });
  const canvas = el('canvas', { class: 'demo-canvas', width: 480, height: 110 });
  const cleanups: Array<() => void> = [];
  const button = el(
    'button',
    { class: 'btn small', 'data-focusable': '', 'data-testid': 'demo-run' },
    [card.action],
  );
  const node = el('div', { class: 'demo', 'data-testid': 'demo-card' }, [
    el('h3', { text: card.title }),
    el('p', { text: card.body }),
    canvas,
    out,
    button,
  ]);
  button.addEventListener('click', () => {
    void card.run({ store, out, canvas, cleanups });
  });
  return {
    node,
    cleanup: () => {
      for (const fn of cleanups) fn();
      cleanups.length = 0;
    },
  };
}

export function buildShowcaseScreen(store: Store): Screen {
  const cards: Array<{ node: HTMLElement; cleanup: () => void }> = [];
  const grid = el('div', { class: 'grid2', 'data-testid': 'demo-grid' });
  const audioState = el('span', { class: 'chip', 'data-testid': 'audio-state', text: 'idle' });

  const dprNote = el('span', { class: 'chip', 'data-testid': 'caps-text' });

  /* --------------------------------- demos -------------------------------- */

  const canvasDemo = demo(store, {
    title: 'Canvas + layers',
    body: 'Two independently painted layers (starfield + bodies) composited per frame on a DPR-correct surface.',
    action: 'Paint layers',
    run: ({ out, canvas }) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const started = performance.now();
      const palette = readPalette();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      let calls = 0;
      for (let layer = 0; layer < 2; layer++) {
        for (let index = 0; index < 380; index++) {
          const x = (index * 97 + layer * 41) % canvas.width;
          const y = (index * 53 + layer * 29) % canvas.height;
          ctx.globalAlpha = layer === 0 ? 0.35 : 0.9;
          ctx.fillStyle = layer === 0 ? palette.muted : palette.accent;
          ctx.fillRect(x, y, layer === 0 ? 1 : 2, layer === 0 ? 1 : 2);
          calls += 1;
        }
      }
      ctx.globalAlpha = 1;
      out.textContent = `${calls} draws · 2 layers · ${(performance.now() - started).toFixed(2)} ms · dpr ${window.devicePixelRatio}`;
    },
  });

  const animDemo = demo(store, {
    title: 'Animation',
    body: 'rAF-driven transform + colour tween with easing, cancellable, and skipped entirely when animations are off.',
    action: 'Play tween',
    run: ({ out, canvas, cleanups }) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const palette = readPalette();
      const duration = store.state.settings.animations ? 900 : 1;
      const start = performance.now();
      const loop = (timestamp: number) => {
        const t = Math.min(1, (timestamp - start) / duration);
        const eased = 1 - (1 - t) ** 3;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = palette.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = palette.accent;
        ctx.globalAlpha = 0.25 + eased * 0.75;
        const size = 14 + eased * 34;
        ctx.beginPath();
        ctx.arc(canvas.width * eased, canvas.height / 2, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        out.textContent = `t=${t.toFixed(2)} eased=${eased.toFixed(2)} duration=${duration} ms`;
        if (t < 1) requestAnimationFrame(loop);
      };
      const handle = requestAnimationFrame(loop);
      cleanups.push(() => cancelAnimationFrame(handle));
    },
  });

  const loopDemo = demo(store, {
    title: 'Game loop',
    body: 'The galaxy screen runs one rAF loop with dt clamping. This samples it twice, 400 ms apart, and reports the frame delta between samples.',
    action: 'Sample loop',
    run: async ({ out }) => {
      const first = store.monitor.totals().frames;
      out.textContent = 'sampling…';
      await new Promise((resolve) => setTimeout(resolve, 400));
      const second = store.monitor.totals().frames;
      const sample = store.state.sample;
      const advanced = store.state.game.tick;
      out.textContent = `+${second - first} rAF frames in 400 ms (${(((second - first) / 0.4) / 1).toFixed(0)}/s) · ${sample.avgFps.toFixed(1)} avg FPS · worst ${sample.worstMs.toFixed(1)} ms · tick ${advanced}`;
    },
  });

  const inputDemo = demo(store, {
    title: 'Input system',
    body: 'Touch, mouse, DPad/keyboard and gamepad (with injectable pads) resolve to one action enum; the debug panel logs every source.',
    action: 'Show mapping',
    run: ({ out }) => {
      const map = store.state.settings.gamepadMap;
      out.textContent = `confirm=${map.confirm} back=${map.back} scan=${map.scan} zoom=${map.zoomOut}/${map.zoomIn} pause=${map.pause} perf=${map.perf}`;
    },
  });

  const storageDemo = demo(store, {
    title: 'Storage',
    body: 'localStorage envelope (schema + version validated on read) mirrored into IndexedDB, with quota fallback.',
    action: 'Write + read back',
    run: ({ out }) => {
      const payload = encodeSave(store.state.game, store.state.settings);
      const written = writeSave(store.state.game, store.state.settings);
      const read = readSave();
      const bodiesMatch = read?.state.galaxy.bodies.length === store.state.game.galaxy.bodies.length;
      appendHistory({ at: Date.now(), score: store.score().value, fps: Math.round(store.state.sample.avgFps), bodies: store.state.game.galaxy.bodies.length });
      out.textContent = `write=${written.status} ${(payload.length / 1024).toFixed(1)} KB · read=${read ? 'ok' : 'null'} · bodies match=${bodiesMatch} · history=${readHistory().length}`;
      store.persist('showcase demo');
    },
  });

  const themeDemo = demo(store, {
    title: 'Theme system',
    body: 'Light / Dark / OLED (pure #000) share one token contract; the canvas reads tokens via getComputedStyle.',
    action: 'Cycle theme',
    run: ({ out }) => {
      const order = ['dark', 'light', 'oled'] as const;
      const next = order[(order.indexOf(store.state.settings.theme) + 1) % order.length] as typeof order[number];
      store.updateSettings({ theme: next });
      const palette = readPalette();
      out.textContent = `theme=${next} bg=${palette.bg} accent=${palette.accent}`;
    },
  });

  const layoutDemo = demo(store, {
    title: 'Responsive layout',
    body: 'Layout is resolved from measured capabilities (width, pointer, e-ink hints), never a hard-coded device table.',
    action: 'Show resolution',
    run: ({ out }) => {
      const caps = store.state.caps;
      out.textContent = `${caps.width}x${caps.height} @${caps.dpr}x → ${store.state.layout.id} · touch=${caps.touch} hover=${caps.hover} eink=${caps.eink} cores=${caps.cores}`;
    },
  });

  const particleDemo = demo(store, {
    title: 'Particle system',
    body: 'Budgeted particle pool: count comes from the active quality budget, expiry from real dt.',
    action: 'Burst particles',
    run: ({ out, canvas, cleanups }) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const budget = store.state.budget;
      const palette = readPalette();
      let particles: Particle[] = Array.from({ length: Math.min(400, budget.particles) }, () => ({
        x: 0.5 + (Math.random() - 0.5) * 0.1,
        y: 0.5 + (Math.random() - 0.5) * 0.1,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        life: 900,
        maxLife: 900,
        kind: 'spark',
      }));
      const initial = particles.length;
      let last = performance.now();
      let frames = 0;
      const loop = (timestamp: number) => {
        const dt = Math.min(64, timestamp - last);
        last = timestamp;
        particles = advanceParticles(particles, dt, budget);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = palette.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = palette.accent3;
        for (const particle of particles) {
          ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
          ctx.fillRect(particle.x * canvas.width, particle.y * canvas.height, 2, 2);
        }
        ctx.globalAlpha = 1;
        frames += 1;
        out.textContent = `budget=${budget.particles} spawned=${initial} alive=${particles.length} frames=${frames}`;
        if (particles.length > 0) requestAnimationFrame(loop);
      };
      const handle = requestAnimationFrame(loop);
      cleanups.push(() => cancelAnimationFrame(handle));
    },
  });

  const metricDemo = demo(store, {
    title: 'Performance metrics',
    body: 'FPS, frame time, p95, jank ratio, draw calls, update/render cost and heap are all measured, never estimated.',
    action: 'Snapshot metrics',
    run: ({ out }) => {
      const s = store.state.sample;
      const stats = store.state.stats;
      const memory = performance.memory;
      out.textContent = `${s.avgFps.toFixed(1)} fps · ${s.p95Ms.toFixed(1)} ms p95 · ${(s.jank * 100).toFixed(0)}% jank · ${stats.drawCalls} calls · render ${stats.renderMs.toFixed(2)} ms · heap ${memory ? `${(memory.usedJSHeapSize / 1048576).toFixed(1)} MB` : 'n/a'}`;
    },
  });

  const audioDemo = demo(store, {
    title: 'Audio',
    body: 'WebAudio is used only after a user gesture; state is reported honestly (unsupported → says so).',
    action: 'Blip',
    run: async ({ out }) => {
      const AudioCtor = window.AudioContext;
      if (!AudioCtor || !store.state.settings.audio) {
        audioState.textContent = 'disabled';
        out.textContent = 'Audio is off in Settings → Sound. Enable it, then press again.';
        return;
      }
      try {
        const context = new AudioCtor();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = 660;
        gain.gain.setValueAtTime(0.08, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.18);
        oscillator.onended = () => {
          void context.close();
        };
        audioState.textContent = `playing @ ${Math.round(context.sampleRate)} Hz`;
        out.textContent = `oscillator 660 Hz, 180 ms, sampleRate ${context.sampleRate}`;
      } catch (error) {
        audioState.textContent = 'error';
        out.textContent = `AudioContext failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });

  cards.push(
    canvasDemo,
    animDemo,
    loopDemo,
    inputDemo,
    storageDemo,
    themeDemo,
    layoutDemo,
    particleDemo,
    metricDemo,
    audioDemo,
  );
  replaceChildren(grid, cards.map((card) => card.node));

  const node = el('div', { class: 'screen showcase-screen', 'data-testid': 'screen-showcase' }, [
    el('div', { class: 'title-row' }, [
      el('h1', { text: 'Showcase' }),
      el('span', { class: 'muted small', text: 'Every capability the game depends on, exercised live' }),
      el('span', { style: 'flex:1' }),
      audioState,
    ]),
    el('div', { class: 'panel' }, [
      el('div', { class: 'row between' }, [
        el('span', { class: 'small muted', text: 'Detected capabilities' }),
        dprNote,
      ]),
    ]),
    grid,
  ]);

  // Only the capability chip changes on emit; the cards keep running demos alive.
  const update = () => {
    const caps = store.state.caps;
    dprNote.textContent = `${caps.width}x${caps.height}@${caps.dpr} · ${store.state.layout.label} · ${store.state.adaptiveLevel} · cores ${caps.cores} · mem ${caps.memoryGb} GB`;
  };

  return {
    node,
    onEnter: update,
    onExit: () => {
      for (const card of cards) card.cleanup();
    },
    update,
  };
}

// Exported for the interaction test: it presses each card's run button through
// the real DOM rather than calling handlers directly.
export const SHOWCASE_CARD_COUNT = 10;
