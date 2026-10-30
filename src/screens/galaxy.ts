// Galaxy screen: canvas map + HUD + selection panel. One rAF loop lives here
// and is the only place that paints the map. DOM updates are throttled to 4 Hz
// so panning/zooming never rebuilds the survey list on every pointer event.

import { el, replaceChildren, formatDuration, formatNumber } from '../ui/dom.ts';
import { GalaxyRenderer, advanceParticles, readPalette, type SceneInput } from '../render/canvas.ts';
import type { Body, BodyKind, GalaxyScale } from '../core/types.ts';
import { BODY_LABELS } from '../core/game.ts';
import { GALAXY_SCALES, scannerReach } from '../core/galaxy.ts';
import { upgradeCost } from '../core/upgrades.ts';
import type { Store } from '../state/store.ts';
import { buildPerfOverlay } from '../ui/widgets.ts';

export interface Screen {
  node: HTMLElement;
  onEnter: () => void;
  onExit: () => void;
  update: () => void;
}

const KIND_COLORS: Record<BodyKind, string> = {
  star: 'var(--accent-3)',
  planet: 'var(--accent)',
  asteroid: 'var(--muted)',
  comet: 'var(--accent)',
  blackhole: 'var(--accent-2)',
  nebula: 'var(--accent-2)',
  ruins: 'var(--accent-3)',
};

