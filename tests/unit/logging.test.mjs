// Moving, copying and renaming entries (and how they sync), the spreadsheet
// export, and deleting everything from the cloud. Runs the real tracker,
// sync and CSV code in isolated contexts against an in-memory backend.
//   node tests/unit/logging.test.mjs   (from food-log/)

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(here, '..', '..', 'js', f), 'utf8');
const TRACKER = src('tracker.js'), SYNC = src('sync.js'), CSV = src('csv.js');
const clone = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));

let failures = 0;
const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };

function makeCloud() {
  const cloud = { docs: {}, settings: { profile: null }, library: { meals: {} }, subs: [], writes: 0, reauths: 0, userDeleted: false };
  cloud.backendFor = () => ({
    signIn: async () => ({ uid: 'u1', name: 'Test', email: 'test@example.com' }),
    signOut: async () => {}, current: () => null,
    onAuth: async (cb) => cb({ uid: 'u1', name: 'Test', email: 'test@example.com' }),
    pullAll: async () => clone(cloud.docs),
    push: async (uid, date, doc) => { cloud.writes++; cloud.docs[date] = clone(doc); cloud.subs.forEach((cb) => cb(date, clone(doc))); },
    listen: (uid, cb) => { cloud.subs.push(cb); return () => { cloud.subs = cloud.subs.filter((x) => x !== cb); }; },
    reauth: async () => { cloud.reauths++; },
    deleteAll: async () => { const n = Object.keys(cloud.docs).length; cloud.docs = {}; cloud.settings = null; cloud.library = null; return n; },
    deleteUser: async () => { cloud.userDeleted = true; }
  });
  return cloud;
}

function device(cloud) {
  const store = {};
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }
  });
  ctx.window = ctx;
  ctx.FoodLogConfig = { FIREBASE: { apiKey: 'x' } };
  ctx.FirebaseEngine = {};
  vm.runInContext(TRACKER, ctx);
  vm.runInContext(SYNC, ctx);
  vm.runInContext(CSV, ctx);
  if (cloud) ctx.Sync.useBackend(cloud.backendFor());
  return { T: ctx.Tracker, S: ctx.Sync, C: ctx.Csv, store };
}

const food = (slug, kcal, extra) => ({ slug, name: slug, nutrients: Object.assign({ kcal, protein: 2, iron: 0.5, vitc: 1 }, extra) });
const D1 = '2026-11-06', D2 = '2026-11-07';

