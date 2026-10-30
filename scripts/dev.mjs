#!/usr/bin/env node
// Dev loop: rebuild on change and serve. No watch dependency — a small fs.watch
// over src/ and styles/ plus a debounce is enough for a project this size.

import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let building = false;
let queued = false;

const runBuild = async () => {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  const child = spawn(process.execPath, [path.join(root, 'scripts/build.mjs')], { stdio: 'inherit' });
  await new Promise((resolve) => child.on('exit', resolve));
  building = false;
  if (queued) {
    queued = false;
    void runBuild();
  }
};

await runBuild();
const server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs')], { stdio: 'inherit' });
process.on('SIGINT', () => {
  server.kill('SIGINT');
  process.exit(0);
});

let timer = null;
const schedule = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void runBuild(), 120);
};
for (const target of ['src', 'styles', 'index.html']) {
  watch(path.join(root, target), { recursive: true }, schedule);
}
console.log('watching src/, styles/, index.html for changes…');
