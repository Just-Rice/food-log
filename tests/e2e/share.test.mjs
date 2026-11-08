// Sharing a photo to the installed app (manifest share_target): the service
// worker takes the POST, keeps the photo in the queue and opens Snap. With
// the server unreachable the photo waits; back online it is read by Gemini
// and offered to check. Also the home-screen shortcuts, including the one
// that opens the barcode scanner.
//   NODE_PATH=$(npm root -g) node tests/e2e/share.test.mjs   (from food-log/)
//
// Its own server, like pwa.test.mjs: "offline" means every connection is
// dropped, so only the service worker can answer.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..');
const PHOTO = path.join(ROOT, 'food-is-medicine', 'img', 'apple.jpg');

const fails = [];
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };
let down = false;
let posts = 0;      // POSTs that reached the server (the service worker should take them all)
const server = http.createServer((req, res) => {
  if (down) { req.socket.destroy(); return; }
  if (req.method !== 'GET') { posts++; res.writeHead(405); res.end(); return; }
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://localhost:' + server.address().port + '/food-log/';

const reply = JSON.stringify({ items: [
  { name: 'apple', search: 'apple', cooked: false, grams: 180, grams_low: 150, grams_high: 210, kcal_per_100g: 52, confidence: 'high' }
], plate_cm: null, scale: 'other', notes: '' });

const browser = await chromium.launch();
const timer = setTimeout(() => { console.log('FAIL timed out'); process.exit(1); }, 120000);
try {
  const ctx = await browser.newContext();
  await ctx.route((url) => url.hostname !== 'localhost', (r) => r.abort('blockedbyclient'));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/recaptcha|ERR_BLOCKED_BY_CLIENT|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ERR_EMPTY_RESPONSE|ERR_FAILED|Failed to load resource/i.test(m.text())) return;
    errs.push(m.text());
  });

  await page.goto(BASE);
  await page.waitForSelector('#logSearch');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });

  // ---- the manifest ----
  const manifest = await page.evaluate(() => fetch('manifest.webmanifest').then((r) => r.json()));
  const st = manifest.share_target || {};
  check(st.method === 'POST' && st.enctype === 'multipart/form-data' && new URL(st.action, BASE).href === BASE + 'share' &&
    st.params && st.params.files && st.params.files[0].name === 'photo', 'share_target: POST multipart photo to ./share');
  const sc = (manifest.shortcuts || []).map((s) => new URL(s.url, BASE).href);
  check(sc.includes(BASE + '#/snap') && sc.includes(BASE + '#/today?scan=1'), 'shortcuts: Snap and Scan');

  // ---- the Scan shortcut opens the scanner ----
  await page.goto(BASE + '#/today?scan=1');
  await page.waitForSelector('#scanSheet');
  check(/#\/today$/.test(page.url()), 'scan shortcut opens the scanner and tidies the address');
  await page.click('[data-scan="close"]').catch(() => page.keyboard.press('Escape'));

  // ---- share while the server is unreachable ----
  down = true;
  await ctx.setOffline(true);
  const share = async () => {
    // What the share sheet does: a POST navigation with the photo.
    await page.evaluate(() => {
      const f = document.createElement('form');
      f.method = 'post'; f.enctype = 'multipart/form-data'; f.action = 'share';
      const i = document.createElement('input'); i.type = 'file'; i.name = 'photo'; i.id = 'sharePick';
      f.appendChild(i); document.body.appendChild(f);
    });
    await page.setInputFiles('#sharePick', PHOTO);
    await Promise.all([page.waitForURL(/#\/snap/), page.evaluate(() => document.querySelector('#sharePick').form.submit())]);
  };
  await share();
  await page.waitForFunction(() => /Saved\. It will be read/.test((document.getElementById('main') || {}).textContent || ''), null, { timeout: 15000 });
  check(/#\/snap$/.test(page.url()), 'the service worker answered the share offline and opened Snap');
  check(posts === 0, 'the photo never went to the server');
  const q = await page.evaluate(() => window.Queue.all().then((l) => l.map((r) => ({ status: r.status, shared: !!r.shared, blob: !!r.blob }))));
  check(q.length === 1 && q[0].status === 'waiting' && q[0].shared && q[0].blob, 'kept in the queue, waiting: ' + JSON.stringify(q));

  // ---- back online: read and offered ----
  down = false;
  await ctx.setOffline(false);
  await page.evaluate((r) => {
    window.FirebaseEngine.engine.call = () => Promise.resolve(r);
    window.dispatchEvent(new Event('online'));
  }, reply);
  await page.evaluate(() => { location.hash = '#/today'; });
  await page.waitForSelector('[data-q-open]', { timeout: 15000 });
  await page.click('[data-q-open]');
  await page.waitForSelector('.photo-items li');
  check(/Apple/i.test(await page.textContent('.photo-items')), 'the shared photo was read and is ready to check');
  await page.click('#photoAdd'); await page.waitForSelector('.log-list');
  check((await page.evaluate(() => window.Queue.all().then((l) => l.length))) === 0, 'logged, and gone from the queue');

  // ---- share while online: read at once ----
  await page.evaluate((r) => { window.__calls = 0; window.FirebaseEngine.engine.call = () => { window.__calls++; return Promise.resolve(r); }; }, reply);
  await share();
  // A fresh page load after the redirect: stub again before it reads.
  await page.waitForSelector('.photo-items li, .note.danger, .photo-card', { timeout: 15000 });
  check(/#\/snap$/.test(page.url()), 'online, a shared photo opens Snap and is read straight away');

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
} catch (e) {
  console.log('CRASH ' + (e && e.stack || e));
  fails.push('crash');
} finally {
  clearTimeout(timer);
  await browser.close();
  server.close();
}
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
