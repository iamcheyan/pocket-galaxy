// Shared browser harness: launches one Chromium, records console/page errors,
// and exposes helpers used by every interaction test. A single browser instance
// is reused per test file to keep memory flat on this headless host.

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');
export const ARTIFACTS = path.join(ROOT, 'tests/interaction/.artifacts');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/run/current-system/sw/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);

const PUPPETEER_CANDIDATES = [
  process.env.PUPPETEER_CORE,
  path.join(ROOT, 'node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'),
];

export function chromePath() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('No Chromium found; set CHROME_PATH');
  return found;
}

export async function loadPuppeteer() {
  for (const candidate of PUPPETEER_CANDIDATES) {
    if (candidate && existsSync(candidate)) {
      const module = await import(candidate);
      return module.default ?? module;
    }
  }
  const module = await import('puppeteer-core');
  return module.default ?? module;
}

export async function launch() {
  const puppeteer = await loadPuppeteer();
  await mkdir(ARTIFACTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--hide-scrollbars',
      '--mute-audio',
      '--enable-precise-memory-info',
    ],
  });
  return browser;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function openPage(browser, viewport) {
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleErrors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(String(error?.message ?? error)));
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    // favicon/analytics noise must still be visible to the test, so record it.
    pageErrors.push(`requestfailed ${request.url()} ${failure?.errorText ?? ''}`.trim());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) pageErrors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  if (viewport) {
    await page.setViewport({ deviceScaleFactor: 1, ...viewport });
  }
  return { page, consoleErrors, pageErrors };
}

export async function gotoApp(page, baseUrl, query = '') {
  await page.goto(`${baseUrl}/${query}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__pocketGalaxy), { timeout: 15000 });
  await sleep(350);
}

export function makeCheck() {
  const failures = [];
  const lines = [];
  const check = (name, condition, detail = '') => {
    if (condition) {
      lines.push(`  ok   ${name}`);
    } else {
      failures.push(name);
      lines.push(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };
  return { check, failures, lines };
}

export async function overflowReport(page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const offenders = [];
    if (html.scrollWidth > html.clientWidth) {
      for (const node of document.querySelectorAll('*')) {
        const rect = node.getBoundingClientRect();
        if (rect.right > html.clientWidth + 1 && rect.width > 0) {
          offenders.push({
            tag: node.tagName.toLowerCase(),
            testid: node.getAttribute('data-testid') ?? '',
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          });
          if (offenders.length >= 6) break;
        }
      }
    }
    return {
      scrollWidth: html.scrollWidth,
      clientWidth: html.clientWidth,
      bodyScroll: body.scrollWidth,
      bodyClient: body.clientWidth,
      overflow: html.scrollWidth > html.clientWidth,
      offenders,
    };
  });
}

export function summarize(run, results) {
  const failed = results.flatMap((result) => result.failures);
  for (const result of results) {
    console.log(`\n${result.name}`);
    for (const line of result.lines) console.log(line);
  }
  console.log(`\n${run}: ${failed.length === 0 ? 'PASS' : `FAIL (${failed.length})`}`);
  for (const name of failed) console.log(`  ✖ ${name}`);
  return failed.length;
}
