// Dietary settings: set in Food Log, hidden everywhere, passed to the photo
// prompt, flagged on review. The free engine is stubbed to capture the prompt.
//   NODE_PATH=$(npm root -g) node tests/e2e/diet.test.mjs   (from food-log/)

import { runSuite, isolatedContext, collectErrors, MEAL_PHOTO } from '../lib/harness.mjs';

const reply = JSON.stringify({ items: [
  { name: 'chicken curry', search: 'chicken', cooked: true, grams: 150, grams_low: 120, grams_high: 180, kcal_per_100g: 160, confidence: 'high', conflict: 'contains chicken' },
  { name: 'satay sauce', search: 'satay', cooked: true, grams: 30, grams_low: 20, grams_high: 40, kcal_per_100g: 300, confidence: 'medium', allergens: ['peanuts'] },
  { name: 'white rice, cooked', search: 'rice', cooked: true, grams: 150, grams_low: 120, grams_high: 180, kcal_per_100g: 130, confidence: 'high' }
], plate_cm: 26, notes: 'test' });

await runSuite('diet', async ({ base: BASE, browser: b, check }) => {
  const ctx = await isolatedContext(b, { viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  collectErrors(p, errs);
  // Firebase must never be reached for real (the isolated context aborts
  // every outside request anyway; kept explicit as in the original suite).
  await p.route('https://www.gstatic.com/firebasejs/**', (r) => {
    ctx.blocked.push(r.request().url());
    return r.abort();
  });
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
  const stub = () => p.evaluate((r) => {
    window.__prompts = [];
    window.FirebaseEngine.engine.call = function (model, prompt) { window.__prompts.push(prompt); return Promise.resolve(r); };
  }, reply);
  const go = (h) => p.evaluate((hh) => { location.hash = hh; }, h);

  // Log chicken and rice before any restriction.
  await p.evaluate(() => {
    const F = window.FOODS, g = s => F.find(f => f.slug === s), d = window.Tracker.today();
    window.Tracker.add(d, { food: g('chickenbreastroasted'), grams: 120, meal: 'lunch' });
    window.Tracker.add(d, { food: g('ricewhitecooked'), grams: 150, meal: 'lunch' });
    window.Tracker.add(d, { food: g('peanutbutter'), grams: 20, meal: 'breakfast' });
  });
  await go('#/settings'); await go('#/today'); await p.waitForSelector('.recent');
  check(/Chicken breast/.test(await p.textContent('.recent')) && /Peanut butter/.test(await p.textContent('.recent')), 'no restrictions: recent shows chicken and peanut butter');

  // No restrictions: prompt has no diet section, no tags.
  await stub();
  await go('#/snap'); await p.waitForSelector('#photoFile', { state: 'attached' });
  check(!/Reading for/.test(await p.textContent('#main')), 'no restrictions: no "Reading for" line');

  // Set vegetarian + peanuts + mushroom in Food Log's own Settings.
  await go('#/settings'); await p.waitForSelector('.diet-card');
  await p.click('[data-diet="vegetarian"]');
  await p.click('[data-allergen="peanut"]');
  await p.fill('#customExcl', 'mushroom'); await p.press('#customExcl', 'Tab');
  await p.waitForTimeout(200);
  const prefs = await p.evaluate(() => JSON.parse(localStorage.getItem('fim.prefs.v1')));
  check(prefs.diet === 'vegetarian' && prefs.allergens.join() === 'peanut' && prefs.customExclude === 'mushroom', 'settings card writes the shared fim.prefs.v1');
  check(await p.getAttribute('[data-diet="vegetarian"]', 'aria-pressed') === 'true' && await p.getAttribute('[data-allergen="peanut"]', 'aria-pressed') === 'true', 'chips show the choices');

  // Hidden everywhere.
  await go('#/today'); await p.waitForSelector('#logSearch');
  const recent = await p.textContent('.recent');
  check(!/Chicken breast/.test(recent) && !/Peanut butter/.test(recent) && /White rice/.test(recent), 'recent chips hide chicken and peanut butter, keep rice');
  await p.fill('#logSearch', 'chicken'); await p.waitForTimeout(150);
  const hits = await p.$$eval('#logSuggest button', bs => bs.map(x => x.textContent));
  check(!hits.some(h => /chicken (breast|thigh|liver|wing|drumstick)|roasted/i.test(h)), 'Today search for "chicken" shows no chicken: ' + (hits.slice(0, 3).join(' | ') || 'nothing'));
  await p.fill('#logSearch', 'mushroom'); await p.waitForTimeout(150);
  check((await p.$$('#logSuggest button')).length === 0, 'custom exclusion: "mushroom" search finds nothing');

  // Prompt carries the settings.
  await stub();
  await go('#/snap'); await p.waitForSelector('#photoFile', { state: 'attached' });
  check(/Reading for: vegetarian · no peanuts · no mushroom/.test(await p.textContent('#main')), 'Snap shows "Reading for: vegetarian · no peanuts · no mushroom"');
  await p.setInputFiles('#photoFile', MEAL_PHOTO);
  await p.waitForSelector('.photo-items li', { timeout: 15000 });
  const prompt = await p.evaluate(() => window.__prompts[0] || '');
  check(/follow a vegetarian diet/.test(prompt) && /read it as the vegetarian version/.test(prompt), 'prompt: vegetarian rule with compatible reading');
  check(/must avoid, for their health: peanut/.test(prompt) && /Never leave one out/.test(prompt), 'prompt: peanut flagged, never assumed away');
  check(/also avoid: mushroom/.test(prompt), 'prompt: custom exclusion');

  // Review: tags, disclaimer, no meat candidates.
  const rows = await p.$$eval('.photo-items li', ls => ls.map(l => ({
    name: l.querySelector('.p-name').textContent, sel: l.querySelector('select').selectedOptions[0].textContent,
    opts: [...l.querySelectorAll('select option')].map(o => o.textContent) })));
  check(/not vegetarian: contains chicken/.test(rows[0].name) && /No match/.test(rows[0].sel), 'conflict item: tagged and keeps the model estimate');
  check(!rows[0].opts.some(o => /chicken/i.test(o) && !/egg|No match/i.test(o)), 'conflict item: no chicken meat among the candidates: ' + rows[0].opts.join(' | '));
  check(/may contain peanuts/.test(rows[1].name), 'satay: "may contain peanuts" tag');
  check(/White rice, cooked/.test(rows[2].sel) && !/may contain|not vegetarian/.test(rows[2].name), 'rice: matched, no tags');
  check(/cannot tell whether a meal is safe for an allergy/.test(await p.textContent('.photo-card')), 'allergy disclaimer shown');
  await p.fill('[data-psearch="0"]', 'chicken'); await p.waitForTimeout(150);
  const rs = await p.$$eval('[data-psuggest="0"] button', bs => bs.map(x => x.textContent));
  check(!rs.some(h => /chicken (breast|thigh|liver|wing|drumstick)|roasted/i.test(h)), 'review search hides chicken: ' + (rs.slice(0, 3).join(' | ') || 'nothing'));

  // A matched food's own allergen tags count too: a milk allergy flags yogurt.
  await p.click('#photoDiscard');
  await p.evaluate(() => {
    window.FirebaseEngine.engine.call = () => Promise.resolve(JSON.stringify({ items: [
      { name: 'yogurt', search: 'yogurt', cooked: false, grams: 100, grams_low: 80, grams_high: 120, kcal_per_100g: 61, confidence: 'high' }], plate_cm: 26, notes: '' }));
  });
  await go('#/settings'); await p.waitForSelector('.diet-card');
  await p.click('[data-allergen="milk"]');
  await go('#/snap'); await p.waitForSelector('#photoFile', { state: 'attached' });
  await p.setInputFiles('#photoFile', MEAL_PHOTO);
  await p.waitForSelector('.photo-items li', { timeout: 15000 });
  const yo = await p.$$eval('.photo-items li', ls => ls.map(l => l.querySelector('.p-name').textContent + ' => ' + l.querySelector('select').selectedOptions[0].textContent));
  check(/may contain milk/.test(yo[0]) || /No match/.test(yo[0]), 'milk allergy: yogurt is excluded or flagged: ' + yo[0]);

  // Clearing restrictions brings everything back.
  await p.click('#photoDiscard');
  await go('#/settings'); await p.waitForSelector('.diet-card');
  await p.click('[data-diet="none"]'); await p.click('[data-allergen="peanut"]'); await p.click('[data-allergen="milk"]');
  await p.fill('#customExcl', ''); await p.press('#customExcl', 'Tab'); await p.waitForTimeout(200);
  await go('#/today'); await p.waitForSelector('.recent');
  check(/Chicken breast/.test(await p.textContent('.recent')), 'restrictions cleared: chicken back in recent');

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
});
