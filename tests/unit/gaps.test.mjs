// Weekly nutrient gaps: what counts as low or over, and which foods are
// suggested -- never one the dietary settings exclude.
//   node food-log/tests/unit/gaps.test.mjs

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const ctx = vm.createContext({ console });
ctx.window = ctx;
vm.runInContext(fs.readFileSync(path.join(repo, 'js', 'gaps.js'), 'utf8'), ctx);
// The real food list, from the sibling repo.
vm.runInContext(fs.readFileSync(path.join(repo, '..', 'food-is-medicine', 'data', 'foods.js'), 'utf8'), ctx);
const G = ctx.Gaps, FOODS = ctx.FOODS;

let failures = 0;
const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };

const targets = { iron: 18, vitc: 75, calcium: 1000, vita: 700, b12: 2.4 };
const uls = { iron: { value: 45 }, sodium: { value: 2300 }, vita: { value: 3000, supplementOnly: true } };
const day = (o) => Object.assign({ count: 3, kcal: 1800, partialKcal: 0, iron: 18, vitc: 80, calcium: 1000, vita: 700, b12: 3, sodium: 2000 }, o);

// Too few days.
check(G.analyse([day({}), day({}), day({ count: 0 })], targets, uls).enough === false, 'two logged days: not enough to say');

// Low iron on most days.
const week = [day({ iron: 6 }), day({ iron: 7 }), day({ iron: 8 }), day({ iron: 20 }), day({ count: 0, iron: 0 })];
const a = G.analyse(week, targets, uls);
check(a.enough && a.logged === 4, 'four logged days counted, the empty one ignored');
check(a.low.length === 1 && a.low[0].key === 'iron' && Math.abs(a.low[0].avg - 10.25) < 1e-9, 'iron flagged low (avg 10.25 mg of 18)');
check(!a.low.some((l) => l.key === 'vitc'), 'vitamin C at target is not flagged');

// Over a food-applicable limit on 3+ days; supplement-only limits ignored.
const salty = [day({ sodium: 3000, vita: 5000 }), day({ sodium: 3100, vita: 5000 }), day({ sodium: 2900, vita: 5000 }), day({})];
const o = G.analyse(salty, targets, uls);
check(o.over.length === 1 && o.over[0].key === 'sodium' && o.over[0].days === 3, 'sodium over 2,300 mg on 3 days flagged');
check(!o.over.some((x) => x.key === 'vita'), 'a supplement-only limit is not applied to food');

// Partial data share.
check(Math.abs(G.analyse([day({ partialKcal: 900 }), day({}), day({})], targets, uls).partialShare - 900 / 5400) < 1e-9, 'share of energy without vitamin data');

// Suggestions from the real food list.
const iron = G.suggest('iron', FOODS, 18, null, 5);
check(iron.length === 5 && iron.every((s) => s.amount > 0 && s.grams <= 300), 'five iron suggestions per typical portion');
check(iron.every((s) => !/flour|oil|powder|seasoning|spice/i.test(s.food.name) && s.food.group !== 'herb'), 'no spices, flours or oils suggested');
const veg = (f) => (f.diet || []).indexOf('vegetarian') < 0;
const vegIron = G.suggest('iron', FOODS, 18, veg, 5);
check(vegIron.length === 5 && vegIron.every((s) => (s.food.diet || []).indexOf('vegetarian') >= 0), 'vegetarian: no meat or fish suggested: ' + vegIron.map((s) => s.food.name).join(', '));
check(!G.suggest('vita', FOODS, 700, null, 10).some((s) => s.food.group === 'offal'), 'liver never suggested for vitamin A');
check(!vegIron.some((s) => /^(legume|grain)$/.test(s.food.group) && /raw|dry/i.test(s.food.name + ' ' + s.food.usda) && !/cooked|boiled|canned/i.test(s.food.usda)),
  'pulses and grains suggested cooked, not dry');
const kinds = iron.map((s) => G.kindOf(s.food));
check(new Set(kinds).size === kinds.length, 'one suggestion per kind of food');
check(G.kindOf({ name: 'Mushrooms, brown' }) === G.kindOf({ name: 'White mushroom (UV-exposed)' }) &&
  G.kindOf({ name: 'Hummus' }) === 'hummus' && G.kindOf({ name: 'Strawberries' }) === 'strawberry', 'kinds are singular');
const d = G.suggest('vitd', FOODS, 20, null, 10);
check(d.filter((s) => G.kindOf(s.food) === 'mushroom').length <= 1, 'vitamin D: one mushroom, not three: ' + d.map((s) => s.food.name).join(', '));
check(iron.every((s) => /^1 |^\d+ g$/.test(s.label)), 'portion labels read "1 cup" or grams: ' + iron.map((s) => s.label).join(', '));

console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
process.exit(failures ? 1 : 0);
