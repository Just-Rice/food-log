// On-device engine and match-guard tests. The real model cannot run in a
// headless browser, so LocalModel is stubbed to return Gemma 4 E2B's actual
// reply to a thali photo (captured from a CPU run; tests/fixtures/
// gemma-thali-reply.json). The same reply also goes through the own-key
// Gemini path, route-mocked, to check the matcher's guards.
//   NODE_PATH=$(npm root -g) node tests/e2e/local.test.mjs   (from food-log/)

import { runSuite, isolatedContext, collectErrors, mockGemini, fixture, MEAL_PHOTO } from '../lib/harness.mjs';

const gemmaText = fixture('gemma-thali-reply.json');

await runSuite('local', async ({ base: BASE, browser: b, check }) => {
  const p = await (await isolatedContext(b, { viewport: { width: 1200, height: 900 } })).newPage();
  const errs = [];
  collectErrors(p, errs);
  await mockGemini(p, gemmaText, {
    models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }]
  });

  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
  // 1. With no key and no download, the free engine is ready: no setup card.
  await p.goto(BASE + '#/snap'); await p.waitForSelector('#photoFile', { state: 'attached' });
  check(!(await p.$('.local-card')), 'free engine available: Snap needs no setup');

  // 2. The on-device model is offered in Settings.
  await p.goto(BASE + '#/settings'); await p.waitForSelector('.local-card h2');
  await p.waitForFunction(() => !document.querySelector('.local-card').textContent.includes('Checking'), null, { timeout: 10000 });
  const card = await p.textContent('.local-card');
  console.log('   headless local card says:', card.replace(/\s+/g, ' ').slice(-160));
  check(card.includes('Gemma 4 E2B') && /rougher/.test(card), 'settings offers the on-device model, saying it is rougher');

  // 3. Gemini path with Gemma's real (generic) reply: curry must not become curry powder.
  await p.evaluate(() => { localStorage.setItem('fim.gemini.key', 'test-key-123456'); localStorage.setItem('foodlog.engine', 'key'); });
  await p.goto(BASE + '#/snap'); await p.reload(); await p.waitForSelector('#photoFile', { state: 'attached' });
  await p.setInputFiles('#photoFile', MEAL_PHOTO);
  await p.waitForSelector('.photo-items li', { timeout: 15000 });
  const rows = await p.$$eval('.photo-items li', ls => ls.map(l => l.querySelector('.p-name').textContent.trim() + ' => ' + l.querySelector('select').selectedOptions[0].textContent));
  console.log('   ' + rows.join('\n   '));
  check(!rows.some(r => /powder|seasoning/i.test(r.split('=>')[1])), 'no item auto-matched to a powder or seasoning');
  check(/White rice, cooked/.test(rows[0]), 'rice still matched to cooked rice');
  check(/Chapati/.test(rows[1]), 'roti still matched to chapati');
  // Re-match a vague item by search.
  await p.fill('[data-psearch="4"]', 'lentils');
  await p.waitForSelector('[data-psuggest="4"] button');
  const pick = await p.$$eval('[data-psuggest="4"] button', bs => bs.map(x => x.textContent));
  const target = pick.findIndex(x => /Lentils, cooked/.test(x));
  check(target >= 0, 'search offers cooked lentils for the vague curry: ' + pick.slice(0, 3).join(' | '));
  if (target >= 0) {
    await (await p.$$('[data-psuggest="4"] button'))[target].click();
    const sel4 = await p.$eval('[data-pmatch="4"]', s => s.selectedOptions[0].textContent);
    check(/Lentils, cooked/.test(sel4), 'item 5 re-matched to ' + sel4);
  }
  await p.click('#photoDiscard');

  // 4. Both engines: chooser appears, choice is remembered, local path is used.
  await p.evaluate((text) => {
    window.LocalModel.isDownloaded = () => true;
    window.__localCalls = 0;
    window.LocalModel.analyse = (file, opts, onStatus) => {
      window.__localCalls++;
      onStatus({ phase: 'loading' });
      return window.Photo.prepare(file).then(img => new Promise(r => setTimeout(() => {
        onStatus({ phase: 'writing', count: 120 });
        setTimeout(() => { const out = window.Photo.parse(text); out.dataUrl = img.dataUrl; r(out); }, 300);
      }, 300)));
    };
  }, gemmaText);
  await p.evaluate(() => { location.hash = '#/today'; }); await p.evaluate(() => { location.hash = '#/snap'; });
  await p.waitForSelector('[data-engine="local"]');
  check(await p.getAttribute('[data-engine="key"]', 'aria-pressed') === 'true' && !!(await p.$('[data-engine="free"]')), 'three engines offered; the chosen key engine is selected');
  await p.click('[data-engine="local"]');
  check(await p.getAttribute('[data-engine="local"]', 'aria-pressed') === 'true', 'choosing on-device is shown as selected');
  check((await p.textContent('#main')).includes('never leaves it'), 'on-device privacy note shown');
  await p.setInputFiles('#photoFile', MEAL_PHOTO);
  await p.waitForSelector('#snapStatus');
  const st1 = await p.textContent('#snapStatus');
  await p.waitForFunction(() => /tokens so far/.test((document.getElementById('snapStatus') || {}).textContent || ''), null, { timeout: 5000 });
  check(/Loading|Writing/.test(st1), 'busy status shows on-device progress: ' + st1);
  await p.waitForSelector('.photo-items li', { timeout: 10000 });
  check(await p.evaluate(() => window.__localCalls) === 1, 'photo went to the on-device engine');
  check(await p.evaluate(() => localStorage.getItem('foodlog.engine')) === 'local', 'engine choice remembered');

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
});
