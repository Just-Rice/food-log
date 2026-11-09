// Installable and offline: the manifest and its icons, the service worker,
// a reload with the network gone (app shell, offline banner, food search from
// the cached data), a deploy picked up on the next online load, and the
// banner going away when the connection returns.
//   NODE_PATH=$(npm root -g) node tests/e2e/pwa.test.mjs   (from food-log/)
//
// Serves the folder that holds food-log and food-is-medicine, as GitHub Pages
// does. Its own small server rather than tests/lib: "offline" here means the
// server drops every connection, so nothing can reach it, service worker
// included, whatever the browser's offline emulation covers.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..');

const fails = [];
const check = (cond, msg) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) fails.push(msg);
};

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'
};
let down = false;    // true: every connection is dropped
let build = '';      // non-empty: index.html as a new deploy, with this marker
const server = http.createServer((req, res) => {
  if (down) { req.socket.destroy(); return; }
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    if (build && p === '/food-log/index.html') data = String(data).replace('</body>', '<!-- build ' + build + ' -->\n</body>');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, r));
const ORIGIN = 'http://localhost:' + server.address().port;
const BASE = ORIGIN + '/food-log/';

const pngSize = (buf) => buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG'
  ? buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20) : null;

const browser = await chromium.launch();
const timer = setTimeout(() => { console.log('FAIL timed out'); process.exit(1); }, 120000);
try {
  const ctx = await browser.newContext();
  // No real network. The hosts whose caching is tested get a stub answer, and
  // each request records whether the service worker made it (it handled the
  // request) or the page did (the worker left it to the browser). Playwright
  // routes the worker's own fetches too.
  const STUB = /^https:\/\/(cdn\.jsdelivr\.net|www\.gstatic\.com\/firebasejs|world\.openfoodfacts\.org|huggingface\.co|firebasevertexai\.googleapis\.com)\//;
  const blocked = [];
  const external = [];
  await ctx.route((url) => url.hostname !== 'localhost', (route) => {
    const req = route.request();
    external.push({ url: req.url(), method: req.method(), bySW: !!req.serviceWorker() });
    if (!STUB.test(req.url())) {
      blocked.push(req.url());
      return route.abort('blockedbyclient');
    }
    return route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'stub' });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = (m.location() && m.location().url) || '';
    const text = m.text();
    // Aborted or offline loads say so in the console; that is the test, not a bug.
    if (/recaptcha|requestStorageAccess|ERR_BLOCKED_BY_CLIENT|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ERR_EMPTY_RESPONSE|ERR_FAILED/i.test(text)) return;
    if (/Failed to load resource/.test(text) && (down || blocked.includes(where))) return;
    errs.push(text + (where ? ' (' + where + ')' : ''));
  });

  // ---- first visit -------------------------------------------------------------
  await page.goto(BASE);
  await page.waitForSelector('#logSearch');

  // Manifest and icons.
  const links = await page.evaluate(() => ({
    manifest: document.querySelector('link[rel="manifest"]') && document.querySelector('link[rel="manifest"]').href,
    touch: document.querySelector('link[rel="apple-touch-icon"]') && document.querySelector('link[rel="apple-touch-icon"]').href,
    theme: document.querySelector('meta[name="theme-color"]') && document.querySelector('meta[name="theme-color"]').content
  }));
  check(links.manifest === BASE + 'manifest.webmanifest', 'manifest is linked');
  const mres = await fetch(links.manifest);
  let manifest = null;
  try { manifest = JSON.parse(await mres.text()); } catch (e) { /* reported below */ }
  check(mres.status === 200 && manifest, 'manifest fetches as valid JSON');
  manifest = manifest || {};
  check(manifest.name === 'Food Log' && manifest.short_name === 'Food Log' && manifest.display === 'standalone',
    'name, short_name, display standalone');
  check(new URL(manifest.start_url, links.manifest).href === BASE + '#/today' && new URL(manifest.scope, links.manifest).href === BASE,
    'start_url ./#/today and scope ./ resolve inside the site');
  check(manifest.theme_color === links.theme && manifest.theme_color === '#2f6b3f', 'theme_color matches the page');
  const icons = (manifest.icons || []).concat(links.touch ? [{ src: links.touch, sizes: '180x180', purpose: 'apple-touch-icon' }] : []);
  check(icons.some((i) => i.sizes === '192x192') && icons.some((i) => i.sizes === '512x512' && i.purpose === 'any') &&
    icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'), 'icons: 192, 512 and a 512 maskable');
  for (const icon of icons) {
    const r = await fetch(new URL(icon.src, links.manifest));
    const size = pngSize(Buffer.from(await r.arrayBuffer()));
    check(r.status === 200 && r.headers.get('content-type') === 'image/png' && size === icon.sizes,
      'icon ' + icon.src.replace(BASE, '') + ' (' + icon.purpose + '): 200, image/png, ' + size);
  }

  // Service worker.
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, script: r.active && r.active.scriptURL };
  });
  check(reg.scope === BASE && reg.script === BASE + 'sw.js', 'service worker active for ' + reg.scope);
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
  check(true, 'it controls the page (clients.claim)');
  const cached = await page.evaluate(async () => {
    const out = {};
    for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).map((r) => r.url);
    return out;
  });
  const flat = Object.values(cached).flat();
  check(Object.keys(cached).every((n) => n.startsWith('food-log-')), 'caches: ' + Object.keys(cached).join(', '));
  for (const f of ['food-log/', 'food-log/index.html', 'food-log/css/style.css', 'food-log/js/app.js', 'food-log/js/pwa.js',
    'food-log/js/local-worker.js', 'food-is-medicine/data/foods.js', 'food-is-medicine/data/images.js', 'food-is-medicine/data/dri.js',
    'food-is-medicine/data/foods-more.js']) {
    check(flat.includes(ORIGIN + '/' + f), 'precached ' + f);
  }
  const scripts = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean));
  check(scripts.every((s) => flat.includes(s)), 'every script the page loads is precached (' + scripts.length + ')');

  // ---- what the worker does with each kind of request ------------------------------
  const PINNED = ['https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js',
    'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'];
  const LEFT = ['https://cdn.jsdelivr.net/npm/barcode-detector@3/dist/es/ponyfill.js', // not an exact version
    'https://world.openfoodfacts.org/api/v2/product/737628064502.json',
    'https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/main/config.json'];
  const POST = 'https://firebasevertexai.googleapis.com/v1beta/projects/x/models/y:generateContent';
  const IMG = ORIGIN + '/food-is-medicine/img/apple.jpg';
  external.length = 0;
  const got = await page.evaluate(async ({ urls, post, img }) => {
    const out = {};
    for (const u of urls) out[u] = (await fetch(u)).status;
    out[urls[0] + ' again'] = (await fetch(urls[0])).status;
    out[post] = (await fetch(post, { method: 'POST', body: '{}' })).status;
    out[img] = (await fetch(img)).status;
    // Let the worker finish its cache writes.
    await new Promise((r) => setTimeout(r, 300));
    const names = await caches.keys();
    const cached = {};
    for (const n of names) for (const r of await (await caches.open(n)).keys()) cached[r.url] = n;
    return { out, cached };
  }, { urls: PINNED.concat(LEFT), post: POST, img: IMG });
  const by = (u) => external.filter((e) => e.url === u);
  for (const u of PINNED) {
    check(got.cached[u] === 'food-log-libs-v1' && by(u).length === 1 && by(u)[0].bySW,
      'cache first, kept in food-log-libs: ' + u.replace(/^https:\/\//, ''));
  }
  check(by(PINNED[0]).length === 1 && got.out[PINNED[0] + ' again'] === 200, 'the second fetch of a pinned library never leaves the cache');
  for (const u of LEFT) {
    check(!got.cached[u] && by(u).length === 1 && !by(u)[0].bySW, 'left to the browser, not cached: ' + u.replace(/^https:\/\//, ''));
  }
  check(by(POST).length === 1 && by(POST)[0].method === 'POST' && !by(POST)[0].bySW, 'POST to the AI API left to the browser');
  check(got.out[IMG] === 200 && got.cached[IMG] === 'food-log-data-v1', 'a Food is Medicine photo is kept in food-log-data');

  // ---- a deploy, online --------------------------------------------------------
  build = 'B';
  await page.reload();
  await page.waitForSelector('#logSearch');
  check((await page.content()).includes('<!-- build B -->'), 'online reload gets the new deploy (network first)');

  // ---- offline -----------------------------------------------------------------
  down = true;
  await ctx.setOffline(true);
  const nav = await page.reload().catch(() => null);
  check(nav && nav.ok() && nav.fromServiceWorker(), 'offline reload is answered by the service worker');
  await page.waitForSelector('#logSearch', { timeout: 10000 }).catch(() => {});
  const main = await page.evaluate(() => document.getElementById('main') && document.getElementById('main').innerText.trim().length);
  check(main > 0 && await page.$('#logSearch'), 'offline reload: app shell renders, search box present');
  check((await page.content()).includes('<!-- build B -->'), 'offline copy is the latest deploy, not the install-time one');
  check(await page.evaluate(() => window.PWA && PWA.online() === false), 'PWA.online() is false');
  await page.waitForFunction(() => {
    const b = document.getElementById('offlineBanner');
    return b && b.textContent.length > 0;
  }, null, { timeout: 5000 }).catch(() => {});
  const banner = await page.evaluate(() => {
    const b = document.getElementById('offlineBanner');
    return b && { role: b.getAttribute('role'), text: b.textContent, first: document.body.firstElementChild === b, visible: b.offsetHeight > 0 };
  });
  check(banner && banner.role === 'status' && banner.first && banner.visible, 'offline banner shown at the top of the page, role=status');
  check(banner && /^You’re offline\. Search and your log still work/.test(banner.text), 'banner text: ' + (banner && banner.text));
  await page.fill('#logSearch', 'rice');
  await page.waitForSelector('#logSuggest button', { timeout: 5000 }).catch(() => {});
  const hitsText = await page.evaluate(() => [...document.querySelectorAll('#logSuggest button')].map((b) => b.textContent));
  check(hitsText.some((t) => /rice/i.test(t)), 'search for "rice" works offline: ' + (hitsText[0] || 'no results'));
  const offlineGot = await page.evaluate(async (urls) => {
    const out = [];
    for (const u of urls) out.push(await fetch(u).then((r) => r.status, () => 'failed'));
    return out;
  }, [PINNED[0], IMG]);
  check(offlineGot[0] === 200 && offlineGot[1] === 200, 'offline: a cached library and a viewed photo still load (' + offlineGot.join(', ') + ')');

  // ---- back online ---------------------------------------------------------------
  down = false;
  await ctx.setOffline(false);
  const gone = await page.waitForSelector('#offlineBanner', { state: 'detached', timeout: 5000 }).then(() => true, () => false);
  check(gone && await page.evaluate(() => PWA.online()), 'back online: banner removed, PWA.online() is true');

  // ---- reminders download ---------------------------------------------------------
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.evaluate(() => Reminders.download({ times: [{ label: 'Breakfast', time: '08:00' }] }))
  ]);
  const icsText = fs.readFileSync(await dl.path(), 'utf8');
  check(dl.suggestedFilename() === 'food-log-reminders.ics' && /^BEGIN:VCALENDAR\r\n/.test(icsText) &&
    icsText.includes('SUMMARY:Log Breakfast in Food Log'), 'Reminders.download saves food-log-reminders.ics');

  check(errs.length === 0, 'no unexpected console errors' + (errs.length ? ':\n  ' + errs.join('\n  ') : ''));

  // ---- opened as a file -----------------------------------------------------------
  const fileCtx = await browser.newContext();
  await fileCtx.route((url) => /^https?:$/.test(url.protocol), (route) => route.abort('blockedbyclient'));
  const fp = await fileCtx.newPage();
  const fileErrs = [];
  fp.on('pageerror', (e) => fileErrs.push(e.message));
  await fp.goto('file://' + path.join(ROOT, 'food-log', 'index.html'));
  await fp.waitForSelector('#logSearch', { timeout: 10000 }).catch(() => {});
  const fileState = await fp.evaluate(() => ({ pwa: !!window.PWA, reminders: !!window.Reminders, online: window.PWA && PWA.online() }));
  check(fileState.pwa && fileState.reminders && fileErrs.length === 0,
    'file:// page: PWA and Reminders load, no errors' + (fileErrs.length ? ': ' + fileErrs.join('; ') : ''));
  await fileCtx.close();
} catch (e) {
  check(false, 'threw: ' + (e && e.stack || e));
} finally {
  clearTimeout(timer);
  await browser.close();
  server.close();
}

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
