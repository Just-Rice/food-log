// The food log: what was eaten, when, and how much. Everything is stored in
// this device's localStorage; nothing is sent anywhere.
//
// Each entry keeps its own copy of the nutrients per 100 g rather than only a
// food slug. The food list is regenerated from USDA and a slug can be renamed
// or dropped; a log is a record of the past, and yesterday's dinner should not
// change or vanish because the reference table moved on.
//
// Entries from a photo keep a low and high weight as well, because a portion
// judged from a picture is a range and pretending otherwise would be false
// precision. Measuring an entry -- a scale reading, a household measure --
// replaces the range with one figure and marks it measured, so the day can say
// how much of its total is known and how much is a guess.

(function () {
  'use strict';

  var KEY = 'foodlog.log.v1';
  // The vegetarian fork's log, imported once so nobody loses their history.
  var LEGACY_KEY = 'veg.log.v1';

  var MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
  var MACROS = ['kcal', 'protein', 'carbs', 'fat', 'fiber'];
  // Every nutrient data/foods.js carries. Entries snapshot all of them so the
  // day can be set against the reference intakes, not only counted in calories.
  var TRACKED = MACROS.concat([
    'sugar', 'satfat', 'monofat', 'polyfat', 'ala', 'epa', 'dha', 'la', 'cholesterol',
    'vita', 'vitc', 'vitd', 'vite', 'vitk', 'thiamin', 'riboflavin', 'niacin',
    'pantothenic', 'b6', 'folate', 'b12', 'choline',
    'calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'sodium', 'zinc',
    'copper', 'manganese', 'selenium', 'water'
  ]);

  // A day's grams are capped so a mistyped "15000" cannot wreck a week's chart.
  var MAX_GRAMS = 5000;

  var listeners = [];
  var data = load();

  function readKey(k) {
    try {
      var raw = localStorage.getItem(k);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && typeof d.days === 'object' && d.days) return sanitise(d);
      }
    } catch (e) { /* private mode or corrupt value */ }
    return null;
  }

  function load() {
    var d = readKey(KEY);
    if (d) return d;
    var legacy = readKey(LEGACY_KEY);
    if (legacy && Object.keys(legacy.days).length) {
      legacy.imported = LEGACY_KEY;
      try { localStorage.setItem(KEY, JSON.stringify(legacy)); } catch (e) { /* ignore */ }
      return legacy;
    }
    return { days: {} };
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // Anything restored from storage or an import file is checked, so one
  // corrupt entry cannot break the whole page on every load.
  function sanitise(d) {
    var out = { days: {} };
    Object.keys(d.days).forEach(function (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(d.days[date])) return;
      var list = d.days[date].filter(function (e) {
        if (!e || typeof e.id !== 'string' || typeof e.name !== 'string') return false;
        if (MEALS.indexOf(e.meal) < 0) return false;
        if (e.fixed) return typeof e.fixed === 'object' && isNum(e.fixed.kcal);
        return e.per100 && typeof e.per100 === 'object' && isNum(e.per100.kcal) &&
          isNum(e.grams) && e.grams > 0 && e.grams <= MAX_GRAMS;
      });
      if (list.length) out.days[date] = list;
    });
    return out;
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
    listeners.forEach(function (fn) { fn(); });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** A Date as YYYY-MM-DD in local time -- the day the person thinks it is. */
  function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function today() { return dateKey(new Date()); }

  /** Shift a YYYY-MM-DD key by whole days. Noon avoids daylight-saving edges. */
  function shift(key, days) {
    var p = key.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2], 12);
    d.setDate(d.getDate() + days);
    return dateKey(d);
  }

  /** The meal a new entry most likely belongs to, from the clock. */
  function guessMeal(now) {
    var h = (now || new Date()).getHours();
    if (h < 11) return 'breakfast';
    if (h < 15) return 'lunch';
    if (h >= 17 && h < 22) return 'dinner';
    return 'snack';
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function clampGrams(g) {
    g = Number(g);
    if (!(g > 0)) return null;
    return Math.min(MAX_GRAMS, Math.round(g * 10) / 10);
  }

  /** The nutrients per 100 g a log entry carries, copied from a food record. */
  function per100From(food) {
    var out = {};
    TRACKED.forEach(function (k) {
      var v = food.nutrients[k];
      if (v != null) out[k] = v;
    });
    if (out.kcal == null) out.kcal = 0;
    return out;
  }

  /**
   * Whether an entry carries the full nutrient profile. Typed-in foods, photo
   * items with no USDA match and entries imported from the older log carry
   * energy (and perhaps macros) only; the day's vitamin and mineral totals say
   * how much energy they leave uncounted rather than treating them as zero.
   */
  function isComplete(e) {
    return !e.fixed && !!e.slug && e.per100 && e.per100.iron != null;
  }

  /**
   * Nutrients for one entry. Weighed entries scale their per-100 g figures;
   * typed-in entries carry fixed totals because there is nothing to scale.
   * A nutrient the entry does not carry is absent, not zero.
   */
  function nutrientsOf(e) {
    var out = {};
    TRACKED.forEach(function (k) {
      if (e.fixed) {
        if (e.fixed[k] != null) out[k] = e.fixed[k];
      } else if (e.per100[k] != null) {
        out[k] = e.per100[k] * e.grams / 100;
      }
    });
    if (out.kcal == null) out.kcal = 0;
    return out;
  }

  /** Low and high energy for an entry; equal unless it is an unmeasured photo item. */
  function kcalRange(e) {
    if (e.fixed) return [e.fixed.kcal || 0, e.fixed.kcal || 0];
    var lo = e.gramsLow || e.grams, hi = e.gramsHigh || e.grams;
    return [e.per100.kcal * lo / 100, e.per100.kcal * hi / 100];
  }

  /** Whether an entry's amount is still a guess. */
  function isEstimate(e) {
    return e.source === 'photo' && !e.measured;
  }

  function day(date) { return (data.days[date] || []).slice(); }

  function totals(date) {
    var t = { kcalLow: 0, kcalHigh: 0, count: 0, estKcal: 0, partialKcal: 0, partialCount: 0 };
    TRACKED.forEach(function (k) { t[k] = 0; });
    day(date).forEach(function (e) {
      var n = nutrientsOf(e);
      TRACKED.forEach(function (k) { if (n[k] != null) t[k] += n[k]; });
      var r = kcalRange(e);
      t.kcalLow += r[0];
      t.kcalHigh += r[1];
      t.count++;
      if (isEstimate(e)) t.estKcal += n.kcal;
      if (!isComplete(e)) { t.partialKcal += n.kcal; t.partialCount++; }
    });
    return t;
  }

  /** Totals for the `n` days ending on `endDate`, oldest first. */
  function history(endDate, n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var key = shift(endDate, -i);
      var t = totals(key);
      t.date = key;
      out.push(t);
    }
    return out;
  }

  /**
   * Add an entry. `item` is one of:
   *   {food, grams, meal}                                       -- from the food list
   *   {food, grams, gramsLow, gramsHigh, meal, source, photoId} -- from a photo
   *   {name, per100, grams, ...}                                -- photo item with no USDA match
   *   {name, fixed: {kcal, protein, ...}, meal}                 -- typed in by hand
   * `measured` and `measure` mark an amount that was weighed or measured.
   */
  function add(date, item) {
    var e = {
      id: newId(),
      meal: MEALS.indexOf(item.meal) >= 0 ? item.meal : guessMeal(),
      source: item.source || (item.fixed ? 'manual' : 'food'),
      at: Date.now()
    };
    if (item.fixed) {
      e.name = String(item.name || '').slice(0, 120) || 'Food';
      e.fixed = {};
      TRACKED.forEach(function (k) {
        if (item.fixed[k] == null || item.fixed[k] === '') return;
        var v = Number(item.fixed[k]);
        if (v >= 0) e.fixed[k] = Math.min(v, 20000);
      });
      if (e.fixed.kcal == null) e.fixed.kcal = 0;
    } else {
      var grams = clampGrams(item.grams);
      if (!grams) return null;
      e.grams = grams;
      if (item.food) {
        e.slug = item.food.slug;
        e.name = item.food.name;
        e.per100 = per100From(item.food);
      } else {
        e.name = String(item.name || '').slice(0, 120) || 'Food';
        e.per100 = {};
        TRACKED.forEach(function (k) {
          var v = Number(item.per100 && item.per100[k]);
          if (v > 0) e.per100[k] = v;
        });
        if (e.per100.kcal == null) e.per100.kcal = 0;
      }
      if (item.measured) {
        e.measured = true;
        if (item.measure) e.measure = String(item.measure).slice(0, 80);
      } else {
        var lo = clampGrams(item.gramsLow), hi = clampGrams(item.gramsHigh);
        if (lo && hi && lo <= grams && hi >= grams && hi > lo) { e.gramsLow = lo; e.gramsHigh = hi; }
      }
      if (item.label) e.label = String(item.label).slice(0, 120);
      if (item.photoId) e.photoId = String(item.photoId).slice(0, 40);
      var plate = Number(item.plateAssumed);
      if (plate >= 8 && plate <= 45) e.plateAssumed = plate;
    }
    (data.days[date] = data.days[date] || []).push(e);
    persist();
    return e;
  }

  function find(date, id) {
    return (data.days[date] || []).filter(function (e) { return e.id === id; })[0];
  }

  /**
   * Change an entry's weight or meal. A new weight is a measurement: the
   * photo range goes and the entry is marked measured, with `measure` saying
   * how ("2 × medium", "kitchen scale").
   */
  function update(date, id, patch) {
    var e = find(date, id);
    if (!e) return;
    if (patch.grams != null && !e.fixed) {
      var g = clampGrams(patch.grams);
      if (g) {
        e.grams = g;
        delete e.gramsLow; delete e.gramsHigh;
        e.measured = true;
        if (patch.measure) e.measure = String(patch.measure).slice(0, 80);
        else delete e.measure;
      }
    }
    if (patch.meal && MEALS.indexOf(patch.meal) >= 0) e.meal = patch.meal;
    persist();
  }

  /**
   * How much a plate-size correction changes a portion. The model judged
   * amounts against the plate it assumed; if the real plate is smaller, every
   * visible length shrinks in proportion and the area food covers by the
   * square. Height is not scaled as well: it is the part of a photo the model
   * reads least reliably, and scaling it too would turn one correction into a
   * large swing. So this corrects scale, not depth, and the range stays.
   */
  function plateFactor(assumedCm, actualCm) {
    if (!(assumedCm > 0) || !(actualCm > 0)) return 1;
    var r = actualCm / assumedCm;
    return r * r;
  }

  /**
   * Give the real size of the plate in one photo and rescale every
   * still-unmeasured item from it. Measured items are left alone: a scale
   * reading beats any correction to a guess. Each entry remembers the plate
   * size its weights now assume, so correcting twice does not compound.
   */
  function rescalePhoto(date, photoId, plateCm) {
    plateCm = Number(plateCm);
    if (!photoId || !(plateCm >= 8 && plateCm <= 45)) return 0;
    var n = 0;
    (data.days[date] || []).forEach(function (e) {
      if (e.photoId !== photoId || e.fixed || e.measured) return;
      var f = plateFactor(e.plateAssumed || 26, plateCm);
      e.grams = clampGrams(e.grams * f) || e.grams;
      if (e.gramsLow) e.gramsLow = clampGrams(e.gramsLow * f) || e.gramsLow;
      if (e.gramsHigh) e.gramsHigh = clampGrams(e.gramsHigh * f) || e.gramsHigh;
      e.plateAssumed = plateCm;
      e.plateSet = true;
      n++;
    });
    if (n) persist();
    return n;
  }

  function remove(date, id) {
    var list = data.days[date];
    if (!list) return;
    data.days[date] = list.filter(function (e) { return e.id !== id; });
    if (!data.days[date].length) delete data.days[date];
    persist();
  }

  // ---- export / import --------------------------------------------------

  function exportJson() {
    return JSON.stringify({ app: 'food-log', version: 1, exported: new Date().toISOString(),
                            days: data.days }, null, 1);
  }

  /**
   * Merge a previously exported log into this one. Entries are matched by id,
   * so importing the same file twice does not double anything. Resolves to the
   * number of entries added; throws a readable message on a bad file.
   */
  function importJson(text) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON.'); }
    if (!parsed || typeof parsed.days !== 'object' || !parsed.days) {
      throw new Error('That file is not a Food Log export.');
    }
    var incoming = sanitise(parsed);
    var added = 0;
    Object.keys(incoming.days).forEach(function (date) {
      var list = data.days[date] = data.days[date] || [];
      var have = {};
      list.forEach(function (e) { have[e.id] = true; });
      incoming.days[date].forEach(function (e) {
        if (!have[e.id]) { list.push(e); added++; }
      });
    });
    persist();
    return added;
  }

  function clearAll() {
    data = { days: {} };
    persist();
  }

  function dayCount() { return Object.keys(data.days).length; }
  function importedFrom() { return data.imported || null; }

  window.Tracker = {
    MEALS: MEALS, MACROS: MACROS, TRACKED: TRACKED, MAX_GRAMS: MAX_GRAMS,
    today: today, shift: shift, dateKey: dateKey, guessMeal: guessMeal,
    day: day, totals: totals, history: history, find: find,
    nutrientsOf: nutrientsOf, kcalRange: kcalRange, isEstimate: isEstimate, isComplete: isComplete,
    add: add, update: update, rescalePhoto: rescalePhoto, plateFactor: plateFactor, remove: remove,
    exportJson: exportJson, importJson: importJson, clearAll: clearAll,
    dayCount: dayCount, importedFrom: importedFrom, newId: newId,
    onChange: function (fn) { listeners.push(fn); }
  };
})();
