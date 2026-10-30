// Application entry: nav bar, screen routing, input wiring, rAF gamepad poll.

import { el, replaceChildren } from './ui/dom.ts';
import { Store, type PageId } from './state/store.ts';
import { buildGalaxyScreen, type Screen } from './screens/galaxy.ts';
import { buildShipScreen } from './screens/ship.ts';
import { buildBenchmarkScreen } from './screens/benchmark.ts';
import { buildShowcaseScreen } from './screens/showcase.ts';
import { buildAchievementsScreen } from './screens/achievements.ts';
import { buildSettingsScreen } from './screens/settings.ts';
import { InputRouter, type ActionId, type GestureState, type InputSource } from './ui/input.ts';
import { FocusRing } from './ui/focus.ts';
import { buildModal, buildToasts, buildContextMenu } from './ui/widgets.ts';
import { UPGRADES, upgradeCost, canAfford } from './core/upgrades.ts';
import type { Body } from './core/types.ts';

const PAGES: Array<{ id: PageId; label: string; key: string }> = [
  { id: 'galaxy', label: 'Galaxy', key: '1' },
  { id: 'ship', label: 'Shipyard', key: '2' },
  { id: 'benchmark', label: 'Benchmark', key: '3' },
  { id: 'showcase', label: 'Showcase', key: '4' },
  { id: 'achievements', label: 'Logbook', key: '5' },
  { id: 'settings', label: 'Settings', key: '6' },
];

const store = new Store();
store.applyDocumentFlags();

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');

const nav = el('nav', { class: 'nav', 'data-testid': 'nav' });
const viewport = el('main', { style: 'flex:1 1 auto;min-height:0;display:flex;min-width:0;overflow:hidden' });
const modal = buildModal(store);
const toasts = buildToasts(store);
const menu = buildContextMenu(store);
root.append(nav, viewport, modal.node, toasts.node, menu.node);
document.body.append(el('div', { id: 'debug-sink', hidden: true }));

const screens: Record<PageId, Screen | null> = {
  galaxy: null,
  ship: null,
  benchmark: null,
  showcase: null,
  achievements: null,
  settings: null,
};
let active: PageId = 'galaxy';

const focus = new FocusRing();

const ensureScreen = (id: PageId): Screen => {
  const existing = screens[id];
  if (existing) return existing;
  const created =
    id === 'galaxy'
      ? buildGalaxyScreen(store)
      : id === 'ship'
        ? buildShipScreen(store)
        : id === 'benchmark'
          ? buildBenchmarkScreen(store)
          : id === 'showcase'
            ? buildShowcaseScreen(store)
            : id === 'achievements'
              ? buildAchievementsScreen(store)
              : buildSettingsScreen(store);
  screens[id] = created;
  return created;
};

const buildNav = () => {
  replaceChildren(nav, [
    el('div', { class: 'nav-brand' }, [el('span', { class: 'dot' }), el('span', { text: 'Pocket Galaxy' })]),
    ...PAGES.map((page) =>
      el(
        'button',
        {
          class: 'nav-item',
          'data-focusable': '',
          'data-testid': `nav-${page.id}`,
          'aria-current': active === page.id ? 'page' : null,
          onclick: () => navigate(page.id),
        },
        [page.label],
      ),
    ),
    el('span', { class: 'nav-spacer' }),
    el('span', {
      class: 'chip mono',
      'data-testid': 'nav-score',
      text: `${store.score().label} ${store.score().value}`,
    }),
  ]);
};

const navigate = (id: PageId) => {
  if (id === active && viewport.firstChild) return;
  screens[active]?.onExit();
  active = id;
  store.navigate(id);
  store.state.contextMenu = null;
  const screen = ensureScreen(id);
  replaceChildren(viewport, [screen.node]);
  screen.onEnter();
  focus.setScope(screen.node);
  buildNav();
  syncGestureHost();
};

store.subscribe(() => {
  if (store.state.page !== active) {
    navigate(store.state.page);
    return;
  }
  buildNav();
  const screen = screens[active];
  screen?.update();
  modal.update();
  toasts.update();
  menu.update();
});

/* --------------------------------- input --------------------------------- */

