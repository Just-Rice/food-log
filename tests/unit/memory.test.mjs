// What Food Log learns from corrections (js/memory.js): names, matches,
// portion factors, forgetting, and syncing between devices.
//   node tests/unit/memory.test.mjs   (from food-log/)

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(here, '..', '..', 'js', f), 'utf8');
const FILES = ['tracker.js', 'library.js', 'memory.js', 'sync.js'].map(src);
const clone = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };

function makeCloud() {
  const cloud = { docs: {}, memory: null, mSubs: [] };
  cloud.backendFor = () => ({
    signIn: async () => ({ uid: 'u1', name: 'T', email: 't@example.com' }), signOut: async () => {}, current: () => null,
    onAuth: async (cb) => cb({ uid: 'u1', name: 'T', email: 't@example.com' }),
    pullAll: async () => clone(cloud.docs), push: async (u, d, doc) => { cloud.docs[d] = clone(doc); },
    listen: () => () => {},
    pullMemory: async () => (cloud.memory ? clone(cloud.memory) : null),
    pushMemory: async (u, doc) => { cloud.memory = clone(doc); cloud.mSubs.forEach((cb) => cb(clone(doc))); },
    listenMemory: (u, cb) => { cloud.mSubs.push(cb); return () => { cloud.mSubs = cloud.mSubs.filter((x) => x !== cb); }; }
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
  FILES.forEach((code) => vm.runInContext(code, ctx));
  if (cloud) ctx.Sync.useBackend(cloud.backendFor());
  return { M: ctx.Memory, S: ctx.Sync, store };
}

// ---- names ----
const { M } = device();
check(M.keyOf('Rotis') === 'roti' && M.keyOf(' roti (2) ') === 'roti' && M.keyOf('White rice, cooked') === 'white rice cooked',
  'names: plural, brackets, punctuation and case do not matter');
check(M.keyOf('Tomatoes') === 'tomato' && M.keyOf('Hummus') === 'hummus' && M.keyOf('पनीर') === 'पनीर', 'singulars, and non-Latin names kept');

// ---- matches ----
check(M.lookup('dal') === null, 'nothing known at first');
M.learnMatch('Dal', 'lentilscooked');
check(M.lookup('dal').slug === 'lentilscooked' && M.lookup('dals').slug === 'lentilscooked', 'a changed match is remembered for the name');
M.learnMatch('curry', '');
check(M.lookup('Curry').slug === '', '"keep the model’s estimate" is remembered too');

// ---- portions ----
M.learnPortion('roti', 80, 120);
check(Math.abs(M.lookup('roti').factor - 0.667) < 0.001 && M.lookup('roti').n === 1, 'one weighing: 80 g for a 120 g guess → 0.667');
M.learnPortion('roti', 90, 120); M.learnPortion('roti', 200, 120);
check(Math.abs(M.lookup('roti').factor - 0.75) < 0.001 && M.lookup('roti').n === 3, 'median of three (0.667, 0.75, 1.667) → 0.75');
[1, 2, 3, 4, 5].forEach(() => M.learnPortion('roti', 100, 100));
check(M.lookup('roti').n === 5 && M.lookup('roti').factor === 1, 'only the last five count');
M.learnPortion('rice', 900, 100); M.learnPortion('rice', 5, 100);
check(M.lookup('rice') === null, 'a ratio above 5 or below 0.2 is a different dish or a typo, not learnt');
M.learnPortion('rice', 400, 100); M.learnPortion('rice', 400, 100);
check(M.lookup('rice').factor === 2, 'a remembered portion moves a guess by at most 2×');
check(M.lookup('roti').slug === undefined, 'a portion alone teaches no match');

// ---- list and forget ----
check(M.list().map((x) => x.key).join() === 'curry,dal,rice,roti', 'list: every name learnt');
M.forget('rice');
check(M.lookup('rice') === null && !!M.doc().deleted.rice, 'forget leaves a tombstone');

// ---- sync between devices ----
const cloud = makeCloud();
const A = device(cloud), B = device(cloud);
A.M.learnMatch('dal', 'lentilscooked');
A.M.learnPortion('roti', 80, 120);
await A.S.signIn(); await tick();
check(cloud.memory && cloud.memory.names.dal.slug === 'lentilscooked', 'signing in sends what was learnt');
await B.S.signIn(); await tick();
check(B.M.lookup('dal').slug === 'lentilscooked' && Math.abs(B.M.lookup('roti').factor - 0.667) < 0.001, 'a second device receives it');
B.M.learnMatch('sabzi', 'mixedveg');
await wait(2300); await tick();
check(A.M.lookup('sabzi') && A.M.lookup('sabzi').slug === 'mixedveg', 'something learnt on B reaches A');
A.M.forget('dal');
await wait(2300); await tick();
check(B.M.lookup('dal') === null, 'forgetting on A forgets on B');
await A.S.signOut(); await B.S.signOut();

console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
process.exit(failures ? 1 : 0);
