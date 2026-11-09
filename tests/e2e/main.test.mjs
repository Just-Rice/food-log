// The main flows end to end: search and log, reference intakes from a profile,
// a photo read by a mocked Gemini (own key), plate and household measures,
// history, export, the vegetarian-edition migration and the phone layout.
//   NODE_PATH=$(npm root -g) node tests/e2e/main.test.mjs   (from food-log/)

import fs from 'node:fs';
import { runSuite, isolatedContext, collectErrors, mockGemini, MEAL_PHOTO, shot } from '../lib/harness.mjs';

const reply = { items: [
  { name: 'white rice, cooked', search: 'rice', cooked: true, grams: 200, grams_low: 150, grams_high: 260, kcal_per_100g: 130, confidence: 'high' },
  { name: 'lentils, cooked (dal)', search: 'lentils', cooked: true, grams: 150, grams_low: 100, grams_high: 200, kcal_per_100g: 110, confidence: 'medium' },
  { name: 'chapati', search: 'chapati', cooked: true, grams: 80, grams_low: 60, grams_high: 100, kcal_per_100g: 300, confidence: 'high' },
  { name: 'chicken curry', search: 'chicken', cooked: true, grams: 180, grams_low: 130, grams_high: 240, kcal_per_100g: 150, confidence: 'medium' },
  { name: 'ghee', search: 'ghee', cooked: false, grams: 10, grams_low: 5, grams_high: 15, kcal_per_100g: 900, confidence: 'low' }
], plate_cm: 26, notes: 'Oil in the curry is hard to see.' };

