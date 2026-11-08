// Copying and moving entries on Today, the spreadsheet export, and "Hide
// calories": with it on, no page shows an energy figure anywhere -- text,
// tooltips or screen-reader labels.
//   NODE_PATH=$(npm root -g) node tests/e2e/logging.test.mjs   (from food-log/)

import { runSuite, isolatedContext, collectErrors, MEAL_PHOTO } from '../lib/harness.mjs';

const product = { status: 1, product: { product_name: 'Oat biscuits', brands: 'TestBrand', serving_size: '25 g', serving_quantity: 25,
  nutriments: { 'energy-kcal_100g': 480, proteins_100g: 7, carbohydrates_100g: 62, fat_100g: 21, salt_100g: 0.8 } } };
const photoReply = JSON.stringify({ items: [
  { name: 'white rice, cooked', search: 'rice', cooked: true, grams: 150, grams_low: 120, grams_high: 180, kcal_per_100g: 130, confidence: 'high' },
  { name: 'mystery curry', search: 'curry', cooked: true, grams: 200, grams_low: 150, grams_high: 250, kcal_per_100g: 150, confidence: 'medium' }
], plate_cm: 26, scale: 'plate', notes: '' });

await runSuite('logging', async ({ base: BASE, browser: b, check }) => {
  const ctx = await isolatedContext(b, { viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  collectErrors(p, errs);
  await p.route('https://world.openfoodfacts.org/api/v2/product/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(product) }));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.clear());
  await p.reload(); await p.waitForSelector('#logSearch');
  const go = (h) => p.evaluate((hh) => { location.hash = hh; }, h);

  // Yesterday's breakfast and today's lunch.
  await p.evaluate(() => {
    const T = window.Tracker, F = window.FOODS, food = (s) => F.find((f) => f.slug === s);
    const y = T.shift(T.today(), -1);
    T.add(y, { food: food('banana'), grams: 120, meal: 'breakfast' });
    T.add(y, { food: food('yogurtplain'), grams: 150, meal: 'breakfast' });
    T.add(T.today(), { food: food('ricewhitecooked'), grams: 200, meal: 'lunch' });
    T.add(T.today(), { food: food('chapati'), grams: 80, gramsLow: 60, gramsHigh: 100, source: 'photo', photoId: 'p1', plateAssumed: 26, meal: 'lunch' });
  });
  await go('#/history'); await go('#/today'); await p.waitForSelector('[data-same="breakfast"]');

  // ---- Same as yesterday ----
  check(/Same as yesterday’s breakfast/.test(await p.textContent('.same-yesterday')), 'chip offers yesterday’s breakfast');
  check(!(await p.$('[data-same="lunch"]')), 'no chip for a meal this day already has');
  await p.click('[data-same="breakfast"]');
  const bf = await p.evaluate(() => window.Tracker.day(window.Tracker.today()).filter((e) => e.meal === 'breakfast').map((e) => e.name));
  check(bf.length === 2 && bf.includes('Banana'), 'breakfast copied to today: ' + bf.join(', '));
  check(!(await p.$('[data-same="breakfast"]')), 'and the chip goes');

  // ---- Rename and move ----
  const rice = await p.evaluate(() => window.Tracker.day(window.Tracker.today()).find((e) => /rice/i.test(e.name)).id);
  await p.click('[data-edit-entry="' + rice + '"]');
  await p.fill('#rn-' + rice, 'Jeera rice');
  await p.click('[data-rename="' + rice + '"]');
  check(/Jeera rice/.test(await p.textContent('#main')), 'entry renamed');
  await p.click('[data-edit-entry="' + rice + '"]');
  const y = await p.evaluate(() => window.Tracker.shift(window.Tracker.today(), -1));
  await p.fill('#mvd-' + rice, y);
  await p.selectOption('#mvm-' + rice, 'dinner');
  await p.click('[data-move="' + rice + '"]');
  check(/Moved to yesterday/.test(await p.textContent('#main')), 'move notice');
  const moved = await p.evaluate((d) => window.Tracker.day(d).some((e) => e.name === 'Jeera rice' && e.meal === 'dinner'), y);
  check(moved && !(await p.evaluate(() => window.Tracker.day(window.Tracker.today()).some((e) => e.name === 'Jeera rice'))),
    'entry moved to yesterday’s dinner');

  // ---- Copy this meal to ----
  await p.click('[data-copy-meal="lunch"]');
  await p.fill('#copyDate', y); await p.selectOption('#copyMeal', 'lunch');
  await p.click('[data-copy-go="lunch"]');
  check(/Copied 1 to yesterday/.test(await p.textContent('#main')) &&
    await p.evaluate((d) => window.Tracker.day(d).some((e) => e.meal === 'lunch' && /Chapati/.test(e.name) && !e.photoId), y),
    'lunch copied to yesterday, without the photo link');

  // ---- CSV ----
  await go('#/settings'); await p.waitForSelector('#csvEntries');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#csvEntries')]);
  const text = await new Promise(async (res) => { const s = await dl.createReadStream(); let t = ''; s.on('data', (c) => { t += c; }); s.on('end', () => res(t)); });
  const rows = text.replace(/^﻿/, '').trim().split('\r\n');
  const n = await p.evaluate(() => window.Tracker.allDates().reduce((s, d) => s + window.Tracker.day(d).length, 0));
  check(/^food-log-entries-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()) && rows.length === n + 1 && /^Date,Time,Meal,Food/.test(rows[0]),
    'entries CSV: header and one row per entry (' + n + ')');

  // ---- Hide calories ----
  await p.check('#hideKcal');
  check(await p.evaluate(() => localStorage.getItem('foodlog.hideKcal')) === '1', 'switch saved');
  const leaks = () => p.evaluate(() => {
    const root = document.getElementById('main');
    const skip = document.getElementById('hideKcal') && document.getElementById('hideKcal').closest('.settings-block');
    const out = [];
    const text = (el) => (el.innerText || '');
    let visible = text(root);
    if (skip) visible = visible.replace(text(skip), '');
    const re = /\bkcal\b|calori/i;
    if (re.test(visible)) out.push('text: ' + visible.match(new RegExp('.{0,40}(' + re.source + ').{0,20}', 'i'))[0]);
    root.querySelectorAll('[title],[aria-label],option').forEach((el) => {
      const v = (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '') + (el.tagName === 'OPTION' ? el.textContent : '');
      if (re.test(v)) out.push('attr: ' + v.slice(0, 60));
    });
    return out;
  });
  const sweep = async (label) => { const l = await leaks(); check(l.length === 0, 'hidden on ' + label + (l.length ? ': ' + l.join(' | ') : '')); };

  await sweep('Settings');
  await go('#/today'); await p.waitForSelector('.log-summary');
  await sweep('Today');
  await p.fill('#logSearch', 'lentils'); await p.waitForSelector('#logSuggest:not([hidden])');
  await sweep('Today search suggestions');
  await p.click('#logSuggest button'); await p.waitForSelector('.pick-panel');
  await sweep('the add panel');
  await p.click('#pickCancel');
  // Barcode panel.
  await p.click('#scanBtn'); await p.fill('#scanCode', '3017624010701'); await p.click('[data-scan="go"]');
  await p.waitForSelector('.product-panel');
  await sweep('a scanned product');
  await p.click('[data-scan-cancel], #scanCancel').catch(() => {});
  // Photo review.
  await go('#/snap'); await p.waitForSelector('#photoFile', { state: 'attached' });
  await p.evaluate((r) => { window.FirebaseEngine.engine.call = () => Promise.resolve(r); }, photoReply);
  await p.setInputFiles('#photoFile', MEAL_PHOTO);
  await p.waitForSelector('.photo-items li', { timeout: 15000 });
  await sweep('the photo review');
  await p.click('#photoAdd'); await p.waitForSelector('.log-list');
  await sweep('Today after logging a photo');
  // Meals and the recipe builder.
  await p.click('[data-save-meal="lunch"]'); await p.click('[data-save-meal-go="lunch"]');
  await go('#/meals'); await p.waitForSelector('#newRecipe');
  await sweep('Meals');
  await p.click('#newRecipe'); await p.waitForSelector('#recSearch');
  await p.fill('#recSearch', 'lentils'); await p.waitForSelector('#recSuggest:not([hidden])');
  await sweep('recipe ingredient search');
  await p.click('#recSuggest button'); await p.waitForSelector('#recSum');
  await sweep('the recipe builder');
  await p.click('#recCancel');
  // History and the report.
  await go('#/history'); await p.waitForSelector('.day-strip');
  check(!(await p.$('.week-chart')), 'History: energy chart replaced by the days strip');
  await sweep('History');
  await p.click('[data-range="30"]'); await p.waitForSelector('.day-strip.dense');
  await sweep('History, 30 days');
  await go('#/report'); await p.waitForSelector('.report-head');
  await sweep('the report');

  // Off again: energy is back.
  await go('#/settings'); await p.waitForSelector('#hideKcal');
  await p.uncheck('#hideKcal');
  await go('#/today'); await p.waitForSelector('.log-summary');
  check(/kcal/.test(await p.textContent('.log-summary')), 'switched off: energy shows again');

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
});
