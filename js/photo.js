// Meal photo -> list of foods and portion weights, via the visitor's own
// Gemini key (the same one Food is Medicine's recipe page uses).
//
// The model is asked what is on the plate and roughly how much of each thing,
// not for a calorie count. The calories are then worked out in app.js from the
// USDA figures in Food is Medicine's data, because a language model produces
// plausible nutrition numbers rather than correct ones. What the model genuinely adds is recognising "a ladle of dal
// and two rotis" in a picture. Its own energy-density guess is kept only as a
// fallback for dishes with no USDA counterpart here, and as a cross-check that
// catches a bad match (raw rice for cooked rice is nearly three times the
// energy).
//
// Portion weight from a single photo is the weak link -- there is no depth in
// a picture -- so every item comes back as a range, and the page says so. The
// model also reports the plate size it assumed, so that someone who knows
// their plate is a 22 cm side plate can correct the scale of the whole meal,
// and every item can be measured afterwards to replace its guess.
//
// The image is downscaled in the browser and sent to Google only. It is not
// stored: not in localStorage, not anywhere else.

(function () {
  'use strict';

  var MAX_SIDE = 1024;
  var JPEG_QUALITY = 0.85;

  /** Decode, downscale and re-encode a photo. Resolves to {dataUrl, base64}. */
  function prepare(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || '')) {
        reject(new Error('That file is not an image.'));
        return;
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        var dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        resolve({ dataUrl: dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        // HEIC from older iPhones is the usual culprit; most browsers cannot
        // decode it, though the camera input normally converts to JPEG first.
        reject(new Error('This browser could not open that image. Try a JPEG or PNG.'));
      };
      img.src = url;
    });
  }

  function buildPrompt(opts) {
    var lines = [];
    lines.push('You are looking at one photo of a meal for a calorie log. Identify the foods ' +
      'and estimate how much of each is on the plate.');
    lines.push('');
    lines.push('For each distinct food give:');
    lines.push('- "name": a plain name as a nutrition database would list it, in the state ' +
      'it is served (e.g. "white rice, cooked", "baked beans", "fried egg", "spaghetti, ' +
      'cooked", "naan").');
    lines.push('- "search": one to three plain words for the main ingredient, for searching ' +
      'a food database (e.g. "rice", "beans", "egg", "spaghetti", "naan").');
    lines.push('- "cooked": true if it has been cooked, false if raw.');
    lines.push('- "grams": your best estimate of the edible weight on the plate, in grams.');
    lines.push('- "grams_low" and "grams_high": a realistic range. A photo has no depth, so ' +
      'make the range honest rather than narrow.');
    lines.push('- "kcal_per_100g": typical energy density of this item as served.');
    lines.push('- "confidence": "high", "medium" or "low", for how sure you are what it is.');
    lines.push('');
    lines.push('RULES:');
    lines.push('- Split a plate into its components where they are visibly separate (rice, ' +
      'beans, an egg, a sausage, a salad). A dish that cannot be separated (a curry, a ' +
      'sandwich, a burger, a pizza slice) is one item. Never also list a part of an item ' +
      'you have already counted whole, such as a burger\'s bun.');
    lines.push('- Give every item its most likely specific name ("black pudding", "bolognese ' +
      'sauce", "dal", "salmon nigiri"), never a placeholder like "curry 1" or "side dish". ' +
      'If you are unsure what it is, still name your best guess and set confidence to "low".');
    lines.push('- Small side bowls hold about 100 to 150 g each.');
    lines.push('- If the food was very likely cooked in oil, ghee or butter, add the fat as ' +
      'its own item with an estimated amount. Hidden cooking fat is the commonest reason ' +
      'a calorie estimate is too low.');
    lines.push('- Judge scale from what is in the picture: a dinner plate is about 26 cm ' +
      'across, a fork about 19 cm long, a hand, a cup.');
    if (opts && opts.plateCm) {
      lines.push('- The main plate or bowl is ' + opts.plateCm + ' cm across. Use that as ' +
        'the scale.');
    }
    lines.push('- Do not guess at things you cannot see.');
    if (opts && opts.hint) {
      lines.push('- The person adds: "' + String(opts.hint).slice(0, 300).replace(/"/g, "'") +
        '". Trust this over your own reading of the photo.');
    }
    lines.push('');
    lines.push('Also give "plate_cm": the diameter in cm you assumed for the main plate or ' +
      'bowl when judging amounts, or 0 if there is no plate or bowl to judge by.');
    lines.push('Also give "notes": one short sentence on what most limits this estimate.');
    lines.push('If there is no food in the photo, return an empty "items" list and say so ' +
      'in "notes".');
    lines.push('');
    lines.push('Reply with compact JSON only, on a single line with no spaces between ' +
      'fields and no code fence, in this shape: {"items": [{"name": "...", "search": ' +
      '"...", "cooked": true, "grams": 0, "grams_low": 0, "grams_high": 0, ' +
      '"kcal_per_100g": 0, "confidence": "medium"}], "plate_cm": 26, "notes": "..."}');
    return lines.join('\n');
  }

  function num(v, lo, hi) {
    v = Number(v);
    if (!isFinite(v) || v <= 0) return null;
    return Math.min(hi, Math.max(lo, v));
  }

  /**
   * Rescue what can be read from a reply whose JSON is broken. Small models
   * slip on syntax -- an extra bracket, a missing comma between items -- far
   * more often than on content, and one stray character should not throw away
   * a whole plate. Every complete, self-contained item object is kept; the
   * plate size and notes are picked out on their own.
   */
  function salvage(body) {
    var items = [];
    (body.match(/\{[^{}]*\}/g) || []).forEach(function (o) {
      try {
        var x = JSON.parse(o);
        if (x && typeof x.name === 'string') items.push(x);
      } catch (e) { /* skip the broken one */ }
    });
    if (!items.length) return null;
    var plate = /"plate_cm"\s*:\s*([\d.]+)/.exec(body);
    var notes = /"notes"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body);
    var noteText = '';
    if (notes) { try { noteText = JSON.parse('"' + notes[1] + '"'); } catch (e) { noteText = ''; } }
    return { items: items, plate_cm: plate ? Number(plate[1]) : null, notes: noteText };
  }

  /**
   * Turn the model's reply into checked items. The reply is untrusted text:
   * it may be wrapped in a code fence, missing fields, or have the range the
   * wrong way round, and none of that should reach the log.
   */
  function parse(text) {
    var body = String(text).trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    var data;
    try { data = JSON.parse(body); } catch (e) {
      var m = /\{[\s\S]*\}/.exec(body);
      try { data = m ? JSON.parse(m[0]) : null; } catch (e2) { data = null; }
      if (!data) data = salvage(body);
      if (!data) throw new Error('The model did not reply in the expected format. Try again.');
    }
    // Some models wrap the whole answer in a one-element list:
    // [{"items": [...], "notes": "..."}]. Unwrap it rather than reading the
    // wrapper as a single nameless food.
    if (Array.isArray(data) && data.length === 1 && data[0] && Array.isArray(data[0].items)) data = data[0];
    var raw = Array.isArray(data) ? data : (data.items || []);
    var items = raw.slice(0, 12).map(function (it) {
      if (!it || typeof it !== 'object') return null;
      var name = String(it.name || '').trim().slice(0, 80);
      var grams = num(it.grams, 1, 2000);
      if (!name || !grams) return null;
      var lo = num(it.grams_low, 1, 2000) || grams;
      var hi = num(it.grams_high, 1, 2000) || grams;
      if (lo > hi) { var tmp = lo; lo = hi; hi = tmp; }
      lo = Math.min(lo, grams);
      hi = Math.max(hi, grams);
      var conf = String(it.confidence || '').toLowerCase();
      return {
        name: name,
        search: String(it.search || '').trim().slice(0, 60),
        cooked: it.cooked !== false,
        grams: Math.round(grams), gramsLow: Math.round(lo), gramsHigh: Math.round(hi),
        kcalPer100: num(it.kcal_per_100g, 1, 900),
        confidence: ['high', 'medium', 'low'].indexOf(conf) >= 0 ? conf : 'medium'
      };
    }).filter(Boolean);
    return {
      items: items,
      plateCm: Array.isArray(data) ? null : num(data.plate_cm, 8, 45),
      notes: typeof data.notes === 'string' ? data.notes.slice(0, 300) : ''
    };
  }

  /**
   * Recognise a meal photo. Resolves to {dataUrl, items, notes}; rejects with
   * a message fit to show the person.
   */
  function analyse(file, opts) {
    return prepare(file).then(function (img) {
      return window.Gemini.request({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'image/jpeg', data: img.base64 } },
            { text: buildPrompt(opts) }
          ]
        }],
        generationConfig: {
          // Low temperature: the same photo should give the same answer.
          temperature: 0.2,
          responseMimeType: 'application/json',
          maxOutputTokens: 4096
        }
      }, {
        timeout: 90000,
        cutOff: 'The reply was cut off. Try a photo with fewer separate foods.'
      }).then(function (text) {
        var out = parse(text);
        out.dataUrl = img.dataUrl;
        return out;
      });
    });
  }

  window.Photo = { analyse: analyse, prepare: prepare, parse: parse, buildPrompt: buildPrompt };
})();
