// Settings screen: theme, layout, quality/adaptive triggers, animation and
// particle switches, gamepad rebinding, live input debug panel, save controls,
// and the restart flow. No native <select>/<dialog>/alert anywhere.
//
// The tree is built once and patched afterwards: the store emits about once per
// second (risk events, idle income), and rebuilding the panel on each emit would
// destroy focus, scroll position and any in-flight click.

import { el, replaceChildren } from '../ui/dom.ts';
import { LAYOUTS, type LayoutId, type QualityLevel } from '../core/device.ts';
import type { Store } from '../state/store.ts';
import type { Screen } from './galaxy.ts';
import { GAMEPAD_BUTTON_NAMES } from '../ui/input.ts';
import type { ActionId } from '../ui/input.ts';

export function buildSettingsScreen(store: Store): Screen {
  const inputLog = el('div', { class: 'debug-log', 'data-testid': 'input-log' });
  const capsLine = el('div', { class: 'small muted mono', 'data-testid': 'settings-caps' });
  const padLine = el('div', { class: 'small muted', 'data-testid': 'gamepad-line' });
  const saveLine = el('div', { class: 'small muted mono', 'data-testid': 'settings-save' });
  const budgetLine = el('p', { class: 'tiny muted', 'data-testid': 'budget-line' });
  const rebindStatus = el('div', { class: 'small', 'data-testid': 'rebind-status', text: 'Press Rebind, then any gamepad button.' });
  let rebinding: ActionId | null = null;

  /* ------------------------------ primitives ------------------------------ */

  const segment = <T extends string>(
    values: Array<{ id: T; label: string }>,
    onPick: (value: T) => void,
    testid: string,
  ) => {
    const buttons = values.map((value) =>
      el(
        'button',
        {
          'data-focusable': '',
          'data-testid': `${testid}-${value.id}`,
          onclick: () => onPick(value.id),
        },
        [value.label],
      ),
    );
    return {
      node: el('div', { class: 'seg', 'data-testid': testid }, buttons),
      sync: (current: T) => {
        buttons.forEach((button, index) => {
          button.setAttribute('aria-pressed', String(values[index]?.id === current));
        });
      },
    };
  };

  const switchRow = (
    label: string,
    detail: string,
    onToggle: () => void,
    testid: string,
  ) => {
    const track = el('span', { class: 'switch' });
    const button = el(
      'button',
      {
        class: 'switch-wrap',
        role: 'switch',
        'data-focusable': '',
        'aria-label': label,
        'data-testid': testid,
        onclick: onToggle,
      },
      [track],
    );
    return {
      node: el('div', { class: 'setting-row' }, [
        el('div', { class: 'setting-label' }, [el('strong', { text: label }), el('span', { text: detail })]),
        button,
      ]),
      sync: (checked: boolean) => {
        button.setAttribute('aria-checked', String(checked));
        track.setAttribute('aria-checked', String(checked));
      },
    };
  };

  /* ------------------------------- segments ------------------------------- */

  const themeSeg = segment(
    [
      { id: 'dark' as const, label: 'Dark' },
      { id: 'light' as const, label: 'Light' },
      { id: 'oled' as const, label: 'OLED' },
    ],
    (theme) => store.updateSettings({ theme }),
    'theme-seg',
  );

  const layoutSeg = segment(
    [
      { id: 'auto' as const, label: 'Auto' },
      ...(Object.keys(LAYOUTS) as LayoutId[]).map((id) => ({ id, label: LAYOUTS[id].label })),
    ],
    (layout) => store.updateSettings({ layout }),
    'layout-seg',
  );

  const qualitySeg = segment(
    [
      { id: 'auto' as const, label: 'Auto' },
      { id: 'high' as const, label: 'High' },
      { id: 'medium' as const, label: 'Medium' },
      { id: 'low' as const, label: 'Low' },
    ],
    (quality) => store.setQuality(quality === 'auto' ? null : (quality as QualityLevel), 'settings'),
    'quality-seg',
  );

  const animSwitch = switchRow(
    'Animations',
    'Off also disables CSS transitions and the toast slide',
    () => store.updateSettings({ animations: !store.state.settings.animations }),
    'anim-switch',
  );

  const particlesSwitch = switchRow(
    'Particles',
    'Overrides the quality budget to zero particles',
    () => store.updateSettings({ particles: !store.state.settings.particles }),
    'particles-switch',
  );

  const perfSwitch = switchRow(
    'Performance overlay',
    'SELECT / F toggles it from anywhere',
    () => store.updateSettings({ showPerf: !store.state.perfVisible }),
    'perf-switch',
  );

  const audioSwitch = switchRow(
    'Sound',
    'WebAudio blip is opt-in; the showcase card reports its real state',
    () => store.updateSettings({ audio: !store.state.settings.audio }),
    'audio-switch',
  );

  /* ------------------------------ rebind rows ----------------------------- */

  const rebindButtons = new Map<ActionId, HTMLButtonElement>();
  const rebindChips = new Map<ActionId, HTMLSpanElement>();
  const rebindRows = (Object.keys(store.state.settings.gamepadMap) as ActionId[]).map((action) => {
    const chip = el('span', { class: 'chip mono', 'data-testid': `chip-${action}` });
    const button = el(
      'button',
      {
        class: 'btn small',
        'data-focusable': '',
        'data-testid': `rebind-${action}`,
        onclick: () => {
          rebinding = action;
          rebindStatus.textContent = `Listening… press a button to bind "${action}"`;
          syncRebind();
        },
      },
      ['Rebind'],
    );
    rebindButtons.set(action, button);
    rebindChips.set(action, chip);
    return el('div', { class: 'setting-row' }, [el('span', { class: 'small', text: action }), el('div', { class: 'row' }, [chip, button])]);
  });

  const syncRebind = () => {
    for (const [action, chip] of rebindChips) {
      const bound = store.state.settings.gamepadMap[action] ?? 0;
      chip.textContent = GAMEPAD_BUTTON_NAMES[bound] ?? `#${bound}`;
      const button = rebindButtons.get(action);
      if (button) button.textContent = rebinding === action ? 'Listening…' : 'Rebind';
    }
  };

  /* -------------------------------- buttons ------------------------------- */

  const pauseButton = el(
    'button',
    {
      class: 'btn small',
      'data-focusable': '',
      'data-testid': 'pause-btn',
      onclick: () => store.togglePause(),
    },
    ['Pause'],
  );

  const forceLow = el(
    'button',
    { class: 'btn small', 'data-focusable': '', 'data-testid': 'force-low', onclick: () => store.setQuality('low', 'manual override') },
    ['Force low quality'],
  );
  const forceHigh = el(
    'button',
    { class: 'btn small', 'data-focusable': '', 'data-testid': 'force-high', onclick: () => store.setQuality('high', 'manual override') },
    ['Force high quality'],
  );
  const backToAuto = el(
    'button',
    { class: 'btn small', 'data-focusable': '', 'data-testid': 'quality-auto', onclick: () => store.setQuality(null, 'adaptive re-enabled') },
    ['Back to adaptive'],
  );

  /* ------------------------------- assembly ------------------------------- */

  const node = el('div', { class: 'screen settings-screen', 'data-testid': 'screen-settings' }, [
    el('div', { class: 'title-row' }, [
      el('h1', { text: 'Settings' }),
      el('span', { class: 'muted small', text: 'All controls are self-drawn — no native select/dialog/alert' }),
    ]),
    el('div', { class: 'grid2' }, [
      el('div', { class: 'panel' }, [
        el('h2', { text: 'Appearance' }),
        el('div', { class: 'setting-row' }, [
          el('div', { class: 'setting-label' }, [
            el('strong', { text: 'Theme' }),
            el('span', { text: 'OLED uses pure #000 for emissive panels' }),
          ]),
          themeSeg.node,
        ]),
        el('div', { class: 'setting-row' }, [
          el('div', { class: 'setting-label' }, [
            el('strong', { text: 'Layout profile' }),
            el('span', { text: 'Auto resolves from capabilities; override to test a target' }),
          ]),
          layoutSeg.node,
        ]),
        animSwitch.node,
        particlesSwitch.node,
      ]),
      el('div', { class: 'panel' }, [
        el('h2', { text: 'Performance' }),
        el('div', { class: 'setting-row' }, [
          el('div', { class: 'setting-label' }, [el('strong', { text: 'Quality' }), el('span', { 'data-testid': 'quality-hint' })]),
          qualitySeg.node,
        ]),
        el('div', { class: 'row', style: 'flex-wrap:wrap' }, [forceLow, forceHigh, backToAuto]),
        budgetLine,
        perfSwitch.node,
        audioSwitch.node,
      ]),
    ]),
    el('div', { class: 'grid2' }, [
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-title' }, [el('h2', { text: 'Input probe' }), padLine]),
        el('p', { class: 'small muted', text: 'Every semantic action and its source, newest first. Use this to verify a handheld’s D-pad mapping.' }),
        inputLog,
        el('div', { class: 'row', style: 'margin-top:8px;flex-wrap:wrap' }, [
          el(
            'button',
            { class: 'btn small', 'data-focusable': '', 'data-testid': 'inject-gamepad', onclick: () => store.injectGamepadProbe() },
            ['Inject gamepad button'],
          ),
          el(
            'button',
            {
              class: 'btn ghost small',
              'data-focusable': '',
              'data-testid': 'clear-log',
              onclick: () => {
                store.state.inputLog = [];
                store.emit();
              },
            },
            ['Clear log'],
          ),
        ]),
      ]),
      el('div', { class: 'panel' }, [
        el('h2', { text: 'Gamepad mapping' }),
        el('p', { class: 'small muted', text: 'Rebind by pressing a physical button. Stored in settings and applied live.' }),
        rebindStatus,
        el('div', { class: 'stack', style: 'margin-top:8px' }, rebindRows),
      ]),
    ]),
    el('div', { class: 'grid2' }, [
      el('div', { class: 'panel' }, [
        el('h2', { text: 'Save data' }),
        saveLine,
        el('div', { class: 'row', style: 'margin-top:8px;flex-wrap:wrap' }, [
          el(
            'button',
            { class: 'btn small', 'data-focusable': '', 'data-testid': 'save-now', onclick: () => store.persist('manual save') },
            ['Save now'],
          ),
          el(
            'button',
            {
              class: 'btn small',
              'data-focusable': '',
              'data-testid': 'restore-mirror',
              onclick: () => {
                void store.restoreFromMirror();
              },
            },
            ['Restore IndexedDB mirror'],
          ),
          el(
            'button',
            {
              class: 'btn danger small',
              'data-focusable': '',
              'data-testid': 'wipe-save',
              onclick: () => {
                store.state.modal = {
                  title: 'Clear local save?',
                  body: 'This removes the localStorage envelope. The IndexedDB mirror is kept until the next write.',
                  actions: [
                    { label: 'Clear', run: () => store.wipeSave() },
                    { label: 'Cancel', run: () => undefined },
                  ],
                };
                store.emit();
              },
            },
            ['Clear save'],
          ),
        ]),
        el('p', { class: 'tiny muted', text: 'Envelope schema is validated on read; a corrupt save is rejected rather than silently repaired.' }),
      ]),
      el('div', { class: 'panel' }, [
        el('h2', { text: 'Run' }),
        el('p', { class: 'small muted', text: 'Restart generates a fresh galaxy from a new seed and resets progress.' }),
        el('div', { class: 'row', style: 'flex-wrap:wrap' }, [
          pauseButton,
          el(
            'button',
            {
              class: 'btn danger small',
              'data-focusable': '',
              'data-testid': 'restart-btn',
              onclick: () => {
                store.state.modal = {
                  title: 'Restart the galaxy?',
                  body: 'Current progress and discoveries are discarded. Ship upgrades are not carried over.',
                  actions: [
                    { label: 'Restart', run: () => store.restart('medium') },
                    { label: 'Cancel', run: () => undefined },
                  ],
                };
                store.emit();
              },
            },
            ['Restart'],
          ),
        ]),
        el('h2', { style: 'margin-top:12px', text: 'Detected capabilities' }),
        capsLine,
      ]),
    ]),
  ]);

  /* -------------------------------- patching ------------------------------ */

  const qualityHint = node.querySelector('[data-testid="quality-hint"]') as HTMLElement;

  const renderLog = () => {
    replaceChildren(inputLog, [
      store.state.inputLog.length === 0
        ? el('div', { class: 'muted', text: 'No input events yet. Press keys, tap the map, or use a controller.' })
        : el(
            'div',
            {},
            store.state.inputLog
              .slice(-14)
              .reverse()
              .map((entry) =>
                el('div', {}, [
                  el('span', { class: 'key', text: `[${entry.source}]` }),
                  el('span', { class: 'in', text: ` ${entry.action}` }),
                  el('span', { text: ` — ${entry.detail}` }),
                ]),
              ),
          ),
    ]);
  };

  const update = () => {
    const settings = store.state.settings;
    const caps = store.state.caps;
    capsLine.textContent = `${caps.width}×${caps.height} @${caps.dpr}x · ${caps.cores} cores · ${caps.memoryGb} GB · touch=${caps.touch} hover=${caps.hover} eink=${caps.eink} gamepad=${caps.gamepad}`;
    padLine.textContent = store.state.gamepad.connected
      ? `Connected: ${store.state.gamepad.id}`
      : 'No gamepad detected (connect one, then press any button)';
    saveLine.textContent = `session: ${store.state.sessionOrigin} · ${store.state.saveStatus} · last saved ${
      store.state.lastSavedAt ? new Date(store.state.lastSavedAt).toLocaleTimeString() : 'never'
    }`;
    budgetLine.textContent = `Budget: particles ${store.state.budget.particles} · starfield ${store.state.budget.starfield} · glow ${
      store.state.budget.glow ? 'on' : 'off'
    } · trails ${store.state.budget.trails ? 'on' : 'off'} · cap ${store.state.budget.maxBodiesRendered} bodies`;
    qualityHint.textContent = `Auto is currently ${store.state.adaptiveLevel}`;
    pauseButton.textContent = store.state.paused ? 'Resume' : 'Pause';

    themeSeg.sync(settings.theme);
    layoutSeg.sync(settings.layout);
    qualitySeg.sync(settings.quality);
    animSwitch.sync(settings.animations);
    particlesSwitch.sync(settings.particles);
    perfSwitch.sync(store.state.perfVisible);
    audioSwitch.sync(settings.audio);
    syncRebind();
  };

  // A rebind turn consumes the next gamepad button before mapping actions.
  store.onGamepadButton = (button: number) => {
    if (rebinding === null) return false;
    const target = rebinding;
    rebinding = null;
    store.updateSettings({
      gamepadMap: { ...store.state.settings.gamepadMap, [target]: button },
    });
    rebindStatus.textContent = `Bound "${target}" to ${GAMEPAD_BUTTON_NAMES[button] ?? `#${button}`}`;
    store.emit();
    return true;
  };

  const unsubscribeLog = store.onInputLog(renderLog);

  return {
    node,
    onEnter: () => {
      update();
      renderLog();
    },
    onExit: () => unsubscribeLog(),
    update,
  };
}
