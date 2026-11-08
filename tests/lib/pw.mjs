// Load Playwright from this repo's node_modules (CI: `npm install`) or, failing
// that, from a global install (NODE_PATH entries, then `npm root -g`).
//
//   const { chromium, devices } = loadPlaywright();

import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(here, '..', '..');
const require = createRequire(path.join(REPO_DIR, 'package.json'));

function nodePathEntries() {
  return (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
}

function npmGlobalRoot() {
  try { return execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (e) { return null; }
}

let cached = null;

export function loadPlaywright() {
  if (cached) return cached;
  const paths = [REPO_DIR, ...nodePathEntries()];
  let resolved;
  try {
    resolved = require.resolve('playwright', { paths });
  } catch (e) {
    const globalRoot = npmGlobalRoot();
    if (!globalRoot) throw e;
    try {
      resolved = require.resolve('playwright', { paths: [...paths, globalRoot] });
    } catch (e2) {
      throw new Error('Playwright not found. Run `npm install` in food-log, or set NODE_PATH to a ' +
        'global node_modules that has it (NODE_PATH=$(npm root -g)).');
    }
  }
  cached = require(resolved);
  return cached;
}