const handleAction = (action: ActionId, source: InputSource) => {
  const state = store.state;
  if (state.modal) {
    if (action === 'confirm') {
      const first = state.modal.actions[0];
      if (first) first.run();
      state.modal = null;
      store.emit();
    } else if (action === 'back') {
      state.modal = null;
      store.emit();
    }
    return;
  }
  if (state.contextMenu) {
    if (action === 'back') {
      state.contextMenu = null;
      store.emit();
    }
    return;
  }

  const pageIndex = PAGES.findIndex((page) => page.id === active);
  switch (action) {
    case 'perf':
      store.updateSettings({ showPerf: !state.perfVisible });
      return;
    case 'pause':
      if (active === 'galaxy') store.togglePause();
      return;
    case 'navPrev':
    case 'navNext': {
      const delta = action === 'navPrev' ? -1 : 1;
      const next = PAGES[(pageIndex + delta + PAGES.length) % PAGES.length];
      if (next) navigate(next.id);
      return;
    }
    default:
      break;
  }

  if (active === 'galaxy') {
    if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
      const stage = screens.galaxy?.node.querySelector<HTMLElement>('[data-testid="galaxy-stage"]');
      const activeElement = document.activeElement;
      const mapHasFocus =
        !activeElement ||
        activeElement === document.body ||
        Boolean(stage && (activeElement === stage || stage.contains(activeElement)));
      if (stage && mapHasFocus) {
        const step = 26;
        if (action === 'left') store.pan(step, 0);
        if (action === 'right') store.pan(-step, 0);
        if (action === 'up') store.pan(0, step);
        if (action === 'down') store.pan(0, -step);
        return;
      }
      focus.move(action === 'up' || action === 'left' ? -1 : 1);
      return;
    }
    if (action === 'confirm') {
      const current = focus.current();
      if (current && current !== document.activeElement) {
        focus.activate();
        return;
      }
      const body = store.currentBody();
      if (body) store.harvestBody(body.id);
      else {
        const first = store.visibleBodies()[0];
        if (first) {
          store.selectBody(first.id);
          store.toast(`Selected ${first.name}`, 'info');
        }
      }
      return;
    }
    if (action === 'back') {
      store.selectBody(null);
      store.resetView();
      return;
    }
    if (action === 'scan') {
      store.scan(null);
      return;
    }
    if (action === 'details') {
      const body = store.currentBody();
      if (body) {
        store.state.modal = {
          title: `${body.name} · ${body.kind}`,
          body: `Deposit ${body.deposit}/${body.capacity}. Position ${body.x.toFixed(2)}, ${body.y.toFixed(2)}. Scanned: ${body.scanned ? 'yes' : 'no'}.`,
          actions: [
            { label: 'Harvest', run: () => store.harvestBody(body.id) },
            { label: 'Close', run: () => undefined },
          ],
        };
        store.emit();
      }
      return;
    }
    if (action === 'zoomIn') {
      store.zoomAt(1.18);
      return;
    }
    if (action === 'zoomOut') {
      store.zoomAt(1 / 1.18);
      return;
    }
  }

  // Generic focus navigation for every non-map screen.
  if (action === 'up' || action === 'left') {
    focus.move(-1);
    return;
  }
  if (action === 'down' || action === 'right') {
    focus.move(1);
    return;
  }
  if (action === 'confirm') {
    focus.activate();
    return;
  }
  if (action === 'back') {
    navigate('galaxy');
    return;
  }
  if (action === 'scan' && active === 'ship') {
    const cheapest = (Object.keys(UPGRADES) as Array<keyof typeof UPGRADES>).find((id) => {
      const cost = upgradeCost(id, store.state.game.upgrades[id]);
      return canAfford(store.state.game.resources, cost) && store.state.game.upgrades[id] < UPGRADES[id].maxLevel;
    });
    if (cheapest) store.buy(cheapest);
    return;
  }
};

