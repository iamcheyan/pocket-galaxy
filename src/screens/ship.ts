// Ship screen: all six upgrade tracks, hull repair, galaxy expansion. Costs and
// affordability come from the same pure functions the unit tests cover.
//
// Built once, patched on every store emit — rebuilding would drop DOM focus and
// break in-flight clicks (the store emits about once per second).

import { el, replaceChildren } from '../ui/dom.ts';
import {
  UPGRADES,
  UPGRADE_IDS,
  canAfford,
  upgradeCost,
  cargoCap,
  harvestCooldown,
} from '../core/upgrades.ts';
import { GALAXY_SCALES } from '../core/galaxy.ts';
import type { GalaxyScale, UpgradeId } from '../core/types.ts';
import type { Store } from '../state/store.ts';
import type { Screen } from './galaxy.ts';

interface UpgradeCard {
  node: HTMLButtonElement;
  title: HTMLElement;
  detail: HTMLElement;
  chip: HTMLElement;
  cost: HTMLElement;
  effect: HTMLElement;
}

export function buildShipScreen(store: Store): Screen {
  const hullValue = el('span', { class: 'mono' });
  const hullMeter = el('i', { style: 'width:100%' });
  const hullBar = el('div', { class: 'meter' }, [hullMeter]);
  const repairCost = el('span', { class: 'small muted' });
  const repairButton = el(
    'button',
    { class: 'btn small', 'data-focusable': '', 'data-testid': 'repair-btn', onclick: () => store.repair() },
    ['Repair hull'],
  );
  const statGrid = el('div', { class: 'grid2 small muted', style: 'margin-top:12px', 'data-testid': 'ship-stats' });
  const hullPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-title' }, [el('h2', { text: 'Hull integrity' }), hullValue]),
    hullBar,
    el('div', { class: 'row between', style: 'margin-top:10px' }, [repairCost, repairButton]),
    statGrid,
  ]);

  const cards = new Map<UpgradeId, UpgradeCard>(
    UPGRADE_IDS.map((id) => {
      const title = el('strong');
      const detail = el('div', { class: 'tiny muted' });
      const chip = el('span', { class: 'chip' });
      const cost = el('div', { class: 'cost' });
      const effect = el('div', { class: 'tiny muted' });
      const node = el(
        'button',
        {
          class: 'upgrade',
          'data-focusable': '',
          'data-testid': `upgrade-${id}`,
          onclick: () => store.buy(id),
        },
        [el('div', {}, [title, detail]), chip, cost, effect],
      );
      return [id, { node, title, detail, chip, cost, effect }];
    }),
  );

  const grid = el('div', { class: 'grid2', 'data-testid': 'upgrade-grid' }, [...cards.values()].map((card) => card.node));

  const expandButtons = new Map<GalaxyScale, HTMLButtonElement>();
  const expandRow = el(
    'div',
    { class: 'seg scroll-x', 'data-testid': 'expand-row' },
    (Object.keys(GALAXY_SCALES) as GalaxyScale[]).map((scale) => {
      const button = el(
        'button',
        {
          'data-focusable': '',
          'data-testid': `expand-${scale}`,
          onclick: () => {
            if (scale === store.state.game.galaxy.scale) {
              store.toast('Already exploring this scale', 'warn');
              return;
            }
            store.state.modal = {
              title: `Expand to ${GALAXY_SCALES[scale].label}?`,
              body: `${GALAXY_SCALES[scale].bodies} bodies will be generated. Discoveries reset; ship upgrades and resources are kept.`,
              actions: [
                { label: 'Expand', run: () => store.expand(scale) },
                { label: 'Cancel', run: () => undefined },
              ],
            };
            store.emit();
          },
        },
        [`${GALAXY_SCALES[scale].label} · ${GALAXY_SCALES[scale].bodies}`],
      );
      expandButtons.set(scale, button);
      return button;
    }),
  );

  const node = el('div', { class: 'screen settings-screen', 'data-testid': 'screen-ship' }, [
    el('div', { class: 'title-row' }, [
      el('h1', { text: 'Shipyard' }),
      el('span', { class: 'muted small', text: 'Six systems. Every level is permanent in the save.' }),
    ]),
    hullPanel,
    grid,
    el('div', { class: 'panel' }, [
      el('h2', { text: 'Expand galaxy' }),
      el('p', {
        class: 'small muted',
        text: 'Expanding regenerates the map at a larger scale. Discoveries reset; upgrades, hull and resources carry over.',
      }),
      expandRow,
    ]),
  ]);

  const update = () => {
    const game = store.state.game;

    hullValue.textContent = `${game.hull}%`;
    hullMeter.style.width = `${game.hull}%`;
    hullBar.className = `meter${game.hull <= 25 ? ' danger' : game.hull <= 55 ? ' warn' : ''}`;
    repairCost.textContent = `Repair cost: ${Math.ceil((100 - game.hull) * 0.8)} mineral`;
    if (game.hull >= 100) repairButton.setAttribute('disabled', '');
    else repairButton.removeAttribute('disabled');

    replaceChildren(statGrid, [
      el('span', { text: 'Cargo capacity' }),
      el('span', { class: 'mono', style: 'text-align:right', text: `${cargoCap(game.upgrades.cargo)} per resource` }),
      el('span', { text: 'Harvest cooldown' }),
      el('span', { class: 'mono', style: 'text-align:right', text: `${harvestCooldown(game.upgrades.speed)} ms` }),
      el('span', { text: 'Mining multiplier' }),
      el('span', { class: 'mono', style: 'text-align:right', text: `x${(1 + game.upgrades.mining * 0.45).toFixed(2)}` }),
      el('span', { text: 'Shield mitigation' }),
      el('span', { class: 'mono', style: 'text-align:right', text: `${Math.min(70, game.upgrades.shield * 7)}%` }),
      el('span', { text: 'Travel reach' }),
      el('span', { class: 'mono', style: 'text-align:right', text: `+${game.upgrades.engine * 9}%` }),
      el('span', { text: 'Upgrades bought' }),
      el('span', { class: 'mono', style: 'text-align:right', text: String(game.stats.upgradesBought) }),
    ]);

    for (const [id, card] of cards) {
      const spec = UPGRADES[id];
      const level = game.upgrades[id];
      const cost = upgradeCost(id, level);
      const affordable = canAfford(game.resources, cost);
      const maxed = level >= spec.maxLevel;
      card.title.textContent = `${spec.title} · L${level}`;
      card.detail.textContent = spec.detail;
      card.chip.textContent = maxed ? 'MAX' : `→ L${level + 1}`;
      card.cost.textContent = maxed ? 'MAX LEVEL' : `${cost.energy}E · ${cost.mineral}M · ${cost.science}S`;
      card.effect.textContent = spec.effect(level);
      card.node.className = `upgrade${affordable && !maxed ? ' affordable' : ''}`;
      card.node.setAttribute('aria-label', `${spec.title} level ${level}`);
      if (maxed || !affordable) card.node.setAttribute('disabled', '');
      else card.node.removeAttribute('disabled');
    }

    for (const [scale, button] of expandButtons) {
      button.setAttribute('aria-pressed', String(game.galaxy.scale === scale));
    }
  };

  return { node, onEnter: update, onExit: () => undefined, update };
}
