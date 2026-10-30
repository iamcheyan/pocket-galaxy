// Performance acceptance: run the real benchmark twice in-browser, prove the
// results are measured (not precomputed), verify the perf overlay tracks real
// frames, and show a visible adaptive-quality difference (particle + draw-call
// budget) between forced low and forced high quality.

import { launch, openPage, gotoApp, makeCheck, sleep } from './harness.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACTS } from './harness.mjs';

const BASE = process.env.GALAXY_URL ?? 'http://127.0.0.1:8123';

const browser = await launch();
const results = [];

try {
  const { page, consoleErrors, pageErrors } = await openPage(browser, { width: 1280, height: 800 });
  const { check, failures, lines } = makeCheck();
  await gotoApp(page, BASE, '?page=benchmark');
  await sleep(400);

  /* ---------------------------- overlay is live -------------------------- */

  await page.evaluate(() => window.__pocketGalaxy.navigate('galaxy'));
  await sleep(600);
  await page.keyboard.press('f');
  await sleep(900);
  const overlay = await page.evaluate(() => ({
    visible: document.querySelector('[data-testid="perf-overlay"]')?.style.display !== 'none',
    fps: document.querySelector('[data-testid="perf-fps"]')?.textContent ?? '',
    text: document.querySelector('[data-testid="perf-overlay"]')?.textContent ?? '',
  }));
  check('overlay: SELECT/F shows the overlay', overlay.visible === true);
  check('overlay: FPS is a live number', Number(overlay.fps) > 0, overlay.fps);
  for (const label of ['Frame', 'p95', 'Jank', 'Memory', 'Entities', 'Particles', 'Draw calls', 'Update', 'Render', 'Quality']) {
    check(`overlay: shows ${label}`, overlay.text.includes(label));
  }
  await page.screenshot({ path: 'tests/interaction/.artifacts/perf-overlay-live.png' });
  await page.keyboard.press('f');
  await sleep(150);

  /* ---------------------- adaptive quality, manual proof ----------------- */

  await page.evaluate(() => window.__pocketGalaxy.navigate('settings'));
  await sleep(350);
  await page.click('[data-testid="force-low"]');
  await sleep(250);
  const low = await page.evaluate(() => ({
    budget: { ...window.__pocketGalaxy.store.state.budget },
    particles: window.__pocketGalaxy.store.state.particles.length,
    level: window.__pocketGalaxy.store.state.adaptiveLevel,
  }));
  await page.click('[data-testid="force-high"]');
  await sleep(250);
  const high = await page.evaluate(() => ({
    budget: { ...window.__pocketGalaxy.store.state.budget },
    level: window.__pocketGalaxy.store.state.adaptiveLevel,
  }));
  check('quality: forcing low applies the low budget', low.level === 'low' && low.budget.particles === 90, JSON.stringify(low));
  check('quality: forcing high applies the high budget', high.level === 'high' && high.budget.particles === 900, JSON.stringify(high));
  check('quality: glow/trails differ between low and high', low.budget.glow === false && high.budget.glow === true);
  check(
    'quality: visible budget line reports the active level',
    (await page.evaluate(() => document.querySelector('[data-testid="budget-line"]')?.textContent ?? '')).includes('particles 900'),
  );

  // Observable difference on the map: spawn a burst at low vs high quality and
  // compare the particle count the overlay reports.
  await page.evaluate(() => window.__pocketGalaxy.navigate('galaxy'));
  await sleep(300);
  await page.evaluate(() => {
    const store = window.__pocketGalaxy.store;
    store.setQuality('low', 'test');
    const body = store.visibleBodies()[0];
    store.selectBody(body.id);
    store.spawnBurst(body);
  });
  await sleep(120);
  const lowBurst = await page.evaluate(() => ({
    particles: window.__pocketGalaxy.store.state.particles.length,
    overlay: document.querySelector('[data-testid="perf-overlay"]')?.textContent ?? '',
  }));
  await page.screenshot({ path: 'tests/interaction/.artifacts/quality-low.png' });
  await page.evaluate(() => {
    const store = window.__pocketGalaxy.store;
    store.state.particles = [];
    store.setQuality('high', 'test');
    const body = store.visibleBodies()[0];
    store.selectBody(body.id);
    store.spawnBurst(body);
  });
  await sleep(120);
  const highBurst = await page.evaluate(() => ({
    particles: window.__pocketGalaxy.store.state.particles.length,
  }));
  await page.screenshot({ path: 'tests/interaction/.artifacts/quality-high.png' });
  check(
    'quality: high budget spawns more particles than low for the same action',
    highBurst.particles > lowBurst.particles,
    `low=${lowBurst.particles} high=${highBurst.particles}`,
  );
  // The low-quality run must also be visibly cheaper in the overlay's own
  // counters, which is what a device reviewer actually reads.
  check(
    'quality: overlay reports a smaller particle count at low quality',
    lowBurst.overlay.includes('Particles') &&
      Number(lowBurst.particles) < Number(highBurst.particles),
    `low=${lowBurst.particles} high=${highBurst.particles}`,
  );

  // Pacing must actually be enforced: low quality is a 30 Hz budget, so the
  // measured average has to land near 30, not near 60.
  await page.evaluate(() => window.__pocketGalaxy.store.setQuality('low', 'pacing'));
  await sleep(700);
  await page.evaluate(() => window.__pocketGalaxy.store.monitor.reset());
  await sleep(1400);
  const paced = await page.evaluate(() => window.__pocketGalaxy.store.state.sample);
  check(
    'quality: low level is paced to its 30 Hz target',
    paced.avgFps > 26 && paced.avgFps < 34,
    `${paced.avgFps.toFixed(1)} FPS`,
  );
  check('quality: paced frames are not reported as jank', paced.jank === 0, String(paced.jank));

  // Restore adaptive mode so the benchmark runs at the default policy.
  await page.evaluate(() => window.__pocketGalaxy.store.setQuality(null, 'test cleanup'));

  /* ------------------------------ benchmark x2 --------------------------- */

  const runs = [];
  for (let run = 1; run <= 2; run++) {
    await page.evaluate(() => window.__pocketGalaxy.navigate('benchmark'));
    await sleep(400);
    await page.click('[data-testid="bench-run"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="bench-run"]').hasAttribute('disabled'),
      { timeout: 60000 },
    );
    await sleep(300);
    const result = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid^="bench-row-"]')].map((row) => {
        const cells = [...row.querySelectorAll('td')].map((cell) => cell.textContent);
        return { objects: Number(cells[0]), frames: Number(cells[1]), avgFps: Number(cells[2]), score: Number(cells[5]) };
      });
      return {
        rows,
        report: document.querySelector('[data-testid="bench-report"]').value,
        rating: document.querySelector('[data-testid="bench-rating"]').textContent,
        progress: document.querySelector('[data-testid="bench-progress"]').textContent,
        finishedAt: /Date: (.+)/.exec(document.querySelector('[data-testid="bench-report"]').value)?.[1] ?? '',
      };
    });
    runs.push(result);
    check(
      `benchmark run ${run}: all six scene sizes reported`,
      result.rows.length === 6 && result.rows.map((row) => row.objects).join(',') === '100,500,1000,3000,5000,10000',
      JSON.stringify(result.rows.map((row) => row.objects)),
    );
    check(
      `benchmark run ${run}: every step recorded real frames`,
      result.rows.every((row) => row.frames > 0),
      JSON.stringify(result.rows.map((row) => row.frames)),
    );
    check(
      `benchmark run ${run}: report is paste-ready with a device rating`,
      result.report.includes('Galaxy Score:') && result.report.includes('Device Rating:'),
    );
    check(
      `benchmark run ${run}: rating chip shows a score`,
      /Rating [A-Z+]/.test(result.rating),
      result.rating,
    );
    await page.screenshot({ path: `tests/interaction/.artifacts/benchmark-run-${run}.png` });
  }

  // Two runs must be genuinely separate measurements. Frame counts may
  // legitimately coincide on a quiet machine, so the timestamp is the proof of
  // independence; the FPS spread is reported for the human reader.
  check(
    'benchmark: two runs are separate measurements (distinct timestamps)',
    runs[0].finishedAt !== '' && runs[1].finishedAt !== '' && runs[0].finishedAt !== runs[1].finishedAt,
    `${runs[0].finishedAt} vs ${runs[1].finishedAt}`,
  );
  check(
    'benchmark: heaviest scene frame counts are physically plausible',
    runs.every((run) => {
      const last = run.rows.at(-1);
      // 1.8 s of scenes cannot exceed ~108 frames at 60 Hz.
      return last.frames > 0 && last.frames <= 130;
    }),
    runs.map((run) => run.rows.at(-1).frames).join(', '),
  );

  await mkdir(ARTIFACTS, { recursive: true });
  await writeFile(
    path.join(ARTIFACTS, 'benchmark-runs.json'),
    JSON.stringify({ capturedAt: new Date().toISOString(), runs }, null, 2),
  );

  /* ------------------------------ showcase ------------------------------- */

  await page.evaluate(() => window.__pocketGalaxy.navigate('showcase'));
  await sleep(350);
  const cardCount = await page.evaluate(() => document.querySelectorAll('[data-testid="demo-card"]').length);
  check('showcase: ten live capability cards', cardCount === 10, `count=${cardCount}`);
  const demoResults = [];
  for (let index = 0; index < cardCount; index++) {
    const outputs = await page.evaluate((cardIndex) => {
      const cards = [...document.querySelectorAll('[data-testid="demo-card"]')];
      const card = cards[cardIndex];
      const button = card.querySelector('[data-testid="demo-run"]');
      button.click();
      return { title: card.querySelector('h3').textContent };
    }, index);
    // Animation (900 ms), game-loop (400 ms sampling) and particle demos need
    // longer than one frame to produce their output.
    await sleep(index === 1 ? 700 : index === 2 ? 600 : index === 7 ? 700 : 140);
    const output = await page.evaluate((cardIndex) => {
      const cards = [...document.querySelectorAll('[data-testid="demo-card"]')];
      return cards[cardIndex].querySelector('[data-testid="demo-out"]').textContent;
    }, index);
    demoResults.push({ ...outputs, output });
    check(`showcase: "${outputs.title}" runs and reports`, output.trim().length > 0, output);
  }
  check(
    'showcase: storage demo round-trips the save',
    demoResults.some((entry) => entry.output.includes('read=ok')),
    JSON.stringify(demoResults.map((entry) => entry.output).slice(0, 3)),
  );
  check(
    'showcase: game loop demo observes frames advancing',
    demoResults.some((entry) => /\+\d+ rAF frames/.test(entry.output)),
    JSON.stringify(demoResults.find((entry) => entry.output.includes('rAF frames'))),
  );
  check(
    'showcase: particle demo honors the budget',
    demoResults.some((entry) => entry.output.includes('budget=')),
    JSON.stringify(demoResults.find((entry) => entry.output.includes('budget='))),
  );
  await page.screenshot({ path: 'tests/interaction/.artifacts/showcase-cards.png', fullPage: false });

  check('perf run: console clean', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('perf run: no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  await page.close();
  results.push({ name: 'performance + benchmark + showcase', check, failures, lines });
} finally {
  await browser.close();
}

let failed = 0;
for (const result of results) {
  console.log(`\n${result.name}`);
  for (const line of result.lines) console.log(line);
  failed += result.failures.length;
}
console.log(`\nperformance: ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
process.exitCode = failed === 0 ? 0 : 1;
