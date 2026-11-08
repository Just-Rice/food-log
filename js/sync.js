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

  /**
   * First contact after signing in: merge every day the account holds into
   * this device, send back every day the account lacks or holds differently,
   * then listen for changes from other devices.
   */
  function connect(user) {
    hookTracker();
    set({ user: user, status: 'syncing', error: '' });
    var b = getBackend();
    return b.pullAll(user.uid).then(function (remote) {
      Tracker.mergeDays(remote);
      var send = Tracker.allDates().filter(function (d) {
        return !remote[d] || !Tracker.sameDay(d, remote[d]);
      });
      return Promise.all(send.map(function (d) { return b.push(user.uid, d, Tracker.dayDoc(d)); }));
    }).then(function () {
      if (unlisten) unlisten();
      unlisten = b.listen(user.uid, function (date, doc) {
        Tracker.mergeDay(date, doc);
        set({ lastSync: Date.now() });
      }, function (err) { set({ status: 'error', error: message(err) }); });
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
      '<p class="hint">Optional. Sign in with Google to keep the same log on your phone and computer. ' +
      'Your log is then also stored in Food Log’s Firebase project on Google Cloud, readable only by ' +
      'your signed-in account. The copy on this device stays the main one, and signing out leaves it ' +
      'as it is.</p>' +
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
