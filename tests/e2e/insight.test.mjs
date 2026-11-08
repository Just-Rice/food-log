// The week's nutrient gaps on History, the printable report, and the Settings
// cards for installing and for calendar reminders; plus the Snap page when
// the browser is offline.
//   NODE_PATH=$(npm root -g) node tests/e2e/insight.test.mjs   (from food-log/)

import { runSuite, isolatedContext, collectErrors, shot } from '../lib/harness.mjs';

await runSuite('insight', async ({ base: BASE, browser: b, check }) => {
  const ctx = await isolatedContext(b, { viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  collectErrors(p, errs);
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('fim.prefs.v1', JSON.stringify({ diet: 'vegetarian', allergens: [], customExclude: '' })); });
  await p.reload(); await p.waitForSelector('#main');
  const go = (h) => p.evaluate((hh) => { location.hash = hh; }, h);

  // ---- Gaps: too few days, then four days of rice and yogurt (low iron) ----
  await go('#/history'); await p.waitForSelector('.gaps-card');
  check(/at least three days/.test(await p.textContent('.gaps-card')), 'no log: asks for three days instead of guessing');

  await p.evaluate(() => {
    const T = window.Tracker, F = window.FOODS;
    const food = (slug) => F.find((f) => f.slug === slug);
    const today = T.today();
    for (let i = 0; i < 4; i++) {
      const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - i);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      T.add(key, { food: food('ricewhitecooked'), grams: 400, meal: 'lunch' });
      T.add(key, { food: food('yogurtplain'), grams: 200, meal: 'breakfast' });
      if (i === 0) T.add(key, { name: 'Takeaway', fixed: { kcal: 900 }, meal: 'dinner' });
    }
  });
  await go('#/today'); await go('#/history'); await p.waitForSelector('.gaps-card .gap');
  const gaps = await p.textContent('.gaps-card');
  check(/Iron: averaged [\d.]+ mg a day, \d+% of your 18 mg/.test(gaps), 'iron flagged low against the generic Daily Value');
  check(/general label Daily Values/.test(gaps), 'says it is the generic reference without a profile');
  check(/without vitamin and mineral data/.test(gaps), 'typed-in energy-only entry: floor caveat');
  check(!/\beat (more|less)\b/i.test(gaps), 'worded about nutrients, never "eat more/less"');
  const ironFoods = await p.$$eval('.gaps-card .gap', (gs) => {
    const g = gs.find((x) => /^\s*Iron/.test(x.textContent));
    return g ? Array.from(g.querySelectorAll('[data-gap-add]')).map((b) => b.dataset.gapAdd) : [];
  });
  const veg = await p.evaluate((slugs) => slugs.every((s) => (window.FOODS.find((f) => f.slug === s).diet || []).indexOf('vegetarian') >= 0), ironFoods);
  check(ironFoods.length > 0 && veg, 'iron suggestions respect the vegetarian setting: ' + ironFoods.join(', '));
  await shot(p, 'gaps.png', { fullPage: true });

  // Add from a suggestion: Today opens with that food picked at the portion shown.
  check(await p.$$eval('.gaps-card details.gap', (ds) => ds.length >= 5 && ds[0].open && !ds[4].open),
    'every low nutrient listed, the first ones open');
  check(/· 1 cup[^:]*: \d+%/.test(gaps), 'portions read "1 cup"');
  const first = await p.$('.gaps-card details.gap[open] [data-gap-add]');
  const slug = await first.getAttribute('data-gap-add');
  const grams = /[?&]g=(\d+)/.exec(await first.getAttribute('href'))[1];
  await first.click();
  await p.waitForSelector('.pick-panel');
  check(/#\/today/.test(p.url()) && (await p.inputValue('#pickGrams')) === grams, 'suggestion opens the add panel at ' + grams + ' g of ' + slug);
  await p.click('#pickCancel');

  // ---- Report ----
  await go('#/history'); await p.waitForSelector('a[href="#/report"]');
  await p.click('a[href="#/report"]'); await p.waitForSelector('.report-head');
  let rep = await p.textContent('#main');
  check(/4 of 14 days logged/.test(rep), 'report: 14-day range by default, 4 days logged');
  check(/Dietary settings: Vegetarian/i.test(rep), 'report: dietary settings listed');
  check(/not a medical document/.test(rep), 'report: disclaimer');
  check(/Energy only, no vitamin and mineral data\s*\d+%/.test(rep), 'report: data-quality shares');
  await p.click('[data-rrange="7"]');
  check(/4 of 7 days logged/.test(await p.textContent('.report-head')), 'report: 7-day range');
  await p.fill('#reportNotes', 'Ask about iron.');
  check(await p.evaluate(() => localStorage.getItem('foodlog.report.notes')) === 'Ask about iron.', 'notes kept on the device');
  await p.emulateMedia({ media: 'print' });
  const printView = await p.evaluate(() => ({
    nav: getComputedStyle(document.querySelector('nav, .nav, header') || document.body).display,
    buttons: document.getElementById('printBtn').getClientRects().length ? 'shown' : 'none',
    notes: getComputedStyle(document.getElementById('reportNotesPrint')).display,
    text: document.getElementById('reportNotesPrint').textContent
  }));
  check(printView.buttons === 'none' && printView.notes !== 'none' && printView.text === 'Ask about iron.',
    'print: buttons hidden, typed notes printed: ' + JSON.stringify(printView));
  await shot(p, 'report-print.png', { fullPage: true });
  await p.emulateMedia({ media: 'screen' });
  rep = null;

  // ---- Settings: install and reminders ----
  await go('#/settings'); await p.waitForSelector('#remBtn');
  check(/Install Food Log/.test(await p.textContent('#main')), 'install card shown');
  await p.click('[data-rem-on="breakfast"]'); await p.click('[data-rem-on="lunch"]'); await p.click('[data-rem-on="dinner"]');
  await p.click('#remBtn');
  check(/Tick at least one meal/.test(await p.textContent('#remMsg')), 'no meal ticked: asks for one');
  await p.click('[data-rem-on="lunch"]');
  await p.fill('[data-rem-time="lunch"]', '12:30');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#remBtn')]);
  const ics = await new Promise(async (res) => { const s = await dl.createReadStream(); let t = ''; s.on('data', (c) => { t += c; }); s.on('end', () => res(t)); });
  check(dl.suggestedFilename() === 'food-log-reminders.ics', 'calendar file downloaded');
  check((ics.match(/BEGIN:VEVENT/g) || []).length === 1 && /RRULE:FREQ=DAILY/.test(ics) && /T123000/.test(ics),
    'one daily event at 12:30');
  check(JSON.parse(await p.evaluate(() => localStorage.getItem('foodlog.reminders.v1'))).lunch.time === '12:30', 'reminder times remembered');

  // ---- Offline Snap ----
  await ctx.setOffline(true);
  await p.evaluate(() => window.dispatchEvent(new Event('offline')));
  await go('#/today'); await go('#/snap');
  await p.waitForSelector('#main .note');
  const snap = await p.textContent('#main');
  check(/You’re offline/.test(snap), 'offline: Snap explains what needs a connection');
  await ctx.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.waitForFunction(() => !/You’re offline/.test(document.getElementById('main').textContent));
  check(true, 'back online: the notice goes away');

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
});
