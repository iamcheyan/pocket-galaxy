// Runs every interaction suite in sequence against a freshly started static
// server, and fails if any suite fails. One server, one Chromium per suite.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Picks a free loopback port so a stray dev server cannot collide with a run. */
async function freePort() {
  const { promise, resolve, reject } = Promise.withResolvers();
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    probe.close(() => resolve(port));
  });
  return promise;
}

const PORT = Number(process.env.PORT ?? (await freePort()));
const BASE = `http://127.0.0.1:${PORT}`;

const SUITES = ['responsive.mjs', 'themes.mjs', 'inputs.mjs', 'gameplay.mjs', 'performance.mjs'];

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await delay(150);
  }
  throw new Error(`server did not become ready at ${url}`);
}

const server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => {
  serverLog += String(chunk);
});
server.stderr.on('data', (chunk) => {
  serverLog += String(chunk);
});

const results = [];
try {
  await waitForServer(`${BASE}/index.html`);
  for (const suite of SUITES) {
    console.log(`\n=== ${suite} ===`);
    const child = spawn(process.execPath, [path.join(root, 'tests/interaction', suite)], {
      env: { ...process.env, GALAXY_URL: BASE },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Buffer as well as stream, so a failure can be replayed in the summary
    // instead of forcing a re-run of the whole suite to see which check failed.
    let output = '';
    const forward = (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    const code = await new Promise((resolve) => child.on('exit', resolve));
    const failedLines = output
      .split('\n')
      .filter((line) => line.includes('FAIL') || line.includes('✖'));
    results.push({ suite, code, failedLines, tail: output.split('\n').slice(-8).join('\n') });
  }
} finally {
  server.kill('SIGTERM');
}

const failed = results.filter((result) => result.code !== 0);
console.log('\n=== summary ===');
for (const result of results) {
  console.log(`${result.code === 0 ? 'PASS' : 'FAIL'}  ${result.suite}`);
  if (result.code !== 0) {
    for (const line of result.failedLines) console.log(`      ${line.trim()}`);
    if (result.failedLines.length === 0) {
      // No assertion failed, so the suite died — the tail is the only clue.
      console.log('      (crashed; last output)');
      for (const line of result.tail.split('\n')) console.log(`      | ${line}`);
    }
  }
}
if (failed.length > 0) {
  console.error(`\n${failed.length} suite(s) failed.`);
  if (serverLog.trim()) console.error(`server log:\n${serverLog}`);
  process.exitCode = 1;
} else {
  console.log('\nall interaction suites passed');
}
