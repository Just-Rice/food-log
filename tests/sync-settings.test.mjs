// Settings sync: the profile and dietary settings follow the account, edits
// made on Food is Medicine (which writes the same storage without telling
// Food Log) are noticed, and the Gemini key never leaves the device.
//   node food-log/tests/sync-settings.test.mjs

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(here, '..', 'js', f), 'utf8');
const FILES = ['prefs.js', 'profile.js', 'tracker.js', 'sync.js'].map(src);
const clone = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; }

function makeCloud() {
  const cloud = { docs: {}, subs: [], settings: null, settingsSubs: [] };
  cloud.backendFor = () => ({
    signIn: async () => ({ uid: 'u1', name: 'Test', email: 'test@example.com' }),
    signOut: async () => {},
    current: () => null,
    onAuth: async (cb) => cb({ uid: 'u1', name: 'Test', email: 'test@example.com' }),
    pullAll: async () => clone(cloud.docs),
    push: async (uid, date, doc) => { cloud.docs[date] = clone(doc); cloud.subs.forEach((cb) => cb(date, clone(doc))); },
    listen: (uid, cb) => { cloud.subs.push(cb); return () => { cloud.subs = cloud.subs.filter((x) => x !== cb); }; },
    pullSettings: async () => (cloud.settings ? clone(cloud.settings) : null),
    pushSettings: async (uid, doc) => { cloud.settings = clone(doc); cloud.settingsSubs.forEach((cb) => cb(clone(doc))); },
    listenSettings: (uid, cb) => { cloud.settingsSubs.push(cb); return () => { cloud.settingsSubs = cloud.settingsSubs.filter((x) => x !== cb); }; }
  });
  return cloud;
}

/** A device; passing an existing `store` simulates reloading the same browser. */
function device(cloud, store) {
  store = store || {};
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    document: { documentElement: { setAttribute() {}, removeAttribute() {}, toggleAttribute() {} } }
  });
  ctx.window = ctx;
  ctx.FoodLogConfig = { FIREBASE: { apiKey: 'x' } };
  ctx.FirebaseEngine = {};
  FILES.forEach((code) => vm.runInContext(code, ctx));
  ctx.Sync.useBackend(cloud.backendFor());
  return { P: ctx.Prefs, Prof: ctx.Profile, S: ctx.Sync, store };
}

const PROFILE = { age: 34, sex: 'female', weightKg: 62, heightCm: 166, activity: 1.375 };

// 1. A's settings reach a fresh B; the key stays on A.
const cloud = makeCloud();
const A = device(cloud), B = device(cloud);
A.Prof.save(PROFILE);
A.P.set('diet', 'vegetarian');
A.store['fim.gemini.key'] = 'AIza-secret-key-123';
await A.S.signIn(); await tick();
check(cloud.settings && cloud.settings.diet.diet === 'vegetarian' && cloud.settings.profile.age === 34, 'first device pushes profile and diet');
check(!JSON.stringify(cloud.settings).includes('AIza-secret'), 'the Gemini key is not in the synced document');
await B.S.signIn(); await tick();
check(B.P.get('diet') === 'vegetarian' && B.Prof.get() && B.Prof.get().heightCm === 166, 'a fresh device receives the account settings');

// 2. An edit in Food Log on A reaches B (after the push delay).
A.P.set('allergens', ['peanut']);
await wait(2300); await tick();
check(B.P.get('allergens').join() === 'peanut', 'an allergy added on A reaches B');

// 3. An edit made on Food is Medicine (direct storage write) is noticed on reload.
const prefsRaw = JSON.parse(B.store['fim.prefs.v1']);
prefsRaw.diet = 'vegan';
B.store['fim.prefs.v1'] = JSON.stringify(prefsRaw);
await B.S.signOut().catch(() => {});
B.store['foodlog.sync.settings.v1'] = JSON.stringify({ profile: PROFILE, diet: { diet: 'vegetarian', allergens: ['peanut'], customExclude: '' } });
B.store['foodlog.sync.v1'] = '1';
const B2 = device(cloud, B.store);           // the same browser, reloaded
await B2.S.start(); await tick(); await tick();
check(cloud.settings.diet.diet === 'vegan', 'an edit made on Food is Medicine is detected and pushed');
check(A.P.get('diet') === 'vegan', 'and reaches the other device');

// 4. Both sides changed since the last sync: the edit on this device wins.
A.Prof.save(Object.assign({}, PROFILE, { weightKg: 60 }));
cloud.settings = Object.assign(clone(cloud.settings), { profile: Object.assign({}, PROFILE, { weightKg: 65 }) });
await wait(2300); await tick();
check(cloud.settings.profile.weightKg === 60, 'conflicting edits: the one made on the device in use wins');

// 5. A device with nothing set does not wipe the account.
const C = device(cloud);
await C.S.signIn(); await tick();
check(cloud.settings.profile && cloud.settings.diet.diet === 'vegan', 'an empty device adopts, never wipes, the account settings');

// 6. Signing out keeps the local settings.
await C.S.signOut();
check(C.P.get('diet') === 'vegan' && !!C.Prof.get(), 'sign-out leaves local settings as they are');

// 7. "Hide calories" follows the account to the other devices.
A.store['foodlog.hideKcal'] = '1';
A.S.settingsChanged();
await wait(2300); await tick();
check(cloud.settings.display && cloud.settings.display.hideKcal === true, 'hide calories is pushed with the settings');
check(B2.store['foodlog.hideKcal'] === '1', 'and switched on on the other device');
delete B2.store['foodlog.hideKcal'];
B2.S.settingsChanged();
await wait(2300); await tick();
check(!A.store['foodlog.hideKcal'] && cloud.settings.display.hideKcal === false, 'switching it off on one device switches it off on the others');

// 8. Favourite cuisines sync with the dietary settings.
A.P.set('cuisines', ['indian', 'mexican']);
await wait(2300); await tick();
check(JSON.stringify(cloud.settings.cuisines) === '["indian","mexican"]', 'favourite cuisines are pushed');
check(JSON.stringify(B2.P.get('cuisines').slice().sort()) === '["indian","mexican"]', 'and reach the other device');

console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
process.exit(failures ? 1 : 0);
