// Pregnancy and breastfeeding reference intakes, from Food is Medicine's
// data/dri.js (which Food Log loads). Spot values are the NASEM DRI summary
// tables (2019, Appendix J).
//   node tests/unit/dri-stage.test.mjs   (from food-log/)

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = vm.createContext({});
ctx.window = ctx;
vm.runInContext(fs.readFileSync(path.join(here, '..', '..', '..', 'food-is-medicine', 'data', 'dri.js'), 'utf8'), ctx);
const D = ctx.DRI;

let failures = 0;
const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };

const woman = (age, stage) => ({ age, sex: 'female', weightKg: 60, heightCm: 165, activity: 1.375, stage });
const v = (p, k) => D.targetsFor(p)[k].value;

check(typeof D.stageOf === 'function', 'DRI.stageOf exists');
check(D.stageOf(woman(28, 'pregnant')) === 'pregnant' && D.stageOf(woman(28, 'breastfeeding')) === 'breastfeeding', 'stage read from the profile');
check(D.stageOf({ age: 28, sex: 'male', stage: 'pregnant' }) === null && D.stageOf(woman(13, 'pregnant')) === null &&
  D.stageOf(woman(51, 'pregnant')) === null && D.stageOf(woman(28, 'nonsense')) === null && D.stageOf(woman(28)) === null,
  'only for women 14 to 50 with a known stage');

// Pregnancy.
check(v(woman(28, 'pregnant'), 'iron') === 27 && v(woman(16, 'pregnant'), 'iron') === 27, 'pregnancy iron 27 mg');
check(v(woman(28, 'pregnant'), 'folate') === 600 && v(woman(28, 'pregnant'), 'vita') === 770 && v(woman(16, 'pregnant'), 'vita') === 750, 'folate 600 µg; vitamin A 770 (750 under 19)');
check(v(woman(16, 'pregnant'), 'calcium') === 1300 && v(woman(28, 'pregnant'), 'calcium') === 1000, 'calcium 1,300 under 19, else 1,000');
check(v(woman(16, 'pregnant'), 'magnesium') === 400 && v(woman(25, 'pregnant'), 'magnesium') === 350 && v(woman(40, 'pregnant'), 'magnesium') === 360, 'magnesium 400 / 350 / 360');
check(v(woman(28, 'pregnant'), 'zinc') === 11 && v(woman(28, 'pregnant'), 'selenium') === 60 && v(woman(28, 'pregnant'), 'potassium') === 2900 &&
  v(woman(28, 'pregnant'), 'choline') === 450 && v(woman(28, 'pregnant'), 'b12') === 2.6, 'zinc 11, selenium 60, potassium 2,900, choline 450, B12 2.6');
check(Math.abs(v(woman(28, 'pregnant'), 'protein') - 66) < 0.01 && v(woman(28, 'pregnant'), 'fiber') === 28, 'protein 1.1 g/kg (66 g at 60 kg), fibre 28 g');
check(D.targetsFor(woman(28, 'pregnant')).iron.type === 'RDA' && D.targetsFor(woman(28, 'pregnant')).choline.type === 'AI', 'RDA/AI types unchanged');

// Lactation.
check(v(woman(28, 'breastfeeding'), 'iron') === 9 && v(woman(16, 'breastfeeding'), 'iron') === 10, 'lactation iron 9 mg (10 under 19)');
check(v(woman(28, 'breastfeeding'), 'vita') === 1300 && v(woman(28, 'breastfeeding'), 'vitc') === 120 && v(woman(28, 'breastfeeding'), 'folate') === 500, 'vitamin A 1,300, vitamin C 120, folate 500');
check(v(woman(28, 'breastfeeding'), 'zinc') === 12 && v(woman(28, 'breastfeeding'), 'selenium') === 70 && v(woman(28, 'breastfeeding'), 'potassium') === 2800 &&
  v(woman(28, 'breastfeeding'), 'copper') === 1.3 && v(woman(28, 'breastfeeding'), 'manganese') === 2.6, 'zinc 12, selenium 70, potassium 2,800, copper 1.3, manganese 2.6');
check(Math.abs(v(woman(28, 'breastfeeding'), 'protein') - 78) < 0.01 && v(woman(28, 'breastfeeding'), 'fiber') === 29, 'protein 1.3 g/kg, fibre 29 g');

// Everyone else unchanged.
check(v(woman(28), 'iron') === 18 && v(woman(28), 'folate') === 400 && v({ age: 28, sex: 'male', weightKg: 75, heightCm: 180, stage: 'pregnant' }, 'iron') === 8,
  'without a stage (or for a man) the ordinary values stay');
check(JSON.stringify(D.upperLimitsFor(28)) === JSON.stringify(D.upperLimitsFor(28)) && D.upperLimitsFor(28).iron.value === 45, 'upper limits unchanged');

console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
process.exit(failures ? 1 : 0);