export function buildGalaxyScreen(store: Store): Screen {
  const canvas = el('canvas', { 'data-testid': 'galaxy-canvas', 'aria-label': 'Galaxy map' });
  const renderer = new GalaxyRenderer(canvas);
  const hint = el('div', { class: 'map-hint', 'data-testid': 'map-hint' });
  const stage = el('div', { class: 'stage', 'data-testid': 'galaxy-stage', tabindex: '0' }, [canvas, hint]);
  const sideScroll = el('div', { class: 'side-scroll' });
  const side = el('div', { class: 'side' }, [sideScroll]);
  const node = el('div', { class: 'screen map-screen', 'data-testid': 'screen-galaxy' }, [stage, side]);
  const perf = buildPerfOverlay(store);
  node.append(perf.node);

  let frameId = 0;
  let lastFrame = 0;
  let running = false;
  let lastPaletteRefresh = 0;
  let lastUiUpdate = 0;
  let lastPaint = 0;
  let palette = readPalette();
  let paletteTheme = document.documentElement.dataset.theme ?? '';

  const onResize = () => {
    const rect = stage.getBoundingClientRect();
    renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
  };
  window.addEventListener('resize', onResize);

  const loop = (timestamp: number) => {
    if (!running) return;
    // Frame pacing: e-ink panels cannot refresh faster than ~10-20 Hz (60 Hz
    // repaint burns CPU and ghosts), and the low budget deliberately targets
    // 30 Hz. Skip a frame whenever the budget asks for more than 20 ms.
    const targetMs = store.state.budget.targetFrameMs;
    if (targetMs > 20 && timestamp - lastPaint < targetMs) {
      frameId = requestAnimationFrame(loop);
      return;
    }
    lastPaint = timestamp;
    store.monitor.setTargetFrameMs(store.state.budget.targetFrameMs);
    const rect = stage.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
      const dt = lastFrame === 0 ? 16.7 : Math.min(200, timestamp - lastFrame);
      lastFrame = timestamp;
      store.frame(timestamp, dt);

      // A theme switch must repaint with the new tokens on the very next frame;
      // the periodic refresh only catches external (OS-level) changes.
      const currentTheme = document.documentElement.dataset.theme ?? '';
      if (currentTheme !== paletteTheme || timestamp - lastPaletteRefresh > 1200) {
        palette = readPalette();
        paletteTheme = currentTheme;
        lastPaletteRefresh = timestamp;
      }

      const scene: SceneInput = {
        galaxy: store.state.game.galaxy,
        scannerLevel: store.state.game.upgrades.scanner,
        camera: store.state.camera,
        selectedId: store.state.selectedId,
        hoverId: store.state.hoverId,
        particles: store.state.particles,
        budget: store.state.budget,
        palette,
        timeMs: timestamp,
        showAll: store.state.game.galaxy.scale === 'small',
        panHint: null,
      };
      const stats = renderer.render(scene);
      store.recordCost({ ...stats, updateMs: dt });
      if (timestamp - lastUiUpdate > 250) {
        lastUiUpdate = timestamp;
        update();
      }
    }
    perf.node.style.display = store.state.perfVisible ? '' : 'none';
    if (store.state.perfVisible) perf.update();
    frameId = requestAnimationFrame(loop);
  };

  const toGalaxy = (clientX: number, clientY: number) => {
    const rect = stage.getBoundingClientRect();
    return renderer.unproject({ x: clientX - rect.left, y: clientY - rect.top }, store.state.camera);
  };

  canvas.addEventListener('pointermove', (event) => {
    if (event.buttons !== 0) return;
    const point = toGalaxy(event.clientX, event.clientY);
    const hit = store.state.game.galaxy.bodies.find(
      (body) => Math.hypot(body.x - point.x, body.y - point.y) < 0.045,
    );
    store.state.hoverId = hit?.id ?? null;
    canvas.style.cursor = hit ? 'pointer' : 'grab';
  });

  /** Tap/click resolution used by the input layer's gesture callback. */
  const pickAtClient = (clientX: number, clientY: number): Body | null => {
    const point = toGalaxy(clientX, clientY);
    const scale = (Math.min(stage.clientWidth, stage.clientHeight) / 2.35) * store.state.camera.zoom;
    const body = store.selectAt(point, Math.max(0.04, 22 / scale));
    if (body) store.toast(`${BODY_LABELS[body.kind]} · ${body.name}`, 'info');
    return body;
  };

  const galaxyscreenHandle = {
    stage,
    pickAtClient,
    renderer,
  };
  (node as HTMLElement & { galaxyHandle?: typeof galaxyscreenHandle }).galaxyHandle = galaxyscreenHandle;

  /* --------------------------------- HUD ---------------------------------- */

  const resEnergy = el('span', { class: 'value' });
  const resMineral = el('span', { class: 'value' });
  const resScience = el('span', { class: 'value' });
  const hullMeter = el('i', { style: 'width:100%' });
  const hullBar = el('div', { class: 'meter' }, [hullMeter]);
  const hullValue = el('span', { class: 'small mono', 'data-testid': 'hull-value' });
  const ratingValue = el('span', { class: 'mono', 'data-testid': 'rating-value' });
  const ratingChip = el('span', { class: 'chip on', 'data-testid': 'rating-chip' });
  const scoreMeter = el('i', { style: 'width:0%' });
  const scaleLabel = el('span', { class: 'small muted', 'data-testid': 'galaxy-scale-label' });
  const visibleCount = el('span', { class: 'small muted', 'data-testid': 'visible-count' });
  const bodyList = el('div', { class: 'list', 'data-testid': 'body-list' });
  const detail = el('div', { class: 'stack', 'data-testid': 'body-detail' });
  const feed = el('div', { class: 'feed' });
  const scaleRow = el('div', { class: 'seg scroll-x', 'data-testid': 'scale-seg' });
  const statRow = el('div', { class: 'grid2 small muted', 'data-testid': 'stat-row' });
  const saveChip = el('span', { class: 'chip', 'data-testid': 'save-status' });
  const saveOrigin = el('span', { class: 'chip', 'data-testid': 'save-origin' });

  replaceChildren(sideScroll, [
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-title' }, [el('h2', { text: 'Resources' }), el('div', { class: 'row' }, [saveOrigin, saveChip])]),
      el('div', { class: 'res-row' }, [
        el('div', { class: 'res energy' }, [el('div', { class: 'label', text: 'Energy' }), resEnergy]),
        el('div', { class: 'res mineral' }, [el('div', { class: 'label', text: 'Mineral' }), resMineral]),
        el('div', { class: 'res science' }, [el('div', { class: 'label', text: 'Science' }), resScience]),
      ]),
      el('div', { class: 'row between', style: 'margin-top:10px' }, [
        el('span', { class: 'small muted', text: 'Hull' }),
        hullValue,
      ]),
      hullBar,
    ]),
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-title' }, [el('h2', { text: 'Galaxy rating' }), ratingChip]),
      el('div', { class: 'row between' }, [ratingValue, scaleLabel]),
      el('div', { class: 'meter', style: 'margin-top:8px' }, [scoreMeter]),
      statRow,
    ]),
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-title' }, [
        el('h2', { text: 'Target' }),
        el('span', { class: 'small muted', text: 'A harvest · X scan' }),
      ]),
      detail,
    ]),
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-title' }, [el('h2', { text: 'Survey' }), visibleCount]),
      bodyList,
    ]),
    el('div', { class: 'panel' }, [el('h2', { text: 'Risk log' }), feed]),
    el('div', { class: 'panel' }, [el('h2', { text: 'Galaxy scale' }), scaleRow]),
  ]);

  // Built once; only the pressed state changes, so the row never loses focus.
  const scaleButtons = new Map<GalaxyScale, HTMLButtonElement>(
    (Object.keys(GALAXY_SCALES) as GalaxyScale[]).map((scale) => [
      scale,
      el(
        'button',
        {
          'data-focusable': '',
          'data-testid': `scale-${scale}`,
          onclick: () => store.expand(scale),
        },
        [`${GALAXY_SCALES[scale].label} · ${GALAXY_SCALES[scale].bodies}`],
      ),
    ]),
  );
  replaceChildren(scaleRow, [...scaleButtons.values()]);

  const syncScaleRow = () => {
    for (const [scale, button] of scaleButtons) {
      button.setAttribute('aria-pressed', String(store.state.game.galaxy.scale === scale));
    }
  };

  let detailSignature = '';

  const renderDetail = () => {
    const body = store.currentBody();
    const signature = body ? `${body.id}:${body.deposit}:${body.scanned}` : 'none';
    if (signature === detailSignature) return;
    detailSignature = signature;
    if (!body) {
      replaceChildren(detail, [
        el('p', { class: 'small muted', text: 'Tap a revealed body on the map, or pick one from the survey list.' }),
      ]);
      return;
    }
    const cost = upgradeCost('mining', store.state.game.upgrades.mining);
    const reach = scannerReach(store.state.game.galaxy, store.state.game.upgrades.scanner);
    const inRange = Math.hypot(body.x, body.y) <= reach || body.scanned;
    replaceChildren(detail, [
      el('div', { class: 'row between' }, [
        el('strong', { text: body.name, 'data-testid': 'detail-name' }),
        el('span', { class: 'chip', text: BODY_LABELS[body.kind] }),
      ]),
      el('div', { class: 'meter' }, [
        el('i', { style: `width:${(body.deposit / Math.max(1, body.capacity)) * 100}%` }),
      ]),
      el('div', { class: 'row between small muted' }, [
        el('span', { text: `Deposit ${body.deposit}/${body.capacity}` }),
        el('span', { text: inRange ? 'in range' : 'out of range' }),
      ]),
      el('div', { class: 'row', style: 'flex-wrap:wrap' }, [
        el(
          'button',
          {
            class: 'btn primary small',
            'data-focusable': '',
            'data-testid': 'harvest-btn',
            disabled: !inRange || body.deposit === 0,
            onclick: () => store.harvestBody(body.id),
          },
          ['Harvest'],
        ),
        el(
          'button',
          {
            class: 'btn small',
            'data-focusable': '',
            'data-testid': 'scan-btn',
            disabled: body.scanned,
            onclick: () => store.scan(body.id),
          },
          [body.scanned ? 'Scanned' : 'Scan'],
        ),
        el(
          'button',
          { class: 'btn ghost small', 'data-focusable': '', onclick: () => store.resetView() },
          ['Recenter'],
        ),
      ]),
      el('p', {
        class: 'tiny muted',
        text: `Mining L${store.state.game.upgrades.mining} · next ${cost.energy}E / ${cost.mineral}M / ${cost.science}S`,
      }),
    ]);
  };

  let listSignature = '';

  const renderBodyList = () => {
    const visible = store.visibleBodies().slice(0, 12);
    const signature = `${visible.map((body) => body.id).join(',')}#${store.state.selectedId}`;
    if (signature === listSignature) return;
    listSignature = signature;
    replaceChildren(
      bodyList,
      visible.length === 0
        ? [el('p', { class: 'small muted', text: 'Nothing in range. Upgrade the scanner.' })]
        : visible.map((body) =>
            el(
              'button',
              {
                class: 'list-item',
                'data-focusable': '',
                'data-testid': `body-${body.id}`,
                'aria-selected': String(store.state.selectedId === body.id),
                onclick: () => store.selectBody(body.id),
              },
              [
                el('span', { class: 'kind-dot', style: `background:${KIND_COLORS[body.kind]}` }),
                el('span', { class: 'ellipsis', text: body.name }),
                el('span', { class: 'mono tiny muted', text: String(body.deposit) }),
              ],
            ),
          ),
    );
  };

  let feedSignature = '';

  const renderFeed = () => {
    const log = store.state.game.riskLog;
    const signature = String(log.length);
    if (signature === feedSignature) return;
    feedSignature = signature;
    replaceChildren(
      feed,
      log.length === 0
        ? [el('span', { class: 'muted tiny', text: 'No risk events yet.' })]
        : log
            .slice(-5)
            .reverse()
            .map((entry) =>
              el('span', { class: 'risk', text: `${new Date(entry.at).toLocaleTimeString()} · ${entry.kind}` }),
            ),
    );
  };

  const update = () => {
    const state = store.state;
    const game = state.game;
    resEnergy.textContent = formatNumber(game.resources.energy);
    resMineral.textContent = formatNumber(game.resources.mineral);
    resScience.textContent = formatNumber(game.resources.science);
    hullMeter.style.width = `${game.hull}%`;
    hullBar.className = `meter${game.hull <= 25 ? ' danger' : game.hull <= 55 ? ' warn' : ''}`;
    hullValue.textContent = `${game.hull}%`;
    const score = store.score();
    ratingValue.textContent = `Score ${score.value}/100`;
    ratingChip.textContent = score.label;
    scoreMeter.style.width = `${score.value}%`;
    scaleLabel.textContent = `${GALAXY_SCALES[game.galaxy.scale].label} · ${game.galaxy.bodies.length} bodies`;
    visibleCount.textContent = `${store.visibleBodies().length} in range`;
    saveChip.textContent = state.saveStatus;
    saveOrigin.textContent = state.sessionOrigin;
    saveOrigin.className = `chip${state.sessionOrigin === 'loaded' ? ' on' : ''}`;
    replaceChildren(statRow, [
      el('span', { text: `Discovered ${game.discoveredTotal}` }),
      el('span', { text: `Scanned ${game.stats.bodiesScanned}` }),
      el('span', { text: `Upgrades ${game.stats.upgradesBought}` }),
      el('span', { text: `Play ${formatDuration(game.stats.playTimeMs)}` }),
      el('span', { text: `Peak ${game.stats.peakFps.toFixed(0)} FPS` }),
      el('span', { text: `Hull ${game.hull}%` }),
    ]);
    hint.textContent = state.paused
      ? 'PAUSED · START / P to resume'
      : state.layout.id === 'handheld'
        ? 'D-pad pan · L/R zoom · A harvest · X scan · B back'
        : 'Drag to pan · wheel/pinch zoom · click select · A harvest · X scan';
    renderDetail();
    renderBodyList();
    renderFeed();
    syncScaleRow();
  };

  const onEnter = () => {
    running = true;
    lastFrame = 0;
    lastUiUpdate = 0;
    detailSignature = '';
    listSignature = '';
    feedSignature = '';
    store.monitor.markGap();
    update();
    stage.focus();
    onResize();
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(loop);
  };

  const onExit = () => {
    running = false;
    cancelAnimationFrame(frameId);
  };

  return { node, onEnter, onExit, update };
}
