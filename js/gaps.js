// The week's vitamins and minerals: which ones the logged days fell short of,
// which went over an upper limit, and foods from the list that are rich in
// the short ones.
//
// Pure functions, no page code, so they can be tested on their own. The
// wording the page builds from them is about nutrients, never about eating
// more or less: the log sets no targets for amounts of food.

(function () {
  'use strict';

  var VITAMINS = ['vita', 'vitc', 'vitd', 'vite', 'vitk', 'thiamin', 'riboflavin', 'niacin',
                  'pantothenic', 'b6', 'folate', 'b12', 'choline'];
  var MINERALS = ['calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'zinc',
                  'copper', 'manganese', 'selenium'];
  var LOW = 0.7;            // under 70% of the reference intake, on average
  var MIN_DAYS = 3;         // fewer logged days than this says too little
  var OVER_DAYS = 3;        // days over an upper limit before it is mentioned
  // Not suggested as a source of anything: seasoning, fats and powders are
  // eaten in grams, and a list of "foods rich in iron" led by cumin is no use.
  var NOT_A_FOOD = /\b(flour|oil|powder|powdered|seasoning|spice|extract|bran|meal|mix|defatted|isolate|whey|concentrate|dried \(?decorticated)\b/;
  // Foods that are harmful unless specially prepared are never suggested.
  var NEEDS_PREP = /pokeberry|\bpoke\b|ackee|akee|cassava|bitter almond|elderberr/;
  // Fish the FDA and EPA list as "choices to avoid" for their mercury.
  var NOT_SUGGESTED = /\bbrain\b/;
  var HIGH_MERCURY = /\b(king mackerel|marlin|orange roughy|shark|swordfish|tilefish|bigeye)\b/;
  // Not suggested as an everyday source: game, and processed meat (which the
  // WHO classes as a cause of bowel cancer).
  var NOT_EVERYDAY = { game: 1, 'processed meat': 1 };

  /**
   * How familiar a food is: the names people know it by beyond its own
   * (Food is Medicine's aliases -- "doodh" for milk), up to three.
   */
  function familiarity(f) {
    var name = f.name.toLowerCase();
    return Math.min(3, (f.aka || []).filter(function (a) {
      a = String(a).toLowerCase();
      return a && name.indexOf(a) < 0;
    }).length);
  }
  // A realistic amount for foods whose USDA portion is a cup: nobody eats a
  // cup of sesame seeds or of diced cheese.
  function portionCap(f) {
    if (f.group === 'nut') return 30;
    // Dips and spreads go on a plate by the spoonful.
    if (/hummus|spread|\bdip\b|paste|\bbutter\b/i.test(f.name)) return 60;
    // Cheese, cream cheese and the like: energy-dense dairy, eaten in tens of grams.
    if (f.group === 'dairy' && (f.nutrients.kcal || 0) >= 150) return 40;
    // A dry grain's cup is two or three servings; a dry serving is about 60 g.
    if (f.group === 'grain' && !/cooked|bread|porridge|roti|chapati|naan|pita|tortilla|noodle|pasta/i.test(f.name)) return 60;
    return 300;
  }

  /**
   * days: [{count, partialKcal, kcal, <nutrient totals>}] (Tracker.history)
   * targets: {nutrient: daily reference value}
   * uls: {nutrient: {value, supplementOnly}} (DRI.upperLimitsFor)
   * Returns {enough, logged, low: [{key, avg, target, pct}], over: [{key, days, ul}],
   *          partialShare} -- `enough` false when fewer than MIN_DAYS were logged.
   */
  function analyse(days, targets, uls) {
    var logged = days.filter(function (d) { return d.count > 0; });
    var kcal = 0, partial = 0;
    logged.forEach(function (d) { kcal += d.kcal || 0; partial += d.partialKcal || 0; });
    var out = { enough: logged.length >= MIN_DAYS, logged: logged.length, low: [], over: [],
                partialShare: kcal ? partial / kcal : 0 };
    if (!out.enough) return out;
    VITAMINS.concat(MINERALS).forEach(function (k) {
      var target = targets[k];
      if (!target) return;
      var sum = 0;
      logged.forEach(function (d) { sum += d[k] || 0; });
      var avg = sum / logged.length;
      if (avg / target < LOW) out.low.push({ key: k, avg: avg, target: target, pct: avg / target });
    });
    out.low.sort(function (a, b) { return a.pct - b.pct; });
    VITAMINS.concat(MINERALS).concat(['sodium']).forEach(function (k) {
      var ul = uls && uls[k];
      if (!ul) return;
      // Limits set only for supplements and fortified foods are checked
      // against what supplements gave (Tracker totals' `supp`), never food.
      var n = logged.filter(function (d) {
        var v = ul.supplementOnly ? (d.supp && d.supp[k]) || 0 : d[k] || 0;
        return v > ul.value;
      }).length;
      if (n >= OVER_DAYS) out.over.push({ key: k, days: n, ul: ul.value, supplementOnly: !!ul.supplementOnly });
    });
    return out;
  }

  // "cup" -> "1 cup"; "4 oz" stays; USDA's "unit (yield from 1 lb
  // ready-to-cook squab)" becomes "1 unit".
  function portionLabel(l) {
    l = String(l || '').replace(/\s*\((yield|from|about|approx)[^)]*\)/i, '').trim();
    return /^[\d½¼¾.]/.test(l) ? l : '1 ' + l;
  }

  // The last word before any comma or bracket, singular: "Mushrooms, brown"
  // and "White mushroom (UV-exposed)" are both "mushroom".
  function kindOf(f) {
    var w = f.name.toLowerCase().split(/[,(]/)[0].trim().split(' ').slice(-1)[0];
    if (w.length < 4 || /(ss|us|is)$/.test(w)) return w;          // hummus, asparagus
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';                // berries
    if (/(ch|sh|x|o)es$/.test(w)) return w.slice(0, -2);            // peaches, tomatoes
    return w.replace(/s$/, '');                                     // mushrooms, beans
  }

  /**
   * Foods rich in `key`, per typical portion, best first. `excluded(food)` is
   * the dietary-settings test; excluded foods are never suggested.
   * Returns [{food, grams, label, amount, pct}].
   */
  function suggest(key, foods, target, excluded, limit) {
    var seen = {};
    return foods.map(function (f) {
      if (excluded && excluded(f)) return null;
      if (f.group === 'herb' || f.group === 'fat') return null;
      var lname = f.name.toLowerCase();
      if (NOT_A_FOOD.test(lname) || NEEDS_PREP.test(lname) || HIGH_MERCURY.test(lname) || NOT_SUGGESTED.test(lname)) return null;
      if ((f.tags || []).some(function (t) { return NOT_EVERYDAY[t]; })) return null;
      // Liver is a fine source of iron or B12, but its vitamin A is preformed
      // retinol, which has an upper limit; it is not offered for vitamin A.
      if (key === 'vita' && f.group === 'offal') return null;
      // Dry pulses and grains are not eaten as weighed: suggest the cooked
      // forms, whose portion is what lands on a plate.
      var text = (f.name + ' ' + (f.usda || '')).toLowerCase();
      if (/^(legume|grain)$/.test(f.group) && /\b(raw|dry|dried|uncooked|mature seeds)\b/.test(text) &&
          !/\b(cooked|boiled|canned|baked)\b/.test(text)) return null;
      var portion = f.portion || f.serving;
      if (!portion || !(portion.grams > 0) || portion.grams > 300) return null;
      var per100 = f.nutrients && f.nutrients[key];
      if (!(per100 > 0)) return null;
      var cap = portionCap(f), grams = Math.min(portion.grams, cap);
      var amount = per100 * grams / 100, pct = target ? amount / target : 0;
      if (target && pct < 0.15) return null;
      // Rank by what a portion gives, credited up to a full day's worth --
      // beyond that more is no better -- and lean towards everyday foods:
      // those people know by other names (Food is Medicine's aliases).
      var score = Math.min(pct, 1) + 0.15 * familiarity(f);
      return { food: f, grams: grams, label: grams === portion.grams ? portionLabel(portion.label) : grams + ' g',
               amount: amount, pct: pct, score: score };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score || b.amount - a.amount; }).filter(function (s) {
      // One of each kind: three cuts of the same fish are one suggestion.
      var kind = kindOf(s.food);
      if (seen[kind]) return false;
      seen[kind] = true;
      return true;
    }).slice(0, limit || 5);
  }

  // Plants, for the variety count: fungi count too, as most such counts do;
  // oils and honey do not.
  var PLANT_GROUPS = { veg: 1, fruit: 1, legume: 1, grain: 1, nut: 1, herb: 1, mushroom: 1 };

  /**
   * The different plant foods in a set of log entries. `bySlug` maps a slug
   * to its food. Recipe entries count their ingredients (`slugs`). Entries
   * with no food behind them -- typed in, scanned, unmatched photo items --
   * cannot be counted and are reported as `unknown`.
   * Returns {count, kinds: [{kind, name}], unknown}.
   */
  function plants(entries, bySlug) {
    var seen = {}, kinds = [], unknown = 0;
    function add(f) {
      if (!f || !PLANT_GROUPS[f.group]) return;
      var k = kindOf(f);
      if (seen[k]) return;
      seen[k] = true;
      kinds.push({ kind: k, name: f.name });
    }
    entries.forEach(function (e) {
      if (e.source === 'supplement') return;
      if (e.slug) add(bySlug[e.slug]);
      else if (e.slugs && e.slugs.length) e.slugs.forEach(function (s) { add(bySlug[s]); });
      else unknown++;
    });
    kinds.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { count: kinds.length, kinds: kinds, unknown: unknown };
  }

  window.Gaps = { analyse: analyse, suggest: suggest, kindOf: kindOf, plants: plants, LOW: LOW, MIN_DAYS: MIN_DAYS };
})();
