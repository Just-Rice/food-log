// Describing a meal in words (typed; speech feeds the same box), and the
// bank-card scale for photos. The free engine is stubbed to capture prompts.
//   NODE_PATH=$(npm root -g) node tests/e2e/describe.test.mjs   (from food-log/)

import { runSuite, isolatedContext, collectErrors, MEAL_PHOTO } from '../lib/harness.mjs';

const textReply = JSON.stringify({ items: [
  { name: 'chapati', search: 'chapati', cooked: true, grams: 80, grams_low: 70, grams_high: 90, kcal_per_100g: 299, confidence: 'high' },
  { name: 'dal', search: 'lentils', cooked: true, grams: 180, grams_low: 150, grams_high: 220, kcal_per_100g: 116, confidence: 'high' },
  { name: 'ghee', search: 'ghee', cooked: false, grams: 5, grams_low: 3, grams_high: 8, kcal_per_100g: 876, confidence: 'medium' }
], notes: 'Portion of dal assumed.' });
const photoReply = (scale) => JSON.stringify({ items: [
  { name: 'white rice, cooked', search: 'rice', cooked: true, grams: 150, grams_low: 120, grams_high: 180, kcal_per_100g: 130, confidence: 'high' }
], plate_cm: 24, scale, notes: '' });

await runSuite('describe', async ({ base: BASE, browser: b, check }) => {
  const ctx = await isolatedContext(b, { viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  collectErrors(p, errs);
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
  const stub = (reply) => p.evaluate((r) => {
    window.__calls = [];
    window.FirebaseEngine.engine.call = function (model, prompt, base64) {
      window.__calls.push({ model, prompt, image: !!base64 });
      return Promise.resolve(r);
    };
  }, reply);
  const go = (h) => p.evaluate((hh) => { location.hash = hh; }, h);

  // ---- Describe ----
  await p.evaluate(() => window.Prefs.set('diet', 'vegetarian'));
  await go('#/today'); await go('#/snap');
  await p.waitForSelector('[data-snap-mode="text"]');
  check(await p.getAttribute('[data-snap-mode="photo"]', 'aria-pressed') === 'true', 'Photo tab is the default');
  await p.click('[data-snap-mode="text"]');
  await p.waitForSelector('#describeText');
  check(!(await p.$('#photoFile')), 'Describe tab hides the photo controls');
  await stub(textReply);
  await p.fill('#describeText', 'two rotis and a bowl of dal with a bit of ghee');
  await p.click('#describeGo');
  await p.waitForSelector('.photo-items li', { timeout: 15000 });
  const call = await p.evaluate(() => window.__calls[0]);
  check(call && call.image === false, 'text request carries no image');
  check(/two rotis and a bowl of dal/.test(call.prompt) && /in their own words/.test(call.prompt), 'prompt quotes the description');
  check(/follow a vegetarian diet/.test(call.prompt), 'prompt carries the dietary settings');
  check(!/85\.6 x 54 mm/.test(call.prompt) && !/plate_cm/.test(call.prompt), 'no photo-only rules in the text prompt');
  const card = await p.textContent('.photo-card');
  check(/You said: “two rotis and a bowl of dal/.test(card), 'review quotes what was said');
  check(!(await p.$('.photo-card img.photo-thumb')) && !(await p.$('details.plate')), 'no thumbnail and no plate panel for a description');
  const rows = await p.$$eval('.photo-items li', (ls) => ls.map((l) => l.querySelector('select').selectedOptions[0].textContent));
  check(/Chapati/.test(rows[0]) && /Lentils, cooked/.test(rows[1]), 'items matched to USDA foods: ' + rows.slice(0, 2).join(' | '));
  // Stronger model re-reads the same words.
  await stub(textReply);
  await p.click('#photoStronger');
  await p.waitForFunction(() => /Read by Gemini 3\.8 Flash/.test((document.querySelector('.photo-card') || {}).textContent || ''), null, { timeout: 15000 });
  const c2 = await p.evaluate(() => window.__calls[0]);
  check(c2.model === 'gemini-3.8-flash' && /two rotis/.test(c2.prompt) && c2.image === false, 'stronger model re-reads the description');
  await p.click('#photoAdd');
  await p.waitForSelector('.log-list');
  check((await p.evaluate(() => window.Tracker.day(window.Tracker.today()).length)) === 3, 'three items logged from the description');
  await go('#/today'); await go('#/snap'); await p.waitForSelector('#describeText');
  const hasSpeech = await p.evaluate(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  check(hasSpeech === !!(await p.$('#micBtn')), 'mic button shown exactly when speech recognition exists (here: ' + hasSpeech + ')');

  // ---- Card scale (photo tab) ----
  await p.evaluate(() => window.Prefs.set('diet', 'none'));
  await go('#/today'); await go('#/snap');
  await p.click('[data-snap-mode="photo"]');
  await p.waitForSelector('#photoFile', { state: 'attached' });
  check(/bank card beside the plate/.test(await p.textContent('#main')), 'card tip on the photo tab');
  for (const scale of ['card', 'plate']) {
    await stub(photoReply(scale));
    await p.setInputFiles('#photoFile', MEAL_PHOTO);
    await p.waitForSelector('.photo-items li', { timeout: 15000 });
    const prompt = await p.evaluate(() => window.__calls[0].prompt);
    const text = await p.textContent('.photo-card');
    if (scale === 'card') {
      check(/85\.6 x 54 mm/.test(prompt), 'photo prompt explains the card scale');
      check(/Scaled from the card/.test(text) && !(await p.$('details.plate')), 'card scale: note shown, plate panel hidden');
    } else {
      check(!/Scaled from the card/.test(text) && !!(await p.$('details.plate')), 'plate scale: no note, plate panel shown');
    }
    await p.click('#photoDiscard');
  }

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
});
