// Input acceptance: DPad/keyboard, gamepad (injected through navigator.getGamepads
// so it travels the real polling path), touch (tap/long-press/pinch via CDP
// touch events) and mouse (hover/click/drag/wheel/context menu). Each source must
// produce a visible effect AND appear in the settings debug panel.

import { launch, openPage, gotoApp, makeCheck, sleep } from './harness.mjs';

const BASE = process.env.GALAXY_URL ?? 'http://127.0.0.1:8123';

const browser = await launch();
const results = [];

const screenOf = (page) =>
  page.evaluate(() => ({
    page: document.querySelector('[data-testid^="screen-"]')?.getAttribute('data-testid') ?? '',
    selected: window.__pocketGalaxy.store.state.selectedId,
    zoom: window.__pocketGalaxy.store.state.camera.zoom,
    camera: window.__pocketGalaxy.store.state.camera,
    log: window.__pocketGalaxy.store.state.inputLog.map((entry) => `${entry.source}:${entry.action}`),
    menu: Boolean(document.querySelector('[data-testid="context-menu"]')),
  }));

try {
  /* ------------------------------- keyboard ------------------------------- */
  {
    const { page, consoleErrors, pageErrors } = await openPage(browser, { width: 1280, height: 800 });
    const { check, failures, lines } = makeCheck();
    await gotoApp(page, BASE, '?page=galaxy');
    await page.focus('[data-testid="galaxy-stage"]');

    // DPad pans the map (arrow keys are the DPad's keyboard equivalent).
    const before = await screenOf(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await sleep(160);
    const afterPan = await screenOf(page);
    // Pressing right slides the starfield left, matching a leftward drag.
    check(
      'keyboard: ArrowRight pans the camera right',
      afterPan.camera.x > before.camera.x,
      `x ${before.camera.x} → ${afterPan.camera.x}`,
    );
    await page.keyboard.press('ArrowLeft');
    await sleep(120);
    const afterLeft = await screenOf(page);
    check(
      'keyboard: ArrowLeft pans back',
      afterLeft.camera.x < afterPan.camera.x,
      `x ${afterPan.camera.x} → ${afterLeft.camera.x}`,
    );

    // L/R are zoom out/in; on a keyboard these are '-' and '='.
    await page.keyboard.press('=');
    await sleep(120);
    const zoomedIn = await screenOf(page);
    check('keyboard: "=" zooms in', zoomedIn.zoom > before.zoom, `${before.zoom} → ${zoomedIn.zoom}`);
    await page.keyboard.press('-');
    await sleep(120);
    const zoomedOut = await screenOf(page);
    check('keyboard: "-" zooms out', zoomedOut.zoom < zoomedIn.zoom);

    // X = scan, Y = details on the selected body.
    const scanTarget = await page.evaluate(() => {
      const store = window.__pocketGalaxy.store;
      const body = store.visibleBodies().find((candidate) => !candidate.scanned);
      store.selectBody(body.id);
      return { id: body.id, stat: store.state.game.stats.bodiesScanned };
    });
    await page.keyboard.press('z');
    await sleep(240);
    const scanned = await page.evaluate(
      (id) => ({
        scanned: window.__pocketGalaxy.store.state.game.galaxy.bodies[id].scanned,
        stat: window.__pocketGalaxy.store.state.game.stats.bodiesScanned,
      }),
      scanTarget.id,
    );
    check('keyboard: Z scans the selected body', scanned.scanned === true && scanned.stat > scanTarget.stat, JSON.stringify(scanned));

    await page.keyboard.press('x');
    await sleep(240);
    const detailText = await page.evaluate(
      () => document.querySelector('[role="dialog"]')?.textContent ?? '',
    );
    check('keyboard: X opens the details modal for the selection', detailText.includes('Deposit'), detailText.slice(0, 60));
    await page.keyboard.press('Escape');
    await sleep(200);
    check(
      'keyboard: Escape closes the details modal',
      await page.evaluate(() => !document.querySelector('[role="dialog"]')),
    );

    // Tab-order equivalent: ArrowDown moves the focus ring inside a screen.
    await page.evaluate(() => window.__pocketGalaxy.navigate('ship'));
    await sleep(250);
    const focusBefore = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
    await page.keyboard.press('ArrowDown');
    await sleep(120);
    const focusAfter = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
    check('keyboard: ArrowDown moves the focus ring', focusAfter !== focusBefore, `${focusBefore} → ${focusAfter}`);

    // Confirm activates the focused control (pure DPad path).
    const upgradesBefore = await page.evaluate(() => window.__pocketGalaxy.store.state.game.stats.upgradesBought);
    await page.evaluate(() => {
      window.__pocketGalaxy.store.state.game.resources = { energy: 9999, mineral: 9999, science: 9999 };
    });
    await page.keyboard.press('Enter');
    await sleep(220);
    const upgradesAfter = await page.evaluate(() => window.__pocketGalaxy.store.state.game.stats.upgradesBought);
    check(
      'keyboard: Enter buys the focused upgrade',
      upgradesAfter > upgradesBefore,
      `${upgradesBefore} → ${upgradesAfter}`,
    );

    // Escape returns to the galaxy (B/back).
    await page.keyboard.press('Escape');
    await sleep(250);
    const backScreen = await page.evaluate(
      () => document.querySelector('[data-testid^="screen-"]')?.getAttribute('data-testid') ?? '',
    );
    check('keyboard: Escape returns to the galaxy screen', backScreen === 'screen-galaxy', backScreen);

    // SELECT/F toggles the performance overlay anywhere.
    await page.keyboard.press('f');
    await sleep(200);
    const overlayVisible = await page.evaluate(() => {
      const overlay = document.querySelector('[data-testid="perf-overlay"]');
      return Boolean(overlay) && overlay.style.display !== 'none';
    });
    check('keyboard: F shows the performance overlay', overlayVisible);
    await page.keyboard.press('f');

    // START/P pauses.
    await page.keyboard.press('p');
    await sleep(140);
    const paused = await page.evaluate(() => window.__pocketGalaxy.store.state.paused);
    check('keyboard: P pauses the run', paused === true);
    await page.keyboard.press('p');

    // Debug panel records every source.
    await page.evaluate(() => window.__pocketGalaxy.navigate('settings'));
    await sleep(300);
    const logText = await page.evaluate(
      () => document.querySelector('[data-testid="input-log"]')?.textContent ?? '',
    );
    check('debug panel lists keyboard events', logText.includes('[keyboard]'), logText.slice(0, 80));
    await page.screenshot({ path: 'tests/interaction/.artifacts/input-keyboard-settings.png' });

    check('keyboard run: console clean', consoleErrors.length === 0, consoleErrors.join(' | '));
    check('keyboard run: no page errors', pageErrors.length === 0, pageErrors.join(' | '));
    await page.close();
    results.push({ name: 'keyboard / DPad', check, failures, lines });
  }

  /* -------------------------------- gamepad ------------------------------- */
  {
    const { page, consoleErrors, pageErrors } = await openPage(browser, { width: 1280, height: 800 });
    const { check, failures, lines } = makeCheck();
    await gotoApp(page, BASE, '?page=galaxy');
    await page.focus('[data-testid="galaxy-stage"]');

    const before = await screenOf(page);
    const injected = await page.evaluate(() => {
      const store = window.__pocketGalaxy.store;
      const startLog = store.state.inputLog.length;
      window.__pocketGalaxy.injectGamepad(15); // D-Pad Right
      return { startLog, after: store.state.inputLog.length, last: store.state.inputLog.at(-1) };
    });
    await sleep(160);
    const after = await screenOf(page);
    check('gamepad: injected D-Pad Right logs a gamepad event', injected.last?.source === 'gamepad', JSON.stringify(injected.last));
    check(
      'gamepad: injected D-Pad Right pans the map',
      after.camera.x !== before.camera.x,
      `${before.camera.x} → ${after.camera.x}`,
    );

    // Confirm button (A/Cross = index 0) must harvest the selected body.
    const harvest = await page.evaluate(async () => {
      const store = window.__pocketGalaxy.store;
      const visible = store.visibleBodies();
      const target = visible.find((body) => body.deposit > 0);
      store.selectBody(target.id);
      const beforeCount = store.state.game.stats.harvested;
      window.__pocketGalaxy.injectGamepad(0);
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { beforeCount, afterCount: store.state.game.stats.harvested, target: target.id };
    });
    check(
      'gamepad: A/Cross harvests the selected body',
      harvest.afterCount > harvest.beforeCount,
      JSON.stringify(harvest),
    );

    // Zoom via shoulder buttons (R1 = index 5).
    const zoomBefore = await page.evaluate(() => window.__pocketGalaxy.store.state.camera.zoom);
    await page.evaluate(() => window.__pocketGalaxy.injectGamepad(5));
    await sleep(120);
    const zoomAfter = await page.evaluate(() => window.__pocketGalaxy.store.state.camera.zoom);
    check('gamepad: R1 zooms in', zoomAfter > zoomBefore, `${zoomBefore} → ${zoomAfter}`);

    // Right stick zooms (axes 2/3), the documented "joystick zoom" mapping.
    const stickBefore = await page.evaluate(() => window.__pocketGalaxy.store.state.camera.zoom);
    await page.evaluate(() => window.__pocketGalaxy.injectGamepadStick(0.9));
    await sleep(160);
    const stickAfter = await page.evaluate(() => window.__pocketGalaxy.store.state.camera.zoom);
    check('gamepad: right stick zooms in', stickAfter > stickBefore, `${stickBefore} → ${stickAfter}`);
    await page.evaluate(() => window.__pocketGalaxy.injectGamepadStick(-0.9));
    await sleep(160);
    const stickBack = await page.evaluate(() => window.__pocketGalaxy.store.state.camera.zoom);
    check('gamepad: right stick zooms out', stickBack < stickAfter, `${stickAfter} → ${stickBack}`);

    // SELECT (index 8) toggles the perf overlay, START (9) pauses.
    await page.evaluate(() => window.__pocketGalaxy.injectGamepad(8));
    await sleep(160);
    const overlayVisible = await page.evaluate(() => window.__pocketGalaxy.store.state.perfVisible);
    check('gamepad: SELECT toggles the perf overlay', overlayVisible === true);

    // Rebind path: settings consumes the next gamepad button.
    await page.evaluate(() => window.__pocketGalaxy.navigate('settings'));
    await sleep(300);
    await page.click('[data-testid="rebind-scan"]');
    await sleep(150);
    await page.evaluate(() => window.__pocketGalaxy.injectGamepad(7));
    await sleep(200);
    const rebound = await page.evaluate(() => window.__pocketGalaxy.store.state.settings.gamepadMap.scan);
    check('gamepad: rebinding maps scan to R2 (7)', rebound === 7, `map.scan=${rebound}`);
    const rebindText = await page.evaluate(
      () => document.querySelector('[data-testid="rebind-status"]')?.textContent ?? '',
    );
    check('gamepad: rebind status reports the new binding', rebindText.includes('R2'), rebindText);

    const logText = await page.evaluate(
      () => document.querySelector('[data-testid="input-log"]')?.textContent ?? '',
    );
    check('debug panel lists gamepad events', logText.includes('[gamepad]'), logText.slice(0, 80));
    await page.screenshot({ path: 'tests/interaction/.artifacts/input-gamepad-settings.png' });

    check('gamepad run: console clean', consoleErrors.length === 0, consoleErrors.join(' | '));
    check('gamepad run: no page errors', pageErrors.length === 0, pageErrors.join(' | '));
    await page.close();
    results.push({ name: 'gamepad', check, failures, lines });
  }

  /* --------------------------------- mouse -------------------------------- */
  {
    const { page, consoleErrors, pageErrors } = await openPage(browser, { width: 1280, height: 800 });
    const { check, failures, lines } = makeCheck();
    await gotoApp(page, BASE, '?page=galaxy');
    const box = await page.evaluate(() => {
      const rect = document.querySelector('[data-testid="galaxy-stage"]').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: rect.width, h: rect.height };
    });

    const before = await screenOf(page);
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x - 120, box.y - 40, { steps: 8 });
    await page.mouse.up();
    await sleep(200);
    const afterDrag = await screenOf(page);
    check(
      'mouse: drag pans the map',
      afterDrag.camera.x !== before.camera.x && afterDrag.camera.y !== before.camera.y,
      `${JSON.stringify(before.camera)} → ${JSON.stringify(afterDrag.camera)}`,
    );

    await page.mouse.wheel({ deltaY: -240 });
    await sleep(180);
    const afterWheel = await screenOf(page);
    check('mouse: wheel zooms', afterWheel.zoom > afterDrag.zoom, `${afterDrag.zoom} → ${afterWheel.zoom}`);

    const hoverLog = afterWheel.log.filter((entry) => entry === 'mouse:hover').length;
    check('mouse: hover events are logged', hoverLog > 0, `count=${hoverLog}`);

    // Click selects a revealed body through the canvas picker.
    const clicked = await page.evaluate(async () => {
      const store = window.__pocketGalaxy.store;
      const target = store.visibleBodies().find((body) => body.deposit > 0);
      const rect = document.querySelector('[data-testid="galaxy-stage"]').getBoundingClientRect();
      const handle = document.querySelector('[data-testid="screen-galaxy"]').galaxyHandle;
      const screenPoint = handle.renderer.project(target, store.state.camera);
      return {
        id: target.id,
        x: rect.left + screenPoint.x,
        y: rect.top + screenPoint.y,
      };
    });
    await page.mouse.click(clicked.x, clicked.y);
    await sleep(220);
    const afterClick = await screenOf(page);
    check('mouse: click selects the body under the cursor', afterClick.selected === clicked.id, JSON.stringify(afterClick));
    await page.screenshot({ path: 'tests/interaction/.artifacts/input-mouse-select.png' });

    // Right click opens the self-drawn context menu.
    await page.mouse.click(clicked.x, clicked.y, { button: 'right' });
    await sleep(250);
    const menu = await screenOf(page);
    check('mouse: right click opens the context menu', menu.menu === true);
    const menuItems = await page.evaluate(
      () => [...document.querySelectorAll('[data-testid="context-menu"] button')].map((n) => n.textContent),
    );
    check('mouse: context menu has harvest/scan entries', menuItems.length >= 3, JSON.stringify(menuItems));
    await page.screenshot({ path: 'tests/interaction/.artifacts/input-context-menu.png' });

    check('mouse run: console clean', consoleErrors.length === 0, consoleErrors.join(' | '));
    check('mouse run: no page errors', pageErrors.length === 0, pageErrors.join(' | '));
    await page.close();
    results.push({ name: 'mouse', check, failures, lines });
  }

  /* --------------------------------- touch -------------------------------- */
  {
    const { page, consoleErrors, pageErrors } = await openPage(browser, {
      width: 390,
      height: 844,
      hasTouch: true,
      isMobile: true,
    });
    const { check, failures, lines } = makeCheck();
    await gotoApp(page, BASE, '?page=galaxy');
    const cdp = await page.target().createCDPSession();

    const box = await page.evaluate(() => {
      const rect = document.querySelector('[data-testid="galaxy-stage"]').getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    });
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;

    const touch = (type, points) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((point) => ({ x: point.x, y: point.y, radiusX: 6, radiusY: 6, force: 1, id: point.id ?? 0 })),
      });

    // Tap selects a body.
    const target = await page.evaluate(() => {
      const store = window.__pocketGalaxy.store;
      const body = store.visibleBodies().find((candidate) => candidate.deposit > 0);
      const rect = document.querySelector('[data-testid="galaxy-stage"]').getBoundingClientRect();
      const handle = document.querySelector('[data-testid="screen-galaxy"]').galaxyHandle;
      const point = handle.renderer.project(body, store.state.camera);
      return { id: body.id, x: rect.left + point.x, y: rect.top + point.y };
    });
    await touch('touchStart', [{ x: target.x, y: target.y }]);
    await touch('touchEnd', []);
    await sleep(260);
    const afterTap = await screenOf(page);
    check('touch: tap selects a body', afterTap.selected === target.id, JSON.stringify(afterTap.selected));
    check(
      'touch: tap is logged as a tap',
      afterTap.log.some((entry) => entry === 'touch:tap'),
      afterTap.log.slice(-4).join(','),
    );

    // Long press opens the context menu.
    await touch('touchStart', [{ x: cx, y: cy }]);
    await sleep(620);
    await touch('touchEnd', []);
    await sleep(200);
    const afterHold = await screenOf(page);
    check('touch: long press opens the context menu', afterHold.menu === true);
    check(
      'touch: long press is logged',
      afterHold.log.some((entry) => entry === 'touch:longpress'),
      afterHold.log.slice(-4).join(','),
    );
    // Dismiss by pressing Escape (B) — the menu is app-drawn, not native.
    await page.keyboard.press('Escape');
    await sleep(200);

    // Drag pans.
    const panBefore = await screenOf(page);
    await touch('touchStart', [{ x: cx, y: cy }]);
    for (let step = 1; step <= 6; step++) {
      await touch('touchMove', [{ x: cx - step * 14, y: cy - step * 4 }]);
      await sleep(16);
    }
    await touch('touchEnd', []);
    await sleep(180);
    const panAfter = await screenOf(page);
    check(
      'touch: drag pans the map',
      panAfter.camera.x !== panBefore.camera.x,
      `${panBefore.camera.x} → ${panAfter.camera.x}`,
    );

    // Pinch zooms: two touch points moving apart.
    const zoomBefore = panAfter.zoom;
    await touch('touchStart', [
      { x: cx - 40, y: cy, id: 0 },
      { x: cx + 40, y: cy, id: 1 },
    ]);
    for (let step = 1; step <= 6; step++) {
      await touch('touchMove', [
        { x: cx - 40 - step * 12, y: cy, id: 0 },
        { x: cx + 40 + step * 12, y: cy, id: 1 },
      ]);
      await sleep(16);
    }
    await touch('touchEnd', []);
    await sleep(200);
    const zoomAfter = await screenOf(page);
    check('touch: pinch zooms the map', zoomAfter.zoom > zoomBefore, `${zoomBefore} → ${zoomAfter.zoom}`);
    check(
      'touch: pinch is logged',
      zoomAfter.log.some((entry) => entry === 'touch:zoom'),
      zoomAfter.log.slice(-4).join(','),
    );

    await page.evaluate(() => window.__pocketGalaxy.navigate('settings'));
    await sleep(280);
    const logText = await page.evaluate(
      () => document.querySelector('[data-testid="input-log"]')?.textContent ?? '',
    );
    check('debug panel lists touch events', logText.includes('[touch]'), logText.slice(0, 90));
    await page.screenshot({ path: 'tests/interaction/.artifacts/input-touch-settings.png' });

    check('touch run: console clean', consoleErrors.length === 0, consoleErrors.join(' | '));
    check('touch run: no page errors', pageErrors.length === 0, pageErrors.join(' | '));
    await page.close();
    results.push({ name: 'touch', check, failures, lines });
  }
} finally {
  await browser.close();
}

let failed = 0;
for (const result of results) {
  console.log(`\n${result.name}`);
  for (const line of result.lines) console.log(line);
  failed += result.failures.length;
}
console.log(`\ninputs: ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
process.exitCode = failed === 0 ? 0 : 1;
