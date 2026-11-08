// Saved meals and recipes: recipe editor and maths, Save as a meal on Today,
// one-tap logging from My meals, delete.
//   NODE_PATH=$(npm root -g) node tests/e2e/meals.test.mjs   (from food-log/)

import { runSuite, isolatedContext, collectErrors } from '../lib/harness.mjs';

await runSuite('meals', async ({ base: BASE, browser: b, check }) => {
  const ctx = await isolatedContext(b, { viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  collectErrors(p, errs);
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();

  // Build a recipe in the editor.
  await p.evaluate(() => { location.hash = '#/meals'; }); await p.waitForSelector('#newRecipe');
  check(/No recipes yet/.test(await p.textContent('#main')), 'empty Meals page');
  await p.click('#newRecipe'); await p.waitForSelector('#recName');
  await p.fill('#recName', 'Weeknight dal');
  for (const [q, slug] of [['lentils', 'lentil'], ['ghee', null]]) {
    await p.fill('#recSearch', q); await p.waitForSelector('#recSuggest button');
    const btn = slug && (await p.$(`[data-ing-add="${slug}"]`)) ? `[data-ing-add="${slug}"]` : '#recSuggest button';
    await p.click(btn);
    await p.waitForSelector('#recName');
  }
  await p.fill('[data-ing-g="0"]', '200'); await p.press('[data-ing-g="0"]', 'Tab'); await p.waitForSelector('#recName');
  await p.fill('[data-ing-g="1"]', '15'); await p.press('[data-ing-g="1"]', 'Tab'); await p.waitForSelector('#recName');
  await p.fill('#recCooked', '600'); await p.press('#recCooked', 'Tab'); await p.waitForSelector('#recName');
  await p.fill('#recServings', '4'); await p.press('#recServings', 'Tab'); await p.waitForSelector('#recSum');
  const sum = (await p.textContent('#recSum')).replace(/\s+/g, ' ');
  console.log('    ' + sum);
  check(/Per serving \(150 g\)/.test(sum), 'serving is 600 g / 4 = 150 g');
  await p.click('#recSave'); await p.waitForSelector('#newRecipe');
  check(/Weeknight dal/.test(await p.textContent('#main')), 'recipe listed');

  // Log a serving from the Meals page.
  await p.click('[data-log-recipe]');
  const e = await p.evaluate(() => window.Tracker.day(window.Tracker.today()).find(x => x.source === 'recipe'));
  check(e && e.grams === 150 && e.per100.iron > 0, 'logged one 150 g serving with iron data');
  check(await p.evaluate((id) => window.Tracker.isComplete(window.Tracker.find(window.Tracker.today(), id)), e.id), 'recipe entry counts as complete');

  // Save a meal from Today and re-log it from the chips.
  await p.evaluate(() => {
    const d = window.Tracker.today(), F = window.FOODS, g = s => F.find(f => f.slug === s);
    window.Tracker.add(d, { food: g('oatmealcooked'), grams: 240, meal: 'breakfast' });
    window.Tracker.add(d, { food: g('banana'), grams: 118, meal: 'breakfast' });
    location.hash = '#/today';
  });
  await p.waitForSelector('[data-save-meal="breakfast"]');
  await p.click('[data-save-meal="breakfast"]'); await p.fill('#saveMealName', 'Usual breakfast'); await p.click('[data-save-meal-go="breakfast"]');
  await p.waitForSelector('[data-lib-meal]');
  check(/Saved “Usual breakfast”/.test(await p.textContent('#main')), 'save-as-meal notice');
  const chips = await p.$$eval('[data-lib-meal], [data-lib-recipe]', bs => bs.map(x => x.textContent));
  check(chips.some(c => /Usual breakfast/.test(c)) && chips.some(c => /Weeknight dal/.test(c)), 'My meals chips show the meal and the recipe');
  const before = await p.evaluate(() => window.Tracker.day(window.Tracker.today()).length);
  await p.click('[data-lib-meal]');
  check(await p.evaluate(() => window.Tracker.day(window.Tracker.today()).length) === before + 2, 'meal chip logs both items');

  // Delete.
  p.on('dialog', d => d.accept());
  await p.evaluate(() => { location.hash = '#/meals'; }); await p.waitForSelector('[data-del-lib]');
  await p.click('[data-del-lib]');
  await p.waitForTimeout(200);
  check((await p.$$('[data-del-lib]')).length === 1, 'delete removes one item');

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
});
