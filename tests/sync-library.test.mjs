// Saved meals and recipes: maths, and sync across simulated devices.
//   node food-log/tests/sync-library.test.mjs

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(here, '..', 'js', f), 'utf8');
const FILES = ['prefs.js', 'profile.js', 'tracker.js', 'library.js', 'sync.js'].map(src);
const clone = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; }

function makeCloud() {
  const c = { docs: {}, subs: [], settings: null, sSubs: [], library: null, lSubs: [] };
  c.backendFor = () => ({
    signIn: async () => ({ uid: 'u1', name: 'T', email: 't@example.com' }),
    signOut: async () => {}, current: () => null,
    onAuth: async (cb) => cb({ uid: 'u1', name: 'T', email: 't@example.com' }),
    pullAll: async () => clone(c.docs),
    push: async (uid, d, doc) => { c.docs[d] = clone(doc); c.subs.forEach((cb) => cb(d, clone(doc))); },
    listen: (uid, cb) => { c.subs.push(cb); return () => {}; },
    pullSettings: async () => (c.settings ? clone(c.settings) : null),
    pushSettings: async (uid, doc) => { c.settings = clone(doc); c.sSubs.forEach((cb) => cb(clone(doc))); },
    listenSettings: (uid, cb) => { c.sSubs.push(cb); return () => {}; },
    pullLibrary: async () => (c.library ? clone(c.library) : null),
    pushLibrary: async (uid, doc) => { c.library = clone(doc); c.lSubs.forEach((cb) => cb(clone(doc))); },
    listenLibrary: (uid, cb) => { c.lSubs.push(cb); return () => {}; }
  });
  return c;
}

function device(cloud) {
  const store = {};
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { documentElement: { setAttribute() {}, removeAttribute() {}, toggleAttribute() {} } }
  });
  ctx.window = ctx;
  ctx.FoodLogConfig = { FIREBASE: { apiKey: 'x' } };
  ctx.FirebaseEngine = {};
  FILES.forEach((code) => vm.runInContext(code, ctx));
  if (cloud) ctx.Sync.useBackend(cloud.backendFor());
  return { L: ctx.Library, T: ctx.Tracker, S: ctx.Sync };
}

// Recipe maths against a hand calculation.
const X = device(null);
const dal = X.L.saveRecipe({ name: 'Dal', servings: 4, cookedGrams: 600, ingredients: [
  { name: 'Lentils (raw)', slug: 'lentil', grams: 200, per100: { kcal: 352, protein: 24.6, iron: 6.5 } },
  { name: 'Oil', slug: 'oil', grams: 15, per100: { kcal: 884, fat: 100 } }] });
const n = X.L.nutrition(dal);
check(Math.abs(n.total.kcal - (704 + 132.6)) < 1e-9, 'recipe total energy is the sum of its ingredients');
check(Math.abs(n.per100.kcal - 836.6 / 6) < 1e-9 && n.servingGrams === 150, 'per 100 g uses the cooked weight; a serving is a quarter');
check(Math.abs(n.perServing.iron - 13 / 4) < 1e-9, 'micronutrients carried through (iron per serving)');
const raw = X.L.nutrition(X.L.saveRecipe({ name: 'Raw', ingredients: [{ name: 'A', grams: 50, per100: { kcal: 100 } }, { name: 'B', grams: 150, per100: { kcal: 300 } }] }));
check(raw.weight === 200 && Math.abs(raw.per100.kcal - 250) < 1e-9 && raw.servings === 1, 'without a cooked weight, raw weight and one serving');
check(X.L.saveRecipe({ name: 'Empty', ingredients: [] }) === null, 'a recipe needs an ingredient');

// A logged recipe counts as complete for vitamins and minerals.
X.T.add('2026-11-08', { name: 'Dal', per100: n.per100, grams: 150, meal: 'lunch', source: 'recipe' });
check(X.T.isComplete(X.T.day('2026-11-08')[0]), 'a logged recipe carries the full nutrient profile');

// Sync between devices.
const cloud = makeCloud();
const A = device(cloud), B = device(cloud);
const meal = A.L.saveMeal('Usual breakfast', [{ name: 'Oats', slug: 'oatmealcooked', grams: 240, per100: { kcal: 71 } }]);
const rec = A.L.saveRecipe({ name: 'Dal', servings: 4, ingredients: [{ name: 'Lentils', grams: 200, per100: { kcal: 352 } }] });
await A.S.signIn(); await B.S.signIn(); await tick();
check(!!B.L.get(meal.id) && !!B.L.get(rec.id), 'a fresh device receives saved meals and recipes');
B.L.remove(meal.id);
await wait(2300); await tick();
check(!A.L.get(meal.id), 'a delete on B reaches A');
check(A.L.merge(cloud.library) === false && !A.L.get(meal.id), 'merging the same copy again changes nothing');
A.L.saveRecipe(Object.assign(clone(A.L.get(rec.id)), { servings: 6 }));
await wait(2300); await tick();
check(B.L.get(rec.id).servings === 6, 'an edit on A reaches B');

console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
process.exit(failures ? 1 : 0);
