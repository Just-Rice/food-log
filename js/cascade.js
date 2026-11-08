// Try the free Gemini models in order until one answers.
//
// Every model has its own free daily allowance, and the newest are often
// overloaded. So a photo goes to the first model in FoodLogConfig.MODELS
// that is not known to be used up today:
//   - 429 / RESOURCE_EXHAUSTED: Google's error details say which quota.
//       per day      -> that model is spent: remember it until Google's daily
//                       reset (midnight Pacific time) and move on;
//       per minute   -> move on (the next model has its own per-minute limit);
//       per user     -> the visitor's own rate limit on Food Log's project:
//                       stop and ask them to wait, since every model shares it;
//       unknown      -> treat as spent for an hour and move on.
//   - 503 / UNAVAILABLE ("high demand"): retry once after a pause, then move on.
//   - a timeout, or 400 / 403 / 404 (model refused or retired): move on.
//   - anything else (offline, App Check rejected the browser) is not about
//     the model, so it stops the cascade and is reported as it is.
// Spent models are remembered per engine, because the free Food Log project
// and a visitor's own key have separate allowances.

(function () {
  'use strict';

  var STORE = 'foodlog.spent.v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { return {}; }
  }
  function save(d) {
    try { localStorage.setItem(STORE, JSON.stringify(d)); } catch (e) { /* ignore */ }
  }

  /** Milliseconds until the next midnight in America/Los_Angeles. */
  function msToPacificMidnight(now) {
    now = now || new Date();
    var parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hour12: false,
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(now).forEach(function (p) { parts[p.type] = Number(p.value); });
    var elapsed = ((parts.hour % 24) * 3600 + parts.minute * 60 + parts.second) * 1000 + now.getMilliseconds();
    return 86400000 - elapsed;
  }

  function key(engine, model) { return engine + ':' + model; }

  function isSpent(engine, model, now) {
    var d = load(), until = d[key(engine, model)];
    return !!until && until > (now || Date.now());
  }

  function markSpent(engine, model, now, forMs) {
    var d = load(), t = now || Date.now();
    // Drop expired entries while here.
    Object.keys(d).forEach(function (k) { if (d[k] <= t) delete d[k]; });
    d[key(engine, model)] = t + (forMs || msToPacificMidnight(new Date(t)));
    save(d);
  }

  function timeoutFor(model) {
    // Flash-Lite answers in seconds; Flash queues for minutes when busy.
    return /lite/.test(model) ? 45000 : 180000;
  }

  /** Everything an error says about which quota it hit. */
  function quotaText(err) {
    var details = err && (err.details || (err.cause && err.cause.customErrorData &&
      err.cause.customErrorData.errorDetails));
    try { return String(err && err.message || '') + ' ' + JSON.stringify(details || ''); }
    catch (e) { return String(err && err.message || ''); }
  }

  /** 'spent' | 'spentHour' | 'rate' | 'busy' | 'skip' | 'fatal' */
  function classify(err) {
    var s = err && err.status;
    var m = String(err && err.message || '');
    if (s === 429 || /RESOURCE_EXHAUSTED|quota/i.test(m)) {
      var q = quotaText(err);
      if (/per.?user|PerUser/i.test(q) || err.code === 'RATE_LIMITED') return 'rate';
      if (/per.?day|PerDay|daily/i.test(q)) return 'spent';
      if (/per.?minute|PerMinute/i.test(q)) return 'skip';
      return 'spentHour';
    }
    if (s === 503 || /UNAVAILABLE|overloaded|high demand/i.test(m)) return 'busy';
    if (err && err.timeout) return 'skip';
    if (s === 400 || s === 403 || s === 404 || /NOT_FOUND|not found|not supported|PERMISSION_DENIED/i.test(m)) return 'skip';
    return 'fatal';
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /**
   * Run `call(model, timeoutMs)` -> Promise<text> down the model list.
   * opts: {engine: 'free'|'key', only: 'model-id' (try just this one),
   *        models: [...] (override the list), retryDelay: ms}
   * Resolves to {text, model}. Rejects with the last error; err.code is
   * 'ALL_SPENT' when every model was out of quota for today.
   */
  function run(call, opts) {
    opts = opts || {};
    var engine = opts.engine || 'free';
    var list = opts.only ? [opts.only] : (opts.models || window.FoodLogConfig.MODELS).slice();
    var retryDelay = opts.retryDelay == null ? 3000 : opts.retryDelay;
    var spentCount = 0;
    var lastErr = null;

    function attempt(i, retried) {
      if (i >= list.length) {
        var err = lastErr || new Error('No model is available.');
        if (spentCount === list.length) {
          err = new Error('Today’s free photo estimates are used up for every model. They reset at ' +
            'midnight Pacific time.');
          err.code = 'ALL_SPENT';
        }
        return Promise.reject(err);
      }
      var model = list[i];
      if (!opts.only && isSpent(engine, model)) { spentCount++; return attempt(i + 1, false); }
      return call(model, timeoutFor(model)).then(function (text) {
        return { text: text, model: model };
      }, function (err) {
        lastErr = err;
        var kind = classify(err);
        if (kind === 'spent') { markSpent(engine, model); spentCount++; return attempt(i + 1, false); }
        if (kind === 'spentHour') { markSpent(engine, model, null, 3600000); spentCount++; return attempt(i + 1, false); }
        if (kind === 'rate') {
          var e = new Error('Too many photos in the last minute. Wait a moment and try again.');
          e.code = 'RATE_LIMITED';
          throw e;
        }
        if (kind === 'busy' && !retried) return wait(retryDelay).then(function () { return attempt(i, true); });
        if (kind === 'busy' || kind === 'skip') return attempt(i + 1, false);
        throw err;
      });
    }
    return attempt(0, false);
  }

  /** Reject if `promise` has not settled within `ms`; the error has .timeout. */
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () {
        if (done) return;
        done = true;
        var e = new Error('The model took longer than ' + Math.round(ms / 1000) + ' seconds.');
        e.timeout = true;
        reject(e);
      }, ms);
      promise.then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
                   function (e) { if (!done) { done = true; clearTimeout(t); reject(e); } });
    });
  }

  window.Cascade = {
    run: run, classify: classify, isSpent: isSpent, markSpent: markSpent,
    msToPacificMidnight: msToPacificMidnight, timeoutFor: timeoutFor, withTimeout: withTimeout,
    clear: function () { save({}); }
  };
})();
