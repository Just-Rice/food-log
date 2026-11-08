// Pregnancy and breastfeeding, set on Food is Medicine's profile: Food Log
// uses those reference intakes, shows no energy figure, leaves liver out of
// the suggestions in pregnancy and says so in the report. Then Food is
// Medicine's own pages: the profile question, the targets, the header strip
// and the weight page.
//   NODE_PATH=$(npm root -g) node tests/e2e/pregnancy.test.mjs   (from food-log/)

import { runSuite, isolatedContext, collectErrors } from '../lib/harness.mjs';

await runSuite('pregnancy', async ({ base: BASE, browser: b, check }) => {
  const ctx = await isolatedContext(b, { viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  collectErrors(p, errs);
  const FIM = BASE.replace(/food-log\/$/, 'food-is-medicine/');
  const profile = (stage) => ({ age: 28, sex: 'female', weightKg: 62, heightCm: 166, activity: 1.375, stage });
  await p.goto(BASE);
  await p.evaluate((pr) => { localStorage.clear(); localStorage.setItem('fim.profile.v1', JSON.stringify(pr)); }, profile('pregnant'));
  await p.reload(); await p.waitForSelector('#logSearch');
  const go = (h) => p.evaluate((hh) => { location.hash = hh; }, h);

  // A few days of the same food, low in iron.
  await p.evaluate(() => {
    const T = window.Tracker, F = window.FOODS, food = (s) => F.find((f) => f.slug === s);
    for (let i = 0; i < 4; i++) {
      const d = T.shift(T.today(), -i);
      T.add(d, { food: food('ricewhitecooked'), grams: 400, meal: 'lunch' });
      T.add(d, { food: food('yogurtplain'), grams: 200, meal: 'breakfast' });
    }
  });
  await go('#/history'); await go('#/today'); await p.waitForSelector('.log-summary');

  // ---- Today ----
  const summary = await p.textContent('.log-summary');
  check(/No daily energy figure is shown while you are pregnant/.test(summary) && !/estimated daily need/.test(summary), 'no energy target, and why');
  check(/for pregnancy at your age/.test(await p.textContent('#main')), 'the panel says the intakes are for pregnancy');
  const ironRow = await p.$$eval('.dri-table tr', (rs) => (rs.find((r) => /^\s*Iron/.test(r.textContent)) || {}).textContent || '');
  const ironMg = Number((/([\d.]+) mg/.exec(ironRow) || [])[1]);
  const ironPct = Number((/(\d+)%/.exec(ironRow) || [])[1]);
  check(Math.abs(ironPct - Math.round(ironMg / 27 * 100)) <= 1, 'iron measured against 27 mg: ' + ironRow.replace(/\s+/g, ' '));

  // ---- History: gaps without liver ----
  await go('#/history'); await p.waitForSelector('.gaps-card');
  const gaps = await p.textContent('.gaps-card');
  const suggested = await p.$$eval('.gaps-card [data-gap-add]', (bs) => bs.map((b) => b.dataset.gapAdd));
  const offal = await p.evaluate((ss) => ss.filter((s) => window.FOODS.find((f) => f.slug === s).group === 'offal'), suggested);
  check(suggested.length > 0 && offal.length === 0 && /Liver is left out/.test(gaps), 'no liver suggested in pregnancy, and it says so');
  check(!(await p.$('.week-chart .wk-target')), 'no estimated-need line on the chart');

  // ---- Not pregnant: liver may be suggested again ----
  await p.evaluate((pr) => localStorage.setItem('fim.profile.v1', JSON.stringify(pr)), profile(undefined));
  await p.reload(); await p.waitForSelector('#main');
  await go('#/today'); await go('#/history'); await p.waitForSelector('.gaps-card');
  check(!/Liver is left out/.test(await p.textContent('.gaps-card')), 'not pregnant: no such note');

  // ---- Report ----
  await p.evaluate((pr) => localStorage.setItem('fim.profile.v1', JSON.stringify(pr)), profile('breastfeeding'));
  await p.reload(); await p.waitForSelector('#main');
  await go('#/report'); await p.waitForSelector('.report-head');
  const rep = await p.textContent('#main');
  check(/Profile: 28 · female · 166 cm · 62 kg · breastfeeding/.test(rep) && !/Estimated daily need/.test(rep), 'report: stage listed, no estimated need');

  // ---- Food is Medicine's pages ----
  await p.goto(FIM + '#/you'); await p.waitForSelector('#profileForm');
  check(await p.isVisible('#stageField') && (await p.inputValue('#pStage')) === 'breastfeeding', 'FIM profile: the question shows, with the saved answer');
  await p.selectOption('#pSex', 'male');
  check(!(await p.isVisible('#stageField')), 'hidden for a man');
  await p.selectOption('#pSex', 'female');
  await p.fill('#pAge', '55');
  check(!(await p.isVisible('#stageField')), 'hidden over 50');
  await p.fill('#pAge', '28');
  await p.selectOption('#pStage', 'pregnant');
  await p.click('#profileForm button[type="submit"]');
  await p.waitForSelector('#profileResults h2');
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('fim.profile.v1')).stage) === 'pregnant', 'saved as pregnant');
  const res = await p.textContent('#profileResults');
  check(/Pregnancy/.test(res) && /iron rises to 27 mg/.test(res) && !/Resting/i.test(res), 'results: pregnancy note, no energy figures');
  const ironTarget = await p.$$eval('#profileResults tr', (rs) => (rs.find((r) => /^\s*Iron/.test(r.textContent)) || {}).textContent || '');
  check(/27 mg/.test(ironTarget), 'targets table: iron 27 mg');
  const strip = await p.evaluate(() => Array.from(document.querySelectorAll('.wrap')).map((w) => w.textContent).find((t) => /cm ·/.test(t)) || '');
  check(/Pregnant/.test(strip) && !/kcal/.test(strip), 'header strip: "Pregnant", no kcal: ' + strip.trim());
  await p.evaluate(() => { location.hash = '#/weight'; });
  await p.waitForFunction(() => /Not while you are pregnant/.test(document.getElementById('main').textContent));
  check(!(await p.$('#main form, #main input[type="range"]')), 'weight page: refuses, with no form');
  const blocked = await p.evaluate(() => window.WeightPlan.calculate(JSON.parse(localStorage.getItem('fim.profile.v1')), { goal: 'lose', targetKg: 55, rate: 0.5 }));
  check(blocked.blocked && blocked.targetIntake == null, 'the weight module itself refuses too');
  // Not pregnant any more: back to the ordinary page.
  await p.evaluate(() => { location.hash = '#/you'; });
  await p.waitForSelector('#pStage');
  await p.selectOption('#pStage', '');
  await p.click('#profileForm button[type="submit"]');
  await p.waitForSelector('#profileResults h2');
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('fim.profile.v1')).stage) === undefined && /Resting|kcal/i.test(await p.textContent('#profileResults')),
    'answering "No" removes it and the energy figures return');

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
});
