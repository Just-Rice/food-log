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
  // The curated list alone (with photos), for suggestions; FOODS grows when
  // the extended list arrives (data/more.js).
  var CORE_FOODS = FOODS.slice();

  /** Add the extended list to search and lookups, once it has loaded. */
  function mergeMore(list) {
    var added = 0;
    list.forEach(function (f) {
      if (FOOD_BY_SLUG[f.slug]) return;
      FOOD_BY_SLUG[f.slug] = f;
      FOODS.push(f);
      added++;
    });
    if (!added) return;
    // Refresh a search box that is open, without redrawing the page under the cursor.
    ['logSearch', 'recSearch'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.value.trim()) el.dispatchEvent(new Event('input'));
    });
    document.querySelectorAll('[data-psearch]').forEach(function (el) {
      if (el.value.trim()) el.dispatchEvent(new Event('input'));
    });
  }

  // ---- strings -------------------------------------------------------------
  // English only. Food is Medicine's translations cover its own pages; this
  // site's wording is small enough to keep here until it needs the same.
  var S = {
    nav_today: 'Today', nav_snap: 'Snap a meal', nav_history: 'History', nav_settings: 'Settings', nav_meals: 'Meals',
    meals_title: 'Meals and recipes',
    meals_lede: 'Save a meal you eat often and log it again in one tap, or build a recipe from its ingredients: its nutrition per serving is worked out from the USDA figures, vitamins and minerals included.',
    saved_meals: 'Saved meals', recipes_title: 'Recipes', new_recipe: 'New recipe',
    no_meals: 'No saved meals yet. On the Today page, “Save as a meal” keeps any meal you have logged.',
    no_recipes: 'No recipes yet.',
    log_it: 'Log', log_serving: 'Log 1 serving', edit: 'Edit', del: 'Delete', save: 'Save',
    delete_confirm: 'Delete “{name}”?',
    supps_title: 'Supplements',
    supps_lede: 'Tablets, capsules and drops, from the label. They count toward the day’s vitamins and minerals, and the upper limits that apply only to supplements are checked against them.',
    supps_safety: 'Food Log cannot tell you whether to take a supplement. Ask a doctor or pharmacist, especially if you take medicines, are pregnant, or are buying for a child: iron tablets are a common cause of poisoning in young children.',
    daily: 'every day', unit: 'unit', saved_notice: 'Saved “{name}”.',
    no_supps: 'No supplements saved.', new_supp: 'Add a supplement', edit_supp: 'Edit supplement',
    supp_name: 'Name', supp_dose: 'One dose is', supp_dose_ph: '1 tablet',
    supp_daily: 'I take this every day: offer it on Today', supp_amounts: 'Per dose, from the label',
    supp_more: 'More nutrients', supp_needs: 'Enter at least one amount from the label.',
    supp_folate_hint: 'Labels give folate in µg DFE, often with the folic acid in brackets: enter both. If a label lists only folic acid, enter it under folic acid and leave folate empty.',
    supp_tag: 'supplement', taken_today: 'Taken today?', taken_that_day: 'Taken that day?', doses: 'Doses',
    supp_a_note: 'IU on an older label: retinol 1 IU = 0.3 µg.',
    over_ul_supp: 'Supplements gave {v} {unit}, above the {ul} {unit} upper limit for supplements.',
    over_ul_supp_vita: 'Supplements gave {v} µg, above the {ul} µg limit for preformed vitamin A (retinol). If part of it is beta-carotene, the real figure is lower.',
    plants_title: 'Plants this week',
    plants_n: '{n} different plant foods in the last 7 days.', plants_one: '1 plant food in the last 7 days.',
    plants_none: 'No plant foods counted in the last 7 days yet.',
    plants_unknown: 'Typed-in, scanned and unmatched photo entries are not counted, since the food behind them is not known.',
    plants_note: 'Vegetables, fruit, pulses, grains, nuts, seeds, herbs, spices and mushrooms each count once, however they were cooked. A wider range of plants is linked to a more varied gut microbiome (American Gut Project, McDonald et al., 2018).',
    report_plants: 'Different plant foods',
    queue_offline: 'You’re offline. Take or choose the photo, or describe the meal, now: it is kept on this device and read when you’re back online, while Food Log is open.',
    queue_saved: 'Saved. It will be read when you’re back online, while Food Log is open.',
    queue_title: 'Waiting to be read', queue_waiting: '{n} waiting to be read when you’re back online.',
    queue_reading: '{n} being read…', queue_ready: 'A {what} from {day} is ready to check.',
    queue_better: 'A better reading of the {what} you logged {day} is ready.',
    queue_failed: 'A {what} from {day} could not be read: {msg}', queue_photo: 'photo', queue_text: 'description',
    queue_check: 'Check it', queue_compare: 'Compare', queue_retry: 'Try again', queue_remove: 'Remove',
    queue_upgrade: 'When I’m back online, read it again with Gemini and offer the better reading',
    replace_note: 'This is Gemini’s reading of a photo you logged {day} with the on-device model. Replacing removes that photo’s entries you have not weighed or measured; those you have stay.',
    replace_btn: 'Replace with this reading', keep_local: 'Keep the on-device reading',
    replaced_notice: 'Replaced with the better reading.',
    your_usual: 'your usual', taught_match: 'Matched the way you chose last time.',
    usual_hint: 'Scaled to your usual portion: {pct}% of the reader’s guess, from the {n} times you measured it.',
    usual_hint_one: 'Scaled to your usual portion: {pct}% of the reader’s guess, from the one time you measured it.',
    learnt_title: 'What Food Log has learnt',
    learnt_lede: 'When you change a match or measure an item on a photo or description, Food Log remembers it for that name next time. It never changes anything you have logged.',
    learnt_none: 'Nothing yet.', learnt_match: 'matched as {food}', learnt_model: 'kept as the reader’s own estimate',
    learnt_portion: 'your portions ≈ {pct}% of the reader’s guess ({n} measured)',
    forget: 'Forget', forget_all: 'Forget everything',
    dish_spices_title: 'Spices in dishes', dish_spices_label: 'Add a dish’s usual spices to the log',
    dish_spices_lede: 'When you log a dish — from a photo, a description or search — the spices it usually contains are added in small amounts, unless they are already in that day’s log, so they count toward your vitamins and the plants you eat.',
    with_spices: 'with {list}', spices_n: '+ {n} spices', spices_one: '+ 1 spice', spice_tag: 'spice',
    cuisines_title: 'Favourite cuisines',
    cuisines_lede: 'The cuisines you eat most. Their foods come first in search, photos and descriptions are read with them in mind ("dal", not "lentil soup"), and their dishes get their usual spices. Shared with Food is Medicine.',
    edit_entry: 'Edit', rename: 'Rename', move_to: 'Move to', move: 'Move', name_label: 'Name',
    copy_meal: 'Copy this meal to…', copy: 'Copy', same_as_yesterday: 'Same as yesterday’s {meal}',
    copied_n: 'Copied {n} to {day}.', moved_to: 'Moved to {day}.', day_label: 'Day',
    save_as_meal: 'Save as a meal', meal_name: 'Name for this meal', saved_meal_notice: 'Saved “{name}”. It is under My meals when you add food.',
    my_meals: 'My meals and recipes',
    recipe_name: 'Recipe name', ingredients: 'Ingredients', add_ingredient: 'Add an ingredient…',
    cooked_weight: 'Cooked weight (g, optional)', cooked_hint: 'Weigh the finished pot if you can: cooking changes weight, mostly water.',
    servings: 'Servings', per_serving_line: 'Per serving ({g} g): {kcal} kcal · {p} g protein · {c} g carbohydrate · {f} g fat · {fi} g fibre',
    per100_line: 'Per 100 g: {kcal} kcal',
    per_serving_nokcal: 'Per serving ({g} g): {p} g protein · {c} g carbohydrate · {f} g fat · {fi} g fibre', recipe_tag: 'recipe', logged_notice: 'Logged “{name}”.',
    recipe_needs: 'Add at least one ingredient.',
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
    est_share_nokcal: 'Some of these amounts come from photo portions nobody has measured yet.',
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
    model_estimate: 'No match — model estimate, ~{n} kcal/100 g', model_estimate_nokcal: 'No match — the photo reader’s own estimate',
    snap_mismatch_nokcal: 'This match is far denser or lighter than the photo reader expected. Check it is the right form — cooked rather than dry, say.',
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
    nutrients_lede_pregnant: 'The day against your own reference intakes: the RDA or AI for pregnancy at your age.',
    nutrients_lede_breastfeeding: 'The day against your own reference intakes: the RDA or AI for breastfeeding at your age.',
    log_stage: 'No daily energy figure is shown while you are pregnant or breastfeeding: needs change week by week. Your midwife or doctor can advise.',
    stage_pregnant: 'pregnant', stage_breastfeeding: 'breastfeeding',
    gaps_pregnant: 'Liver is left out of these suggestions during pregnancy because of its vitamin A.',
    nutrients_lede_generic: 'The day against the general Daily Values printed on US food labels. Set up a profile for your own.',
    unlisted_title: 'Not listed for some of the foods logged',
    unlisted_note: '* Not listed for some of the foods logged, so it may read low: {list}. Some tables do not measure everything — USDA’s survey dishes have no manganese or pantothenic acid figures, and the UK table no choline.',
    nutrients_partial_one: '1 entry ({kcal} kcal) has no vitamin and mineral data (typed in, from a packet label, or a photo item with no USDA match), so its vitamins and minerals are not counted here.',
    nutrients_partial_one_nokcal: '1 entry has no vitamin and mineral data (typed in, from a packet label, or a photo item with no USDA match), so its vitamins and minerals are not counted here.',
    nutrients_partial_nokcal: '{n} entries have no vitamin and mineral data (typed in, from a packet label, or a photo item with no USDA match), so their vitamins and minerals are not counted here.',
    nutrients_partial: '{n} entries ({kcal} kcal in all) have no vitamin and mineral data (typed in, from a packet label, or a photo item with no USDA match), so their vitamins and minerals are not counted here.',
    scan_btn: 'Scan a barcode', scan_title: 'Scan a barcode',
    scan_hint: 'Point the camera at the barcode on the packet and hold it steady.',
    scan_type: 'Or type the number under the barcode', look_up: 'Look up', close: 'Close',
    scan_starting: 'Opening the camera…',
    scan_looking: 'Looking up {code} on Open Food Facts…',
    scan_notfound: 'Open Food Facts does not know {code} yet. You can type the figures in from the label below.',
    scan_invalid: 'That is not a valid barcode number. Check the digits under the bars.',
    per_100: 'per 100 g', per_serving: '1 serving ({label})',
    product_allergens: 'Allergens on record: {list}.', product_traces: 'May contain: {list}.',
    product_no_allergens: 'No allergens on record.',
    off_disclaimer: 'Product data comes from Open Food Facts, a free database anyone can edit. Its allergen lists are often incomplete: the label on the packet is what to trust.',
    off_credit: 'Data: Open Food Facts, ODbL licence',
    no_energy: 'This product has no energy figure on record, so it cannot be logged from here. Type it in from the label instead.',
    from_label: 'packet', label_sub: 'From the packet label, via Open Food Facts',
    over_ul: 'Above the tolerable upper intake level of {ul} {unit}.',
    over_sodium: 'Above the {ul} mg level the 2019 DRIs set for reducing chronic-disease risk.',
    ul_food_note: 'Upper limits that apply only to supplements and fortified foods are checked against your logged supplements alone, since food is not known to cause harm at those intakes.',
    gaps_title: 'This week’s vitamins and minerals',
    gaps_few: 'Log at least three days this week to see which vitamins and minerals run low.',
    gaps_none: 'Every vitamin and mineral averaged at least 70% of your reference intake on the days logged.',
    gaps_low: '{name}: averaged {avg} a day, {pct}% of your {target}.',
    gaps_rich: 'Foods rich in {name}:',
    gaps_over: '{name}: above {ul} on {n} of the logged days.',
    gaps_partial: 'About {pct}% of this week’s energy came from entries without vitamin and mineral data, so these averages are a floor.',
    gaps_generic: 'Compared with the general label Daily Values; set up a profile for your own.',
    add_short: 'Add',
    report_link: 'Report for a doctor or dietitian',
    report_title: 'Food Log report', report_print: 'Print or save as PDF',
    report_range: '{from} to {to} · {logged} of {n} days logged',
    report_summary: 'Summary', report_macros: 'Daily averages (logged days)',
    report_energy: 'Energy by day', report_quality: 'How the figures were measured',
    q_measured: 'Weighed, searched or from a label', q_photo: 'Photo estimates not measured',
    q_partial: 'Energy only, no vitamin and mineral data',
    report_diet: 'Dietary settings', report_profile: 'Profile', report_notes: 'Notes',
    report_notes_hint: 'Anything to mention, e.g. questions for the appointment. Kept on this device only.',
    report_disclaimer: 'Generated by Food Log from a self-kept food diary. Figures are estimates built on USDA FoodData Central and the NASEM Dietary Reference Intakes; photo and typed-in entries are approximate. This is not a medical document.',
    report_avg_energy: 'Average energy on logged days: {n} kcal.',
    report_need: 'Estimated daily need (Mifflin-St Jeor × activity): {n} kcal.',
    none: 'None',
    install_title: 'Install Food Log', install_btn: 'Install',
    install_done: 'Food Log is installed on this device.',
    install_ios: 'On iPhone or iPad: in Safari, tap Share, then “Add to Home Screen”.',
    install_other: 'Use your browser’s menu: “Install app” or “Add to Home screen”.',
    install_lede: 'Installed, Food Log opens like an app from your home screen and works offline: search and your log need no connection.',
    reminders_title: 'Meal reminders (optional)',
    reminders_lede: 'Adds a gentle daily reminder to your own calendar app for each meal you tick. Food Log sends no notifications and keeps no record of whether you log.',
    reminders_btn: 'Download calendar file', reminders_none: 'Tick at least one meal.',
    offline_snap: 'You’re offline. Reading photos and descriptions needs a connection, unless the on-device model is downloaded (Settings).',
    history_title: 'History', history_lede: 'Energy by day, and how the logged days averaged against your reference intakes.',
    history_lede_nokcal: 'The days you logged, and how they averaged against your reference intakes.',
    strip_avg: '{days} of these {n} days logged.', strip_day_on: '{day}: {n} logged', strip_day_off: '{day}: nothing logged',
    gaps_partial_nokcal: 'Some of this week’s entries have no vitamin and mineral data, so these averages are a floor.',
    report_days: 'Days logged', q_partial_nokcal: 'No vitamin and mineral data', report_by_entries: 'Shares of entries.',
    days_7: '7 days', days_30: '30 days',
    avg_title: 'Average across logged days',
    days_list: 'Logged days', entries_n: '{n} entries', entries_one: '1 entry',
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
    hide_kcal_title: 'Calories', hide_kcal_label: 'Hide calories everywhere',
    hide_kcal_lede: 'For anyone who finds calorie numbers unhelpful. Foods, amounts, vitamins and minerals stay; every energy figure, total and chart goes. It follows you to your other devices if you sync.',
    theme: 'Theme', theme_system: 'Match system', theme_light: 'Light', theme_dark: 'Dark',
    data_title: 'Your log',
    data_lede: 'The log lives only in this browser. Export it to keep a copy or move it to another device.',
    export_btn: 'Export log', csv_entries: 'Entries as a spreadsheet (CSV)', csv_days: 'Daily totals (CSV)',
    csv_hint: 'Spreadsheet files open in Excel, Numbers or Google Sheets. A blank cell means not known, not zero.',
    import_btn: 'Import a log file', clear_btn: 'Delete the whole log',
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
    mode_photo: 'Photo', mode_text: 'Describe',
    describe_label: 'What did you eat?',
    describe_placeholder: 'e.g. two rotis, a bowl of dal and some rice, cooked in a spoon of ghee',
    describe_go: 'Read it', mic_start: 'Speak', mic_stop: 'Stop',
    mic_listening: 'Listening… say what you ate.',
    mic_denied: 'Microphone permission was refused. You can type instead.',
    mic_failed: 'Speech recognition stopped: {err}. You can type instead.',
    describe_privacy_cloud: 'Your words are read by Google’s Gemini, as photos are, and not stored.',
    describe_privacy_local: 'Your words are read on this device.',
    mic_privacy: 'Speech is turned into text by your browser; in Chrome that is done on Google’s servers.',
    describe_busy: 'Reading your description…',
    described: 'You said: “{text}”',
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

  // "Hide calories" (Settings): every energy figure is left out of the pages,
  // the foods, vitamins and minerals stay. Synced with the other settings.
  var HIDE_KCAL = 'foodlog.hideKcal';
  function showKcal() {
    try { return localStorage.getItem(HIDE_KCAL) !== '1'; } catch (e) { return true; }
  }
  /** `html` when energy figures are shown, '' when they are hidden. */
  function kc(html) { return showKcal() ? html : ''; }

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
    fat: ['Total fat', 'g'], fiber: ['Fibre', 'g'], sugar: ['Sugars', 'g'], satfat: ['Saturated fat', 'g'],
    vita: ['Vitamin A', 'ug'], vitc: ['Vitamin C', 'mg'], vitd: ['Vitamin D', 'ug'],
    vite: ['Vitamin E', 'mg'], vitk: ['Vitamin K', 'ug'], thiamin: ['Thiamin (B1)', 'mg'],
    riboflavin: ['Riboflavin (B2)', 'mg'], niacin: ['Niacin (B3)', 'mg'],
    pantothenic: ['Pantothenic acid (B5)', 'mg'], b6: ['Vitamin B6', 'mg'],
    folate: ['Folate', 'ug'], b12: ['Vitamin B12', 'ug'], choline: ['Choline', 'mg'],
    calcium: ['Calcium', 'mg'], iron: ['Iron', 'mg'], magnesium: ['Magnesium', 'mg'],
    phosphorus: ['Phosphorus', 'mg'], potassium: ['Potassium', 'mg'], sodium: ['Sodium', 'mg'],
    zinc: ['Zinc', 'mg'], copper: ['Copper', 'mg'], manganese: ['Manganese', 'mg'],
    selenium: ['Selenium', 'ug'], folicAcid: ['Folic acid', 'ug']
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
  function logRank(f, q, words) {
    var r = baseRank(f, q, words), name = f.name.toLowerCase();
    var cooked = (f.tags || []).indexOf('cooked') >= 0;
    if (cooked || (f.tags || []).indexOf('bread') >= 0) r += 12;
    if (NOT_EATEN_AS_IS.test(name)) r -= 15;
    // A food's own other name, typed in full ("rai" for mustard seeds, "hing"
    // for asafoetida), beats a name that merely contains it (rainbow trout,
    // pork scratchings), though not a food called exactly that.
    if ((f.aka || []).some(function (a) { return a.toLowerCase() === q; })) r += 15;
    // One word: a cooked food about that word ("White rice, cooked" for
    // "rice") comes before one that only starts with it ("Rice noodles,
    // cooked"), and the word itself before a longer word ("Eggplant" for
    // "egg"), and a plural a little ("Apples, sulfured" for "apple").
    if (words && words.length === 1) {
      if (name.indexOf(q) === 0 && /[a-z]/.test(name.charAt(q.length))) {
        r -= /^(e?s)([^a-z]|$)/.test(name.slice(q.length)) ? 3 : 10;
      }
      else if (cooked && name.indexOf(q) !== 0 && headWord(f.name) === q &&
               (' ' + mainName(f.name) + ' ').indexOf(' ' + q + ' ') >= 0) r += 12;
    }
    return r;
  }

  /**
   * Relevance, plus: every word of a several-word search found whole in the
   * name ("tikka masala chicken" finds "Curry, chicken tikka masala"); the
   * curated foods (and a food called exactly what was typed) ahead of the
   * extended list when otherwise equal; restaurant chain items behind; and a
   * favourite cuisine ahead.
   */
  function baseRank(f, q, words) {
    var r = relevance(f, q), name = f.name.toLowerCase();
    if (words && words.length > 1) {
      words.forEach(function (w) {
        if (new RegExp('(^|[^a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(name)) r += 6;
      });
    }
    if (!f.more || name === q) r += 8;
    else if (f.kind === 'fast' && /^[A-Z'&.\s]{3,},/.test(f.name)) r -= 6;
    return r + cuisineBoost(f);
  }

  /** Favourite cuisines (Settings) move their foods up a little. */
  function cuisineBoost(f) {
    var mine = Prefs.get('cuisines') || [];
    if (!mine.length || !f.cuisines || !f.cuisines.length) return 0;
    for (var i = 0; i < f.cuisines.length; i++) if (mine.indexOf(f.cuisines[i]) >= 0) return 10;
    return 0;
  }

  /**
   * Foods for a search box: every word must be in what a food can be found
   * by, the dietary settings must allow it, and each hit is ranked once.
   * `rank(f, q, words)` defaults to the log's order.
   */
  function searchFoods(query, limit, rank) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var words = q.split(/\s+/).filter(Boolean);
    rank = rank || logRank;
    var hits = [];
    for (var i = 0; i < FOODS.length; i++) {
      var f = FOODS[i], h = haystack(f), ok = true;
      for (var j = 0; j < words.length; j++) if (h.indexOf(words[j]) < 0) { ok = false; break; }
      if (!ok || Prefs.excludedReason(f)) continue;
      hits.push({ f: f, r: rank(f, q, words) });
    }
    hits.sort(function (a, b) {
      return b.r - a.r || a.f.name.length - b.f.name.length || a.f.name.localeCompare(b.f.name);
    });
    return hits.slice(0, limit || 10).map(function (h) { return h.f; });
  }

  /** " · 130 kcal/100 g" for a suggestion, or nothing (calories hidden, or no figure). */
  function kcalHint(f) {
    return f.nutrients.kcal != null ? kc('<span class="dim"> · ' + fmt(f.nutrients.kcal) + ' kcal/100 g</span>') : '';
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
    if (!p || !DRI.energyApplies(p.age) || stageOf(p)) return null;
    return Profile.energy().tdee;
  }

  /** 'pregnant', 'breastfeeding' or null (set on Food is Medicine's profile). */
  function stageOf(p) { return DRI.stageOf ? DRI.stageOf(p || Profile.get()) : null; }

  // ======================================================================
  // State
  // ======================================================================
  var logState = { date: null, pick: null, pickGrams: null, meal: null, measuring: null, notice: '', scan: null, savingMeal: null,
                   editing: null, copying: null, spicesOpen: null };
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
  // Saved meals and recipes
  // ======================================================================
  var mealsState = { editing: null };

  /** Log every item of a saved meal, as fresh entries. */
  function logSavedMeal(m, date, meal) {
    m.items.forEach(function (it) {
      // A spice that came with a dish: not if that day already has it.
      if (it.source === 'spice' && it.slug && Tracker.day(date).some(function (e) { return e.slug === it.slug; })) return;
      if (it.fixed) Tracker.add(date, { name: it.name, fixed: it.fixed, meal: meal });
      else if (it.slug && FOOD_BY_SLUG[it.slug]) Tracker.add(date, { food: FOOD_BY_SLUG[it.slug], grams: it.grams, meal: meal,
                                                                    source: it.source === 'spice' ? 'spice' : undefined });
      else Tracker.add(date, { name: it.name, per100: it.per100, grams: it.grams, meal: meal,
                               source: it.source === 'barcode' ? 'barcode' : 'food', barcode: it.barcode, brand: it.brand });
    });
  }

  /** Log servings of a recipe as one entry carrying its computed figures. */
  function logRecipe(r, date, meal, servings) {
    var n = Library.nutrition(r);
    Tracker.add(date, { name: r.name, per100: n.per100, grams: Math.round(n.servingGrams * (servings || 1)),
                        meal: meal, source: 'recipe', recipeId: r.id,
                        slugs: r.ingredients.map(function (it) { return it.slug; }).filter(Boolean) });
  }

  function libraryChips() {
    if (!window.Library || logState.pick || logState.scan) return '';
    var meals = Library.meals(), recipes = Library.recipes(), supps = Library.supplements();
    if (!meals.length && !recipes.length && !supps.length) return '';
    return '<div class="recent"><span class="label">' + esc(t('my_meals')) + '</span><div class="chips">' +
      meals.slice(0, 8).map(function (m) {
        return '<button class="chip" type="button" data-lib-meal="' + esc(m.id) + '">' + esc(m.name) + '</button>';
      }).join('') +
      recipes.slice(0, 8).map(function (r) {
        return '<button class="chip" type="button" data-lib-recipe="' + esc(r.id) + '">' + esc(r.name) +
          ' <span class="dim">' + esc(t('recipe_tag')) + '</span></button>';
      }).join('') +
      supps.slice(0, 8).map(function (x) {
        return '<button class="chip" type="button" data-take-supp="' + esc(x.id) + '">' + esc(x.name) +
          ' <span class="dim">' + esc(t('supp_tag')) + '</span></button>';
      }).join('') + '</div></div>';
  }

  function bindLibraryChips() {
    main.querySelectorAll('[data-lib-meal]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = Library.get(b.dataset.libMeal);
        if (!m) return;
        logSavedMeal(m, logState.date || Tracker.today(), currentMeal());
        logState.notice = t('logged_notice', { name: m.name });
        render();
      });
    });
    main.querySelectorAll('[data-lib-recipe]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = Library.get(b.dataset.libRecipe);
        if (!r) return;
        logRecipe(r, logState.date || Tracker.today(), currentMeal(), 1);
        logState.notice = t('logged_notice', { name: r.name });
        render();
      });
    });
  }

  function viewMeals() {
    if (mealsState.editing) return viewRecipeEditor();
    if (mealsState.editingSupp) return viewSuppEditor();
    var meals = Library.meals(), recipes = Library.recipes();
    main.innerHTML =
      '<div class="page-head"><h1>' + esc(t('meals_title')) + '</h1><p>' + esc(t('meals_lede')) + '</p></div>' +
      (logState.notice ? '<div class="note"><p>' + esc(logState.notice) + '</p></div>' : '') +
      '<h2 class="section">' + esc(t('saved_meals')) + '</h2>' +
      (meals.length
        ? meals.map(function (m) {
            var kcal = 0;
            m.items.forEach(function (it) { kcal += it.fixed ? (it.fixed.kcal || 0) : it.per100.kcal * it.grams / 100; });
            return '<div class="card pad lib-card"><div class="lib-head"><strong>' + esc(m.name) + '</strong>' +
              kc('<span class="dim">' + Math.round(kcal) + ' kcal</span>') + '</div>' +
              '<p class="hint">' + esc(m.items.map(function (it) {
                return it.name + (it.grams ? ' ' + fmt(it.grams) + ' g' : '');
              }).join(' · ')) + '</p>' +
              '<div class="btn-row"><button class="btn small" type="button" data-log-meal="' + esc(m.id) + '">' + esc(t('log_it')) + '</button>' +
              '<button class="btn ghost small" type="button" data-del-lib="' + esc(m.id) + '">' + esc(t('del')) + '</button></div></div>';
          }).join('')
        : '<p class="empty">' + esc(t('no_meals')) + '</p>') +
      '<h2 class="section">' + esc(t('recipes_title')) + '</h2>' +
      (recipes.length
        ? recipes.map(function (r) {
            var n = Library.nutrition(r);
            return '<div class="card pad lib-card"><div class="lib-head"><strong>' + esc(r.name) + '</strong>' +
              kc('<span class="dim">' + Math.round(n.perServing.kcal || 0) + ' kcal / serving</span>') + '</div>' +
              '<p class="hint">' + esc(r.ingredients.map(function (it) { return it.name + ' ' + fmt(it.grams) + ' g'; }).join(' · ')) + '</p>' +
              '<div class="btn-row"><button class="btn small" type="button" data-log-recipe="' + esc(r.id) + '">' + esc(t('log_serving')) + '</button>' +
              '<button class="btn ghost small" type="button" data-edit-recipe="' + esc(r.id) + '">' + esc(t('edit')) + '</button>' +
              '<button class="btn ghost small" type="button" data-del-lib="' + esc(r.id) + '">' + esc(t('del')) + '</button></div></div>';
          }).join('')
        : '<p class="empty">' + esc(t('no_recipes')) + '</p>') +
      '<div class="btn-row" style="margin-top:12px"><button class="btn" type="button" id="newRecipe">' + esc(t('new_recipe')) + '</button></div>' +
      '<h2 class="section">' + esc(t('supps_title')) + '</h2>' +
      '<p class="hint">' + esc(t('supps_lede')) + '</p>' +
      (Library.supplements().length
        ? Library.supplements().map(function (x) {
            return '<div class="card pad lib-card"><div class="lib-head"><strong>' + esc(x.name) + '</strong>' +
              '<span class="dim">' + esc(x.dose) + (x.daily ? ' · ' + esc(t('daily')) : '') + '</span></div>' +
              '<p class="hint">' + esc(suppSummary(x.amounts, 1)) + '</p>' +
              '<div class="btn-row"><button class="btn small" type="button" data-take-supp="' + esc(x.id) + '">' + esc(t('log_it')) + '</button>' +
              '<button class="btn ghost small" type="button" data-edit-supp="' + esc(x.id) + '">' + esc(t('edit')) + '</button>' +
              '<button class="btn ghost small" type="button" data-del-lib="' + esc(x.id) + '">' + esc(t('del')) + '</button></div></div>';
          }).join('')
        : '<p class="empty">' + esc(t('no_supps')) + '</p>') +
      '<div class="btn-row" style="margin-top:12px"><button class="btn" type="button" id="newSupp">' + esc(t('new_supp')) + '</button></div>' +
      '<p class="hint warn-text" style="margin-top:12px">' + esc(t('supps_safety')) + '</p>';
    logState.notice = '';

    main.querySelectorAll('[data-log-meal]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = Library.get(b.dataset.logMeal);
        logSavedMeal(m, Tracker.today(), Tracker.guessMeal());
        logState.notice = t('logged_notice', { name: m.name });
        render();
      });
    });
    main.querySelectorAll('[data-log-recipe]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = Library.get(b.dataset.logRecipe);
        logRecipe(r, Tracker.today(), Tracker.guessMeal(), 1);
        logState.notice = t('logged_notice', { name: r.name });
        render();
      });
    });
    main.querySelectorAll('[data-edit-recipe]').forEach(function (b) {
      b.addEventListener('click', function () {
        mealsState.editing = JSON.parse(JSON.stringify(Library.get(b.dataset.editRecipe)));
        render();
      });
    });
    main.querySelectorAll('[data-del-lib]').forEach(function (b) {
      b.addEventListener('click', function () {
        var x = Library.get(b.dataset.delLib);
        if (x && window.confirm(t('delete_confirm', { name: x.name }))) { Library.remove(x.id); render(); }
      });
    });
    document.getElementById('newRecipe').addEventListener('click', function () {
      mealsState.editing = { name: '', ingredients: [], cookedGrams: null, servings: 4 };
      render();
    });
    document.getElementById('newSupp').addEventListener('click', function () {
      mealsState.editingSupp = { name: '', dose: '', amounts: {}, daily: true };
      render();
    });
    main.querySelectorAll('[data-edit-supp]').forEach(function (b) {
      b.addEventListener('click', function () {
        mealsState.editingSupp = JSON.parse(JSON.stringify(Library.get(b.dataset.editSupp)));
        render();
      });
    });
    bindTakeSupp(Tracker.today());
  }

  // ---- supplements -----------------------------------------------------------

  // The editor's fields: the ones most labels list first, then the rest.
  var SUPP_MAIN = ['vitd', 'b12', 'iron', 'folate', 'folicAcid', 'calcium', 'vitc', 'vita', 'zinc', 'magnesium'];
  var SUPP_MORE = ['vite', 'vitk', 'thiamin', 'riboflavin', 'niacin', 'pantothenic', 'b6', 'choline',
                   'phosphorus', 'potassium', 'sodium', 'copper', 'manganese', 'selenium'];
  // Label units that need converting to the reference intakes' units.
  var SUPP_UNITS = {
    vita: [['ug', 'µg RAE', 1], ['iu', 'IU (retinol)', 0.3]],
    vitd: [['ug', 'µg', 1], ['iu', 'IU', 0.025]],
    vite: [['mg', 'mg', 1], ['iun', 'IU, natural (d-alpha)', 0.67], ['ius', 'IU, synthetic (dl-alpha)', 0.45]]
  };

  function isSupp(e) { return e.source === 'supplement'; }

  /** "25 µg vitamin D · 14 mg iron" for a dose (times `doses`). */
  function suppSummary(amounts, doses) {
    return Object.keys(amounts || {}).filter(function (k) { return NUTRIENTS[k]; }).map(function (k) {
      return fmt(amounts[k] * (doses || 1)) + ' ' + nutrientUnit(k) + ' ' +
        (k === 'folate' ? 'folate (DFE)' : lowerFirst(nutrientLabel(k)));
    }).join(' · ');
  }

  function viewSuppEditor() {
    var x = mealsState.editingSupp, a = x.amounts || {};
    var field = function (k) {
      if (!NUTRIENTS[k]) return '';
      var units = SUPP_UNITS[k];
      return '<div class="field supp-field"><label for="su_' + k + '">' + esc(nutrientLabel(k)) +
        (k === 'folate' ? ' (DFE)' : '') + '</label><div class="supp-in">' +
        '<input id="su_' + k + '" type="number" min="0" step="any" inputmode="decimal" value="' + esc(a[k] != null ? a[k] : '') + '">' +
        (units
          ? '<select id="su_' + k + '_u" aria-label="' + esc(nutrientLabel(k) + ' ' + t('unit')) + '">' + units.map(function (u) {
              return '<option value="' + u[0] + '">' + esc(u[1]) + '</option>';
            }).join('') + '</select>'
          : '<span class="dim">' + esc(nutrientUnit(k)) + '</span>') + '</div></div>';
    };
    main.innerHTML =
      '<div class="page-head"><h1>' + esc(x.id ? t('edit_supp') : t('new_supp')) + '</h1></div>' +
      '<div class="card pad supp-editor">' +
      '<div class="field-row"><div class="field"><label for="suName">' + esc(t('supp_name')) + '</label>' +
      '<input id="suName" type="text" maxlength="80" value="' + esc(x.name || '') + '"></div>' +
      '<div class="field"><label for="suDose">' + esc(t('supp_dose')) + '</label>' +
      '<input id="suDose" type="text" maxlength="40" placeholder="' + esc(t('supp_dose_ph')) + '" value="' + esc(x.dose || '') + '"></div></div>' +
      '<label class="toggle-row" style="margin:6px 0 14px"><input type="checkbox" id="suDaily"' + (x.daily ? ' checked' : '') + '> ' +
      esc(t('supp_daily')) + '</label>' +
      '<h2 class="section" style="margin-top:4px">' + esc(t('supp_amounts')) + '</h2>' +
      '<div class="supp-grid">' + SUPP_MAIN.map(field).join('') + '</div>' +
      '<p class="hint">' + esc(t('supp_folate_hint')) + ' ' + esc(t('supp_a_note')) + '</p>' +
      '<details class="manual"' + (SUPP_MORE.some(function (k) { return a[k] != null; }) ? ' open' : '') + '><summary>' +
      esc(t('supp_more')) + '</summary><div class="supp-grid">' + SUPP_MORE.map(field).join('') + '</div></details>' +
      '<p class="hint warn-text" id="suMsg" role="status"></p>' +
      '<div class="btn-row"><button class="btn" type="button" id="suSave">' + esc(t('save')) + '</button>' +
      '<button class="btn ghost" type="button" id="suCancel">' + esc(t('cancel')) + '</button></div></div>' +
      '<p class="hint warn-text" style="margin-top:12px">' + esc(t('supps_safety')) + '</p>';

    document.getElementById('suCancel').addEventListener('click', function () { mealsState.editingSupp = null; render(); });
    document.getElementById('suSave').addEventListener('click', function () {
      var amounts = {};
      SUPP_MAIN.concat(SUPP_MORE).forEach(function (k) {
        var el = document.getElementById('su_' + k);
        if (!el || el.value === '') return;
        var v = Number(el.value);
        if (!(v > 0)) return;
        var u = document.getElementById('su_' + k + '_u');
        if (u) SUPP_UNITS[k].forEach(function (x) { if (x[0] === u.value) v = v * x[2]; });
        amounts[k] = Math.round(v * 1000) / 1000;
      });
      // An older label with folic acid only: 1 µg folic acid is 1.7 µg DFE.
      if (amounts.folicAcid && !amounts.folate) amounts.folate = Math.round(amounts.folicAcid * 1.7 * 10) / 10;
      if (!Object.keys(amounts).length) { document.getElementById('suMsg').textContent = t('supp_needs'); return; }
      var saved = Library.saveSupplement({
        id: x.id, name: document.getElementById('suName').value, dose: document.getElementById('suDose').value,
        daily: document.getElementById('suDaily').checked, amounts: amounts
      });
      if (!saved) { document.getElementById('suMsg').textContent = t('supp_needs'); return; }
      mealsState.editingSupp = null;
      logState.notice = t('saved_notice', { name: saved.name });
      render();
    });
  }

  /** Log one dose of a saved supplement. */
  function takeSupp(x, date) {
    return Tracker.add(date, { source: 'supplement', name: x.name, amounts: x.amounts, doses: 1, dose: x.dose,
                               supplementId: x.id, meal: Tracker.guessMeal() });
  }

  function bindTakeSupp(date) {
    main.querySelectorAll('[data-take-supp]').forEach(function (b) {
      b.addEventListener('click', function () {
        var x = Library.get(b.dataset.takeSupp);
        if (!x) return;
        takeSupp(x, date || logState.date || Tracker.today());
        logState.notice = t('logged_notice', { name: x.name });
        render();
      });
    });
  }

  /** Today's supplements, and one-tap chips for the daily ones not yet logged. */
  function suppBlock(entries, date) {
    var list = entries.filter(isSupp);
    var daily = window.Library ? Library.supplements().filter(function (x) {
      return x.daily && !list.some(function (e) { return e.supplementId === x.id; });
    }) : [];
    if (!list.length && !daily.length) return '';
    return '<div class="card pad log-meal supp-block"><div class="log-meal-head"><h3>' + esc(t('supps_title')) + '</h3></div>' +
      (daily.length
        ? '<div class="supp-daily"><span class="label">' + esc(t(date === Tracker.today() ? 'taken_today' : 'taken_that_day')) + '</span>' +
          '<div class="chips">' + daily.map(function (x) {
            return '<button class="chip" type="button" data-take-supp="' + esc(x.id) + '">+ ' + esc(x.name) + '</button>';
          }).join('') + '</div></div>'
        : '') +
      (list.length ? '<ul class="log-list">' + list.map(suppRow).join('') + '</ul>' : '') + '</div>';
  }

  function suppRow(e) {
    return '<li><span class="l-name">' + esc(e.name) + ' <span class="tag">' + esc(t('supp_tag')) + '</span>' +
      '<span class="l-sub">' + esc(suppSummary(e.amounts, e.doses)) + '</span></span>' +
      '<span class="l-amt"><input type="number" min="0.25" max="20" step="0.25" class="amt" data-doses="' + esc(e.id) +
      '" value="' + esc(e.doses) + '" aria-label="' + esc(t('doses') + ', ' + e.name) + '"> × ' + esc(e.dose || '1') + '</span>' +
      '<button class="chip" type="button" data-edit-entry="' + esc(e.id) + '" aria-expanded="' + (logState.editing === e.id) +
      '" aria-label="' + esc(t('edit_entry') + ' ' + e.name) + '">' + esc(t('edit_entry')) + '</button>' +
      '<button class="chip" type="button" data-del="' + esc(e.id) + '" aria-label="' + esc(t('remove') + ' ' + e.name) + '">&times;</button>' +
      (logState.editing === e.id ? entryTools(e) : '') + '</li>';
  }

  function viewRecipeEditor() {
    var r = mealsState.editing;
    var n = Library.nutrition(r);
    var ps = n.perServing;
    main.innerHTML =
      '<div class="page-head"><h1>' + esc(r.id ? r.name : t('new_recipe')) + '</h1></div>' +
      '<div class="card pad">' +
      '<div class="field"><label for="recName">' + esc(t('recipe_name')) + '</label>' +
      '<input id="recName" type="text" maxlength="80" value="' + esc(r.name) + '"></div>' +
      '<h2 class="section" style="margin-top:16px">' + esc(t('ingredients')) + '</h2>' +
      '<ul class="log-list">' + r.ingredients.map(function (it, i) {
        return '<li><span class="l-name">' + esc(it.name) + kc('<span class="l-sub">' +
          fmt(it.per100.kcal * it.grams / 100) + ' kcal</span>') + '</span>' +
          '<span class="l-amt"><input type="number" min="1" max="5000" step="1" data-ing-g="' + i + '" value="' +
          esc(Math.round(it.grams)) + '" aria-label="' + esc(t('amount_g') + ', ' + it.name) + '"> g</span>' +
          '<button class="chip" type="button" data-ing-del="' + i + '" aria-label="' + esc(t('remove') + ' ' + it.name) + '">&times;</button></li>';
      }).join('') + '</ul>' +
      '<div class="ingredient-add" style="margin-top:10px">' +
      '<input class="search" id="recSearch" type="search" placeholder="' + esc(t('add_ingredient')) +
      '" autocomplete="off" aria-label="' + esc(t('add_ingredient')) + '">' +
      '<div class="suggest" id="recSuggest" hidden></div></div>' +
      '<div class="field-row" style="margin-top:14px">' +
      '<div class="field"><label for="recCooked">' + esc(t('cooked_weight')) + '</label>' +
      '<input id="recCooked" type="number" min="1" max="50000" step="1" value="' + esc(r.cookedGrams || '') + '"></div>' +
      '<div class="field"><label for="recServings">' + esc(t('servings')) + '</label>' +
      '<input id="recServings" type="number" min="1" max="100" step="1" value="' + esc(r.servings || 1) + '"></div></div>' +
      '<p class="hint">' + esc(t('cooked_hint')) + '</p>' +
      (r.ingredients.length
        ? '<p class="recipe-sum" id="recSum"><strong>' + esc(t(showKcal() ? 'per_serving_line' : 'per_serving_nokcal', {
            g: Math.round(n.servingGrams), kcal: Math.round(ps.kcal || 0), p: fmt(ps.protein || 0),
            c: fmt(ps.carbs || 0), f: fmt(ps.fat || 0), fi: fmt(ps.fiber || 0) })) + '</strong>' +
          kc('<br>' + esc(t('per100_line', { kcal: Math.round(n.per100.kcal || 0) }))) + '</p>'
        : '<p class="hint" id="recSum">' + esc(t('recipe_needs')) + '</p>') +
      '<div class="btn-row"><button class="btn" type="button" id="recSave"' + (r.ingredients.length ? '' : ' disabled') + '>' +
      esc(t('save')) + '</button><button class="btn ghost" type="button" id="recCancel">' + esc(t('cancel')) + '</button></div></div>';

    function readFields() {
      r.name = document.getElementById('recName').value;
      r.cookedGrams = Number(document.getElementById('recCooked').value) || null;
      r.servings = Math.max(1, Math.round(Number(document.getElementById('recServings').value) || 1));
    }
    ['recCooked', 'recServings'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', function () { readFields(); render(); });
    });
    main.querySelectorAll('[data-ing-g]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var g = Number(inp.value);
        if (g > 0) r.ingredients[Number(inp.dataset.ingG)].grams = Math.min(5000, g);
        readFields(); render();
      });
    });
    main.querySelectorAll('[data-ing-del]').forEach(function (b) {
      b.addEventListener('click', function () { r.ingredients.splice(Number(b.dataset.ingDel), 1); readFields(); render(); });
    });
    var search = document.getElementById('recSearch'), box = document.getElementById('recSuggest');
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
      // Ingredients are often dry or raw -- flour, lentils, oil -- so plain
      // relevance order, not the log's cooked-first order.
      var hits = searchFoods(q, 10, baseRank);
      box.hidden = !hits.length;
      box.innerHTML = hits.map(function (f) {
        return '<button type="button" data-ing-add="' + esc(f.slug) + '">' + esc(f.name) + kcalHint(f) + '</button>';
      }).join('');
      box.querySelectorAll('[data-ing-add]').forEach(function (b) {
        b.addEventListener('click', function () {
          var f = FOOD_BY_SLUG[b.dataset.ingAdd], per100 = {};
          Tracker.TRACKED.forEach(function (k) { if (f.nutrients[k] != null) per100[k] = f.nutrients[k]; });
          readFields();
          r.ingredients.push({ slug: f.slug, name: f.name, grams: f.portion ? f.portion.grams : 100, per100: per100 });
          render();
          var s2 = document.getElementById('recSearch');
          if (s2) s2.focus();
        });
      });
    });
    document.getElementById('recSave').addEventListener('click', function () {
      readFields();
      var saved = Library.saveRecipe(r);
      if (!saved) return;
      mealsState.editing = null;
      logState.notice = t('saved_meal_notice', { name: saved.name }).replace(' It is under My meals when you add food.', '');
      render();
    });
    document.getElementById('recCancel').addEventListener('click', function () { mealsState.editing = null; render(); });
  }

  // ======================================================================
  // Barcodes: a camera sheet over the page, then the product in the add card
  // ======================================================================
  var stopCamera = null;

  /** Whether a remembered product clashes outright with the dietary settings. */
  function productBlocked(code) {
    var p = window.Barcode && Barcode.cached(code);
    if (!p) return false;
    return Barcode.conflicts(p, Prefs.get(), function (k) { return t('a_' + k); })
      .some(function (c) { return c.level === 'stop'; });
  }

  function closeScanner() {
    if (stopCamera) { stopCamera(); stopCamera = null; }
    var sheet = document.getElementById('scanSheet');
    if (sheet) sheet.remove();
  }

  // The sheet lives outside #main, so the page re-rendering underneath (a
  // sync arriving, say) cannot tear the camera down mid-scan.
  function openScanner() {
    closeScanner();
    var sheet = document.createElement('div');
    sheet.id = 'scanSheet';
    sheet.className = 'scan-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', t('scan_title'));
    sheet.innerHTML = '<div class="scan-box card pad">' +
      '<div class="scan-top"><strong>' + esc(t('scan_title')) + '</strong>' +
      '<button class="btn ghost small" type="button" data-scan="close">' + esc(t('close')) + '</button></div>' +
      '<video class="scan-video" playsinline muted></video>' +
      '<p class="hint" id="scanMsg">' + esc(t('scan_starting')) + '</p>' +
      '<label class="label-text" for="scanCode">' + esc(t('scan_type')) + '</label>' +
      '<div class="measure-row"><input id="scanCode" type="text" inputmode="numeric" autocomplete="off" maxlength="14">' +
      '<button class="btn small" type="button" data-scan="go">' + esc(t('look_up')) + '</button></div></div>';
    document.body.appendChild(sheet);
    sheet.querySelector('[data-scan="close"]').addEventListener('click', closeScanner);
    function go() { lookupCode(document.getElementById('scanCode').value); }
    sheet.querySelector('[data-scan="go"]').addEventListener('click', go);
    sheet.querySelector('#scanCode').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') go(); });
    sheet.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeScanner(); });
    Barcode.startCamera(sheet.querySelector('video'), function (code) { lookupCode(code); })
      .then(function (stop) {
        if (!document.getElementById('scanSheet')) { stop(); return; }
        stopCamera = stop;
        var m = document.getElementById('scanMsg');
        if (m) m.textContent = t('scan_hint');
      }, function (err) {
        var m = document.getElementById('scanMsg');
        if (m) m.textContent = err.message;
        var v = sheet.querySelector('video');
        if (v) v.hidden = true;
        var input = document.getElementById('scanCode');
        if (input) input.focus();
      });
  }

  function lookupCode(code) {
    code = String(code || '').replace(/\s+/g, '');
    if (!Barcode.validCode(code)) {
      var m = document.getElementById('scanMsg');
      if (m) m.textContent = t('scan_invalid');
      return;
    }
    closeScanner();
    logState.pick = null;
    logState.scan = { status: 'loading', code: code };
    if (route.name !== 'today') location.hash = '#/today'; else render();
    Barcode.lookup(code).then(function (p) {
      logState.scan = p ? { status: 'found', code: code, product: p, grams: null } : { status: 'notfound', code: code };
    }, function (err) {
      logState.scan = { status: 'error', code: code, error: err.message };
    }).then(function () { if (route.name === 'today') render(); });
  }

  function scanPanel() {
    var sc = logState.scan;
    if (!sc) return '';
    var cancel = '<button class="btn ghost" type="button" data-scan-cancel>' + esc(t('cancel')) + '</button>';
    if (sc.status === 'loading') return '<div class="pick-panel"><p>' + esc(t('scan_looking', { code: sc.code })) + '</p></div>';
    if (sc.status === 'notfound') {
      return '<div class="pick-panel"><p>' + esc(t('scan_notfound', { code: sc.code })) + '</p><div class="btn-row">' +
        '<button class="btn" type="button" data-scan-manual>' + esc(t('manual_entry')) + '</button>' + cancel + '</div></div>';
    }
    if (sc.status === 'error') {
      return '<div class="pick-panel"><div class="note danger"><p>' + esc(sc.error) + '</p></div><div class="btn-row">' + cancel + '</div></div>';
    }
    var p = sc.product, labels = function (k) { return t('a_' + k); };
    var issues = Barcode.conflicts(p, Prefs.get(), labels);
    var opts = [];
    if (p.serving) opts.push({ label: t('per_serving', { label: p.serving.label }), grams: p.serving.grams });
    opts.push({ label: '100 g', grams: 100 });
    var grams = sc.grams || opts[0].grams;
    var row = function (k, unit) {
      return p.per100[k] == null ? '' : '<li>' + esc(nutrientLabel(k)) + ' <strong>' + fmt(p.per100[k]) + ' ' + unit + '</strong></li>';
    };
    return '<div class="pick-panel product-panel">' +
      '<div class="product-head">' +
      (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
      '<div><strong>' + esc(p.name) + '</strong>' + (p.brand ? '<span class="dim"> · ' + esc(p.brand) + '</span>' : '') +
      '<p class="hint" style="margin:2px 0 0">' + esc(t('per_100')) + ':</p>' +
      '<ul class="product-facts">' + kc(row('kcal', 'kcal')) + row('protein', 'g') + row('carbs', 'g') + row('sugar', 'g') +
      row('fat', 'g') + row('satfat', 'g') + row('fiber', 'g') + row('sodium', 'mg') + '</ul></div></div>' +
      issues.map(function (c) {
        return '<div class="note ' + (c.level === 'stop' ? 'danger' : 'warn') + '"><p>' + esc(c.text) + '</p></div>';
      }).join('') +
      '<p class="hint">' + esc(p.allergenWords.length ? t('product_allergens', { list: p.allergenWords.join(', ') }) : t('product_no_allergens')) +
      (p.traceWords.length ? ' ' + esc(t('product_traces', { list: p.traceWords.join(', ') })) : '') + '</p>' +
      '<p class="hint warn-text">' + esc(t('off_disclaimer')) + '</p>' +
      (p.hasEnergy
        ? '<div class="chips" style="margin:10px 0">' + opts.map(function (o) {
            return '<button class="chip" type="button" data-scan-grams="' + o.grams + '" aria-pressed="' +
              (Math.abs(o.grams - grams) < 0.5) + '">' + esc(o.label) + '</button>';
          }).join('') + '</div>' +
          '<div class="field-row">' +
          '<div class="field"><label for="scanGrams">' + esc(t('amount_g')) + '</label>' +
          '<input id="scanGrams" type="number" min="1" max="5000" step="1" value="' + esc(Math.round(grams)) + '"></div>' +
          '<div class="field"><label for="scanMeal">' + esc(t('meal')) + '</label>' + mealSelect('scanMeal', currentMeal()) + '</div>' +
          kc('<div class="field"><label>&nbsp;</label><span class="pick-kcal" id="scanKcal">' +
          Math.round((p.per100.kcal || 0) * grams / 100) + ' kcal</span></div>') + '</div>' +
          '<div class="btn-row"><button class="btn" type="button" id="scanAdd">' + esc(t('add_to_log')) + '</button>' + cancel + '</div>'
        : '<p>' + esc(t('no_energy')) + '</p><div class="btn-row"><button class="btn" type="button" data-scan-manual>' +
          esc(t('manual_entry')) + '</button>' + cancel + '</div>') +
      '<p class="hint" style="margin-top:8px"><a href="https://world.openfoodfacts.org/product/' + esc(p.code) +
      '" rel="noopener" target="_blank">' + esc(t('off_credit')) + '</a></p></div>';
  }

  function bindScanPanel() {
    main.querySelectorAll('[data-scan-cancel]').forEach(function (b) {
      b.addEventListener('click', function () { logState.scan = null; render(); });
    });
    main.querySelectorAll('[data-scan-manual]').forEach(function (b) {
      b.addEventListener('click', function () {
        var name = logState.scan && logState.scan.product ? logState.scan.product.name : '';
        logState.scan = null;
        render();
        var d = main.querySelector('details.manual');
        if (d) { d.open = true; var n = document.getElementById('manName'); if (n) { n.value = name; n.focus(); } }
      });
    });
    main.querySelectorAll('[data-scan-grams]').forEach(function (b) {
      b.addEventListener('click', function () { rememberMeal('scanMeal'); logState.scan.grams = Number(b.dataset.scanGrams); render(); });
    });
    var g = document.getElementById('scanGrams');
    if (g) {
      g.addEventListener('input', function () {
        var p = logState.scan.product;
        var sk = document.getElementById('scanKcal');
        if (sk) sk.textContent = Math.round((p.per100.kcal || 0) * (Number(g.value) || 0) / 100) + ' kcal';
      });
    }
    var add = document.getElementById('scanAdd');
    if (add) {
      add.addEventListener('click', function () {
        var p = logState.scan.product, grams = Number(document.getElementById('scanGrams').value);
        if (!(grams > 0)) return;
        rememberMeal('scanMeal');
        Tracker.add(logState.date, {
          name: p.brand ? p.name + ' (' + p.brand + ')' : p.name, per100: p.per100, grams: grams,
          meal: logState.meal, source: 'barcode', barcode: p.code, brand: p.brand
        });
        logState.scan = null;
        render();
      });
    }
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
      queuePanel() +

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
      '<div class="search-head"><strong>' + esc(t('search_add')) + '</strong>' +
      (window.Barcode ? '<button class="btn ghost small" type="button" id="scanBtn">' + esc(t('scan_btn')) + '</button>' : '') +
      '</div>' +
      '<div class="ingredient-add" style="margin-top:10px">' +
      '<input class="search" id="logSearch" type="search" placeholder="' +
      esc(t('search_foods')) + '" autocomplete="off" aria-label="' + esc(t('search_foods')) + '">' +
      '<div class="suggest" id="logSuggest" hidden></div></div>' +
      scanPanel() + pickPanel() + recentChips(date) + libraryChips() + manualForm() +
      '</div></div>' +

      '<h2 class="section">' + esc(t('eaten_on', {
        day: date >= Tracker.shift(Tracker.today(), -1) ? dayLabel(date).toLowerCase() : dayLabel(date)
      })) + '</h2>' +
      sameAsYesterday(date, entries) +
      (entries.some(function (e) { return !isSupp(e); })
        ? Tracker.MEALS.map(function (meal) { return mealBlock(meal, entries, date); }).join('')
        : '<p class="empty" style="padding:24px 0">' + esc(t('log_empty')) + '</p>') +
      suppBlock(entries, date) +

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
    } else if (prof && stageOf(prof)) {
      energy = '<p class="hint">' + esc(t('log_stage')) + '</p>';
    } else if (prof && !DRI.energyApplies(prof.age)) {
      energy = '<p class="hint">' + esc(t('log_under18')) +
        ' <a href="' + FIM + '#/weight">' + esc(t('growing_title')) + '</a></p>';
    } else if (!prof) {
      energy = '<p class="hint">' + esc(t('log_no_profile')) +
        ' <a href="' + FIM + '#/you">' + esc(t('profile_title')) + ' &rarr;</a></p>';
    }

    if (!showKcal()) {
      // No energy at all: the macros, and how much of the day is still a guess.
      return '<div class="card pad log-summary">' +
        '<div class="macro-row">' + Tracker.MACROS.filter(function (k) { return k !== 'kcal'; }).map(macro).join('') + '</div>' +
        (totals.estKcal >= 5 ? '<p class="hint">' + esc(t('est_share_nokcal')) + '</p>' : '') + '</div>';
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
    // Nutrients some logged foods' sources do not list, when those foods are
    // a real share of the energy: the figure may read low.
    var unlisted = Object.keys(totals.unknown || {}).filter(function (k) {
      return totals.kcal > 0 && totals.unknown[k] / totals.kcal >= 0.1;
    });
    function rows(keys) {
      return keys.map(function (k) {
        var v = (totals[k] || 0) / divisor;
        var target = ref.values[k];
        var pct = target ? v / target * 100 : null;
        var ul = uls[k];
        var warn = '';
        if (ul && ul.supplementOnly) {
          var sv = ((totals.supp && totals.supp[k]) || 0) / divisor;
          if (sv > ul.value) warn = t(k === 'vita' ? 'over_ul_supp_vita' : 'over_ul_supp', { v: fmt(sv), ul: ul.value, unit: UNIT[ul.unit] });
        } else if (ul && v > ul.value) {
          warn = k === 'sodium' ? t('over_sodium', { ul: ul.value }) : t('over_ul', { ul: ul.value, unit: UNIT[ul.unit] });
        }
        var mark = unlisted.indexOf(k) >= 0 ? '<sup class="unlisted" title="' + esc(t('unlisted_title')) + '">*</sup>' : '';
        return '<tr' + (warn ? ' class="over"' : '') + '><th scope="row">' + esc(nutrientLabel(k)) + mark + '</th>' +
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
      '<p class="hint">' + esc(ref.personal ? t(stageOf(prof) ? 'nutrients_lede_' + stageOf(prof) : 'nutrients_lede_personal') : t('nutrients_lede_generic')) +
      (ref.personal ? '' : ' <a href="' + FIM + '#/you">' + esc(t('profile_title')) + ' &rarr;</a>') +
      '</p>' +
      (totals.partialCount
        ? '<div class="note warn"><p>' + esc(t((totals.partialCount === 1 ? 'nutrients_partial_one' : 'nutrients_partial') +
            (showKcal() ? '' : '_nokcal'), { n: totals.partialCount, kcal: Math.round(totals.partialKcal) })) + '</p></div>'
        : '') +
      '<div class="dri-grid">' + table('Vitamins', VITAMINS) + table('Minerals', MINERALS) + '</div>' +
      (unlisted.length ? '<p class="hint">' + esc(t('unlisted_note', { list: unlisted.map(function (k) {
        return lowerFirst(nutrientLabel(k));
      }).join(', ') })) + '</p>' : '') +
      '<p class="hint">' + esc(t('ul_food_note')) + '</p>';
  }

  function mealBlock(meal, entries, date) {
    var all = entries.filter(function (e) { return e.meal === meal && !isSupp(e); });
    // Spices that came with a dish fold under it.
    var ids = {}, kids = {};
    all.forEach(function (e) { ids[e.id] = true; });
    var list = all.filter(function (e) {
      if (e.spiceOf && ids[e.spiceOf]) { (kids[e.spiceOf] = kids[e.spiceOf] || []).push(e); return false; }
      return true;
    });
    if (!list.length) return '';
    var lo = 0, hi = 0;
    all.forEach(function (e) { var r = Tracker.kcalRange(e); lo += r[0]; hi += r[1]; });
    var saving = logState.savingMeal === meal, copying = logState.copying === meal;
    return '<div class="card pad log-meal">' +
      '<div class="log-meal-head"><h3>' + esc(mealLabel(meal)) + '</h3>' +
      kc('<span class="dim">' + esc(kcalText(lo, hi)) + ' kcal</span>') + '</div>' +
      '<ul class="log-list">' + list.map(function (e) { return entryRow(e, kids[e.id]); }).join('') +
      '</ul>' +
      (window.Library
        ? (saving
            ? '<div class="measure-row save-meal"><label for="saveMealName">' + esc(t('meal_name')) + '</label>' +
              '<input id="saveMealName" type="text" maxlength="80" value="' + esc(mealLabel(meal)) + '">' +
              '<button class="btn small" type="button" data-save-meal-go="' + meal + '">' + esc(t('save')) + '</button>' +
              '<button class="btn ghost small" type="button" data-save-meal-cancel>' + esc(t('cancel')) + '</button></div>'
            : '<button class="btn ghost small save-meal-btn" type="button" data-save-meal="' + meal + '">' +
              esc(t('save_as_meal')) + '</button>')
        : '') +
      (copying
        ? '<div class="measure-row copy-meal"><label for="copyDate">' + esc(t('day_label')) + '</label>' +
          '<input id="copyDate" type="date" max="' + esc(Tracker.today()) + '" value="' +
          esc(date === Tracker.today() ? Tracker.today() : Tracker.shift(date, 1)) + '">' +
          mealSelect('copyMeal', meal) +
          '<button class="btn small" type="button" data-copy-go="' + meal + '">' + esc(t('copy')) + '</button>' +
          '<button class="btn ghost small" type="button" data-copy-cancel>' + esc(t('cancel')) + '</button></div>'
        : (saving ? '' : '<button class="btn ghost small save-meal-btn" type="button" data-copy-meal="' + meal + '">' +
          esc(t('copy_meal')) + '</button>')) +
      '</div>';
  }

  /** "Same as yesterday's breakfast" for each meal yesterday had and this day does not. */
  function sameAsYesterday(date, entries) {
    var prev = Tracker.day(Tracker.shift(date, -1)).filter(function (e) { return !isSupp(e); });
    var meals = Tracker.MEALS.filter(function (m) {
      return prev.some(function (e) { return e.meal === m; }) && !entries.some(function (e) { return e.meal === m && !isSupp(e); });
    });
    if (!meals.length) return '';
    return '<div class="chips same-yesterday">' + meals.map(function (m) {
      return '<button class="chip" type="button" data-same="' + m + '">' +
        esc(t('same_as_yesterday', { meal: mealLabel(m).toLowerCase() })) + '</button>';
    }).join('') + '</div>';
  }

  /** Rename and move, for one logged entry. */
  function entryTools(e) {
    return '<div class="entry-tools">' +
      '<div class="measure-row"><label for="rn-' + esc(e.id) + '">' + esc(t('name_label')) + '</label>' +
      '<input id="rn-' + esc(e.id) + '" type="text" maxlength="120" value="' + esc(e.name) + '">' +
      '<button class="btn small" type="button" data-rename="' + esc(e.id) + '">' + esc(t('rename')) + '</button></div>' +
      '<div class="measure-row"><label for="mvd-' + esc(e.id) + '">' + esc(t('move_to')) + '</label>' +
      '<input id="mvd-' + esc(e.id) + '" type="date" max="' + esc(Tracker.today()) + '" value="' + esc(logState.date) + '">' +
      mealSelect('mvm-' + e.id, e.meal) +
      '<button class="btn small" type="button" data-move="' + esc(e.id) + '">' + esc(t('move')) + '</button></div></div>';
  }

  /** The spices folded under a dish: one line, opened into a small list. */
  function spiceLines(e, kids) {
    if (!kids || !kids.length) return '';
    var open = logState.spicesOpen === e.id;
    var names = kids.map(function (k) { return lowerFirst(k.name.replace(/\s*\(.*\)$/, '').replace(/,.*$/, '')); });
    return '<span class="l-sub spice-line"><button class="linklike" type="button" data-spices="' + esc(e.id) +
      '" aria-expanded="' + open + '">' + esc(t(kids.length === 1 ? 'spices_one' : 'spices_n', { n: kids.length })) +
      '</button>: ' + esc(names.join(', ')) + '</span>';
  }

  function spiceList(e, kids) {
    if (!kids || !kids.length || logState.spicesOpen !== e.id) return '';
    return '<div class="l-spices"><ul class="spice-list">' + kids.map(function (k) {
        var kr = Tracker.kcalRange(k);
        return '<li><span>' + esc(k.name) + '</span><span class="dim">' + fmt(k.grams) + ' g' +
          kc(' · ' + esc(kcalText(kr[0], kr[1])) + ' kcal') + '</span>' +
          '<button class="chip" type="button" data-del="' + esc(k.id) + '" aria-label="' + esc(t('remove') + ' ' + k.name) +
          '">&times;</button></li>';
      }).join('') + '</ul></div>';
  }

  function entryRow(e, kids) {
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
      (e.source === 'barcode' ? ' <span class="tag">' + esc(t('from_label')) + '</span>' : '') +
      (e.source === 'recipe' ? ' <span class="tag">' + esc(t('recipe_tag')) + '</span>' : '') +
      (e.source === 'spice' ? ' <span class="tag">' + esc(t('spice_tag')) + '</span>' : '') +
      sub.map(function (s) { return '<span class="l-sub">' + esc(s) + '</span>'; }).join('') +
      spiceLines(e, kids) +
      // An unmatched photo item has only the model's energy guess; showing
      // "0 g protein" for it would be a claim, not a blank.
      (e.per100 && !e.slug && e.source !== 'barcode' && e.source !== 'recipe'
        ? '<span class="l-sub">' + esc(t('energy_only')) + '</span>'
        : '<span class="l-sub">' + fmt(n.protein) + ' g protein · ' + fmt(n.carbs) + ' g carbohydrate · ' +
          fmt(n.fat) + ' g fat</span>') +
      '</span>' +
      (e.fixed
        ? '<span class="l-amt"></span>'
        : '<span class="l-amt"><input type="number" min="1" max="5000" step="1" ' +
          'class="amt" data-entry="' + esc(e.id) + '" value="' + esc(Math.round(e.grams)) +
          '" aria-label="' + esc(t('amount_g') + ', ' + e.name) + '"> g</span>') +
      kc('<span class="l-kcal">' + esc(kcalText(r[0], r[1])) + ' kcal</span>') +
      '<button class="chip" type="button" data-edit-entry="' + esc(e.id) + '" aria-expanded="' +
      (logState.editing === e.id) + '" aria-label="' + esc(t('edit_entry') + ' ' + e.name) + '">' + esc(t('edit_entry')) + '</button>' +
      '<button class="chip" type="button" data-del="' + esc(e.id) + '" aria-label="' +
      esc(t('remove') + ' ' + e.name) + '">&times;</button>' +
      spiceList(e, kids) +
      (logState.editing === e.id ? entryTools(e) : '') +
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
      kc('<span class="dim">' + fmt(food.nutrients.kcal) + ' kcal / 100 g</span> ') +
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
      kc('<div class="field"><label>&nbsp;</label><span class="pick-kcal" id="pickKcal">' +
      Math.round(food.nutrients.kcal * grams / 100) + ' kcal</span></div>') + '</div>' +
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
        if (recent.length >= 10) return;
        if (e.slug && !seen[e.slug] && FOOD_BY_SLUG[e.slug] && !Prefs.excludedReason(FOOD_BY_SLUG[e.slug])) {
          seen[e.slug] = true;
          recent.push(e);
        } else if (e.source === 'barcode' && e.barcode && !seen['b' + e.barcode] && !productBlocked(e.barcode)) {
          seen['b' + e.barcode] = true;
          recent.push(e);
        }
      });
    }
    if (!recent.length || logState.pick) return '';
    return '<div class="recent"><span class="label">' + esc(t('recent')) + '</span>' +
      '<div class="chips">' + recent.map(function (e) {
        if (!e.slug) {
          return '<button class="chip" type="button" data-again-entry="' + esc(e.id) + '" data-again-date="' +
            esc(e.at ? Tracker.dateKey(new Date(e.at)) : date) + '">' + esc(e.name) +
            ' <span class="dim">' + fmt(e.grams) + ' g</span></button>';
        }
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
    bindLibraryChips();
    main.querySelectorAll('[data-save-meal]').forEach(function (b) {
      b.addEventListener('click', function () {
        logState.savingMeal = b.dataset.saveMeal; logState.copying = null;
        render();
        var i = document.getElementById('saveMealName');
        if (i) { i.focus(); i.select(); }
      });
    });
    main.querySelectorAll('[data-save-meal-cancel]').forEach(function (b) {
      b.addEventListener('click', function () { logState.savingMeal = null; render(); });
    });
    main.querySelectorAll('[data-save-meal-go]').forEach(function (b) {
      function go() {
        var meal = b.dataset.saveMealGo;
        var name = document.getElementById('saveMealName').value.trim() || mealLabel(meal);
        var entries = Tracker.day(logState.date).filter(function (e) { return e.meal === meal; });
        var saved = Library.saveMeal(name, entries);
        logState.savingMeal = null;
        if (saved) logState.notice = t('saved_meal_notice', { name: saved.name });
        render();
      }
      b.addEventListener('click', go);
      var input = document.getElementById('saveMealName');
      if (input) input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') go(); });
    });
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
      var hits = searchFoods(q, 10);
      suggest.hidden = !hits.length;
      suggest.innerHTML = hits.map(function (f) {
        return '<button type="button" data-pick="' + esc(f.slug) + '">' + esc(f.name) + kcalHint(f) + '</button>';
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
        var pk = document.getElementById('pickKcal');
        if (pk) pk.textContent = Math.round(food.nutrients.kcal * (Number(pg.value) || 0) / 100) + ' kcal';
      });
      pg.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') document.getElementById('pickAdd').click();
      });
      document.getElementById('pickAdd').addEventListener('click', function () {
        var food = FOOD_BY_SLUG[logState.pick];
        var g = Number(pg.value);
        if (!food || !(g > 0)) return;
        rememberMeal('pickMeal');
        var added = Tracker.add(logState.date, { food: food, grams: g, meal: logState.meal });
        if (added && food.spices && food.spices.length) logSpices(logState.date, added, dishSpices(food.name, food, g));
        logState.pick = null;
        logState.pickGrams = null;
        render();
      });
      document.getElementById('pickCancel').addEventListener('click', function () {
        logState.pick = null;
        render();
      });
    }

    main.querySelectorAll('[data-again-entry]').forEach(function (b) {
      b.addEventListener('click', function () {
        // Re-log a packet food from the entry it came from: the label's
        // figures travel with the entry, so no new lookup is needed.
        var src = null;
        for (var i = 0; i < 14 && !src; i++) src = Tracker.find(Tracker.shift(logState.date, -i), b.dataset.againEntry);
        if (!src) return;
        Tracker.add(logState.date, { name: src.name, per100: src.per100, grams: src.grams, meal: currentMeal(),
          source: 'barcode', barcode: src.barcode, brand: src.brand });
        render();
      });
    });
    var scanBtn = document.getElementById('scanBtn');
    if (scanBtn) scanBtn.addEventListener('click', openScanner);
    bindScanPanel();

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
    main.querySelectorAll('input[data-doses]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var d = Number(inp.value);
        if (d > 0) Tracker.update(logState.date, inp.dataset.doses, { doses: d });
        render();
      });
    });
    if (window.Library) bindTakeSupp(logState.date);
    bindQueue();
    main.querySelectorAll('[data-spices]').forEach(function (b) {
      b.addEventListener('click', function () {
        logState.spicesOpen = logState.spicesOpen === b.dataset.spices ? null : b.dataset.spices;
        render();
      });
    });
    main.querySelectorAll('[data-edit-entry]').forEach(function (b) {
      b.addEventListener('click', function () {
        logState.editing = logState.editing === b.dataset.editEntry ? null : b.dataset.editEntry;
        render();
      });
    });
    main.querySelectorAll('[data-rename]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.rename;
        Tracker.rename(logState.date, id, document.getElementById('rn-' + id).value);
        logState.editing = null;
        render();
      });
    });
    main.querySelectorAll('[data-move]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.move;
        var to = document.getElementById('mvd-' + id).value, meal = document.getElementById('mvm-' + id).value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to > Tracker.today()) return;
        if (Tracker.move(logState.date, id, to, meal)) {
          if (to !== logState.date) logState.notice = t('moved_to', { day: dayLabel(to).toLowerCase() });
        }
        logState.editing = null;
        render();
      });
    });
    main.querySelectorAll('[data-same]').forEach(function (b) {
      b.addEventListener('click', function () {
        Tracker.copyMeal(Tracker.shift(logState.date, -1), b.dataset.same, logState.date, b.dataset.same);
        render();
      });
    });
    main.querySelectorAll('[data-copy-meal]').forEach(function (b) {
      b.addEventListener('click', function () { logState.copying = b.dataset.copyMeal; logState.savingMeal = null; render(); });
    });
    main.querySelectorAll('[data-copy-cancel]').forEach(function (b) {
      b.addEventListener('click', function () { logState.copying = null; render(); });
    });
    main.querySelectorAll('[data-copy-go]').forEach(function (b) {
      b.addEventListener('click', function () {
        var to = document.getElementById('copyDate').value, meal = document.getElementById('copyMeal').value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to > Tracker.today()) return;
        var n = Tracker.copyMeal(logState.date, b.dataset.copyGo, to, meal);
        logState.copying = null;
        logState.notice = t('copied_n', { n: n, day: dayLabel(to).toLowerCase() });
        render();
      });
    });
    main.querySelectorAll('input[data-entry]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var g = Number(inp.value), e = Tracker.find(logState.date, inp.dataset.entry);
        if (g > 0 && e && window.Memory && e.label && e.modelGrams) Memory.learnPortion(e.label, g, e.modelGrams);
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
        if (window.Memory && e.label && e.modelGrams) Memory.learnPortion(e.label, m.grams, e.modelGrams);
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
    function addQ(q, bonus, single) {
      q = q.trim().toLowerCase();
      if (q.length >= 3 && !queries.some(function (x) { return x.q === q; })) {
        queries.push({
          q: q, bonus: bonus, single: !!single,
          // Whole words only, plurals allowed: "bread" is not breadfruit, and
          // "fried egg" is not fried eggplant.
          re: new RegExp('(^|[^a-z])' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(e?s)?($|[^a-z])')
        });
      }
    }
    addQ(item.name, 10);
    var main = mainName(item.name);
    addQ(main, 5);
    // "Raita/Yogurt dip" and "cooking oil or butter" are two guesses at one
    // thing: try each.
    var alts = main.split(/\s*\/\s*|\s+or\s+/);
    alts.forEach(function (alt) { addQ(alt, 5); });
    // A one-word search must match a whole word: "dal" is not "dalia" (bulgur).
    addQ(item.search || '', 0, !/\s/.test((item.search || '').trim()));
    // Single words are a last resort, and only the word a name is about can
    // stand alone. In "black pudding" that is "pudding", not "black" (which
    // finds black-eyed peas); in "french fries" it is "fries", not "french"
    // (dry french beans); in "malai kofta" it is "kofta", not "malai" (cream).
    // Cooking words never stand alone: "fried" finds a fried egg.
    alts.concat([item.search || '']).forEach(function (phrase) {
      var h = headWord(phrase);
      if (h) addQ(h, -15, true);
    });

    var COOKED = /\b(cooked|boiled|baked|fried|scrambled|roasted|porridge)\b/;
    var itemWords = wordsOf(item.name + ' ' + (item.search || ''));
    // A dish ("chana masala", "chicken curry") ranks records of that dish
    // above its main ingredient, which autoMatch would refuse anyway.
    var dishWord = DISH.exec(main);
    var itemText = ' ' + itemWords.join(' ') + ' ';
    var mine = Prefs.get('cuisines') || [];
    return FOODS.map(function (f) {
      // Foods outside the person's dietary settings, and spices no table
      // has figures for, are never offered.
      if (f.nodata || Prefs.excludedReason(f)) return null;
      var hay = haystack(f), best = -Infinity;
      queries.forEach(function (x) {
        if (x.re.test(hay)) {
          var r = relevance(f, x.q);
          // A whole-word query should not earn relevance's prefix score.
          if (r === 90 && !x.re.test(f.name.toLowerCase())) r = 30;
          // Same main word, same kind of food: "jeera rice" is rice, and
          // "White rice" is about rice where "Rice noodles" is about noodles.
          if (x.single) {
            if (f._head == null) f._head = headWord(f.name);
            if (f._head === x.q) r += 15;
          }
          best = Math.max(best, r + x.bonus);
        }
      });
      if (best === -Infinity) return null;
      var lname = f.name.toLowerCase();
      var isCooked = (f.tags || []).indexOf('cooked') >= 0 || COOKED.test(lname);
      if (item.cooked && isCooked) best += 15;
      if (!item.cooked && isCooked) best -= 10;
      if (item.cooked && /\braw\b/.test(lname) && !/\braw\b/.test(itemText)) best -= 15;
      if (NOT_EATEN_AS_IS.test(lname)) best -= 10;
      // Words the two names share, and words only the food has. A food that
      // brings a meat or fish the item never mentioned is a different dish:
      // "Biryani, chicken" for vegetable biryani, "Kofta, lamb" for malai
      // kofta, tuna nigiri for salmon nigiri.
      // One of the food's other names is exactly what the item is called
      // ("black pudding" is blood sausage, "spaghetti" is pasta): agreement.
      var aliasHit = (f.aka || []).some(function (a) {
        a = a.toLowerCase();
        return alts.indexOf(a) >= 0 || a === main;
      });
      if (aliasHit) best += 12;
      else {
        var fw = f._words || (f._words = wordsOf(f.name));
        var shared = 0, extra = 0;
        fw.forEach(function (w) {
          if (itemText.indexOf(' ' + w + ' ') >= 0) shared++;
          else if (PROTEIN_WORD.test(w)) extra += 25;
          else if (!FILLER_WORD.test(w)) extra += 3;
        });
        itemWords.forEach(function (w) { if (PROTEIN_WORD.test(w) && fw.indexOf(w) < 0) extra += 10; });
        best += 6 * shared - Math.min(40, extra);
      }
      if (ODD_FORM.test(lname) && !ODD_FORM.test(itemText)) best -= 12;
      // The curated list first when it fits as well; chain-restaurant items
      // last; a favourite cuisine breaks ties.
      if (!f.more) best += 12;
      else if (/^[A-Z'&.\s]{3,},/.test(f.name)) best -= 20;
      if (mine.length && f.cuisines && f.cuisines.some(function (c) { return mine.indexOf(c) >= 0; })) best += 4;
      if (dishWord) best += hay.indexOf(dishWord[1]) >= 0 ? 25 : -10;
      // Plain names beat long USDA-style descriptions at equal relevance.
      best -= Math.min(10, f.name.length / 8);
      return { slug: f.slug, score: best };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, 6);
  }

  /**
   * The item names a meat, fish, paneer, tofu or egg the food does not have:
   * green bean masala is not paneer butter masala. Toppings of a burger, a
   * sandwich, a pizza or a taco vary, so those are let through.
   */
  function proteinMissing(it, f, dish) {
    if (dish && /burger|sandwich|wrap|pizza|taco|burrito|roll/.test(dish[1])) return false;
    var have = ' ' + wordsOf(f.name + ' ' + (f.usda || '') + ' ' + (f.aka || []).join(' ')).join(' ') + ' ';
    return wordsOf(it.name).some(function (w) { return PROTEIN_WORD.test(w) && have.indexOf(' ' + w + ' ') < 0; });
  }

  function sameDishName(it, f) {
    var main = mainName(it.name);
    return (f.aka || []).some(function (a) { return a.toLowerCase() === main; });
  }

  function proteinClash(it, f) {
    var iw = ' ' + wordsOf(it.name + ' ' + (it.search || '')).join(' ') + ' ';
    if ((f.aka || []).some(function (a) { return iw.indexOf(' ' + a.toLowerCase() + ' ') >= 0; })) return false;
    return wordsOf(f.name).some(function (w) { return PROTEIN_WORD.test(w) && iw.indexOf(' ' + w + ' ') < 0; });
  }

  // Words for comparing a photo item's name with a food's: lower case,
  // singular, at least three letters.
  function wordsOf(text) {
    return String(text || '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z]+/).filter(function (w) {
      return w.length >= 3;
    }).map(function (w) { return w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w; })
      .filter(function (w, i, all) { return all.indexOf(w) === i; });
  }
  var PROTEIN_WORD = /^(chicken|beef|lamb|mutton|pork|ham|bacon|turkey|duck|goat|veal|fish|salmon|tuna|cod|haddock|prawn|shrimp|crab|lobster|clam|mussel|squid|octopus|egg|paneer|tofu|sausage|meat|liver)$/;
  var FILLER_WORD = /^(cooked|raw|boiled|baked|roasted|grilled|steamed|homemade|home|prepared|plain|with|and|without|from|fresh|nfs|type|style|made|added|all|average|regular|whole|retail|takeaway|restaurant|the|for|not|fat|salt|unsalted|reheated|drained|served|portion|serving|variety|varieties|includes|weighed|edible)$/;
  var ODD_FORM = /\b(fortified|enriched|protein-fortified|reduced sodium|low sodium|reduced fat|low fat|lowfat|fat free|sugar free|diet|light|lite|dietetic|imitation|dehydrated|powder|instant|canned|frozen|kombucha|bubble|cocoa butter)\b/;

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
      // The extended list's dish names (build/dish_aliases.txt) are the same
      // dish, so an exact one counts: "chana masala" is CoFID's chick pea curry.
      if (dish && text.indexOf(dish[1]) < 0 && !(f.more && sameDishName(it, f))) continue;
      // Herbs are seasoning, not a portion -- including those filed as
      // vegetables, like epazote ("Mexican tea", once matched to a cup of tea).
      var herb = f.group === 'herb' || (f.tags || []).indexOf('herb') >= 0;
      if (it.grams > 30 && (herb || NOT_A_PORTION.test(f.name.toLowerCase()))) continue;
      // USDA calls cooked pulses "mature seeds, cooked, boiled": only a form
      // that is not also described as cooked counts as dry.
      if (it.cooked && /^(grain|legume|nut)$/.test(f.group) && DRY_FORM.test(text) &&
          !/\b(cooked|boiled|baked|roasted|fried|canned|prepared)\b/.test(text)) continue;
      // A food that brings a meat or fish the item never named is a different
      // dish, however well the rest matches: lamb kofta for malai kofta.
      if (proteinClash(it, f) || proteinMissing(it, f, dish)) continue;
      var k = f.nutrients.kcal || 0;
      if (it.kcalPer100 && k && (k / it.kcalPer100 > DENSITY_TOLERANCE || it.kcalPer100 / k > DENSITY_TOLERANCE)) continue;
      // Nothing where the model expected something: hibiscus tea for tea with milk.
      if (it.kcalPer100 > 10 && !k) continue;
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
      var cands = m.map(function (x) { return x.slug; });
      // A food the model says is outside the diet keeps its own estimate:
      // the compatible foods on offer would describe it wrongly.
      var auto = it.conflict ? null : autoMatch(it, m), slug = auto, taught = false;
      // What this person taught Food Log about this name (js/memory.js).
      var mem = window.Memory && !it.conflict ? Memory.lookup(it.name) : null;
      if (mem && mem.slug != null) {
        var f = mem.slug && FOOD_BY_SLUG[mem.slug];
        if (mem.slug === '') { slug = null; taught = true; }
        else if (f && !Prefs.excludedReason(f)) {
          slug = mem.slug; taught = true;
          if (cands.indexOf(slug) < 0) cands.unshift(slug);
        }
      }
      var k = mem && mem.factor && Math.abs(mem.factor - 1) >= 0.03 ? mem.factor : 1;
      var scale = function (g) { return g > 0 ? Math.max(1, Math.round(g * k)) : g; };
      return {
        name: it.name, cooked: it.cooked, confidence: it.confidence, kcalPer100: it.kcalPer100,
        grams: scale(it.grams), gramsLow: scale(it.gramsLow), gramsHigh: scale(it.gramsHigh),
        modelGrams: it.grams, autoSlug: auto, taught: taught,
        usual: k !== 1 ? { factor: k, n: mem.n } : null,
        candidates: cands, slug: slug,
        conflict: it.conflict || '', allergens: it.allergens || [], spices: it.spices || [],
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
  // ---- a dish's spices ----------------------------------------------------------
  // A dish brings the spices it usually contains, in small amounts, unless
  // they are already in that day's log.
  var DISH_SPICES = 'foodlog.dishSpices';
  function dishSpicesOn() {
    try { return localStorage.getItem(DISH_SPICES) !== '0'; } catch (e) { return true; }
  }

  // Names a photo reader or a cook uses -> the spice in the food list.
  var SPICE_NAMES = {
    'coriander': 'coriander seed', 'coriander powder': 'coriander seed', 'ground coriander': 'coriander seed',
    'coriander seeds': 'coriander seed', 'dhania': 'coriander seed', 'dhania powder': 'coriander seed',
    'fresh coriander': 'cilantro', 'coriander leaves': 'cilantro', 'cilantro': 'cilantro',
    'chilli': 'chilipowder', 'chili': 'chilipowder', 'chilli powder': 'chilipowder', 'chili powder': 'chilipowder',
    'red chilli': 'chilipowder', 'red chili': 'chilipowder', 'red chilli powder': 'chilipowder', 'chili flakes': 'chilipowder',
    'chilli flakes': 'chilipowder', 'red pepper flakes': 'chilipowder', 'cayenne': 'pepperredorcayenne',
    'cayenne pepper': 'pepperredorcayenne', 'kashmiri chilli': 'paprika', 'pepper': 'blackpepper',
    'black pepper': 'blackpepper', 'white pepper': 'pepperwhite', 'turmeric': 'turmericroot', 'haldi': 'turmericroot',
    'cumin': 'cumin', 'cumin seeds': 'cumin', 'jeera': 'cumin', 'ground cumin': 'cumin',
    'garam masala': 'uk-13-829', 'hing': 'uk-13-803', 'asafoetida': 'uk-13-803', 'curry leaves': 'uk-13-821',
    'curry leaf': 'uk-13-821', 'cinnamon': 'cinnamonspice', 'cardamom': 'cardamom', 'elaichi': 'cardamom',
    'green cardamom': 'cardamom', 'black cardamom': 'sp-blackcardamom', 'cloves': 'cloves', 'clove': 'cloves',
    'bay leaf': 'bayleaf', 'bay leaves': 'bayleaf', 'ginger': 'gingerground', 'ground ginger': 'gingerground',
    'garlic powder': 'garlicpowder', 'onion powder': 'onionpowder', 'oregano': 'oregano', 'basil': 'basildried',
    'dried basil': 'basildried', 'thyme': 'thymedried', 'rosemary': 'rosemarydried', 'parsley': 'parsleydried',
    'dill': 'dillweeddried', 'paprika': 'paprika', 'smoked paprika': 'paprika', 'nutmeg': 'nutmeg', 'mace': 'maceground',
    'saffron': 'saffron', 'fennel': 'fennelseed', 'fennel seeds': 'fennelseed', 'saunf': 'fennelseed',
    'mustard seeds': 'mustardseed', 'mustard seed': 'mustardseed', 'rai': 'mustardseed',
    'fenugreek': 'fenugreekseed', 'fenugreek seeds': 'fenugreekseed', 'methi seeds': 'fenugreekseed',
    'kasuri methi': 'sp-kasurimethi', 'dried fenugreek leaves': 'sp-kasurimethi', 'curry powder': 'currypowder',
    'allspice': 'allspiceground', 'star anise': 'sp-staranise', 'sumac': 'sp-sumac', 'ajwain': 'sp-ajwain',
    'carom': 'sp-ajwain', 'carom seeds': 'sp-ajwain', 'amchur': 'sp-amchur', 'amchoor': 'sp-amchur',
    'mango powder': 'sp-amchur', 'kalonji': 'sp-kalonji', 'nigella': 'sp-kalonji', 'nigella seeds': 'sp-kalonji',
    'sichuan pepper': 'sp-sichuanpepper', 'szechuan pepper': 'sp-sichuanpepper', 'five spice': 'sp-fivespice',
    'five-spice': 'sp-fivespice', 'chinese five spice': 'sp-fivespice', 'gochugaru': 'sp-gochugaru',
    'galangal': 'sp-galangal', 'lemongrass': 'lemongrass', 'kaffir lime leaves': 'sp-makrutlime',
    'makrut lime leaves': 'sp-makrutlime', 'lime leaves': 'sp-makrutlime', 'annatto': 'sp-annatto',
    'achiote': 'sp-annatto', "za'atar": 'sp-zaatar', 'zaatar': 'sp-zaatar', 'ras el hanout': 'sp-rasel',
    'herbes de provence': 'sp-herbesdeprovence', 'italian seasoning': 'sp-italianseasoning',
    'italian herbs': 'sp-italianseasoning', 'cajun seasoning': 'sp-cajunseasoning', 'chaat masala': 'sp-chaatmasala',
    'sambar powder': 'sp-sambarpowder', 'panch phoron': 'sp-panchphoron', 'berbere': 'sp-berbere',
    'jerk seasoning': 'sp-jerkseasoning', 'caraway': 'carawayseed', 'caraway seeds': 'carawayseed',
    'celery seed': 'celeryseed', 'tarragon': 'tarragon', 'sage': 'sage', 'marjoram': 'marjoram',
    'savory': 'savoryground', 'chervil': 'chervil', 'mint': 'spearmintdried', 'dried mint': 'spearmintdried',
    'juniper': 'sp-juniper', 'juniper berries': 'sp-juniper', 'shichimi': 'sp-shichimi', 'dukkah': 'sp-dukkah'
  };
  var DEFAULT_SPICE_G100 = 0.15;     // grams per 100 g of dish, for a spice with no better figure

  /** The food for a spice name, if it is in the list (the extended part may still be loading). */
  function spiceFood(name) {
    var n = String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
    var slug = SPICE_NAMES[n] || SPICE_NAMES[n.replace(/s$/, '')];
    if (slug && FOOD_BY_SLUG[slug]) return FOOD_BY_SLUG[slug];
    // Otherwise a herb or spice whose name or other names say it.
    var re = new RegExp('(^|[^a-z])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)');
    for (var i = 0; i < FOODS.length; i++) {
      var f = FOODS[i];
      if ((f.group === 'herb' || f.kind === 'spice') && (re.test(f.name.toLowerCase()) ||
          (f.aka || []).some(function (a) { return a.toLowerCase() === n; }))) return f;
    }
    return null;
  }

  /**
   * The spices a dish brings, as [{food, grams}]: what its record lists
   * (FNDDS ingredients, or the typical spices for that dish), else what the
   * photo reader named, else the typical spices for its name. Amounts are
   * per 100 g of dish, scaled to `grams`.
   */
  function dishSpices(name, food, grams, named) {
    if (!dishSpicesOn() || !(grams > 0)) return [];
    var per = {}, order = [];
    function take(list) {
      list.forEach(function (p) {
        if (!FOOD_BY_SLUG[p.slug] || per[p.slug] != null) return;
        per[p.slug] = p.g;
        order.push(p.slug);
      });
    }
    if (food && food.spices && food.spices.length) take(food.spices);
    var typical = window.FoodsMore ? FoodsMore.typicalSpices(name) : [];
    if (named && named.length) {
      // The reader saw the dish: its list decides which, the record or the
      // typical recipe how much.
      var known = {};
      typical.forEach(function (p) { known[p.slug] = p.g; });
      Object.keys(per).forEach(function (k) { known[k] = per[k]; });
      per = {}; order = [];
      named.forEach(function (nm) {
        var f = spiceFood(nm);
        if (!f || per[f.slug] != null) return;
        per[f.slug] = known[f.slug] != null ? known[f.slug] : DEFAULT_SPICE_G100;
        order.push(f.slug);
      });
    } else if (!order.length) take(typical);
    return order.slice(0, 8).map(function (slug) {
      var g = Math.min(5, Math.max(0.1, Math.round(per[slug] * grams / 100 * 10) / 10));
      return { food: FOOD_BY_SLUG[slug], grams: g };
    });
  }

  /**
   * Log a dish's spices under it, skipping any already in that day's log.
   * Returns how many were added.
   */
  function logSpices(date, dishEntry, spices) {
    var n = 0;
    spices.forEach(function (sp) {
      var have = Tracker.day(date).some(function (e) { return e.slug === sp.food.slug; });
      if (have) return;
      if (Tracker.add(date, { food: sp.food, grams: sp.grams, meal: dishEntry.meal, source: 'spice', spiceOf: dishEntry.id })) n++;
    });
    return n;
  }

  /** Labels of the favourite cuisines, for the prompts. */
  function cuisineNames() {
    return (Prefs.get('cuisines') || []).map(function (c) {
      return window.FoodsMore ? FoodsMore.cuisineLabel(c) : c;
    });
  }

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
    // Offline, only the on-device model can read anything.
    var online = !window.PWA || window.PWA.online();
    if (online && FirebaseEngine && FirebaseEngine.available()) out.push('free');
    if (online && Gemini.hasKey()) out.push('key');
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
    var offline = window.PWA && !window.PWA.online();
    // Offline with no on-device model: take the photo now, read it later.
    if (!engine && offline && window.Queue) engine = 'queue';
    if (!engine && snap.status !== 'review' && offline) {
      return '<div class="note warn"><p>' + esc(t('offline_snap')) + '</p></div>';
    }
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
        (snap.text && !snap.dataUrl ? '<blockquote class="described">' + esc(snap.text) + '</blockquote>' : '') +
        '<div><p id="snapStatus">' + esc(snap.engine === 'local' ? localStatusText(snap.localStatus)
          : snap.only ? t('stronger_busy', { model: modelName(snap.only) }) : t('snap_busy')) +
        '</p>' + (snap.engine === 'local' ? '<p class="hint">' + esc(t('snap_local_slow')) + '</p>' : '') +
        '</div></div></div>';
    }
    if (snap.status === 'review') return snapReview();

    var engines = engineList();
    return queuePanel() + (engine === 'queue' ? '<div class="note warn"><p>' + esc(t('queue_offline')) + '</p></div>' : '') +
      (snap.notice ? '<div class="note"><p>' + esc(snap.notice) + '</p></div>' : '') +
      '<div class="card pad">' +
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
      '<div class="chips mode-tabs" role="group" aria-label="' + esc(t('mode_photo') + ' / ' + t('mode_text')) + '">' +
      ['photo', 'text'].map(function (m) {
        return '<button class="chip" type="button" data-snap-mode="' + m + '" aria-pressed="' + (snapMode === m) + '">' +
          esc(t('mode_' + m)) + '</button>';
      }).join('') + '</div>' +
      (snapMode === 'text' ? describeForm(engine) + '</div>' : '') +
      (snapMode === 'text' ? '' :
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
      esc(engine === 'queue' ? t('queue_saved').replace(/^Saved\. /, '')
        : engine === 'local' ? t('snap_local_privacy') + ' ' + t('snap_local_slow')
        : engine === 'free' ? t('snap_free_privacy') : t('snap_privacy')) +
      '</p></div>');
  }

  // ---- describing a meal in words ------------------------------------------
  var snapMode = 'photo';
  var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var recognition = null;

  function describeForm(engine) {
    return '<div class="field" style="margin:12px 0"><label for="describeText">' + esc(t('describe_label')) + '</label>' +
      '<textarea id="describeText" rows="3" maxlength="800" placeholder="' + esc(t('describe_placeholder')) + '">' +
      esc(snap.text || '') + '</textarea></div>' +
      '<p class="hint" id="micMsg" role="status"></p>' +
      '<div class="btn-row"><button class="btn" type="button" id="describeGo">' + esc(t('describe_go')) + '</button>' +
      (SpeechRec ? '<button class="btn ghost" type="button" id="micBtn" aria-pressed="false">' + esc(t('mic_start')) + '</button>' : '') +
      '</div>' +
      '<p class="hint" style="margin-top:10px">' +
      esc(engine === 'local' ? t('describe_privacy_local') : t('describe_privacy_cloud')) +
      (SpeechRec ? ' ' + esc(t('mic_privacy')) : '') + '</p>';
  }

  function stopListening() {
    if (recognition) { try { recognition.stop(); } catch (e) { /* already stopped */ } recognition = null; }
  }

  function toggleMic() {
    var btn = document.getElementById('micBtn'), box = document.getElementById('describeText'), msg = document.getElementById('micMsg');
    if (recognition) { stopListening(); return; }
    var rec = new SpeechRec();
    rec.lang = navigator.language || 'en-GB';
    rec.interimResults = true;
    rec.continuous = false;
    var base = box.value ? box.value.replace(/\s*$/, ' ') : '';
    rec.onresult = function (ev) {
      var said = '';
      for (var i = 0; i < ev.results.length; i++) said += ev.results[i][0].transcript;
      box.value = base + said;
      snap.text = box.value;
    };
    rec.onerror = function (ev) {
      if (msg) msg.textContent = ev.error === 'not-allowed' || ev.error === 'service-not-allowed'
        ? t('mic_denied') : ev.error === 'no-speech' ? '' : t('mic_failed', { err: ev.error });
    };
    rec.onend = function () {
      recognition = null;
      var b = document.getElementById('micBtn');
      if (b) { b.textContent = t('mic_start'); b.setAttribute('aria-pressed', 'false'); }
      var m = document.getElementById('micMsg');
      if (m && m.textContent === t('mic_listening')) m.textContent = '';
    };
    recognition = rec;
    try { rec.start(); } catch (e) { recognition = null; if (msg) msg.textContent = t('mic_failed', { err: e.message }); return; }
    if (btn) { btn.textContent = t('mic_stop'); btn.setAttribute('aria-pressed', 'true'); }
    if (msg) msg.textContent = t('mic_listening');
  }

  /** Read a described meal; like startPhoto, but words instead of a picture. */
  function startDescribe(text, opts) {
    opts = opts || {};
    text = String(text || '').trim();
    if (!text) return;
    stopListening();
    var engine = opts.engine || engineChoice();
    if (!engine && window.Queue && window.PWA && !PWA.online()) return queueCapture({ text: text });
    if (!engine) return;
    var before = opts.only ? snap : null;
    var offlineRead = engine === 'local' && !!window.PWA && !PWA.online();
    snap = { status: 'busy', dataUrl: '', hint: snap.hint, engine: engine, localStatus: null,
             only: opts.only || null, text: text, offlineRead: offlineRead };
    render();
    var popts = { model: opts.only || undefined, diet: dietOpts(), cuisines: cuisineNames() };
    if (engine === 'key' && !popts.model && Gemini.getPreference() !== Gemini.AUTO) popts.model = Gemini.getPreference();
    var job = engine === 'local'
      ? LocalModel.analyseText(text, popts, function (st) {
          if (snap.status !== 'busy') return;
          snap.localStatus = st;
          var el = document.getElementById('snapStatus');
          if (el) el.textContent = localStatusText(st);
        })
      : Photo.analyseText(engine === 'free' ? FirebaseEngine.engine : Gemini.engine, text, popts);
    job.then(function (res) {
      snap = {
        status: 'review', dataUrl: '', notes: res.notes, hint: snap.hint, engine: engine,
        model: res.model || null, text: text, scale: '', plateCm: null,
        items: prepareItems(res.items), photoId: Tracker.newId(),
        offlineRead: snap.offlineRead, upgrade: snap.offlineRead && enginePref() !== 'local'
      };
    }).catch(function (err) {
      var msg = err && err.message ? err.message : String(err);
      if (before) { snap = before; snap.strongerError = t('stronger_failed', { msg: msg }); }
      else snap = { status: 'error', error: msg, errorCode: err && err.code, hint: snap.hint, text: text };
    }).then(function () { if (route.name === 'snap') render(); });
  }

  // ---- the queue: read later, read again (js/queue.js) ---------------------
  var queueItems = [];        // the queue's records, kept here so pages can draw them at once
  var queueBusy = null;       // id of the record being read
  var queueRetryAt = 0;

  function refreshQueue() {
    if (!window.Queue) return Promise.resolve();
    return Queue.all().then(function (list) {
      var sig = function (l) { return JSON.stringify(l.map(function (r) { return [r.id, r.status, r.error || '', r.attempts || 0]; })); };
      var changed = sig(queueItems) !== sig(list);
      queueItems = list;
      if (changed) redrawQueue();
    }).catch(function () { /* the queue is optional */ });
  }

  /**
   * Redraw only the queue panel, in place, so a notice or a half-typed entry
   * elsewhere on the page is left alone.
   */
  function redrawQueue() {
    if (route.name !== 'today' && route.name !== 'snap') return;
    if (route.name === 'snap' && (snap.status === 'busy' || snap.status === 'review')) return;
    var html = queuePanel(), el = main.querySelector('.queue-card');
    if (el) {
      if (html) el.outerHTML = html; else el.remove();
    } else if (html) {
      var anchor = route.name === 'today' ? main.querySelector('.log-date') : main.querySelector('#main > .note, #main > .card');
      if (!anchor) return;
      anchor.insertAdjacentHTML('beforebegin', html);
    }
    bindQueue();
  }

  /** Keep a photo or description to read once back online. */
  function queueCapture(what) {
    var hintEl = document.getElementById('photoHint');
    var base = { hint: hintEl ? hintEl.value : snap.hint || '', date: logState.date || Tracker.today(),
                 meal: currentMeal(), status: 'waiting' };
    var job = what.text
      ? Queue.add(Object.assign(base, { kind: 'text', text: what.text }))
      : Photo.prepare(what.file).then(function (img) { return Queue.add(Object.assign(base, { kind: 'photo', dataUrl: img.dataUrl })); });
    return job.then(function () {
      snap = { status: null, hint: '', notice: t('queue_saved') };
      if (route.name === 'snap') render();
    }, function (err) {
      snap = { status: 'error', error: err && err.message ? err.message : String(err), hint: snap.hint };
      if (route.name === 'snap') render();
    });
  }

  /** The engine queued meals are read with: Gemini, free first (Flash-Lite leads its list). */
  function queueEngine() {
    var list = engineList();
    if (enginePref() === 'key' && list.indexOf('key') >= 0) return Gemini.engine;
    if (list.indexOf('free') >= 0) return FirebaseEngine.engine;
    if (list.indexOf('key') >= 0) return Gemini.engine;
    return null;
  }

  /** Read the next waiting or provisional record, one at a time, while online. */
  function runQueue() {
    if (!window.Queue || queueBusy || Date.now() < queueRetryAt) return;
    if (window.PWA && !PWA.online()) return;
    var engine = queueEngine();
    if (!engine) return;
    Queue.all().then(function (list) {
      var rec = list.filter(function (r) {
        return (r.status === 'waiting' || r.status === 'provisional') && (r.attempts || 0) < 3;
      })[0];
      if (!rec || queueBusy) return;
      queueBusy = rec.id;
      refreshQueue();
      var opts = { hint: rec.hint || '', diet: dietOpts(), cuisines: cuisineNames() };
      var job = rec.kind === 'text'
        ? Photo.analyseText(engine, rec.text, opts)
        : Photo.analyseWith(engine, Queue.blobOf(rec), opts);
      return job.then(function (res) {
        return Queue.update(rec.id, {
          status: rec.status === 'provisional' ? 'better' : 'ready', error: undefined,
          result: { items: res.items, notes: res.notes || '', plateCm: res.plateCm || null, scale: res.scale || '',
                    model: res.model || null, dataUrl: res.dataUrl || rec.dataUrl || '' }
        });
      }, function (err) {
        // Out of quota or rate-limited: try again in a while, not now.
        if (err && (err.code === 'ALL_SPENT' || err.code === 'RATE_LIMITED' || err.timeout)) {
          queueRetryAt = Date.now() + 10 * 60 * 1000;
          setTimeout(runQueue, 10 * 60 * 1000 + 1000);
          return null;
        }
        return Queue.update(rec.id, { attempts: (rec.attempts || 0) + 1, error: err && err.message ? err.message : String(err) });
      }).then(function () {
        queueBusy = null;
        refreshQueue();
        setTimeout(runQueue, 300);
      });
    }).catch(function () { queueBusy = null; });
  }

  function queueWhat(r) { return t(r.kind === 'text' ? 'queue_text' : 'queue_photo'); }

  /** What the queue holds, for the top of Snap and Today. */
  function queuePanel() {
    if (!window.Queue || !queueItems.length) return '';
    var waiting = queueItems.filter(function (r) { return r.status === 'waiting' || r.status === 'provisional'; });
    var failed = waiting.filter(function (r) { return r.error && (r.attempts || 0) >= 3; });
    var pending = waiting.filter(function (r) { return failed.indexOf(r) < 0; });
    var ready = queueItems.filter(function (r) { return r.status === 'ready' || r.status === 'better'; });
    if (!pending.length && !ready.length && !failed.length) return '';
    var day = function (r) { return dayLabel(r.date || Tracker.today()).toLowerCase(); };
    return '<div class="card pad queue-card"><strong>' + esc(t('queue_title')) + '</strong>' +
      ready.map(function (r) {
        var thumb = r.result && r.result.dataUrl ? '<img class="q-thumb" src="' + esc(r.result.dataUrl) + '" alt="">' : '';
        return '<div class="q-row">' + thumb + '<p>' + esc(t(r.status === 'better' ? 'queue_better' : 'queue_ready', { what: queueWhat(r), day: day(r) })) +
          '</p><button class="btn small" type="button" data-q-open="' + esc(r.id) + '">' +
          esc(t(r.status === 'better' ? 'queue_compare' : 'queue_check')) + '</button></div>';
      }).join('') +
      failed.map(function (r) {
        return '<div class="q-row"><p class="warn-text">' + esc(t('queue_failed', { what: queueWhat(r), day: day(r), msg: r.error })) + '</p>' +
          '<button class="btn ghost small" type="button" data-q-retry="' + esc(r.id) + '">' + esc(t('queue_retry')) + '</button>' +
          '<button class="btn ghost small" type="button" data-q-remove="' + esc(r.id) + '">' + esc(t('queue_remove')) + '</button></div>';
      }).join('') +
      (pending.length
        ? '<p class="hint">' + esc(t(!window.PWA || PWA.online() ? 'queue_reading' : 'queue_waiting', { n: pending.length })) + '</p>'
        : '') + '</div>';
  }

  function bindQueue() {
    main.querySelectorAll('[data-q-open]').forEach(function (b) {
      b.addEventListener('click', function () { openQueued(b.dataset.qOpen); });
    });
    main.querySelectorAll('[data-q-retry]').forEach(function (b) {
      b.addEventListener('click', function () {
        Queue.update(b.dataset.qRetry, { attempts: 0, error: undefined }).then(function () { queueRetryAt = 0; runQueue(); });
      });
    });
    main.querySelectorAll('[data-q-remove]').forEach(function (b) {
      b.addEventListener('click', function () { Queue.remove(b.dataset.qRemove); });
    });
  }

  /** Open a queued reading on the review screen. */
  function openQueued(id) {
    Queue.get(id).then(function (r) {
      if (!r || !r.result) return;
      var blob = r.kind === 'photo' ? Queue.blobOf(r) : null;
      var file = blob ? new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' }) : null;
      snap = {
        status: 'review', dataUrl: r.result.dataUrl || r.dataUrl || '', notes: r.result.notes, hint: r.hint || '',
        engine: queueEngine() === Gemini.engine ? 'key' : 'free', model: r.result.model, file: file, text: r.kind === 'text' ? r.text : '',
        scale: r.result.scale || '', plateCm: r.result.plateCm, items: prepareItems(r.result.items), photoId: Tracker.newId(),
        queueId: r.id, queueDate: r.date, queueMeal: r.meal,
        replace: r.status === 'better' ? { date: r.date, entryIds: r.entryIds || [] } : null
      };
      if (r.meal) logState.meal = r.meal;
      if (route.name !== 'snap') location.hash = '#/snap'; else render();
    });
  }

  /** A photo shared to the installed app (sw.js put it in the queue). */
  function handleShared(id) {
    if (!window.Queue) return;
    Queue.get(id).then(function (r) {
      if (!r || !r.blob) return;
      var file = new File([r.blob], r.blob.name || 'shared.jpg', { type: r.blob.type || 'image/jpeg' });
      snapMode = 'photo';
      if (engineChoice()) {
        Queue.remove(id);
        startPhoto(file);
      } else {
        // Offline with no on-device model: read it once back online.
        Queue.update(id, { status: 'waiting', date: Tracker.today(), meal: Tracker.guessMeal() }).then(function () {
          snap = { status: null, hint: '', notice: t('queue_saved') };
          render();
        });
      }
    });
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
      (snap.dataUrl ? '<img class="photo-thumb" src="' + esc(snap.dataUrl) + '" alt="">' : '') +
      '<div>' + kc('<div class="photo-total">' + esc(kcalText(lo, hi)) + ' <span class="u">kcal</span></div>') +
      '<p class="hint" style="margin:2px 0 0">' + kc(esc(t('snap_best_guess', { n: Math.round(mid) }))) +
      (nIn ? ' ' + esc(t('snap_measured_share', { m: nMeasured, n: nIn })) : '') + '</p>' +
      (snap.notes ? '<p class="hint" style="margin:6px 0 0">' + esc(snap.notes) + '</p>' : '') +
      (snap.model ? '<p class="hint" style="margin:6px 0 0">' + esc(t('read_by', { model: modelName(snap.model) })) +
        (snap.scale === 'card' ? ' ' + esc(t('scaled_card')) : '') + '</p>' : '') +
      (snap.engine !== 'local' && (snap.file || snap.text) && Config.STRONGER && snap.model !== Config.STRONGER
        ? '<button class="btn ghost small" type="button" id="photoStronger" style="margin-top:8px">' +
          esc(t('try_stronger', { model: modelName(Config.STRONGER) })) + '</button>'
        : '') +
      '</div></div>' +
      (snap.strongerError ? '<div class="note warn"><p>' + esc(snap.strongerError) + '</p></div>' : '') +
      (snap.replace ? '<div class="note"><p>' + esc(t('replace_note', { day: dayLabel(snap.replace.date).toLowerCase() })) + '</p></div>' : '') +
      ((Prefs.get().allergens || []).length
        ? '<p class="hint warn-text">' + esc(t('allergy_disclaimer')) + '</p>' : '') +
      // A card in the photo is a better scale than any plate size typed in.
      (snap.text && !snap.file ? '<p class="hint">' + esc(t('described', { text: snap.text })) + '</p>' : '') +
      (snap.items.length && snap.file && snap.scale !== 'card' ? platePanel('review', 'photo', snap.plateCm) : '') +
      (snap.plateNotice ? '<p class="hint">' + esc(snap.plateNotice) + '</p>' : '') +
      (snap.items.length
        ? '<ul class="photo-items">' + snap.items.map(itemRow).join('') + '</ul>'
        : '<p class="empty" style="padding:16px 0">' + esc(t('snap_nothing')) + '</p>') +
      '<div class="field-row" style="margin-top:14px">' +
      '<div class="field"><label for="photoMeal">' + esc(t('meal')) + '</label>' +
      mealSelect('photoMeal', snap.queueMeal || currentMeal()) + '</div>' +
      '<div class="field"><label for="photoDate">' + esc(t('choose_day')) + '</label>' +
      '<input id="photoDate" type="date" value="' + esc(snap.queueDate || logState.date || Tracker.today()) +
      '" max="' + esc(Tracker.today()) + '"></div></div>' +
      (snap.offlineRead && enginePref() !== 'local' && window.Queue
        ? '<label class="toggle-row" style="margin:0 0 12px;font-weight:400"><input type="checkbox" id="photoUpgrade"' +
          (snap.upgrade ? ' checked' : '') + '> ' + esc(t('queue_upgrade')) + '</label>'
        : '') +
      '<div class="btn-row">' +
      '<button class="btn" type="button" id="photoAdd"' + (nIn ? '' : ' disabled') + '>' +
      esc(snap.replace ? t('replace_btn') : t('add_to_log')) + '</button>' +
      '<button class="btn ghost" type="button" id="photoDiscard">' + esc(snap.replace ? t('keep_local') : t('discard')) +
      '</button></div></div>';
  }

  function reviewSpices(it, i, food) {
    var sp = dishSpices(it.name, food, it.grams, it.spices);
    if (!sp.length) return '';
    return '<p class="hint item-spices"><label><input type="checkbox" data-pspice="' + i + '"' +
      (it.noSpices ? '' : ' checked') + '> ' + esc(t('with_spices', { list: sp.map(function (x) {
        return lowerFirst(x.food.name.replace(/\s*\(.*\)$/, '').replace(/,.*$/, ''));
      }).join(', ') })) + '</label></p>';
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
      (it.usual && !it.measured ? ' <span class="tag usual-tag">' + esc(t('your_usual')) + '</span>' : '') +
      '</div>' +
      '<select data-pmatch="' + i + '" aria-label="' + esc(t('match_as') + ': ' + it.name) + '">' +
      it.candidates.map(function (s) {
        var f = FOOD_BY_SLUG[s];
        return '<option value="' + esc(s) + '"' + (s === it.slug ? ' selected' : '') + '>' +
          esc(f.name) + kc(' — ' + fmt(f.nutrients.kcal) + ' kcal/100 g') + '</option>';
      }).join('') +
      '<option value=""' + (it.slug ? '' : ' selected') + '>' +
      esc(showKcal() ? t('model_estimate', { n: it.kcalPer100 ? Math.round(it.kcalPer100) : '?' }) : t('model_estimate_nokcal')) +
      '</option></select>' +
      '<div class="ingredient-add p-search"><input class="search" type="search" data-psearch="' + i +
      '" placeholder="' + esc(t('change_match')) + '" aria-label="' + esc(t('change_match') + ': ' + it.name) +
      '" autocomplete="off"><div class="suggest" data-psuggest="' + i + '" hidden></div></div>' +
      (mismatch
        ? '<p class="hint warn-text">' + esc(t(showKcal() ? 'snap_mismatch' : 'snap_mismatch_nokcal', {
            usda: Math.round(per100), model: Math.round(it.kcalPer100)
          })) + '</p>'
        : '') +
      (!it.slug && !it.taught ? '<p class="hint">' + esc(t('snap_no_match')) + '</p>' : '') +
      (it.taught && !it.rematched ? '<p class="hint">' + esc(t('taught_match')) + '</p>' : '') +
      (it.usual && !it.measured ? '<p class="hint">' + esc(t(it.usual.n === 1 ? 'usual_hint_one' : 'usual_hint', { pct: Math.round(it.usual.factor * 100), n: it.usual.n })) + '</p>' : '') +
      (it.measured && it.measure ? '<p class="hint">' + esc(t('measured') + ': ' + it.measure) + '</p>' : '') +
      reviewSpices(it, i, food) +
      measurePanel('review', i, food, it.grams, snap.openMeasure === i) +
      '</div>' +
      '<div class="p-amt"><span class="p-g"><input type="number" min="1" max="2000" step="1" ' +
      'data-pgrams="' + i + '" value="' + esc(it.grams) + '" aria-label="' + esc(t('amount_g') + ', ' + it.name) +
      '"> g</span>' +
      (!it.measured && it.gramsHigh > it.gramsLow
        ? '<span class="l-sub">' + esc(it.gramsLow + '–' + it.gramsHigh + ' g') + '</span>'
        : '') + '</div>' +
      kc('<div class="p-kcal">' + esc(kcalText(per100 * it.gramsLow / 100, per100 * it.gramsHigh / 100)) +
      ' kcal</div>') + '</li>';
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
    if (!engine && window.Queue && window.PWA && !PWA.online()) return queueCapture({ file: file });
    if (!engine) return;
    var before = opts.only ? snap : null;   // kept if the stronger model fails
    var offlineRead = engine === 'local' && !!window.PWA && !PWA.online();
    snap = { status: 'busy', dataUrl: before ? before.dataUrl : '', hint: snap.hint, engine: engine,
             localStatus: null, only: opts.only || null, file: file, offlineRead: offlineRead };
    // Show the picture straight away so the wait has something to look at.
    if (!before) {
      Photo.prepare(file).then(function (img) {
        if (snap.status === 'busy') { snap.dataUrl = img.dataUrl; if (route.name === 'snap') render(); }
      }, function () { /* analyse() reports the same error */ });
    }
    render();

    var popts = { hint: snap.hint, model: opts.only || undefined, diet: dietOpts(), cuisines: cuisineNames() };
    if (engine === 'key' && !popts.model && Gemini.getPreference() !== Gemini.AUTO) {
      popts.model = Gemini.getPreference();   // a model chosen by hand on Food is Medicine
    }
    var job = engine === 'local'
      ? LocalModel.analyse(file, { hint: snap.hint, diet: dietOpts(), cuisines: cuisineNames() }, function (s) {
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
        plateCm: res.plateCm, items: prepareItems(res.items), photoId: Tracker.newId(),
        offlineRead: snap.offlineRead, upgrade: snap.offlineRead && enginePref() !== 'local'
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
    bindQueue();
    main.querySelectorAll('[data-snap-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        var box = document.getElementById('describeText');
        if (box) snap.text = box.value;
        stopListening();
        snap.notice = '';
        snapMode = b.dataset.snapMode;
        render();
      });
    });
    var dGo = document.getElementById('describeGo');
    if (dGo) {
      var box = document.getElementById('describeText');
      box.addEventListener('input', function () { snap.text = box.value; });
      dGo.addEventListener('click', function () { startDescribe(box.value); });
      box.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) startDescribe(box.value);
      });
    }
    var mic = document.getElementById('micBtn');
    if (mic) mic.addEventListener('click', toggleMic);
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
        var it = snap.items[Number(sel.dataset.pmatch)];
        it.slug = sel.value || null;
        it.rematched = true;
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
        var hits = searchFoods(q, 8);
        box.hidden = !hits.length;
        box.innerHTML = hits.map(function (f) {
          return '<button type="button" data-pset="' + esc(f.slug) + '">' + esc(f.name) + kcalHint(f) + '</button>';
        }).join('');
        box.querySelectorAll('[data-pset]').forEach(function (b) {
          b.addEventListener('click', function () {
            var it = snap.items[i];
            it.slug = b.dataset.pset;
            it.rematched = true;
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
        if (snap.text && !snap.file) startDescribe(snap.text, { only: Config.STRONGER, engine: snap.engine });
        else startPhoto(snap.file, { only: Config.STRONGER, engine: snap.engine });
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
      // A better reading replaces the photo's entries nobody measured.
      var kept = [];
      if (snap.replace) {
        snap.replace.entryIds.forEach(function (id) {
          var e = Tracker.find(snap.replace.date, id);
          if (!e) return;
          if (e.measured) kept.push(e.slug || e.name); else Tracker.remove(snap.replace.date, id);
        });
        if (date !== snap.replace.date) date = snap.replace.date;
      }
      var added = [];
      snap.items.forEach(function (it) {
        if (!it.include) return;
        if (kept.indexOf(it.slug || it.name) >= 0) return;
        if (window.Memory) {
          if (it.rematched) Memory.learnMatch(it.name, it.slug || '');
          if (it.measured && it.modelGrams) Memory.learnPortion(it.name, it.grams, it.modelGrams);
        }
        var food = it.slug && FOOD_BY_SLUG[it.slug];
        var base = {
          grams: it.grams, gramsLow: it.gramsLow, gramsHigh: it.gramsHigh, modelGrams: it.modelGrams,
          meal: logState.meal, source: 'photo', label: it.name, photoId: snap.photoId,
          plateAssumed: snap.plateCm || 26,
          measured: it.measured, measure: it.measure
        };
        if (food) base.food = food;
        else { base.name = it.name; base.per100 = { kcal: it.kcalPer100 || 0 }; }
        var e = Tracker.add(date, base);
        if (e) {
          added.push(e.id);
          if (!it.noSpices) logSpices(date, e, dishSpices(it.name, food, it.grams, it.spices));
        }
      });
      var up = document.getElementById('photoUpgrade');
      if (up && up.checked && window.Queue && added.length) {
        Queue.add({ kind: snap.text && !snap.file ? 'text' : 'photo', dataUrl: snap.dataUrl || '', text: snap.text || '',
                    hint: snap.hint || '', date: date, meal: logState.meal || currentMeal(), status: 'provisional', entryIds: added });
      }
      if (snap.queueId && window.Queue) Queue.remove(snap.queueId);
      if (snap.replace) logState.notice = t('replaced_notice');
      snap = { status: null, hint: '' };
      location.hash = '#/today/' + date;
    });
    document.getElementById('photoDiscard').addEventListener('click', function () {
      if (snap.queueId && window.Queue) Queue.remove(snap.queueId);
      snap = { status: null, hint: '' };
      render();
    });
    var upg = document.getElementById('photoUpgrade');
    if (upg) upg.addEventListener('change', function () { snap.upgrade = upg.checked; });
    main.querySelectorAll('[data-pspice]').forEach(function (cb) {
      cb.addEventListener('change', function () { snap.items[Number(cb.dataset.pspice)].noSpices = !cb.checked; });
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
    var sum = { partialCount: 0, partialKcal: 0, supp: {}, unknown: {} };
    Tracker.TRACKED.forEach(function (k) { sum[k] = 0; });
    logged.forEach(function (d) {
      Tracker.TRACKED.forEach(function (k) { sum[k] += d[k] || 0; });
      Object.keys(d.supp || {}).forEach(function (k) { sum.supp[k] = (sum.supp[k] || 0) + d.supp[k]; });
      Object.keys(d.unknown || {}).forEach(function (k) { sum.unknown[k] = (sum.unknown[k] || 0) + d.unknown[k]; });
      sum.partialCount += d.partialCount;
      sum.partialKcal += d.partialKcal;
    });

    main.innerHTML =
      '<div class="page-head"><h1>' + esc(t('history_title')) + '</h1>' +
      '<p>' + esc(t(showKcal() ? 'history_lede' : 'history_lede_nokcal')) + '</p></div>' +
      '<div class="chips" role="group" style="margin-bottom:14px">' + [7, 30].map(function (d) {
        return '<button class="chip" type="button" data-range="' + d + '" aria-pressed="' +
          (d === n) + '">' + esc(t('days_' + d)) + '</button>';
      }).join('') + '</div>' +
      '<div class="card pad">' + chart(days, end, target) + '</div>' +
      (window.Gaps ? gapsCard() + plantsCard() : '') +
      '<p style="margin:14px 0"><a class="btn ghost" href="#/report">' + esc(t('report_link')) + ' &rarr;</a></p>' +
      (logged.length
        ? '<h2 class="section">' + esc(t('days_list')) + '</h2><div class="card pad"><ul class="log-list">' +
          logged.slice().reverse().map(function (d) {
            return '<li><span class="l-name"><a href="#/today/' + esc(d.date) + '">' + esc(dayLabel(d.date)) +
              '</a><span class="l-sub">' + esc(t(d.count === 1 ? 'entries_one' : 'entries_n', { n: d.count })) + ' · ' +
              fmt(d.protein) + ' g protein · ' + fmt(d.fiber) + ' g fibre</span></span>' +
              kc('<span class="l-kcal">' + esc(kcalText(d.kcalLow, d.kcalHigh)) + ' kcal</span>') + '</li>';
          }).join('') + '</ul></div>' +
          nutrientPanel(sum, referenceSet(), Profile.get(), logged.length, t('avg_title'))
        : '') +
      supportNote();

    main.querySelectorAll('[data-range]').forEach(function (b) {
      b.addEventListener('click', function () { histState.days = Number(b.dataset.range); render(); });
    });
  }

  function amountText(v, key) { return fmt(v) + ' ' + nutrientUnit(key); }

  /** The different plant foods in the log over `n` days ending today. */
  function plantsIn(n) {
    var entries = [];
    Tracker.history(Tracker.today(), n).forEach(function (d) { entries = entries.concat(Tracker.day(d.date)); });
    return Gaps.plants(entries, FOOD_BY_SLUG);
  }

  function plantsCard() {
    var pv = plantsIn(7);
    return '<h2 class="section">' + esc(t('plants_title')) + '</h2><div class="card pad plants-card">' +
      '<p><strong>' + esc(pv.count ? t(pv.count === 1 ? 'plants_one' : 'plants_n', { n: pv.count }) : t('plants_none')) + '</strong></p>' +
      (pv.count ? '<div class="chips plant-list">' + pv.kinds.map(function (k) {
        return '<span class="chip static">' + esc(k.name) + '</span>';
      }).join('') + '</div>' : '') +
      (pv.unknown ? '<p class="hint">' + esc(t('plants_unknown')) + '</p>' : '') +
      '<p class="hint">' + esc(t('plants_note')) + '</p></div>';
  }
  // "Vitamin K" -> "vitamin K", "Iron" -> "iron", for use mid-sentence.
  function lowerFirst(s) { return s.charAt(0).toLowerCase() + s.slice(1); }

  /**
   * The week's gaps: nutrients the logged days fell short of, with foods rich
   * in them, and limits exceeded. Worded about nutrients, never about eating
   * more or less.
   */
  function gapsCard() {
    var days = Tracker.history(Tracker.today(), 7);
    var ref = referenceSet(), prof = Profile.get();
    var a = Gaps.analyse(days, ref.values, DRI.upperLimitsFor(prof ? prof.age : 30));
    var body;
    if (!a.enough) body = '<p class="hint">' + esc(t('gaps_few')) + '</p>';
    else {
      var pregnant = stageOf(prof) === 'pregnant';
      var excluded = function (f) { return !!Prefs.excludedReason(f) || (pregnant && f.group === 'offal'); };
      body = (a.low.length ? '' : '<p>' + esc(t('gaps_none')) + '</p>') +
        a.low.map(function (g, i) {
          var tips = Gaps.suggest(g.key, CORE_FOODS, g.target, excluded, 4, function (f) { return cuisineBoost(f) > 0; });
          var head = esc(t('gaps_low', { name: nutrientLabel(g.key), avg: amountText(g.avg, g.key),
            pct: Math.round(g.pct * 100), target: amountText(g.target, g.key) }));
          if (!tips.length) return '<div class="gap"><p><strong>' + head + '</strong></p></div>';
          return '<details class="gap"' + (i < 2 ? ' open' : '') + '><summary><strong>' + head + '</strong></summary>' +
            '<p class="hint" style="margin:2px 0 4px">' + esc(t('gaps_rich', { name: lowerFirst(nutrientLabel(g.key)) })) + '</p>' +
            '<ul class="gap-foods">' + tips.map(function (s) {
              return '<li><a href="' + esc(fimFood(s.food.slug)) + '">' + esc(s.food.name) + '</a>' +
                '<span class="dim"> · ' + esc(s.label) + ': ' + Math.round(s.pct * 100) + '%</span> ' +
                '<a class="chip" data-gap-add="' + esc(s.food.slug) + '" href="#/today?add=' +
                encodeURIComponent(s.food.slug) + '&amp;g=' + Math.round(s.grams) + '">' + esc(t('add_short')) + '</a></li>';
            }).join('') + '</ul></details>';
        }).join('') +
        a.over.map(function (o) {
          return '<p class="warn-text">' + esc(t('gaps_over', {
            name: nutrientLabel(o.key), ul: amountText(o.ul, o.key), n: o.days })) + '</p>';
        }).join('') +
        (a.partialShare > 0.1 ? '<p class="hint">' + esc(showKcal() ? t('gaps_partial', { pct: Math.round(a.partialShare * 100) })
          : t('gaps_partial_nokcal')) + '</p>' : '') +
        (pregnant && a.low.length ? '<p class="hint">' + esc(t('gaps_pregnant')) + '</p>' : '') +
        (ref.personal ? '' : '<p class="hint">' + esc(t('gaps_generic')) + ' <a href="' + FIM + '#/you">' +
          esc(t('profile_title')) + ' &rarr;</a></p>');
    }
    return '<h2 class="section">' + esc(t('gaps_title')) + '</h2><div class="card pad gaps-card">' + body + '</div>';
  }

  // ======================================================================
  // View: printable report
  // ======================================================================
  var reportState = { days: 14 };
  var NOTES_KEY = 'foodlog.report.notes';

  function viewReport() {
    var n = reportState.days, end = Tracker.today();
    var days = Tracker.history(end, n);
    var logged = days.filter(function (d) { return d.count; });
    var prof = Profile.get(), ref = referenceSet(), target = energyTarget();
    var sum = { partialCount: 0, partialKcal: 0, supp: {}, unknown: {} };
    Tracker.TRACKED.forEach(function (k) { sum[k] = 0; });
    logged.forEach(function (d) {
      Tracker.TRACKED.forEach(function (k) { sum[k] += d[k] || 0; });
      Object.keys(d.supp || {}).forEach(function (k) { sum.supp[k] = (sum.supp[k] || 0) + d.supp[k]; });
      Object.keys(d.unknown || {}).forEach(function (k) { sum.unknown[k] = (sum.unknown[k] || 0) + d.unknown[k]; });
      sum.partialCount += d.partialCount; sum.partialKcal += d.partialKcal;
    });
    var q = { measured: 0, photo: 0, partial: 0 }, total = 0;
    days.forEach(function (d) {
      Tracker.day(d.date).forEach(function (e) {
        var k = showKcal() ? (Tracker.nutrientsOf(e).kcal || 0) : 1;   // shares of entries when energy is hidden
        total += k;
        if (!Tracker.isComplete(e)) q.partial += k;
        else if (Tracker.isEstimate(e)) q.photo += k;
        else q.measured += k;
      });
    });
    var share = function (v) { return total ? Math.round(v / total * 100) + '%' : '—'; };
    var avg = function (k) { return logged.length ? (sum[k] || 0) / logged.length : 0; };
    var notes = '';
    try { notes = localStorage.getItem(NOTES_KEY) || ''; } catch (e) { /* ignore */ }
    var fmtDate = function (key) {
      var p = key.split('-').map(Number);
      return new Date(p[0], p[1] - 1, p[2], 12).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    main.innerHTML =
      '<div class="page-head report-head"><h1>' + esc(t('report_title')) + '</h1>' +
      '<p>' + esc(t('report_range', { from: fmtDate(days[0].date), to: fmtDate(end), logged: logged.length, n: n })) + '</p></div>' +
      '<div class="btn-row no-print" style="margin-bottom:14px">' +
      [7, 14, 30].map(function (d) {
        return '<button class="chip" type="button" data-rrange="' + d + '" aria-pressed="' + (d === n) + '">' + d + ' days</button>';
      }).join('') +
      '<button class="btn" type="button" id="printBtn">' + esc(t('report_print')) + '</button></div>' +

      '<div class="card pad report-section"><h2>' + esc(t('report_summary')) + '</h2>' +
      (prof ? '<p>' + esc(t('report_profile')) + ': ' + esc(prof.age + ' · ' + prof.sex + ' · ' + fmt(prof.heightCm) + ' cm · ' +
        fmt(prof.weightKg) + ' kg' + (stageOf(prof) ? ' · ' + t('stage_' + stageOf(prof)) : '')) + '</p>' : '') +
      '<p>' + esc(t('report_diet')) + ': ' + esc(dietSummary() || t('none')) + '</p>' +
      (window.Gaps && logged.length ? '<p>' + esc(t('report_plants')) + ': ' + Gaps.plants(days.reduce(function (all, d) {
        return all.concat(Tracker.day(d.date));
      }, []), FOOD_BY_SLUG).count + '</p>' : '') +
      (logged.length && showKcal() ? '<p>' + esc(t('report_avg_energy', { n: Math.round(avg('kcal')) })) +
        (target ? ' ' + esc(t('report_need', { n: target })) : '') + '</p>' : '') + '</div>' +

      '<div class="card pad report-section"><h2>' + esc(t('report_macros')) + '</h2>' +
      '<table class="dri-table"><tbody>' + ['kcal', 'protein', 'carbs', 'sugar', 'fat', 'satfat', 'fiber', 'sodium'].filter(function (k) {
        return k !== 'kcal' || showKcal();
      }).map(function (k) {
        return '<tr><th scope="row">' + esc(nutrientLabel(k)) + '</th><td class="num">' + fmt(avg(k)) + ' ' +
          esc(k === 'kcal' ? 'kcal' : nutrientUnit(k)) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +

      '<div class="card pad report-section"><h2>' + esc(t(showKcal() ? 'report_energy' : 'report_days')) + '</h2>' + chart(days, end, target) + '</div>' +

      (logged.length ? '<div class="report-section">' + nutrientPanel(sum, ref, prof, logged.length, t('avg_title')) + '</div>' : '') +

      '<div class="card pad report-section"><h2>' + esc(t('report_quality')) + '</h2>' +
      '<table class="dri-table"><tbody>' +
      '<tr><th scope="row">' + esc(t('q_measured')) + '</th><td class="num">' + share(q.measured) + '</td></tr>' +
      '<tr><th scope="row">' + esc(t('q_photo')) + '</th><td class="num">' + share(q.photo) + '</td></tr>' +
      '<tr><th scope="row">' + esc(t(showKcal() ? 'q_partial' : 'q_partial_nokcal')) + '</th><td class="num">' + share(q.partial) + '</td></tr>' +
      '</tbody></table>' + (showKcal() ? '' : '<p class="hint">' + esc(t('report_by_entries')) + '</p>') + '</div>' +

      '<div class="card pad report-section"><h2>' + esc(t('report_notes')) + '</h2>' +
      '<textarea id="reportNotes" class="no-print" rows="4" maxlength="2000" placeholder="' +
      esc(t('report_notes_hint')) + '">' + esc(notes) + '</textarea>' +
      '<div class="print-only report-notes" id="reportNotesPrint">' + esc(notes) + '</div></div>' +

      '<p class="hint report-disclaimer">' + esc(t('report_disclaimer')) + '</p>';

    main.querySelectorAll('[data-rrange]').forEach(function (b) {
      b.addEventListener('click', function () { reportState.days = Number(b.dataset.rrange); render(); });
    });
    document.getElementById('printBtn').addEventListener('click', function () { window.print(); });
    var notesEl = document.getElementById('reportNotes');
    notesEl.addEventListener('input', function () {
      document.getElementById('reportNotesPrint').textContent = notesEl.value;
      try { localStorage.setItem(NOTES_KEY, notesEl.value); } catch (e) { /* ignore */ }
    });
  }

  // Plain HTML bars rather than SVG, so labels stay at reading size on a
  // phone. Colours come from the theme tokens.
  function chart(days, sel, target) {
    if (!showKcal()) return dayStrip(days, sel);
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

  /** With calories hidden: which days were logged, and nothing about energy. */
  function dayStrip(days, sel) {
    var dense = days.length > 10;
    var logged = days.filter(function (d) { return d.count; }).length;
    return '<div class="day-strip' + (dense ? ' dense' : '') + '" style="grid-template-columns:repeat(' + days.length + ',1fr)">' +
      days.map(function (d, i) {
        var p = d.date.split('-').map(Number), dt = new Date(p[0], p[1] - 1, p[2], 12);
        var lab = dense ? (i % 5 === days.length % 5 ? String(dt.getDate()) : '') : dt.toLocaleDateString('en-GB', { weekday: 'short' });
        var title = d.count ? t('strip_day_on', { day: dayLabel(d.date), n: t(d.count === 1 ? 'entries_one' : 'entries_n', { n: d.count }) })
                            : t('strip_day_off', { day: dayLabel(d.date) });
        return '<a class="ds-day' + (d.count ? ' on' : '') + (d.date === sel ? ' sel' : '') + '" href="#/today/' + d.date +
          '" title="' + esc(title) + '" aria-label="' + esc(title) + '"><span class="ds-dot"></span>' +
          '<span class="wk-day">' + esc(lab) + '&nbsp;</span></a>';
      }).join('') + '</div>' +
      '<p class="hint" style="margin:8px 0 0">' + esc(t('strip_avg', { days: logged, n: days.length })) + '</p>';
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

  function cuisineCard() {
    if (!window.FoodsMore || !FoodsMore.cuisines.length) return '';
    var mine = Prefs.get('cuisines') || [];
    return '<div class="card pad settings-block cuisine-card"><h2>' + esc(t('cuisines_title')) + '</h2>' +
      '<p class="hint">' + esc(t('cuisines_lede')) + '</p>' +
      '<div class="chips" role="group" aria-label="' + esc(t('cuisines_title')) + '">' +
      FoodsMore.cuisines.map(function (c) {
        return '<button class="chip" type="button" data-cuisine="' + esc(c.code) + '" aria-pressed="' +
          (mine.indexOf(c.code) >= 0) + '">' + esc(c.label) + '</button>';
      }).join('') + '</div></div>';
  }

  function bindDietCard() {
    main.querySelectorAll('[data-cuisine]').forEach(function (b) {
      b.addEventListener('click', function () {
        var list = (Prefs.get('cuisines') || []).slice(), c = b.dataset.cuisine, i = list.indexOf(c);
        if (i >= 0) list.splice(i, 1); else list.push(c);
        Prefs.set('cuisines', list);
        render();
      });
    });
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

  function learntCard() {
    if (!window.Memory) return '';
    var items = Memory.list();
    return '<div class="card pad settings-block learnt-card"><h2>' + esc(t('learnt_title')) + '</h2>' +
      '<p class="hint">' + esc(t('learnt_lede')) + '</p>' +
      (items.length
        ? '<ul class="log-list">' + items.map(function (x) {
            var bits = [];
            if (x.slug === '') bits.push(t('learnt_model'));
            else if (x.slug && FOOD_BY_SLUG[x.slug]) bits.push(t('learnt_match', { food: FOOD_BY_SLUG[x.slug].name }));
            if (x.factor) bits.push(t('learnt_portion', { pct: Math.round(x.factor * 100), n: x.n }));
            return '<li><span class="l-name">' + esc(x.label) + '<span class="l-sub">' + esc(bits.join(' · ')) + '</span></span>' +
              '<button class="chip" type="button" data-forget="' + esc(x.key) + '">' + esc(t('forget')) + '</button></li>';
          }).join('') + '</ul>' +
          '<div class="btn-row" style="margin-top:10px"><button class="btn ghost small" type="button" id="forgetAll">' +
          esc(t('forget_all')) + '</button></div>'
        : '<p>' + esc(t('learnt_none')) + '</p>') + '</div>';
  }

  function installCard() {
    if (!window.PWA) return '';
    var body;
    if (PWA.installed()) body = '<p>' + esc(t('install_done')) + '</p>';
    else if (PWA.canInstall()) body = '<div class="btn-row"><button class="btn" type="button" id="installBtn">' + esc(t('install_btn')) + '</button></div>';
    else body = '<p class="hint">' + esc(/iPhone|iPad|iPod/.test(navigator.userAgent) ? t('install_ios') : t('install_other')) + '</p>';
    return '<div class="card pad settings-block"><h2>' + esc(t('install_title')) + '</h2>' +
      '<p class="hint">' + esc(t('install_lede')) + '</p>' + body + '</div>';
  }

  var REMINDER_KEY = 'foodlog.reminders.v1';
  function reminderPrefs() {
    var d = { breakfast: { on: true, time: '08:00' }, lunch: { on: true, time: '13:00' }, dinner: { on: true, time: '19:00' } };
    try { var s = JSON.parse(localStorage.getItem(REMINDER_KEY) || 'null'); if (s) Object.keys(d).forEach(function (k) { if (s[k]) d[k] = s[k]; }); } catch (e) { /* defaults */ }
    return d;
  }

  function remindersCard() {
    if (!window.Reminders) return '';
    var r = reminderPrefs();
    return '<div class="card pad settings-block"><h2>' + esc(t('reminders_title')) + '</h2>' +
      '<p class="hint">' + esc(t('reminders_lede')) + '</p>' +
      ['breakfast', 'lunch', 'dinner'].map(function (m) {
        return '<div class="measure-row reminder-row"><label class="rem-label"><input type="checkbox" data-rem-on="' + m + '"' +
          (r[m].on ? ' checked' : '') + '> ' + esc(mealLabel(m)) + '</label>' +
          '<input type="time" data-rem-time="' + m + '" value="' + esc(r[m].time) + '" aria-label="' + esc(mealLabel(m)) + '"></div>';
      }).join('') +
      '<p class="hint" id="remMsg" role="status"></p>' +
      '<div class="btn-row"><button class="btn ghost" type="button" id="remBtn">' + esc(t('reminders_btn')) + '</button></div></div>';
  }

  function bindInstallAndReminders() {
    var ib = document.getElementById('installBtn');
    if (ib) ib.addEventListener('click', function () { PWA.promptInstall().then(function () { render(); }); });
    var rb = document.getElementById('remBtn');
    if (rb) rb.addEventListener('click', function () {
      var r = {}, times = [];
      ['breakfast', 'lunch', 'dinner'].forEach(function (m) {
        var on = main.querySelector('[data-rem-on="' + m + '"]').checked;
        var time = main.querySelector('[data-rem-time="' + m + '"]').value || '12:00';
        r[m] = { on: on, time: time };
        if (on) times.push({ label: mealLabel(m), time: time });
      });
      try { localStorage.setItem(REMINDER_KEY, JSON.stringify(r)); } catch (e) { /* ignore */ }
      if (!times.length) { document.getElementById('remMsg').textContent = t('reminders_none'); return; }
      document.getElementById('remMsg').textContent = '';
      Reminders.download({ times: times });
    });
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

      dietCard() + cuisineCard() +
      '<div class="card pad settings-block"><h2>' + esc(t('hide_kcal_title')) + '</h2>' +
      '<p class="hint">' + esc(t('hide_kcal_lede')) + '</p>' +
      '<label class="toggle-row"><input type="checkbox" id="hideKcal"' + (showKcal() ? '' : ' checked') + '> ' +
      esc(t('hide_kcal_label')) + '</label></div>' +
      '<div class="card pad settings-block"><h2>' + esc(t('dish_spices_title')) + '</h2>' +
      '<p class="hint">' + esc(t('dish_spices_lede')) + '</p>' +
      '<label class="toggle-row"><input type="checkbox" id="dishSpices"' + (dishSpicesOn() ? ' checked' : '') + '> ' +
      esc(t('dish_spices_label')) + '</label></div>' +
      learntCard() +
      installCard() + remindersCard() +

      '<div class="card pad settings-block"><h2>' + esc(t('theme')) + '</h2>' +
      '<select id="themeSel" aria-label="' + esc(t('theme')) + '">' + ['system', 'light', 'dark'].map(function (v) {
        return '<option value="' + v + '"' + (v === theme ? ' selected' : '') + '>' + esc(t('theme_' + v)) + '</option>';
      }).join('') + '</select></div>' +

      '<div class="card pad settings-block"><h2>' + esc(t('data_title')) + '</h2>' +
      '<p class="hint">' + esc(t('data_lede')) + ' ' + esc(t('days_logged', { n: Tracker.dayCount() })) + '</p>' +
      '<div class="btn-row"><button class="btn" type="button" id="exportBtn">' + esc(t('export_btn')) + '</button>' +
      '<label class="btn ghost file-btn">' + esc(t('import_btn')) +
      '<input type="file" accept="application/json,.json" id="importIn" hidden></label>' +
      '<button class="btn danger" type="button" id="clearBtn">' + esc(t('clear_btn')) + '</button></div>' +
      (window.Csv
        ? '<p class="hint" style="margin-top:14px">' + esc(t('csv_hint')) + '</p>' +
          '<div class="btn-row"><button class="btn ghost" type="button" id="csvEntries">' + esc(t('csv_entries')) + '</button>' +
          '<button class="btn ghost" type="button" id="csvDays">' + esc(t('csv_days')) + '</button></div>'
        : '') + '</div>';

    logState.notice = '';
    bindLocalCards();
    bindDietCard();
    bindInstallAndReminders();
    main.querySelectorAll('[data-forget]').forEach(function (b) {
      b.addEventListener('click', function () { Memory.forget(b.dataset.forget); render(); });
    });
    var fa = document.getElementById('forgetAll');
    if (fa) fa.addEventListener('click', function () { Memory.forgetAll(); render(); });
    var syncEl = document.querySelector('.sync-card');
    if (syncEl && window.Sync) Sync.mountCard(syncEl);

    document.getElementById('keySave').addEventListener('click', function () {
      var k = document.getElementById('keyIn').value.trim();
      if (k) { Gemini.setKey(k); render(); }
    });
    var del = document.getElementById('keyDel');
    if (del) del.addEventListener('click', function () { Gemini.setKey(''); render(); });
    document.getElementById('dishSpices').addEventListener('change', function (ev) {
      try {
        if (ev.target.checked) localStorage.removeItem(DISH_SPICES); else localStorage.setItem(DISH_SPICES, '0');
      } catch (e) { /* ignore */ }
    });
    document.getElementById('hideKcal').addEventListener('change', function (ev) {
      try {
        if (ev.target.checked) localStorage.setItem(HIDE_KCAL, '1'); else localStorage.removeItem(HIDE_KCAL);
      } catch (e) { /* private mode: this visit only would need state; keep it simple */ }
      if (window.Sync && Sync.settingsChanged) Sync.settingsChanged();
      render();
    });
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
    if (window.Csv) {
      document.getElementById('csvEntries').addEventListener('click', function () {
        Csv.download(Csv.entries(Tracker), 'food-log-entries-' + Tracker.today() + '.csv');
      });
      document.getElementById('csvDays').addEventListener('click', function () {
        Csv.download(Csv.days(Tracker), 'food-log-days-' + Tracker.today() + '.csv');
      });
    }
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
  var NAV = [['today', 'nav_today'], ['snap', 'nav_snap'], ['meals', 'nav_meals'], ['history', 'nav_history'], ['settings', 'nav_settings']];

  // #/today, #/today/2026-11-07, #/snap ... and #/today?add=<slug>, which is
  // how a food page on Food is Medicine hands a food over to be logged.
  function parseRoute() {
    var hash = location.hash.replace(/^#\/?/, '');
    var q = hash.indexOf('?');
    var query = q >= 0 ? hash.slice(q + 1) : '';
    var parts = (q >= 0 ? hash.slice(0, q) : hash).split('/');
    var name = parts[0] || 'today';
    if (!NAV.some(function (n) { return n[0] === name; }) && name !== 'report') name = 'today';
    var add = /(?:^|&)add=([^&]+)/.exec(query);
    var g = /(?:^|&)g=(\d+)/.exec(query);
    var shared = /(?:^|&)shared=([\w-]+)/.exec(query);
    return { name: name, arg: parts[1] || null, add: add ? decodeURIComponent(add[1]) : null,
             grams: g ? Number(g[1]) : null, shared: shared ? shared[1] : null,
             scan: /(?:^|&)scan=1/.test(query) };
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
    else if (route.name === 'meals') viewMeals();
    else if (route.name === 'report') viewReport();
    else if (route.name === 'settings') viewSettings();
    else viewToday(route.arg);
  }

  function onHash() {
    closeScanner();
    stopListening();
    var prev = route.name;
    route = parseRoute();
    if (route.name !== prev && snap.notice) snap.notice = '';
    if (route.name === 'today' && !route.arg) logState.date = Tracker.today();
    logState.pick = route.name === prev ? logState.pick : null;
    if (route.add && FOOD_BY_SLUG[route.add]) {
      logState.pick = route.add;
      logState.pickGrams = route.grams > 0 && route.grams <= 5000 ? route.grams : null;
      history.replaceState(null, '', '#/today');
      route.add = null;
    } else if (route.add && /^(sr|fd|fn|uk|sp)-/.test(route.add) && window.FoodsMore) {
      // A food from the extended list ("Log this" on its Food is Medicine
      // page): open it once the list has loaded.
      var want = route.add, grams = route.grams;
      route.add = null;
      history.replaceState(null, '', '#/today');
      FoodsMore.load().then(function (l) {
        mergeMore(l);
        if (!FOOD_BY_SLUG[want] || route.name !== 'today') return;
        logState.pick = want;
        logState.pickGrams = grams > 0 && grams <= 5000 ? grams : null;
        render();
      }, function () { /* the curated list only */ });
    }
    if (route.shared) { var sid = route.shared; route.shared = null; history.replaceState(null, '', '#/snap'); handleShared(sid); }
    render();
    if (route.scan && route.name === 'today' && window.Barcode) {
      route.scan = false;
      history.replaceState(null, '', '#/today');
      openScanner();
    }
    var pg = route.name === 'today' && logState.pick && document.getElementById('pickGrams');
    if (pg) pg.scrollIntoView({ block: 'center' });
    if (route.name !== prev) window.scrollTo(0, 0);
  }

  // For the matcher regression tests (tests/match.test.mjs). Read-only.
  window.FoodLogInternals = { prepareItems: prepareItems, mainName: mainName, headWord: headWord, searchFoods: searchFoods };

  if (!FOODS.length || !DRI) {
    main.innerHTML = '<div class="note danger" style="margin-top:24px"><p>' + esc(t('no_data')) + '</p></div>';
    return;
  }
  if (Tracker.importedFrom()) logState.notice = t('imported_legacy');

  window.addEventListener('hashchange', onHash);
  if (window.Queue) {
    Queue.onChange(refreshQueue);
    refreshQueue().then(runQueue);
    // The service worker may have added a shared photo while the page was open.
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshQueue().then(runQueue); });
  }
  // Hide calories switched on another device and applied by sync.
  window.addEventListener('foodlog:display', function () { render(); });
  if (window.PWA && PWA.onChange) {
    PWA.onChange(function () {
      runQueue();
      if (route.name === 'snap' && snap.status !== 'busy') render();
      else if (route.name === 'settings') render();
    });
  }
  // Resume sync if this browser signed in before; a no-op otherwise.
  if (window.Sync && Sync.available()) { try { Sync.start(); } catch (e) { /* sync is optional */ } }
  // Another tab (Food is Medicine, say) can change the shared profile.
  window.addEventListener('storage', function (ev) {
    if (ev.key === 'fim.profile.v1' || ev.key === 'fim.prefs.v1') location.reload();
  });
  onHash();
  // The extended food list (about a megabyte) loads after the first page is
  // drawn, so it never delays it; search covers it from then on.
  if (window.FoodsMore) {
    setTimeout(function () { FoodsMore.load().then(mergeMore, function () { /* curated list only */ }); }, 300);
  }
})();
