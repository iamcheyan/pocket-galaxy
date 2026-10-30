#!/usr/bin/env node
// Verifies the ?v= cache-buster contract:
//   1. dist/app.js and dist/app.css match the fingerprint in asset-version.json
//   2. index.html references both with that exact version
//   3. dist/index.html mirrors index.html with the same version
// Fails loudly if a stale build or a hand-edited version would ship.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const meta = JSON.parse(await readFile(path.join(root, 'asset-version.json'), 'utf8'));
const [js, css] = await Promise.all([
  readFile(path.join(root, 'dist/app.js')),
  readFile(path.join(root, 'dist/app.css')),
]);
const fingerprint = createHash('sha256').update(js).update(css).digest('hex').slice(0, 10);
if (meta.fingerprint !== fingerprint) {
  problems.push(
    `asset-version.json fingerprint ${meta.fingerprint} != current build ${fingerprint} — run npm run build`,
  );
}

const indexHtml = await readFile(path.join(root, 'index.html'), 'utf8');
const cssVersion = /app\.css\?v=(\d+)/.exec(indexHtml)?.[1];
const jsVersion = /dist\/app\.js\?v=(\d+)/.exec(indexHtml)?.[1];
if (cssVersion !== String(meta.version)) {
  problems.push(`index.html css version ${cssVersion} != ${meta.version}`);
}
if (jsVersion !== String(meta.version)) {
  problems.push(`index.html js version ${jsVersion} != ${meta.version}`);
}
if (cssVersion !== jsVersion) {
  problems.push(`index.html JS and CSS versions differ (${jsVersion} vs ${cssVersion})`);
}
if (!new RegExp(`app\\.css\\?v=${meta.version}`).test(indexHtml.replace('./styles/', ''))) {
  problems.push('index.html does not reference the built stylesheet version');
}

try {
  const distIndex = await readFile(path.join(root, 'dist/index.html'), 'utf8');
  if (!distIndex.includes(`app.css?v=${meta.version}`)) {
    problems.push('dist/index.html is stale (stylesheet version mismatch)');
  }
  if (!distIndex.includes(`app.js?v=${meta.version}`)) {
    problems.push('dist/index.html is stale (script version mismatch)');
  }
} catch {
  problems.push('dist/index.html missing — run npm run build');
}

// Both HTML entry points must declare the same theme/layout defaults.
for (const file of ['index.html', 'dist/index.html']) {
  const text = file === 'index.html' ? indexHtml : await readFile(path.join(root, 'dist/index.html'), 'utf8');
  if (!/data-theme="(dark|light|oled)"/.test(text)) problems.push(`${file} has no data-theme default`);
  if (!/data-layout="(handheld|tablet|desktop|eink)"/.test(text)) problems.push(`${file} has no data-layout default`);
}

if (problems.length > 0) {
  console.error('cache-bust check FAILED:');
  for (const problem of problems) console.error(`  ✖ ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`cache-bust check: PASS (v=${meta.version}, fingerprint=${fingerprint})`);
}
