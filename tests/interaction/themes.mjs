// Theme + layout acceptance, verified from pixels rather than from attributes:
// the canvas background and body ink are sampled directly, so a theme that only
// changed a data attribute (but not what was painted) fails here.

import { launch, openPage, gotoApp, makeCheck, sleep } from './harness.mjs';

const BASE = process.env.GALAXY_URL ?? 'http://127.0.0.1:8123';
const browser = await launch();
const results = [];

const sampleCanvas = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="galaxy-canvas"]');
    const ctx = canvas.getContext('2d');
    // Corner pixel is background: no body, no starfield cell is guaranteed there.
    const corner = ctx.getImageData(2, 2, 1, 1).data;
    // Count distinct strongly-saturated pixels to prove colour vs monochrome.
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let coloured = 0;
    for (let index = 0; index < data.length; index += 4 * 37) {
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min > 40 && max > 60) coloured += 1;
    }
    return {
      corner: [corner[0], corner[1], corner[2]],
      coloured,
      theme: document.documentElement.dataset.theme,
      layout: document.documentElement.dataset.layout,
      quality: document.documentElement.dataset.quality,
    };
  });

try {
  const { page, consoleErrors, pageErrors } = await openPage(browser, { width: 1280, height: 800 });
  const { check, failures, lines } = makeCheck();
  await gotoApp(page, BASE, '?page=galaxy');
  await page.evaluate(() => window.__pocketGalaxy.store.restart('medium'));
  await sleep(500);

  const dark = await sampleCanvas(page);
  check('theme dark: canvas background is dark', dark.corner.every((channel) => channel < 40), JSON.stringify(dark.corner));
  check('theme dark: bodies are painted in colour', dark.coloured > 0, `coloured pixels=${dark.coloured}`);

  await page.evaluate(() => window.__pocketGalaxy.store.updateSettings({ theme: 'light' }));
  await sleep(450);
  const light = await sampleCanvas(page);
  check('theme light: canvas background is light', light.corner.every((channel) => channel > 150), JSON.stringify(light.corner));
  check(
    'theme light: differs from dark',
    light.corner.join(',') !== dark.corner.join(','),
    `${dark.corner} vs ${light.corner}`,
  );

  await page.evaluate(() => window.__pocketGalaxy.store.updateSettings({ theme: 'oled' }));
  await sleep(450);
  const oled = await sampleCanvas(page);
  check('theme oled: canvas background is pure black (#000)', oled.corner.every((channel) => channel === 0), JSON.stringify(oled.corner));
  check('theme oled: <html> resolves to the oled token set', oled.theme === 'oled');
  const oledSurface = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return ['--bg', '--bg-deep', '--surface', '--surface-2'].map((name) => style.getPropertyValue(name).trim());
  });
  check(
    'theme oled: every large surface token is #000',
    oledSurface.every((value) => value === '#000000'),
    JSON.stringify(oledSurface),
  );

  // Switching back must repaint, not keep the last palette.
  await page.evaluate(() => window.__pocketGalaxy.store.updateSettings({ theme: 'dark' }));
  await sleep(450);
  const back = await sampleCanvas(page);
  check('theme: switching back restores the dark canvas', back.corner.every((channel) => channel < 40), JSON.stringify(back.corner));

  // E-Ink: monochrome on both themes, with the layout pinned on a colour desktop.
  await page.evaluate(() => window.__pocketGalaxy.store.updateSettings({ theme: 'light', layout: 'eink' }));
  await sleep(600);
  const eink = await sampleCanvas(page);
  check('layout eink: resolves to the eink profile', eink.layout === 'eink');
  check('layout eink: no saturated colour anywhere on the map', eink.coloured === 0, `coloured pixels=${eink.coloured}`);
  check('layout eink: still produces visible ink', await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="galaxy-canvas"]');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let index = 0; index < data.length; index += 4 * 37) if (data[index] < 200) ink += 1;
    return ink > 0;
  }));

  // E-Ink pacing: 66 ms target must actually throttle the loop.
  await page.evaluate(() => window.__pocketGalaxy.store.monitor.reset());
  await sleep(1600);
  const paced = await page.evaluate(() => window.__pocketGalaxy.store.state.sample);
  check(
    'layout eink: paints at the 10–20 FPS e-ink target',
    paced.avgFps >= 9 && paced.avgFps <= 21,
    `${paced.avgFps.toFixed(1)} FPS`,
  );
  check('layout eink: paced frames are not jank', paced.jank === 0, String(paced.jank));

  // Tablet and handheld profiles from capabilities, then back to desktop.
  for (const [layout, expect] of [
    ['tablet', 'tablet'],
    ['handheld', 'handheld'],
    ['desktop', 'desktop'],
    ['auto', 'desktop'],
  ]) {
    await page.evaluate((value) => window.__pocketGalaxy.store.updateSettings({ layout: value }), layout);
    await sleep(320);
    const actual = await page.evaluate(() => document.documentElement.dataset.layout);
    check(`layout override "${layout}" resolves to ${expect}`, actual === expect, actual);
  }

  check('themes run: console clean', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('themes run: no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  await page.evaluate(() => window.__pocketGalaxy.store.updateSettings({ theme: 'oled', layout: 'desktop' }));
  await sleep(500);
  await page.screenshot({ path: 'tests/interaction/.artifacts/theme-oled-verification.png' });
  await page.close();
  results.push({ name: 'themes + layouts (pixel verified)', check, failures, lines });
} finally {
  await browser.close();
}

let failed = 0;
for (const result of results) {
  console.log(`\n${result.name}`);
  for (const line of result.lines) console.log(line);
  failed += result.failures.length;
}
console.log(`\nthemes: ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
process.exitCode = failed === 0 ? 0 : 1;
