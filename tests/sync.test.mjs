// Sync convergence test: several simulated devices, each running the real
// js/tracker.js and js/sync.js in its own isolated context, share one
// in-memory backend standing in for Firestore. No browser, no network.
//   node food-log/tests/sync.test.mjs

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(here, '..', 'js', f), 'utf8');
const TRACKER = src('tracker.js'), SYNC = src('sync.js');
const clone = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));

let failures = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; }

// One account's documents, shared by every device. Like Firestore, every
// listener hears every write -- including the device that made it.
function makeCloud() {
  const cloud = { docs: {}, subs: [], writes: 0 };
  cloud.backendFor = () => ({
    signIn: async () => ({ uid: 'u1', name: 'Test', email: 'test@example.com' }),
    signOut: async () => {},
    current: () => null,
    onAuth: async (cb) => cb({ uid: 'u1', name: 'Test', email: 'test@example.com' }),
    pullAll: async () => clone(cloud.docs),
    push: async (uid, date, doc) => {
      cloud.writes++;
      cloud.docs[date] = clone(doc);
      cloud.subs.forEach((cb) => cb(date, clone(doc)));
    },
    listen: (uid, cb) => { cloud.subs.push(cb); return () => { cloud.subs = cloud.subs.filter((x) => x !== cb); }; }
  });
  return cloud;
}

function device(cloud, seed) {
  const store = Object.assign({}, seed || {});
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    }
  });
  ctx.window = ctx;
  ctx.FoodLogConfig = { FIREBASE: { apiKey: 'x' } };
  ctx.FirebaseEngine = {};
  vm.runInContext(TRACKER, ctx);
  vm.runInContext(SYNC, ctx);
  const d = { T: ctx.Tracker, S: ctx.Sync, store, changes: 0 };
  d.T.onChange(() => { d.changes++; });
  if (cloud) d.S.useBackend(cloud.backendFor());
  return d;
}

const food = (slug, kcal) => ({ slug, name: slug, nutrients: { kcal, protein: 1, iron: 0.5 } });
const ids = (d, date) => d.T.day(date).map((e) => e.id).sort().join(',');
const DAY = '2026-11-07';

// 1. Two devices with different entries converge on sign-in.
const cloud = makeCloud();
const A = device(cloud), B = device(cloud);
const e1 = A.T.add(DAY, { food: food('rice', 130), grams: 150, meal: 'lunch' });
const e2 = B.T.add(DAY, { food: food('dal', 116), grams: 120, meal: 'lunch' });
await A.S.signIn(); await B.S.signIn(); await tick();
check(ids(A, DAY) === ids(B, DAY) && ids(A, DAY).split(',').length === 2, 'sign-in on both devices: both entries on both');
check(A.S.state().status === 'on' && B.S.state().status === 'on', 'both report sync on');

// 2. An edit on A reaches B.
A.T.update(DAY, e2.id, { grams: 200, measure: 'kitchen scale' });
await A.S.flush(); await tick();
check(B.T.find(DAY, e2.id).grams === 200, 'edit on A reaches B');

// 3. A delete on B reaches A, and leaves a tombstone.
B.T.remove(DAY, e1.id);
await B.S.flush(); await tick();
check(!A.T.find(DAY, e1.id), 'delete on B reaches A');
check(!!A.T.dayDoc(DAY).deleted[e1.id], 'A keeps the tombstone');

// 4. A stale copy that still has the entry does not bring it back.
const stale = { entries: [Object.assign({}, e1, { updatedAt: e1.updatedAt })], deleted: {} };
check(A.T.mergeDay(DAY, stale) === false && !A.T.find(DAY, e1.id), 'stale copy does not resurrect a deleted entry');

// 5. Merging the same copy twice changes nothing the second time.
const docB = B.T.dayDoc(DAY);
A.T.mergeDay(DAY, docB);
check(A.T.mergeDay(DAY, docB) === false, 'mergeDay is idempotent');

// 6. Concurrent edits: the later one wins on both devices.
B.S.signOut(); A.S.signOut();
A.T.update(DAY, e2.id, { grams: 210 });
await new Promise((r) => setTimeout(r, 5));
B.T.update(DAY, e2.id, { grams: 250 });   // later
await A.S.signIn(); await B.S.signIn(); await tick(); await A.S.flush(); await B.S.flush(); await tick();
check(A.T.find(DAY, e2.id).grams === 250 && B.T.find(DAY, e2.id).grams === 250, 'concurrent edits: the later one (250 g) wins on both');

// 7. Echo: a device hearing its own write back changes nothing.
const before = A.changes;
A.T.add(DAY, { food: food('egg', 196), grams: 50, meal: 'breakfast' });
await A.S.flush(); await tick();
check(A.changes === before + 1, 'own write echoed back by the listener causes no second change');
check(ids(A, DAY) === ids(B, DAY), 'new entry reached B');

// 8. Import dedupes by id; importing into another device adds them.
const exported = A.T.exportJson();
check(A.T.importJson(exported) === 0, 'importing your own export adds nothing');
const C = device(null);
check(C.T.importJson(exported) === A.T.day(DAY).length, 'import into a fresh device adds every entry');

// 9. Entries logged before sync existed (no updatedAt) still merge.
const legacy = { 'foodlog.log.v1': JSON.stringify({ days: { '2026-10-01': [
  { id: 'old1', name: 'Paneer', meal: 'dinner', source: 'food', slug: 'paneer', grams: 100,
    per100: { kcal: 321 }, at: 1700000000000 }] } }) };
const cloud2 = makeCloud();
const D = device(cloud2, legacy), E = device(cloud2);
await D.S.signIn(); await E.S.signIn(); await tick();
check(!!E.T.find('2026-10-01', 'old1'), 'legacy entry without updatedAt syncs');
E.T.update('2026-10-01', 'old1', { grams: 80 });
await E.S.flush(); await tick();
check(D.T.find('2026-10-01', 'old1').grams === 80, 'and an edit to it wins over the original');

// 10. Clear all propagates as deletions.
A.T.clearAll();
await A.S.flush(); await tick();
check(B.T.day(DAY).length === 0, 'clear all on A empties the day on B');

// 11. Signing out leaves the local log alone.
const keep = E.T.day('2026-10-01').length;
await E.S.signOut();
check(E.T.day('2026-10-01').length === keep && E.S.state().status === 'off', 'sign-out keeps the local log');

// 12. Bad remote data is ignored.
check(E.T.mergeDay('2026-10-02', { entries: [{ id: 5, name: null }, { id: 'x', name: 'X', meal: 'lunch', per100: { kcal: 'a' }, grams: 1 }] }) === false,
  'invalid remote entries are ignored');

console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
process.exit(failures ? 1 : 0);
