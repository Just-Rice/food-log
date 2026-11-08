// Offline, then back online:
//  * with no on-device model, a photo and a description are kept and read by
//    Gemini once the connection returns, then checked and logged on the day
//    and meal they were taken;
//  * with the on-device model, the photo is read at once, logged, and read
//    again by Gemini later -- the better reading replaces the entries nobody
//    weighed, keeps the one that was weighed, and only after confirming;
//  * a reading that keeps failing can be retried or removed;
//  * someone who chose the on-device model on purpose is never uploaded.
// The engines are stubs; "offline" is the browser's offline mode.
//   NODE_PATH=$(npm root -g) node tests/e2e/queue.test.mjs   (from food-log/)

import { runSuite, isolatedContext, collectErrors, MEAL_PHOTO } from '../lib/harness.mjs';

const gemini = JSON.stringify({ items: [
  { name: 'chapati', search: 'chapati', cooked: true, grams: 80, grams_low: 70, grams_high: 90, kcal_per_100g: 299, confidence: 'high' },
  { name: 'dal', search: 'lentils', cooked: true, grams: 180, grams_low: 150, grams_high: 220, kcal_per_100g: 116, confidence: 'high' }
], plate_cm: 26, scale: 'plate', notes: '' });
const gemma = { items: [
  { name: 'bread', search: 'bread', cooked: true, grams: 100, gramsLow: 80, gramsHigh: 120, kcalPer100: 260, confidence: 'medium' },
  { name: 'white rice, cooked', search: 'rice', cooked: true, grams: 150, gramsLow: 120, gramsHigh: 180, kcalPer100: 130, confidence: 'high' },
  { name: 'soup', search: 'soup', cooked: true, grams: 200, gramsLow: 150, gramsHigh: 250, kcalPer100: 60, confidence: 'low' }
], plateCm: 26, notes: '' };

