// Packaged foods by barcode: scan with the camera (or type the number), then
// look the product up on Open Food Facts, the free, openly licensed database
// of food labels (https://world.openfoodfacts.org).
//
// The camera is read with the browser's own BarcodeDetector where it exists
// (Chrome and Edge on Android, ChromeOS, macOS). Elsewhere -- Safari on iPhone
// among them -- a WebAssembly port of the same detector is loaded from
// jsDelivr the first time it is needed.
//
// Open Food Facts is crowd-sourced. Its nutrition per 100 g comes straight
// from the label and is usually good; its allergen list is often incomplete
// (Nutella is listed with nuts but not milk). So the product's allergens are
// shown as reported, a clash with the person's settings is flagged, and the
// absence of an allergen is never presented as safety: the label is the
// authority, and the page says so.

(function () {
  'use strict';

  var API = 'https://world.openfoodfacts.org/api/v2/product/';
  var FIELDS = 'product_name,product_name_en,generic_name,brands,nutriments,allergens_tags,' +
    'traces_tags,ingredients_analysis_tags,serving_size,serving_quantity,image_front_small_url';
  var PONYFILL = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.3/dist/es/ponyfill.js';
  var CACHE = 'foodlog.products.v1';
  var CACHE_MAX = 200;
  var FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

  // Open Food Facts allergen tags -> the app's allergen keys. Milk also
  // means lactose, for anyone avoiding that.
  var ALLERGEN_TAGS = {
    'en:milk': ['milk', 'lactose'], 'en:gluten': ['gluten'], 'en:nuts': ['treenut'],
    'en:peanuts': ['peanut'], 'en:soybeans': ['soy'], 'en:sesame-seeds': ['sesame'],
    'en:eggs': ['egg'], 'en:fish': ['fish'], 'en:crustaceans': ['crustacean'],
    'en:molluscs': ['mollusc']
  };

  // ---- barcodes ----------------------------------------------------------

  /** Whether a string is an EAN-8, UPC-A, EAN-13 or GTIN-14 with a valid check digit. */
  function validCode(code) {
    code = String(code || '').replace(/\s+/g, '');
    if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
    var digits = code.split('').map(Number), check = digits.pop(), sum = 0;
    for (var i = digits.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += digits[i] * w;
    return (10 - (sum % 10)) % 10 === check;
  }

  var detectorPromise = null;

  /** A BarcodeDetector for retail barcodes: the browser's own, or the WebAssembly one. */
  function detector() {
    if (detectorPromise) return detectorPromise;
    detectorPromise = Promise.resolve().then(function () {
      var Native = window.BarcodeDetector;
      if (Native && Native.getSupportedFormats) {
        return Native.getSupportedFormats().then(function (formats) {
          if (FORMATS.some(function (f) { return formats.indexOf(f) >= 0; })) return new Native({ formats: FORMATS });
          return null;
        }, function () { return null; });
      }
      return null;
    }).then(function (d) {
      if (d) return d;
      return import(PONYFILL).then(function (m) { return new m.BarcodeDetector({ formats: FORMATS }); });
    });
    detectorPromise.catch(function () { detectorPromise = null; });
    return detectorPromise;
  }

  /**
   * Point the rear camera at `video` and call `onCode(code)` once with the
   * first valid barcode seen. Resolves to a stop() function; rejects if the
   * camera cannot be opened (no camera, permission refused, insecure page).
   */
  function startCamera(video, onCode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('This browser cannot open the camera here.'));
    }
    var stream = null, stopped = false, timer = null;
    function stop() {
      stopped = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      try { video.srcObject = null; } catch (e) { /* ignore */ }
    }
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    }).then(function (s) {
      stream = s;
      if (stopped) { stop(); return stop; }
      video.srcObject = s;
      video.setAttribute('playsinline', '');
      video.muted = true;
      return Promise.resolve(video.play()).catch(function () { /* autoplay quirks: frames still arrive */ })
        .then(function () { return detector(); })
        .then(function (d) {
          // A few reads a second is plenty and keeps phones cool.
          (function tick() {
            if (stopped) return;
            Promise.resolve(video.readyState >= 2 ? d.detect(video) : []).then(function (codes) {
              var hit = (codes || []).map(function (c) { return c.rawValue; }).filter(validCode)[0];
              if (hit && !stopped) { stop(); onCode(hit); return; }
              timer = setTimeout(tick, 250);
            }, function () { timer = setTimeout(tick, 500); });
          })();
          return stop;
        });
    }, function (err) {
      var name = err && err.name;
      throw new Error(name === 'NotAllowedError'
        ? 'Camera permission was refused. You can type the barcode number instead.'
        : name === 'NotFoundError'
          ? 'No camera was found. You can type the barcode number instead.'
          : 'The camera could not be opened. You can type the barcode number instead.');
    });
  }

  // ---- Open Food Facts ---------------------------------------------------------

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(CACHE) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveCache(c) {
    var keys = Object.keys(c);
    if (keys.length > CACHE_MAX) {
      keys.sort(function (a, b) { return (c[a].seen || 0) - (c[b].seen || 0); })
        .slice(0, keys.length - CACHE_MAX).forEach(function (k) { delete c[k]; });
    }
    try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch (e) { /* ignore */ }
  }

  function n(v) { v = Number(v); return isFinite(v) && v >= 0 ? v : null; }

  /** An Open Food Facts product as Food Log's shape. Exported for tests. */
  function fromOff(code, p) {
    var nm = p.nutriments || {};
    var kcal = n(nm['energy-kcal_100g']);
    if (kcal == null && n(nm.energy_100g) != null) kcal = Math.round(nm.energy_100g / 4.184);
    var sodium = n(nm.sodium_100g) != null ? nm.sodium_100g * 1000
      : n(nm.salt_100g) != null ? nm.salt_100g * 400 : null;   // salt is 40% sodium
    var per100 = {
      kcal: kcal, protein: n(nm.proteins_100g), carbs: n(nm.carbohydrates_100g), fat: n(nm.fat_100g),
      fiber: n(nm.fiber_100g), sugar: n(nm.sugars_100g), satfat: n(nm['saturated-fat_100g']),
      sodium: sodium != null ? Math.round(sodium * 10) / 10 : null
    };
    Object.keys(per100).forEach(function (k) { if (per100[k] == null) delete per100[k]; });
    function keys(tags) {
      var out = [];
      (tags || []).forEach(function (t) { (ALLERGEN_TAGS[t] || []).forEach(function (k) { if (out.indexOf(k) < 0) out.push(k); }); });
      return out;
    }
    function words(tags) {
      return (tags || []).map(function (t) { return String(t).replace(/^[a-z]{2}:/, '').replace(/-/g, ' '); });
    }
    var analysis = p.ingredients_analysis_tags || [];
    function status(yes, no) {
      if (analysis.indexOf(yes) >= 0) return true;
      if (analysis.indexOf(no) >= 0) return false;
      return null;
    }
    var serving = n(p.serving_quantity);
    return {
      code: code,
      name: String(p.product_name || p.product_name_en || p.generic_name || 'Product ' + code).trim().slice(0, 100),
      brand: String(p.brands || '').split(',')[0].trim().slice(0, 60),
      per100: per100,
      hasEnergy: kcal != null,
      serving: serving && serving > 0 && serving < 2000 ? { label: String(p.serving_size || 'serving').slice(0, 40), grams: serving } : null,
      allergens: keys(p.allergens_tags), traces: keys(p.traces_tags),
      allergenWords: words(p.allergens_tags), traceWords: words(p.traces_tags),
      vegan: status('en:vegan', 'en:non-vegan'),
      vegetarian: status('en:vegetarian', 'en:non-vegetarian'),
      image: typeof p.image_front_small_url === 'string' && /^https:\/\/images\.openfoodfacts\.org\//.test(p.image_front_small_url)
        ? p.image_front_small_url : ''
    };
  }

  /**
   * Look a barcode up. Resolves to a product, or null when Open Food Facts
   * does not know it; rejects on a network failure.
   */
  function lookup(code) {
    code = String(code || '').replace(/\s+/g, '');
    var cache = loadCache();
    if (cache[code] && cache[code].product) {
      cache[code].seen = Date.now();
      saveCache(cache);
      return Promise.resolve(cache[code].product);
    }
    return fetch(API + encodeURIComponent(code) + '.json?fields=' + FIELDS).then(function (r) {
      if (r.status === 404) return { status: 0 };
      if (!r.ok) throw new Error('Open Food Facts answered ' + r.status + '. Try again in a moment.');
      return r.json();
    }, function () {
      throw new Error('Could not reach Open Food Facts. Check your connection.');
    }).then(function (d) {
      if (!d || d.status !== 1 || !d.product) return null;
      var product = fromOff(code, d.product);
      cache = loadCache();
      cache[code] = { product: product, seen: Date.now() };
      saveCache(cache);
      return product;
    });
  }

  /** A remembered product, for re-adding from recent foods without a lookup. */
  function cached(code) {
    var c = loadCache()[code];
    return c ? c.product : null;
  }

  /**
   * How a product sits with the person's dietary settings. Returns a list of
   * {level: 'stop'|'caution', text}. 'stop': the label lists something they
   * avoid; 'caution': "may contain" traces, or a diet the product data cannot
   * confirm. An empty list is NOT a safety claim.
   */
  function conflicts(product, prefs, labels) {
    var out = [], mine = prefs.allergens || [];
    labels = labels || function (k) { return k; };
    mine.forEach(function (a) {
      if (product.allergens.indexOf(a) >= 0) out.push({ level: 'stop', text: 'Contains ' + labels(a).toLowerCase() });
      else if (product.traces.indexOf(a) >= 0) out.push({ level: 'caution', text: 'May contain ' + labels(a).toLowerCase() });
    });
    var d = prefs.diet;
    if (d === 'vegan') {
      if (product.vegan === false) out.push({ level: 'stop', text: 'Not vegan' });
      else if (product.vegan !== true) out.push({ level: 'caution', text: 'Not confirmed vegan by the product data' });
    } else if (d === 'vegetarian') {
      if (product.vegetarian === false) out.push({ level: 'stop', text: 'Not vegetarian' });
      else if (product.vegetarian !== true) out.push({ level: 'caution', text: 'Not confirmed vegetarian by the product data' });
    } else if (d === 'pescatarian' && product.vegetarian === false) {
      out.push({ level: 'caution', text: 'Not vegetarian: check it contains no meat' });
    }
    var hay = (product.name + ' ' + product.brand).toLowerCase();
    String(prefs.customExclude || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean)
      .forEach(function (term) { if (hay.indexOf(term) >= 0) out.push({ level: 'stop', text: 'Matches “' + term + '”' }); });
    return out;
  }

  window.Barcode = {
    validCode: validCode, detector: detector, startCamera: startCamera,
    lookup: lookup, cached: cached, conflicts: conflicts, fromOff: fromOff,
    available: function () {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }
  };
})();
