// Benchmark screen: fixed synthetic scenes (100…10,000 objects) rendered by the
// real canvas renderer, measured with real rAF timestamps, reported as text that
// can be pasted into an issue. Nothing is precomputed or stored as "expected".

import { el, replaceChildren } from '../ui/dom.ts';
import {
  BENCHMARK_DURATION_MS,
  BENCHMARK_SIZES,
  formatReport,
  runStep,
  summarize,
  type BenchmarkResult,
  type BenchmarkStep,
} from '../perf/benchmark.ts';
import { FrameMonitor, measurePreciseMemory } from '../perf/monitor.ts';
import { generateGalaxy } from '../core/galaxy.ts';
import { readPalette } from '../render/canvas.ts';
import { qualityBudget } from '../core/device.ts';
import type { Store } from '../state/store.ts';
import type { Screen } from './galaxy.ts';

interface SceneBody {
  x: number;
  y: number;
  r: number;
  hue: number;
}

function makeScene(count: number): SceneBody[] {
  const galaxy = generateGalaxy(count >= 2400 ? 'massive' : count >= 620 ? 'large' : 'medium', 0x5eed);
  // Repeat the generated distribution to hit exact counts (100…10000).
  return Array.from({ length: count }, (_, index) => {
    const source = galaxy.bodies[index % Math.max(1, galaxy.bodies.length)];
    const jitter = ((index * 2654435761) % 1000) / 1000 - 0.5;
    return {
      x: (source?.x ?? 0) + jitter * 0.01,
      y: (source?.y ?? 0) + jitter * 0.01,
      r: source?.size ?? 2,
      hue: (index * 37) % 360,
    };
  });
}

