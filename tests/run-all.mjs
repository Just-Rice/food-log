// Runs every test, one after another, and exits 1 if any failed:
//   tests/match.test.mjs, tests/sync.test.mjs, any other tests/*.test.mjs and
//   tests/unit/*.test.mjs, then every browser suite in tests/e2e/.
// New files matching those patterns are picked up automatically.
//
//   npm test                      (or: node tests/run-all.mjs)
//   npm test -- diet engines      only the tests whose path contains a word
//
// Browser tests need Playwright: `npm install` here, or a global install with
// NODE_PATH=$(npm root -g). SHOTS_DIR=dir saves the e2e screenshots.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const PER_TEST_TIMEOUT = 10 * 60 * 1000;

const list = (dir) => {
  const abs = path.join(here, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => f.endsWith('.test.mjs')).sort()
    .map((f) => path.join('tests', dir, f));
};

const ordered = ['tests/match.test.mjs', 'tests/sync.test.mjs']
  .filter((f) => fs.existsSync(path.join(repo, f)))
  .concat(list('.'), list('unit'), list('e2e'))
  .map((f) => path.normalize(f));
let files = [...new Set(ordered)];

const filters = process.argv.slice(2);
if (filters.length) files = files.filter((f) => filters.some((w) => f.includes(w)));
if (!files.length) { console.error('No tests matched.'); process.exit(1); }

function run(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [file], {
      cwd: repo, stdio: 'inherit', env: process.env, timeout: PER_TEST_TIMEOUT, killSignal: 'SIGKILL'
    });
    child.on('error', (err) => resolve({ file, code: 1, note: err.message, ms: Date.now() - t0 }));
    child.on('exit', (code, signal) => resolve({
      file, code: code === null ? 1 : code, note: signal ? 'killed (' + signal + ')' : '', ms: Date.now() - t0
    }));
  });
}

const results = [];
for (const file of files) {
  console.log('\n=== ' + file + ' ' + '='.repeat(Math.max(0, 66 - file.length)));
  results.push(await run(file));
}

const w = Math.max(...results.map((r) => r.file.length));
console.log('\n' + 'Test'.padEnd(w) + '  Result  Time');
console.log('-'.repeat(w + 16));
for (const r of results) {
  console.log(r.file.padEnd(w) + '  ' + (r.code === 0 ? 'pass  ' : 'FAIL  ') + '  ' +
    (r.ms / 1000).toFixed(1).padStart(5) + 's' + (r.note ? '  ' + r.note : ''));
}
const failed = results.filter((r) => r.code !== 0);
console.log('-'.repeat(w + 16));
console.log(failed.length ? failed.length + ' of ' + results.length + ' FAILED' : 'All ' + results.length + ' passed');
process.exit(failed.length ? 1 : 0);
