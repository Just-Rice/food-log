// Food Log -- router and views. Vanilla JS, no build step.
//
// The food list, photo credits and reference intakes are Food is Medicine's
// own data files, loaded from its folder on the same site. The log view and
// photo estimator began in the vegetarian fork of that site; the search
// ranking and nutrient helpers are lifted from its app.js.
(function () {
  'use strict';

  var FIM = '../food-is-medicine/';
  var FOODS = window.FOODS || [];
  var CREDITS = window.IMAGE_CREDITS || {};
  var DRI = window.DRI;
  var Profile = window.Profile;
  var Prefs = window.Prefs;
  var Tracker = window.Tracker;
  var Gemini = window.Gemini;
  var Photo = window.Photo;
  var LocalModel = window.LocalModel;

  var main = document.getElementById('main');
  var nav = document.getElementById('nav');

  var FOOD_BY_SLUG = {};
  FOODS.forEach(function (f) { FOOD_BY_SLUG[f.slug] = f; });

  // ---- strings -------------------------------------------------------------
  // English only. Food is Medicine's translations cover its own pages; this
  // site's wording is small enough to keep here until it needs the same.
  var S = {
    nav_today: 'Today', nav_snap: 'Snap a meal', nav_history: 'History', nav_settings: 'Settings',
    nav_fim: 'Food is Medicine',
    today: 'Today', yesterday: 'Yesterday',
    previous_day: 'Previous day', next_day: 'Next day', choose_day: 'Choose a day',
    log_title: 'Food log',
    log_lede: 'What you ate, and what it adds up to. Searched foods use USDA figures; photo items stay a range until you measure them.',
    add_food: 'Add food', search_add: 'Search the food list', search_foods: 'Search foods…',
    eaten_on: 'Eaten {day}', log_empty: 'Nothing logged for this day yet.',
    kcal_of_target: '{n} of about {target} kcal.',
    kcal_left: 'Roughly {n} kcal below your estimated daily need.',
    kcal_over: 'Roughly {n} kcal above your estimated daily need.',
    how_estimated: 'How this is estimated',
    log_under18: 'Totals only: no calorie figure is shown under 18, for the reasons Food is Medicine gives.',
    growing_title: 'Growing and eating well',
    log_no_profile: 'Add your height, weight, age and activity on Food is Medicine to see your own reference intakes and estimated energy need here.',
    profile_title: 'Set up your profile',
    range_note: 'Photo items are shown as a range until measured. Measure an item and its range goes.',
    est_share: '{est} of these {total} kcal come from photo portions nobody has measured yet.',
    from_photo: 'photo', typed_in: 'typed in', measured: 'measured',
    photo_saw: 'Photo: {name}',
    energy_only: 'Energy only — the model’s estimate, not USDA data',
    amount_g: 'Amount (g)', remove: 'Remove', meal: 'Meal',
    excluded_warning: 'This food is excluded by your dietary settings on Food is Medicine.',
    add_to_log: 'Add to log', cancel: 'Cancel', recent: 'Recent',
    manual_entry: 'Type in something that is not on the list',
    manual_hint: 'For a packaged food, copy the figures from its label. Only energy is required.',
    food_name: 'What was it',
    meal_breakfast: 'Breakfast', meal_lunch: 'Lunch', meal_dinner: 'Dinner', meal_snack: 'Snacks',
    snap_title: 'Snap a meal',
    snap_lede: 'Photograph a whole plate and get each food on it, matched to the USDA list with an estimated amount. Check it, measure anything you can, then log it. No key or sign-up needed.',
    snap_needs_key: 'Photo estimates use your own free Gemini API key. A key saved on Food is Medicine works here too.',
    get_free_key: 'Get a free key from Google AI Studio',
    snap_busy: 'Looking at your plate…',
    snap_hint_label: 'Anything the photo does not show? (optional)',
    snap_hint_placeholder: 'e.g. cooked in a tablespoon of ghee, 2 rotis under the curry',
    take_photo: 'Take a photo', choose_photo: 'Choose a photo',
    snap_privacy: 'The photo is shrunk on your device and sent to Google with your key. It is not stored here or anywhere else by this site.',
    snap_review: 'Check this before it is logged',
    snap_best_guess: 'Best guess about {n} kcal.',
    snap_measured_share: '{m} of {n} items measured.',
    snap_nothing: 'No food was recognised in that photo.',
    discard: 'Discard',
    snap_accuracy: 'From the photo alone, expect the true figure to be anywhere from a third lower to a third higher: a picture has no depth, and oil and sauces hide energy. Measuring an item — a scale, a cup, a count of pieces — replaces its guess with a real amount.',
    include: 'Include', unsure: 'unsure', match_as: 'Match to food',
    model_estimate: 'No match — model estimate, ~{n} kcal/100 g',
    snap_mismatch: 'USDA gives {usda} kcal/100 g for this match, but the model expected about {model}. Check it is the right form — cooked rather than dry, say.',
    snap_no_match: 'No close match in the food list, so this uses the model’s own energy estimate, which is less reliable.',
    plate_title: 'Plate size',
    plate_assumed: 'The estimate assumed a plate about {n} cm across.',
    plate_none: 'No plate or bowl was used for scale.',
    plate_label: 'Your plate, across (cm)',
    plate_apply: 'Rescale',
    plate_hint: 'Measure straight across the plate or bowl the food is on. This corrects the scale of every unmeasured item; it cannot correct how deep the food is.',
    plate_done: 'Rescaled to a {n} cm plate.',
    measure: 'Measure', measure_title: 'Replace the guess with a measurement',
    weighed: 'Weighed', weighed_label: 'Weight (g)', use: 'Use',
    household: 'Household measure', count: 'How many',
    measure_scale: 'kitchen scale', measure_typed: 'weight entered',
    estimate_range: 'estimate {lo}–{hi} g',
    whole_photo: 'Whole photo',
    week_avg: 'Average {n} kcal over the {days} logged days.',
    week_none: 'Nothing logged in this period.',
    week_line: 'The dashed line is your estimated daily need of {n} kcal.',
    nutrients_title: 'Vitamins and minerals',
    nutrients_lede_personal: 'The day against your own reference intakes (RDA or AI for your age and sex).',
    nutrients_lede_generic: 'The day against the general Daily Values printed on US food labels. Set up a profile for your own.',
    nutrients_partial: '{n} entries ({kcal} kcal) carry energy only, so their vitamins and minerals are not counted here.',
    over_ul: 'Above the tolerable upper intake level of {ul} {unit}.',
    over_sodium: 'Above the {ul} mg level the 2019 DRIs set for reducing chronic-disease risk.',
    ul_food_note: 'Upper limits that apply only to supplements and fortified foods are not flagged, since food alone is not known to cause harm at those intakes.',
    history_title: 'History', history_lede: 'Energy by day, and how the logged days averaged against your reference intakes.',
    days_7: '7 days', days_30: '30 days',
    avg_title: 'Average across logged days',
    days_list: 'Logged days', entries_n: '{n} entries',
    settings_title: 'Settings',
    key_title: 'Your own Gemini key (optional)',
    key_lede: 'Photo estimates work without one: Food Log reads photos through its own free service, whose daily allowance is shared by everyone using it. A free key of your own gives you a separate allowance. It is used only for photos, sent only to Google, and stored in this browser under the same name Food is Medicine uses, so one key works on both.',
    key_saved: 'Saved key: {k}', key_none: 'No key saved.',
    key_placeholder: 'Paste your key', save: 'Save', remove_key: 'Remove key',
    key_shared_warning: 'Do not save a key on a shared or public computer.',
    profile_section: 'Profile and dietary settings',
    profile_lede: 'Your profile is shared with Food is Medicine and edited there.',
    profile_none: 'No profile set.',
    edit_profile: 'Edit profile', edit_diet: 'Dietary settings',
    dietary_title: 'Dietary settings',
    dietary_hint: 'Foods outside these settings are hidden from search, recent foods and photo matches, and the photo reader is told about them. Shared with Food is Medicine.',
    diet_label: 'Diet', allergens_label: 'Allergies & intolerances',
    diet_none: 'No restrictions', diet_vegetarian: 'Vegetarian', diet_vegan: 'Vegan', diet_pescatarian: 'Pescatarian',
    a_milk: 'Milk', a_lactose: 'Lactose', a_egg: 'Egg', a_fish: 'Fish', a_crustacean: 'Crustacean shellfish',
    a_mollusc: 'Molluscs', a_treenut: 'Tree nuts', a_peanut: 'Peanuts', a_soy: 'Soy', a_gluten: 'Gluten', a_sesame: 'Sesame',
    custom_excl: 'Other foods to avoid',
    custom_excl_hint: 'Comma-separated, matched against food names, e.g. "mushroom, coriander".',
    reading_for: 'Reading for: {list}.', change: 'Change',
    no_x: 'no {x}',
    not_diet: 'not {diet}', may_contain: 'may contain {x}', avoid_tag: 'check: {x}',
    allergy_disclaimer: 'Food Log flags what the photo suggests, but it cannot tell whether a meal is safe for an allergy. Hidden ingredients do not show in a picture: check with whoever made it.',
    theme: 'Theme', theme_system: 'Match system', theme_light: 'Light', theme_dark: 'Dark',
    data_title: 'Your log',
    data_lede: 'The log lives only in this browser. Export it to keep a copy or move it to another device.',
    export_btn: 'Export log', import_btn: 'Import a log file', clear_btn: 'Delete the whole log',
    clear_confirm: 'Delete every entry in the log? This cannot be undone.',
    imported_n: 'Imported {n} entries.', imported_legacy: 'Your log from the vegetarian edition was brought across.',
    days_logged: '{n} days logged.',
    ed_help: 'If food or your body feels like it is taking up too much of your thinking, that is worth talking to someone about. It is common, it is treatable, and asking early makes it easier.',
    ed_help_link: 'What eating disorders are, and how to get help',
    no_data: 'The food list could not be loaded from Food is Medicine. Check your connection and reload. If you are running this locally, serve the folder that holds both food-log and food-is-medicine.',
    photo_credit: 'Photo: {author}, {license}',
    on_fim: 'On Food is Medicine',
    local_title: 'On-device model',
    local_lede: 'Gemma 4 E2B, Google’s open model, can read your meal photos on this device: no daily limit, and the photo never leaves your phone or computer. It is a one-time download of about {gb} GB, so use Wi-Fi. It is slower than Gemini and rougher: in testing it named simple plates well but misread a full English breakfast, so check its list carefully.',
    local_checking: 'Checking what this device can run…',
    local_download: 'Download the model ({gb} GB)',
    local_downloading: 'Downloading… {done} of about {gb} GB',
    local_loading: 'Loading the model into memory. The first time on each visit this can take a minute.',
    local_ready: 'Ready, and loaded for this visit.',
    local_cached: 'Downloaded. It loads from this device the next time you snap a meal.',
    local_load_now: 'Load it now', local_stop: 'Stop', local_delete: 'Delete the model',
    local_error: 'The model did not load: {msg}',
    local_try_again: 'Try again',
    local_not_cached: 'This browser did not let the site keep the model, so it will download again on your next visit. Freeing up storage space usually fixes it.',
    engine_label: 'Read the photo with',
    engine_free: 'Free', engine_key: 'Your key', engine_local: 'On this device',
    snap_free_privacy: 'The photo is shrunk on your device and read by Google’s Gemini through Food Log’s free service. It is not stored. Free estimates share one daily allowance across everyone using Food Log.',
    read_by: 'Read by {model}.',
    try_stronger: 'Try a stronger model ({model})',
    stronger_busy: 'Asking {model}… it can take a couple of minutes when it is busy.',
    stronger_failed: 'The stronger model could not answer: {msg} The first reading is kept.',
    all_spent_help: 'Add your own free Gemini key in Settings for a separate allowance, or use the on-device model.',
    snap_setup: 'Photo estimates need one of these. Either works; you can set up both and choose each time.',
    snap_setup_gemini: 'Use Gemini with your own free key',
    snap_setup_gemini_lede: 'Fast and the most accurate. The photo is sent to Google with your key.',
    snap_local_privacy: 'The photo is read on this device and never leaves it.',
    snap_local_loading: 'Loading the on-device model…',
    snap_local_reading: 'Looking at your plate on this device…',
    snap_local_writing: 'Writing the list of foods… {n} tokens so far.',
    change_match: 'Search for a different food',
    card_tip: 'For better amounts, put a bank card beside the plate: its size is fixed, so the reader can measure against it.',
    scaled_card: 'Scaled from the card in the photo.',
    snap_local_slow: 'On-device reading is slower than Gemini, from under a minute on a laptop to a few minutes on a phone.'
  };

  function t(key, vars) {
    var s = S[key] != null ? S[key] : key;
    if (vars) {
      Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); });
    }
    return s;
  }

  // ---- small helpers ----------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(v) {
    if (v == null || isNaN(v)) return '—';
    var a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 100) return String(Math.round(v));
    if (a >= 1) return String(Math.round(v * 10) / 10);
    if (a >= 0.1) return String(Math.round(v * 100) / 100);
    return String(Math.round(v * 1000) / 1000);
  }

  function kcalText(lo, hi) {
    lo = Math.round(lo); hi = Math.round(hi);
    if (Math.abs(hi - lo) < 5) return String(Math.round((lo + hi) / 2));
    return lo + '–' + hi;
  }

  var UNIT = { g: 'g', mg: 'mg', ug: 'µg', kcal: 'kcal' };

  // English labels and units for the nutrients, in the order Food is
  // Medicine's food pages use.
  var NUTRIENTS = {
    kcal: ['Energy', 'kcal'], protein: ['Protein', 'g'], carbs: ['Carbohydrate', 'g'],
    fat: ['Total fat', 'g'], fiber: ['Fibre', 'g'], sugar: ['Sugars', 'g'],
    vita: ['Vitamin A', 'ug'], vitc: ['Vitamin C', 'mg'], vitd: ['Vitamin D', 'ug'],
    vite: ['Vitamin E', 'mg'], vitk: ['Vitamin K', 'ug'], thiamin: ['Thiamin (B1)', 'mg'],
    riboflavin: ['Riboflavin (B2)', 'mg'], niacin: ['Niacin (B3)', 'mg'],
    pantothenic: ['Pantothenic acid (B5)', 'mg'], b6: ['Vitamin B6', 'mg'],
    folate: ['Folate', 'ug'], b12: ['Vitamin B12', 'ug'], choline: ['Choline', 'mg'],
    calcium: ['Calcium', 'mg'], iron: ['Iron', 'mg'], magnesium: ['Magnesium', 'mg'],
    phosphorus: ['Phosphorus', 'mg'], potassium: ['Potassium', 'mg'], sodium: ['Sodium', 'mg'],
    zinc: ['Zinc', 'mg'], copper: ['Copper', 'mg'], manganese: ['Manganese', 'mg'],
    selenium: ['Selenium', 'ug']
  };
  var VITAMINS = ['vita', 'vitc', 'vitd', 'vite', 'vitk', 'thiamin', 'riboflavin', 'niacin',
                  'pantothenic', 'b6', 'folate', 'b12', 'choline'];
  var MINERALS = ['calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'sodium',
                  'zinc', 'copper', 'manganese', 'selenium'];

  function nutrientLabel(k) { return NUTRIENTS[k] ? NUTRIENTS[k][0] : k; }
  function nutrientUnit(k) { return NUTRIENTS[k] ? UNIT[NUTRIENTS[k][1]] : ''; }

  // FDA Daily Values (21 CFR 101.9) -- the population-wide numbers printed on
  // US labels, used until the visitor supplies their own details.
  var GENERIC_DV = {
    protein: 50, fiber: 28, vita: 900, vitc: 90, vitd: 20, vite: 15, vitk: 120,
    thiamin: 1.2, riboflavin: 1.3, niacin: 16, pantothenic: 5, b6: 1.7,
    folate: 400, b12: 2.4, choline: 550, calcium: 1300, iron: 18, magnesium: 420,
    phosphorus: 1250, potassium: 4700, sodium: 2300, zinc: 11, copper: 0.9,
    manganese: 2.3, selenium: 55
  };

  function referenceSet() {
    var targets = Profile.targets();
    if (!targets) return { personal: false, values: GENERIC_DV };
    var values = {};
    Object.keys(targets).forEach(function (k) { values[k] = targets[k].value; });
    return { personal: true, values: values };
  }

  // Everything a food can be found by: its name, the USDA description, the
  // other names people call it, and its family tags.
  function haystack(food) {
    if (food._hay) return food._hay;
    food._hay = [food.name, food.usda || '', (food.aka || []).join(' '),
                 (food.tags || []).join(' ')].join(' ').toLowerCase();
    return food._hay;
  }

  // Whole-word hits outrank buried substrings: "anda" should open on the egg,
  // not on mandarin.
  function relevance(food, q) {
    var name = food.name.toLowerCase();
    if (name === q) return 100;
    if (name.indexOf(q) === 0) return 90;
    var word = new RegExp('(^|[^a-z])' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (word.test(name)) return 80;
    var aliases = food.aka || [];
    for (var i = 0; i < aliases.length; i++) {
      var a = aliases[i].toLowerCase();
      if (a === q) return 70;
      if (word.test(a)) return 60;
    }
    var tags = food.tags || [];
    for (var j = 0; j < tags.length; j++) {
      if (tags[j].toLowerCase() === q) return 50;
      if (word.test(tags[j])) return 45;
    }
    if (name.indexOf(q) >= 0) return 30;
    if (word.test(food.usda || '')) return 20;
    return 5;
  }

  // In a log, someone typing "rice" has just eaten some: cooked and
  // ready-to-eat foods come before rice flour, rice bran oil and dry grain.
  var NOT_EATEN_AS_IS = /\b(flour|oil|meal|bran|powder|frozen|dry|dried|defatted|lecithin|seasoning|mix)\b/;
  function logRank(f, q) {
    var r = relevance(f, q);
    if ((f.tags || []).indexOf('cooked') >= 0 || (f.tags || []).indexOf('bread') >= 0) r += 12;
    if (NOT_EATEN_AS_IS.test(f.name.toLowerCase())) r -= 15;
    return r;
  }

  function supportNote() {
    return '<div class="note support"><p>' + esc(t('ed_help')) + '</p>' +
      '<p><a href="https://www.nimh.nih.gov/health/topics/eating-disorders" ' +
      'rel="noopener" target="_blank">' + esc(t('ed_help_link')) + '</a></p></div>';
  }

  function fimFood(slug) { return FIM + '#/food/' + encodeURIComponent(slug); }

  // Cooked foods rarely have a photograph of their own on Wikimedia Commons.
  // Where the raw food's photo is a fair picture of what is on the plate, it
  // stands in; cooked rice and pasta are left without, since dry grains are not
  // what anyone was served.
  var PHOTO_FALLBACK = {
    broccolicooked: 'broccoli', spinachcooked: 'spinach', cauliflowercooked: 'cauliflower',
    carrotscooked: 'carrot', greenbeanscooked: 'greenbeans', cornsweetcooked: 'corn',
    eggplantcooked: 'eggplant', okracooked: 'okra', mushroomscooked: 'whitemushroom',
    sweetpotatobaked: 'sweetpotato', potatoboiled: 'potato', potatobaked: 'potato',
    kidneybeanscooked: 'kidneybean', blackbeanscooked: 'blackbean', toordalcooked: 'pigeonpea',
    lentilscooked: 'lentil', chickpeascooked: 'chickpea', quinoacooked: 'quinoa',
    couscouscooked: 'couscous', milletcooked: 'millet', barleycooked: 'barleypearled',
    ricenoodlescooked: 'ricenoodles', oatmealcooked: 'oats',
    chickenbreastroasted: 'chickenbreast', chickenthighroasted: 'chickenthigh',
    salmoncooked: 'atlanticsalmon', codcooked: 'cod', shrimpcooked: 'shrimp',
    groundbeefcooked: 'groundbeef', porkchopcooked: 'porkchop',
    eggboiled: 'chickenegg', eggfried: 'chickenegg', eggscrambled: 'chickenegg'
  };

  function photoSlug(food) {
    if (CREDITS[food.slug]) return food.slug;
    var alt = PHOTO_FALLBACK[food.slug];
    return alt && CREDITS[alt] ? alt : null;
  }

  // A photograph with its credit beside it, as the Commons licences require.
  function foodPhoto(food) {
    var slug = photoSlug(food);
    if (!slug) return '';
    var c = CREDITS[slug];
    return '<figure class="pick-photo"><img src="' + esc(FIM + 'img/' + slug + '.jpg') +
      '" alt="" loading="lazy" decoding="async">' +
      '<figcaption><a href="' + esc(c.page) + '" rel="noopener" target="_blank">' +
      esc(t('photo_credit', { author: c.author, license: c.license })) + '</a></figcaption></figure>';
  }

  function dayLabel(key) {
    var today = Tracker.today();
    if (key === today) return t('today');
    if (key === Tracker.shift(today, -1)) return t('yesterday');
    var p = key.split('-').map(Number);
    try {
      return new Date(p[0], p[1] - 1, p[2], 12).toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long'
      });
    } catch (e) { return key; }
  }

  function mealLabel(m) { return t('meal_' + m); }

  // The daily energy figure, or null where none is offered. It is maintenance
  // energy (Mifflin-St Jeor times activity), not a diet target: deficits are
  // Food is Medicine's weight page's business, with its safety checks, and
  // under 18 there is no calorie number at all.
  function energyTarget() {
    var p = Profile.get();
    if (!p || !DRI.energyApplies(p.age)) return null;
    return Profile.energy().tdee;
  }

  // ======================================================================
  // State
  // ======================================================================
  var logState = { date: null, pick: null, pickGrams: null, meal: null, measuring: null, notice: '' };
  var snap = { status: null, hint: '' };
  var histState = { days: 7 };

  function currentMeal() { return logState.meal || Tracker.guessMeal(); }

  function rememberMeal(id) {
    var el = document.getElementById(id);
    if (el && Tracker.MEALS.indexOf(el.value) >= 0) logState.meal = el.value;
  }

  function mealSelect(id, current) {
    return '<select id="' + id + '" aria-label="' + esc(t('meal')) + '">' +
      Tracker.MEALS.map(function (m) {
        return '<option value="' + m + '"' + (m === current ? ' selected' : '') + '>' +
          esc(mealLabel(m)) + '</option>';
      }).join('') + '</select>';
  }

  // ======================================================================
  // Measuring: shared by the photo review and by logged entries
  // ======================================================================

  /** Household measures a food offers: its USDA portion and serving. */
  function householdUnits(food) {
    var out = [];
    if (!food) return out;
    if (food.portion) out.push({ label: food.portion.label, grams: food.portion.grams });
    if (food.serving && (!food.portion || Math.abs(food.serving.grams - food.portion.grams) > 1)) {
      out.push({ label: food.serving.label, grams: food.serving.grams });
    }
    return out;
  }

  /**
   * The measure panel. `ctx` is "review" (an item in the photo being checked)
   * or "entry" (something already logged); `id` is the item index or entry id.
   */
  function measurePanel(ctx, id, food, grams, open) {
    var units = householdUnits(food);
    var key = ctx + '-' + id;
    return '<details class="measure"' + (open ? ' open' : '') + ' data-mkey="' + esc(key) + '">' +
      '<summary>' + esc(t('measure')) + '</summary>' +
      '<p class="hint">' + esc(t('measure_title')) + '</p>' +
      '<div class="measure-row">' +
      '<label for="mw-' + esc(key) + '">' + esc(t('weighed_label')) + '</label>' +
      '<input id="mw-' + esc(key) + '" type="number" min="1" max="5000" step="1" inputmode="decimal" value="' +
      esc(Math.round(grams)) + '">' +
      '<button class="btn small" type="button" data-mweigh="' + esc(key) + '">' + esc(t('use')) +
      '</button></div>' +
      (units.length
        ? '<div class="measure-row">' +
          '<label for="mu-' + esc(key) + '">' + esc(t('household')) + '</label>' +
          '<input id="mc-' + esc(key) + '" type="number" min="0.25" max="40" step="0.25" value="1" ' +
          'aria-label="' + esc(t('count')) + '" class="count">' +
          '<span aria-hidden="true">×</span>' +
          '<select id="mu-' + esc(key) + '">' + units.map(function (u, i) {
            return '<option value="' + i + '">' + esc(u.label) + ' (' + fmt(u.grams) + ' g)</option>';
          }).join('') + '</select>' +
          '<button class="btn small" type="button" data-munit="' + esc(key) + '">' + esc(t('use')) +
          '</button></div>'
        : '') +
      '</details>';
  }

  /** Read a measure panel. Returns {grams, label} or null. */
  function readMeasure(key, how, food) {
    if (how === 'weigh') {
      var g = Number(document.getElementById('mw-' + key).value);
      return g > 0 ? { grams: g, label: t('measure_scale') } : null;
    }
    var units = householdUnits(food);
    var u = units[Number(document.getElementById('mu-' + key).value)];
    var n = Number(document.getElementById('mc-' + key).value);
    if (!u || !(n > 0)) return null;
    return { grams: u.grams * n, label: fmt(n) + ' × ' + u.label };
  }

  // ======================================================================
  // View: today (any day)
  // ======================================================================
  function viewToday(dateArg) {
    if (dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) && dateArg <= Tracker.today()) {
      logState.date = dateArg;
    }
    if (!logState.date) logState.date = Tracker.today();
    var date = logState.date;
    var entries = Tracker.day(date);
    var totals = Tracker.totals(date);
    var target = energyTarget();
    var ref = referenceSet();
    var prof = Profile.get();

    main.innerHTML =
      '<div class="page-head"><h1>' + esc(t('log_title')) + '</h1>' +
      '<p>' + esc(t('log_lede')) + '</p></div>' +
      (logState.notice ? '<div class="note"><p>' + esc(logState.notice) + '</p></div>' : '') +

      '<div class="log-date">' +
      '<button class="btn ghost" type="button" id="dayPrev" aria-label="' +
      esc(t('previous_day')) + '">&larr;</button>' +
      '<div class="log-date-mid"><strong>' + esc(dayLabel(date)) + '</strong>' +
      '<input type="date" id="dayPick" value="' + esc(date) + '" max="' +
      esc(Tracker.today()) + '" aria-label="' + esc(t('choose_day')) + '"></div>' +
      '<button class="btn ghost" type="button" id="dayNext" aria-label="' +
      esc(t('next_day')) + '"' + (date >= Tracker.today() ? ' disabled' : '') +
      '>&rarr;</button></div>' +

      daySummary(totals, target, ref, prof) +

      '<h2 class="section">' + esc(t('add_food')) + '</h2>' +
      '<div class="log-add">' +
      '<div class="card pad photo-card"><strong>' + esc(t('snap_title')) + '</strong>' +
      '<p class="hint" style="margin:4px 0 12px">' + esc(t('snap_lede')) + '</p>' +
      '<a class="btn" href="#/snap">' + esc(t('nav_snap')) + ' &rarr;</a></div>' +
      '<div class="card pad">' +
      '<strong>' + esc(t('search_add')) + '</strong>' +
      '<div class="ingredient-add" style="margin-top:10px">' +
      '<input class="search" id="logSearch" type="search" placeholder="' +
      esc(t('search_foods')) + '" autocomplete="off" aria-label="' + esc(t('search_foods')) + '">' +
      '<div class="suggest" id="logSuggest" hidden></div></div>' +
      pickPanel() + recentChips(date) + manualForm() +
      '</div></div>' +

      '<h2 class="section">' + esc(t('eaten_on', {
        day: date >= Tracker.shift(Tracker.today(), -1) ? dayLabel(date).toLowerCase() : dayLabel(date)
      })) + '</h2>' +
      (entries.length
        ? Tracker.MEALS.map(function (meal) { return mealBlock(meal, entries, date); }).join('')
        : '<p class="empty" style="padding:24px 0">' + esc(t('log_empty')) + '</p>') +

      (entries.length ? nutrientPanel(totals, ref, prof, 1) : '') +
      supportNote();

    logState.notice = '';
    bindToday();
  }

  function daySummary(totals, target, ref, prof) {
    var hasRange = Math.round(totals.kcalHigh) - Math.round(totals.kcalLow) >= 5;
    var macro = function (k) {
      var v = totals[k] || 0;
      var tgt = k === 'kcal' ? null : ref.personal && ref.values[k];
      return '<div class="macro"><div class="v">' +
        (k === 'kcal' && hasRange ? esc(kcalText(totals.kcalLow, totals.kcalHigh)) : fmt(v)) +
        '<span class="u"> ' + (k === 'kcal' ? 'kcal' : 'g') + '</span></div>' +
        '<div class="l">' + esc(nutrientLabel(k)) +
        (tgt ? ' · ' + Math.round(v / tgt * 100) + '%' : '') + '</div></div>';
    };

    var energy = '';
    if (target) {
      var pct = totals.kcal / target * 100;
      var left = target - totals.kcal;
      energy = '<div class="log-energy">' +
        '<div class="bar log-bar"><span style="width:' + Math.min(100, Math.round(pct)) +
        '%"></span></div>' +
        '<p class="hint">' + esc(t('kcal_of_target', { n: Math.round(totals.kcal), target: target })) +
        ' ' + esc(left >= 0 ? t('kcal_left', { n: Math.round(left) }) : t('kcal_over', { n: Math.round(-left) })) +
        ' <a href="' + FIM + '#/you">' + esc(t('how_estimated')) + '</a></p></div>';
    } else if (prof && !DRI.energyApplies(prof.age)) {
      energy = '<p class="hint">' + esc(t('log_under18')) +
        ' <a href="' + FIM + '#/weight">' + esc(t('growing_title')) + '</a></p>';
    } else if (!prof) {
      energy = '<p class="hint">' + esc(t('log_no_profile')) +
        ' <a href="' + FIM + '#/you">' + esc(t('profile_title')) + ' &rarr;</a></p>';
    }

    return '<div class="card pad log-summary">' +
      '<div class="macro-row">' + Tracker.MACROS.map(macro).join('') + '</div>' + energy +
      (totals.estKcal >= 5
        ? '<p class="hint">' + esc(t('est_share', {
            est: Math.round(totals.estKcal), total: Math.round(totals.kcal)
          })) + ' ' + esc(t('range_note')) + '</p>'
        : '') +
      '</div>';
  }

  /**
   * The day (or an average day) against the reference intakes. `divisor`
   * turns summed totals into a daily average for the history page.
   */
  function nutrientPanel(totals, ref, prof, divisor, title) {
    divisor = divisor || 1;
    var uls = DRI.upperLimitsFor(prof ? prof.age : 30);
    function rows(keys) {
      return keys.map(function (k) {
        var v = (totals[k] || 0) / divisor;
        var target = ref.values[k];
        var pct = target ? v / target * 100 : null;
        var ul = uls[k];
        var warn = '';
        if (ul && v > ul.value) {
          if (k === 'sodium') warn = t('over_sodium', { ul: ul.value });
          else if (!ul.supplementOnly) warn = t('over_ul', { ul: ul.value, unit: UNIT[ul.unit] });
        }
        return '<tr' + (warn ? ' class="over"' : '') + '><th scope="row">' + esc(nutrientLabel(k)) + '</th>' +
          '<td class="num">' + fmt(v) + ' ' + esc(nutrientUnit(k)) + '</td>' +
          '<td class="num">' + (pct == null ? '—' : Math.round(pct) + '%') + '</td>' +
          '<td class="barcell"><div class="bar"><span style="width:' +
          (pct == null ? 0 : Math.min(100, Math.round(pct))) + '%"></span></div>' +
          (warn ? '<span class="warn-text">' + esc(warn) + '</span>' : '') + '</td></tr>';
      }).join('');
    }
    var table = function (title, keys) {
      return '<div class="card pad"><h3>' + esc(title) + '</h3>' +
        '<table class="dri-table"><tbody>' + rows(keys) + '</tbody></table></div>';
    };
    return '<h2 class="section">' + esc(title || t('nutrients_title')) + '</h2>' +
      '<p class="hint">' + esc(ref.personal ? t('nutrients_lede_personal') : t('nutrients_lede_generic')) +
      (ref.personal ? '' : ' <a href="' + FIM + '#/you">' + esc(t('profile_title')) + ' &rarr;</a>') +
      '</p>' +
      (totals.partialCount
        ? '<div class="note warn"><p>' + esc(t('nutrients_partial', {
            n: totals.partialCount, kcal: Math.round(totals.partialKcal / divisor)
          })) + '</p></div>'
        : '') +
      '<div class="dri-grid">' + table('Vitamins', VITAMINS) + table('Minerals', MINERALS) + '</div>' +
      '<p class="hint">' + esc(t('ul_food_note')) + '</p>';
  }

  function mealBlock(meal, entries, date) {
    var list = entries.filter(function (e) { return e.meal === meal; });
    if (!list.length) return '';
    var lo = 0, hi = 0;
    list.forEach(function (e) { var r = Tracker.kcalRange(e); lo += r[0]; hi += r[1]; });
    return '<div class="card pad log-meal">' +
      '<div class="log-meal-head"><h3>' + esc(mealLabel(meal)) + '</h3>' +
      '<span class="dim">' + esc(kcalText(lo, hi)) + ' kcal</span></div>' +
      '<ul class="log-list">' + list.map(function (e) { return entryRow(e, date); }).join('') +
      '</ul></div>';
  }

  function entryRow(e) {
    var n = Tracker.nutrientsOf(e);
    var r = Tracker.kcalRange(e);
    var food = e.slug && FOOD_BY_SLUG[e.slug];
    var est = Tracker.isEstimate(e);
    var open = logState.measuring === e.id;
    var sub = [];
    if (e.label && e.label.toLowerCase() !== e.name.toLowerCase()) sub.push(t('photo_saw', { name: e.label }));
    if (e.measured && e.measure) sub.push(t('measured') + ': ' + e.measure);
    if (est && e.gramsLow && e.gramsHigh) sub.push(t('estimate_range', { lo: Math.round(e.gramsLow), hi: Math.round(e.gramsHigh) }));
    if (est && e.plateSet) sub.push(t('plate_done', { n: fmt(e.plateAssumed) }));

    return '<li class="' + (est ? 'is-est' : '') + '">' +
      '<span class="l-name">' +
      (food ? '<a href="' + esc(fimFood(e.slug)) + '" title="' + esc(t('on_fim')) + '">' + esc(e.name) + '</a>' : esc(e.name)) +
      (e.source === 'photo' ? ' <span class="tag photo-tag">' + esc(t('from_photo')) + '</span>' : '') +
      (e.measured ? ' <span class="tag measured-tag">' + esc(t('measured')) + '</span>' : '') +
      (e.source === 'manual' ? ' <span class="tag">' + esc(t('typed_in')) + '</span>' : '') +
      sub.map(function (s) { return '<span class="l-sub">' + esc(s) + '</span>'; }).join('') +
      // An unmatched photo item has only the model's energy guess; showing
      // "0 g protein" for it would be a claim, not a blank.
      (e.per100 && !e.slug
        ? '<span class="l-sub">' + esc(t('energy_only')) + '</span>'
        : '<span class="l-sub">' + fmt(n.protein) + ' g protein · ' + fmt(n.carbs) + ' g carbohydrate · ' +
          fmt(n.fat) + ' g fat</span>') +
      '</span>' +
      (e.fixed
        ? '<span class="l-amt"></span>'
        : '<span class="l-amt"><input type="number" min="1" max="5000" step="1" ' +
          'class="amt" data-entry="' + esc(e.id) + '" value="' + esc(Math.round(e.grams)) +
          '" aria-label="' + esc(t('amount_g') + ', ' + e.name) + '"> g</span>') +
      '<span class="l-kcal">' + esc(kcalText(r[0], r[1])) + ' kcal</span>' +
      '<button class="chip" type="button" data-del="' + esc(e.id) + '" aria-label="' +
      esc(t('remove') + ' ' + e.name) + '">&times;</button>' +
      (!e.fixed && (est || open)
        ? '<div class="l-measure">' + measurePanel('entry', e.id, food, e.grams, open) +
          (est && e.photoId ? platePanel('entry', e.photoId, e.plateAssumed) : '') + '</div>'
        : '') +
      '</li>';
  }

  /** The plate-size correction, for a photo under review or one already logged. */
  function platePanel(ctx, id, assumed) {
    var key = ctx + '-' + id;
    return '<details class="measure plate"><summary>' + esc(t('plate_title')) +
      (ctx === 'entry' ? ' · ' + esc(t('whole_photo')) : '') + '</summary>' +
      '<p class="hint">' + esc(assumed ? t('plate_assumed', { n: fmt(assumed) }) : t('plate_none')) +
      ' ' + esc(t('plate_hint')) + '</p>' +
      '<div class="measure-row"><label for="pl-' + esc(key) + '">' + esc(t('plate_label')) + '</label>' +
      '<input id="pl-' + esc(key) + '" type="number" min="8" max="45" step="0.5" inputmode="decimal" value="' +
      esc(assumed || '') + '">' +
      '<button class="btn small" type="button" data-plate="' + esc(key) + '">' + esc(t('plate_apply')) +
      '</button></div></details>';
  }

  // The panel that opens once a food is picked from search: how much, and
  // which meal. Portion and serving sizes are one-tap choices because almost
  // nobody knows their roti weighs 43 g.
  function pickPanel() {
    var food = logState.pick && FOOD_BY_SLUG[logState.pick];
    if (!food) return '';
    var opts = householdUnits(food).map(function (u) { return { label: '1 ' + u.label, grams: u.grams }; });
    opts.push({ label: '100 g', grams: 100 });
    var grams = logState.pickGrams || opts[0].grams;
    var excluded = Prefs.excludedReason(food);

    return '<div class="pick-panel">' +
      foodPhoto(food) +
      '<div class="pick-head"><strong>' + esc(food.name) + '</strong> ' +
      '<span class="dim">' + fmt(food.nutrients.kcal) + ' kcal / 100 g</span> ' +
      '<a class="dim" href="' + esc(fimFood(food.slug)) + '">' + esc(t('on_fim')) + ' &rarr;</a></div>' +
      (excluded ? '<p class="hint warn-text">' + esc(t('excluded_warning')) + '</p>' : '') +
      '<div class="chips" style="margin:10px 0">' + opts.map(function (o) {
        return '<button class="chip" type="button" data-pick-grams="' + o.grams + '"' +
          ' aria-pressed="' + (Math.abs(o.grams - grams) < 0.5 ? 'true' : 'false') + '">' +
          esc(o.label) + (o.label === '100 g' ? '' : ' (' + fmt(o.grams) + ' g)') + '</button>';
      }).join('') + '</div>' +
      '<div class="field-row">' +
      '<div class="field"><label for="pickGrams">' + esc(t('amount_g')) + '</label>' +
      '<input id="pickGrams" type="number" min="1" max="5000" step="1" value="' +
      esc(Math.round(grams)) + '"></div>' +
      '<div class="field"><label for="pickMeal">' + esc(t('meal')) + '</label>' +
      mealSelect('pickMeal', currentMeal()) + '</div>' +
      '<div class="field"><label>&nbsp;</label><span class="pick-kcal" id="pickKcal">' +
      Math.round(food.nutrients.kcal * grams / 100) + ' kcal</span></div></div>' +
      '<div class="btn-row"><button class="btn" type="button" id="pickAdd">' +
      esc(t('add_to_log')) + '</button>' +
      '<button class="btn ghost" type="button" id="pickCancel">' + esc(t('cancel')) +
      '</button></div></div>';
  }

  // One-tap re-logging of foods eaten in the last fortnight.
  function recentChips(date) {
    var seen = {}, recent = [];
    for (var i = 0; i < 14 && recent.length < 10; i++) {
      Tracker.day(Tracker.shift(date, -i)).slice().reverse().forEach(function (e) {
        if (e.slug && !seen[e.slug] && FOOD_BY_SLUG[e.slug] && recent.length < 10 &&
            !Prefs.excludedReason(FOOD_BY_SLUG[e.slug])) {
          seen[e.slug] = true;
          recent.push(e);
        }
      });
    }
    if (!recent.length || logState.pick) return '';
    return '<div class="recent"><span class="label">' + esc(t('recent')) + '</span>' +
      '<div class="chips">' + recent.map(function (e) {
        return '<button class="chip" type="button" data-again="' + esc(e.slug) + '" ' +
          'data-again-grams="' + esc(e.grams) + '">' + esc(e.name) +
          ' <span class="dim">' + fmt(e.grams) + ' g</span></button>';
      }).join('') + '</div></div>';
  }

  function manualForm() {
    return '<details class="manual"><summary>' + esc(t('manual_entry')) + '</summary>' +
      '<p class="hint">' + esc(t('manual_hint')) + '</p>' +
      '<div class="field"><label for="manName">' + esc(t('food_name')) + '</label>' +
      '<input id="manName" type="text" maxlength="120"></div>' +
      '<div class="field-row" style="margin-top:12px">' +
      ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sodium'].map(function (k) {
        return '<div class="field"><label for="man_' + k + '">' + esc(nutrientLabel(k)) +
          ' (' + esc(nutrientUnit(k)) + ')</label>' +
          '<input id="man_' + k + '" type="number" min="0" step="any"></div>';
      }).join('') +
      '<div class="field"><label for="manMeal">' + esc(t('meal')) + '</label>' +
      mealSelect('manMeal', currentMeal()) + '</div></div>' +
      '<button class="btn" type="button" id="manAdd">' + esc(t('add_to_log')) + '</button>' +
      '</details>';
  }

  function bindToday() {
    function go(date) {
      location.hash = '#/today/' + (date > Tracker.today() ? Tracker.today() : date);
    }
    document.getElementById('dayPrev').addEventListener('click', function () {
      go(Tracker.shift(logState.date, -1));
    });
    document.getElementById('dayNext').addEventListener('click', function () {
      go(Tracker.shift(logState.date, 1));
    });
    document.getElementById('dayPick').addEventListener('change', function (ev) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(ev.target.value)) go(ev.target.value);
    });

    var search = document.getElementById('logSearch');
    var suggest = document.getElementById('logSuggest');
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      if (!q) { suggest.hidden = true; suggest.innerHTML = ''; return; }
      var hits = FOODS
        .filter(function (f) { return !Prefs.excludedReason(f) && haystack(f).indexOf(q) >= 0; })
        .sort(function (a, b) {
          var d = logRank(b, q) - logRank(a, q);
          return d !== 0 ? d : a.name.length - b.name.length || a.name.localeCompare(b.name);
        })
        .slice(0, 10);
      suggest.hidden = !hits.length;
      suggest.innerHTML = hits.map(function (f) {
        return '<button type="button" data-pick="' + esc(f.slug) + '">' + esc(f.name) +
          '<span class="dim"> · ' + fmt(f.nutrients.kcal) + ' kcal/100 g</span></button>';
      }).join('');
      suggest.querySelectorAll('[data-pick]').forEach(function (b) {
        b.addEventListener('click', function () {
          logState.pick = b.dataset.pick;
          logState.pickGrams = null;
          render();
          var g = document.getElementById('pickGrams');
          if (g) g.focus();
        });
      });
    });

    main.querySelectorAll('[data-pick-grams]').forEach(function (b) {
      b.addEventListener('click', function () {
        rememberMeal('pickMeal');
        logState.pickGrams = Number(b.dataset.pickGrams);
        render();
      });
    });
    var pg = document.getElementById('pickGrams');
    if (pg) {
      pg.addEventListener('input', function () {
        var food = FOOD_BY_SLUG[logState.pick];
        document.getElementById('pickKcal').textContent =
          Math.round(food.nutrients.kcal * (Number(pg.value) || 0) / 100) + ' kcal';
      });
      pg.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') document.getElementById('pickAdd').click();
      });
      document.getElementById('pickAdd').addEventListener('click', function () {
        var food = FOOD_BY_SLUG[logState.pick];
        var g = Number(pg.value);
        if (!food || !(g > 0)) return;
        rememberMeal('pickMeal');
        Tracker.add(logState.date, { food: food, grams: g, meal: logState.meal });
        logState.pick = null;
        logState.pickGrams = null;
        render();
      });
      document.getElementById('pickCancel').addEventListener('click', function () {
        logState.pick = null;
        render();
      });
    }

    main.querySelectorAll('[data-again]').forEach(function (b) {
      b.addEventListener('click', function () {
        var food = FOOD_BY_SLUG[b.dataset.again];
        if (!food) return;
        Tracker.add(logState.date, { food: food, grams: Number(b.dataset.againGrams), meal: currentMeal() });
        render();
      });
    });

    document.getElementById('manAdd').addEventListener('click', function () {
      var name = document.getElementById('manName').value.trim();
      var kcalEl = document.getElementById('man_kcal');
      if (!name || kcalEl.value === '' || !(Number(kcalEl.value) >= 0)) {
        document.getElementById(name ? 'man_kcal' : 'manName').focus();
        return;
      }
      var fixed = {};
      ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sodium'].forEach(function (k) {
        var v = document.getElementById('man_' + k).value;
        if (v !== '') fixed[k] = Number(v) || 0;
      });
      rememberMeal('manMeal');
      Tracker.add(logState.date, { name: name, fixed: fixed, meal: logState.meal });
      render();
    });

    main.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        Tracker.remove(logState.date, b.dataset.del);
        render();
      });
    });
    main.querySelectorAll('input[data-entry]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var g = Number(inp.value);
        if (g > 0) Tracker.update(logState.date, inp.dataset.entry, { grams: g, measure: t('measure_typed') });
        render();
      });
    });

    // Measuring logged entries.
    function entryFromKey(key) { return Tracker.find(logState.date, key.replace(/^entry-/, '')); }
    main.querySelectorAll('[data-mweigh^="entry-"], [data-munit^="entry-"]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.dataset.mweigh || b.dataset.munit;
        var e = entryFromKey(key);
        if (!e) return;
        var m = readMeasure(key, b.dataset.mweigh ? 'weigh' : 'unit', e.slug && FOOD_BY_SLUG[e.slug]);
        if (!m) return;
        Tracker.update(logState.date, e.id, { grams: m.grams, measure: m.label });
        logState.measuring = null;
        render();
      });
    });
    main.querySelectorAll('[data-plate^="entry-"]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.dataset.plate;
        var cm = Number(document.getElementById('pl-' + key).value);
        if (cm >= 8 && cm <= 45) {
          Tracker.rescalePhoto(logState.date, key.replace(/^entry-/, ''), cm);
          render();
        }
      });
    });
  }

  // ======================================================================
  // View: snap a meal
  // ======================================================================

  // Foods a photo item might be. The model's own name is tried whole first,
  // then its short search words; cooked foods are preferred when the plate is
  // cooked, because the raw and dry records are two to three times as
  // energy-dense as what is actually on a plate.
  var VAGUE_WORD = /^(fried|deep|cooked|boiled|baked|roasted|grilled|steamed|stewed|raw|fresh|plain|white|brown|red|green|yellow|mixed|mix|dip|sauce|gravy|curry|side|dish|style|fry|food|meal|plate|bowl|small|large|piece|pieces|slice|slices|and|with|of|in|the|homemade)$/;

  /** A name without its parenthetical aside or trailing state: "dal (yellow lentil curry)" -> "dal". */
  function mainName(name) {
    return String(name || '').replace(/\([^)]*\)/g, ' ').split(',')[0].replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * The word a food name is about: its last meaningful word, before any
   * "with", "in" or "on" -- "tea with milk" is tea, not milk.
   */
  function headWord(phrase) {
    var core = mainName(phrase).split(/\s+(?:with|in|on|over|topped)\s+/)[0];
    var words = core.split(/[\s\-]+/).filter(function (w) {
      return w.length >= 3 && !VAGUE_WORD.test(w);
    });
    return words.length ? words[words.length - 1] : '';
  }

  // Dishes made of several foods. The model's own energy estimate for "a
  // bacon cheeseburger" or "salmon nigiri" is better than any single USDA
  // ingredient here, which would count 280 g of burger as bacon or nigiri as
  // plain fish. They are matched only to a food that is itself that dish.
  var DISH = /(cheeseburger|hamburger|burger|sandwich|\bwrap\b|\bcurry\b|\bsoup\b|\bstew\b|chowder|pizza|\bpie\b|lasagn|casserole|biryani|pulao|pilaf|risotto|paella|fried rice|kofta|masala|makhani|korma|tikka|\bsauce\b|bolognese|stir.fry|\bsalad\b|\btaco|burrito|dumpling|ramen|\bpho\b|sushi|nigiri|\bmaki\b|\broll\b)/;

  function photoMatches(item) {
    var queries = [];
    function addQ(q, bonus, whole) {
      q = q.trim().toLowerCase();
      if (q.length >= 3 && !queries.some(function (x) { return x.q === q; })) {
        queries.push({
          q: q, bonus: bonus,
          // Single words must match a whole word: "bread" is not breadfruit.
          re: whole ? new RegExp('(^|[^a-z])' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z])') : null
        });
      }
    }
    addQ(item.name, 10);
    var main = mainName(item.name);
    addQ(main, 5);
    // "Raita/Yogurt dip" is two guesses at one thing: try each.
    main.split('/').forEach(function (alt) { addQ(alt, 5); });
    // A one-word search must match a whole word: "dal" is not "dalia" (bulgur).
    addQ(item.search || '', 0, !/\s/.test((item.search || '').trim()));
    // Single words are a last resort, and only the word a name is about can
    // stand alone. In "black pudding" that is "pudding", not "black" (which
    // finds black-eyed peas); in "french fries" it is "fries", not "french"
    // (dry french beans); in "malai kofta" it is "kofta", not "malai" (cream).
    // Cooking words never stand alone: "fried" finds a fried egg.
    main.split('/').concat([item.search || '']).forEach(function (phrase) {
      var h = headWord(phrase);
      if (h) addQ(h, -15, true);
    });

    var COOKED = /\b(cooked|boiled|baked|fried|scrambled|roasted|porridge)\b/;
    return FOODS.map(function (f) {
      // Foods outside the person's dietary settings are never offered.
      if (Prefs.excludedReason(f)) return null;
      var hay = haystack(f), best = -Infinity;
      queries.forEach(function (x) {
        if (x.re ? x.re.test(hay) : hay.indexOf(x.q) >= 0) {
          var r = relevance(f, x.q);
          // A whole-word query should not earn relevance's prefix score.
          if (x.re && r === 90 && !x.re.test(f.name.toLowerCase())) r = 30;
          // Same main word, same kind of food: "jeera rice" is rice, and
          // "White rice" is about rice where "Rice noodles" is about noodles.
          if (x.re) {
            if (f._head == null) f._head = headWord(f.name);
            if (f._head === x.q) r += 15;
          }
          best = Math.max(best, r + x.bonus);
        }
      });
      if (best === -Infinity) return null;
      var isCooked = (f.tags || []).indexOf('cooked') >= 0 || COOKED.test(f.name.toLowerCase());
      if (item.cooked && isCooked) best += 15;
      if (!item.cooked && isCooked) best -= 10;
      if (NOT_EATEN_AS_IS.test(f.name.toLowerCase())) best -= 10;
      // Plain names beat long USDA-style descriptions at equal relevance.
      best -= Math.min(10, f.name.length / 8);
      return { slug: f.slug, score: best };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, 6);
  }

  // Whether the best candidate is safe to pick without asking. A search for
  // "curry" finds curry powder, and "fried bread" finds a flour: plausible
  // words, absurd foods for 200 g on a plate. So a spice, powder, flour or oil
  // is never chosen for a sizeable portion, and the match's energy density has
  // to be within a factor of two of what the model itself expected. Anything
  // that fails stays unmatched -- labelled, using the model's own estimate --
  // with the candidates still offered in the menu.
  var NOT_A_PORTION = /\b(powder|seasoning|spice|flour|meal|bran|oil|extract|dried|dry|mix)\b/;
  // A cooked portion is never the raw or dry form of a grain, pulse or nut:
  // those are two to three times as energy-dense. ("french fries" once landed
  // on dry french beans.)
  var DRY_FORM = /\b(raw|dry|dried|uncooked|mature seeds|flour)\b/;
  // How far the match's energy density may stray from the model's own
  // estimate. Wider than this and it is usually a different preparation:
  // plain paneer (321 kcal/100 g) for paneer makhani (about 180).
  var DENSITY_TOLERANCE = 1.6;

  function autoMatch(it, m) {
    if (!m.length || m[0].score < 40) return null;
    var dish = DISH.exec(mainName(it.name));
    var ok = [];
    // Walk down the list past unsuitable candidates, but only while they are
    // nearly as good a match as the best: a distant runner-up is a guess.
    for (var i = 0; i < m.length && m[i].score >= Math.max(40, m[0].score - 20); i++) {
      var f = FOOD_BY_SLUG[m[i].slug];
      var text = (f.name + ' ' + (f.usda || '')).toLowerCase();
      // A dish only matches a food that is itself that dish by name -- not by
      // an alias: ground beef is also called "hamburger", a burger is not.
      if (dish && text.indexOf(dish[1]) < 0) continue;
      // Herbs are seasoning, not a portion -- including those filed as
      // vegetables, like epazote ("Mexican tea", once matched to a cup of tea).
      var herb = f.group === 'herb' || (f.tags || []).indexOf('herb') >= 0;
      if (it.grams > 30 && (herb || NOT_A_PORTION.test(f.name.toLowerCase()))) continue;
      // USDA calls cooked pulses "mature seeds, cooked, boiled": only a form
      // that is not also described as cooked counts as dry.
      if (it.cooked && /^(grain|legume|nut)$/.test(f.group) && DRY_FORM.test(text) &&
          !/\b(cooked|boiled|baked|roasted|fried|canned|prepared)\b/.test(text)) continue;
      var k = f.nutrients.kcal || 0;
      if (it.kcalPer100 && k && (k / it.kcalPer100 > DENSITY_TOLERANCE || it.kcalPer100 / k > DENSITY_TOLERANCE)) continue;
      ok.push({ f: f, score: m[i].score, k: k });
    }
    if (!ok.length) return null;
    // Among near-equal matches, prefer the one whose energy density is
    // closest to what the model expected: farmed salmon for sashimi it put at
    // 208 kcal/100 g rather than lean chum salmon.
    var near = ok.filter(function (c) { return c.score >= ok[0].score - 8; });
    if (it.kcalPer100) {
      near.sort(function (a, b) {
        return Math.abs(Math.log((a.k || 1) / it.kcalPer100)) - Math.abs(Math.log((b.k || 1) / it.kcalPer100));
      });
    }
    return near[0].f.slug;
  }

  function prepareItems(items) {
    return items.map(function (it) {
      var m = photoMatches(it);
      return {
        name: it.name, cooked: it.cooked, confidence: it.confidence, kcalPer100: it.kcalPer100,
        grams: it.grams, gramsLow: it.gramsLow, gramsHigh: it.gramsHigh,
        candidates: m.map(function (x) { return x.slug; }),
        // A food the model says is outside the diet keeps its own estimate:
        // the compatible foods on offer would describe it wrongly.
        slug: it.conflict ? null : autoMatch(it, m),
        conflict: it.conflict || '', allergens: it.allergens || [],
        include: true, measured: false, measure: ''
      };
    });
  }

  function itemPer100(it) {
    if (it.slug && FOOD_BY_SLUG[it.slug]) return FOOD_BY_SLUG[it.slug].nutrients.kcal || 0;
    return it.kcalPer100 || 0;
  }

  // ---- dietary settings (shared with Food is Medicine) ---------------------

  /** The person's dietary settings, in the shape Photo.buildPrompt takes. */
  function dietOpts() {
    var p = Prefs.get();
    return {
      diet: p.diet,
      allergens: (p.allergens || []).slice(),
      custom: String(p.customExclude || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean)
    };
  }

  /** "vegetarian · no peanuts · no mushroom", or '' with no restrictions. */
  function dietSummary() {
    var d = dietOpts(), parts = [];
    if (d.diet && d.diet !== 'none') parts.push(t('diet_' + d.diet).toLowerCase());
    d.allergens.forEach(function (a) { parts.push(t('no_x', { x: t('a_' + a).toLowerCase() })); });
    d.custom.forEach(function (c) { parts.push(t('no_x', { x: c })); });
    return parts.join(' · ');
  }

  /**
   * The person's allergens a photo item may contain: what the model flagged,
   * plus the allergen tags of the food it is matched to.
   */
  function itemAllergens(it) {
    var mine = Prefs.get().allergens || [];
    var out = (it.allergens || []).slice();
    var f = it.slug && FOOD_BY_SLUG[it.slug];
    if (f) (f.allergens || []).forEach(function (a) { if (out.indexOf(a) < 0) out.push(a); });
    return out.filter(function (a) { return mine.indexOf(a) >= 0; });
  }

  // ---- photo engines -------------------------------------------------------
  //   free  -- Gemini through Food Log's Firebase project, no key (default)
  //   key   -- Gemini with the visitor's own key, a separate allowance
  //   local -- Gemma 4 E2B on this device
  var ENGINE_KEY = 'foodlog.engine';
  var Config = window.FoodLogConfig || {};
  var FirebaseEngine = window.FirebaseEngine;

  function enginePref() {
    var v;
    try { v = localStorage.getItem(ENGINE_KEY) || ''; } catch (e) { v = ''; }
    return v === 'gemini' ? 'key' : v;   // the name before the free engine existed
  }

  function localReady() {
    return !!LocalModel && (LocalModel.isDownloaded() || LocalModel.state().status === 'ready');
  }

  /** The engines this visitor can use right now, default first. */
  function engineList() {
    var out = [];
    if (FirebaseEngine && FirebaseEngine.available()) out.push('free');
    if (Gemini.hasKey()) out.push('key');
    if (localReady()) out.push('local');
    return out;
  }

  /** Which engine a new photo uses, or null if none is available. */
  function engineChoice() {
    var list = engineList(), pref = enginePref();
    if (list.indexOf(pref) >= 0) return pref;
    return list[0] || null;
  }

  function modelName(id) {
    return (Config.MODEL_NAMES && Config.MODEL_NAMES[id]) || id;
  }

  var localCaps = null;

  function fmtGb(bytes) { return (bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1); }

  // The on-device model's card: what it is, whether this device can run it,
  // and download / load / delete with progress. Used on Settings and on the
  // Snap page when no engine is set up yet.
  function localCardInner() {
    var st = LocalModel.state();
    var c = localCaps;
    var gb = c && c.sizeGb ? c.sizeGb : 3.4;
    var html = '<h2>' + esc(t('local_title')) + '</h2>' +
      '<p class="hint">' + esc(t('local_lede', { gb: gb })) + '</p>';
    if (!c) return html + '<p class="hint">' + esc(t('local_checking')) + '</p>';
    if (!c.ok) return html + '<div class="note warn"><p>' + esc(c.reason) + '</p></div>';
    html += (c.warnings || []).map(function (w) {
      return '<p class="hint warn-text">' + esc(w) + '</p>';
    }).join('');
    var btn = function (act, label, ghost) {
      return '<button class="btn' + (ghost ? ' ghost' : '') + '" type="button" data-local="' + act + '">' +
        esc(label) + '</button>';
    };
    if (st.status === 'downloading' || st.status === 'loading') {
      var total = st.total || gb * 1e9;
      var pct = Math.min(100, Math.round(st.loaded / total * 100));
      html += '<div class="bar log-bar local-bar"><span style="width:' +
        (st.status === 'downloading' ? pct : 100) + '%"></span></div>' +
        '<p class="hint local-progress">' + esc(st.status === 'downloading'
          ? t('local_downloading', { done: fmtGb(st.loaded), gb: gb })
          : t('local_loading')) + '</p>' +
        '<div class="btn-row">' + btn('stop', t('local_stop'), true) + '</div>';
    } else if (st.status === 'ready') {
      html += '<p>' + esc(t('local_ready')) + '</p>' +
        (st.notCached ? '<p class="hint warn-text">' + esc(t('local_not_cached')) + '</p>' : '') +
        '<div class="btn-row">' +
        btn('delete', t('local_delete'), true) + '</div>';
    } else if (st.status === 'cached') {
      html += '<p>' + esc(t('local_cached')) + '</p><div class="btn-row">' +
        btn('load', t('local_load_now'), true) + btn('delete', t('local_delete'), true) + '</div>';
    } else if (st.status === 'error') {
      html += '<div class="note danger"><p>' + esc(t('local_error', { msg: st.error })) + '</p></div>' +
        '<div class="btn-row">' + btn('load', t('local_try_again')) +
        btn('delete', t('local_delete'), true) + '</div>';
    } else {
      html += '<div class="btn-row">' + btn('load', t('local_download', { gb: gb })) + '</div>';
    }
    return html;
  }

  function refreshLocalCards() {
    document.querySelectorAll('.local-card').forEach(function (el) {
      el.innerHTML = localCardInner();
      el.querySelectorAll('[data-local]').forEach(function (b) {
        b.addEventListener('click', function () {
          var act = b.dataset.local;
          if (act === 'load') LocalModel.load().catch(function () { /* shown via state */ });
          else if (act === 'stop') LocalModel.stop();
          else if (act === 'delete') LocalModel.remove().then(refreshLocalCards);
        });
      });
    });
  }

  function bindLocalCards() {
    if (!LocalModel || !document.querySelector('.local-card')) return;
    refreshLocalCards();
    if (!localCaps) LocalModel.check().then(function (c) { localCaps = c; refreshLocalCards(); });
  }

  var lastLocalStatus = LocalModel ? LocalModel.state().status : null;
  if (LocalModel) {
    LocalModel.onChange(function (st) {
      var changed = st.status !== lastLocalStatus;
      lastLocalStatus = st.status;
      // A finished download makes the engine available: redraw the Snap page
      // so it offers it, unless a photo is being read right now.
      if (changed && route.name === 'snap' && snap.status !== 'busy') { render(); return; }
      if (changed) { refreshLocalCards(); return; }
      var bar = document.querySelector('.local-bar span');
      var txt = document.querySelector('.local-progress');
      if (bar && st.status === 'downloading') {
        var total = st.total || 3.4e9;
        bar.style.width = Math.min(100, Math.round(st.loaded / total * 100)) + '%';
        if (txt) txt.textContent = t('local_downloading', {
          done: fmtGb(st.loaded), gb: localCaps && localCaps.sizeGb || 3.4
        });
      }
    });
  }

  function viewSnap() {
    main.innerHTML = '<div class="page-head"><h1>' + esc(t('snap_title')) + '</h1>' +
      '<p>' + esc(t('snap_lede')) + '</p></div>' + snapBody() +
      '<p class="hint" style="margin-top:16px">' + esc(t('snap_accuracy')) + '</p>' + supportNote();
    bindSnap();
  }

  function snapBody() {
    var engine = engineChoice();
    if (!engine && snap.status !== 'review') {
      return '<p>' + esc(t('snap_setup')) + '</p><div class="log-add">' +
        '<div class="card pad"><h2>' + esc(t('snap_setup_gemini')) + '</h2>' +
        '<p class="hint">' + esc(t('snap_setup_gemini_lede')) + '</p>' +
        '<div class="btn-row"><a class="btn" href="#/settings">' + esc(t('nav_settings')) + ' &rarr;</a>' +
        '<a href="' + esc(Gemini.STUDIO_URL) + '" rel="noopener" target="_blank">' +
        esc(t('get_free_key')) + '</a></div></div>' +
        (LocalModel ? '<div class="card pad local-card"></div>' : '') + '</div>';
    }
    if (snap.status === 'busy') {
      return '<div class="card pad"><div class="photo-row">' +
        (snap.dataUrl ? '<img class="photo-thumb" src="' + esc(snap.dataUrl) + '" alt="">' : '') +
        '<div><p id="snapStatus">' + esc(snap.engine === 'local' ? localStatusText(snap.localStatus)
          : snap.only ? t('stronger_busy', { model: modelName(snap.only) }) : t('snap_busy')) +
        '</p>' + (snap.engine === 'local' ? '<p class="hint">' + esc(t('snap_local_slow')) + '</p>' : '') +
        '</div></div></div>';
    }
    if (snap.status === 'review') return snapReview();

    var engines = engineList();
    return '<div class="card pad">' +
      (engines.length > 1
        ? '<div class="field" style="margin-bottom:12px"><span class="label-text">' + esc(t('engine_label')) + '</span>' +
          '<div class="chips" role="group" aria-label="' + esc(t('engine_label')) + '">' +
          engines.map(function (e) {
            return '<button class="chip" type="button" data-engine="' + e + '" aria-pressed="' + (e === engine) + '">' +
              esc(t('engine_' + e)) + '</button>';
          }).join('') + '</div></div>'
        : '') +
      (snap.status === 'error'
        ? '<div class="note danger"><p>' + esc(snap.error) + '</p>' +
          (snap.errorCode === 'ALL_SPENT' ? '<p>' + esc(t('all_spent_help')) +
            ' <a href="#/settings">' + esc(t('nav_settings')) + ' &rarr;</a></p>' : '') + '</div>'
        : '') +
      (dietSummary()
        ? '<p class="hint">' + esc(t('reading_for', { list: dietSummary() })) +
          ' <a href="#/settings">' + esc(t('change')) + '</a></p>'
        : '') +
      '<div class="field" style="margin-bottom:12px"><label for="photoHint">' +
      esc(t('snap_hint_label')) + '</label>' +
      '<input id="photoHint" type="text" maxlength="200" value="' + esc(snap.hint) +
      '" placeholder="' + esc(t('snap_hint_placeholder')) + '"></div>' +
      '<div class="btn-row">' +
      '<label class="btn file-btn">' + esc(t('take_photo')) +
      '<input type="file" accept="image/*" capture="environment" id="photoCam" hidden></label>' +
      '<label class="btn ghost file-btn">' + esc(t('choose_photo')) +
      '<input type="file" accept="image/*" id="photoFile" hidden></label></div>' +
      '<p class="hint" style="margin-top:10px">' + esc(t('card_tip')) + '</p>' +
      '<p class="hint" style="margin-top:10px">' +
      esc(engine === 'local' ? t('snap_local_privacy') + ' ' + t('snap_local_slow')
        : engine === 'free' ? t('snap_free_privacy') : t('snap_privacy')) +
      '</p></div>';
  }

  function localStatusText(s) {
    if (!s || s.phase === 'loading') return t('snap_local_loading');
    if (s.phase === 'writing') return t('snap_local_writing', { n: s.count });
    return t('snap_local_reading');
  }

  function snapReview() {
    var lo = 0, hi = 0, mid = 0, nIn = 0, nMeasured = 0;
    snap.items.forEach(function (it) {
      if (!it.include) return;
      var k = itemPer100(it) / 100;
      lo += k * it.gramsLow; hi += k * it.gramsHigh; mid += k * it.grams;
      nIn++;
      if (it.measured) nMeasured++;
    });

    return '<div class="card pad photo-card">' +
      '<strong>' + esc(t('snap_review')) + '</strong>' +
      '<div class="photo-row" style="margin-top:10px">' +
      '<img class="photo-thumb" src="' + esc(snap.dataUrl) + '" alt="">' +
      '<div><div class="photo-total">' + esc(kcalText(lo, hi)) + ' <span class="u">kcal</span></div>' +
      '<p class="hint" style="margin:2px 0 0">' + esc(t('snap_best_guess', { n: Math.round(mid) })) +
      (nIn ? ' ' + esc(t('snap_measured_share', { m: nMeasured, n: nIn })) : '') + '</p>' +
      (snap.notes ? '<p class="hint" style="margin:6px 0 0">' + esc(snap.notes) + '</p>' : '') +
      (snap.model ? '<p class="hint" style="margin:6px 0 0">' + esc(t('read_by', { model: modelName(snap.model) })) +
        (snap.scale === 'card' ? ' ' + esc(t('scaled_card')) : '') + '</p>' : '') +
      (snap.engine !== 'local' && snap.file && Config.STRONGER && snap.model !== Config.STRONGER
        ? '<button class="btn ghost small" type="button" id="photoStronger" style="margin-top:8px">' +
          esc(t('try_stronger', { model: modelName(Config.STRONGER) })) + '</button>'
        : '') +
      '</div></div>' +
      (snap.strongerError ? '<div class="note warn"><p>' + esc(snap.strongerError) + '</p></div>' : '') +
      ((Prefs.get().allergens || []).length
        ? '<p class="hint warn-text">' + esc(t('allergy_disclaimer')) + '</p>' : '') +
      // A card in the photo is a better scale than any plate size typed in.
      (snap.items.length && snap.scale !== 'card' ? platePanel('review', 'photo', snap.plateCm) : '') +
      (snap.plateNotice ? '<p class="hint">' + esc(snap.plateNotice) + '</p>' : '') +
      (snap.items.length
        ? '<ul class="photo-items">' + snap.items.map(itemRow).join('') + '</ul>'
        : '<p class="empty" style="padding:16px 0">' + esc(t('snap_nothing')) + '</p>') +
      '<div class="field-row" style="margin-top:14px">' +
      '<div class="field"><label for="photoMeal">' + esc(t('meal')) + '</label>' +
      mealSelect('photoMeal', currentMeal()) + '</div>' +
      '<div class="field"><label for="photoDate">' + esc(t('choose_day')) + '</label>' +
      '<input id="photoDate" type="date" value="' + esc(logState.date || Tracker.today()) +
      '" max="' + esc(Tracker.today()) + '"></div></div>' +
      '<div class="btn-row">' +
      '<button class="btn" type="button" id="photoAdd"' + (nIn ? '' : ' disabled') + '>' +
      esc(t('add_to_log')) + '</button>' +
      '<button class="btn ghost" type="button" id="photoDiscard">' + esc(t('discard')) +
      '</button></div></div>';
  }

  function itemRow(it, i) {
    var per100 = itemPer100(it);
    var food = it.slug && FOOD_BY_SLUG[it.slug];
    // A matched food whose energy density is far from what the model expected
    // is usually the wrong form of the right food -- dry lentils for cooked dal.
    var mismatch = food && it.kcalPer100 &&
      (per100 / it.kcalPer100 > 2.2 || it.kcalPer100 / per100 > 2.2);

    return '<li class="' + (it.include ? '' : 'off') + '">' +
      '<label class="p-inc"><input type="checkbox" data-pinc="' + i + '"' +
      (it.include ? ' checked' : '') + ' aria-label="' + esc(t('include') + ' ' + it.name) + '"></label>' +
      '<div class="p-main">' +
      '<div class="p-name">' + esc(it.name) +
      (it.conflict
        ? ' <span class="tag warn-tag">' + esc((Prefs.get().diet && Prefs.get().diet !== 'none'
            ? t('not_diet', { diet: t('diet_' + Prefs.get().diet).toLowerCase() }) + ': '
            : '') + it.conflict) + '</span>'
        : '') +
      itemAllergens(it).map(function (a) {
        return ' <span class="tag warn-tag">' + esc(t('may_contain', { x: t('a_' + a).toLowerCase() })) + '</span>';
      }).join('') +
      (it.confidence === 'low' ? ' <span class="tag warn-tag">' + esc(t('unsure')) + '</span>' : '') +
      (it.measured ? ' <span class="tag measured-tag">' + esc(t('measured')) + '</span>' : '') +
      '</div>' +
      '<select data-pmatch="' + i + '" aria-label="' + esc(t('match_as') + ': ' + it.name) + '">' +
      it.candidates.map(function (s) {
        var f = FOOD_BY_SLUG[s];
        return '<option value="' + esc(s) + '"' + (s === it.slug ? ' selected' : '') + '>' +
          esc(f.name) + ' — ' + fmt(f.nutrients.kcal) + ' kcal/100 g</option>';
      }).join('') +
      '<option value=""' + (it.slug ? '' : ' selected') + '>' +
      esc(t('model_estimate', { n: it.kcalPer100 ? Math.round(it.kcalPer100) : '?' })) +
      '</option></select>' +
      '<div class="ingredient-add p-search"><input class="search" type="search" data-psearch="' + i +
      '" placeholder="' + esc(t('change_match')) + '" aria-label="' + esc(t('change_match') + ': ' + it.name) +
      '" autocomplete="off"><div class="suggest" data-psuggest="' + i + '" hidden></div></div>' +
      (mismatch
        ? '<p class="hint warn-text">' + esc(t('snap_mismatch', {
            usda: Math.round(per100), model: Math.round(it.kcalPer100)
          })) + '</p>'
        : '') +
      (!it.slug ? '<p class="hint">' + esc(t('snap_no_match')) + '</p>' : '') +
      (it.measured && it.measure ? '<p class="hint">' + esc(t('measured') + ': ' + it.measure) + '</p>' : '') +
      measurePanel('review', i, food, it.grams, snap.openMeasure === i) +
      '</div>' +
      '<div class="p-amt"><span class="p-g"><input type="number" min="1" max="2000" step="1" ' +
      'data-pgrams="' + i + '" value="' + esc(it.grams) + '" aria-label="' + esc(t('amount_g') + ', ' + it.name) +
      '"> g</span>' +
      (!it.measured && it.gramsHigh > it.gramsLow
        ? '<span class="l-sub">' + esc(it.gramsLow + '–' + it.gramsHigh + ' g') + '</span>'
        : '') + '</div>' +
      '<div class="p-kcal">' + esc(kcalText(per100 * it.gramsLow / 100, per100 * it.gramsHigh / 100)) +
      ' kcal</div></li>';
  }

  function setMeasured(it, grams, label) {
    var g = Math.round(Math.min(grams, 2000));
    if (!(g > 0)) return;
    it.grams = it.gramsLow = it.gramsHigh = g;
    it.measured = true;
    it.measure = label;
  }

  /**
   * Read a photo. opts.only pins one model ("Try a stronger model"); the
   * engine then stays the one that read the photo the first time.
   */
  function startPhoto(file, opts) {
    if (!file) return;
    opts = opts || {};
    var hintEl = document.getElementById('photoHint');
    if (hintEl) snap.hint = hintEl.value;
    var engine = opts.engine || engineChoice();
    if (!engine) return;
    var before = opts.only ? snap : null;   // kept if the stronger model fails
    snap = { status: 'busy', dataUrl: before ? before.dataUrl : '', hint: snap.hint, engine: engine,
             localStatus: null, only: opts.only || null, file: file };
    // Show the picture straight away so the wait has something to look at.
    if (!before) {
      Photo.prepare(file).then(function (img) {
        if (snap.status === 'busy') { snap.dataUrl = img.dataUrl; if (route.name === 'snap') render(); }
      }, function () { /* analyse() reports the same error */ });
    }
    render();

    var popts = { hint: snap.hint, model: opts.only || undefined, diet: dietOpts() };
    if (engine === 'key' && !popts.model && Gemini.getPreference() !== Gemini.AUTO) {
      popts.model = Gemini.getPreference();   // a model chosen by hand on Food is Medicine
    }
    var job = engine === 'local'
      ? LocalModel.analyse(file, { hint: snap.hint, diet: dietOpts() }, function (s) {
          if (snap.status !== 'busy') return;
          snap.localStatus = s;
          var el = document.getElementById('snapStatus');
          if (el) el.textContent = localStatusText(s);
        })
      : Photo.analyseWith(engine === 'free' ? FirebaseEngine.engine : Gemini.engine, file, popts);
    job.then(function (res) {
      snap = {
        status: 'review', dataUrl: res.dataUrl, notes: res.notes, hint: snap.hint, engine: engine,
        model: res.model || null, file: file, scale: res.scale || '',
        plateCm: res.plateCm, items: prepareItems(res.items), photoId: Tracker.newId()
      };
    }).catch(function (err) {
      var msg = err && err.message ? err.message : String(err);
      if (before) {
        snap = before;
        snap.strongerError = t('stronger_failed', { msg: msg });
      } else {
        snap = { status: 'error', error: msg, errorCode: err && err.code, hint: snap.hint };
      }
    }).then(function () {
      if (route.name === 'snap') render();
    });
  }

  function bindSnap() {
    bindLocalCards();
    main.querySelectorAll('[data-engine]').forEach(function (b) {
      b.addEventListener('click', function () {
        try { localStorage.setItem(ENGINE_KEY, b.dataset.engine); } catch (e) { /* ignore */ }
        var h = document.getElementById('photoHint');
        if (h) snap.hint = h.value;
        render();
      });
    });
    ['photoCam', 'photoFile'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', function () { startPhoto(el.files && el.files[0]); });
    });
    if (snap.status !== 'review') return;

    main.querySelectorAll('[data-pinc]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        rememberMeal('photoMeal');
        snap.items[Number(cb.dataset.pinc)].include = cb.checked;
        render();
      });
    });
    main.querySelectorAll('[data-pmatch]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        rememberMeal('photoMeal');
        snap.items[Number(sel.dataset.pmatch)].slug = sel.value || null;
        render();
      });
    });
    // Re-match an item by searching the whole list: the model's word for a
    // dish ("curry") may not be the food it was ("dal").
    main.querySelectorAll('[data-psearch]').forEach(function (inp) {
      var i = Number(inp.dataset.psearch);
      var box = main.querySelector('[data-psuggest="' + i + '"]');
      inp.addEventListener('input', function () {
        var q = inp.value.trim().toLowerCase();
        if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
        var hits = FOODS.filter(function (f) { return !Prefs.excludedReason(f) && haystack(f).indexOf(q) >= 0; })
          .sort(function (a, b) { return logRank(b, q) - logRank(a, q) || a.name.length - b.name.length; })
          .slice(0, 8);
        box.hidden = !hits.length;
        box.innerHTML = hits.map(function (f) {
          return '<button type="button" data-pset="' + esc(f.slug) + '">' + esc(f.name) +
            '<span class="dim"> · ' + fmt(f.nutrients.kcal) + ' kcal/100 g</span></button>';
        }).join('');
        box.querySelectorAll('[data-pset]').forEach(function (b) {
          b.addEventListener('click', function () {
            var it = snap.items[i];
            it.slug = b.dataset.pset;
            if (it.candidates.indexOf(it.slug) < 0) it.candidates.unshift(it.slug);
            rememberMeal('photoMeal');
            render();
          });
        });
      });
    });
    main.querySelectorAll('[data-pgrams]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        // A weight the person typed is theirs, not a guess: the range goes.
        setMeasured(snap.items[Number(inp.dataset.pgrams)], Number(inp.value), t('measure_typed'));
        rememberMeal('photoMeal');
        render();
      });
    });
    main.querySelectorAll('[data-mweigh^="review-"], [data-munit^="review-"]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.dataset.mweigh || b.dataset.munit;
        var i = Number(key.replace(/^review-/, ''));
        var it = snap.items[i];
        var m = readMeasure(key, b.dataset.mweigh ? 'weigh' : 'unit', it.slug && FOOD_BY_SLUG[it.slug]);
        if (!m) return;
        setMeasured(it, m.grams, m.label);
        snap.openMeasure = null;
        rememberMeal('photoMeal');
        render();
      });
    });
    main.querySelectorAll('details.measure[data-mkey^="review-"]').forEach(function (d) {
      d.addEventListener('toggle', function () {
        if (d.open) snap.openMeasure = Number(d.dataset.mkey.replace(/^review-/, ''));
      });
    });
    var stronger = document.getElementById('photoStronger');
    if (stronger) {
      stronger.addEventListener('click', function () {
        rememberMeal('photoMeal');
        startPhoto(snap.file, { only: Config.STRONGER, engine: snap.engine });
      });
    }
    var plateBtn = main.querySelector('[data-plate="review-photo"]');
    if (plateBtn) {
      plateBtn.addEventListener('click', function () {
        var cm = Number(document.getElementById('pl-review-photo').value);
        if (!(cm >= 8 && cm <= 45)) return;
        var f = Tracker.plateFactor(snap.plateCm || 26, cm);
        snap.items.forEach(function (it) {
          if (it.measured) return;
          it.grams = Math.max(1, Math.round(it.grams * f));
          it.gramsLow = Math.max(1, Math.round(it.gramsLow * f));
          it.gramsHigh = Math.max(1, Math.round(it.gramsHigh * f));
        });
        snap.plateCm = cm;
        snap.plateNotice = t('plate_done', { n: fmt(cm) });
        rememberMeal('photoMeal');
        render();
      });
    }
    document.getElementById('photoAdd').addEventListener('click', function () {
      rememberMeal('photoMeal');
      var dateEl = document.getElementById('photoDate');
      var date = dateEl && /^\d{4}-\d{2}-\d{2}$/.test(dateEl.value) && dateEl.value <= Tracker.today()
        ? dateEl.value : Tracker.today();
      snap.items.forEach(function (it) {
        if (!it.include) return;
        var food = it.slug && FOOD_BY_SLUG[it.slug];
        var base = {
          grams: it.grams, gramsLow: it.gramsLow, gramsHigh: it.gramsHigh,
          meal: logState.meal, source: 'photo', label: it.name, photoId: snap.photoId,
          plateAssumed: snap.plateCm || 26,
          measured: it.measured, measure: it.measure
        };
        if (food) base.food = food;
        else { base.name = it.name; base.per100 = { kcal: it.kcalPer100 || 0 }; }
        Tracker.add(date, base);
      });
      snap = { status: null, hint: '' };
      location.hash = '#/today/' + date;
    });
    document.getElementById('photoDiscard').addEventListener('click', function () {
      snap = { status: null, hint: '' };
      render();
    });
  }

  // ======================================================================
  // View: history
  // ======================================================================
  function viewHistory() {
    var n = histState.days;
    var end = Tracker.today();
    var days = Tracker.history(end, n);
    var logged = days.filter(function (d) { return d.count; });
    var target = energyTarget();
    var sum = { partialCount: 0, partialKcal: 0 };
    Tracker.TRACKED.forEach(function (k) { sum[k] = 0; });
    logged.forEach(function (d) {
      Tracker.TRACKED.forEach(function (k) { sum[k] += d[k] || 0; });
      sum.partialCount += d.partialCount;
      sum.partialKcal += d.partialKcal;
    });

    main.innerHTML =
      '<div class="page-head"><h1>' + esc(t('history_title')) + '</h1>' +
      '<p>' + esc(t('history_lede')) + '</p></div>' +
      '<div class="chips" role="group" style="margin-bottom:14px">' + [7, 30].map(function (d) {
        return '<button class="chip" type="button" data-range="' + d + '" aria-pressed="' +
          (d === n) + '">' + esc(t('days_' + d)) + '</button>';
      }).join('') + '</div>' +
      '<div class="card pad">' + chart(days, end, target) + '</div>' +
      (logged.length
        ? '<h2 class="section">' + esc(t('days_list')) + '</h2><div class="card pad"><ul class="log-list">' +
          logged.slice().reverse().map(function (d) {
            return '<li><span class="l-name"><a href="#/today/' + esc(d.date) + '">' + esc(dayLabel(d.date)) +
              '</a><span class="l-sub">' + esc(t('entries_n', { n: d.count })) + ' · ' +
              fmt(d.protein) + ' g protein · ' + fmt(d.fiber) + ' g fibre</span></span>' +
              '<span class="l-kcal">' + esc(kcalText(d.kcalLow, d.kcalHigh)) + ' kcal</span></li>';
          }).join('') + '</ul></div>' +
          nutrientPanel(sum, referenceSet(), Profile.get(), logged.length, t('avg_title'))
        : '') +
      supportNote();

    main.querySelectorAll('[data-range]').forEach(function (b) {
      b.addEventListener('click', function () { histState.days = Number(b.dataset.range); render(); });
    });
  }

  // Plain HTML bars rather than SVG, so labels stay at reading size on a
  // phone. Colours come from the theme tokens.
  function chart(days, sel, target) {
    var dense = days.length > 10;
    var max = Math.max.apply(null, days.map(function (d) { return d.kcal; }).concat([target || 0, 1]));
    var pct = function (v) { return (v / max * 100).toFixed(1) + '%'; };
    var cols = days.map(function (d, i) {
      var p = d.date.split('-').map(Number);
      var dt = new Date(p[0], p[1] - 1, p[2], 12);
      var lab = dense
        ? (i % 5 === days.length % 5 ? String(dt.getDate()) : '')
        : dt.toLocaleDateString('en-GB', { weekday: 'short' });
      return '<a class="wk-col' + (d.date === sel ? ' sel' : '') + '" href="#/today/' + d.date + '" title="' +
        esc(dayLabel(d.date) + ': ' + Math.round(d.kcal) + ' kcal') + '">' +
        '<div class="wk-plot">' +
        (d.kcal > 0
          ? '<span class="wk-bar" style="height:' + pct(d.kcal) + '">' +
            (dense ? '' : '<span class="wk-val">' + Math.round(d.kcal) + '</span>') + '</span>'
          : '<span class="wk-bar wk-none"></span>') +
        '</div><span class="wk-day">' + esc(lab) + '&nbsp;</span></a>';
    }).join('');
    var logged = days.filter(function (d) { return d.count; });
    var avg = logged.length ? logged.reduce(function (s, d) { return s + d.kcal; }, 0) / logged.length : 0;
    return '<div class="week-chart' + (dense ? ' dense' : '') + '" style="grid-template-columns:repeat(' +
      days.length + ',1fr)" role="img" aria-label="' +
      esc(days.map(function (d) { return dayLabel(d.date) + ' ' + Math.round(d.kcal) + ' kcal'; }).join(', ')) + '">' +
      (target ? '<span class="wk-target" style="--f:' + (target / max).toFixed(3) + '"></span>' : '') +
      cols + '</div>' +
      '<p class="hint" style="margin:8px 0 0">' +
      (logged.length ? esc(t('week_avg', { n: Math.round(avg), days: logged.length })) : esc(t('week_none'))) +
      (target ? ' ' + esc(t('week_line', { n: target })) : '') + '</p>';
  }

  // ======================================================================
  // View: settings
  // ======================================================================
  function dietCard() {
    var p = Prefs.get();
    return '<div class="card pad settings-block diet-card"><h2>' + esc(t('dietary_title')) + '</h2>' +
      '<p class="hint">' + esc(t('dietary_hint')) + '</p>' +
      '<span class="label-text">' + esc(t('diet_label')) + '</span>' +
      '<div class="chips" role="group" aria-label="' + esc(t('diet_label')) + '" style="margin-bottom:14px">' +
      Prefs.DIETS.map(function (d) {
        return '<button class="chip" type="button" data-diet="' + d + '" aria-pressed="' + (p.diet === d) + '">' +
          esc(t('diet_' + d)) + '</button>';
      }).join('') + '</div>' +
      '<span class="label-text">' + esc(t('allergens_label')) + '</span>' +
      '<div class="chips" role="group" aria-label="' + esc(t('allergens_label')) + '" style="margin-bottom:14px">' +
      Prefs.ALLERGENS.map(function (a) {
        return '<button class="chip" type="button" data-allergen="' + a + '" aria-pressed="' +
          ((p.allergens || []).indexOf(a) >= 0) + '">' + esc(t('a_' + a)) + '</button>';
      }).join('') + '</div>' +
      '<div class="field"><label for="customExcl">' + esc(t('custom_excl')) + '</label>' +
      '<input id="customExcl" type="text" maxlength="300" value="' + esc(p.customExclude || '') + '">' +
      '<p class="hint" style="margin-top:4px">' + esc(t('custom_excl_hint')) + '</p></div></div>';
  }

  function bindDietCard() {
    main.querySelectorAll('[data-diet]').forEach(function (b) {
      b.addEventListener('click', function () { Prefs.set('diet', b.dataset.diet); render(); });
    });
    main.querySelectorAll('[data-allergen]').forEach(function (b) {
      b.addEventListener('click', function () {
        var list = (Prefs.get('allergens') || []).slice(), a = b.dataset.allergen, i = list.indexOf(a);
        if (i >= 0) list.splice(i, 1); else list.push(a);
        Prefs.set('allergens', list);
        render();
      });
    });
    var custom = document.getElementById('customExcl');
    if (custom) custom.addEventListener('change', function () { Prefs.set('customExclude', custom.value); render(); });
  }

  function viewSettings() {
    var prof = Profile.get();
    var theme = Prefs.get('theme');
    main.innerHTML =
      '<div class="page-head"><h1>' + esc(t('settings_title')) + '</h1></div>' +
      (logState.notice ? '<div class="note"><p>' + esc(logState.notice) + '</p></div>' : '') +

      '<div class="card pad settings-block"><h2>' + esc(t('key_title')) + '</h2>' +
      '<p class="hint">' + esc(t('key_lede')) + '</p>' +
      '<p>' + esc(Gemini.hasKey() ? t('key_saved', { k: Gemini.maskedKey() }) : t('key_none')) + '</p>' +
      '<div class="field-row"><div class="field"><label for="keyIn">' + esc(t('key_title')) + '</label>' +
      '<input id="keyIn" type="password" autocomplete="off" spellcheck="false" placeholder="' +
      esc(t('key_placeholder')) + '"></div></div>' +
      '<div class="btn-row"><button class="btn" type="button" id="keySave">' + esc(t('save')) + '</button>' +
      (Gemini.hasKey() ? '<button class="btn ghost" type="button" id="keyDel">' + esc(t('remove_key')) + '</button>' : '') +
      '<a href="' + esc(Gemini.STUDIO_URL) + '" rel="noopener" target="_blank">' + esc(t('get_free_key')) + '</a></div>' +
      '<p class="hint">' + esc(t('key_shared_warning')) + '</p></div>' +

      (window.Sync && Sync.available() ? '<div class="card pad settings-block sync-card"></div>' : '') +
      (LocalModel ? '<div class="card pad settings-block local-card"></div>' : '') +

      '<div class="card pad settings-block"><h2>' + esc(t('profile_section')) + '</h2>' +
      '<p class="hint">' + esc(t('profile_lede')) + '</p>' +
      '<p>' + (prof
        ? esc(prof.age + ' · ' + prof.sex + ' · ' + fmt(prof.heightCm) + ' cm · ' + fmt(prof.weightKg) + ' kg')
        : esc(t('profile_none'))) + '</p>' +
      '<div class="btn-row"><a class="btn ghost" href="' + FIM + '#/you">' + esc(t('edit_profile')) + ' &rarr;</a></div></div>' +

      dietCard() +

      '<div class="card pad settings-block"><h2>' + esc(t('theme')) + '</h2>' +
      '<select id="themeSel" aria-label="' + esc(t('theme')) + '">' + ['system', 'light', 'dark'].map(function (v) {
        return '<option value="' + v + '"' + (v === theme ? ' selected' : '') + '>' + esc(t('theme_' + v)) + '</option>';
      }).join('') + '</select></div>' +

      '<div class="card pad settings-block"><h2>' + esc(t('data_title')) + '</h2>' +
      '<p class="hint">' + esc(t('data_lede')) + ' ' + esc(t('days_logged', { n: Tracker.dayCount() })) + '</p>' +
      '<div class="btn-row"><button class="btn" type="button" id="exportBtn">' + esc(t('export_btn')) + '</button>' +
      '<label class="btn ghost file-btn">' + esc(t('import_btn')) +
      '<input type="file" accept="application/json,.json" id="importIn" hidden></label>' +
      '<button class="btn danger" type="button" id="clearBtn">' + esc(t('clear_btn')) + '</button></div></div>';

    logState.notice = '';
    bindLocalCards();
    bindDietCard();
    var syncEl = document.querySelector('.sync-card');
    if (syncEl && window.Sync) Sync.mountCard(syncEl);

    document.getElementById('keySave').addEventListener('click', function () {
      var k = document.getElementById('keyIn').value.trim();
      if (k) { Gemini.setKey(k); render(); }
    });
    var del = document.getElementById('keyDel');
    if (del) del.addEventListener('click', function () { Gemini.setKey(''); render(); });
    document.getElementById('themeSel').addEventListener('change', function (ev) {
      Prefs.set('theme', ev.target.value);
    });
    document.getElementById('exportBtn').addEventListener('click', function () {
      var blob = new Blob([Tracker.exportJson()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'food-log-' + Tracker.today() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    });
    document.getElementById('importIn').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      f.text().then(function (text) {
        try { logState.notice = t('imported_n', { n: Tracker.importJson(text) }); }
        catch (e) { logState.notice = e.message; }
        render();
      });
    });
    document.getElementById('clearBtn').addEventListener('click', function () {
      if (window.confirm(t('clear_confirm'))) { Tracker.clearAll(); render(); }
    });
  }

  // ======================================================================
  // Router
  // ======================================================================
  var route = { name: 'today', arg: null };
  var NAV = [['today', 'nav_today'], ['snap', 'nav_snap'], ['history', 'nav_history'], ['settings', 'nav_settings']];

  // #/today, #/today/2026-11-07, #/snap ... and #/today?add=<slug>, which is
  // how a food page on Food is Medicine hands a food over to be logged.
  function parseRoute() {
    var hash = location.hash.replace(/^#\/?/, '');
    var q = hash.indexOf('?');
    var query = q >= 0 ? hash.slice(q + 1) : '';
    var parts = (q >= 0 ? hash.slice(0, q) : hash).split('/');
    var name = parts[0] || 'today';
    if (!NAV.some(function (n) { return n[0] === name; })) name = 'today';
    var add = /(?:^|&)add=([^&]+)/.exec(query);
    return { name: name, arg: parts[1] || null, add: add ? decodeURIComponent(add[1]) : null };
  }

  function renderNav() {
    nav.innerHTML = NAV.map(function (n) {
      return '<a href="#/' + n[0] + '"' + (route.name === n[0] ? ' class="active" aria-current="page"' : '') +
        '>' + esc(t(n[1])) + '</a>';
    }).join('') + '<a href="' + FIM + '">' + esc(t('nav_fim')) + ' &nearr;</a>';
  }

  function render() {
    renderNav();
    if (route.name === 'snap') viewSnap();
    else if (route.name === 'history') viewHistory();
    else if (route.name === 'settings') viewSettings();
    else viewToday(route.arg);
  }

  function onHash() {
    var prev = route.name;
    route = parseRoute();
    if (route.name === 'today' && !route.arg) logState.date = Tracker.today();
    logState.pick = route.name === prev ? logState.pick : null;
    if (route.add && FOOD_BY_SLUG[route.add]) {
      logState.pick = route.add;
      logState.pickGrams = null;
      history.replaceState(null, '', '#/today');
      route.add = null;
    }
    render();
    var pg = route.name === 'today' && logState.pick && document.getElementById('pickGrams');
    if (pg) pg.scrollIntoView({ block: 'center' });
    if (route.name !== prev) window.scrollTo(0, 0);
  }

  // For the matcher regression tests (tests/match.test.mjs). Read-only.
  window.FoodLogInternals = { prepareItems: prepareItems, mainName: mainName, headWord: headWord };

  if (!FOODS.length || !DRI) {
    main.innerHTML = '<div class="note danger" style="margin-top:24px"><p>' + esc(t('no_data')) + '</p></div>';
    return;
  }
  if (Tracker.importedFrom()) logState.notice = t('imported_legacy');

  window.addEventListener('hashchange', onHash);
  // Resume sync if this browser signed in before; a no-op otherwise.
  if (window.Sync && Sync.available()) { try { Sync.start(); } catch (e) { /* sync is optional */ } }
  // Another tab (Food is Medicine, say) can change the shared profile.
  window.addEventListener('storage', function (ev) {
    if (ev.key === 'fim.profile.v1' || ev.key === 'fim.prefs.v1') location.reload();
  });
  onHash();
})();
