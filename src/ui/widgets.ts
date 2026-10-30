// Shared HUD widgets: performance overlay, toasts, modal, context menu.

import { el, replaceChildren } from './dom.ts';
import type { Store } from '../state/store.ts';
import { GAMEPAD_BUTTON_NAMES } from './input.ts';

export function buildPerfOverlay(store: Store): { node: HTMLElement; update: () => void } {
  const fpsValue = el('span', { class: 'v', 'data-testid': 'perf-fps' });
  const avgValue = el('span', { class: 'v' });
  const frameValue = el('span', { class: 'v' });
  const p95Value = el('span', { class: 'v' });
  const jankValue = el('span', { class: 'v' });
  const memValue = el('span', { class: 'v' });
  const entityValue = el('span', { class: 'v' });
  const particleValue = el('span', { class: 'v' });
  const drawValue = el('span', { class: 'v' });
  const updateValue = el('span', { class: 'v' });
  const renderValue = el('span', { class: 'v' });
  const qualityValue = el('span', { class: 'v' });
  const graph = el('canvas', { width: 200, height: 28, 'data-testid': 'perf-graph' });
  const ctx = graph.getContext('2d');

  const overlay = el('div', { class: 'perf-overlay', 'data-testid': 'perf-overlay' }, [
    el('header', {}, [el('span', { text: 'PERF' }), el('span', { text: 'SELECT / F' })]),
    el('div', { class: 'grid2' }, [
      el('span', { class: 'k', text: 'FPS' }),
      fpsValue,
      el('span', { class: 'k', text: 'Avg FPS' }),
      avgValue,
      el('span', { class: 'k', text: 'Frame' }),
      frameValue,
      el('span', { class: 'k', text: 'p95' }),
      p95Value,
      el('span', { class: 'k', text: 'Jank' }),
      jankValue,
      el('span', { class: 'k', text: 'Memory' }),
      memValue,
      el('span', { class: 'k', text: 'Entities' }),
      entityValue,
      el('span', { class: 'k', text: 'Particles' }),
      particleValue,
      el('span', { class: 'k', text: 'Draw calls' }),
      drawValue,
      el('span', { class: 'k', text: 'Update' }),
      updateValue,
      el('span', { class: 'k', text: 'Render' }),
      renderValue,
      el('span', { class: 'k', text: 'Quality' }),
      qualityValue,
    ]),
    graph,
  ]);

  const update = () => {
    const state = store.state;
    const sample = state.sample;
    fpsValue.textContent = sample.fps.toFixed(1);
    avgValue.textContent = sample.avgFps.toFixed(1);
    frameValue.textContent = `${sample.frameMs.toFixed(1)} ms`;
    p95Value.textContent = `${sample.p95Ms.toFixed(1)} ms`;
    jankValue.textContent = `${(sample.jank * 100).toFixed(0)}%`;
    const memory = readPerfMemory();
    memValue.textContent = memory;
    entityValue.textContent = String(state.stats.entities);
    particleValue.textContent = String(state.stats.particles);
    drawValue.textContent = String(state.stats.drawCalls);
    updateValue.textContent = `${state.stats.updateMs.toFixed(2)} ms`;
    renderValue.textContent = `${state.stats.renderMs.toFixed(2)} ms`;
    qualityValue.textContent = `${state.adaptiveLevel}${state.manualQuality ? ' (manual)' : ''}`;
    drawGraph();
  };

  const drawGraph = () => {
    if (!ctx) return;
    const width = graph.width;
    const height = graph.height;
    ctx.clearRect(0, 0, width, height);
    const history = store.state.fpsHistory;
    if (history.length < 2) return;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6ee7ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const step = width / Math.max(1, history.length - 1);
    history.forEach((fps, index) => {
      const x = index * step;
      const y = height - Math.min(1, Math.max(0, fps / 70)) * height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // 60 FPS reference line.
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#24304a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height - (60 / 70) * height);
    ctx.lineTo(width, height - (60 / 70) * height);
    ctx.stroke();
  };

  return { node: overlay, update };
}

/** Chromium exposes a heap estimate; other browsers return null and we say so. */
function readPerfMemory(): string {
  const memory = globalThis.performance.memory;
  if (!memory) return 'n/a';
  const used = memory.usedJSHeapSize / 1048576;
  const limit = memory.jsHeapSizeLimit / 1048576;
  return `${used.toFixed(1)}/${limit.toFixed(0)} MB`;
}

export function buildToasts(store: Store): { node: HTMLElement; update: () => void } {
  const stack = el('div', { class: 'toast-stack', 'aria-live': 'polite' });
  const update = () => {
    replaceChildren(
      stack,
      store.state.toasts.map((toast) =>
        el('div', { class: `toast ${toast.tone === 'info' ? '' : toast.tone}`, text: toast.text }),
      ),
    );
  };
  return { node: stack, update };
}

export function buildModal(store: Store): { node: HTMLElement; update: () => void } {
  const host = el('div');
  // The store emits about once per second (idle income, risk ticks). Rebuilding
  // an open dialog on those unrelated emits detaches the button under the
  // pointer and the click never lands, so the DOM is only rebuilt when the modal
  // identity actually changes.
  let rendered: Store['state']['modal'] = null;
  const update = () => {
    const modal = store.state.modal;
    if (!modal) {
      if (rendered !== null) {
        rendered = null;
        replaceChildren(host, []);
      }
      return;
    }
    if (modal === rendered && host.childElementCount > 0) return;
    rendered = modal;
    const close = () => {
      store.state.modal = null;
      store.emit();
    };
    replaceChildren(host, [
      el(
        'div',
        {
          class: 'modal-backdrop',
          onclick: (event) => {
            if (event.target === event.currentTarget) close();
          },
        },
        [
          el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': modal.title }, [
            el('h2', { text: modal.title }),
            el('p', { class: 'muted small', text: modal.body }),
            el(
              'div',
              { class: 'row', style: 'justify-content:flex-end;flex-wrap:wrap' },
              modal.actions.map((action, index) =>
                el(
                  'button',
                  {
                    class: `btn ${index === 0 ? 'primary' : 'ghost'}`,
                    'data-focusable': '',
                    'data-testid': `modal-${action.label.toLowerCase().replace(/\s+/g, '-')}`,
                    onclick: () => {
                      action.run();
                      close();
                    },
                  },
                  [action.label],
                ),
              ),
            ),
          ]),
        ],
      ),
    ]);
  };
  return { node: host, update };
}

