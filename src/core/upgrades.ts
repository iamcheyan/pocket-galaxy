// Ship upgrades. Costs are geometric per level; effects are additive caps so a
// maxed ship is strong but the galaxy still limits reach.

import type { Resources, UpgradeId, UpgradeLevels } from './types.ts';

export interface UpgradeSpec {
  id: UpgradeId;
  title: string;
  detail: string;
  maxLevel: number;
  baseCost: Resources;
  /** Multiplier applied to every resource per level. */
  growth: number;
  /** Human-readable effect at a given level. */
  effect: (level: number) => string;
}

export const UPGRADE_IDS: readonly UpgradeId[] = [
  'engine',
  'scanner',
  'shield',
  'cargo',
  'mining',
  'speed',
];

export const UPGRADES: Record<UpgradeId, UpgradeSpec> = {
  engine: {
    id: 'engine',
    title: 'Engine',
    detail: 'Extends exploration reach and travel speed',
    maxLevel: 10,
    baseCost: { energy: 40, mineral: 30, science: 0 },
    growth: 1.55,
    effect: (level) => (level === 0 ? 'Baseline reach' : `Reach +${level * 9}%`),
  },
  scanner: {
    id: 'scanner',
    title: 'Scanner',
    detail: 'Reveals more of the galaxy map',
    maxLevel: 10,
    baseCost: { energy: 30, mineral: 20, science: 20 },
    growth: 1.6,
    effect: (level) => (level === 0 ? 'Baseline scan radius' : `Scan radius +${(0.09 * level).toFixed(2)} units`),
  },
  shield: {
    id: 'shield',
    title: 'Shield',
    detail: 'Reduces hull damage from risk events',
    maxLevel: 10,
    baseCost: { energy: 25, mineral: 45, science: 10 },
    growth: 1.5,
    effect: (level) =>
      level === 0 ? 'No damage reduction' : `Damage -${Math.min(70, level * 7)}%`,
  },
  cargo: {
    id: 'cargo',
    title: 'Cargo',
    detail: 'Raises the resource cap per kind',
    maxLevel: 10,
    baseCost: { energy: 35, mineral: 35, science: 5 },
    growth: 1.45,
    effect: (level) => `Cap ${cargoCap(level)} per resource`,
  },
  mining: {
    id: 'mining',
    title: 'Mining',
    detail: 'Harvest yield per action',
    maxLevel: 10,
    baseCost: { energy: 20, mineral: 50, science: 15 },
    growth: 1.58,
    effect: (level) => `Yield x${(1 + level * 0.45).toFixed(2)}`,
  },
  speed: {
    id: 'speed',
    title: 'Speed',
    detail: 'Shorter harvest cooldown and faster ticks',
    maxLevel: 10,
    baseCost: { energy: 45, mineral: 25, science: 25 },
    growth: 1.52,
    effect: (level) => `Cooldown ${harvestCooldown(level)} ms`,
  },
};

export function cargoCap(level: number): number {
  return 200 + level * 160;
}

export function harvestCooldown(level: number): number {
  return Math.max(220, 900 - level * 62);
}

export function upgradeCost(id: UpgradeId, currentLevel: number): Resources {
  const spec = UPGRADES[id];
  const factor = spec.growth ** currentLevel;
  return {
    energy: Math.ceil(spec.baseCost.energy * factor),
    mineral: Math.ceil(spec.baseCost.mineral * factor),
    science: Math.ceil(spec.baseCost.science * factor),
  };
}

export function canAfford(resources: Resources, cost: Resources): boolean {
  return (
    resources.energy >= cost.energy &&
    resources.mineral >= cost.mineral &&
    resources.science >= cost.science
  );
}

export interface PurchaseResult {
  ok: boolean;
  reason?: 'max-level' | 'insufficient';
  resources: Resources;
  levels: UpgradeLevels;
  cost: Resources;
}

export function purchaseUpgrade(
  id: UpgradeId,
  resources: Resources,
  levels: UpgradeLevels,
): PurchaseResult {
  const spec = UPGRADES[id];
  const level = levels[id];
  const cost = upgradeCost(id, level);
  if (level >= spec.maxLevel) {
    return { ok: false, reason: 'max-level', resources, levels, cost };
  }
  if (!canAfford(resources, cost)) {
    return { ok: false, reason: 'insufficient', resources, levels, cost };
  }
  return {
    ok: true,
    cost,
    resources: {
      energy: resources.energy - cost.energy,
      mineral: resources.mineral - cost.mineral,
      science: resources.science - cost.science,
    },
    levels: { ...levels, [id]: level + 1 },
  };
}

export function totalUpgradeLevels(levels: UpgradeLevels): number {
  return UPGRADE_IDS.reduce((sum, id) => sum + levels[id], 0);
}

/** Cargo clamps new resource totals; overflow is discarded, not banked. */
export function clampResources(resources: Resources, levels: UpgradeLevels): Resources {
  const cap = cargoCap(levels.cargo);
  return {
    energy: Math.min(cap, resources.energy),
    mineral: Math.min(cap, resources.mineral),
    science: Math.min(cap, resources.science),
  };
}
