// Free photo estimates through Food Log's own Firebase project: Gemini via
// Firebase AI Logic, so visitors need no API key.
//
// The Firebase SDK is loaded from gstatic only when it is first needed (a
// photo, or signing in to sync), so the rest of the site stays light. App
// Check with reCAPTCHA Enterprise vouches that requests come from this site,
// and each request uses a limited-use (one-time) App Check token, so a token
// lifted from the page cannot be replayed. The project's own limits still
// apply: a few requests a minute per visitor, and each model's free daily
// allowance shared by every visitor -- which is why js/cascade.js moves down
// the model list when one runs out.

(function () {
  'use strict';

  var C = window.FoodLogConfig || {};
  var appPromise = null;
  var aiPromise = null;

  /** The Firebase app with App Check, shared by the AI engine and sync. */
  function app() {
    if (appPromise) return appPromise;
    var base = C.FIREBASE_SDK;
    appPromise = Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-app-check.js')
    ]).then(function (m) {
      var appMod = m[0], ac = m[1];
      var a = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(C.FIREBASE);
      ac.initializeAppCheck(a, {
        provider: new ac.ReCaptchaEnterpriseProvider(C.RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true
      });
      return a;
    });
    appPromise.catch(function () { appPromise = null; });
    return appPromise;
  }

  function ai() {
    if (aiPromise) return aiPromise;
    aiPromise = Promise.all([app(), import(C.FIREBASE_SDK + 'firebase-ai.js')]).then(function (m) {
      var mod = m[1];
      return {
        mod: mod,
        ai: mod.getAI(m[0], { backend: new mod.GoogleAIBackend(), useLimitedUseAppCheckTokens: true })
      };
    });
    aiPromise.catch(function () { aiPromise = null; });
    return aiPromise;
  }

  /**
   * Give an SDK error the shape js/cascade.js understands: .status for HTTP
   * failures, and a message a person can act on for the ones that stop.
   */
  function normalise(err) {
    if (err && err.timeout) return err;
    var data = err && err.customErrorData;
    var status = data && data.status;
    var msg = String(err && err.message || err);
    if (!status) {
      var m = /\[(\d{3})\b/.exec(msg);
      if (m) status = Number(m[1]);
    }
    var out;
    if (/app.?check|recaptcha|attestation/i.test(msg) || status === 401) {
      out = new Error('Food Log’s free photo service could not confirm this browser (App Check). ' +
        'Reloading usually fixes it; a privacy extension blocking reCAPTCHA can also cause it.');
    } else if (/Failed to fetch|NetworkError|network/i.test(msg) && !status) {
      out = new Error('Could not reach Food Log’s free photo service. Check your connection.');
    } else {
      out = new Error(msg);
    }
    // App Check and network failures are not about the model: no status, so
    // the cascade stops at once instead of failing the same way on each model.
    out.status = out.message === msg ? status : undefined;
    out.cause = err;
    return out;
  }

  var engine = {
    name: 'free',
    call: function (model, prompt, base64, timeout) {
      return ai().then(function (f) {
        var gm = f.mod.getGenerativeModel(f.ai, {
          model: model,
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 4096 }
        });
        return window.Cascade.withTimeout(
          gm.generateContent([{ inlineData: { mimeType: 'image/jpeg', data: base64 } }, prompt]),
          timeout);
      }).then(function (res) {
        var text = res.response.text();
        if (!text) throw new Error('The model returned an empty reply.');
        return text;
      }).catch(function (err) { throw normalise(err); });
    }
  };

  window.FirebaseEngine = {
    engine: engine,
    app: app,
    available: function () { return !!(C.FIREBASE && C.FIREBASE.apiKey); },
    normalise: normalise
  };
})();