// ---- move, copy, rename ----
{
  const cloud = makeCloud();
  const A = device(cloud), B = device(cloud);
  await A.S.signIn(); await B.S.signIn(); await tick();
  const rice = A.T.add(D1, { food: food('rice', 130), grams: 150, meal: 'lunch' });
  const dal = A.T.add(D1, { food: food('dal', 116), grams: 200, meal: 'lunch' });
  const tea = A.T.add(D1, { name: 'Chai', fixed: { kcal: 90 }, meal: 'breakfast' });

  // Within a day: just the meal changes.
  const m1 = A.T.move(D1, tea.id, D1, 'snack');
  check(m1 && m1.id === tea.id && A.T.find(D1, tea.id).meal === 'snack', 'move within a day keeps the entry and changes its meal');

  // Across days: buried on the old day, a copy on the new one.
  const m2 = A.T.move(D1, rice.id, D2, 'dinner');
  check(!A.T.find(D1, rice.id) && !!A.T.dayDoc(D1).deleted[rice.id], 'moved entry is gone from its old day, with a tombstone');
  check(m2 && m2.id !== rice.id && A.T.find(D2, m2.id).meal === 'dinner' && A.T.find(D2, m2.id).grams === 150, 'and is on the new day, at the new meal, same amount');
  check(A.T.move(D1, 'nope', D2, 'lunch') === null && A.T.move(D1, dal.id, 'not-a-date', 'lunch') === null, 'unknown entries and bad dates are refused');

  // Rename.
  check(A.T.rename(D1, dal.id, '  Toor dal  ') && A.T.find(D1, dal.id).name === 'Toor dal', 'rename trims and stores the name');
  check(A.T.rename(D1, dal.id, '   ') === false, 'an empty name is refused');

  // Copy a meal.
  const n = A.T.copyMeal(D1, 'lunch', D2, 'lunch');
  const copies = A.T.day(D2).filter((e) => e.meal === 'lunch');
  check(n === 1 && copies.length === 1 && copies[0].name === 'Toor dal' && copies[0].id !== dal.id, 'copyMeal copies with fresh ids');
  check(A.T.copyMeal(D1, 'dinner', D2, 'dinner') === 0, 'copying an empty meal copies nothing');

  // A photo entry's copy loses the photo link; a moved one keeps it.
  const ph = A.T.add(D1, { food: food('roti', 299), grams: 80, gramsLow: 60, gramsHigh: 100, source: 'photo', photoId: 'p1', plateAssumed: 26, meal: 'dinner' });
  A.T.copyMeal(D1, 'dinner', D2, 'breakfast');
  check(A.T.day(D2).some((e) => e.meal === 'breakfast' && e.name === 'roti' && !e.photoId), 'a copied photo item is not tied to the photo (plate rescaling stays on the original)');
  const mp = A.T.move(D1, ph.id, D2, 'dinner');
  check(mp.photoId === 'p1', 'a moved photo item stays tied to its photo');

  // Everything reaches device B.
  await A.S.flush(); await tick();
  const same = (d) => A.T.day(d).map((e) => e.id + e.meal + e.name).sort().join() === B.T.day(d).map((e) => e.id + e.meal + e.name).sort().join();
  check(same(D1) && same(D2) && !B.T.find(D1, rice.id), 'moves, copies and renames converge on the other device');

  // ---- CSV ----
  const csv = A.C.entries(A.T);
  check(csv.charCodeAt(0) === 0xfeff && /\r\n$/.test(csv), 'CSV: BOM and CRLF lines');
  const lines = csv.slice(1).trim().split('\r\n');
  const head = lines[0].split(',');
  check(head[0] === 'Date' && head.includes('Iron (mg)') && head.includes('Energy (kcal)'), 'CSV header: date, energy, nutrients with units');
  check(lines.length === 1 + A.T.day(D1).length + A.T.day(D2).length, 'one row per entry');
  const chai = lines.find((l) => /Chai/.test(l)).split(',');
  check(chai[head.indexOf('Energy (kcal)')] === '90' && chai[head.indexOf('Iron (mg)')] === '' && chai[head.indexOf('Source')] === 'Typed in',
    'typed-in entry: energy filled, unknown iron blank (not 0)');
  const dalRow = lines.find((l) => /Toor dal/.test(l)).split(',');
  check(dalRow[head.indexOf('Iron (mg)')] === '1', 'nutrients scaled to the amount (200 g × 0.5 mg/100 g = 1 mg)');
  const photoRow = lines.find((l) => /,roti,/.test(l) && /estimate/.test(l)).split(',');
  check(photoRow[head.indexOf('Grams (low)')] === '60' && photoRow[head.indexOf('Energy high (kcal)')] === '299', 'estimates carry their range');
  check(A.C.cell('=HYPERLINK("x")') === '"\'=HYPERLINK(""x"")"' && A.C.cell('+1') === "'+1" && A.C.cell('@x') === "'@x" && A.C.cell('a,b') === '"a,b"' && A.C.cell(-3) === '-3',
    'cells: formulas defused, quotes doubled, commas quoted, numbers left alone');
  const days = A.C.days(A.T).slice(1).trim().split('\r\n');
  check(days.length === 3 && /^2026-11-06,/.test(days[1]) && /^2026-11-07,/.test(days[2]), 'daily CSV: one row per logged day, oldest first');

  // ---- delete everything in the cloud ----
  const writesBefore = cloud.writes;
  A.T.add(D2, { food: food('apple', 52), grams: 100, meal: 'snack' });    // pending push
  const localBefore = A.T.day(D1).length + A.T.day(D2).length;
  const n2 = await A.S.deleteCloud();
  await new Promise((r) => setTimeout(r, 2500));                         // past the push delay
  check(cloud.reauths === 1 && cloud.userDeleted, 'Google re-confirmation asked, then the sign-in account deleted');
  check(n2 === 2 && Object.keys(cloud.docs).length === 0 && cloud.settings === null && cloud.library === null, 'every day, the settings and the library are gone from the cloud');
  check(cloud.writes === writesBefore, 'nothing is pushed after deleting, not even the edit that was waiting');
  check(A.T.day(D1).length + A.T.day(D2).length === localBefore, 'the log on this device is untouched');
  check(A.S.state().status === 'off' && !A.S.state().user && A.store['foodlog.sync.v1'] == null, 'signed out, and sync will not resume on reload');

  // A failed delete keeps sync paused rather than re-uploading.
  const cloud2 = makeCloud();
  const E = device(cloud2);
  await E.S.signIn(); await tick();
  E.T.add(D1, { food: food('rice', 130), grams: 100, meal: 'lunch' }); await E.S.flush();
  const b2 = cloud2.backendFor();
  b2.deleteAll = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
  E.S.useBackend(b2);
  await E.S.deleteCloud().catch(() => {});
  const w = cloud2.writes;
  E.T.add(D1, { food: food('dal', 116), grams: 100, meal: 'lunch' });
  await new Promise((r) => setTimeout(r, 2500));
  check(E.S.state().status === 'error' && /paused/.test(E.S.state().error) && cloud2.writes === w, 'a failed delete leaves sync paused and sends nothing');
}

