// Food Log learns from corrections: re-match "curry" to lentils and weigh
// the rotis on one photo, and the next photo of the same names comes back
// matched and scaled -- tagged "your usual", never changing what is logged.
// Settings lists what was learnt and forgets it.
//   NODE_PATH=$(npm root -g) node tests/e2e/memory.test.mjs   (from food-log/)

import { runSuite, isolatedContext, collectErrors, MEAL_PHOTO } from '../lib/harness.mjs';

const reply = JSON.stringify({ items: [
  { name: 'roti', search: 'roti', cooked: true, grams: 120, grams_low: 90, grams_high: 150, kcal_per_100g: 299, confidence: 'high' },
  { name: 'curry', search: 'curry', cooked: true, grams: 200, grams_low: 150, grams_high: 250, kcal_per_100g: 150, confidence: 'medium' }
], plate_cm: 26, scale: 'plate', notes: '' });

await runSuite('memory', async ({ base: BASE, browser: b, check }) => {
  const ctx = await isolatedContext(b, { viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  collectErrors(p, errs);
  await p.goto(BASE);
  await p.evaluate(() => localStorage.clear());
  await p.reload(); await p.waitForSelector('#logSearch');
  const go = (h) => p.evaluate((hh) => { location.hash = hh; }, h);
  const snapPhoto = async () => {
    await go('#/today'); await go('#/snap');
    await p.waitForSelector('#photoFile', { state: 'attached' });
    await p.evaluate((r) => { window.FirebaseEngine.engine.call = () => Promise.resolve(r); }, reply);
    await p.setInputFiles('#photoFile', MEAL_PHOTO);
    await p.waitForSelector('.photo-items li', { timeout: 15000 });
  };
  const items = () => p.evaluate(() => Array.from(document.querySelectorAll('.photo-items li')).map((li) => ({
    text: li.textContent, grams: Number(li.querySelector('[data-pgrams]').value),
    match: li.querySelector('select').selectedOptions[0].textContent
  })));

  // ---- First photo: teach it ----
  await snapPhoto();
  let it = await items();
  check(it[0].grams === 120 && /No match/.test(it[1].match) && !/your usual/.test(it[0].text), 'first time: the reader’s guess, curry unmatched');
  await p.fill('[data-psearch="1"]', 'lentils'); await p.waitForSelector('[data-psuggest="1"]:not([hidden])');
  await p.click('[data-psuggest="1"] [data-pset="lentilscooked"]');
  await p.fill('[data-pgrams="0"]', '80'); await p.press('[data-pgrams="0"]', 'Tab');
  await p.waitForFunction(() => /measured/.test(document.querySelector('.photo-items li').textContent));
  await p.click('#photoAdd'); await p.waitForSelector('.log-list');
  const mem = await p.evaluate(() => ({ curry: window.Memory.lookup('curry'), roti: window.Memory.lookup('roti') }));
  check(mem.curry && mem.curry.slug === 'lentilscooked', 'the re-match is remembered');
  check(mem.roti && Math.abs(mem.roti.factor - 80 / 120) < 0.01 && mem.roti.slug === undefined, 'the weighing is remembered as a portion (80 of 120 g), the accepted match is not');

  // ---- Second photo: applied ----
  await snapPhoto();
  it = await items();
  check(it[0].grams === 80 && /your usual/.test(it[0].text) && /67% of the reader’s guess/.test(it[0].text), 'roti scaled to the usual portion and tagged: ' + it[0].grams + ' g');
  check(/Lentils, cooked/.test(it[1].match) && /Matched the way you chose last time/.test(it[1].text), 'curry matched to lentils, saying why');
  check(!(await p.$('.photo-items li .measured-tag')), 'still an estimate, not tagged "measured"');
  await p.click('#photoAdd'); await p.waitForSelector('.log-list');

  // ---- Measuring a logged entry later also teaches ----
  const roti = await p.evaluate(() => window.Tracker.day(window.Tracker.today()).filter((e) => e.label === 'roti' && !e.measured)[0]);
  check(roti && roti.modelGrams === 120, 'logged photo entries keep the reader’s own guess');
  await p.fill('input[data-entry="' + roti.id + '"]', '100'); await p.press('input[data-entry="' + roti.id + '"]', 'Tab');
  await p.waitForFunction(() => window.Memory.lookup('roti').n === 2);
  check(Math.abs((await p.evaluate(() => window.Memory.lookup('roti').factor)) - (80 / 120 + 100 / 120) / 2) < 0.01, 'a later weighing on Today joins the portion history');
  const logged = await p.evaluate(() => window.Tracker.day(window.Tracker.today()).map((e) => e.grams).join());
  check(/80/.test(logged), 'nothing already logged changed');

  // ---- Settings: list and forget ----
  await go('#/settings'); await p.waitForSelector('.learnt-card');
  const card = await p.textContent('.learnt-card');
  check(/curry/.test(card) && /matched as Lentils, cooked/.test(card) && /roti/.test(card) && /2 measured/.test(card), 'Settings lists what was learnt');
  await p.click('[data-forget="roti"]');
  check(!/roti/.test(await p.textContent('.learnt-card')), 'forget one');
  await snapPhoto();
  it = await items();
  check(it[0].grams === 120 && !/your usual/.test(it[0].text), 'forgotten: back to the reader’s guess');
  await p.click('#photoDiscard');
  await go('#/settings'); await p.waitForSelector('#forgetAll');
  await p.click('#forgetAll');
  check(/Nothing yet/.test(await p.textContent('.learnt-card')), 'forget everything');

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
});
