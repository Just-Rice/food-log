# Food Log

A food diary built on [Food is Medicine](https://just-rice.github.io/food-is-medicine/)'s
USDA food library. Log meals by search or by photo, measure portions to turn guesses into
real amounts, and see each day against your own vitamin and mineral reference intakes.
Scan packaged foods, save meals and recipes, describe a meal in words, install it as an app,
and print a report for a doctor or dietitian.

**Live:** https://just-rice.github.io/food-log/

## What it does

**Log by search** — 1,071 foods, searchable by every name Food is Medicine knows (*rajma*,
*bhindi*, *chawal*, *anda*). Cooked and ready-to-eat foods come first, because someone
typing "rice" into a food log has just eaten some, not a bag of dry grain. Pick a USDA
household portion ("1 piece", "1 cup") or type grams, and re-add recent foods in one tap.
Packaged foods can be typed in from their label.

**Scan a barcode** — the camera reads EAN-13, EAN-8 and UPC codes (the browser's own
`BarcodeDetector` where it has one, the `barcode-detector` library on iPhone), or type the
number. Products come from [Open Food Facts](https://world.openfoodfacts.org): energy, macros,
sodium, the serving size, and the product's allergen and vegetarian/vegan tags, which are set
against your dietary settings — a clash is a strong warning before adding. Open Food Facts'
allergen lists can be incomplete (Nutella's lists nuts but not milk), so the panel says the
label on the packet is what to trust. Products are cached on the device and show up in recent
foods; an unknown code falls back to typing it in from the label.

**Copy and move** — "Same as yesterday's breakfast" in one tap, copy any meal to another day,
and move or rename an entry. A copy of a photo item is not tied to that photo, so correcting
the original plate size later leaves the copy alone.

**Saved meals and recipes** (the Meals page) — save any meal on Today as a meal to log again
in one tap, or build a recipe from the food list: ingredients by weight, the cooked weight or
number of servings, and its nutrition per serving and per 100 g as you build it. A recipe is
made of USDA foods, so a logged portion carries every vitamin and mineral, not just energy.

**Snap a meal** — photograph a whole plate; no key or sign-up needed. A vision model names
each food it can see and estimates how much, as a range. The calories are *not* the
model's when a food matches: each item is matched to a USDA record — cooked rice to cooked
rice, not to dry rice at nearly three times the energy — and worked out from those figures.
Mixed dishes (a curry, a burger, sushi, a soup) keep the model's own estimate, because no
single ingredient record describes them. Nothing is logged until you have checked it, and
any item can be re-matched by searching the food list.

**It learns your portions.** Change a match on the review screen ("curry" → cooked lentils)
and the next item the reader calls "curry" is matched the same way. Weigh or measure an item
— on the review screen or later on Today — and Food Log keeps the ratio of your weight to the
reader's guess for that name; the next guess is scaled by the median of the last five (never
more than 2× either way), so three rotis still read as three, just your rotis. Such items are
tagged *your usual* and stay estimates. Accepting an automatic match teaches nothing, nothing
already logged is ever changed, and Settings lists everything learnt with a Forget button. It
syncs with the rest.

For better amounts, put a bank card beside the plate: it is the same size everywhere
(85.6 × 54 mm), so the model scales every item from it, and the review says so. Or
**describe the meal** instead — typed, or spoken where the browser has speech recognition
("two rotis and a bowl of dal with a bit of ghee") — and the same engines turn the words into
items with typical portions, matched and reviewed the same way.

Three engines can read the photo:

- **Free** (the default) — Gemini through Food Log's own Firebase project
  ([Firebase AI Logic](https://firebase.google.com/docs/ai-logic)), so nobody needs a key.
  App Check with reCAPTCHA Enterprise vouches that requests come from this site, with
  one-time tokens. The free daily allowance is shared by everyone using Food Log.
- **Your key** — the same models with your own free key from Google AI Studio, for a
  separate allowance.
- **On this device** — Google's open Gemma 4 E2B, below.

Gemini models are tried in order (`js/config.js`): 3.5 Flash-Lite, 3.1 Flash-Lite, 3.8
Flash, 3.6 Flash, 3 Flash preview. Each has its own free allowance — the Flash-Lite models
500 requests a day, the Flash models 20 — and the newest are often overloaded, so
`js/cascade.js` reads Google's quota errors: a model out of its daily allowance is skipped
until the reset at midnight Pacific time, a per-minute limit or an overload moves on to the
next model, and the per-visitor limit says to wait a moment. The review screen says which
model read the photo and offers **Try a stronger model** (3.8 Flash).

Why Flash-Lite leads, from five photos (a thali, a full English breakfast, spaghetti
bolognese, a burger with fries, a salmon sushi platter) read with the same prompt:

| | Gemma 4 E2B (CPU) | Gemini 3.8 Flash | Gemini 3.5 Flash-Lite |
|---|---|---|---|
| Foods named correctly | rough: misread the breakfast, lumped curries | best | nearly as good |
| Time per photo | 27–67 s | 116–167 s, 3 of 5 retried (overloaded) | 1–2 s |
| Free allowance | unlimited (on device) | 20 a day | 500 a day |

The same test found the matcher turning *french fries* into dry french beans and *black
pudding* into black-eyed peas; `tests/photo-corpus.json` keeps those 20 real replies and
`tests/match.test.mjs` checks the matcher never does it again.

**Dietary settings** — vegetarian, vegan or pescatarian, eleven allergens and any foods you
name, set in Settings and shared with Food is Medicine. Foods outside them are hidden from
search, recent foods and photo matches, and the photo reader is told about them — but diets
and allergies are told differently, on purpose. Someone vegetarian photographs food they
eat, so an ambiguous patty is read as a veggie patty and pieces that could be paneer or
chicken as paneer; only an unmistakable exception is named, and it is flagged ("not
vegetarian: contains bacon") rather than renamed. Allergies get the opposite rule: the model
is told never to leave an allergen out or rename a food to make it fit, and to flag anything
that visibly or usually contains one ("may contain peanuts"), because telling it "this cannot
contain peanuts" would invite it to relabel a peanut sauce as something safe. The review
screen says plainly that Food Log cannot tell whether a meal is safe for an allergy.

**On-device model** — Google's open **Gemma 4 E2B** can read the photo in the browser
itself, through [Transformers.js](https://huggingface.co/docs/transformers.js) and WebGPU.
No daily limit, and the photo never leaves the device. It is a one-time download of about
3.4 GB (3.9 GB on GPUs without 16-bit shaders), kept in the browser's cache, and it needs
WebGPU: recent Chrome and Edge, and Safari from iOS 26 / macOS 26. It is rougher than
Gemini — in the test above it called baked beans chickpeas — so check its list carefully.

It also needs a GPU that allows a single 1.17 GB buffer, because that is the size of the
model's per-layer embedding table. The obvious workaround — keeping that table on the CPU —
is not available in the browser, because ONNX Runtime's web build has no CPU kernel for its
4-bit lookup. Settings reads the GPU's limit before offering the download and says plainly
when a device falls short, instead of letting the first photo fail. Native runtimes such as
Google's LiteRT keep that table off the GPU, so a native app could run the same model on
more phones than a browser can. A reply with broken JSON — small models slip on syntax — is
salvaged item by item rather than thrown away.

**Supplements** (on the Meals page) — save a tablet from its label: amounts per dose, with
conversions for older labels (vitamin D and A in IU, vitamin E in natural or synthetic IU;
folic acid counted as 1.7 µg DFE). One taken every day is offered on Today as a one-tap
"Taken today?" chip, never logged for you. Supplements count toward the day's vitamins and
minerals, and the upper limits that apply only to supplements and fortified foods — preformed
vitamin A, vitamin E, niacin, B6, folic acid, magnesium — are checked against what the
supplements gave, never against food. Food Log does not advise whether to take one.

**Measure to make it accurate** — a photo has no depth, and oil and sauces hide energy, so
a photo estimate alone is good to about a third either way. Any item, on the review screen
or after it is logged, can be measured:

- **Weighed** — a kitchen-scale reading.
- **Household measure** — a count of the food's USDA portion or serving (2 × piece, 1.5 × cup).
- **Plate size** — the model reports the plate size it judged against; give the real one
  and every unmeasured item from that photo is rescaled. Lengths scale with the plate and
  areas with its square; depth is left alone, because it is the part of a photo the model
  reads least reliably. This corrects scale, not depth, so the range stays.

A measured item becomes a single figure, tagged *measured*. Unmeasured photo items stay a
range, and the day's summary says how many of its calories are still unmeasured guesses.

**Vitamins and minerals** — the day's 13 vitamins and 10 minerals as a percentage of your
own RDA or AI, from the NASEM DRI tables for your age and sex (or the US label Daily Values
until you set a profile). Women aged 14 to 50 who say on their Food is Medicine profile that
they are pregnant or breastfeeding get the NASEM values for that stage instead; Food Log then
shows no energy figure, and leaves liver out of its suggestions in pregnancy. Intakes above a tolerable upper limit are flagged — except where
the limit applies only to supplements and fortified foods, since food alone has not been
shown to cause harm at those intakes. Typed-in foods and unmatched photo items carry energy
only; the panel says how much of the day that leaves uncounted rather than treating it as zero.

**History** — 7- and 30-day energy charts, every logged day with its totals, and the logged
days' average against your reference intakes.

**This week's vitamins and minerals** — once three days of the last seven are logged,
History lists the nutrients that averaged under 70% of your reference intake, each with foods
from the list that are rich in it per everyday portion (cooked lentils rather than dry, 30 g
of seeds rather than a cup, no spices, oils or powders, never a food your dietary settings
exclude, never liver for vitamin A, and no game, processed meat or high-mercury fish). Limits exceeded on three or more days are mentioned.
It is about nutrients, never about eating more or less, and says when typed-in entries leave
part of the week uncounted.

**Plants this week** — how many different plant foods the week's log holds (vegetables,
fruit, pulses, grains, nuts, seeds, herbs, spices and mushrooms, each once however it was
cooked, recipes counted by their ingredients), shown without a target.

**Report** — a printable summary of 7, 14 or 30 days for an appointment: days logged,
averages, the energy chart, vitamins and minerals against your reference intakes, how much
was weighed, estimated from a photo or energy-only, your dietary settings, and your own notes.
"Print or save as PDF" uses the browser's print dialog with a print stylesheet.

**Install it** — Food Log is an installable web app (Settings → Install, or Add to Home
Screen on iPhone). A service worker keeps the app and Food is Medicine's food data on the
device, so search, the log, meals and History work offline. Long-press the icon for **Snap a
meal**, **Scan a barcode** and **Today**; on Android, **share a photo** from the gallery or
camera straight into Snap (iPhone does not let web apps receive shares).

**Offline photos** — with no connection, a photo or description is kept on the device
(IndexedDB, never more than 30, never longer than two weeks) and read by Gemini once the
connection returns, while Food Log is open; Today then offers it to check, on the day and meal
it was taken. If the on-device model is downloaded, it reads the photo at once instead, and —
unless you chose the on-device model on purpose, so a photo meant to stay on the phone never
leaves it — Food Log offers to read it again with Gemini (Flash-Lite first) when you are back
online. That better reading waits on Today until you compare it: replacing removes the photo's
entries nobody weighed and keeps the ones you did. Readings that keep failing can be retried
or removed. Barcodes need a connection.

**Meal reminders (optional)** — Settings makes a calendar file with a daily reminder for each
meal you tick, at your times, for your own calendar app. Food Log sends no notifications and
keeps no record of whether you log; there are no streaks.

**Sync across devices (optional)** — sign in with Google in Settings and the log is
mirrored to Firestore in Food Log's Firebase project, one document per day, readable only by
your signed-in account (the security rules allow `users/{uid}/**` to that user alone). The
copy on the device stays the main one: days are merged entry by entry, the most recent change
wins, and a deletion leaves a tombstone for 90 days so another device cannot hand the entry
back. Edits are sent two seconds after you stop typing, and changes from your other devices
arrive live. Signing out leaves the local log as it is. Saved meals and recipes sync the same
way, and so does what Food Log has learnt; so do your profile and dietary settings — but never a Gemini key, the theme, the
engine choice or the on-device model. `tests/sync*.test.mjs` run several simulated devices
against an in-memory backend to check they converge.

**Hide calories** — a switch in Settings for anyone who finds calorie numbers unhelpful. Every
energy figure, total, target and chart goes; foods, amounts, vitamins and minerals stay, and
History shows which days were logged instead of an energy chart. It syncs with your other
settings. `tests/e2e/logging.test.mjs` walks every page with it on and checks that no energy
figure is left in the text, tooltips or screen-reader labels.

**Your data** — without sync, the log is stored only in this browser. Export it as JSON to keep a copy or
move it to another device, and import it back (importing the same file twice adds nothing).
For a spreadsheet, export every entry, or one row per day, as CSV: a blank cell means not
known, never zero, and a name that starts like a formula is defused so opening the file cannot
run it. Signed in, **Delete my synced data** erases every document Food Log stored in the cloud
for your account and the sign-in itself (Google asks you to confirm it is you), then signs out;
the log on the device stays.
A log kept in the old vegetarian edition is brought across automatically.

## What it does not do

It sets no diet targets. With an adult profile the day sits beside your estimated
maintenance energy (Mifflin-St Jeor × activity), the same figure Food is Medicine uses;
deficits and goals stay on its weight page, behind its safety checks. Under 18 there is no
calorie figure at all, only totals, for the reasons that page gives. A support signpost sits
on every page that touches intake.

## Shared with Food is Medicine

The two sites live on the same origin (`just-rice.github.io`), and Food Log uses that:

- `index.html` loads `data/foods.js`, `data/images.js` and `data/dri.js` from
  `../food-is-medicine/`, so there is one copy of the food data, and photographs come from
  its `img/` folder. Cooked foods without a photo of their own borrow the raw food's where
  that is a fair picture of the plate (`PHOTO_FALLBACK` in `js/app.js`).
- Your profile (`fim.profile.v1`), dietary settings (`fim.prefs.v1`) and Gemini key
  (`fim.gemini.key`) are read from the same browser storage Food is Medicine writes, so they
  carry over. Dietary settings can be edited in either; the profile is edited there.
- The log itself is `foodlog.log.v1`; saved meals and recipes `foodlog.library.v1`;
  scanned products `foodlog.products.v1`.

## Privacy

The log, profile and key stay in this browser unless you turn on sync. With the free engine
or your own key, a meal photo is shrunk on your device and sent to Google's Gemini (through
Food Log's Firebase project, or with your key), and is not stored. With the on-device model it
never leaves the device; the only network traffic is the one-time model download from
Hugging Face and the Transformers.js library from jsDelivr. A described meal goes to the same
place a photo would. A scanned barcode is looked up on Open Food Facts; nothing else is sent.
Speech recognition is the browser's own, which in Chrome sends audio to Google. A key in localStorage is readable by any
script on the page, so do not save one on a shared computer. Free keys come from
[Google AI Studio](https://aistudio.google.com/apikey).

## Running it

No build step and no dependencies. Because the data comes from Food is Medicine's folder,
serve the folder that holds both repositories:

```sh
git clone https://github.com/Just-Rice/food-is-medicine
git clone https://github.com/Just-Rice/food-log
python3 -m http.server 8000     # then open http://localhost:8000/food-log/
```

Tests need Node 22 and Playwright (a dev dependency only; the site itself has none):

```sh
cd food-log
npm ci
npx playwright install chromium
npm test
```

`npm test` runs the unit tests (matcher, sync, gaps, PWA helpers) and the browser suites in
`tests/e2e/`. Model replies, Open Food Facts and the camera are mocked, and no request leaves
the machine. GitHub Actions runs the same on every push and pull request
(`.github/workflows/test.yml`).

## Structure

```
index.html        page shell; loads Food is Medicine's data files
css/style.css     Food is Medicine's stylesheet plus the log, photo and measuring styles
js/app.js         hash router and the Today, Snap, Meals, History, Report and Settings views
js/tracker.js     the log: storage, totals, measuring, plate rescaling, import/export
js/config.js      Firebase project settings and the ordered list of free Gemini models
js/cascade.js     tries the models in order; reads quota errors; remembers spent models
js/firebase.js    the free engine: Firebase AI Logic with App Check, loaded on first use
js/photo.js       the photo prompt and reply parser; runs an engine through the cascade
js/gemini.js      Gemini client, key storage and the own-key engine
js/local-model.js the on-device engine: device check, download, load, read a photo
js/local-worker.js  Web Worker running Gemma 4 E2B with Transformers.js 4.3.1 (WebGPU)
js/sync.js        optional Google sign-in sync through Firestore
js/barcode.js     camera scanning, check digits, Open Food Facts lookup and allergen mapping
js/library.js     saved meals, recipes and supplements, recipe nutrition, merge for sync
js/memory.js      what Food Log learns from corrections: matches and portion factors
js/queue.js       meals waiting to be read: offline, shared, and on-device readings to redo
js/gaps.js        the week's low nutrients, the foods suggested for them, plant variety
js/csv.js         the log as spreadsheet files
js/pwa.js         service-worker registration, online state, install prompt, .ics reminders
sw.js             the service worker (offline app shell and food data; receives shared photos)
manifest.webmanifest, icons/   the installable app
tests/            unit tests, browser suites (tests/e2e), shared harness (tests/lib),
                  fixtures, and the 20 real model replies the matcher test uses
js/profile.js     profile storage (copied from Food is Medicine)
js/prefs.js       display and dietary preferences (copied from Food is Medicine)
```

## Disclaimer

This is not medical advice. Photo estimates are rough until a portion is measured. If you
are managing a health condition, are pregnant, or have had a difficult relationship with
food, talk to a doctor or dietitian before using any tracker.

## Licence

Code is MIT. USDA and NASEM data are US government works in the public domain. Photographs
are individually licensed by their authors via Wikimedia Commons and credited where shown.
