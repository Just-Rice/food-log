// js/pwa.js without a browser: it loads where service workers do not exist,
// tracks the connection, and Reminders.ics writes calendar files that follow
// RFC 5545 (CRLF, 75-octet folding, escaping, a VTIMEZONE per TZID).
//   node tests/unit/pwa.test.mjs   (from food-log/)

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(here, '..', '..', 'js', 'pwa.js'), 'utf8');

const fails = [];
const check = (cond, msg) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) fails.push(msg);
};

/** A fresh window with just enough DOM for pwa.js. */
function load({ onLine = true, protocol = 'file:', serviceWorker } = {}) {
  const handlers = {};
  const body = {
    children: [],
    get firstChild() { return this.children[0] || null; },
    insertBefore(el) { this.children.unshift(el); el.parentNode = this; },
    appendChild(el) { this.children.push(el); el.parentNode = this; },
    removeChild(el) { this.children = this.children.filter((c) => c !== el); el.parentNode = null; }
  };
  const document = {
    readyState: 'complete',
    body,
    createElement: (tag) => ({ tagName: tag, style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
    getElementById: (id) => body.children.find((c) => c.id === id) || null,
    addEventListener() {}
  };
  const navigator = { onLine };
  if (serviceWorker) navigator.serviceWorker = serviceWorker;
  const ctx = {
    navigator, document, location: { protocol, href: protocol + '//localhost/food-log/' },
    addEventListener: (type, fn) => (handlers[type] = handlers[type] || []).push(fn),
    setTimeout: (fn) => fn(), console
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'pwa.js' });
  ctx.fire = (type, ev = {}) => (handlers[type] || []).forEach((fn) => fn(ev));
  return ctx;
}

// ---- loading and state --------------------------------------------------------

let w;
try { w = load(); } catch (e) { w = null; console.log(e); }
check(w && w.PWA && w.Reminders, 'loads on file:// with no service worker support');
check(w.PWA.online() === true && w.PWA.canInstall() === false && w.PWA.installed() === false,
  'online, nothing to install, not installed');

const registered = [];
load({ protocol: 'https:', serviceWorker: { register: (u) => { registered.push(u); return Promise.resolve({}); } } });
check(registered.length === 1 && registered[0] === 'sw.js', 'registers sw.js on https');
load({ protocol: 'https:', serviceWorker: { register: () => { throw new Error('SecurityError'); } } });
check(true, 'a register() that throws is survived');

w = load({ onLine: false });
const bannerEl = () => w.document.getElementById('offlineBanner');
check(w.PWA.online() === false, 'offline at load: online() is false');
check(bannerEl() && w.document.body.firstChild === bannerEl() && bannerEl().attrs.role === 'status',
  'offline banner is the first child of <body>, role=status');
check(/You’re offline\. Search and your log still work/.test(bannerEl() && bannerEl().textContent),
  'banner text');
const seen = [];
const off = w.PWA.onChange((online, s) => seen.push([online, s.online]));
w.navigator.onLine = true; w.fire('online');
check(!bannerEl() && w.PWA.online() === true, 'back online: banner removed');
check(seen.length === 1 && seen[0][0] === true && seen[0][1] === true, 'onChange(fn) gets (true, {online: true})');
off(); w.fire('offline');
check(seen.length === 1 && bannerEl(), 'unsubscribe works; offline again brings the banner back');

const prompt = { preventDefault() { this.prevented = true; }, prompt() { this.shown = true; }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
w.fire('beforeinstallprompt', prompt);
check(prompt.prevented && w.PWA.canInstall(), 'beforeinstallprompt is kept: canInstall() is true');
const outcome = await w.PWA.promptInstall();
check(prompt.shown && outcome.outcome === 'accepted' && !w.PWA.canInstall(), 'promptInstall() shows it once: accepted');
check((await w.PWA.promptInstall()).outcome === 'unavailable', 'a second promptInstall() resolves "unavailable"');

// ---- Reminders.ics -------------------------------------------------------------

const R = load().Reminders;
const unfold = (text) => text.replace(/\r\n[ \t]/g, '');
const lines = (text) => unfold(text).split('\r\n').slice(0, -1);
const blocks = (text, name) => {
  const out = [];
  let cur = null;
  for (const l of lines(text)) {
    if (l === 'BEGIN:' + name) cur = [];
    else if (l === 'END:' + name) { out.push(cur); cur = null; }
    else if (cur) cur.push(l);
  }
  return out;
};

const NOW = Date.UTC(2026, 10, 8, 12, 0); // 07:00 in New York
const times = [
  { label: 'Breakfast', time: '08:00' },
  { label: 'Lunch, late', time: '13:30' },
  { label: 'Dinner', time: '06:30' }, // already past at 07:00, so it starts tomorrow
  { label: 'Second breakfast; tea & toast \\ jam\nwith an unusually long name, to force folding — façade ☕', time: '10:15' }
];
const url = 'https://just-rice.github.io/food-log/#/today';
const ics = R.ics({ times, url, tz: 'America/New_York', now: NOW });

check(!/\r(?!\n)|(?<!\r)\n/.test(ics) && ics.endsWith('\r\n'), 'CRLF line endings everywhere, final CRLF');
const physical = ics.split('\r\n').slice(0, -1);
const longest = Math.max(...physical.map((l) => Buffer.byteLength(l, 'utf8')));
check(longest <= 75, 'every line at most 75 octets (longest ' + longest + ')');
check(physical.some((l) => l.startsWith(' ')), 'long lines are folded');
// 4-byte characters (surrogate pairs in JS) across many fold points.
const rice = '🍚'.repeat(60) + 'é'.repeat(41);
const wide = R.ics({ times: [{ label: rice, time: '12:00' }], tz: 'UTC', now: NOW });
const widePhysical = wide.split('\r\n').slice(0, -1);
check(Buffer.from(wide, 'utf8').toString('utf8') === wide &&
  widePhysical.every((l) => Buffer.byteLength(l, 'utf8') <= 75 && !/[\ud800-\udbff]$/.test(l) && !/^ ?[\udc00-\udfff]/.test(l)) &&
  lines(wide).includes('SUMMARY:Log ' + rice + ' in Food Log'),
  'folding never splits a multi-byte character, and unfolds to the original');

const stack = [];
let nested = true;
for (const l of lines(ics)) {
  const m = /^(BEGIN|END):(.+)$/.exec(l);
  if (!m) continue;
  if (m[1] === 'BEGIN') stack.push(m[2]);
  else if (stack.pop() !== m[2]) nested = false;
}
check(nested && stack.length === 0, 'BEGIN/END balanced and nested');

const all = lines(ics);
check(all[0] === 'BEGIN:VCALENDAR' && all.at(-1) === 'END:VCALENDAR', 'wrapped in VCALENDAR');
for (const p of ['VERSION:2.0', 'PRODID:-//Food Log//Meal reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']) {
  check(all.includes(p), p);
}

const events = blocks(ics, 'VEVENT');
check(events.length === times.length, 'one VEVENT per time (' + events.length + ')');
const prop = (ev, name) => ev.find((l) => l.startsWith(name + ':') || l.startsWith(name + ';'));
check(events.every((ev) => prop(ev, 'RRULE') === 'RRULE:FREQ=DAILY'), 'RRULE:FREQ=DAILY on every event');
check(events.every((ev) => prop(ev, 'DURATION') === 'DURATION:PT5M'), 'DURATION:PT5M on every event');
check(events.every((ev) => /^DTSTART;TZID=America\/New_York:\d{8}T\d{6}$/.test(prop(ev, 'DTSTART'))), 'DTSTART carries the TZID');
check(events.every((ev) => /^DTSTAMP:\d{8}T\d{6}Z$/.test(prop(ev, 'DTSTAMP'))), 'DTSTAMP in UTC');
check(prop(events[0], 'DTSTART').endsWith(':20261108T080000'), 'a time still ahead starts today: ' + prop(events[0], 'DTSTART'));
check(prop(events[2], 'DTSTART').endsWith(':20261109T063000'), 'a time already past starts tomorrow: ' + prop(events[2], 'DTSTART'));
const uids = events.map((ev) => prop(ev, 'UID'));
check(uids.every((u) => /@food-log$/.test(u)) && new Set(uids).size === uids.length, 'UIDs unique, @food-log');
check(events.every((ev) => prop(ev, 'URL') === 'URL:' + url), 'URL property');
check(events.every((ev) => prop(ev, 'DESCRIPTION').includes(url)), 'DESCRIPTION has the URL');
check(prop(events[0], 'SUMMARY') === 'SUMMARY:Log Breakfast in Food Log', 'summary wording');
check(prop(events[1], 'SUMMARY') === 'SUMMARY:Log Lunch\\, late in Food Log', 'comma escaped: ' + prop(events[1], 'SUMMARY'));
check(prop(events[3], 'SUMMARY') ===
  'SUMMARY:Log Second breakfast\\; tea & toast \\\\ jam\\nwith an unusually long name\\, to force folding — façade ☕ in Food Log',
  'semicolon, backslash and newline escaped; unfolds to the original');
const alarms = blocks(ics, 'VALARM');
check(alarms.length === times.length &&
  alarms.every((a) => a.includes('ACTION:DISPLAY') && a.includes('TRIGGER:PT0M') && a.some((l) => l.startsWith('DESCRIPTION:'))),
  'a VALARM per event: ACTION:DISPLAY, TRIGGER:PT0M, DESCRIPTION');
check(!/calori|kcal|weight|streak/i.test(ics), 'no calories, weight or streaks in the wording');

// The zone the TZID names is defined, with this year's rules.
const tzFor = (tz) => blocks(R.ics({ times: [{ label: 'Lunch', time: '12:00' }], tz, now: NOW }), 'VTIMEZONE')[0] || [];
const ny = tzFor('America/New_York');
check(ny.includes('TZID:America/New_York'), 'VTIMEZONE for the TZID');
check(ny.join('|').includes('BEGIN:DAYLIGHT|DTSTART:19700308T020000|TZOFFSETFROM:-0500|TZOFFSETTO:-0400|RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU'),
  'New York: daylight time from the second Sunday of March');
check(ny.join('|').includes('BEGIN:STANDARD|DTSTART:19701101T020000|TZOFFSETFROM:-0400|TZOFFSETTO:-0500|RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU'),
  'New York: standard time from the first Sunday of November');
const ldn = tzFor('Europe/London').join('|');
check(/BYMONTH=3;BYDAY=-1SU/.test(ldn) && /BYMONTH=10;BYDAY=-1SU/.test(ldn) && ldn.includes('TZOFFSETTO:+0100'),
  'London: last Sundays of March and October');
const syd = tzFor('Australia/Sydney').join('|');
check(/DAYLIGHT\|DTSTART:19701004T020000\|TZOFFSETFROM:\+1000\|TZOFFSETTO:\+1100\|RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU/.test(syd) &&
  /STANDARD\|DTSTART:19700405T030000\|TZOFFSETFROM:\+1100\|TZOFFSETTO:\+1000\|RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU/.test(syd),
  'Sydney: southern-hemisphere rules');
const kol = tzFor('Asia/Kolkata').join('|');
check(kol.includes('BEGIN:STANDARD|DTSTART:19700101T000000|TZOFFSETFROM:+0530|TZOFFSETTO:+0530|END:STANDARD') && !kol.includes('DAYLIGHT'),
  'Kolkata: one fixed offset, no daylight time');

// Defaults and edges.
const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
const dflt = R.ics({ times: [{ label: 'Breakfast', time: '08:00' }] });
check(lines(dflt).includes('TZID:' + zone) && dflt.includes('URL:' + url), 'defaults: this device\'s zone (' + zone + ') and the site URL');
const nye = R.ics({ times: [{ label: 'Dinner', time: '19:00' }], tz: 'UTC', now: Date.UTC(2026, 11, 31, 20, 0) });
check(lines(nye).includes('DTSTART;TZID=UTC:20270101T190000'), 'past time on 31 December starts on 1 January');
let bad;
try { bad = R.ics({ times: [{ label: 'Lunch', time: '12:00' }, { label: 'x', time: 'noon' }], tz: 'Not/AZone', now: NOW }); } catch (e) { bad = ''; }
check(blocks(bad, 'VEVENT').length === 1 && /^DTSTART:\d{8}T120000$/m.test(unfold(bad)) && !bad.includes('VTIMEZONE'),
  'unknown zone: floating 12:00, no TZID; an unreadable time is skipped');
check(blocks(R.ics({}), 'VEVENT').length === 0, 'no times: an empty but valid calendar');

// The service worker keeps every script the page loads from this repo, so a
// newly added file still loads offline after the first visit.
const ROOT = path.resolve(here, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const own = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map((m) => m[1]);
const missing = own.filter((f) => !sw.includes("'" + f + "'"));
check(own.length > 10 && missing.length === 0, 'sw.js precaches every script index.html loads' + (missing.length ? ': missing ' + missing.join(', ') : ''));

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
