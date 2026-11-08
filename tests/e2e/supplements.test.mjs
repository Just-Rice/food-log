// Supplements: saved from a label (with unit conversions), offered on Today
// when taken daily, counted in the vitamins and minerals, checked against
// the upper limits that apply only to supplements, and synced as part of the
// library. Plus the week's plant variety on History and in the report.
//   NODE_PATH=$(npm root -g) node tests/e2e/supplements.test.mjs   (from food-log/)

import { runSuite, isolatedContext, collectErrors } from '../lib/harness.mjs';

await runSuite('supplements', async ({ base: BASE, browser: b, check }) => {
  const ctx = await isolatedContext(b, { viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  collectErrors(p, errs);
  await p.goto(BASE);
  await p.evaluate(() => localStorage.clear());
  await p.reload(); await p.waitForSelector('#logSearch');
  const go = (h) => p.evaluate((hh) => { location.hash = hh; }, h);

  // ---- Save one from its label ----
  await go('#/meals'); await p.waitForSelector('#newSupp');
  check(/cannot tell you whether to take a supplement/.test(await p.textContent('#main')), 'safety note on the Meals page');
  await p.click('#newSupp'); await p.waitForSelector('#suSave');
  await p.click('#suSave');
  check(/at least one amount/.test(await p.textContent('#suMsg')), 'an empty supplement is refused');
  await p.fill('#suName', 'Vitamin D3 + folic acid');
  await p.fill('#suDose', '1 capsule');
  await p.fill('#su_vitd', '1000'); await p.selectOption('#su_vitd_u', 'iu');
  await p.fill('#su_folicAcid', '400');
  await p.click('#suSave');
  await p.waitForSelector('[data-edit-supp]');
  const saved = await p.evaluate(() => window.Library.supplements()[0]);
  check(saved && saved.amounts.vitd === 25 && saved.amounts.folicAcid === 400 && saved.amounts.folate === 680 && saved.daily && saved.dose === '1 capsule',
    '1000 IU vitamin D saved as 25 µg; folic acid only → 680 µg DFE; daily: ' + JSON.stringify(saved && saved.amounts));

  // A second, not daily: magnesium above the supplement limit.
  await p.click('#newSupp'); await p.waitForSelector('#suSave');
  await p.fill('#suName', 'Magnesium'); await p.uncheck('#suDaily'); await p.fill('#su_magnesium', '400');
  await p.click('#suSave'); await p.waitForSelector('[data-edit-supp]');

  // ---- Today ----
  await go('#/today'); await p.waitForSelector('.supp-block');
  const chips = await p.$$eval('.supp-daily [data-take-supp]', (bs) => bs.map((b) => b.textContent));
  check(chips.length === 1 && /Vitamin D3/.test(chips[0]), 'only the daily one is offered as "Taken today?"');
  await p.click('.supp-daily [data-take-supp]');
  await p.waitForSelector('.supp-block .log-list');
  check(!(await p.$('.supp-daily')), 'once logged, it is no longer offered');
  const rowD = await p.$$eval('.dri-table tr', (rs) => (rs.find((r) => /Vitamin D/.test(r.textContent)) || {}).textContent || '');
  check(/25 µg/.test(rowD), 'counted in the day’s vitamin D: ' + rowD.replace(/\s+/g, ' '));
  check(/Supplements/.test(await p.textContent('.supp-block h3')) && /25 µg vitamin D/.test(await p.textContent('.supp-block')),
    'listed under Supplements with what it gave');
  check(!/supplement/i.test(await p.evaluate(() => Array.from(document.querySelectorAll('.log-meal:not(.supp-block)')).map((x) => x.textContent).join(' '))),
    'not shown inside a meal');
  // Two doses.
  await p.fill('[data-doses]', '2'); await p.press('[data-doses]', 'Tab');
  await p.waitForFunction(() => /50 µg vitamin D/.test(document.querySelector('.supp-block').textContent));
  check(true, 'two doses double it');

  // The other one from the add panel's chips; its magnesium is over the supplement limit.
  const mg = await p.$$('.recent [data-take-supp]');
  for (const c of mg) { if (/Magnesium/.test(await c.textContent())) { await c.click(); break; } }
  await p.waitForFunction(() => /Magnesium/.test(document.querySelector('.supp-block').textContent));
  const rowMg = await p.$$eval('.dri-table tr', (rs) => (rs.find((r) => /Magnesium/.test(r.textContent)) || {}).textContent || '');
  check(/Supplements gave 400 mg, above the 350 mg upper limit for supplements/.test(rowMg), 'magnesium from supplements over 350 mg is flagged');
  check(await p.evaluate(() => window.Tracker.totals(window.Tracker.today()).partialCount) === 0, 'supplements never count as missing vitamin data');
  check(await p.evaluate(() => window.Tracker.totals(window.Tracker.today()).supp.folate) === 800, 'folate limit counts the folic acid only (2 × 400 µg)');

  // ---- Gaps: a tablet covers vitamin D ----
  await p.evaluate(() => {
    const T = window.Tracker, F = window.FOODS, food = (s) => F.find((f) => f.slug === s);
    const x = window.Library.supplements().find((s) => /D3/.test(s.name));
    for (let i = 1; i <= 3; i++) {
      const d = T.shift(T.today(), -i);
      T.add(d, { food: food('ricewhitecooked'), grams: 300, meal: 'lunch' });
      T.add(d, { food: food('spinachcooked'), grams: 100, meal: 'lunch' });
      T.add(d, { source: 'supplement', name: x.name, amounts: x.amounts, doses: 1, supplementId: x.id, meal: 'breakfast' });
    }
    // A recipe with lentils and banana, for the plant count.
    const r = window.Library.saveRecipe({ name: 'Dal', ingredients: [
      { slug: 'lentilscooked', name: 'Lentils, cooked', grams: 200, per100: food('lentilscooked').nutrients },
      { slug: 'banana', name: 'Banana', grams: 100, per100: food('banana').nutrients }], servings: 2 });
    const n = window.Library.nutrition(r);
    T.add(T.shift(T.today(), -1), { name: r.name, per100: n.per100, grams: 150, meal: 'dinner', source: 'recipe', recipeId: r.id,
      slugs: r.ingredients.map((i) => i.slug) });
  });
  await go('#/history'); await p.waitForSelector('.gaps-card');
  const gaps = await p.textContent('.gaps-card');
  check(!/Vitamin D:/.test(gaps), 'the gaps card does not flag vitamin D the tablet covers');

  // ---- Plants ----
  const plants = await p.textContent('.plants-card');
  check(/4 different plant foods/.test(plants) && /Lentils/.test(plants) && /Banana/.test(plants), 'plants: rice, spinach, and the recipe’s lentils and banana: ' + plants.slice(0, 80));
  check(!/target|goal/i.test(plants), 'no target');
  await go('#/report'); await p.waitForSelector('.report-head');
  check(/Different plant foods: 4/.test(await p.textContent('#main')), 'plant count in the report');

  // ---- Library sync carries supplements ----
  const doc = await p.evaluate(() => window.Library.doc());
  check(Object.keys(doc.supplements || {}).length === 2, 'supplements are in the library document that syncs');

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
});
