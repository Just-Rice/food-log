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

  // The app's allergen keys and the words the model is asked to use for them.
  var ALLERGEN_WORDS = {
    milk: 'milk', lactose: 'lactose', egg: 'egg', fish: 'fish',
    crustacean: 'crustacean (prawns, shrimp, crab, lobster)', mollusc: 'mollusc (squid, clams, mussels, oysters)',
    treenut: 'tree nuts', peanut: 'peanut', soy: 'soy', gluten: 'gluten (wheat, barley, rye)', sesame: 'sesame'
  };
  // What each diet leaves out, and how to read a plate that could go either way.
  var DIET_RULES = {
    vegetarian: {
      none: 'meat, poultry, fish or seafood',
      read: 'a patty, mince, nuggets or sausage that could be plant-based is plant-based; ' +
        'pieces that could be paneer or tofu rather than chicken are paneer or tofu'
    },
    vegan: {
      none: 'meat, poultry, fish, seafood, dairy, eggs, honey, ghee or butter',
      read: 'a patty, mince, nuggets or sausage that could be plant-based is plant-based; ' +
        'milk, yoghurt and cheese that could be plant-based are; scrambled "egg" that could ' +
        'be tofu is tofu; cooking fat is vegetable oil unless it is clearly butter or ghee'
    },
    pescatarian: {
      none: 'meat or poultry (fish and seafood are fine)',
      read: 'a patty, mince or sausage that could be plant-based or fish is; pieces that ' +
        'could be fish, paneer or tofu rather than chicken are those'
    }
  };

  /**
   * The person's dietary settings, as rules for the model. Diets and
   * allergies are treated differently on purpose. Someone vegetarian
   * photographs food they eat, so an ambiguous patty really is a veggie
   * patty, and reading it that way makes the estimate better. An allergy is
   * the opposite: telling the model "this cannot contain peanuts" would make
   * it rename a peanut sauce into something safe, and false reassurance
   * there is dangerous -- so allergens are flagged, never assumed away.
   */
  function dietLines(diet) {
    var out = [];
    if (!diet) return out;
    var rule = DIET_RULES[diet.diet];
    var allergens = (diet.allergens || []).filter(function (a) { return ALLERGEN_WORDS[a]; });
    var custom = (diet.custom || []).map(function (c) { return String(c).replace(/"/g, "'").slice(0, 40); })
      .filter(Boolean).slice(0, 12);
    if (!rule && !allergens.length && !custom.length) return out;
    out.push('');
    out.push('DIETARY SETTINGS (from the person\'s own settings):');
    if (rule) {
      out.push('- They follow a ' + diet.diet + ' diet: no ' + rule.none + '. When an item ' +
        'could be either, read it as the ' + diet.diet + ' version: ' + rule.read + '. Name a ' +
        'food outside the diet only when it is unmistakable, and then add "conflict": a few ' +
        'words saying what it is (e.g. "contains bacon").');
    }
    if (allergens.length) {
      out.push('- They must avoid, for their health: ' + allergens.map(function (a) {
        return ALLERGEN_WORDS[a];
      }).join(', ') + '. Never leave one out or rename a food to make it fit. If an item ' +
        'visibly contains one, or usually does as normally made (satay sauce: peanut; pesto: ' +
        'tree nuts; naan: milk), add "allergens": a list using these words: ' +
        allergens.join(', ') + '.');
    }
    if (custom.length) {
      out.push('- They also avoid: ' + custom.join(', ') + '. If an item contains one, add ' +
        '"conflict" saying which.');
    }
    out.push('- Leave out "conflict" and "allergens" for items they do not apply to.');
    return out;
  }

  /**
   * The cuisines the person mostly eats (Settings), as a hint for reading
   * dishes that could be several things, and for naming them.
   */
  function cuisineLines(names) {
    names = (names || []).map(function (c) { return String(c).replace(/"/g, "'").slice(0, 40); })
      .filter(Boolean).slice(0, 6);
    if (!names.length) return [];
    return ['', 'CUISINES: this person mostly eats ' + names.join(', ') + ' food. When a dish could ' +
      'be read more than one way, prefer the reading from these cuisines, and use their usual dish ' +
      'names (e.g. "dal" rather than "lentil soup", "sabzi" rather than "vegetable stir-fry"), ' +
      'while still describing exactly what you see.'];
  }

  // ---- prompts --------------------------------------------------------------
  // The photo and the spoken/typed description share every rule about what
  // to report and how; only the opening and the scale rules differ.

  function fieldLines(fromPhoto) {
    return [
      'For each distinct food give:',
      '- "name": a plain name as a nutrition database would list it, in the state ' +
        'it is served (e.g. "white rice, cooked", "baked beans", "fried egg", "spaghetti, ' +
        'cooked", "naan").',
      '- "search": one to three plain words for the main ingredient, for searching ' +
        'a food database (e.g. "rice", "beans", "egg", "spaghetti", "naan").',
      '- "cooked": true if it has been cooked, false if raw.',
      '- "grams": your best estimate of the edible weight ' + (fromPhoto ? 'on the plate' : 'eaten') + ', in grams.',
      '- "grams_low" and "grams_high": a realistic range. ' + (fromPhoto
        ? 'A photo has no depth, so make the range honest rather than narrow.'
        : 'Where the person gave no amount, make the range wide.'),
      '- "kcal_per_100g": typical energy density of this item as served.',
      '- "confidence": "high", "medium" or "low", for how sure you are what it is.',
      '- "spices": for a cooked dish, the spices and dried herbs it most likely contains, as plain ' +
        'names (e.g. ["turmeric", "cumin", "coriander"]); an empty list for foods with none.'
    ];
  }

  function ruleLines(fromPhoto) {
    return [
      '- Split a ' + (fromPhoto ? 'plate' : 'meal') + ' into its components where they are ' + (fromPhoto ? 'visibly ' : '') +
        'separate (rice, beans, an egg, a sausage, a salad). A dish that cannot be separated ' +
        '(a curry, a sandwich, a burger, a pizza slice) is one item. Never also list a part of ' +
        'an item you have already counted whole, such as a burger\'s bun.',
      '- Give every item its most likely specific name ("black pudding", "bolognese ' +
        'sauce", "dal", "salmon nigiri"), never a placeholder like "curry 1" or "side dish". ' +
        'If you are unsure what it is, still name your best guess and set confidence to "low".',
      '- Small side bowls hold about 100 to 150 g each.',
      '- If the food was very likely cooked in oil, ghee or butter, add the fat as ' +
        'its own item with an estimated amount. Hidden cooking fat is the commonest reason ' +
        'a calorie estimate is too low.'
    ];
  }

  function replyShape(fromPhoto) {
    return 'Reply with compact JSON only, on a single line with no spaces between ' +
      'fields and no code fence, in this shape: {"items": [{"name": "...", "search": ' +
      '"...", "cooked": true, "grams": 0, "grams_low": 0, "grams_high": 0, ' +
      '"kcal_per_100g": 0, "confidence": "medium", "spices": []}], ' +
      (fromPhoto ? '"plate_cm": 26, "scale": "plate", ' : '') + '"notes": "..."}';
  }

  function buildPrompt(opts) {
    var lines = [];
    lines.push('You are looking at one photo of a meal for a calorie log. Identify the foods ' +
      'and estimate how much of each is on the plate.');
    lines.push('');
    Array.prototype.push.apply(lines, fieldLines(true));
    lines.push('');
    lines.push('RULES:');
    Array.prototype.push.apply(lines, ruleLines(true));
    lines.push('- If a bank card, credit card or ID card is in the photo, it is exactly 85.6 x ' +
      '54 mm: use it as the scale for every amount, set "scale": "card", and work out ' +
      '"plate_cm" from it. A card is a far better guide than a guessed plate size.');
    lines.push('- Otherwise judge scale from what is in the picture: a dinner plate is about ' +
      '26 cm across, a fork about 19 cm long, a hand, a cup; set "scale" to "plate" or ' +
      '"other" for whichever you used.');
    if (opts && opts.plateCm) {
      lines.push('- The main plate or bowl is ' + opts.plateCm + ' cm across. Use that as ' +
        'the scale.');
    }
    lines.push('- Do not guess at things you cannot see.');
    if (opts && opts.hint) {
      lines.push('- The person adds: "' + String(opts.hint).slice(0, 300).replace(/"/g, "'") +
        '". Trust this over your own reading of the photo.');
    }
    Array.prototype.push.apply(lines, dietLines(opts && opts.diet));
    Array.prototype.push.apply(lines, cuisineLines(opts && opts.cuisines));
    lines.push('');
    lines.push('Also give "plate_cm": the diameter in cm you assumed for the main plate or ' +
      'bowl when judging amounts, or 0 if there is no plate or bowl to judge by.');
    lines.push('Also give "notes": one short sentence on what most limits this estimate.');
    lines.push('If there is no food in the photo, return an empty "items" list and say so ' +
      'in "notes".');
    lines.push('');
    lines.push(replyShape(true));
    return lines.join('\n');
  }

  /**
   * The prompt for a meal described in words, typed or spoken. The person's
   * own amounts are used as given ("two rotis", "half a plate"); where there
   * are none, a typical adult portion with a wide range. Speech recognition
   * mishears food words, so the model is told to read through obvious slips.
   */
  function buildTextPrompt(text, opts) {
    var said = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 800).replace(/"/g, "'");
    var lines = [];
    lines.push('A person describes, in their own words, a meal they ate, for a calorie log: "' +
      said + '". Identify each food and estimate how much of it they ate, in grams.');
    lines.push('');
    Array.prototype.push.apply(lines, fieldLines(false));
    lines.push('');
    lines.push('RULES:');
    Array.prototype.push.apply(lines, ruleLines(false));
    lines.push('- Use the amounts they give, turned into grams with typical sizes: a roti or ' +
      'chapati about 40 g, a slice of bread about 35 g, a medium egg about 50 g, a bowl of ' +
      'rice or dal about 150 to 200 g, a cup about 240 ml, a tablespoon about 15 g.');
    lines.push('- Where they give no amount, assume one typical adult portion and set ' +
      'confidence no higher than "medium".');
    lines.push('- The words may come from speech recognition: read through obvious mishearings ' +
      '("brown rise" is brown rice), but do not invent foods they did not mention.');
    Array.prototype.push.apply(lines, dietLines(opts && opts.diet));
    Array.prototype.push.apply(lines, cuisineLines(opts && opts.cuisines));
    lines.push('');
    lines.push('Also give "notes": one short sentence on what most limits this estimate.');
    lines.push('If they describe no food, return an empty "items" list and say so in "notes".');
    lines.push('');
    lines.push(replyShape(false));
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

  /** A model's word for an allergen, as one of the app's keys, or ''. */
  function allergenKey(w) {
    var k = String(w || '').toLowerCase().replace(/[^a-z]/g, '');
    var map = {
      milk: 'milk', dairy: 'milk', lactose: 'lactose', egg: 'egg', eggs: 'egg', fish: 'fish',
      crustacean: 'crustacean', crustaceans: 'crustacean', shellfish: 'crustacean', prawn: 'crustacean',
      shrimp: 'crustacean', mollusc: 'mollusc', molluscs: 'mollusc', mollusk: 'mollusc', mollusks: 'mollusc',
      treenut: 'treenut', treenuts: 'treenut', nuts: 'treenut', nut: 'treenut',
      peanut: 'peanut', peanuts: 'peanut', groundnut: 'peanut', soy: 'soy', soya: 'soy', soybean: 'soy',
      gluten: 'gluten', wheat: 'gluten', sesame: 'sesame'
    };
    return map[k] || '';
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
      var allergens = (Array.isArray(it.allergens) ? it.allergens : [])
        .map(allergenKey).filter(function (a, j, arr) { return a && arr.indexOf(a) === j; });
      return {
        conflict: typeof it.conflict === 'string' && it.conflict.trim() ? it.conflict.trim().slice(0, 80) : '',
        allergens: allergens,
        name: name,
        search: String(it.search || '').trim().slice(0, 60),
        cooked: it.cooked !== false,
        grams: Math.round(grams), gramsLow: Math.round(lo), gramsHigh: Math.round(hi),
        kcalPer100: num(it.kcal_per_100g, 1, 900),
        confidence: ['high', 'medium', 'low'].indexOf(conf) >= 0 ? conf : 'medium',
        spices: (Array.isArray(it.spices) ? it.spices : []).map(function (x) {
          return String(x || '').trim().toLowerCase().slice(0, 30);
        }).filter(function (x, j, arr) { return x && arr.indexOf(x) === j; }).slice(0, 8)
      };
    }).filter(Boolean);
    return {
      items: items,
      plateCm: Array.isArray(data) ? null : num(data.plate_cm, 8, 45),
      scale: !Array.isArray(data) && ['card', 'plate', 'other'].indexOf(String(data.scale)) >= 0 ? String(data.scale) : '',
      notes: typeof data.notes === 'string' ? data.notes.slice(0, 300) : ''
    };
  }

  /**
   * Recognise a meal photo with an engine -- FirebaseEngine (free, no key) or
   * Gemini.engine (the visitor's own key) -- going down the free model list
   * until one answers (js/cascade.js). opts: {hint, plateCm, model} where
   * `model` pins one model, as "Try a stronger model" does. Resolves to
   * {dataUrl, items, plateCm, notes, model}; rejects with a message fit to
   * show the person (err.code 'ALL_SPENT' when every model is used up today).
   */
  function analyseWith(engine, file, opts) {
    opts = opts || {};
    return prepare(file).then(function (img) {
      var prompt = buildPrompt(opts);
      return window.Cascade.run(function (model, timeout) {
        return engine.call(model, prompt, img.base64, timeout);
      }, { engine: engine.name, only: opts.model }).then(function (res) {
        var out = parse(res.text);
        out.dataUrl = img.dataUrl;
        out.model = res.model;
        return out;
      });
    });
  }

  /**
   * Read a meal described in words, through the same cascade and parser as a
   * photo. Resolves to {items, notes, model}, with no picture.
   */
  function analyseText(engine, text, opts) {
    opts = opts || {};
    var prompt = buildTextPrompt(text, opts);
    return window.Cascade.run(function (model, timeout) {
      return engine.call(model, prompt, null, timeout);
    }, { engine: engine.name, only: opts.model }).then(function (res) {
      var out = parse(res.text);
      out.dataUrl = '';
      out.model = res.model;
      out.plateCm = null;
      out.scale = '';
      return out;
    });
  }

  /** The visitor's own key. */
  function analyse(file, opts) {
    return analyseWith(window.Gemini.engine, file, opts);
  }

  window.Photo = { cuisineLines: cuisineLines, analyse: analyse, analyseWith: analyseWith, analyseText: analyseText, prepare: prepare, parse: parse, buildPrompt: buildPrompt, buildTextPrompt: buildTextPrompt, allergenKey: allergenKey };
})();