export function buildBenchmarkScreen(store: Store): Screen {
  const canvas = el('canvas', { 'data-testid': 'bench-canvas' });
  const ctx = canvas.getContext('2d');
  const progress = el('div', { class: 'bench-progress', 'data-testid': 'bench-progress', text: 'Ready' });
  const stage = el('div', { class: 'bench-stage' }, [canvas, progress]);
  const table = el('div', { 'data-testid': 'bench-table' });
  const reportArea = el('textarea', {
    class: 'report',
    'data-testid': 'bench-report',
    readonly: '',
    spellcheck: 'false',
  });
  const scoreChip = el('span', { class: 'chip on', 'data-testid': 'bench-rating', text: '—' });
  const runButton = el(
    'button',
    { class: 'btn primary', 'data-focusable': '', 'data-testid': 'bench-run' },
    ['Run benchmark'],
  );
  const copyButton = el(
    'button',
    { class: 'btn', 'data-focusable': '', 'data-testid': 'bench-copy', disabled: true },
    ['Copy report'],
  );
  const noteLine = el('p', { class: 'small muted', 'data-testid': 'bench-note' });

  const node = el('div', { class: 'screen bench-screen', 'data-testid': 'screen-benchmark' }, [
    el('div', { class: 'title-row' }, [
      el('h1', { text: 'Benchmark' }),
      el('span', { class: 'muted small', text: 'Six fixed scenes, real rAF timing, paste-ready report' }),
      el('span', { style: 'flex:1' }),
      scoreChip,
    ]),
    stage,
    el('div', { class: 'row' }, [runButton, copyButton, noteLine]),
    table,
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-title' }, [
        el('h2', { text: 'Paste-ready report' }),
        el('span', { class: 'tiny muted', text: 'Ctrl/Cmd+A then Ctrl/Cmd+C inside the box' }),
      ]),
      reportArea,
    ]),
  ]);

  const monitor = new FrameMonitor(240);
  let running = false;
  let result: BenchmarkResult | null = null;

  // CSS-pixel size of the drawing surface; the canvas is DPR-scaled underneath.
  let stageWidth = 0;
  let stageHeight = 0;

  const drawScene = (bodies: SceneBody[], objects: number, elapsed: number) => {
    if (!ctx) return;
    const width = stageWidth;
    const height = stageHeight;
    const palette = readPalette();
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, width, height);
    const scale = Math.min(width, height) / 2.15;
    const budget = qualityBudget('high', false);
    for (let index = 0; index < Math.min(objects, bodies.length); index++) {
      const body = bodies[index];
      if (!body) continue;
      const x = width / 2 + body.x * scale + Math.sin(elapsed / 1400 + index) * 2;
      const y = height / 2 + body.y * scale + Math.cos(elapsed / 1600 + index) * 2;
      ctx.fillStyle = `hsl(${body.hue} 80% 65%)`;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.8, body.r * 0.55), 0, Math.PI * 2);
      ctx.fill();
      if (budget.glow && index % 17 === 0) {
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(x, y, body.r * 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  };

  const renderTable = (steps: BenchmarkStep[]) => {
    replaceChildren(table, [
      el('table', { class: 'results' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Objects' }),
            el('th', { text: 'Frames' }),
            el('th', { text: 'Avg FPS' }),
            el('th', { text: 'Min FPS' }),
            el('th', { text: 'p95 ms' }),
            el('th', { text: 'Score' }),
          ]),
        ]),
        el(
          'tbody',
          {},
          steps.map((step) =>
            el('tr', { 'data-testid': `bench-row-${step.objects}` }, [
              el('td', { text: String(step.objects) }),
              el('td', { text: String(step.frames) }),
              el('td', { text: step.avgFps.toFixed(1) }),
              el('td', { text: step.minFps.toFixed(1) }),
              el('td', { text: step.p95FrameMs.toFixed(2) }),
              el('td', { text: String(step.score) }),
            ]),
          ),
        ),
      ]),
    ]);
  };

  const run = async () => {
    if (running) return;
    running = true;
    runButton.setAttribute('disabled', '');
    copyButton.setAttribute('disabled', '');
    const steps: BenchmarkStep[] = [];
    const startedAt = new Date().toISOString();
    for (const size of BENCHMARK_SIZES) {
      const bodies = makeScene(size);
      progress.textContent = `Running ${size.toLocaleString()} objects…`;
      // Yield once so the progress line paints before the measurement starts.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const step = await runStep(size, BENCHMARK_DURATION_MS, (objects, elapsed, index) => {
        drawScene(bodies, objects, elapsed + index);
      }, monitor);
      steps.push(step);
      progress.textContent = `${size.toLocaleString()} objects · ${step.avgFps.toFixed(1)} avg FPS · ${step.frames} frames`;
      renderTable([...steps]);
    }
    const precise = await measurePreciseMemory();
    const resultMeta = {
      version: 1 as const,
      startedAt,
      finishedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      dpr: window.devicePixelRatio || 1,
      hardware: {
        cores: navigator.hardwareConcurrency ?? 0,
        memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0,
      },
    };
    result = summarize(steps, resultMeta, precise.usedMb);
    scoreChip.textContent = `Rating ${result.rating} · ${result.galaxyScore}`;
    scoreChip.dataset.rating = result.rating;
    reportArea.value = formatReport(result);
    copyButton.removeAttribute('disabled');
    runButton.removeAttribute('disabled');
    progress.textContent = `Done · max stable ${result.maxStableObjects} objects · avg ${result.averageFps} FPS`;
    noteLine.textContent = result.notes.join(' ') || 'Measurements come from this browser session only.';
    running = false;
    store.emit();
  };

  runButton.addEventListener('click', () => {
    void run();
  });

  copyButton.addEventListener('click', async () => {
    const text = reportArea.value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      store.toast('Benchmark report copied', 'info');
    } catch {
      reportArea.focus();
      reportArea.select();
      store.toast('Clipboard blocked — text selected, press Ctrl+C', 'warn');
    }
  });

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    stageWidth = Math.max(1, rect.width);
    stageHeight = Math.max(1, rect.height);
    canvas.width = Math.max(1, Math.round(stageWidth * dpr));
    canvas.height = Math.max(1, Math.round(stageHeight * dpr));
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = readPalette().bg;
    ctx.fillRect(0, 0, stageWidth, stageHeight);
  };

  const onEnter = () => {
    resize();
    window.addEventListener('resize', resize);
    progress.textContent = result ? progress.textContent : 'Ready · press Run benchmark';
  };
  const onExit = () => {
    window.removeEventListener('resize', resize);
  };

  return { node, onEnter, onExit, update: () => undefined };
}
