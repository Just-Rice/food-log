// The food log: what was eaten, when, and how much. Everything is stored in
// this device's localStorage; nothing is sent anywhere unless the person signs
// in to sync (js/sync.js), and even then this copy stays the main one.
//
// So that two devices can be merged without either losing work, every entry
// carries the time it was last changed (updatedAt), and a removed entry leaves
// a tombstone -- its id and when it went -- under data.deleted for its day.
// Without the tombstone, a device that still had the entry would hand it
// straight back on the next merge.
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

  // How long a deletion is remembered. A tombstone only matters until every
  // device has seen it; one away for longer than this may bring an entry back.
  var TOMBSTONE_DAYS = 90;
  var DAY_MS = 864e5;

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
    return { days: {}, deleted: {} };
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isDate(k) { return typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k); }
  function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  /** One entry as it may be stored: the checks every source goes through. */
  function validEntry(e) {
    if (!e || typeof e.id !== 'string' || typeof e.name !== 'string') return false;
    if (MEALS.indexOf(e.meal) < 0) return false;
    if (e.updatedAt != null && !isNum(e.updatedAt)) return false;
    if (e.fixed) return typeof e.fixed === 'object' && isNum(e.fixed.kcal);
    return !!e.per100 && typeof e.per100 === 'object' && isNum(e.per100.kcal) &&
      isNum(e.grams) && e.grams > 0 && e.grams <= MAX_GRAMS;
  }

  /**
   * When an entry last changed. Entries logged before sync existed have no
   * updatedAt; the time they were logged is the best stand-in, and any edit
   * made since sync arrived will beat it.
   */
  function stampOf(e) {
    if (isNum(e.updatedAt)) return e.updatedAt;
    return isNum(e.at) ? e.at : 0;
  }

  /**
   * A stamp for a fresh edit: now, but always later than the entry's last
   * one, so an edit wins over the version it replaced even when this device's
   * clock is behind the one that wrote it.
   */
  function bump(e) { return Math.max(Date.now(), stampOf(e) + 1); }

  function tombCutoff() { return Date.now() - TOMBSTONE_DAYS * DAY_MS; }

  /** One day's tombstones, {entryId: ts}, checked and with stale ones dropped. */
  function sanitiseTombs(t, cutoff) {
    var out = {};
    if (!isMap(t)) return out;
    Object.keys(t).forEach(function (id) {
      // __proto__ cannot be an own key of a plain object, and Firestore
      // reserves __names__, so neither can be stored or synced.
      if (!id || id.length > 100 || /^__.*__$/.test(id)) return;
      if (isNum(t[id]) && t[id] > 0 && t[id] >= cutoff) out[id] = t[id];
    });
    return out;
  }

  function sanitiseDeleted(d) {
    var out = {}, cutoff = tombCutoff();
    if (!isMap(d)) return out;
    Object.keys(d).forEach(function (date) {
      if (!isDate(date)) return;
      var t = sanitiseTombs(d[date], cutoff);
      if (Object.keys(t).length) out[date] = t;
    });
    return out;
  }

  /** Whether a tombstone outlives this version of an entry. */
  function buried(gone, e) { return own(gone, e.id) && gone[e.id] >= stampOf(e); }

  // Anything restored from storage or an import file is checked, so one
  // corrupt entry cannot break the whole page on every load. Tombstones older
  // than TOMBSTONE_DAYS are dropped here, so they do not pile up for ever.
  function sanitise(d) {
    var out = { days: {}, deleted: sanitiseDeleted(d.deleted) };
    Object.keys(d.days).forEach(function (date) {
      if (!isDate(date) || !Array.isArray(d.days[date])) return;
      var gone = out.deleted[date] || {};
      var list = d.days[date].filter(function (e) { return validEntry(e) && !buried(gone, e); });
      if (list.length) out.days[date] = list;
    });
    return out;
  }

  /**
   * Save, then tell listeners which days changed. `meta.remote` is true when
   * the change came from another device through mergeDay, so sync can tell
   * it apart from an edit made here and not send it straight back.
   */
  function persist(dates, meta) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
    var info = { remote: !!(meta && meta.remote) };
    listeners.forEach(function (fn) {
      // One listener failing must not stop the others (sync among them)
      // hearing of the change; the error still reaches the console.
      try { fn((dates || []).slice(), info); } catch (err) { setTimeout(function () { throw err; }, 0); }
    });
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
    // A recipe's figures are summed from its USDA ingredients, so it carries
    // the full profile even though no single food record stands behind it.
    return !e.fixed && (!!e.slug || e.source === 'recipe') && e.per100 && e.per100.iron != null;
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
    e.updatedAt = e.at;
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
      if (item.barcode) e.barcode = String(item.barcode).replace(/\D/g, '').slice(0, 14);
      if (item.brand) e.brand = String(item.brand).slice(0, 60);
      if (item.photoId) e.photoId = String(item.photoId).slice(0, 40);
      var plate = Number(item.plateAssumed);
      if (plate >= 8 && plate <= 45) e.plateAssumed = plate;
    }
    (data.days[date] = data.days[date] || []).push(e);
    persist([date]);
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
    e.updatedAt = bump(e);
    persist([date]);
  }

  /** Give an entry a new name. The food it is matched to stays the same. */
  function rename(date, id, name) {
    var e = find(date, id);
    name = String(name || '').trim().slice(0, 120);
    if (!e || !name || name === e.name) return false;
    e.name = name;
    e.updatedAt = bump(e);
    persist([date]);
    return true;
  }

  /**
   * A copy of an entry for another day or meal: a fresh id and stamps, and no
   * link to the photo it came from, so correcting that photo's plate size
   * later never reaches into the copy.
   */
  function copyOf(e, meal, now) {
    var c = clone(e);
    c.id = newId();
    c.meal = MEALS.indexOf(meal) >= 0 ? meal : e.meal;
    c.at = now;
    c.updatedAt = now;
    delete c.photoId; delete c.plateSet;
    return c;
  }

  /**
   * Move an entry to another meal, or another day. Within a day it is an
   * edit; across days the entry is buried on the old day and a copy is added
   * to the new one, so other devices see the deletion and the addition and
   * agree. Returns the entry as it now stands, or null.
   */
  function move(date, id, toDate, toMeal) {
    var e = find(date, id);
    if (!e || !isDate(toDate)) return null;
    if (MEALS.indexOf(toMeal) < 0) toMeal = e.meal;
    if (toDate === date) {
      if (toMeal === e.meal) return e;
      e.meal = toMeal;
      e.updatedAt = bump(e);
      persist([date]);
      return e;
    }
    var now = Math.max(Date.now(), stampOf(e) + 1);
    var c = copyOf(e, toMeal, now);
    c.at = e.at || now;   // still eaten when it was
    if (e.photoId) { c.photoId = e.photoId; if (e.plateSet) c.plateSet = true; }
    bury(date, e, now);
    data.days[date] = data.days[date].filter(function (x) { return x.id !== id; });
    if (!data.days[date].length) delete data.days[date];
    (data.days[toDate] = data.days[toDate] || []).push(c);
    persist([date, toDate]);
    return c;
  }

  /**
   * Copy every entry of one meal to another day and meal ("same as
   * yesterday's breakfast"). Returns the number copied.
   */
  function copyMeal(fromDate, meal, toDate, toMeal) {
    if (!isDate(toDate)) return 0;
    var src = (data.days[fromDate] || []).filter(function (e) { return e.meal === meal; });
    if (!src.length) return 0;
    var now = Date.now();
    var list = data.days[toDate] = data.days[toDate] || [];
    src.forEach(function (e, i) { list.push(copyOf(e, toMeal || meal, now + i)); });
    persist([toDate]);
    return src.length;
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
      e.updatedAt = bump(e);
      n++;
    });
    if (n) persist([date]);
    return n;
  }

  /**
   * Record that an entry is gone. The stamp is never earlier than the
   * entry's own, so the deletion beats the version it removed even when
   * another device with a faster clock made that version.
   */
  function bury(date, e, now) {
    var gone = data.deleted[date] = data.deleted[date] || {};
    gone[e.id] = Math.max(now, stampOf(e), own(gone, e.id) ? gone[e.id] : 0);
  }

  function remove(date, id) {
    var list = data.days[date];
    if (!list) return;
    var now = Date.now();
    data.days[date] = list.filter(function (e) {
      if (e.id !== id) return true;
      bury(date, e, now);
      return false;
    });
    if (!data.days[date].length) delete data.days[date];
    persist([date]);
  }

  // ---- merging another device's copy of a day ---------------------------

  /**
   * A stable text form of a value, with object keys sorted. Firestore does
   * not keep the order of a map's keys, so comparing plain JSON would see a
   * change on every round trip.
   */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
        .map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v);
  }

  /**
   * Whether copy `a` of an entry should replace copy `b`. The later change
   * wins; two devices editing in the same millisecond are settled by content,
   * so that both make the same choice and end up identical.
   */
  function newer(a, b) {
    var sa = stampOf(a), sb = stampOf(b);
    if (sa !== sb) return sa > sb;
    return canon(a) > canon(b);
  }

  /**
   * A day reduced to what it means -- live entries by id, and tombstones --
   * so two copies can be compared however they are ordered or stored.
   */
  function signature(list, gone) {
    var byId = Object.create(null);
    list.forEach(function (e) { if (!byId[e.id] || newer(e, byId[e.id])) byId[e.id] = e; });
    var live = Object.keys(byId).sort().map(function (id) { return byId[id]; })
      .filter(function (e) { return !buried(gone, e); });
    return canon({ entries: live, deleted: gone });
  }

  /** Another device's copy of a day, with the same checks as anything stored here. */
  function readRemote(remote) {
    remote = isMap(remote) ? remote : {};
    return {
      entries: (Array.isArray(remote.entries) ? remote.entries : []).filter(validEntry),
      deleted: sanitiseTombs(remote.deleted, tombCutoff())
    };
  }

  /**
   * Fold another copy of a day into this one, without saving. Every id on
   * either side is kept unless a tombstone at least as new as it says it was
   * removed; an id on both sides keeps its newer version. Merging the same
   * copy again finds nothing to change. Entries new to this device are slotted
   * in by the time they were logged, and the ones already here keep their
   * order, so a merge does not reshuffle the day on screen.
   */
  function mergeInto(date, remote) {
    var r = readRemote(remote);
    var before = data.days[date] || [];
    var beforeGone = data.deleted[date] || {};
    var was = canon({ entries: before, deleted: beforeGone });

    var gone = {};
    Object.keys(beforeGone).forEach(function (id) { gone[id] = beforeGone[id]; });
    Object.keys(r.deleted).forEach(function (id) {
      if (!own(gone, id) || gone[id] < r.deleted[id]) gone[id] = r.deleted[id];
    });

    var list = before.slice();
    var had = Object.create(null), at = Object.create(null);
    list.forEach(function (e, i) { had[e.id] = true; if (!(e.id in at)) at[e.id] = i; });
    r.entries.forEach(function (x) {
      x = clone(x);
      if (x.id in at) {
        if (newer(x, list[at[x.id]])) list[at[x.id]] = x;
        return;
      }
      var i = list.length;
      while (i > 0 && (list[i - 1].at || 0) > (x.at || 0)) i--;
      list.splice(i, 0, x);
      Object.keys(at).forEach(function (id) { if (at[id] >= i) at[id]++; });
      at[x.id] = i;
    });
    list = list.filter(function (e) { return !buried(gone, e); });

    if (list.length) data.days[date] = list; else delete data.days[date];
    if (Object.keys(gone).length) data.deleted[date] = gone; else delete data.deleted[date];

    var added = 0;
    list.forEach(function (e) { if (!had[e.id]) added++; });
    return { changed: canon({ entries: list, deleted: gone }) !== was, added: added };
  }

  /**
   * Merge another device's copy of a day, `{entries, deleted}`, into this one.
   * Entries that fail the checks sanitise() applies are ignored. Saves and
   * tells listeners (with {remote: true}) only when something changed;
   * returns whether it did.
   */
  function mergeDay(date, remote) {
    if (!isDate(date)) return false;
    var changed = mergeInto(date, remote).changed;
    if (changed) persist([date], { remote: true });
    return changed;
  }

  /**
   * mergeDay for many days at once, {date: copy}, saving and notifying once:
   * a first sync can bring a year of days, and saving the whole log for each
   * one would be slow. Returns the dates that changed.
   */
  function mergeDays(map) {
    var changed = [];
    if (!isMap(map)) return changed;
    Object.keys(map).forEach(function (date) {
      if (isDate(date) && mergeInto(date, map[date]).changed) changed.push(date);
    });
    if (changed.length) persist(changed, { remote: true });
    return changed;
  }

  /** This device's copy of a day, as sync sends it: plain data, nothing undefined. */
  function dayDoc(date) {
    var entries = clone(data.days[date] || []);
    var deleted = clone(data.deleted[date] || {});
    // The day's own latest change rather than the clock, so two devices
    // holding the same day produce the same document.
    var latest = 0;
    entries.forEach(function (e) { latest = Math.max(latest, stampOf(e)); });
    Object.keys(deleted).forEach(function (id) { latest = Math.max(latest, deleted[id]); });
    return { entries: entries, deleted: deleted, updatedAt: latest };
  }

  /** Whether another copy of a day already says exactly what this one does. */
  function sameDay(date, remote) {
    var r = readRemote(remote);
    var mine = sanitiseTombs(data.deleted[date], tombCutoff());
    return signature(data.days[date] || [], mine) === signature(r.entries, r.deleted);
  }

  /** Every day with entries or tombstones, oldest first. */
  function allDates() {
    var seen = {};
    Object.keys(data.days).concat(Object.keys(data.deleted)).forEach(function (d) { seen[d] = true; });
    return Object.keys(seen).sort();
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
    var added = 0, changed = [];
    // The same merge sync uses: an id already here keeps whichever copy
    // changed last, so importing a file twice adds nothing the second time.
    Object.keys(incoming.days).forEach(function (date) {
      var r = mergeInto(date, { entries: incoming.days[date], deleted: incoming.deleted[date] || {} });
      added += r.added;
      if (r.changed) changed.push(date);
    });
    // An import is a change made here, so sync passes it on.
    if (changed.length) persist(changed);
    return added;
  }

  /**
   * Delete everything. Each entry leaves a tombstone, so with sync on the
   * deletion reaches the other devices instead of being undone by them.
   */
  function clearAll() {
    var now = Date.now(), dates = Object.keys(data.days);
    dates.forEach(function (date) {
      data.days[date].forEach(function (e) { bury(date, e, now); });
    });
    data.days = {};
    persist(dates);
  }

  function dayCount() { return Object.keys(data.days).length; }
  function importedFrom() { return data.imported || null; }

  window.Tracker = {
    MEALS: MEALS, MACROS: MACROS, TRACKED: TRACKED, MAX_GRAMS: MAX_GRAMS,
    today: today, shift: shift, dateKey: dateKey, guessMeal: guessMeal,
    day: day, totals: totals, history: history, find: find,
    nutrientsOf: nutrientsOf, kcalRange: kcalRange, isEstimate: isEstimate, isComplete: isComplete,
    add: add, update: update, rename: rename, move: move, copyMeal: copyMeal, rescalePhoto: rescalePhoto, plateFactor: plateFactor, remove: remove,
    exportJson: exportJson, importJson: importJson, clearAll: clearAll,
    mergeDay: mergeDay, mergeDays: mergeDays, dayDoc: dayDoc, sameDay: sameDay, allDates: allDates,
    dayCount: dayCount, importedFrom: importedFrom, newId: newId,
    onChange: function (fn) { listeners.push(fn); }
  };
})();