export function buildContextMenu(store: Store): { node: HTMLElement; update: () => void } {
  const host = el('div');
  // Same reasoning as the modal: an open menu must survive unrelated emits.
  let rendered: Store['state']['contextMenu'] = null;
  const update = () => {
    const menu = store.state.contextMenu;
    if (!menu) {
      if (rendered !== null) {
        rendered = null;
        replaceChildren(host, []);
      }
      return;
    }
    if (menu === rendered && host.childElementCount > 0) return;
    rendered = menu;
    const close = () => {
      store.state.contextMenu = null;
      store.emit();
    };
    const body = menu.bodyId === null ? null : store.state.game.galaxy.bodies[menu.bodyId] ?? null;
    const items: Array<{ label: string; run: () => void }> = [];
    if (body) {
      items.push({ label: `Scan ${body.name} ${body.catalog}`, run: () => store.scan(body.id) });
      items.push({ label: `Harvest ${body.name} ${body.catalog}`, run: () => store.harvestBody(body.id) });
      items.push({ label: 'Show details', run: () => store.selectBody(body.id) });
    }
    items.push({ label: 'Recenter view', run: () => store.resetView() });
    items.push({ label: 'Toggle performance HUD', run: () => {
      store.state.perfVisible = !store.state.perfVisible;
      store.state.settings = { ...store.state.settings, showPerf: store.state.perfVisible };
      store.emit();
    } });
    const width = 210;
    const height = items.length * 40 + 10;
    const x = Math.min(menu.x, window.innerWidth - width - 8);
    const y = Math.min(menu.y, window.innerHeight - height - 8);
    replaceChildren(host, [
      el(
        'div',
        {
          class: 'context-menu',
          style: `left:${Math.max(8, x)}px;top:${Math.max(8, y)}px`,
          'data-testid': 'context-menu',
        },
        items.map((item) =>
          el(
            'button',
            {
              'data-focusable': '',
              onclick: () => {
                item.run();
                close();
              },
            },
            [item.label],
          ),
        ),
      ),
    ]);
    window.setTimeout(() => {
      const dismissed = () => {
        close();
        window.removeEventListener('pointerdown', dismissed);
      };
      window.addEventListener('pointerdown', dismissed, { once: true });
    }, 0);
  };
  return { node: host, update };
}

export function gamepadHint(store: Store): string {
  const pad = store.state.gamepad;
  if (!pad.connected) return 'No gamepad';
  return pad.id.length > 34 ? `${pad.id.slice(0, 34)}…` : pad.id;
}

export function buttonName(button: number): string {
  return GAMEPAD_BUTTON_NAMES[button] ?? `Button ${button}`;
}
