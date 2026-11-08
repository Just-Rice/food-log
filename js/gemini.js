// Gemini client for the photo estimator, using the visitor's own API key.
//
// Everything runs in the browser. The key is stored in this device's
// localStorage under the same name Food is Medicine uses, so a key saved on
// either site works on both (they share an origin). It is sent to exactly one
// place -- Google's generativelanguage endpoint -- because these are static
// files on GitHub Pages with no server that could receive it. An API key in
// localStorage is readable by any script on the page and by anyone with access
// to the browser profile, so a shared computer is the wrong place to save one.
//
// Free keys come from Google AI Studio at https://aistudio.google.com/apikey.

(function () {
  'use strict';

  var KEY_STORE = 'fim.gemini.key';
  var MODEL_STORE = 'fim.gemini.model';
  var API = 'https://generativelanguage.googleapis.com/v1beta';

  // Only a fallback for the moment before the live model list arrives. The
  // actual choice is made by ranking whatever the API reports, so this file does
  // not go stale every time Google ships a generation.
  var DEFAULT_MODEL = 'gemini-2.5-flash';
  var AUTO = '__auto__';

  // Names that are not general chat models, whatever their version number.
  var EXCLUDE = /embedding|aqa|imagen|veo|image-generation|tts|audio|native-audio|live|vision|learnlm|gemma/i;

  /**
   * Score a model name so the newest and most capable sorts first.
   *
   * The ordering that matters is generation before tier: a new flash beats an
   * old pro, because a generation jump is usually worth more than a tier jump.
   * Within a generation, pro beats flash beats flash-lite. Stable is preferred
   * over preview or experimental only as a tie-break, so a newer preview still
   * outranks an older stable release -- which is what "newest" has to mean while
   * a generation is still rolling out.
   */
  function scoreModel(name) {
    var n = name.toLowerCase();
    if (EXCLUDE.test(n)) return -1;

    // Generation: "gemini-3-pro" -> 3, "gemini-2.5-flash" -> 2.5.
    var gen = 0;
    var m = /gemini-(\d+(?:\.\d+)?)/.exec(n);
    if (m) gen = parseFloat(m[1]);
    else if (/gemini-(pro|flash)/.test(n)) gen = 1;   // the original unversioned names

    var tier = 1;                       // unknown tier sits between lite and flash
    if (/flash-?lite/.test(n)) tier = 0;
    else if (/\bflash\b/.test(n)) tier = 2;
    else if (/\bpro\b/.test(n)) tier = 3;
    else if (/ultra/.test(n)) tier = 4;

    // Smaller distilled variants are less capable at the same tier. The
    // patterns are anchored deliberately: a bare /mini/ matches inside the word
    // "gemini" and would penalise every model equally.
    if (/-8b\b|-nano\b|-mini\b/.test(n)) tier -= 0.5;

    var stability = 2;
    if (/preview|-exp\b|experimental/.test(n)) stability = 1;
    if (/\d{3,}/.test(n.replace(/gemini-\d+(\.\d+)?/, ''))) stability -= 0.5;  // dated snapshots

    // Generation dominates, then tier, then stability.
    return gen * 1000 + tier * 10 + stability;
  }

  /** Best model from a list of names. */
  function pickBest(names) {
    var ranked = names
      .map(function (n) { return { name: n, score: scoreModel(n) }; })
      .filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score; });
    return ranked.length ? ranked[0].name : null;
  }

  function getKey() {
    try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
  }

  function setKey(k) {
    try {
      if (k) localStorage.setItem(KEY_STORE, k);
      else localStorage.removeItem(KEY_STORE);
    } catch (e) { /* private mode */ }
  }

  function hasKey() { return !!getKey(); }

  var resolvedAuto = null;   // best model discovered this session

  /** The stored preference: a specific model name, or AUTO. */
  function getPreference() {
    try { return localStorage.getItem(MODEL_STORE) || AUTO; }
    catch (e) { return AUTO; }
  }

  /** The model an actual request should use right now. */
  function getModel() {
    var pref = getPreference();
    if (pref && pref !== AUTO) return pref;
    return resolvedAuto || DEFAULT_MODEL;
  }

  function setModel(m) {
    try { localStorage.setItem(MODEL_STORE, m || AUTO); } catch (e) { /* ignore */ }
  }

  /**
   * Ask the API what exists and pick the best of it. Cached for the session so
   * this costs one request, not one per photo. Resolves to the chosen name.
   */
  function resolveAuto(force) {
    if (resolvedAuto && !force) return Promise.resolve(resolvedAuto);
    if (!hasKey()) return Promise.resolve(DEFAULT_MODEL);
    return listModels()
      .then(function (names) {
        var best = pickBest(names);
        if (best) resolvedAuto = best;
        return resolvedAuto || DEFAULT_MODEL;
      })
      .catch(function () { return DEFAULT_MODEL; });
  }

  /** Masked form of the key, for showing that one is stored without showing it. */
  function maskedKey() {
    var k = getKey();
    if (!k) return '';
    if (k.length <= 8) return '••••';
    return k.slice(0, 4) + '••••••••' + k.slice(-4);
  }

  /** Models this key can actually call, newest-sounding first. */
  function listModels() {
    var key = getKey();
    if (!key) return Promise.reject(new Error('No API key set.'));
    return withTimeout(fetch(API + '/models?key=' + encodeURIComponent(key)),
                       30000, 'Listing models timed out.')
      .then(readJson)
      .then(function (d) {
        return (d.models || [])
          .filter(function (m) {
            return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0;
          })
          .map(function (m) { return m.name.replace(/^models\//, ''); })
          .filter(function (n) { return n.indexOf('gemini') === 0; });
      });
  }

  /**
   * Reject if a request has not settled in time. Without this a stalled
   * connection leaves the UI sitting on "Thinking…" with nothing to click and
   * no way to find out what went wrong.
   */
  function withTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          var err = new Error(message);
          err.timeout = true;   // lets the model cascade move on to the next model
          reject(err);
        }
      }, ms);
      promise.then(function (v) {
        if (!done) { done = true; clearTimeout(timer); resolve(v); }
      }, function (e) {
        if (!done) { done = true; clearTimeout(timer); reject(e); }
      });
    });
  }

  function readJson(res) {
    return res.text().then(function (body) {
      var data;
      try { data = JSON.parse(body); } catch (e) { data = null; }
      if (!res.ok) {
        var msg = (data && data.error && data.error.message) || body || ('HTTP ' + res.status);
        var err = new Error(msg);
        err.status = res.status;
        // Quota failures say which quota (per day, per minute) in here.
        err.details = data && data.error && data.error.details;
        throw err;
      }
      return data || {};
    });
  }

  /**
   * Send one generateContent request with the stored key and model, and
   * resolve to the reply text.
   */
  /**
   * Send one generateContent request with the stored key and resolve to the
   * reply text. `opts.model` names the model (the photo cascade always does);
   * without it the stored or automatically chosen model is used.
   */
  function request(body, opts) {
    opts = opts || {};
    return Promise.resolve().then(function () {
      if (!getKey()) throw new Error('No API key set.');
      if (!opts.model && getPreference() === AUTO && !resolvedAuto) return resolveAuto();
    }).then(function () {
      return withTimeout(
        fetch(API + '/models/' + encodeURIComponent(opts.model || getModel()) +
              ':generateContent?key=' + encodeURIComponent(getKey()), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }), opts.timeout || 60000,
        'The request to Google timed out after ' + Math.round((opts.timeout || 60000) / 1000) +
        ' seconds.');
    })
      .then(readJson)
      .then(function (d) {
        var cand = (d.candidates || [])[0];
        if (!cand) {
          var blocked = d.promptFeedback && d.promptFeedback.blockReason;
          throw new Error(blocked
            ? 'The request was blocked by the model (' + blocked + ').'
            : 'The model returned no result.');
        }
        var parts = (cand.content && cand.content.parts) || [];
        var text = parts.map(function (p) { return p.text || ''; }).join('').trim();
        if (!text) {
          throw new Error(cand.finishReason === 'MAX_TOKENS'
            ? (opts.cutOff || 'The reply was cut off before any text arrived.')
            : 'The model returned an empty reply.');
        }
        return text;
      });
  }

  // The photo engine for a visitor's own key: same shape as FirebaseEngine.
  var engine = {
    name: 'key',
    call: function (model, prompt, base64, timeout) {
      return request({
        // A described meal has no picture: text alone.
        contents: [{ role: 'user', parts: (base64 ? [{ inline_data: { mime_type: 'image/jpeg', data: base64 } }] : [])
          .concat([{ text: prompt }]) }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 4096 }
      }, {
        model: model, timeout: timeout,
        cutOff: 'The reply was cut off. Try a photo with fewer separate foods.'
      });
    }
  };

  window.Gemini = {
    engine: engine,
    getKey: getKey, setKey: setKey, hasKey: hasKey, maskedKey: maskedKey,
    getModel: getModel, setModel: setModel, getPreference: getPreference,
    listModels: listModels, resolveAuto: resolveAuto,
    pickBest: pickBest, scoreModel: scoreModel,
    request: request,
    resolved: function () { return resolvedAuto; },
    AUTO: AUTO, DEFAULT_MODEL: DEFAULT_MODEL,
    STUDIO_URL: 'https://aistudio.google.com/apikey'
  };
})();
