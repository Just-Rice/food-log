// Saved meals, home recipes and supplements.
//
// A saved meal is a set of log entries kept under a name -- "my usual
// breakfast" -- and logged again in one tap. A recipe is a list of USDA
// ingredients with weights, plus how much the cooked dish weighs or how many
// servings it makes; its nutrition per 100 g and per serving is worked out
// from the ingredients, so a logged recipe carries the full vitamin and
// mineral profile rather than a guess. A supplement is what its label says
// one dose contains, in the units the reference intakes use.
//
// Stored on this device (localStorage 'foodlog.library.v1'). With sync on,
// it is merged across devices the way the log is: every item carries the
// time it last changed, the newest change wins, and a deletion leaves a
// tombstone so another device cannot hand it back.

(function () {
  'use strict';

  var KEY = 'foodlog.library.v1';
  var TOMBSTONE_DAYS = 90;
  var MAX_ITEMS = 40;          // ingredients in a recipe, entries in a meal
  var listeners = [];
  var data;                    // loaded below, once the cleaners are defined

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function cleanNutrients(o) {
    var out = {};
    if (!isMap(o)) return out;
    Object.keys(o).forEach(function (k) { if (isNum(o[k]) && o[k] >= 0 && o[k] < 1e6) out[k] = o[k]; });
    return out;
  }

  /** One food in a meal or recipe: what it is, how much, and its figures per 100 g. */
  function cleanItem(it) {
    if (!it || typeof it.name !== 'string') return null;
    var out = { name: it.name.slice(0, 120) };
    if (typeof it.slug === 'string') out.slug = it.slug.slice(0, 60);
    if (it.fixed) {
      out.fixed = cleanNutrients(it.fixed);
      if (!isNum(out.fixed.kcal)) return null;
      return out;
    }
    if (!isNum(it.grams) || it.grams <= 0 || it.grams > 5000) return null;
    out.grams = it.grams;
    out.per100 = cleanNutrients(it.per100);
    if (!isNum(out.per100.kcal)) return null;
    if (typeof it.source === 'string') out.source = it.source.slice(0, 20);
    if (typeof it.barcode === 'string') out.barcode = it.barcode.slice(0, 14);
    if (typeof it.brand === 'string') out.brand = it.brand.slice(0, 60);
    return out;
  }

  function cleanMeal(m) {
    if (!m || typeof m.id !== 'string' || typeof m.name !== 'string') return null;
    var items = (Array.isArray(m.items) ? m.items : []).map(cleanItem).filter(Boolean).slice(0, MAX_ITEMS);
    if (!items.length) return null;
    return { id: m.id.slice(0, 40), name: m.name.slice(0, 80) || 'Meal', items: items,
             updatedAt: isNum(m.updatedAt) ? m.updatedAt : 0 };
  }

  function cleanRecipe(r) {
    if (!r || typeof r.id !== 'string' || typeof r.name !== 'string') return null;
    var ing = (Array.isArray(r.ingredients) ? r.ingredients : []).map(cleanItem)
      .filter(function (x) { return x && !x.fixed; }).slice(0, MAX_ITEMS);
    if (!ing.length) return null;
    var out = { id: r.id.slice(0, 40), name: r.name.slice(0, 80) || 'Recipe', ingredients: ing,
                updatedAt: isNum(r.updatedAt) ? r.updatedAt : 0 };
    if (isNum(r.cookedGrams) && r.cookedGrams > 0 && r.cookedGrams <= 50000) out.cookedGrams = r.cookedGrams;
    if (isNum(r.servings) && r.servings >= 1 && r.servings <= 100) out.servings = Math.round(r.servings);
    return out;
  }

  // Label nutrients a supplement may list (see Tracker.MICROS), plus the
  // folic-acid part of folate, which alone has an upper limit.
  var SUPP_KEYS = ['vita', 'vitc', 'vitd', 'vite', 'vitk', 'thiamin', 'riboflavin', 'niacin',
                   'pantothenic', 'b6', 'folate', 'folicAcid', 'b12', 'choline',
                   'calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'sodium', 'zinc',
                   'copper', 'manganese', 'selenium'];

  function cleanSupplement(x) {
    if (!x || typeof x.id !== 'string' || typeof x.name !== 'string') return null;
    var amounts = {};
    if (isMap(x.amounts)) {
      SUPP_KEYS.forEach(function (k) {
        if (isNum(x.amounts[k]) && x.amounts[k] > 0 && x.amounts[k] < 1e5) amounts[k] = x.amounts[k];
      });
    }
    if (!Object.keys(amounts).length) return null;
    return { id: x.id.slice(0, 40), name: x.name.slice(0, 80) || 'Supplement',
             dose: typeof x.dose === 'string' && x.dose.trim() ? x.dose.slice(0, 40) : '1 tablet',
             amounts: amounts, daily: !!x.daily, updatedAt: isNum(x.updatedAt) ? x.updatedAt : 0 };
  }

  var KINDS = { meals: cleanMeal, recipes: cleanRecipe, supplements: cleanSupplement };

  function sanitise(d) {
    var out = { meals: {}, recipes: {}, supplements: {}, deleted: {} };
    if (!isMap(d)) return out;
    var cutoff = Date.now() - TOMBSTONE_DAYS * 864e5;
    if (isMap(d.deleted)) {
      Object.keys(d.deleted).forEach(function (id) {
        if (isNum(d.deleted[id]) && d.deleted[id] >= cutoff && !/^__.*__$/.test(id)) out.deleted[id] = d.deleted[id];
      });
    }
    Object.keys(KINDS).forEach(function (kind) {
      if (!isMap(d[kind])) return;
      Object.keys(d[kind]).forEach(function (id) {
        var x = KINDS[kind](d[kind][id]);
        if (x && x.id === id && !(out.deleted[id] >= x.updatedAt)) out[kind][id] = x;
      });
    });
    return out;
  }

  function load() {
    try { return sanitise(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return sanitise({}); }
  }

  function persist(meta) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
    var info = { remote: !!(meta && meta.remote) };
    listeners.forEach(function (fn) { try { fn(info); } catch (e) { setTimeout(function () { throw e; }, 0); } });
  }

  function stamp(prev) { return Math.max(Date.now(), (prev && prev.updatedAt || 0) + 1); }

  function sorted(map) {
    return Object.keys(map).map(function (id) { return map[id]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  // ---- meals ---------------------------------------------------------------

  /** Save log entries as a meal. Returns it, or null if none could be kept. */
  function saveMeal(name, entries, id) {
    var prev = id && data.meals[id];
    var m = cleanMeal({ id: id || newId(), name: String(name || '').trim() || 'Meal',
                        items: clone(entries || []), updatedAt: 0 });
    if (!m) return null;
    m.updatedAt = stamp(prev);
    data.meals[m.id] = m;
    persist();
    return m;
  }

  // ---- recipes -----------------------------------------------------------

  function saveRecipe(r) {
    var prev = r.id && data.recipes[r.id];
    var x = cleanRecipe({ id: r.id || newId(), name: String(r.name || '').trim() || 'Recipe',
                          ingredients: clone(r.ingredients || []), cookedGrams: Number(r.cookedGrams) || null,
                          servings: Number(r.servings) || null, updatedAt: 0 });
    if (!x) return null;
    x.updatedAt = stamp(prev);
    data.recipes[x.id] = x;
    persist();
    return x;
  }

  /**
   * A recipe's nutrition. The ingredients' nutrients are summed; per 100 g
   * divides by the cooked weight when it is known (cooking changes weight,
   * mostly water) or by the raw weight when it is not; a serving is the whole
   * divided by the number of servings (one, when none is given).
   */
  function nutrition(r) {
    var total = {}, rawGrams = 0;
    (r.ingredients || []).forEach(function (it) {
      rawGrams += it.grams;
      Object.keys(it.per100 || {}).forEach(function (k) {
        total[k] = (total[k] || 0) + it.per100[k] * it.grams / 100;
      });
    });
    var weight = r.cookedGrams || rawGrams;
    var servings = r.servings || 1;
    var per100 = {}, perServing = {};
    Object.keys(total).forEach(function (k) {
      per100[k] = weight ? total[k] / weight * 100 : 0;
      perServing[k] = total[k] / servings;
    });
    return { total: total, rawGrams: rawGrams, weight: weight, servings: servings,
             servingGrams: weight / servings, per100: per100, perServing: perServing };
  }

  // ---- supplements -----------------------------------------------------------

  /** Save a supplement: {id?, name, dose, amounts, daily}. Returns it, or null. */
  function saveSupplement(x) {
    var prev = x.id && data.supplements[x.id];
    var s = cleanSupplement({ id: x.id || newId(), name: String(x.name || '').trim() || 'Supplement',
                              dose: String(x.dose || '').trim(), amounts: clone(x.amounts || {}),
                              daily: !!x.daily, updatedAt: 0 });
    if (!s) return null;
    s.updatedAt = stamp(prev);
    data.supplements[s.id] = s;
    persist();
    return s;
  }

  // ---- shared ------------------------------------------------------------

  function remove(id) {
    var had = data.meals[id] || data.recipes[id] || data.supplements[id];
    if (!had) return;
    delete data.meals[id];
    delete data.recipes[id];
    delete data.supplements[id];
    data.deleted[id] = Math.max(Date.now(), had.updatedAt || 0);
    persist();
  }

  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
        .map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v);
  }

  /** The whole library as sync sends it. */
  function doc() { return clone(data); }

  /**
   * Merge another device's library: the newer copy of each item wins, a
   * tombstone at least as new removes it, and merging the same copy twice
   * changes nothing. Returns whether anything changed here.
   */
  function merge(remote) {
    var r = sanitise(remote), before = canon(data);
    Object.keys(r.deleted).forEach(function (id) {
      if (!(data.deleted[id] >= r.deleted[id])) data.deleted[id] = r.deleted[id];
    });
    Object.keys(KINDS).forEach(function (kind) {
      Object.keys(r[kind]).forEach(function (id) {
        var mine = data[kind][id], theirs = r[kind][id];
        if (!mine || theirs.updatedAt > mine.updatedAt ||
            (theirs.updatedAt === mine.updatedAt && canon(theirs) > canon(mine))) data[kind][id] = theirs;
      });
      Object.keys(data[kind]).forEach(function (id) {
        if (data.deleted[id] >= data[kind][id].updatedAt) delete data[kind][id];
      });
    });
    var changed = canon(data) !== before;
    if (changed) persist({ remote: true });
    return changed;
  }

  /** Whether another copy says exactly what this one does. */
  function same(remote) { return canon(sanitise(remote)) === canon(data); }

  data = load();

  window.Library = {
    meals: function () { return sorted(data.meals); },
    recipes: function () { return sorted(data.recipes); },
    supplements: function () { return sorted(data.supplements); },
    isEmpty: function () {
      return !Object.keys(data.meals).length && !Object.keys(data.recipes).length &&
        !Object.keys(data.supplements).length && !Object.keys(data.deleted).length;
    },
    get: function (id) { return data.meals[id] || data.recipes[id] || data.supplements[id] || null; },
    saveMeal: saveMeal, saveRecipe: saveRecipe, saveSupplement: saveSupplement, SUPP_KEYS: SUPP_KEYS,
    remove: remove, nutrition: nutrition,
    doc: doc, merge: merge, same: same,
    onChange: function (fn) { listeners.push(fn); }
  };
})();
