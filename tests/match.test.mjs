// Matcher regression test: every real model reply in photo-corpus.json goes
// through the app's own parser and USDA matcher, and the absurd matches found
// in November 2026 must not come back.
//
// Needs food-is-medicine checked out next to food-log, and Playwright (npm
// install in food-log, or a global install via NODE_PATH):
//   node food-log/tests/match.test.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './lib/pw.mjs';
import { startServer } from './lib/serve.mjs';

const { chromium } = loadPlaywright();
const here = path.dirname(fileURLToPath(import.meta.url));
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
  [/^burger$/i, /groundbeef/],
  // With the extended list: a dish that adds a meat the item never named.
  [/vegetable biryani/i, /^(uk-19-454|fn-58146)/],
  [/malai kofta/i, /^uk-19-594$/],
  [/fried egg/i, /^fn-75412010$/],
  [/tea with milk/i, /kombucha|hibiscus/],
  [/black pudding/i, /^uk-11-11/],
  [/salmon nigiri/i, /^uk-16-362$/],
  [/cooking oil/i, /cocoa/],
  [/paneer butter masala/i, /^uk-15-755$/]
];
// name pattern -> slug that SHOULD still be matched (when the item appears)
const EXPECTED = [
  [/^white rice, cooked$/i, /^ricewhitecooked$/],
  [/^chapati$|^roti/i, /^chapati$/],
  [/^fried egg$/i, /^eggfried$/],
  [/^spaghetti, cooked$/i, /^pastacooked$/],
  [/^plain yogurt|^white yogurt|^raita/i, /yogurt|yoghurt/],
  // A dal dish (FNDDS "Dal", lentils with ghee) is as right as plain cooked lentils.
  [/lentils, cooked|^dal\b/i, /lentilscooked|toordalcooked|^fn-41305050$/]
];

const server = await startServer();
const base = server.base;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base);
await page.waitForFunction(() => window.FoodLogInternals);
// Match against the whole list: the curated foods and the extended one
// (dishes, drinks, more cuts) that loads after the first page is drawn.
await page.waitForFunction(() => window.FoodsMore && window.FoodsMore.loaded() && window.FOODS.length > 10000, null, { timeout: 30000 });

// Single items seen in live runs after the corpus was recorded.
corpus.push({ model: 'live (Nov 2026)', photo: 'thali, vegetarian settings', text: JSON.stringify({ items: [
  { name: 'jeera rice', search: 'rice', cooked: true, grams: 150, grams_low: 120, grams_high: 190, kcal_per_100g: 150, confidence: 'high' }
] }) });
EXPECTED.push([/^jeera rice$/i, /^ricewhitecooked$|^ricebrowncooked$/]);
// A dish known by another name in the extended list: CoFID's chick pea curries.
corpus.push({ model: 'synthetic', photo: 'dish names', text: JSON.stringify({ items: [
  { name: 'chana masala', search: 'chickpeas', cooked: true, grams: 220, grams_low: 180, grams_high: 260, kcal_per_100g: 150, confidence: 'high' },
  { name: 'chicken curry', search: 'chicken', cooked: true, grams: 250, grams_low: 200, grams_high: 300, kcal_per_100g: 140, confidence: 'high' }
] }) });
EXPECTED.push([/^chana masala$/i, /^uk-15-(641|74\d)$/]);
EXPECTED.push([/^chicken curry$/i, /^fn-27146150$|^uk-/]);

const failures = [];
let checked = 0;
for (const r of corpus) {
  const rows = await page.evaluate((text) => {
    const parsed = window.Photo.parse(text);
    return window.FoodLogInternals.prepareItems(parsed.items).map((it) => {
      const f = it.slug && window.FOODS.find((x) => x.slug === it.slug);
      return { name: it.name, slug: it.slug, label: f ? f.name + ' (' + Math.round(f.nutrients.kcal) + ')' : '' };
    });
  }, r.text);
  console.log(`\n${r.model} · ${r.photo}`);
  for (const row of rows) {
    console.log(`  ${row.name.padEnd(44)} -> ${row.slug ? row.slug + '  ' + row.label : '(model estimate)'}`);
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
