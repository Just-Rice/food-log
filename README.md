# Food Log

A food diary built on [Food is Medicine](https://just-rice.github.io/food-is-medicine/)'s
USDA food library. Log meals by search or by photo, measure portions to turn guesses into
real amounts, and see each day against your own vitamin and mineral reference intakes.

**Live:** https://just-rice.github.io/food-log/

## What it does

**Log by search** — 1,067 foods, searchable by every name Food is Medicine knows (*rajma*,
*bhindi*, *chawal*, *anda*). Cooked and ready-to-eat foods come first, because someone
typing "rice" into a food log has just eaten some, not a bag of dry grain. Pick a USDA
household portion ("1 piece", "1 cup") or type grams, and re-add recent foods in one tap.
Packaged foods can be typed in from their label.

**Snap a meal** — photograph a whole plate. A vision model (Gemini, through your own free
key) names each food it can see and estimates how much, as a range. The calories are *not*
the model's: each item is matched to a USDA record — cooked rice to cooked rice, not to dry
rice at nearly three times the energy — and worked out from those figures. A match far from
the energy density the model expected is flagged as probably the wrong form of the food.
Nothing is logged until you have checked it.

**On-device model** — instead of Gemini, Google's open **Gemma 4 E2B** can read the photo
in the browser itself, through [Transformers.js](https://huggingface.co/docs/transformers.js)
and WebGPU. No key, no daily limit, and the photo never leaves the device. It is a one-time
download of about 3.4 GB (3.9 GB on GPUs without 16-bit shaders), kept in the browser's
cache, and it needs WebGPU: recent Chrome and Edge, and Safari from iOS 26 / macOS 26.

It also needs a GPU that allows a single 1.17 GB buffer, because that is the size of the
model's per-layer embedding table. The obvious workaround — keeping that table on the CPU —
is not available in the browser, because ONNX Runtime's web build has no CPU kernel for its
4-bit lookup. Settings reads the GPU's limit before offering the download and says plainly
when a device falls short, instead of letting the first photo fail. Native runtimes such as
Google's LiteRT keep that table off the GPU, so a native app could run the same model on
more phones than a browser can. With both set up, the
Snap page lets you choose each time.

It is asked exactly what Gemini is asked and goes through the same matching and review.
Tested on a real thali photo, it reliably finds the rice, breads, raita and salad with
sensible amounts, but tends to call every bowl "curry" rather than naming the dal or the
kofta, and runs slower than Gemini. Each item on the review screen can be re-matched by
searching the food list, so a vague "curry" becomes cooked lentils in two taps. Matching is
guarded either way: a big portion is never matched to a spice, powder, flour or oil, and a
match must be within a factor of two of the energy density the model expected. A reply
with broken JSON — small models slip on syntax — is salvaged item by item rather than
thrown away.

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
until you set a profile). Intakes above a tolerable upper limit are flagged — except where
the limit applies only to supplements and fortified foods, since food alone has not been
shown to cause harm at those intakes. Typed-in foods and unmatched photo items carry energy
only; the panel says how much of the day that leaves uncounted rather than treating it as zero.

**History** — 7- and 30-day energy charts, every logged day with its totals, and the logged
days' average against your reference intakes.

**Your data** — the log is stored only in this browser. Export it as JSON to keep a copy or
move it to another device, and import it back (importing the same file twice adds nothing).
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
  carry over. Profile and dietary restrictions are edited there.
- The log itself is `foodlog.log.v1`.

## Privacy

The log, profile and key stay in this browser. With Gemini, a meal photo is shrunk on your
device and sent to Google with your key, and is not stored. With the on-device model it
never leaves the device; the only network traffic is the one-time model download from
Hugging Face and the Transformers.js library from jsDelivr. A key in localStorage is readable by any
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

## Structure

```
index.html        page shell; loads Food is Medicine's data files
css/style.css     Food is Medicine's stylesheet plus the log, photo and measuring styles
js/app.js         hash router and the Today, Snap, History and Settings views
js/tracker.js     the log: storage, totals, measuring, plate rescaling, import/export
js/photo.js       the photo prompt and reply parser, and the Gemini call
js/gemini.js      Gemini client and key storage
js/local-model.js the on-device engine: device check, download, load, read a photo
js/local-worker.js  Web Worker running Gemma 4 E2B with Transformers.js 4.3.1 (WebGPU)
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
