// The on-device photo engine: Google's open Gemma 4 E2B model, run in this
// browser with WebGPU through Transformers.js (see js/local-worker.js).
//
// It needs no API key and has no quota, and the photo never leaves the
// device. The costs are a one-time download of about 3.4 GB, a device with
// WebGPU and enough graphics memory, and speed: it is slower than Gemini,
// most of all on a phone. It is asked exactly what Gemini is asked -- the same
// prompt from js/photo.js -- and its reply goes through the same parser, so
// everything after the photo (USDA matching, review, measuring) is identical.

(function () {
  'use strict';

  var READY_KEY = 'foodlog.local.v1';      // set once the model has loaded here
  var CACHE_NAME = 'transformers-cache';    // Transformers.js's Cache Storage name
  // Approximate downloads for photo use, from the model repository's file
  // sizes: decoder + per-layer embeddings + vision and audio encoders.
  var SIZE_GB = { q4f16: 3.4, q4: 3.9 };
  // embed_tokens' per-layer table: 262,144 tokens x 4,480 packed bytes.
  var BIGGEST_TENSOR = 262144 * 4480;

  var worker = null;
  var listeners = [];
  var pending = {};
  var nextId = 1;
  var caps = null;      // result of check()
  var state = { status: isDownloaded() ? 'cached' : 'none', loaded: 0, total: 0, error: '' };
  var loadWaiters = [];

  function emit() { listeners.forEach(function (fn) { fn(state); }); }

  function isDownloaded() {
    try { return localStorage.getItem(READY_KEY) === '1'; } catch (e) { return false; }
  }

  function setDownloaded(v) {
    try {
      if (v) localStorage.setItem(READY_KEY, '1');
      else localStorage.removeItem(READY_KEY);
    } catch (e) { /* ignore */ }
  }

  /**
   * What this device can do. Resolves to
   * {ok, dtype, sizeGb, reason, warnings[]}. `ok` false means it cannot run at
   * all; warnings mean it might not fit and is worth trying anyway.
   */
  function check() {
    if (caps) return Promise.resolve(caps);
    var warnings = [];
    if (!navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') {
      caps = { ok: false, reason: 'This browser has no WebGPU, which the on-device model needs. Recent ' +
        'Chrome and Edge have it on Android, Windows, Mac and ChromeOS, and Safari has it from iOS 26 and macOS 26.' };
      return Promise.resolve(caps);
    }
    // Promise.resolve().then so that a synchronous throw lands in .catch below.
    return Promise.resolve().then(function () {
      return navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    }).then(function (adapter) {
      if (!adapter) {
        caps = { ok: false, reason: 'WebGPU is switched on but no graphics adapter is available to it ' +
          'in this browser.' };
        return caps;
      }
      // The model's per-layer embedding table is one 1,174,405,120-byte tensor
      // and has to sit in a single GPU buffer that a shader can read. Below
      // that, the model loads and then fails on the first photo, so say so
      // now. This is the limit that decides which phones can run it in a
      // browser; natively the same model runs on far more of them.
      var limit = Math.min(adapter.limits.maxBufferSize || 0,
                           adapter.limits.maxStorageBufferBindingSize || 0);
      if (limit < BIGGEST_TENSOR) {
        caps = { ok: false, limitGb: limit / 1e9, reason: 'This device’s graphics processor allows buffers of up to ' +
          (limit / 1e9).toFixed(2) + ' GB, and the model needs one of ' + (BIGGEST_TENSOR / 1e9).toFixed(2) +
          ' GB, so it cannot run in this browser. Gemini with a free key works on any device.' };
        return caps;
      }
      var f16 = adapter.features && adapter.features.has('shader-f16');
      var dtype = f16 ? 'q4f16' : 'q4';
      if (!f16) {
        warnings.push('This GPU lacks 16-bit shader support, so the larger 4-bit build is used.');
      }
      // Chrome reports memory in steps up to 8; other browsers do not report it.
      if (navigator.deviceMemory && navigator.deviceMemory < 6) {
        warnings.push('This device reports ' + navigator.deviceMemory + ' GB of memory. The model needs ' +
          'roughly 4 GB free, so it may not load.');
      }
      var estimate = navigator.storage && navigator.storage.estimate
        ? navigator.storage.estimate().catch(function () { return null; }) : Promise.resolve(null);
      return estimate.then(function (est) {
        if (est && est.quota && !isDownloaded() &&
            est.quota - (est.usage || 0) < SIZE_GB[dtype] * 1e9 * 1.1) {
          warnings.push('The browser may not allow enough storage for the download (' +
            ((est.quota - (est.usage || 0)) / 1e9).toFixed(1) + ' GB available to this site).');
        }
        caps = { ok: true, dtype: dtype, sizeGb: SIZE_GB[dtype], warnings: warnings };
        return caps;
      });
    }).catch(function (err) {
      caps = { ok: false, reason: 'WebGPU could not start: ' + (err && err.message ? err.message : err) };
      return caps;
    });
  }

  /** Whether the browser's cache holds the model's largest file. */
  function verifyCached() {
    if (!window.caches) return Promise.resolve(false);
    return caches.open(CACHE_NAME).then(function (c) { return c.keys(); }).then(function (keys) {
      return keys.some(function (r) { return /decoder_model_merged_q4(f16)?\.onnx_data/.test(r.url); }) &&
        keys.some(function (r) { return /embed_tokens_q4(f16)?\.onnx_data/.test(r.url); });
    }).catch(function () { return false; });
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker('js/local-worker.js', { type: 'module' });
    worker.onmessage = function (ev) {
      var d = ev.data || {};
      if (d.type === 'progress') {
        state.loaded = d.loaded || 0;
        state.total = Math.max(d.total || 0, (caps && caps.sizeGb || 3.4) * 1e9);
        emit();
      } else if (d.type === 'loaded') {
        state.status = 'ready';
        state.error = '';
        emit();
        loadWaiters.splice(0).forEach(function (w) { w.resolve(); });
        // Only call it downloaded if the browser really kept the files: a
        // site over its storage quota gets the model for this visit only.
        verifyCached().then(function (ok) {
          setDownloaded(ok);
          state.notCached = !ok;
          emit();
        });
      } else if (d.type === 'token') {
        var p = pending[d.id];
        if (p && p.onStatus) p.onStatus({ phase: 'writing', count: d.count });
      } else if (d.type === 'result') {
        var r = pending[d.id];
        delete pending[d.id];
        if (r) r.resolve(d.text);
      } else if (d.type === 'error') {
        var err = new Error(d.message || 'The on-device model failed.');
        if (d.id && pending[d.id]) {
          var q = pending[d.id];
          delete pending[d.id];
          q.reject(err);
        } else {
          state.status = 'error';
          state.error = err.message;
          emit();
          loadWaiters.splice(0).forEach(function (w) { w.reject(err); });
        }
      }
    };
    worker.onerror = function (ev) {
      var err = new Error(ev && ev.message ? ev.message : 'The on-device model could not start.');
      state.status = 'error';
      state.error = err.message;
      emit();
      loadWaiters.splice(0).forEach(function (w) { w.reject(err); });
      Object.keys(pending).forEach(function (id) { pending[id].reject(err); delete pending[id]; });
      worker = null;
    };
    return worker;
  }

  /**
   * Download the model (first time) or load it from the browser's cache, and
   * keep it in memory for this visit. Resolves when it is ready to read photos.
   */
  function load() {
    if (state.status === 'ready') return Promise.resolve();
    return check().then(function (c) {
      if (!c.ok) throw new Error(c.reason);
      return new Promise(function (resolve, reject) {
        loadWaiters.push({ resolve: resolve, reject: reject });
        if (state.status !== 'downloading' && state.status !== 'loading') {
          state.status = isDownloaded() ? 'loading' : 'downloading';
          state.error = '';
          state.loaded = 0;
          emit();
          // Ask the browser not to evict a multi-gigabyte download under
          // storage pressure. It may say no; the model then just risks
          // needing a second download one day.
          if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
          ensureWorker().postMessage({ type: 'load', dtype: c.dtype });
        }
      });
    });
  }

  /** Stop a download or free the loaded model. The cached files stay. */
  function stop() {
    if (worker) { worker.terminate(); worker = null; }
    var err = new Error('Stopped.');
    loadWaiters.splice(0).forEach(function (w) { w.reject(err); });
    Object.keys(pending).forEach(function (id) { pending[id].reject(err); delete pending[id]; });
    state.status = isDownloaded() ? 'cached' : 'none';
    state.loaded = 0;
    emit();
  }

  /** Delete the downloaded model from this browser. */
  function remove() {
    stop();
    setDownloaded(false);
    state.status = 'none';
    emit();
    if (!window.caches) return Promise.resolve();
    return caches.delete(CACHE_NAME).catch(function () { return false; });
  }

  /**
   * Read a meal photo. Resolves to {dataUrl, items, plateCm, notes}, the same
   * shape as Photo.analyse. `onStatus` hears {phase: 'loading'|'reading'|'writing', count}.
   */
  function analyse(file, opts, onStatus) {
    var Photo = window.Photo;
    var dataUrl;
    return Photo.prepare(file).then(function (img) {
      dataUrl = img.dataUrl;
      if (onStatus) onStatus({ phase: 'loading' });
      return load();
    }).then(function () {
      if (onStatus) onStatus({ phase: 'reading' });
      return new Promise(function (resolve, reject) {
        var id = nextId++;
        pending[id] = { resolve: resolve, reject: reject, onStatus: onStatus };
        ensureWorker().postMessage({
          type: 'run', id: id, prompt: Photo.buildPrompt(opts), image: dataUrl,
          dtype: caps && caps.dtype
        });
      });
    }).then(function (text) {
      var out = Photo.parse(text);
      out.dataUrl = dataUrl;
      return out;
    });
  }

  /** Read a meal described in words on the device. Same result shape, no picture. */
  function analyseText(text, opts, onStatus) {
    var Photo = window.Photo;
    if (onStatus) onStatus({ phase: 'loading' });
    return load().then(function () {
      if (onStatus) onStatus({ phase: 'reading' });
      return new Promise(function (resolve, reject) {
        var id = nextId++;
        pending[id] = { resolve: resolve, reject: reject, onStatus: onStatus };
        ensureWorker().postMessage({
          type: 'run', id: id, prompt: Photo.buildTextPrompt(text, opts), image: null,
          dtype: caps && caps.dtype
        });
      });
    }).then(function (reply) {
      var out = Photo.parse(reply);
      out.dataUrl = '';
      out.plateCm = null;
      return out;
    });
  }

  window.LocalModel = {
    analyseText: analyseText,
    NAME: 'Gemma 4 E2B',
    check: check, load: load, stop: stop, remove: remove, analyse: analyse,
    isDownloaded: isDownloaded,
    state: function () { return state; },
    onChange: function (fn) { listeners.push(fn); }
  };
})();
