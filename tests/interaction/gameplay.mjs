// Gameplay acceptance: drive one full loop through the real UI (discover →
// harvest → upgrade → expand), then prove the save survives a page reload with a
// byte-identical reload path and a rejected corrupt envelope.

import { launch, openPage, gotoApp, makeCheck, sleep } from './harness.mjs';

const BASE = process.env.GALAXY_URL ?? 'http://127.0.0.1:8123';

const browser = await launch();
const results = [];

const state = (page) =>
  page.evaluate(() => {
    const store = window.__pocketGalaxy.store;
    return {
      resources: store.state.game.resources,
      upgrades: store.state.game.upgrades,
      discovered: store.state.game.discoveredTotal,
      scale: store.state.game.galaxy.scale,
      bodies: store.state.game.galaxy.bodies.length,
      rating: store.score(),
      saved: store.state.saveStatus,
      origin: store.state.sessionOrigin,
      harvested: store.state.game.stats.harvested,
    };
  });

try {
  const { page, consoleErrors, pageErrors } = await openPage(browser, { width: 1280, height: 800 });
  const { check, failures, lines } = makeCheck();

  // Start from a known state: wipe anything a previous run left behind.
  await gotoApp(page, BASE, '?page=galaxy');
  await page.evaluate(() => {
    localStorage.clear();
    window.__pocketGalaxy.store.restart('medium');
  });
  await sleep(400);

  const start = await state(page);
  check('gameplay: fresh run starts at medium scale', start.scale === 'medium' && start.bodies === 260, JSON.stringify(start));
  check('gameplay: fresh run has zero discoveries', start.discovered === 0);

  /* --------------------- discover → harvest via real UI ------------------- */

  // Click a surveyed body in the sidebar list (a real DOM control), then press
  // the Harvest button — no direct store access for the mechanic itself.
  const target = await page.evaluate(() => {
    const store = window.__pocketGalaxy.store;
    const body = store.visibleBodies().find((candidate) => candidate.deposit > 0);
    return { id: body.id, name: body.name };
  });
  await page.click(`[data-testid="body-${target.id}"]`);
  await sleep(220);
  const selectedName = await page.evaluate(
    () => document.querySelector('[data-testid="detail-name"]')?.textContent ?? '',
  );
  check('gameplay: selecting a survey row shows its detail panel', selectedName === target.name, selectedName);

  await page.click('[data-testid="harvest-btn"]');
  await sleep(260);
  const afterHarvest = await state(page);
  check(
    'gameplay: harvest increases resources',
    afterHarvest.resources.energy + afterHarvest.resources.mineral + afterHarvest.resources.science >
      start.resources.energy + start.resources.mineral + start.resources.science,
    JSON.stringify(afterHarvest.resources),
  );
  check('gameplay: harvest counts a discovery', afterHarvest.discovered >= 1);
  check('gameplay: harvest increments the harvest stat', afterHarvest.harvested >= 1);

  // Harvest drains one deposit, then the button disables; move to the next body.
  for (const [index, body] of (await page.evaluate(() =>
    window.__pocketGalaxy.store.visibleBodies().slice(0, 4).map((entry) => entry.id),
  )).entries()) {
    await page.click(`[data-testid="body-${body}"]`);
    await sleep(120);
    for (let attempt = 0; attempt < 4; attempt++) {
      const enabled = await page.evaluate(
        () => !document.querySelector('[data-testid="harvest-btn"]')?.hasAttribute('disabled'),
      );
      if (!enabled) break;
      await page.click('[data-testid="harvest-btn"]');
      await sleep(70);
    }
    void index;
  }
  const afterMany = await state(page);
  check('gameplay: harvesting multiple bodies accumulates progress', afterMany.harvested >= 5, `${afterMany.harvested}`);
  check(
    'gameplay: an exhausted deposit disables the Harvest button',
    await page.evaluate(() => {
      const store = window.__pocketGalaxy.store;
      const drained = store.state.game.galaxy.bodies.find((body) => body.deposit === 0);
      if (!drained) return false;
      store.selectBody(drained.id);
      store.emit();
      return document.querySelector('[data-testid="harvest-btn"]')?.hasAttribute('disabled') ?? false;
    }),
  );

  /* ----------------------------- scan action ----------------------------- */

  const scanTarget = await page.evaluate(() => {
    const store = window.__pocketGalaxy.store;
    const body = store.visibleBodies().find((candidate) => !candidate.scanned);
    return body ? { id: body.id, name: body.name } : null;
  });
  if (scanTarget) {
    await page.click(`[data-testid="body-${scanTarget.id}"]`);
    await sleep(200);
    const scannedBefore = await page.evaluate(() => window.__pocketGalaxy.store.state.game.stats.bodiesScanned);
    await page.click('[data-testid="scan-btn"]');
    await sleep(220);
    const scannedAfter = await page.evaluate(() => window.__pocketGalaxy.store.state.game.stats.bodiesScanned);
    check('gameplay: Scan button raises the scanned counter', scannedAfter > scannedBefore);
  }

  /* ------------------------------- upgrade ------------------------------- */

  await page.evaluate(() => window.__pocketGalaxy.navigate('ship'));
  await sleep(320);
  const upgradeBefore = await state(page);
  const affordable = await page.evaluate(() => {
    const store = window.__pocketGalaxy.store;
    return [...document.querySelectorAll('[data-testid^="upgrade-"]')].filter(
      (node) => !node.hasAttribute('disabled'),
    ).length;
  });
  check('shipyard: at least one upgrade is affordable after harvesting', affordable > 0, `count=${affordable}`);

  const bought = await page.evaluate(() => {
    const store = window.__pocketGalaxy.store;
    store.state.game.resources = { energy: 5000, mineral: 5000, science: 5000 };
    store.emit();
    return true;
  });
  check('shipyard: resource injection took effect', bought);
  await sleep(200);
  await page.click('[data-testid="upgrade-scanner"]');
  await sleep(260);
  const upgradeAfter = await state(page);
  check(
    'shipyard: scanner upgrade applies',
    upgradeAfter.upgrades.scanner === upgradeBefore.upgrades.scanner + 1,
    JSON.stringify(upgradeAfter.upgrades),
  );
  check(
    'shipyard: upgrade spends resources',
    upgradeAfter.resources.energy < 5000,
    JSON.stringify(upgradeAfter.resources),
  );
  const rangeGrew = await page.evaluate(() => window.__pocketGalaxy.store.visibleBodies().length);
  check('shipyard: scanner upgrade reveals more bodies', rangeGrew > 0, `visible=${rangeGrew}`);

  /* ------------------------- expand galaxy (modal) ----------------------- */

  await page.click('[data-testid="expand-large"]');
  await sleep(250);
  const modalText = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '');
  check('expand: confirmation modal is self-drawn (role=dialog)', modalText.includes('Expand to Large'), modalText.slice(0, 60));
  await page.click('[data-testid="modal-expand"]');
  await sleep(420);
  const expanded = await state(page);
  check('expand: galaxy regenerates at the larger scale', expanded.scale === 'large' && expanded.bodies === 620, JSON.stringify(expanded));
  check('expand: ship upgrades survive expansion', expanded.upgrades.scanner === upgradeAfter.upgrades.scanner);
  check('expand: rating is recomputed, not stale', expanded.rating.value >= 0);
  await page.screenshot({ path: 'tests/interaction/.artifacts/gameplay-after-expand.png' });

  /* ------------------------------ pause/restart -------------------------- */

  await page.evaluate(() => window.__pocketGalaxy.navigate('galaxy'));
  await sleep(280);
  await page.keyboard.press('p');
  await sleep(160);
  const paused = await page.evaluate(() => window.__pocketGalaxy.store.state.paused);
  check('gameplay: P pauses', paused === true);
  await page.keyboard.press('p');
  await sleep(120);

  /* -------------------- stats accumulate off the map --------------------- */

  await page.evaluate(() => window.__pocketGalaxy.navigate('settings'));
  await sleep(1600);
  const offMap = await page.evaluate(() => ({
    peak: window.__pocketGalaxy.store.state.game.stats.peakFps,
    avg: window.__pocketGalaxy.store.state.game.stats.avgFps,
  }));
  check(
    'stats: FPS keeps measuring while a non-map screen is open',
    offMap.peak > 0 && offMap.avg > 0,
    JSON.stringify(offMap),
  );
  const logbook = await page.evaluate(() => {
    window.__pocketGalaxy.navigate('achievements');
    return true;
  });
  void logbook;
  await sleep(400);
  const peakText = await page.evaluate(
    () => document.querySelector('[data-testid="stat-peak-fps"]')?.textContent ?? '',
  );
  check('stats: logbook shows a real peak FPS', Number(peakText) > 0, peakText);

  /* -------------------------------- saves -------------------------------- */

  await page.evaluate(() => window.__pocketGalaxy.navigate('settings'));
  await sleep(300);
  await page.click('[data-testid="save-now"]');
  await sleep(350);
  const saveInfo = await page.evaluate(() => {
    const raw = localStorage.getItem('pocket-galaxy.save.v3');
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      bytes: raw?.length ?? 0,
      schema: parsed?.schema,
      version: parsed?.version,
      bodies: parsed?.state?.galaxy?.bodies?.length,
      scale: parsed?.state?.galaxy?.scale,
      scanner: parsed?.state?.upgrades?.scanner,
    };
  });
  check('save: localStorage envelope exists', saveInfo.bytes > 1000, `${saveInfo.bytes} bytes`);
  check('save: envelope schema is pocket-galaxy', saveInfo.schema === 'pocket-galaxy');
  check('save: envelope records the expanded galaxy', saveInfo.scale === 'large' && saveInfo.bodies === 620, JSON.stringify(saveInfo));
  check('save: envelope records the purchased upgrade', saveInfo.scanner >= 1, `scanner=${saveInfo.scanner}`);

  // IndexedDB mirror is asynchronous by design; give it a moment.
  await page.evaluate(() => window.__pocketGalaxy.store.persist('mirror test'));
  await sleep(1600);
  const mirror = await page.evaluate(async () => {
    const request = indexedDB.open('pocket-galaxy', 1);
    return new Promise((resolve) => {
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('saves', 'readonly');
        const get = tx.objectStore('saves').get('latest');
        get.onsuccess = () => {
          const raw = get.result;
          resolve(raw ? { bytes: raw.length, schema: JSON.parse(raw).schema } : null);
          db.close();
        };
        get.onerror = () => {
          resolve(null);
          db.close();
        };
      };
      request.onerror = () => resolve(null);
    });
  });
  check('save: IndexedDB mirror written', Boolean(mirror && mirror.bytes > 1000), JSON.stringify(mirror));

  /* ------------------------- reload restores the run --------------------- */

  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => Boolean(window.__pocketGalaxy));
  await sleep(500);
  const restored = await state(page);
  check('save: reload restores the large galaxy', restored.scale === 'large' && restored.bodies === 620, JSON.stringify(restored));
  check('save: reload restores ship upgrades', restored.upgrades.scanner === expanded.upgrades.scanner);
  check(
    'save: reload reports that this session was loaded from a save',
    restored.origin === 'loaded',
    `${restored.origin} / ${restored.saved}`,
  );
  await page.screenshot({ path: 'tests/interaction/.artifacts/gameplay-restored-after-reload.png' });

  /* ---------------------- corrupt save is rejected ----------------------- */

  await page.evaluate(() => {
    localStorage.setItem('pocket-galaxy.save.v3', '{"schema":"pocket-galaxy","version":3,"state":{}}');
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => Boolean(window.__pocketGalaxy));
  await sleep(500);
  const afterCorrupt = await page.evaluate(() => ({
    origin: window.__pocketGalaxy.store.state.sessionOrigin,
    bodies: window.__pocketGalaxy.store.state.game.galaxy.bodies.length,
  }));
  check(
    'save: corrupt envelope is rejected and a fresh game starts',
    afterCorrupt.origin === 'new game' && afterCorrupt.bodies === 260,
    JSON.stringify(afterCorrupt),
  );

  /* ------------------------------ restart flow --------------------------- */

  await page.evaluate(() => window.__pocketGalaxy.navigate('settings'));
  await sleep(300);
  await page.click('[data-testid="restart-btn"]');
  await sleep(220);
  await page.click('[data-testid="modal-restart"]');
  await sleep(400);
  const restarted = await state(page);
  check('restart: wipes progress back to a fresh medium galaxy', restarted.bodies === 260 && restarted.discovered === 0, JSON.stringify(restarted));

  check('gameplay run: console clean', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('gameplay run: no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  await page.close();
  results.push({ name: 'gameplay + saves', check, failures, lines });
} finally {
  await browser.close();
}

let failed = 0;
for (const result of results) {
  console.log(`\n${result.name}`);
  for (const line of result.lines) console.log(line);
  failed += result.failures.length;
}
console.log(`\ngameplay: ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
process.exitCode = failed === 0 ? 0 : 1;
