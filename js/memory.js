// What Food Log learns from your corrections to photo and described meals.
//
// Two things, per name the photo reader uses ("roti", "dal", "white rice"):
//   * a match: when you change which food an item is matched to, the next
//     item with that name gets your choice (or "keep the model's own
//     estimate", when that is what you picked);
//   * a portion factor: when you weigh or measure an item, the ratio of your
//     weight to the reader's guess. The next guess for that name is scaled by
//     the median of the last five ratios, so three rotis still read as three
//     -- they are just your rotis.
// Accepting an automatic match teaches nothing; only a change does.
//
// Stored on this device (localStorage 'foodlog.memory.v1') and, with sync
// on, merged across devices like the library: newest change wins per name,
// and forgetting leaves a tombstone.

(function () {
  'use strict';

  var KEY = 'foodlog.memory.v1';
  var MAX_NAMES = 300;
  var KEEP = 5;                 // ratios kept per name
  var MIN_F = 0.5, MAX_F = 2;   // how far a remembered portion may move a guess
  var TOMBSTONE_DAYS = 90;
  var listeners = [];
  var data;

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function singular(w) {
    if (w.length < 4 || /(ss|us)$/.test(w)) return w;
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (/(ch|sh|x|o)es$/.test(w)) return w.slice(0, -2);
    return w.replace(/s$/, '');
  }

  /** "Rotis (2)", "roti" and "Roti " are one name: "roti". */
  function keyOf(name) {
    return String(name || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-zÀ-ɏऀ-ൿ]+/g, ' ')
      .trim().split(/\s+/).filter(Boolean).map(singular).join(' ').slice(0, 60);
  }

  function cleanRecord(r) {
    if (!isMap(r)) return null;
    var out = { updatedAt: isNum(r.updatedAt) ? r.updatedAt : 0 };
    if (typeof r.slug === 'string') out.slug = r.slug.slice(0, 60);     // '' = keep the model's estimate
    if (typeof r.label === 'string') out.label = r.label.slice(0, 80);
    if (Array.isArray(r.factors)) {
      out.factors = r.factors.filter(function (f) { return isNum(f) && f >= 0.2 && f <= 5; }).slice(-KEEP);
      if (!out.factors.length) delete out.factors;
    }
    return out.slug != null || out.factors ? out : null;
  }

  function sanitise(d) {
    var out = { names: {}, deleted: {} };
    if (!isMap(d)) return out;
    var cutoff = Date.now() - TOMBSTONE_DAYS * 864e5;
    if (isMap(d.deleted)) {
      Object.keys(d.deleted).forEach(function (k) {
        if (isNum(d.deleted[k]) && d.deleted[k] >= cutoff && k === keyOf(k) && k) out.deleted[k] = d.deleted[k];
      });
    }
    if (isMap(d.names)) {
      Object.keys(d.names).slice(0, MAX_NAMES).forEach(function (k) {
        var r = cleanRecord(d.names[k]);
        if (r && k && k === keyOf(k) && !(out.deleted[k] >= r.updatedAt)) out.names[k] = r;
      });
    }
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

  function record(name) {
    var k = keyOf(name);
    if (!k) return null;
    var r = data.names[k] || {};
    var n = { updatedAt: stamp(r), label: String(name).slice(0, 80) };
    if (r.slug != null) n.slug = r.slug;
    if (r.factors) n.factors = r.factors.slice();
    return { key: k, rec: n };
  }

  function save(k, rec) {
    // Keep the store bounded: drop the longest-unused names.
    var keys = Object.keys(data.names);
    if (!data.names[k] && keys.length >= MAX_NAMES) {
      keys.sort(function (a, b) { return data.names[a].updatedAt - data.names[b].updatedAt; })
        .slice(0, keys.length - MAX_NAMES + 1).forEach(function (old) { delete data.names[old]; });
    }
    delete data.deleted[k];
    data.names[k] = rec;
    persist();
  }

  /** Remember that items called `name` are `slug` ('' = the model's own estimate). */
  function learnMatch(name, slug) {
    var x = record(name);
    if (!x) return;
    x.rec.slug = slug ? String(slug) : '';
    save(x.key, x.rec);
  }

  /** Remember that an item called `name` guessed at `guess` g weighed `grams`. */
  function learnPortion(name, grams, guess) {
    if (!(grams > 0) || !(guess > 0)) return;
    var f = grams / guess;
    if (f < 0.2 || f > 5) return;          // a different dish, or a typo: not a portion habit
    var x = record(name);
    if (!x) return;
    x.rec.factors = (x.rec.factors || []).concat([Math.round(f * 1000) / 1000]).slice(-KEEP);
    save(x.key, x.rec);
  }

  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * What is remembered for `name`: {slug?, factor?, n} -- `slug` undefined
   * when no match was taught; `factor` the median ratio, clamped, with `n`
   * the number of measurements behind it.
   */
  function lookup(name) {
    var r = data.names[keyOf(name)];
    if (!r) return null;
    var out = { n: r.factors ? r.factors.length : 0 };
    if (r.slug != null) out.slug = r.slug;
    if (r.factors) out.factor = Math.min(MAX_F, Math.max(MIN_F, median(r.factors)));
    return out;
  }

  function list() {
    return Object.keys(data.names).map(function (k) {
      var r = data.names[k], l = lookup(k);
      return { key: k, label: r.label || k, slug: r.slug, factor: l.factor, n: l.n, updatedAt: r.updatedAt };
    }).sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  function forget(key) {
    var r = data.names[key];
    if (!r) return;
    delete data.names[key];
    data.deleted[key] = Math.max(Date.now(), r.updatedAt || 0);
    persist();
  }

  function forgetAll() { Object.keys(data.names).forEach(forget); }

  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
        .map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v);
  }

  /** Merge another device's copy: per name the newest change wins. */
  function merge(remote) {
    var r = sanitise(remote), before = canon(data);
    Object.keys(r.deleted).forEach(function (k) {
      if (!(data.deleted[k] >= r.deleted[k])) data.deleted[k] = r.deleted[k];
    });
    Object.keys(r.names).forEach(function (k) {
      var mine = data.names[k], theirs = r.names[k];
      if (!mine || theirs.updatedAt > mine.updatedAt ||
          (theirs.updatedAt === mine.updatedAt && canon(theirs) > canon(mine))) data.names[k] = theirs;
    });
    Object.keys(data.names).forEach(function (k) {
      if (data.deleted[k] >= data.names[k].updatedAt) delete data.names[k];
    });
    var changed = canon(data) !== before;
    if (changed) persist({ remote: true });
    return changed;
  }

  data = load();

  window.Memory = {
    keyOf: keyOf, learnMatch: learnMatch, learnPortion: learnPortion, lookup: lookup,
    list: list, forget: forget, forgetAll: forgetAll,
    doc: function () { return clone(data); },
    merge: merge,
    same: function (remote) { return canon(sanitise(remote)) === canon(data); },
    isEmpty: function () { return !Object.keys(data.names).length && !Object.keys(data.deleted).length; },
    onChange: function (fn) { listeners.push(fn); }
  };
})();
