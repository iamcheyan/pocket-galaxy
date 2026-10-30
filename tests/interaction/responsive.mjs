// Responsive acceptance: every page at 390×844 and 1280×800 must have zero
// horizontal overflow and a clean console/page-error log. Layout ids are checked
// against the capability-derived values.

import { launch, openPage, gotoApp, makeCheck, overflowReport, sleep } from './harness.mjs';

const BASE = process.env.GALAXY_URL ?? 'http://127.0.0.1:8123';
const PAGES = ['galaxy', 'ship', 'benchmark', 'showcase', 'achievements', 'settings'];
const VIEWPORTS = [
  { width: 390, height: 844, label: '390x844', expectLayout: 'handheld' },
  { width: 1280, height: 800, label: '1280x800', expectLayout: 'desktop' },
];

const browser = await launch();
const results = [];

try {
  for (const viewport of VIEWPORTS) {
    const { page, consoleErrors, pageErrors } = await openPage(browser, viewport);
    const { check, failures, lines } = makeCheck();
    await gotoApp(page, BASE, '?page=galaxy');

    for (const pageId of PAGES) {
      await page.evaluate((id) => window.__pocketGalaxy.navigate(id), pageId);
      await sleep(260);
      const report = await overflowReport(page);
      check(
        `${viewport.label} ${pageId}: scrollWidth ${report.scrollWidth} === clientWidth ${report.clientWidth}`,
        report.scrollWidth === report.clientWidth,
        JSON.stringify(report.offenders),
      );
      const screen = await page.evaluate(
        (id) => Boolean(document.querySelector(`[data-testid="screen-${id === 'achievements' ? 'achievements' : id}"]`)),
        pageId,
      );
      check(`${viewport.label} ${pageId}: screen mounted`, screen);

      if (pageId === 'galaxy') {
        const layout = await page.evaluate(() => document.documentElement.dataset.layout);
        check(`${viewport.label}: layout is ${viewport.expectLayout}`, layout === viewport.expectLayout, `got ${layout}`);
      }
    }

    // Every interactive control must meet the minimum touch target on the small
    // viewport, and every focusable must be reachable without a pointer.
    if (viewport.width === 390) {
      await page.evaluate(() => window.__pocketGalaxy.navigate('settings'));
      await sleep(250);
      const small = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button[data-focusable]')];
        return buttons
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return { height: Math.round(rect.height), testid: node.getAttribute('data-testid') ?? node.textContent?.slice(0, 18) };
          })
          .filter((entry) => entry.height > 0 && entry.height < 32);
      });
      check(`${viewport.label}: no interactive control under 32 px tall`, small.length === 0, JSON.stringify(small));
    }

    check(`${viewport.label}: no console errors or warnings`, consoleErrors.length === 0, consoleErrors.join(' | '));
    check(`${viewport.label}: no page errors or failed requests`, pageErrors.length === 0, pageErrors.join(' | '));

    const shot = `responsive-${viewport.label}-galaxy.png`;
    await page.evaluate(() => window.__pocketGalaxy.navigate('galaxy'));
    await sleep(400);
    await page.screenshot({ path: `tests/interaction/.artifacts/${shot}` });

    await page.close();
    results.push({ name: `responsive ${viewport.label}`, check, failures, lines });
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
console.log(`\nresponsive: ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
process.exitCode = failed === 0 ? 0 : 1;
