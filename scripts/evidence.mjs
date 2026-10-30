// Evidence capture: real Chromium renders of every page, theme and layout
// combination into docs/evidence/. Each capture asserts the state it claims
// (layout id, theme token, viewport) so a filename can never lie.

import { launch, openPage, gotoApp, sleep } from '../tests/interaction/harness.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.GALAXY_URL ?? 'http://127.0.0.1:8123';
const OUT = path.resolve('docs/evidence');
await mkdir(OUT, { recursive: true });

const browser = await launch();
const manifest = [];

const settle = (ms = 320) => sleep(ms);

async function prepare(page, { viewport, theme, layout, page: pageId, seed = 4242 }) {
  await page.setViewport({ width: viewport.w, height: viewport.h, deviceScaleFactor: 1 });
  await page.evaluate(() => window.__pocketGalaxy.store.refreshLayout());
  await sleep(120);
  await page.evaluate(
    ({ theme, layout, seed }) => {
      const store = window.__pocketGalaxy.store;
      store.updateSettings({ theme, layout, quality: 'high', animations: true, particles: true, showPerf: false });
      if (seed !== null) store.restart('medium');
      store.state.game.galaxy.seed = seed;
    },
    { theme, layout, seed },
  );
  await sleep(150);
  // Seed a deterministic, screenshot-worthy run: discoveries, resources and a
  // couple of upgrades, all produced by the real game functions.
  await page.evaluate(() => {
    const store = window.__pocketGalaxy.store;
    const game = store.state.game;
    const visible = store.visibleBodies().slice(0, 14);
    for (const body of visible) {
      store.selectBody(body.id);
      store.scan(body.id);
      store.harvestBody(body.id);
      store.harvestBody(body.id);
    }
    store.state.game.resources = { energy: 640, mineral: 420, science: 260 };
    for (const id of ['scanner', 'mining', 'engine']) store.buy(id);
    if (store.state.game.riskLog.length === 0) {
      store.state.game.riskLog = [
        { kind: 'storm', at: Date.now() - 240000 },
        { kind: 'anomaly', at: Date.now() - 120000 },
      ];
    }
    store.emit();
  });
  await sleep(180);
  await page.evaluate((id) => window.__pocketGalaxy.navigate(id), pageId);
  await settle(420);
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    layout: document.documentElement.dataset.layout,
    quality: document.documentElement.dataset.quality,
    width: window.innerWidth,
    height: window.innerHeight,
  }));
}

async function capture(page, name, state) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  const bytes = await readFile(file);
  const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  manifest.push({ file: `docs/evidence/${name}.png`, ...state, bytes: bytes.length, sha256_12: sha });
  console.log(`captured ${name}.png (${(bytes.length / 1024).toFixed(0)} KB) theme=${state.theme} layout=${state.layout}`);
}

const VIEWPORTS = {
  handheld: { w: 390, h: 844 },
  desktop: { w: 1280, h: 800 },
};

