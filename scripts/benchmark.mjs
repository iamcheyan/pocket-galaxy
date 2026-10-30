// Headless benchmark runner. Drives the real Benchmark page (button, table,
// report) in Chromium and prints the paste-ready report. Used for the
// "two runs, compare" evidence loop without manual clicking.
//
//   node scripts/benchmark.mjs [runs] [outFile]

import { launch, openPage, gotoApp, sleep } from '../tests/interaction/harness.mjs';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = Math.max(1, Number(process.argv[2] ?? 2));
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : null;
const PORT = Number(process.env.PORT ?? 8124);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch(`${BASE}/index.html`);
    if (response.ok) break;
  } catch {
    /* retry */
  }
  await delay(150);
}

const browser = await launch();
const collected = [];
try {
  const { page, consoleErrors, pageErrors } = await openPage(browser, { width: 1280, height: 800 });
  await gotoApp(page, BASE, '?page=benchmark');
  await page.evaluate(() => window.__pocketGalaxy.store.updateSettings({ layout: 'desktop' }));
  await sleep(300);

  for (let run = 1; run <= RUNS; run++) {
    await page.click('[data-testid="bench-run"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="bench-run"]').hasAttribute('disabled'),
      { timeout: 120000 },
    );
    await sleep(250);
    const output = await page.evaluate(() => ({
      report: document.querySelector('[data-testid="bench-report"]').value,
      rating: document.querySelector('[data-testid="bench-rating"]').textContent,
      rows: [...document.querySelectorAll('[data-testid^="bench-row-"]')].map((row) => {
        const cells = [...row.querySelectorAll('td')].map((cell) => cell.textContent);
        return { objects: Number(cells[0]), frames: Number(cells[1]), avgFps: Number(cells[2]) };
      }),
    }));
    collected.push(output);
    console.log(`\n===== run ${run} =====\n${output.report}`);
  }

  if (consoleErrors.length > 0) console.error('console errors:', consoleErrors);
  if (pageErrors.length > 0) console.error('page errors:', pageErrors);
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

if (collected.length > 1) {
  console.log('\n===== comparison =====');
  console.log('objects   ' + collected.map((_, index) => `run${index + 1}`.padStart(8)).join(''));
  for (let index = 0; index < collected[0].rows.length; index++) {
    const label = String(collected[0].rows[index].objects).padStart(7);
    const values = collected.map((run) => run.rows[index].avgFps.toFixed(1).padStart(8)).join('');
    console.log(`${label}   ${values}`);
  }
  console.log('rating    ' + collected.map((run) => run.rating.replace('Rating ', '').padStart(8)).join(''));
}

if (OUT) {
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ capturedAt: new Date().toISOString(), runs: collected }, null, 2));
  console.log(`\nwrote ${OUT}`);
}