const handleGesture = (gesture: GestureState) => {
  const stage = screens.galaxy?.node.querySelector<HTMLElement>('[data-testid="galaxy-stage"]');
  const rect = stage?.getBoundingClientRect();
  const insideStage =
    rect &&
    gesture.tapX >= rect.left &&
    gesture.tapX <= rect.right &&
    gesture.tapY >= rect.top &&
    gesture.tapY <= rect.bottom;
  if (gesture.zoomFactor !== 1) {
    store.zoomAt(gesture.zoomFactor);
    return;
  }
  if (gesture.panX !== 0 || gesture.panY !== 0) {
    // Pan only while the galaxy map is the active view.
    if (active === 'galaxy') store.pan(gesture.panX, gesture.panY);
    return;
  }
  if (!insideStage) return;
  if (gesture.contextMenu) {
    const body = resolveBodyAt(gesture.tapX, gesture.tapY);
    store.state.contextMenu = { x: gesture.tapX, y: gesture.tapY, bodyId: body?.id ?? null };
    store.emit();
    return;
  }
  if (active !== 'galaxy') return;
  const body = resolveBodyAt(gesture.tapX, gesture.tapY);
  if (body) {
    store.selectBody(body.id);
    store.toast(`${body.name} selected`, 'info');
  } else {
    store.selectBody(null);
  }
};

const resolveBodyAt = (clientX: number, clientY: number) => {
  const screen = screens.galaxy;
  if (!screen) return null;
  const handle = (screen.node as HTMLElement & {
    galaxyHandle?: { pickAtClient: (x: number, y: number) => Body | null };
  }).galaxyHandle;
  if (!handle) return null;
  return handle.pickAtClient(clientX, clientY);
};

let syncGestureHost = () => undefined;

const router = new InputRouter(
  {
    onAction: handleAction,
    onLog: (record) => {
      store.logInput({ source: record.source, action: record.action, detail: record.detail, at: record.at });
    },
    onGesture: handleGesture,
    onGamepadButton: (button) => store.onGamepadButton?.(button) ?? false,
  },
  store.state.settings.gamepadMap,
);
store.router = router;

// Pointer gestures are captured document-wide so a drag that leaves the canvas
// still resolves, but a press only starts a gesture inside the map stage — a tap
// on a sidebar button must never be interpreted as a map tap.
router.attach(document.body);

syncGestureHost = () => {
  const stage = screens.galaxy?.node.querySelector<HTMLElement>('[data-testid="galaxy-stage"]') ?? null;
  router.setGestureHost(stage);
};
syncGestureHost();

store.subscribe(() => {
  router.setGamepadMap(store.state.settings.gamepadMap);
});

/* ------------------------------ gamepad poll ----------------------------- */

const pollGamepad = () => {
  const pad = router.pollGamepad();
  const changed = pad.connected !== store.state.gamepad.connected || pad.id !== store.state.gamepad.id;
  store.state.gamepad = { connected: pad.connected, id: pad.id, buttons: pad.buttons };
  if (changed && store.state.page === 'settings') store.emit();
  requestAnimationFrame(pollGamepad);
};

/* -------------------------------- pointer -------------------------------- */

document.addEventListener('pointerdown', (event) => {
  focus.focusFromEvent(event.target);
});

/* --------------------------------- boot --------------------------------- */

const query = new URLSearchParams(location.search);
const requestedPage = query.get('page') as PageId | null;
buildNav();
// The galaxy screen owns the rAF loop and the canvas, so it is created eagerly;
// navigating away only detaches its node.
ensureScreen('galaxy');
const initial: PageId = requestedPage && PAGES.some((page) => page.id === requestedPage) ? requestedPage : 'galaxy';
active = initial;
store.navigate(initial);
const firstScreen = ensureScreen(initial);
replaceChildren(viewport, [firstScreen.node]);
firstScreen.onEnter();
focus.setScope(firstScreen.node);
syncGestureHost();
requestAnimationFrame(pollGamepad);

window.addEventListener('resize', () => store.refreshLayout());

// Exposed for the interaction test harness and for field debugging on a device.
declare global {
  interface Window {
    __pocketGalaxy?: {
      store: Store;
      navigate: (page: PageId) => void;
      router: InputRouter;
      injectGamepad: (button: number) => void;
    };
  }
}
window.__pocketGalaxy = {
  store,
  navigate,
  router,
  injectGamepad: (button: number) => router.simulateGamepadButton(button),
};