await runSuite('queue', async ({ base: BASE, browser: b, check }) => {
  const ctx = await isolatedContext(b, { viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  collectErrors(p, errs, { extraIgnore: (m) => /ERR_INTERNET_DISCONNECTED/.test(m.text()) });
  await p.goto(BASE);
  await p.evaluate(() => localStorage.clear());
  await p.reload(); await p.waitForSelector('#logSearch');
  const go = (h) => p.evaluate((hh) => { location.hash = hh; }, h);
  const offline = async (v) => { await ctx.setOffline(v); await p.evaluate((o) => window.dispatchEvent(new Event(o ? 'offline' : 'online')), v); };
  const queue = () => p.evaluate(() => window.Queue.all().then((l) => l.map((r) => ({ status: r.status, kind: r.kind, date: r.date, meal: r.meal, attempts: r.attempts || 0, n: (r.entryIds || []).length }))));
  const stubGemini = (reply) => p.evaluate((r) => {
    window.__calls = 0;
    window.FirebaseEngine.engine.call = (model, prompt, img) => { window.__calls++; window.__lastModel = model; return r === null ? Promise.reject(new Error('Bad reply')) : Promise.resolve(r); };
  }, reply);

  // ---- 1. Offline, no on-device model: keep it for later ----
  await stubGemini(gemini);
  await offline(true);
  await go('#/today'); await go('#/snap');
  await p.waitForSelector('#photoFile', { state: 'attached' });
  check(/You’re offline\. Take or choose the photo/.test(await p.textContent('#main')), 'offline Snap offers to keep the photo for later');
  await p.setInputFiles('#photoFile', MEAL_PHOTO);
  await p.waitForFunction(() => /Saved\. It will be read/.test(document.getElementById('main').textContent));
  await p.click('[data-snap-mode="text"]'); await p.waitForSelector('#describeText');
  await p.fill('#describeText', 'two rotis and a bowl of dal');
  await p.click('#describeGo');
  await p.waitForFunction(() => /Saved\. It will be read/.test(document.getElementById('main').textContent));
  let q = await queue();
  check(q.length === 2 && q.every((r) => r.status === 'waiting') && q.some((r) => r.kind === 'photo') && q.some((r) => r.kind === 'text'),
    'a photo and a description are kept, waiting: ' + JSON.stringify(q));
  check(await p.evaluate(() => window.__calls) === 0, 'nothing was sent while offline');
  await go('#/today'); await p.waitForSelector('.queue-card');
  check(/2 waiting to be read when you’re back online/.test(await p.textContent('.queue-card')), 'Today says two are waiting');

  // ---- 2. Online: both read, then checked and logged ----
  await offline(false);
  await p.waitForFunction(() => document.querySelectorAll('[data-q-open]').length === 2, null, { timeout: 15000 });
  check(await p.evaluate(() => window.__calls) === 2, 'back online, each was read once');
  q = await queue();
  check(q.every((r) => r.status === 'ready'), 'both ready to check');
  check(/A photo from today is ready to check/.test(await p.textContent('.queue-card')), 'Today offers the photo to check');
  await p.click('[data-q-open]');
  await p.waitForSelector('.photo-items li');
  check(!!(await p.$('.photo-card img.photo-thumb')), 'the photo is shown on the review');
  await p.click('#photoAdd'); await p.waitForSelector('.log-list');
  q = await queue();
  check(q.length === 1 && q[0].kind === 'text', 'logging it removes it from the queue');
  check((await p.evaluate(() => window.Tracker.day(window.Tracker.today()).length)) === 2, 'its items are logged');
  await p.click('[data-q-open]'); await p.waitForSelector('.photo-items li');
  await p.click('#photoDiscard');
  check((await queue()).length === 0, 'discarding removes it too');

  // ---- 3. Offline with the on-device model: read now, read better later ----
  await p.evaluate((g) => {
    window.LocalModel.isDownloaded = () => true;
    window.LocalModel.analyse = (file) => window.Photo.prepare(file).then((img) =>
      Object.assign(JSON.parse(JSON.stringify(g)), { dataUrl: img.dataUrl }));
    window.__calls = 0;
  }, gemma);
  await offline(true);
  await go('#/today'); await go('#/snap');
  await p.click('[data-snap-mode="photo"]');
  await p.waitForSelector('#photoFile', { state: 'attached' });
  await p.setInputFiles('#photoFile', MEAL_PHOTO);
  await p.waitForSelector('.photo-items li', { timeout: 15000 });
  check(await p.isChecked('#photoUpgrade'), 'read on the device offline: "read it again with Gemini" offered, ticked');
  await p.selectOption('#photoMeal', 'dinner');
  await p.click('#photoAdd'); await p.waitForSelector('.log-list');
  q = await queue();
  check(q.length === 1 && q[0].status === 'provisional' && q[0].n === 3 && q[0].meal === 'dinner', 'logged, and kept to read again (3 entries, dinner)');
  // Weigh the rice.
  const rice = await p.evaluate(() => window.Tracker.day(window.Tracker.today()).find((e) => /rice/i.test(e.name)).id);
  await p.fill('input[data-entry="' + rice + '"]', '170'); await p.press('input[data-entry="' + rice + '"]', 'Tab');
  check(await p.evaluate(() => window.__calls) === 0, 'still nothing sent while offline');

  // Back online: Gemini's reading, now with rice in it, is offered for comparison.
  await stubGemini(JSON.stringify({ items: [
    { name: 'chapati', search: 'chapati', cooked: true, grams: 80, grams_low: 70, grams_high: 90, kcal_per_100g: 299, confidence: 'high' },
    { name: 'white rice, cooked', search: 'rice', cooked: true, grams: 160, grams_low: 130, grams_high: 190, kcal_per_100g: 130, confidence: 'high' },
    { name: 'dal', search: 'lentils', cooked: true, grams: 180, grams_low: 150, grams_high: 220, kcal_per_100g: 116, confidence: 'high' }
  ], plate_cm: 26, scale: 'plate', notes: '' }));
  await offline(false);
  await go('#/today');
  await p.waitForFunction(() => /better reading of the photo you logged today/.test((document.querySelector('.queue-card') || {}).textContent || ''), null, { timeout: 15000 });
  const before = await p.evaluate(() => window.Tracker.day(window.Tracker.today()).map((e) => e.name).sort().join('|'));
  check(/bread/i.test(before) && /soup/i.test(before), 'nothing changes until the person compares: ' + before);
  await p.click('[data-q-open]'); await p.waitForSelector('.photo-items li');
  check(/you have not weighed or measured; those you have stay/.test(await p.textContent('.photo-card')) &&
    /Replace with this reading/.test(await p.textContent('#photoAdd')) && /Keep the on-device reading/.test(await p.textContent('#photoDiscard')),
    'the comparison says what replacing does');
  await p.click('#photoAdd'); await p.waitForSelector('.log-list');
  const after = await p.evaluate(() => window.Tracker.day(window.Tracker.today()).filter((e) => e.meal === 'dinner').map((e) => e.name + ':' + e.grams + (e.measured ? 'm' : '')));
  check(!after.some((x) => /Bread|soup/i.test(x)), 'the unweighed on-device items are gone: ' + after.join(', '));
  check(after.filter((x) => /rice/i.test(x)).length === 1 && after.some((x) => /rice.*:170m/i.test(x)), 'the weighed rice stays, and is not added twice');
  check(after.some((x) => /Chapati/.test(x)) && after.some((x) => /Lentils/.test(x)), 'Gemini’s other items are added, at dinner');
  check((await queue()).length === 0 && /Replaced with the better reading/.test(await p.textContent('#main')), 'done, and said so');

  // ---- 4. Failing readings: retry or remove ----
  await stubGemini(null);
  await offline(true);
  await p.evaluate(() => { window.LocalModel.isDownloaded = () => false; });
  await go('#/snap'); await p.waitForSelector('#photoFile', { state: 'attached' });
  await p.setInputFiles('#photoFile', MEAL_PHOTO);
  await p.waitForFunction(() => /Saved\. It will be read/.test(document.getElementById('main').textContent));
  await offline(false);
  await go('#/today');
  await p.waitForSelector('[data-q-retry]', { timeout: 15000 });
  check(/could not be read: Bad reply/.test(await p.textContent('.queue-card')) && (await queue())[0].attempts === 3, 'after three failures it says so');
  await stubGemini(gemini);
  await p.click('[data-q-retry]');
  await p.waitForSelector('[data-q-open]', { timeout: 15000 });
  check(true, 'retry reads it');
  await p.click('[data-q-open]'); await p.waitForSelector('#photoDiscard'); await p.click('#photoDiscard');

  // ---- 5. On-device by choice: never uploaded ----
  await p.evaluate(() => { localStorage.setItem('foodlog.engine', 'local'); window.LocalModel.isDownloaded = () => true; });
  await offline(true);
  await go('#/today'); await go('#/snap'); await p.waitForSelector('#photoFile', { state: 'attached' });
  await p.setInputFiles('#photoFile', MEAL_PHOTO);
  await p.waitForSelector('.photo-items li', { timeout: 15000 });
  check(!(await p.$('#photoUpgrade')), 'the on-device engine chosen on purpose: no offer to upload');
  await p.click('#photoAdd'); await p.waitForSelector('.log-list');
  check((await queue()).length === 0, 'and nothing is queued');
  await offline(false);

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
});