await runSuite('main', async ({ base: BASE, browser: b, devices, check }) => {
  const ctx = await isolatedContext(b, { viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errs = [];
  collectErrors(p, errs);
  await mockGemini(p, JSON.stringify(reply), {
    models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }]
  });

  // 1. Loads, no profile
  await p.goto(BASE); await p.waitForSelector('#logSearch');
  check((await p.textContent('#main')).includes('Nothing logged'), 'today view renders empty');

  // 2. Search with alias and add
  await p.fill('#logSearch', 'rajma');
  await p.waitForSelector('#logSuggest button');
  const first = await p.textContent('#logSuggest button');
  check(/Kidney beans, cooked/.test(first), 'alias "rajma" ranks cooked kidney beans first: ' + first.trim());
  await p.click('#logSuggest button');
  await p.fill('#pickGrams', '172');
  await p.click('#pickAdd');
  await p.reload(); await p.waitForSelector('.log-list');
  check((await p.textContent('.log-list')).includes('Kidney beans, cooked'), 'entry persists across reload');

  // 3. Adult profile -> personal DRIs; compare iron % with independent maths
  await p.evaluate(() => localStorage.setItem('fim.profile.v1', JSON.stringify({ age: 30, sex: 'female', weightKg: 60, heightCm: 165, activity: 1.375 })));
  await p.reload(); await p.waitForSelector('.dri-table');
  const ironRow = await p.evaluate(() => [...document.querySelectorAll('.dri-table tr')].find(r => r.querySelector('th').textContent === 'Iron').textContent);
  const expected = await p.evaluate(() => { const f = window.FOODS.find(x => x.slug === 'kidneybeanscooked'); return Math.round(f.nutrients.iron * 1.72 / 18 * 100); });
  check(ironRow.includes(expected + '%'), 'iron % matches USDA × grams ÷ RDA 18 mg (' + expected + '%): ' + ironRow);
  check((await p.textContent('.log-summary')).includes('estimated daily need'), 'adult sees energy comparison');
  check((await p.textContent('#main')).includes('your own reference intakes'), 'personal reference intakes used');

  // 4. Under-18 profile hides energy
  await p.evaluate(() => localStorage.setItem('fim.profile.v1', JSON.stringify({ age: 15, sex: 'male', weightKg: 55, heightCm: 170, activity: 1.55 })));
  await p.reload(); await p.waitForSelector('.log-summary');
  const sum15 = await p.textContent('.log-summary');
  check(sum15.includes('Totals only') && !sum15.includes('estimated daily need'), 'under-18 sees totals only');
  await p.evaluate(() => localStorage.setItem('fim.profile.v1', JSON.stringify({ age: 30, sex: 'female', weightKg: 60, heightCm: 165, activity: 1.375 })));

  // 5. Photo flow with mocked Gemini
  await p.evaluate(() => { localStorage.setItem('fim.gemini.key', 'test-key-123456'); localStorage.setItem('foodlog.engine', 'key'); });
  await p.goto(BASE + '#/snap'); await p.waitForSelector('#photoFile', { state: 'attached' });
  await p.setInputFiles('#photoFile', MEAL_PHOTO);
  await p.waitForSelector('.photo-items li', { timeout: 15000 });
  const rows = await p.$$eval('.photo-items li', ls => ls.map(l => l.querySelector('.p-name').textContent + ' => ' + l.querySelector('select').selectedOptions[0].textContent));
  console.log('   ' + rows.join('\n   '));
  check(/White rice, cooked/.test(rows[0]), 'rice matched to cooked rice');
  check(/Lentils, cooked/.test(rows[1]), 'dal matched to cooked lentils');
  check(/Chapati/.test(rows[2]), 'chapati matched');
  check(/=> No match — model estimate/.test(rows[3]), 'chicken curry (a mixed dish) keeps the model estimate: ' + rows[3]);
  await shot(p, 'review-before.png', { fullPage: true });

  // plate rescale 26 -> 22 cm
  await p.click('details.plate > summary');
  await p.fill('#pl-review-photo', '22');
  await p.click('[data-plate="review-photo"]');
  const riceG = Number(await p.inputValue('[data-pgrams="0"]'));
  check(riceG === Math.round(200 * (22 / 26) ** 2), 'plate 22 cm rescales rice 200 g -> ' + riceG + ' g');

  // household measure: 2 x chapati portion
  await p.click('details[data-mkey="review-2"] > summary');
  await p.fill('#mc-review-2', '2');
  await p.click('[data-munit="review-2"]');
  const chapG = Number(await p.inputValue('[data-pgrams="2"]'));
  const chapUnit = await p.evaluate(() => { const f = window.FOODS.find(x => x.slug === 'chapati'); return (f.portion || f.serving); });
  check(Math.abs(chapG - Math.round(chapUnit.grams * 2)) <= 1, '2 × ' + chapUnit.label + ' = ' + chapG + ' g');
  check((await p.textContent('.photo-items li:nth-child(3)')).includes('measured'), 'chapati marked measured');

  // weigh dal
  await p.click('details[data-mkey="review-1"] > summary');
  await p.fill('#mw-review-1', '165');
  await p.click('[data-mweigh="review-1"]');
  check(Number(await p.inputValue('[data-pgrams="1"]')) === 165, 'dal weighed 165 g');
  check((await p.textContent('.photo-card')).includes('2 of 5 items measured'), 'review shows 2 of 5 measured');
  await shot(p, 'review-after.png', { fullPage: true });

  await p.click('#photoAdd');
  await p.waitForSelector('.log-list');
  const entries = await p.evaluate(() => window.Tracker.day(window.Tracker.today()));
  const photoEntries = entries.filter(e => e.source === 'photo');
  check(photoEntries.length === 5, '5 photo entries logged');
  check(photoEntries.filter(e => e.measured).length === 2, '2 logged as measured');
  check(photoEntries.every(e => e.plateAssumed === 22), 'entries remember the 22 cm plate');
  const rice = photoEntries.find(e => e.slug === 'ricewhitecooked');
  check(rice && rice.gramsLow && rice.gramsHigh, 'unmeasured rice keeps its range');

  // measure a logged item: weigh the rice at 190 g
  const riceKey = 'entry-' + rice.id;
  await p.evaluate(k => document.querySelector('details[data-mkey="' + k + '"]').open = true, riceKey);
  await p.fill('#mw-' + riceKey, '190');
  await p.click('[data-mweigh="' + riceKey + '"]');
  const rice2 = await p.evaluate(id => window.Tracker.find(window.Tracker.today(), id), rice.id);
  check(rice2.measured && rice2.grams === 190 && !rice2.gramsLow, 'logged rice measured to 190 g, range gone');

  // logged plate correction for the rest (curry, ghee) 22 -> 24
  const curry = photoEntries.find(e => /chicken/i.test(e.label));
  await p.evaluate(() => document.querySelectorAll('details.plate').forEach(d => d.open = true));
  const plateKey = 'entry-' + curry.photoId;
  const before = curry.grams;
  await p.locator('#pl-' + plateKey).first().fill('24');
  await p.locator('[data-plate="' + plateKey + '"]').first().click();
  const curry2 = await p.evaluate(id => window.Tracker.find(window.Tracker.today(), id), curry.id);
  check(Math.abs(curry2.grams - before * (24 / 22) ** 2) < 0.2, 'logged curry rescaled ' + before + ' -> ' + curry2.grams + ' g');
  const rice3 = await p.evaluate(id => window.Tracker.find(window.Tracker.today(), id), rice.id);
  check(rice3.grams === 190, 'measured rice untouched by plate correction');
  const summary = await p.textContent('.log-summary');
  check(/come from photo portions nobody has measured/.test(summary), 'day shows unmeasured share: ' + summary.match(/\d+ of these \d+ kcal/));
  await shot(p, 'today-desktop.png', { fullPage: true });

  // 6. History + settings
  await p.goto(BASE + '#/history'); await p.waitForSelector('.week-chart');
  check((await p.textContent('#main')).includes('Average across logged days'), 'history shows average nutrients');
  await p.click('[data-range="30"]');
  check((await p.$$('.wk-col')).length === 30, '30-day chart has 30 columns');
  await shot(p, 'history.png', { fullPage: true });
  await p.goto(BASE + '#/settings'); await p.waitForSelector('#exportBtn');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exportBtn')]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check(Object.values(exported.days).flat().filter((e) => e.source !== 'spice').length === 6, 'export holds 6 entries (and their spices)');
  check((await p.textContent('#main')).includes('test••••••••3456'), 'key shown masked');

  // 7. Legacy migration in a fresh context
  const c2 = await isolatedContext(b); const p2 = await c2.newPage();
  collectErrors(p2, errs, { prefix: 'p2: ' });
  await p2.goto(BASE);
  await p2.evaluate(() => { localStorage.clear(); localStorage.setItem('veg.log.v1', JSON.stringify({ days: { '2026-11-01': [
    { id: 'old1', name: 'Paneer', meal: 'dinner', source: 'food', slug: 'paneer', grams: 100, per100: { kcal: 321, protein: 25, carbs: 3.6, fat: 25, fiber: 0 }, at: 1 } ] } })); });
  await p2.goto(BASE + '#/today/2026-11-01'); await p2.reload(); await p2.waitForSelector('.log-list');
  const t2 = await p2.textContent('#main');
  check(t2.includes('Paneer') && t2.includes('vegetarian edition'), 'veg.log.v1 imported with notice');
  // The note's wording has changed over time; what matters is that the
  // entry is counted and its missing vitamins and minerals are called out.
  check(/1 entry \(321 kcal\) has [^.]*vitamins and minerals are not counted/.test(t2), 'legacy entry flagged as energy/macros only in nutrient panel');

  // 8. Phone layout
  const c3 = await isolatedContext(b, { ...devices['iPhone 13'] });
  const p3 = await c3.newPage();
  collectErrors(p3, errs, { prefix: 'p3: ' });
  await p3.goto(BASE); await p3.evaluate(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); },
    await p.evaluate(() => Object.fromEntries(Object.entries(localStorage))));
  await p3.reload(); await p3.waitForSelector('.log-list');
  const overflow = await p3.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, 'no horizontal scroll on phone (overflow ' + overflow + 'px)');
  await shot(p3, 'today-phone.png', { fullPage: true });

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
});
