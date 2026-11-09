// The extended food list, favourite cuisines, and a dish's spices.
//  * Search covers the extended list once it has loaded, by the names people
//    use (chana masala, rajma), with favourite cuisines first.
//  * Favourite cuisines are chosen in Settings and told to the photo reader.
//  * A dish brings its usual spices into the log, unless that day already has
//    them; they fold under the dish, go with it when it is deleted, and can be
//    switched off.
//   NODE_PATH=$(npm root -g) node tests/e2e/cuisine.test.mjs   (from food-log/)

import { runSuite, isolatedContext, collectErrors } from '../lib/harness.mjs';

const reply = JSON.stringify({ items: [
  { name: 'dal', search: 'lentils', cooked: true, grams: 200, grams_low: 150, grams_high: 250, kcal_per_100g: 120,
    confidence: 'high', spices: ['turmeric', 'cumin', 'hing'] },
  { name: 'jeera rice', search: 'rice', cooked: true, grams: 150, grams_low: 120, grams_high: 180, kcal_per_100g: 150,
    confidence: 'high', spices: ['cumin'] }
], notes: '' });

await runSuite('cuisine', async ({ base: BASE, browser: b, check }) => {
  const ctx = await isolatedContext(b, { viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  collectErrors(p, errs);
  await p.goto(BASE);
  await p.evaluate(() => localStorage.clear());
  await p.reload(); await p.waitForSelector('#logSearch');
  const go = (h) => p.evaluate((hh) => { location.hash = hh; }, h);

  // ---- the extended list ----
  const t0 = await p.evaluate(() => performance.now());
  await p.waitForFunction(() => window.FoodsMore.loaded() && window.FOODS.length > 10000, null, { timeout: 30000 });
  check(await p.evaluate(() => !!document.getElementById('logSearch')), 'the page was usable before the extended list arrived');
  const n = await p.evaluate(() => window.FOODS.length);
  check(n > 14000, 'about 14,600 foods searchable: ' + n);
  const search = async (q) => {
    await p.fill('#logSearch', q);
    await p.waitForFunction(() => !document.getElementById('logSuggest').hidden);
    return p.$$eval('#logSuggest [data-pick]', (bs) => bs.map((x) => ({ slug: x.dataset.pick, name: x.textContent })));
  };
  let hits = await search('chicken tikka masala');
  check(hits.length && /tikka masala/i.test(hits[0].name), 'search finds a dish from the UK table: ' + (hits[0] || {}).name);
  hits = await search('chana masala');
  check(hits.some((h) => /chick pea|chickpea/i.test(h.name)), 'and by the name people use: chana masala → ' + (hits[0] || {}).name);
  hits = await search('coq au vin');
  check(hits.some((h) => /coq au vin/i.test(h.name)), 'coq au vin');
  hits = await search('banana');
  check(hits[0].slug === 'banana', 'a curated food still comes first for a plain search');

  // ---- favourite cuisines ----
  const favCount = (list) => p.evaluate((slugs) => slugs.filter((slug) => {
    const f = window.FOODS.find((x) => x.slug === slug);
    return !!f && (f.cuisines || []).some((c) => c === 'indian' || c === 'mexican');
  }).length, list.map((h) => h.slug));
  const before = await favCount(await search('bread'));
  await go('#/settings'); await p.waitForSelector('.cuisine-card');
  check((await p.$$('.cuisine-card [data-cuisine]')).length === 16, 'Settings offers 16 cuisines');
  await p.click('[data-cuisine="indian"]'); await p.click('[data-cuisine="mexican"]');
  check(JSON.stringify(await p.evaluate(() => window.Prefs.get('cuisines'))) === '["indian","mexican"]', 'saved in the shared preferences');
  await go('#/today'); await p.waitForSelector('#logSearch');
  hits = await search('bread');
  const after = await favCount(hits);
  check(after > before && after >= 4, 'favourite cuisines’ breads move up (' + before + ' → ' + after + ' of 10): ' + hits.slice(0, 5).map((h) => h.name.split(' · ')[0]).join(' | '));
  await p.fill('#logSearch', '');

  // ---- dish spices from a described meal ----
  await p.evaluate(() => {
    const T = window.Tracker;
    T.add(T.today(), { food: window.FOODS.find((f) => f.slug === 'turmericroot'), grams: 1, meal: 'breakfast' });
  });
  await go('#/snap'); await p.waitForSelector('[data-snap-mode="text"]');
  await p.click('[data-snap-mode="text"]'); await p.waitForSelector('#describeText');
  await p.evaluate((r) => {
    window.__prompt = '';
    window.FirebaseEngine.engine.call = (model, prompt) => { window.__prompt = prompt; return Promise.resolve(r); };
  }, reply);
  await p.fill('#describeText', 'a bowl of dal and some jeera rice');
  await p.click('#describeGo');
  await p.waitForSelector('.photo-items li', { timeout: 15000 });
  const prompt = await p.evaluate(() => window.__prompt);
  check(/mostly eats Indian & South Asian, Mexican & Latin American food/.test(prompt) && /"spices"/.test(prompt),
    'the reader is told the cuisines and asked for each dish’s spices');
  const spiceLine = await p.textContent('.photo-items li .item-spices');
  check(/with turmeric.*cumin.*asafoetida/i.test(spiceLine), 'review shows the dal’s spices: ' + spiceLine.trim());
  await p.selectOption('#photoMeal', 'dinner');
  await p.click('#photoAdd'); await p.waitForSelector('.log-list');
  const day = await p.evaluate(() => window.Tracker.day(window.Tracker.today()).map((e) => ({ id: e.id, slug: e.slug, name: e.name, of: e.spiceOf || null, g: e.grams, meal: e.meal })));
  const dal = day.find((e) => /dal|lentil/i.test(e.name) && !e.of);
  const kids = day.filter((e) => e.of === (dal && dal.id));
  check(kids.map((k) => k.slug).sort().join() === 'cumin,uk-13-803', 'dal brought cumin and hing, not turmeric (already logged): ' + kids.map((k) => k.name).join(', '));
  check(day.filter((e) => e.slug === 'turmericroot').length === 1 && day.filter((e) => e.slug === 'cumin').length === 1,
    'jeera rice added no second cumin');
  check(kids.every((k) => k.g > 0 && k.g <= 5 && k.meal === 'dinner'), 'small amounts, in the dish’s meal');

  // Folded on Today.
  const dinner = await p.$$eval('.log-meal', (ms) => (ms.find((m) => /Dinner/.test(m.querySelector('h3').textContent)) || {}).textContent || '');
  check(/\+ 2 spices: cumin.*, asafoetida/i.test(dinner), 'folded under the dish: "+ 2 spices": ' + (dinner.match(/\+ \d spices?[^·]*/) || [''])[0]);
  const rows = await p.$$eval('.log-meal', (ms) => ms.find((m) => /Dinner/.test(m.querySelector('h3').textContent)).querySelectorAll(':scope > .log-list > li').length);
  check(rows === 2, 'dinner shows two rows (dal, rice), not four');
  await p.click('[data-spices="' + dal.id + '"]');
  check((await p.$$('.spice-list li')).length === 2, 'and opens to the spice list');
  // Deleting the dish takes its spices.
  await p.click('[data-del="' + dal.id + '"]');
  const left = await p.evaluate((id) => window.Tracker.day(window.Tracker.today()).filter((e) => e.id === id || e.spiceOf === id).length, dal.id);
  check(left === 0, 'deleting the dish deletes its spices');

  // ---- a dish from search brings its spices; switch it off ----
  await go('#/today'); await p.waitForSelector('#logSearch');
  hits = await search('chicken curry');
  const curry = hits.find((h) => /^Chicken curry/.test(h.name));
  await p.click('#logSuggest [data-pick="' + curry.slug + '"]'); await p.waitForSelector('#pickAdd');
  await p.click('#pickAdd');
  const fromSearch = await p.evaluate(() => {
    const d = window.Tracker.day(window.Tracker.today());
    const c = d.find((e) => /^Chicken curry/.test(e.name));
    return d.filter((e) => e.spiceOf === c.id).map((e) => e.name);
  });
  check(fromSearch.length >= 2, 'a dish picked from search brings its spices: ' + fromSearch.join(', '));
  await go('#/settings'); await p.waitForSelector('#dishSpices');
  await p.uncheck('#dishSpices');
  await go('#/today'); await p.waitForSelector('#logSearch');
  hits = await search('vegetable curry');
  await p.click('#logSuggest [data-pick]'); await p.waitForSelector('#pickAdd');
  await p.click('#pickAdd');
  const none = await p.evaluate(() => {
    const d = window.Tracker.day(window.Tracker.today());
    const c = d[d.length - 1];
    return d.filter((e) => e.spiceOf === c.id).length;
  });
  check(none === 0, 'switched off: no spices added');

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
});
