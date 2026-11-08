// Shared plumbing for the browser suites in tests/e2e/: PASS/FAIL reporting,
// a browser context that cannot reach the internet, and a console-error
// collector that ignores the noise the tests cause themselves.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './pw.mjs';
import { startServer, REPO_DIR, ROOT_DIR } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.resolve(here, '..', 'fixtures');
export { REPO_DIR, ROOT_DIR, startServer, loadPlaywright };

/** Any JPEG will do as "the meal photo": every model reply is mocked. */
export const MEAL_PHOTO = path.join(ROOT_DIR, 'food-is-medicine', 'img', 'apple.jpg');

export const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

/** Screenshots are for people, not assertions: only taken when SHOTS_DIR is set. */
export function shot(page, name, opts = {}) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return Promise.resolve();
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ ...opts, path: path.join(dir, name) });
}

export function makeChecker() {
  const fails = [];
  const check = (cond, msg) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + msg);
    if (!cond) fails.push(msg);
  };
  return { check, fails };
}

const allContexts = [];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
export const isLocal = (u) => {
  const url = typeof u === 'string' ? new URL(u) : u;
  return !/^https?:$/.test(url.protocol) || LOCAL_HOSTS.has(url.hostname);
};

/**
 * A new context that never touches the real network: every request that
 * leaves localhost (Firebase SDK on gstatic, reCAPTCHA, Gemini, Open Food
 * Facts, ...) is aborted unless a page.route() mock answers it first --
 * page routes take precedence over context routes. No service worker is ever
 * registered, so none can fetch around the routes: registration just stays
 * pending, which app code has to cope with anyway. (Playwright's own
 * serviceWorkers: 'block' resolves register() with undefined instead, which
 * real browsers never do.)
 */
export async function isolatedContext(browser, options = {}) {
  const ctx = await browser.newContext(options);
  await ctx.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  ctx.blocked = [];
  allContexts.push(ctx);
  await ctx.route((url) => !isLocal(url), (route) => {
    ctx.blocked.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  return ctx;
}

/**
 * Collects page errors and console errors into `errs`, skipping reCAPTCHA
 * noise and the "failed to load" errors for requests the test aborted itself.
 * `extraIgnore(msg)` can skip more.
 */
export function collectErrors(page, errs, { prefix = '', extraIgnore } = {}) {
  page.on('pageerror', (e) => errs.push(prefix + e.message));
  const blocked = page.context().blocked || [];
  const ignored = (text, where, m) =>
    /requestStorageAccess|recaptcha/i.test(text) ||
    (where && blocked.includes(where)) ||           // a request we aborted (gstatic etc.)
    /ERR_BLOCKED_BY_CLIENT/.test(text) ||           // ditto, when Chrome gives no location
    (extraIgnore && extraIgnore(m));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    const where = (m.location() || {}).url || '';
    if (ignored(text, where, m)) {
      if (process.env.DEBUG_TESTS) console.log('   (ignored console error: ' + text + ' @ ' + where + ')');
      return;
    }
    errs.push(prefix + text + (where ? ' @ ' + where : ''));
  });
  return errs;
}

/** Mock the Gemini API (own-key engine): :generateContent answers with `text`. */
export function mockGemini(page, replyText, { models, onCall } = {}) {
  return page.route('https://generativelanguage.googleapis.com/**', (route) => {
    const u = route.request().url();
    if (u.includes(':generateContent')) {
      if (onCall) onCall(u);
      const text = typeof replyText === 'function' ? replyText(u) : replyText;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ models: models || [] }) });
  });
}

/**
 * Runs a suite: starts the server and browser, calls body({ base, browser,
 * check, ... }), prints the verdict and exits non-zero on any failure or crash.
 * opts.launch is passed to chromium.launch (e.g. fake-camera flags).
 */
export async function runSuite(name, body, opts = {}) {
  const { chromium, devices } = loadPlaywright();
  const { check, fails } = makeChecker();
  let server, browser, code = 0;
  const kill = setTimeout(() => {
    console.error('TIMEOUT ' + name + ' did not finish in 5 minutes');
    process.exit(1);
  }, 5 * 60 * 1000);
  kill.unref();
  try {
    server = await startServer();
    browser = await chromium.launch(opts.launch || {});
    await body({ base: server.base, browser, devices, check });
    const hosts = {};
    allContexts.flatMap((c) => c.blocked).forEach((u) => { const h = new URL(u).host; hosts[h] = (hosts[h] || 0) + 1; });
    if (Object.keys(hosts).length) {
      console.log('   (outside requests aborted: ' + Object.entries(hosts).map(([h, n]) => h + ' ×' + n).join(', ') + ')');
    }
    console.log(fails.length ? '\n' + fails.length + ' FAILED (' + name + ')' : '\nALL PASSED (' + name + ')');
    code = fails.length ? 1 : 0;
  } catch (e) {
    console.error('CRASH ' + name, e);
    code = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }
  process.exit(code);
}
