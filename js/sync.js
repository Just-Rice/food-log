// Optional sync across devices: Google sign-in, and the log mirrored to
// Firestore in Food Log's Firebase project, one document per day at
// users/{uid}/days/{YYYY-MM-DD}. The security rules let a signed-in person
// read and write only their own documents.
//
// Off unless someone signs in. The copy on this device stays the main one:
// sync merges days with js/tracker.js's mergeDay (newest change wins, a
// deletion leaves a tombstone), so two devices converge without either
// losing work, and signing out leaves the local log exactly as it was.
//
// The backend is swappable (Sync.useBackend) so the merge logic can be tested
// without Firebase; the default one loads Firebase Auth and Firestore from
// gstatic on first use.

(function () {
  'use strict';

  var FLAG = 'foodlog.sync.v1';       // set while signed in, so start() knows to resume
  // The settings as last agreed with the account. Food is Medicine edits the
  // same profile and dietary settings without telling Food Log, so a change
  // is detected by comparing with this snapshot rather than by listening.
  var SETTINGS_SNAPSHOT = 'foodlog.sync.settings.v1';
  var PUSH_DELAY = 2000;               // edits are batched for this long before sending
  var C = window.FoodLogConfig || {};
  var Tracker = window.Tracker;

  var backend = null;
  var state = { status: 'off', user: null, lastSync: null, error: '' };
  var listeners = [];
  var cards = [];
  var unlisten = null;
  var pending = {};
  var timer = null;
  var hooked = false;
  var settingsHooked = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function flag(v) {
    try {
      if (v === undefined) return localStorage.getItem(FLAG) === '1';
      if (v) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG);
    } catch (e) { return false; }
    return v;
  }

  function set(patch) {
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { /* keep going */ } });
    renderCards();
  }

  function message(err) {
    var code = err && err.code || '';
    if (/popup-blocked/.test(code)) return 'The sign-in window was blocked. Allow pop-ups for this site and try again.';
    if (/popup-closed|cancelled-popup/.test(code)) return 'Sign-in was cancelled.';
    if (/network-request-failed|unavailable/.test(code)) return 'Could not reach Google. Check your connection; sync resumes when it is back.';
    if (/unauthorized-domain/.test(code)) return 'Sign-in is not enabled for this web address.';
    if (/permission-denied/.test(code)) return 'The sync service refused access to your data. Try signing out and in again.';
    return (err && err.message) || String(err);
  }

  // ---- the Firestore backend ------------------------------------------------

  function firestoreBackend() {
    var loading = null, ready = null, user = null;

    function load() {
      if (loading) return loading;
      var base = C.FIREBASE_SDK;
      loading = Promise.all([
        window.FirebaseEngine.app(),
        import(base + 'firebase-auth.js'),
        import(base + 'firebase-firestore.js')
      ]).then(function (m) {
        ready = { auth: m[1], fs: m[2], a: m[1].getAuth(m[0]), db: m[2].getFirestore(m[0]) };
        return ready;
      });
      loading.catch(function () { loading = null; });
      return loading;
    }

    function userOf(u) {
      user = u ? { uid: u.uid, name: u.displayName || '', email: u.email || '' } : null;
      return user;
    }

    function days(f, uid) { return f.fs.collection(f.db, 'users', uid, 'days'); }

    return {
      prepare: load,
      signIn: function () {
        // A popup must open in the click that asked for it, or browsers block
        // it -- so if the modules are already here, call straight through.
        var go = function (f) {
          return f.auth.signInWithPopup(f.a, new f.auth.GoogleAuthProvider())
            .then(function (cred) { return userOf(cred.user); });
        };
        return ready ? go(ready) : load().then(go);
      },
      signOut: function () {
        return load().then(function (f) { userOf(null); return f.auth.signOut(f.a); });
      },
      current: function () { return user; },
      onAuth: function (cb) {
        return load().then(function (f) {
          return f.auth.onAuthStateChanged(f.a, function (u) { cb(userOf(u)); });
        });
      },
      pullAll: function (uid) {
        return load().then(function (f) { return f.fs.getDocs(days(f, uid)); }).then(function (snap) {
          var out = {};
          snap.forEach(function (d) { out[d.id] = d.data(); });
          return out;
        });
      },
      push: function (uid, date, doc) {
        return load().then(function (f) { return f.fs.setDoc(f.fs.doc(f.db, 'users', uid, 'days', date), doc); });
      },
      pullSettings: function (uid) {
        return load().then(function (f) { return f.fs.getDoc(f.fs.doc(f.db, 'users', uid, 'settings', 'main')); })
          .then(function (d) { return d.exists() ? d.data() : null; });
      },
      pushSettings: function (uid, doc) {
        return load().then(function (f) { return f.fs.setDoc(f.fs.doc(f.db, 'users', uid, 'settings', 'main'), doc); });
      },
      pullLibrary: function (uid) {
        return load().then(function (f) { return f.fs.getDoc(f.fs.doc(f.db, 'users', uid, 'library', 'main')); })
          .then(function (d) { return d.exists() ? d.data() : null; });
      },
      pushLibrary: function (uid, doc) {
        return load().then(function (f) { return f.fs.setDoc(f.fs.doc(f.db, 'users', uid, 'library', 'main'), doc); });
      },
      listenLibrary: function (uid, cb, onError) {
        var stop = false, off = null;
        load().then(function (f) {
          if (stop) return;
          off = f.fs.onSnapshot(f.fs.doc(f.db, 'users', uid, 'library', 'main'), function (d) {
            if (d.exists() && !d.metadata.hasPendingWrites) cb(d.data());
          }, onError);
        });
        return function () { stop = true; if (off) off(); };
      },
      listenSettings: function (uid, cb, onError) {
        var stop = false, off = null;
        load().then(function (f) {
          if (stop) return;
          off = f.fs.onSnapshot(f.fs.doc(f.db, 'users', uid, 'settings', 'main'), function (d) {
            if (d.exists() && !d.metadata.hasPendingWrites) cb(d.data());
          }, onError);
        });
        return function () { stop = true; if (off) off(); };
      },
      listen: function (uid, cb, onError) {
        var stop = false, off = null;
        load().then(function (f) {
          if (stop) return;
          off = f.fs.onSnapshot(days(f, uid), function (snap) {
            snap.docChanges().forEach(function (ch) {
              // Our own writes echo back first as local snapshots; skip them.
              if (ch.type !== 'removed' && !ch.doc.metadata.hasPendingWrites) cb(ch.doc.id, ch.doc.data());
            });
          }, onError);
        });
        return function () { stop = true; if (off) off(); };
      }
    };
  }

  function getBackend() {
    if (!backend) backend = firestoreBackend();
    return backend;
  }

  // ---- syncing ----------------------------------------------------------------

  function hookTracker() {
    if (hooked) return;
    hooked = true;
    Tracker.onChange(function (dates, info) {
      // Changes that came from another device are not sent back.
      if (!state.user || (info && info.remote) || !dates) return;
      dates.forEach(function (d) { pending[d] = true; });
      clearTimeout(timer);
      timer = setTimeout(flush, PUSH_DELAY);
    });
  }

  /** Send every day changed here since the last send. */
  function flush() {
    clearTimeout(timer);
    timer = null;
    var user = state.user, dates = Object.keys(pending);
    pending = {};
    if (!user || !dates.length) return Promise.resolve();
    return Promise.all(dates.map(function (d) {
      return getBackend().push(user.uid, d, Tracker.dayDoc(d));
    })).then(function () {
      set({ lastSync: Date.now(), error: '', status: 'on' });
    }, function (err) {
      // Keep them for the next attempt.
      dates.forEach(function (d) { pending[d] = true; });
      set({ status: 'error', error: message(err) });
    });
  }

  // ---- settings: profile and dietary settings --------------------------------
  // Synced: the profile (age, sex, height, weight, activity) and the dietary
  // settings. Never synced: the Gemini key, theme, photo engine choice and the
  // on-device model -- they belong to the device, and a key must not leave it.

  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
        .map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }

  function localSettings() {
    var P = window.Prefs, prof = window.Profile && window.Profile.get();
    var p = P ? P.get() : {};
    return {
      profile: prof ? JSON.parse(JSON.stringify(prof)) : null,
      diet: { diet: p.diet || 'none', allergens: (p.allergens || []).slice().sort(), customExclude: p.customExclude || '' }
    };
  }

  function isEmptySettings(s) {
    return !s.profile && s.diet.diet === 'none' && !s.diet.allergens.length && !s.diet.customExclude;
  }

  function snapshot(v) {
    try {
      if (v === undefined) { var raw = localStorage.getItem(SETTINGS_SNAPSHOT); return raw ? JSON.parse(raw) : null; }
      if (v) localStorage.setItem(SETTINGS_SNAPSHOT, JSON.stringify(v)); else localStorage.removeItem(SETTINGS_SNAPSHOT);
    } catch (e) { return null; }
    return v;
  }

  /** Make this device's settings what the account says, through the normal setters. */
  function applySettings(r) {
    var P = window.Prefs, Prof = window.Profile;
    if (Prof) {
      if (r.profile && Prof.valid(r.profile)) Prof.save(r.profile);
      else if (!r.profile && Prof.get()) Prof.clear();
    }
    if (P && r.diet) {
      if (P.get('diet') !== r.diet.diet) P.set('diet', r.diet.diet);
      if (canon((P.get('allergens') || []).slice().sort()) !== canon(r.diet.allergens || [])) P.set('allergens', (r.diet.allergens || []).slice());
      if ((P.get('customExclude') || '') !== (r.diet.customExclude || '')) P.set('customExclude', r.diet.customExclude || '');
    }
  }

  function readRemoteSettings(doc) {
    if (!doc || typeof doc !== 'object') return null;
    var d = doc.diet || {};
    var allergens = Array.isArray(d.allergens) ? d.allergens.filter(function (a) {
      return window.Prefs && window.Prefs.ALLERGENS.indexOf(a) >= 0;
    }).sort() : [];
    return {
      profile: doc.profile && window.Profile && window.Profile.valid(doc.profile) ? doc.profile : null,
      diet: {
        diet: window.Prefs && window.Prefs.DIETS.indexOf(d.diet) >= 0 ? d.diet : 'none',
        allergens: allergens,
        customExclude: typeof d.customExclude === 'string' ? d.customExclude.slice(0, 300) : ''
      }
    };
  }

  var settingsBusy = false;

  /**
   * Reconcile this device's settings with the account's copy `remoteDoc`
   * (null if the account has none). Whichever side moved since the last
   * agreed snapshot wins; if both did, the edit made on this device wins,
   * since someone is using it. First time on a device: the account's copy
   * wins unless this device has settings and the account has none.
   */
  function syncSettings(remoteDoc) {
    var b = getBackend(), user = state.user;
    if (!user || !b.pushSettings) return Promise.resolve();
    var local = localSettings(), remote = readRemoteSettings(remoteDoc), snap = snapshot();
    var L = canon(local), R = remote && canon(remote), S = snap && canon(snap);
    var push = false, apply = false;
    if (!remote) push = !isEmptySettings(local) || !!snap;
    else if (!snap) { if (R !== L) { if (isEmptySettings(remote) && !isEmptySettings(local)) push = true; else apply = true; } }
    else if (L !== S && R === S) push = true;
    else if (R !== S && L === S) apply = true;
    else if (L !== S && R !== S && L !== R) push = true;
    if (apply) {
      settingsBusy = true;
      try { applySettings(remote); } finally { settingsBusy = false; }
      snapshot(localSettings());
      return Promise.resolve();
    }
    if (push) {
      var doc = localSettings();
      doc.updatedAt = Date.now();
      return b.pushSettings(user.uid, doc).then(function () {
        snapshot(localSettings());
      });
    }
    if (remote) snapshot(local);
    return Promise.resolve();
  }

  var settingsTimer = null;
  function hookSettings() {
    function changed() {
      if (!state.user || settingsBusy) return;
      clearTimeout(settingsTimer);
      settingsTimer = setTimeout(function () {
        var b = getBackend();
        if (!b.pullSettings) return;
        b.pullSettings(state.user.uid).then(syncSettings).catch(function (err) {
          set({ status: 'error', error: message(err) });
        });
      }, PUSH_DELAY);
    }
    if (window.Prefs && window.Prefs.onChange) window.Prefs.onChange(changed);
    if (window.Profile && window.Profile.onChange) window.Profile.onChange(changed);
  }

  // ---- saved meals and recipes ------------------------------------------------

  /** Merge the account's library here, then send back whatever it lacks. */
  function syncLibrary(remoteDoc) {
    var b = getBackend(), user = state.user, L = window.Library;
    if (!user || !L || !b.pushLibrary) return Promise.resolve();
    if (remoteDoc) L.merge(remoteDoc);
    if (remoteDoc && L.same(remoteDoc)) return Promise.resolve();
    var empty = !L.meals().length && !L.recipes().length && !Object.keys(L.doc().deleted).length;
    if (!remoteDoc && empty) return Promise.resolve();
    return b.pushLibrary(user.uid, L.doc());
  }

  var libraryTimer = null;
  function hookLibrary() {
    if (!window.Library) return;
    window.Library.onChange(function (info) {
      if (!state.user || (info && info.remote)) return;
      clearTimeout(libraryTimer);
      libraryTimer = setTimeout(function () {
        getBackend().pushLibrary(state.user.uid, window.Library.doc()).then(function () {
          set({ lastSync: Date.now(), status: 'on', error: '' });
        }, function (err) { set({ status: 'error', error: message(err) }); });
      }, PUSH_DELAY);
    });
  }

  /**
   * First contact after signing in: merge every day the account holds into
   * this device, send back every day the account lacks or holds differently,
   * then listen for changes from other devices.
   */
  function connect(user) {
    hookTracker();
    if (!settingsHooked) { settingsHooked = true; hookSettings(); hookLibrary(); }
    set({ user: user, status: 'syncing', error: '' });
    var b = getBackend();
    var settingsDone = (b.pullSettings ? b.pullSettings(user.uid).then(syncSettings) : Promise.resolve())
      .then(function () { return b.pullLibrary ? b.pullLibrary(user.uid).then(syncLibrary) : null; });
    return settingsDone.then(function () { return b.pullAll(user.uid); }).then(function (remote) {
      Tracker.mergeDays(remote);
      var send = Tracker.allDates().filter(function (d) {
        return !remote[d] || !Tracker.sameDay(d, remote[d]);
      });
      return Promise.all(send.map(function (d) { return b.push(user.uid, d, Tracker.dayDoc(d)); }));
    }).then(function () {
      if (unlisten) unlisten();
      var offDays = b.listen(user.uid, function (date, doc) {
        Tracker.mergeDay(date, doc);
        set({ lastSync: Date.now() });
      }, function (err) { set({ status: 'error', error: message(err) }); });
      var offSettings = b.listenSettings ? b.listenSettings(user.uid, function (doc) {
        syncSettings(doc).catch(function (err) { set({ status: 'error', error: message(err) }); });
      }, function (err) { set({ status: 'error', error: message(err) }); }) : null;
      var offLibrary = b.listenLibrary ? b.listenLibrary(user.uid, function (doc) {
        if (window.Library) window.Library.merge(doc);
        set({ lastSync: Date.now() });
      }, function (err) { set({ status: 'error', error: message(err) }); }) : null;
      unlisten = function () { offDays(); if (offSettings) offSettings(); if (offLibrary) offLibrary(); };
      set({ status: 'on', lastSync: Date.now() });
    }).catch(function (err) {
      set({ status: 'error', error: message(err) });
    });
  }

  function signIn() {
    set({ status: 'signing-in', error: '' });
    return getBackend().signIn().then(function (user) {
      flag(true);
      return connect(user);
    }, function (err) {
      set({ status: state.user ? 'on' : 'off', error: message(err) });
    });
  }

  function signOut() {
    if (unlisten) { unlisten(); unlisten = null; }
    clearTimeout(timer);
    pending = {};
    flag(false);
    snapshot(null);
    set({ status: 'off', user: null, error: '' });
    return getBackend().signOut().catch(function () { /* already signed out */ });
  }

  /**
   * Resume a session this browser signed in before. Does nothing -- and loads
   * nothing -- for someone who never turned sync on.
   */
  function start() {
    if (!flag() || state.user) return Promise.resolve();
    set({ status: 'syncing' });
    return getBackend().onAuth(function (user) {
      if (user && !state.user) connect(user);
      else if (!user) { flag(false); set({ status: 'off', user: null }); }
    }).catch(function (err) { set({ status: 'error', error: message(err) }); });
  }

  // ---- the Settings card ------------------------------------------------------

  function when(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  function cardHtml() {
    var s = state, who = s.user ? (s.user.name ? s.user.name + ' (' + s.user.email + ')' : s.user.email) : '';
    var line = '';
    if (s.status === 'signing-in') line = 'Signing in…';
    else if (s.status === 'syncing') line = s.user ? 'Signed in as ' + who + '. Syncing…' : 'Reconnecting…';
    else if (s.user) line = 'Signed in as ' + who + '.' + (s.lastSync ? ' Last synced at ' + when(s.lastSync) + '.' : '');
    return '<h2>Sync across devices</h2>' +
      '<p class="hint">Optional. Sign in with Google to keep the same log, saved meals and recipes, ' +
      'profile (age, sex, height, weight, activity) and dietary settings on your phone and computer. They are then also stored in ' +
      'Food Log’s Firebase project on Google Cloud, readable only by your signed-in account. Your Gemini ' +
      'key never leaves this device. The copy here stays the main one, and signing out leaves it as it ' +
      'is.</p>' +
      (line ? '<p>' + esc(line) + '</p>' : '') +
      (s.error ? '<div class="note danger"><p>' + esc(s.error) + '</p></div>' : '') +
      '<div class="btn-row">' + (s.user
        ? '<button class="btn ghost" type="button" data-sync="out">Sign out</button>'
        : '<button class="btn" type="button" data-sync="in"' +
          (s.status === 'signing-in' ? ' disabled' : '') + '>Sign in with Google</button>') +
      '</div>';
  }

  function renderCards() {
    cards = cards.filter(function (el) { return el.isConnected; });
    cards.forEach(function (el) {
      el.innerHTML = cardHtml();
      var b = el.querySelector('[data-sync]');
      if (b) b.addEventListener('click', function () {
        if (b.dataset.sync === 'in') signIn(); else signOut();
      });
    });
  }

  function mountCard(el) {
    if (!el) return;
    if (cards.indexOf(el) < 0) cards.push(el);
    renderCards();
    // Load Firebase now, so the sign-in click can open its popup at once.
    var b = getBackend();
    if (b.prepare && !state.user) {
      b.prepare().catch(function (err) {
        set({ error: 'The sync service could not be loaded: ' + message(err) });
      });
    }
  }

  window.Sync = {
    available: function () { return !!(window.FirebaseEngine && C.FIREBASE && Tracker && Tracker.mergeDay); },
    start: start, signIn: signIn, signOut: signOut, flush: flush,
    useBackend: function (b) { backend = b; },
    state: function () { return state; },
    onChange: function (fn) { listeners.push(fn); },
    mountCard: mountCard
  };
})();
