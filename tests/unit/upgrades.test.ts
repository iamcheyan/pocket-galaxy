// Upgrade economics: cost curves, affordability, caps, and the interaction
// between coin spend and level gain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UPGRADES,
  UPGRADE_IDS,
  canAfford,
  cargoCap,
  clampResources,
  harvestCooldown,
  purchaseUpgrade,
  totalUpgradeLevels,
  upgradeCost,
} from '../../src/core/upgrades.ts';
import type { Resources, UpgradeLevels } from '../../src/core/types.ts';

const rich: Resources = { energy: 100000, mineral: 100000, science: 100000 };
const zero: Resources = { energy: 0, mineral: 0, science: 0 };
const levels = (overrides: Partial<UpgradeLevels> = {}): UpgradeLevels => ({
  engine: 0,
  scanner: 0,
  shield: 0,
  cargo: 0,
  mining: 0,
  speed: 0,
  ...overrides,
});

test('every upgrade id has a spec and a level cap', () => {
  assert.equal(UPGRADE_IDS.length, 6);
  for (const id of UPGRADE_IDS) {
    assert.equal(UPGRADES[id].id, id);
    assert.ok(UPGRADES[id].maxLevel >= 5);
    assert.ok(UPGRADES[id].growth > 1);
  }
});

test('costs rise geometrically and never decrease', () => {
  for (const id of UPGRADE_IDS) {
    let previous = 0;
    for (let level = 0; level < UPGRADES[id].maxLevel; level++) {
      const cost = upgradeCost(id, level);
      const total = cost.energy + cost.mineral + cost.science;
      assert.ok(total > previous, `${id} level ${level} cost did not rise`);
      previous = total;
      assert.ok(cost.energy >= 0 && cost.mineral >= 0 && cost.science >= 0);
    }
  }
});

test('purchase deducts exactly the quoted cost and raises the level by one', () => {
  const cost = upgradeCost('engine', 0);
  const result = purchaseUpgrade('engine', rich, levels());
  assert.equal(result.ok, true);
  assert.equal(result.levels.engine, 1);
  assert.equal(result.resources.energy, rich.energy - cost.energy);
  assert.equal(result.resources.mineral, rich.mineral - cost.mineral);
  assert.equal(result.resources.science, rich.science - cost.science);
});

test('insufficient resources are rejected without mutating state', () => {
  const result = purchaseUpgrade('cargo', zero, levels());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient');
  assert.deepEqual(result.resources, zero);
  assert.equal(result.levels.cargo, 0);
});

test('a maxed upgrade refuses further purchases', () => {
  const maxed = levels({ scanner: UPGRADES.scanner.maxLevel });
  const result = purchaseUpgrade('scanner', rich, maxed);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'max-level');
  assert.equal(result.levels.scanner, UPGRADES.scanner.maxLevel);
});

test('partial affordability is not enough', () => {
  const cost = upgradeCost('shield', 0);
  const almost: Resources = {
    energy: cost.energy,
    mineral: cost.mineral,
    science: cost.science - 1,
  };
  assert.equal(canAfford(almost, cost), false);
  assert.equal(canAfford({ ...almost, science: cost.science }, cost), true);
  assert.equal(purchaseUpgrade('shield', almost, levels()).ok, false);
});

test('cargo cap and harvest cooldown are monotonic and bounded', () => {
  assert.ok(cargoCap(1) > cargoCap(0));
  assert.ok(cargoCap(10) === 200 + 1600);
  assert.equal(harvestCooldown(0), 900);
  assert.equal(harvestCooldown(10), 280);
  assert.ok(harvestCooldown(999) >= 220, 'cooldown floor holds');
});

test('clampResources enforces the cargo cap per kind', () => {
  const capped = clampResources({ energy: 99999, mineral: 1, science: 99999 }, levels({ cargo: 2 }));
  assert.equal(capped.energy, cargoCap(2));
  assert.equal(capped.mineral, 1);
  assert.equal(capped.science, cargoCap(2));
});

test('totalUpgradeLevels sums every system', () => {
  assert.equal(totalUpgradeLevels(levels()), 0);
  assert.equal(totalUpgradeLevels(levels({ engine: 3, cargo: 2, speed: 1 })), 6);
});
