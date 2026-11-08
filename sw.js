// Food Log service worker: lets the installed app open, search and log with no
// connection. Registered by js/pwa.js; it sits at the site root so its scope
// is the whole of /food-log/.
//
// What it does with each kind of request:
//   app code (pages, js, css, manifest, icons)   network first, cache fallback
//   Food is Medicine's data files and photos     cached copy now, refresh behind
//   pinned library versions (Firebase, jsDelivr) cache first
//   everything else                              left to the browser
//
// "Everything else" covers the photo and barcode APIs, Firebase, reCAPTCHA and
// the on-device model's files from huggingface.co. Those are live calls or,
// for the model, ~3 GB that Transformers.js already keeps in its own cache
// ("transformers-cache"); a second copy here would only eat the quota.

'use strict';

// Bump only when the caching scheme changes (cache names, what goes where). A
// deploy of the app needs no bump: app code is fetched network-first, so the
// next online visit gets all of the new version and the cache follows it.
var VERSION = '1';
var APP = 'food-log-app-v' + VERSION;
var DATA = 'food-log-data-v' + VERSION;
var LIBS = 'food-log-libs-v' + VERSION;
// Cache Storage is shared by every site on just-rice.github.io, and holds the
// downloaded model, so only ever clean up caches with this prefix.
var OURS = /^food-log-/;

var SCOPE = self.registration.scope;
var FIM = new URL('../food-is-medicine/', SCOPE).href;
var FIM_DATA = /^data\/[^/?#]+\.js(\?|$)/;
var FIM_IMG = /^img\//;

// A URL with an exact version never changes, so the cached copy is the copy.
// "@4" or "@latest" can move under us and is left to the browser.
var PINNED = [
  /^https:\/\/www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+\//,
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@[^/@]+\/)?[^/@]+@\d+\.\d+\.\d+(-[\w.]+)?(\/|$)/
];

// Enough to start offline after a single visit. Install also adds whatever
// index.html links to, so a script added there later is not missed when this
// list falls behind.
var SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/prefs.js',
  'js/profile.js',
  'js/tracker.js',
  'js/config.js',
  'js/cascade.js',
  'js/gemini.js',
  'js/photo.js',
  'js/firebase.js',
  'js/sync.js',
  'js/local-model.js',
  'js/library.js',
  'js/gaps.js',
  'js/csv.js',
  'js/barcode.js',
  'js/pwa.js',
  'js/app.js',
  'js/local-worker.js', // started by local-model.js, not linked from the page
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  '../food-is-medicine/data/foods.js',
  '../food-is-medicine/data/images.js',
  '../food-is-medicine/data/dri.js'
];

function abs(path) { return new URL(path, SCOPE).href; }

function isFim(url, re) { return url.indexOf(FIM) === 0 && re.test(url.slice(FIM.length)); }

function isPinned(url) { return PINNED.some(function (re) { return re.test(url); }); }

function cacheFor(url) {
  if (isFim(url, FIM_DATA) || isFim(url, FIM_IMG)) return DATA;
  if (isPinned(url)) return LIBS;
  return APP;
}

// Same-origin scripts, styles, icons and the manifest that the page links to.
function linkedFrom(html) {
  var out = [];
  var re = /\s(?:src|href)="([^"#:]+\.(?:js|css|png|webmanifest)(?:\?[^"#]*)?)"/g;
  var m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    fetch(abs('index.html'))
      .then(function (res) { return res.ok ? res.text() : ''; })
      .catch(function () { return ''; })
      .then(function (html) {
        var urls = SHELL.concat(linkedFrom(html)).map(abs).filter(function (u, i, all) {
          return all.indexOf(u) === i;
        });
        // One at a time rather than cache.addAll: a single missing file
        // should cost that file, not the whole offline copy.
        return Promise.all(urls.map(function (u) {
          return caches.open(cacheFor(u))
            .then(function (c) { return c.add(u); })
            .catch(function () { /* fetched and cached on a later visit */ });
        }));
      })
  );
});

self.addEventListener('activate', function (event) {
  var current = [APP, DATA, LIBS];
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) {
        return OURS.test(n) && current.indexOf(n) < 0;
      }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  // Uploads and API posts, and range requests (media, large model files),
  // go straight to the network. The last test avoids a Chrome DevTools quirk
  // that otherwise throws inside fetch().
  if (req.method !== 'GET' || req.headers.has('range')) return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;

  var url = req.url;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(event, APP, shellFallback));
  } else if (isFim(url, FIM_DATA) || isFim(url, FIM_IMG)) {
    event.respondWith(staleWhileRevalidate(event, DATA));
  } else if (url.indexOf(SCOPE) === 0) {
    event.respondWith(networkFirst(event, APP));
  } else if (isPinned(url)) {
    event.respondWith(cacheFirst(event, LIBS));
  }
  // Anything else: no respondWith, so the browser handles it as if this
  // worker were not here.
});

// Store a good response without making the page wait for the write. Errors,
// redirects and opaque responses are never kept.
function keep(event, name, req, res) {
  if (res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
    var copy = res.clone();
    event.waitUntil(caches.open(name)
      .then(function (c) { return c.put(req, copy); })
      .catch(function () { /* over quota: serve it, just don't keep it */ }));
  }
  return res;
}

function fromCache(name, req, options) {
  return caches.open(name).then(function (c) { return c.match(req, options); });
}

// The network when it answers, so code never mixes two deploys; the last copy
// that loaded when it does not.
function networkFirst(event, name, fallback) {
  var req = event.request;
  return fetch(req).then(function (res) {
    return keep(event, name, req, res);
  }).catch(function (err) {
    return fromCache(name, req).then(function (hit) {
      if (hit) return hit;
      if (fallback) return fallback(req);
      throw err;
    });
  });
}

// Offline, any page in scope opens the app; its router reads the #hash.
function shellFallback(req) {
  return fromCache(APP, req, { ignoreSearch: true })
    .then(function (hit) { return hit || fromCache(APP, abs('index.html')); })
    .then(function (hit) { return hit || fromCache(APP, abs('./')); });
}

// The food list and photos are large and change rarely: answer from the
// cache at once and fetch a fresh copy for next time.
function staleWhileRevalidate(event, name) {
  var req = event.request;
  return fromCache(name, req).then(function (hit) {
    var fresh = fetch(req).then(function (res) { return keep(event, name, req, res); });
    if (!hit) return fresh;
    event.waitUntil(fresh.catch(function () { /* offline: the cached copy stands */ }));
    return hit;
  });
}

function cacheFirst(event, name) {
  var req = event.request;
  return fromCache(name, req).then(function (hit) {
    return hit || fetch(req).then(function (res) { return keep(event, name, req, res); });
  });
}