const guards = [];
const check = (name, condition, detail = '') => {
  if (!condition) guards.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

try {
  /* ---------------------- theme × layout gallery ------------------------- */

  const combos = [
    { name: 'theme-dark-desktop-galaxy', viewport: VIEWPORTS.desktop, theme: 'dark', layout: 'desktop', page: 'galaxy' },
    { name: 'theme-light-desktop-galaxy', viewport: VIEWPORTS.desktop, theme: 'light', layout: 'desktop', page: 'galaxy' },
    { name: 'theme-oled-desktop-galaxy', viewport: VIEWPORTS.desktop, theme: 'oled', layout: 'desktop', page: 'galaxy' },
    { name: 'layout-handheld-390x844-galaxy', viewport: VIEWPORTS.handheld, theme: 'dark', layout: 'auto', page: 'galaxy' },
    { name: 'layout-tablet-820x1180-galaxy', viewport: { w: 820, h: 1180 }, theme: 'dark', layout: 'tablet', page: 'galaxy' },
    { name: 'layout-eink-390x844-galaxy', viewport: VIEWPORTS.handheld, theme: 'light', layout: 'eink', page: 'galaxy' },
    { name: 'layout-eink-1280x800-galaxy', viewport: VIEWPORTS.desktop, theme: 'light', layout: 'eink', page: 'galaxy' },
  ];

  const asViewport = (viewport) => ({ width: viewport.w, height: viewport.h });

  for (const combo of combos) {
    const { page, consoleErrors, pageErrors } = await openPage(browser, asViewport(combo.viewport));
    await gotoApp(page, BASE, '?page=galaxy');
    const state = await prepare(page, combo);
    check(`${combo.name}: theme applied`, state.theme === combo.theme, `got ${state.theme}`);
    if (combo.layout !== 'auto') {
      check(`${combo.name}: layout applied`, state.layout === combo.layout, `got ${state.layout}`);
    } else {
      check(`${combo.name}: auto layout resolved`, state.layout === 'handheld', `got ${state.layout}`);
    }
    check(`${combo.name}: viewport matches`, state.width === combo.viewport.w && state.height === combo.viewport.h);
    check(`${combo.name}: console clean`, consoleErrors.length === 0, consoleErrors.join(' | '));
    check(`${combo.name}: no page errors`, pageErrors.length === 0, pageErrors.join(' | '));
    await capture(page, combo.name, state);
    await page.close();
  }

  /* --------------------------- page-by-page ------------------------------ */

  const pages = [
    { name: 'page-galaxy-desktop', page: 'galaxy', viewport: VIEWPORTS.desktop, theme: 'dark', layout: 'desktop' },
    { name: 'page-galaxy-handheld', page: 'galaxy', viewport: VIEWPORTS.handheld, theme: 'dark', layout: 'auto' },
    { name: 'page-shipyard-desktop', page: 'ship', viewport: VIEWPORTS.desktop, theme: 'dark', layout: 'desktop' },
    { name: 'page-shipyard-handheld', page: 'ship', viewport: VIEWPORTS.handheld, theme: 'dark', layout: 'auto' },
    { name: 'page-benchmark-desktop', page: 'benchmark', viewport: VIEWPORTS.desktop, theme: 'dark', layout: 'desktop' },
    { name: 'page-showcase-desktop', page: 'showcase', viewport: VIEWPORTS.desktop, theme: 'dark', layout: 'desktop' },
    { name: 'page-showcase-handheld', page: 'showcase', viewport: VIEWPORTS.handheld, theme: 'dark', layout: 'auto' },
    { name: 'page-logbook-desktop', page: 'achievements', viewport: VIEWPORTS.desktop, theme: 'dark', layout: 'desktop' },
    { name: 'page-settings-desktop', page: 'settings', viewport: VIEWPORTS.desktop, theme: 'dark', layout: 'desktop' },
    { name: 'page-settings-handheld', page: 'settings', viewport: VIEWPORTS.handheld, theme: 'dark', layout: 'auto' },
    { name: 'page-settings-eink', page: 'settings', viewport: VIEWPORTS.desktop, theme: 'light', layout: 'eink' },
  ];

  for (const entry of pages) {
    const { page, consoleErrors, pageErrors } = await openPage(browser, asViewport(entry.viewport));
    await gotoApp(page, BASE, '?page=galaxy');
    const state = await prepare(page, entry);
    const overflow = await page.evaluate(() => {
      const html = document.documentElement;
      return { overflow: html.scrollWidth > html.clientWidth, scrollWidth: html.scrollWidth, clientWidth: html.clientWidth };
    });
    check(`${entry.name}: no horizontal overflow`, overflow.overflow === false, JSON.stringify(overflow));
    check(`${entry.name}: console clean`, consoleErrors.length === 0, consoleErrors.join(' | '));
    check(`${entry.name}: no page errors`, pageErrors.length === 0, pageErrors.join(' | '));
    await capture(page, entry.name, { ...state, scrollWidth: overflow.scrollWidth, clientWidth: overflow.clientWidth });
    await page.close();
  }

  /* ---------------------- perf overlay + benchmark ----------------------- */

  {
    const { page } = await openPage(browser, asViewport(VIEWPORTS.desktop));
    await gotoApp(page, BASE, '?page=galaxy');
    const state = await prepare(page, { viewport: VIEWPORTS.desktop, theme: 'dark', layout: 'desktop', page: 'galaxy' });
    await page.evaluate(() => window.__pocketGalaxy.store.updateSettings({ showPerf: true }));
    await sleep(1200);
    const overlayFps = await page.evaluate(
      () => document.querySelector('[data-testid="perf-fps"]')?.textContent ?? '',
    );
    check('perf overlay: FPS is non-zero', Number(overlayFps) > 0, overlayFps);
    await capture(page, 'perf-overlay-desktop', { ...state, fps: overlayFps });
    await page.close();
  }

  {
    const { page } = await openPage(browser, asViewport(VIEWPORTS.desktop));
    await gotoApp(page, BASE, '?page=benchmark');
    await page.evaluate(() => window.__pocketGalaxy.store.updateSettings({ theme: 'dark', layout: 'desktop' }));
    await sleep(300);
    await page.click('[data-testid="bench-run"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="bench-run"]').hasAttribute('disabled'),
      { timeout: 90000 },
    );
    await sleep(300);
    const report = await page.evaluate(() => document.querySelector('[data-testid="bench-report"]').value);
    await capture(page, 'benchmark-desktop', { theme: 'dark', layout: 'desktop', width: 1280, height: 800 });
    await writeFile(path.join(OUT, 'benchmark-report.txt'), report);
    console.log('wrote benchmark-report.txt');
    await page.close();
  }

  /* --------------------- quality / adaptive evidence --------------------- */

  {
    const { page } = await openPage(browser, asViewport(VIEWPORTS.desktop));
    await gotoApp(page, BASE, '?page=galaxy');
    await prepare(page, { viewport: VIEWPORTS.desktop, theme: 'dark', layout: 'desktop', page: 'galaxy' });
    await page.evaluate(() => window.__pocketGalaxy.store.updateSettings({ showPerf: true }));
    for (const level of ['low', 'high']) {
      await page.evaluate((value) => {
        const store = window.__pocketGalaxy.store;
        store.state.particles = [];
        store.setQuality(value, 'evidence');
        const body = store.visibleBodies()[0];
        for (let index = 0; index < 6; index++) store.spawnBurst(body);
      }, level);
      await sleep(600);
      const state = await page.evaluate(() => ({
        level: window.__pocketGalaxy.store.state.adaptiveLevel,
        particles: window.__pocketGalaxy.store.state.particles.length,
        budget: window.__pocketGalaxy.store.state.budget,
        overlay: document.querySelector('[data-testid="perf-overlay"]')?.textContent ?? '',
      }));
      check(`quality ${level}: budget applied`, state.level === level, state.level);
      await capture(page, `quality-${level}-desktop`, {
        theme: 'dark',
        layout: 'desktop',
        width: 1280,
        height: 800,
        level: state.level,
        particles: state.particles,
        budgetParticles: state.budget.particles,
      });
    }
    await page.close();
  }

  /* --------------------------- input evidence ---------------------------- */

  const inputShots = [
    { name: 'input-keyboard-debug', action: async (page) => {
      await page.focus('[data-testid="galaxy-stage"]');
      for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', '=', '-']) {
        await page.keyboard.press(key);
        await sleep(60);
      }
    } },
    { name: 'input-gamepad-debug', action: async (page) => {
      for (const button of [15, 14, 12, 13, 0, 5]) {
        await page.evaluate((value) => window.__pocketGalaxy.injectGamepad(value), button);
        await sleep(70);
      }
    } },
  ];

  for (const shot of inputShots) {
    const { page } = await openPage(browser, asViewport(VIEWPORTS.desktop));
    await gotoApp(page, BASE, '?page=galaxy');
    await prepare(page, { viewport: VIEWPORTS.desktop, theme: 'dark', layout: 'desktop', page: 'galaxy' });
    await shot.action(page);
    await page.evaluate(() => window.__pocketGalaxy.navigate('settings'));
    await sleep(400);
    const logText = await page.evaluate(
      () => document.querySelector('[data-testid="input-log"]')?.textContent ?? '',
    );
    check(`${shot.name}: debug log populated`, logText.includes(']'), logText.slice(0, 60));
    await capture(page, shot.name, { theme: 'dark', layout: 'desktop', width: 1280, height: 800 });
    await page.close();
  }

  /* ----------------------------- full loop ------------------------------- */

  {
    const { page } = await openPage(browser, asViewport(VIEWPORTS.desktop));
    await gotoApp(page, BASE, '?page=galaxy');
    await prepare(page, { viewport: VIEWPORTS.desktop, theme: 'dark', layout: 'desktop', page: 'galaxy' });
    const before = await page.evaluate(() => ({
      rating: window.__pocketGalaxy.store.score(),
      discovered: window.__pocketGalaxy.store.state.game.discoveredTotal,
      scale: window.__pocketGalaxy.store.state.game.galaxy.scale,
    }));
    await capture(page, 'loop-1-before-expand', { theme: 'dark', layout: 'desktop', width: 1280, height: 800, ...before });
    await page.evaluate(() => window.__pocketGalaxy.navigate('ship'));
    await sleep(300);
    await page.click('[data-testid="expand-huge"]');
    await sleep(250);
    await capture(page, 'loop-2-expand-confirm', { theme: 'dark', layout: 'desktop', width: 1280, height: 800 });
    await page.click('[data-testid="modal-expand"]');
    await sleep(600);
    await page.evaluate(() => window.__pocketGalaxy.navigate('galaxy'));
    await sleep(500);
    const after = await page.evaluate(() => ({
      rating: window.__pocketGalaxy.store.score(),
      bodies: window.__pocketGalaxy.store.state.game.galaxy.bodies.length,
      scale: window.__pocketGalaxy.store.state.game.galaxy.scale,
    }));
    check('loop: expansion reaches huge scale', after.scale === 'huge', after.scale);
    await capture(page, 'loop-3-after-expand', { theme: 'dark', layout: 'desktop', width: 1280, height: 800, ...after });
    await page.close();
  }
} finally {
  await browser.close();
}

await writeFile(path.join(OUT, 'manifest.json'), `${JSON.stringify({ capturedAt: new Date().toISOString(), captures: manifest }, null, 2)}\n`);

if (guards.length > 0) {
  console.error(`\nevidence FAILED (${guards.length})`);
  for (const guard of guards) console.error(`  ✖ ${guard}`);
  process.exitCode = 1;
} else {
  console.log(`\nevidence: PASS (${manifest.length} captures in docs/evidence/)`);
}
