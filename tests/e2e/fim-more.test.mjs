// Food is Medicine with the extended food list: browsing stays curated, a
// switch shows every food, search always covers everything, an extended
// food has its own page saying where its figures come from and what its
// source does not measure, "Log this" hands it to Food Log, and favourite
// cuisines can be chosen there too.
//   NODE_PATH=$(npm root -g) node tests/e2e/fim-more.test.mjs   (from food-log/)

import { runSuite, isolatedContext, collectErrors } from '../lib/harness.mjs';

await runSuite('fim-more', async ({ base: BASE, browser: b, check }) => {
  const ctx = await isolatedContext(b, { viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  collectErrors(p, errs);
  const FIM = BASE.replace(/food-log\/$/, 'food-is-medicine/');
  await p.goto(FIM + '#/foods');
  await p.evaluate(() => localStorage.clear());
  await p.reload(); await p.waitForSelector('#foodGrid .food-card');
  const count = () => p.textContent('#foodCount');

  // ---- browsing ----
  check(/1,0\d\d foods|10\d\d foods/.test(await count()), 'browsing shows the curated list: ' + (await count()).split('·')[0]);
  check(await p.evaluate(() => !window.FoodsMore.loaded()), 'the extended list is not loaded just to browse');
  await p.click('#everyFood');
  await p.waitForFunction(() => /1[45],\d\d\d foods/.test(document.getElementById('foodCount').textContent), null, { timeout: 30000 });
  check(true, 'every food: ' + (await count()).split('·')[0]);
  check(!!(await p.$('[data-group="dish"]')) && !!(await p.$('[data-group="drink"]')), 'dish and drink groups appear');
  await p.click('[data-group="dish"]');
  await p.waitForFunction(() => document.querySelectorAll('#foodGrid .food-card').length > 100);
  check(/foods/.test(await count()), 'dishes: ' + (await count()).split('·')[0]);
  await p.click('#everyFood');
  await p.waitForFunction(() => /^1,?0\d\d foods/.test(document.getElementById('foodCount').textContent.trim()));
  check(true, 'switching back returns to the curated list');

  // ---- search covers everything ----
  await p.fill('#foodSearch', 'biryani');
  await p.waitForFunction(() => /Biryani/i.test(document.getElementById('foodGrid').textContent));
  check(true, 'search finds extended dishes without the switch');

  // ---- an extended food's page ----
  await p.goto(FIM + '#/food/fn-41305050');
  await p.reload();
  await p.waitForSelector('.food-hero h1', { timeout: 30000 });
  const page = await p.textContent('#main');
  check(/^Dal$/.test((await p.textContent('.food-hero h1')).trim()), 'a direct link to an extended food loads it');
  check(/USDA FNDDS 2021–2023, food code 41305050/.test(page), 'it says where the figures come from');
  check(/does not measure manganese or pantothenic acid/.test(page), 'and what that source does not measure');
  const uk = FIM + '#/food/uk-13-803';
  await p.goto(uk); await p.waitForSelector('.food-hero h1', { timeout: 30000 });
  check(/Asafoetida/.test(await p.textContent('.food-hero h1')) && /no nutrient figures here/.test(await p.textContent('#main')) &&
    /Open Government Licence/.test(await p.textContent('#main')), 'a spice with no figures says so, with the UK licence');

  // ---- "Log this" hands it to Food Log ----
  await p.goto(FIM + '#/food/fn-41305050'); await p.waitForSelector('.log-this a', { timeout: 30000 });
  await p.click('.log-this a');
  await p.waitForSelector('.pick-panel', { timeout: 30000 });
  check(/Dal/.test(await p.textContent('.pick-panel')), 'Food Log opens the extended food, ready to log');

  // ---- favourite cuisines on Food is Medicine ----
  await p.goto(FIM + '#/settings'); await p.waitForSelector('[data-cuisine="french"]');
  await p.click('[data-cuisine="french"]');
  check(JSON.stringify(await p.evaluate(() => window.Prefs.get('cuisines'))) === '["french"]', 'chosen on Food is Medicine, in the shared preferences');

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
});
