// Achievements + stats screen. Rows and stat cells are built once and patched,
// because the store emits about once per second (idle income / risk ticks).

import { el, replaceChildren, formatDuration } from '../ui/dom.ts';
import type { Store } from '../state/store.ts';
import type { Screen } from './galaxy.ts';

interface AchievementRow {
  node: HTMLElement;
  badge: HTMLElement;
}

const STAT_ROWS: Array<{ label: string; key: string }> = [
  { label: 'Play time', key: 'play-time' },
  { label: 'Travel distance', key: 'travel-distance' },
  { label: 'Bodies discovered', key: 'bodies-discovered' },
  { label: 'Bodies scanned', key: 'bodies-scanned' },
  { label: 'Harvest actions', key: 'harvest-actions' },
  { label: 'Resources collected', key: 'resources-collected' },
  { label: 'Science collected', key: 'science-collected' },
  { label: 'Visited planets', key: 'visited-planets' },
  { label: 'Upgrades bought', key: 'upgrades-bought' },
  { label: 'Galaxy size', key: 'galaxy-size' },
  { label: 'Peak FPS', key: 'peak-fps' },
  { label: 'Average FPS', key: 'average-fps' },
  { label: 'Achievements', key: 'achievements' },
  { label: 'Galaxy rating', key: 'galaxy-rating' },
  { label: 'Sessions', key: 'sessions' },
];

export function buildAchievementsScreen(store: Store): Screen {
  const achievementRows = new Map<string, AchievementRow>(
    store.achievements().map((entry) => {
      const badge = el('div', { class: 'badge', text: '·' });
      const node = el('div', { class: 'achievement', 'data-testid': `ach-${entry.id}` }, [
        badge,
        el('div', { class: 'stack', style: 'gap:2px' }, [
          el('strong', { text: entry.title }),
          el('span', { class: 'small muted', text: entry.detail }),
        ]),
      ]);
      return [entry.id, { node, badge }];
    }),
  );

  const statCells = new Map<string, HTMLElement>(
    STAT_ROWS.map((row) => [row.key, el('span', { class: 'mono', style: 'text-align:right', 'data-testid': `stat-${row.key}` })]),
  );

  const statsPanel = el('div', { class: 'panel', 'data-testid': 'stats-panel' }, [
    el('h2', { text: 'Run statistics' }),
    el(
      'div',
      { class: 'grid2 small' },
      STAT_ROWS.flatMap((row) => [
        el('span', { class: 'muted', text: row.label }),
        statCells.get(row.key) as HTMLElement,
      ]),
    ),
  ]);

  const list = el(
    'div',
    { class: 'grid2', 'data-testid': 'achievement-list' },
    [...achievementRows.values()].map((row) => row.node),
  );

  const node = el('div', { class: 'screen achievements-screen', 'data-testid': 'screen-achievements' }, [
    el('div', { class: 'title-row' }, [
      el('h1', { text: 'Logbook' }),
      el('span', { class: 'muted small', text: 'Achievements and run statistics' }),
    ]),
    statsPanel,
    list,
  ]);

  const update = () => {
    const game = store.state.game;
    const achievements = store.achievements();
    const unlocked = achievements.filter((entry) => entry.unlocked).length;

    for (const entry of achievements) {
      const row = achievementRows.get(entry.id);
      if (!row) continue;
      row.node.className = `achievement${entry.unlocked ? ' unlocked' : ''}`;
      row.badge.textContent = entry.unlocked ? '✓' : '·';
    }

    const score = store.score();
    const values: Record<string, string> = {
      'play-time': formatDuration(game.stats.playTimeMs),
      'travel-distance': `${game.stats.travelDistance.toFixed(1)} units`,
      'bodies-discovered': String(game.discoveredTotal),
      'bodies-scanned': String(game.stats.bodiesScanned),
      'harvest-actions': String(game.stats.harvested),
      'resources-collected': String(Math.round(game.resourcesCollected)),
      'science-collected': String(Math.round(game.scienceCollected)),
      'visited-planets': String(game.visitedPlanets),
      'upgrades-bought': String(game.stats.upgradesBought),
      'galaxy-size': `${game.galaxy.scale} · ${game.galaxy.bodies.length} bodies`,
      'peak-fps': game.stats.peakFps.toFixed(1),
      'average-fps': game.stats.avgFps.toFixed(1),
      achievements: `${unlocked}/${achievements.length}`,
      'galaxy-rating': `${score.label} (${score.value}/100)`,
      sessions: String(game.stats.sessions),
    };
    for (const [key, cell] of statCells) {
      const next = values[key] ?? '';
      if (cell.textContent !== next) cell.textContent = next;
    }
  };

  return { node, onEnter: update, onExit: () => undefined, update };
}
