// Barcodes: typed and camera-scanned codes, Open Food Facts mapping, the
// clash warning with dietary settings, unknown products, recent foods.
// Open Food Facts is route-mocked; the camera is Chromium's fake device with
// a stubbed BarcodeDetector.
//   NODE_PATH=$(npm root -g) node tests/e2e/barcode.test.mjs   (from food-log/)

import { runSuite, isolatedContext, collectErrors } from '../lib/harness.mjs';

const product = { status: 1, product: { product_name: 'Hazelnut spread', brands: 'TestBrand', serving_size: '15 g', serving_quantity: 15,
  nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, sugars_100g: 56.3, fat_100g: 30.9, 'saturated-fat_100g': 10.6, salt_100g: 0.1075 },
  allergens_tags: ['en:nuts', 'en:milk'], traces_tags: ['en:soybeans'], ingredients_analysis_tags: ['en:vegetarian'] } };

await runSuite('barcode', async ({ base: BASE, browser: b, check }) => {
  const ctx = await isolatedContext(b, { viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  // The mocked 404 for an unknown product is logged by the browser like any 404.
  collectErrors(p, errs, { extraIgnore: (m) => /openfoodfacts\.org\/api\/v2\/product\/5000159407236/.test((m.location() || {}).url || '') });
  await p.route('https://world.openfoodfacts.org/api/v2/product/**', (r) => {
    if (r.request().url().includes('3017624010701')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(product) });
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{"status":0,"status_verbose":"product not found"}' });
  });
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('fim.prefs.v1', JSON.stringify({ diet: 'none', allergens: ['milk'], customExclude: '' })); });
  await p.reload(); await p.waitForSelector('#scanBtn');

  check(await p.evaluate(() => [['3017624010701', true], ['96385074', true], ['036000291452', true], ['3017624010700', false], ['123', false]]
    .every(([c, ok]) => window.Barcode.validCode(c) === ok)), 'check digits validated (EAN-13, EAN-8, UPC-A)');

  // Typed number.
  await p.click('#scanBtn'); await p.waitForSelector('#scanSheet');
  await p.fill('#scanCode', '3017624010700'); await p.click('[data-scan="go"]');
  check(/not a valid barcode/.test(await p.textContent('#scanMsg')), 'invalid check digit rejected in the sheet');
  await p.fill('#scanCode', '3017624010701'); await p.click('[data-scan="go"]');
  await p.waitForSelector('.product-panel');
  check(!(await p.$('#scanSheet')), 'sheet closes after a lookup');
  const panel = await p.textContent('.product-panel');
  check(/Hazelnut spread/.test(panel) && /TestBrand/.test(panel) && /539 kcal/.test(panel), 'product panel: name, brand, energy');
  check(/Contains milk/.test(await p.textContent('.product-panel .note.danger')), 'milk allergy: "Contains milk" as a danger note');
  check(/May contain soy|soybeans/.test(panel), 'traces listed');
  check(/the label on the packet is what to trust/.test(panel), 'allergen-data disclaimer shown');
  check(await p.getAttribute('[data-scan-grams="15"]', 'aria-pressed') === 'true', 'serving (15 g) preselected');
  await p.click('#scanAdd');
  await p.waitForSelector('.log-list');
  const entry = await p.evaluate(() => window.Tracker.day(window.Tracker.today()).find((e) => e.source === 'barcode'));
  check(entry && entry.grams === 15 && entry.barcode === '3017624010701' && entry.brand === 'TestBrand' && entry.per100.sodium === 43,
    'entry saved: 15 g, barcode, brand, sodium in mg');
  check(/packet/.test(await p.textContent('.log-list')), 'log shows the packet tag');

  // Recent foods respect the dietary settings.
  check(!(await p.$('[data-again-entry]')), 'with a milk allergy the product is hidden from recent foods');
  await p.evaluate(() => { window.Prefs.set('allergens', []); location.hash = '#/history'; });
  await p.evaluate(() => { location.hash = '#/today'; }); await p.waitForSelector('.recent');
  check(/Hazelnut spread/.test(await p.textContent('.recent')), 'without the allergy it is in recent foods');
  await p.click('[data-again-entry]');
  check((await p.evaluate(() => window.Tracker.day(window.Tracker.today()).filter((e) => e.source === 'barcode').length)) === 2,
    'recent chip re-logs without a lookup');

  // Unknown product.
  await p.click('#scanBtn'); await p.fill('#scanCode', '5000159407236'); await p.click('[data-scan="go"]');
  await p.waitForSelector('[data-scan-manual]');
  check(/does not know 5000159407236/.test(await p.textContent('.pick-panel')), 'unknown product message');
  await p.click('[data-scan-manual]');
  check(await p.evaluate(() => document.querySelector('details.manual').open), 'falls back to the type-it-in form');

  // Camera, with a stubbed detector (installed before the page loads).
  await p.addInitScript(() => {
    let calls = 0;
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['ean_13']; }
      async detect() { calls++; return calls > 2 ? [{ rawValue: '3017624010701' }] : []; }
    };
  });
  await p.reload(); await p.waitForSelector('#scanBtn');
  await p.click('#scanBtn');
  await p.waitForSelector('.product-panel', { timeout: 15000 });
  check(!(await p.$('#scanSheet')), 'camera scan: code read, sheet closed, product looked up');

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
}, { launch: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });
