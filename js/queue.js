// Meals waiting to be read: photos and descriptions taken with no connection,
// photos shared into the app, and photos the on-device model read offline
// that Gemini should read again for a better answer.
//
// Kept in IndexedDB ('foodlog-queue', store 'items'), because photos are too
// big for localStorage. The service worker writes to the same store when a
// photo is shared to the installed app (sw.js). Each record:
//   {id, kind: 'photo'|'text', blob | dataUrl | text, hint, date, meal,
//    createdAt, status, shared?, entryIds?, result?, attempts?, error?}
// status:
//   'shared'      just shared in; the page decides what to do with it
//   'waiting'     to be read when online
//   'provisional' read on this device and logged; to be read again by Gemini
//   'ready'       read, waiting for the person to check it
//   'better'      Gemini's reading of a provisional one, ready to compare
// A photo is deleted as soon as its record is done with. Nothing is kept
// for longer than two weeks, and never more than 30 records.
//
// Without IndexedDB (some private modes) the queue lives in memory for this
// visit only.

(function () {
  'use strict';

  var DB = 'foodlog-queue', STORE = 'items';
  var MAX = 30, MAX_AGE = 14 * 864e5;
  var listeners = [];
  var memory = null;          // fallback store: {id: record}
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no IndexedDB')); return; }
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('blocked')); };
    }).catch(function () { memory = memory || {}; return null; });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode), out;
        Promise.resolve(fn(t.objectStore(STORE))).then(function (v) { out = v; });
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('aborted')); };
      });
    });
  }

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) { setTimeout(function () { throw e; }, 0); } }); }

  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function all() {
    return tx('readonly', function (s) {
      if (!s) return Object.keys(memory).map(function (k) { return memory[k]; });
      return req(s.getAll());
    }).then(function (list) {
      return (list || []).sort(function (a, b) { return a.createdAt - b.createdAt; });
    });
  }

  function get(id) {
    return tx('readonly', function (s) { return s ? req(s.get(id)) : memory[id]; })
      .then(function (r) { return r || null; });
  }

  function put(rec) {
    return tx('readwrite', function (s) {
      if (!s) { memory[rec.id] = rec; return rec; }
      return req(s.put(rec)).then(function () { return rec; });
    }).then(function (r) { emit(); return r; });
  }

  /** Add a record; returns it with its id. */
  function add(rec) {
    rec.id = rec.id || newId();
    rec.createdAt = rec.createdAt || Date.now();
    return prune().then(function () { return put(rec); });
  }

  function update(id, patch) {
    return get(id).then(function (r) {
      if (!r) return null;
      Object.keys(patch).forEach(function (k) {
        if (patch[k] === undefined) delete r[k]; else r[k] = patch[k];
      });
      return put(r);
    });
  }

  function remove(id) {
    return tx('readwrite', function (s) {
      if (!s) { delete memory[id]; return null; }
      return req(s.delete(id));
    }).then(function () { emit(); });
  }

  /** Drop what is too old, then the oldest beyond the limit. */
  function prune() {
    return all().then(function (list) {
      var now = Date.now();
      var drop = list.filter(function (r) { return now - r.createdAt > MAX_AGE; });
      var keep = list.filter(function (r) { return drop.indexOf(r) < 0; });
      if (keep.length >= MAX) drop = drop.concat(keep.slice(0, keep.length - MAX + 1));
      if (!drop.length) return null;
      return Promise.all(drop.map(function (r) { return remove(r.id); }));
    });
  }

  /** A data: URL as a Blob, without the network (it works offline). */
  function blobOf(rec) {
    if (rec.blob) return rec.blob;
    if (!rec.dataUrl) return null;
    var m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(rec.dataUrl);
    if (!m) return null;
    var bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  }

  window.Queue = {
    add: add, get: get, all: all, update: update, remove: remove, prune: prune, blobOf: blobOf,
    onChange: function (fn) { listeners.push(fn); },
    // For the service worker's writes, which the page cannot hear.
    refresh: emit
  };
})();