// ---- supplement entries ----
{
  const cloud = makeCloud();
  const A = device(cloud), B = device(cloud);
  await A.S.signIn(); await B.S.signIn(); await tick();
  const s = A.T.add(D1, { source: 'supplement', name: 'Iron 14 mg', amounts: { iron: 14, folicAcid: 200, folate: 340, bogus: 5 }, doses: 2, meal: 'breakfast' });
  check(s && s.amounts.iron === 14 && !('bogus' in s.amounts) && s.doses === 2, 'supplement entry: known nutrients only, doses kept');
  const n = A.T.nutrientsOf(s), sp = A.T.suppOf(s);
  check(n.iron === 28 && n.folate === 680 && n.kcal === 0 && !('folicAcid' in n), 'nutrients: amounts × doses, folate in DFE, no energy');
  check(sp.iron === 28 && sp.folate === 400, 'toward supplement limits: folate counts folic acid only');
  check(A.T.isComplete(s) && !A.T.isEstimate(s) && A.T.kcalRange(s).join() === '0,0', 'complete, not an estimate, no energy range');
  A.T.add(D1, { food: food('oats', 380), grams: 40, meal: 'breakfast' });
  check(A.T.copyMeal(D1, 'breakfast', D2, 'breakfast') === 1, 'copying a meal leaves the supplement taken with it behind');
  A.T.update(D1, s.id, { grams: 300 });
  check(A.T.find(D1, s.id).grams == null, 'a weight edit cannot turn a supplement into food');
  A.T.update(D1, s.id, { doses: 1 });
  await A.S.flush(); await tick();
  const sb = B.T.find(D1, s.id);
  check(sb && sb.source === 'supplement' && sb.doses === 1 && B.T.totals(D1).supp.iron === 14, 'supplement entries sync and keep their supplement totals');
  const row = A.C.entries(A.T).split('\r\n').find((l) => /Iron 14 mg/.test(l));
  check(/,Supplement,/.test(row) && /,14,/.test(row), 'CSV: source "Supplement" and its iron');
}

console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
process.exit(failures ? 1 : 0);
