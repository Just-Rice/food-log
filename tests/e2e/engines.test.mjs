// Free / key / on-device engine selection, the model cascade in the real UI,
// and "Try a stronger model". The free engine's Firebase call is stubbed
// (window.FirebaseEngine.engine.call); the own-key engine's Gemini API is
// route-mocked. The reply is Gemini 3.5 Flash-Lite's real answer to a full
// English breakfast photo (8 items).
//   NODE_PATH=$(npm root -g) node tests/e2e/engines.test.mjs   (from food-log/)

import { runSuite, isolatedContext, collectErrors, mockGemini, fixture, MEAL_PHOTO } from '../lib/harness.mjs';

const reply = fixture('flash-lite-english-reply.txt');
const img = MEAL_PHOTO;

await runSuite('engines', async ({ base: BASE, browser: b, check }) => {
  const ctx = await isolatedContext(b, { viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  collectErrors(p, errs, { extraIgnore: (m) => /sync\.js/.test((m.location() || {}).url || '') });
  // Own-key path: answer as the model asked for.
  let keyCalls = [];
  await mockGemini(p, reply, { onCall: (u) => keyCalls.push(u.split('/models/')[1].split(':')[0]) });
  // Firebase must never be reached for real in this test (the isolated
  // context aborts it anyway; kept explicit as in the original suite).
  await p.route('https://www.gstatic.com/firebasejs/**', (route) => {
    ctx.blocked.push(route.request().url());
    return route.abort();
  });

  const stub = (behaviour) => p.evaluate((beh) => {
    window.__calls = [];
    window.FirebaseEngine.engine.call = function (model) {
      window.__calls.push(model);
      const rule = beh[model] || beh['*'] || 'ok';
      const mk = (status, msg, details) => Object.assign(new Error(msg), { status, details });
      if (rule === 'ok') return Promise.resolve(window.__reply);
      if (rule === 'day') return Promise.reject(mk(429, 'You exceeded your current quota', [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }]));
      if (rule === 'busy') return Promise.reject(mk(503, 'UNAVAILABLE: high demand'));
      if (rule === 'user') return Promise.reject(mk(429, 'Quota exceeded for quota metric Generate content requests per minute per project per user'));
      return Promise.reject(new Error(rule));
    };
  }, behaviour);
  const fresh = async () => {
    await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); }); await p.reload();
    await p.evaluate((r) => { window.__reply = r; }, reply);
  };
  const snapPhoto = async () => {
    await p.evaluate(() => { location.hash = '#/today'; }); await p.evaluate(() => { location.hash = '#/snap'; });
    await p.waitForSelector('#photoFile', { state: 'attached' });
    await p.setInputFiles('#photoFile', img);
    await p.waitForSelector('.photo-items li, .note.danger', { timeout: 20000 });
  };

  // 1. No key, no on-device model: Free is the only engine, ready to use.
  await fresh();
  await p.evaluate(() => { location.hash = '#/snap'; }); await p.waitForSelector('#photoFile', { state: 'attached' });
  check(!(await p.$('[data-engine]')), 'one engine available: no chooser shown');
  check(/free service/.test(await p.textContent('#main')), 'free-service privacy note shown');

  // 2. Lite spent for the day -> next model answers, spent remembered.
  await p.evaluate((r) => { window.__reply = r; }, reply);
  await stub({ 'gemini-3.5-flash-lite': 'day' });
  await snapPhoto();
  const t2 = await p.textContent('.photo-card');
  check(/Read by Gemini 3\.1 Flash-Lite/.test(t2), 'cascade: 3.5 Lite spent, read by 3.1 Flash-Lite');
  check(await p.evaluate(() => window.Cascade.isSpent('free', 'gemini-3.5-flash-lite')), 'spent model remembered');
  check((await p.$$('.photo-items li')).length === 8, 'all 8 breakfast items shown');

  // 3. Try a stronger model.
  await stub({});
  await p.click('#photoStronger');
  await p.waitForFunction(() => /Read by Gemini 3\.8 Flash/.test((document.querySelector('.photo-card') || {}).textContent || ''), null, { timeout: 15000 });
  check(await p.evaluate(() => window.__calls.join()) === 'gemini-3.8-flash', 'stronger model: only 3.8 Flash asked');
  check(!(await p.$('#photoStronger')), 'no stronger button once read by the stronger model');

  // 4. Stronger model busy -> first reading kept with a warning.
  await p.click('#photoDiscard');
  await stub({});
  await snapPhoto();
  await stub({ 'gemini-3.8-flash': 'busy' });
  await p.click('#photoStronger');
  await p.waitForSelector('.note.warn', { timeout: 15000 });
  check(/first reading is kept/.test(await p.textContent('.note.warn')), 'stronger failure keeps the first reading');
  check(await p.evaluate(() => window.__calls.length) === 2, 'busy model retried once (' + await p.evaluate(() => window.__calls.join()) + ')');
  await p.click('#photoDiscard');

  // 5. Every model spent -> clear message with alternatives.
  await stub({ '*': 'day' });
  await snapPhoto();
  const err5 = await p.textContent('.note.danger');
  check(/used up/.test(err5) && /own free Gemini key/.test(err5), 'all spent: message offers key or on-device');
  const calls5 = await p.evaluate(() => window.__calls.length);
  check(calls5 <= 5, 'all spent: at most one call per model (' + calls5 + ')');

  // 6. Per-user rate limit -> stop, nothing marked spent.
  await p.evaluate(() => window.Cascade.clear());
  await stub({ '*': 'user' });
  await snapPhoto();
  check(/Too many photos/.test(await p.textContent('.note.danger')), 'per-user limit: "wait a moment" message');
  check(await p.evaluate(() => window.__calls.length) === 1 && !(await p.evaluate(() => window.Cascade.isSpent('free', 'gemini-3.5-flash-lite'))), 'per-user limit: one call, no model marked spent');

  // 7. With a key: chooser shows Free + Your key; key engine uses the cascade too.
  await p.evaluate(() => { window.Cascade.clear(); localStorage.setItem('fim.gemini.key', 'test-key-123456'); });
  await p.evaluate(() => { location.hash = '#/today'; }); await p.evaluate(() => { location.hash = '#/snap'; });
  await p.waitForSelector('[data-engine="key"]');
  const chips = await p.$$eval('[data-engine]', bs => bs.map(x => x.dataset.engine + ':' + x.getAttribute('aria-pressed')));
  check(chips.join() === 'free:true,key:false', 'chooser: Free (default) and Your key: ' + chips.join());
  await p.click('[data-engine="key"]');
  keyCalls = [];
  await snapPhoto();
  check(keyCalls[0] === 'gemini-3.5-flash-lite' && /Read by Gemini 3\.5 Flash-Lite/.test(await p.textContent('.photo-card')), 'own key: first free model asked (' + keyCalls.join() + ')');
  await p.click('#photoDiscard');
  // A model picked by hand on Food is Medicine is respected.
  await p.evaluate(() => localStorage.setItem('fim.gemini.model', 'gemini-3.6-flash'));
  keyCalls = [];
  await snapPhoto();
  check(keyCalls.join() === 'gemini-3.6-flash', 'own key: hand-picked model used alone (' + keyCalls.join() + ')');

  check(errs.length === 0, 'no console/page errors: ' + JSON.stringify(errs));
});
