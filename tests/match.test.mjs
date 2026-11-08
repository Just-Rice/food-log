// Matcher regression test: every real model reply in photo-corpus.json goes
// through the app's own parser and USDA matcher, and the absurd matches found
// in November 2026 must not come back.
//
// Run from the folder that holds both food-log and food-is-medicine:
//   node food-log/tests/match.test.mjs
// Needs Playwright (npm i playwright, or a global install).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'photo-corpus.json'), 'utf8')).replies;

// name pattern -> slug pattern that must NOT be auto-matched
const FORBIDDEN = [
  [/french fries/i, /bean/],
  [/black pudding/i, /blackeyed|cowpea/],
  [/kofta/i, /cream/],
  [/burger/i, /^bacon$/],
  [/bolognese/i, /liver/],
  [/soup/i, /milk/],
  [/nigiri|sushi/i, /salmon|sockeye|chinook|coho|chum/],
  [/makhani|masala/i, /^paneer$/],
  [/curry/i, /powder/],
  [/fried bread|puri/i, /^egg/],
  [/\btea\b/i, /epazote/],
  [/^burger$/i, /groundbeef/]
];
// name pattern -> slug that SHOULD still be matched (when the item appears)
const EXPECTED = [
  [/^white rice, cooked$/i, /^ricewhitecooked$/],
  [/^chapati$|^roti/i, /^chapati$/],
  [/^fried egg$/i, /^eggfried$/],
  [/^spaghetti, cooked$/i, /^pastacooked$/],
  [/^plain yogurt|^white yogurt|^raita/i, /yogurt|yoghurt/],
  [/lentils, cooked|^dal\b/i, /lentilscooked|toordalcooked/]
];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, r));
const base = 'http://localhost:' + server.address().port + '/food-log/';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base);
await page.waitForFunction(() => window.FoodLogInternals);

const failures = [];
let checked = 0;
for (const r of corpus) {
  const rows = await page.evaluate((text) => {
    const parsed = window.Photo.parse(text);
    return window.FoodLogInternals.prepareItems(parsed.items).map((it) => ({ name: it.name, slug: it.slug }));
  }, r.text);
  console.log(`\n${r.model} · ${r.photo}`);
  for (const row of rows) {
    console.log(`  ${row.name.padEnd(44)} -> ${row.slug || '(model estimate)'}`);
    for (const [n, s] of FORBIDDEN) {
      if (n.test(row.name) && row.slug && s.test(row.slug)) failures.push(`${r.model} ${r.photo}: "${row.name}" matched ${row.slug}`);
    }
    for (const [n, s] of EXPECTED) {
      if (n.test(row.name)) {
        checked++;
        if (!row.slug || !s.test(row.slug)) failures.push(`${r.model} ${r.photo}: "${row.name}" should match ${s}, got ${row.slug || 'nothing'}`);
      }
    }
  }
}
await browser.close();
server.close();

console.log(`\n${corpus.length} replies, ${checked} expected matches checked.`);
if (failures.length) {
  console.log(failures.length + ' FAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('ALL PASSED');
