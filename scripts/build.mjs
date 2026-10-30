#!/usr/bin/env node
// Build: bundles src/main.ts → dist/app.js and copies styles, then rewrites the
// ?v= cache-busters in index.html from a content fingerprint. Any JS/CSS change
// therefore produces a new version string, which the acceptance check verifies.

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

await mkdir(dist, { recursive: true });

const result = await build({
  entryPoints: [path.join(root, 'src/main.ts')],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  outfile: path.join(dist, 'app.js'),
  sourcemap: true,
  minify: false,
  logLevel: 'warning',
  metafile: true,
});

await mkdir(path.join(root, 'styles'), { recursive: true });
await copyFile(path.join(root, 'styles/app.css'), path.join(dist, 'app.css'));

const [js, css] = await Promise.all([
  readFile(path.join(dist, 'app.js')),
  readFile(path.join(dist, 'app.css')),
]);

// Pointer-cursor style marker for tests that read the build id.
const fingerprint = createHash('sha256').update(js).update(css).digest('hex').slice(0, 10);

const assetVersionPath = path.join(root, 'asset-version.json');
let version = 1;
try {
  const previous = JSON.parse(await readFile(assetVersionPath, 'utf8'));
  version = Number(previous.version) || 1;
  if (previous.fingerprint && previous.fingerprint !== fingerprint) version += 1;
} catch {
  version = 1;
}
await writeFile(assetVersionPath, `${JSON.stringify({ version, fingerprint }, null, 2)}\n`);

const indexHtml = await readFile(path.join(root, 'index.html'), 'utf8');
const versioned = indexHtml
  .replace(/app\.css\?v=\d+/g, `app.css?v=${version}`)
  .replace(/dist\/app\.js\?v=\d+/g, `dist/app.js?v=${version}`);
await writeFile(path.join(root, 'index.html'), versioned);
await writeFile(
  path.join(dist, 'index.html'),
  versioned.replace('./styles/app.css', './app.css').replace('./dist/app.js', './app.js'),
);

const inputs = Object.keys(result.metafile?.inputs ?? {});
const sizeKb = (js.byteLength / 1024).toFixed(1);
console.log(`built dist/app.js (${sizeKb} KB, ${inputs.length} modules) + dist/app.css`);
console.log(`asset version v=${version} fingerprint=${fingerprint}`);
