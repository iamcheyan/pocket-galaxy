// Build-time guard: no native form/dialog controls may appear in the UI source.
// The project mandates self-drawn controls, and this check is cheap insurance
// against a future edit reintroducing <select>, window.alert, etc.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');

const FORBIDDEN = [
  { pattern: /document\.createElement\(\s*['"`](select|option|dialog|input|textarea)['"`]/g, label: 'native form element' },
  { pattern: /\bwindow\.(alert|confirm|prompt)\s*\(|\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/g, label: 'native dialog call' },
  // JSX/markup tags only (a trailing > or a tag start), so prose and comments
  // that mention the element names do not trip the guard.
  { pattern: /<(select|dialog|option)[\s>]/gi, label: 'native control markup' },
  { pattern: /\bnew Notification\s*\(/g, label: 'native notification' },
];

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const problems = [];
for (const file of await walk(src)) {
  const source = await readFile(file, 'utf8');
  // Ignore comments: documentation may legitimately name the forbidden tags.
  const text = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const rule of FORBIDDEN) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text)) !== null) {
      const line = text.slice(0, match.index).split('\n').length;
      problems.push(`${path.relative(root, file)}:${line} ${rule.label} → ${match[0].trim()}`);
    }
  }
}

if (problems.length > 0) {
  console.error('Native control guard FAILED:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log('native control guard: PASS (no select/dialog/alert/input in src/)');
}
