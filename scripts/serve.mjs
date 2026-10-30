#!/usr/bin/env node
// Static file server for the built app. Deliberately tiny: `npm start` needs no
// dependencies beyond Node, and the same server is what the interaction tests
// and screenshot capture drive.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 8123);
const host = process.env.HOST ?? '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const resolved = path.resolve(root, `.${pathname}`);
  if (!resolved.startsWith(root)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(resolved);
    if (info.isDirectory()) {
      const index = path.join(resolved, 'index.html');
      const body = await readFile(index);
      response.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
      response.end(body);
      return;
    }
    const body = await readFile(resolved);
    response.writeHead(200, {
      'content-type': MIME[path.extname(resolved)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  }
});

server.listen(port, host, () => {
  console.log(`pocket-galaxy serving ${root} at http://${host}:${port}/`);
});
