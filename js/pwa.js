// Installable, offline Food Log. Registers the service worker (sw.js), keeps
// track of the connection and the browser's install offer, shows a banner
// while offline, and writes meal reminders as a calendar file.
//
// Reminders are a calendar file rather than notifications: a calendar
// reminds you whether or not the site is open, needs no permission prompt
// or push server, and is easy to change or delete in an app you already use.
//
//   PWA.online()          true unless the browser says it is offline
//   PWA.onChange(fn)      fn(online, {online, canInstall, installed}) on any
//                         change of connection or install offer; returns an
//                         unsubscribe function
//   PWA.canInstall()      the browser has offered to install (Chrome, Edge)
//   PWA.promptInstall()   shows that offer; resolves {outcome: 'accepted' |
//                         'dismissed' | 'unavailable'}, never rejects
//   PWA.installed()       running as the installed app
//
//   Reminders.ics({times: [{label, time: 'HH:MM'}], url, tz})  -> .ics text
//   Reminders.download(opts)    saves it as food-log-reminders.ics

(function () {
  'use strict';

  var nav = window.navigator || {};
  var doc = window.document;
  var listeners = [];
  var offer = null; // the beforeinstallprompt event, kept for an Install button
  var isOnline = nav.onLine !== false;

  var OFFLINE_TEXT = 'You’re offline. Search and your log still work; photos, ' +
    'barcodes and voice need a connection (the on-device model still works if downloaded).';

  // ---- connection and install state ------------------------------------------

  function installed() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (e) { /* no display-mode support */ }
    return nav.standalone === true; // iOS Safari's own flag
  }

  function canInstall() { return !!offer && !installed(); }

  function onChange(fn) {
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function emit() {
    var s = { online: isOnline, canInstall: canInstall(), installed: installed() };
    listeners.slice().forEach(function (fn) {
      // One broken listener should not stop the others, but should still be
      // reported.
      try { fn(s.online, s); } catch (e) { setTimeout(function () { throw e; }, 0); }
    });
  }

  function setOnline(value) {
    if (value === isOnline) return;
    isOnline = value;
    banner(!value);
    emit();
  }

  function promptInstall() {
    var ev = offer;
    if (!ev) return Promise.resolve({ outcome: 'unavailable' });
    offer = null; // the browser allows one prompt per offer
    return Promise.resolve()
      .then(function () { return ev.prompt(); })
      .then(function () { return ev.userChoice; })
      .then(function (choice) {
        emit();
        return { outcome: (choice && choice.outcome) || 'dismissed' };
      }, function () {
        emit();
        return { outcome: 'unavailable' };
      });
  }

  // ---- offline banner --------------------------------------------------------
  // In the page flow rather than sticky: the top bar is already sticky at the
  // top, and a second sticky strip would cover its links. Only the site's
  // colour tokens are used, so it follows the light and dark themes.

  function banner(show) {
    if (!doc) return;
    if (!doc.body) {
      doc.addEventListener('DOMContentLoaded', function () { banner(!isOnline); });
      return;
    }
    var el = doc.getElementById('offlineBanner');
    if (!show) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    if (el) return;
    el = doc.createElement('div');
    el.id = 'offlineBanner';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:relative;z-index:50;padding:8px 16px;text-align:center;' +
      'font-size:.9rem;line-height:1.4;background:var(--amber-wash);color:var(--ink);' +
      'border-bottom:1px solid var(--card-edge)';
    doc.body.insertBefore(el, doc.body.firstChild);
    // Filled a moment after it is in the page, so screen readers announce it.
    setTimeout(function () { el.textContent = OFFLINE_TEXT; }, 50);
  }

  // ---- calendar reminders ----------------------------------------------------

  var CRLF = '\r\n';
  var DEFAULT_URL = 'https://just-rice.github.io/food-log/#/today';

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // RFC 5545 TEXT: backslash first, then the characters it escapes.
  function esc(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  function octets(ch) {
    var c = ch.charCodeAt(0);
    if (c < 0x80) return 1;
    if (c < 0x800) return 2;
    return ch.length > 1 ? 4 : 3; // a surrogate pair is one 4-byte character
  }

  // Lines of at most 75 octets; a continuation starts with a space, which
  // counts. Never splits a character's UTF-8 bytes across lines.
  function fold(line) {
    var out = '';
    var used = 0;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      var c = line.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < line.length) ch += line.charAt(++i);
      var n = octets(ch);
      if (used + n > 75) { out += CRLF + ' '; used = 1; }
      out += ch;
      used += n;
    }
    return out;
  }

  var formatters = {};
  // Wall-clock date and time at instant `ms` in zone `tz`; null if Intl
  // cannot do it (unknown zone, or an engine without formatToParts).
  function wallClock(ms, tz) {
    try {
      var f = formatters[tz] || (formatters[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric'
      }));
      var o = {};
      f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = Number(p.value); });
      if (isNaN(o.year + o.month + o.day + o.hour + o.minute)) return null;
      return { y: o.year, mo: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second || 0 };
    } catch (e) {
      return null;
    }
  }

  // Minutes ahead of UTC.
  function offsetAt(ms, tz) {
    var t = Math.floor(ms / 60000) * 60000;
    var w = wallClock(t, tz);
    return w && (Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - t) / 60000;
  }

  function utcOffset(min) {
    var a = Math.abs(min);
    return (min < 0 ? '-' : '+') + pad(Math.floor(a / 60)) + pad(a % 60);
  }

  // Day of the month of the nth weekday `wd` (0 = Sunday); n = -1 for the last.
  function nthWeekday(y, mo, wd, n) {
    if (n > 0) return 1 + (wd - new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 7) % 7 + (n - 1) * 7;
    var last = new Date(Date.UTC(y, mo, 0));
    return last.getUTCDate() - (last.getUTCDay() - wd + 7) % 7;
  }

  // RFC 5545 wants a VTIMEZONE for every TZID. Google and Apple know the IANA
  // names anyway, but Outlook goes by the rules in the file, so derive them
  // from Intl: each change of UTC offset this year becomes a yearly rule on
  // the same weekday of the month ("second Sunday of March"), from 1970.
  function vtimezone(tz, year) {
    var day = 864e5;
    var t = Date.UTC(year, 0, 1);
    var prev = offsetAt(t, tz);
    if (prev === null) return null;
    var changes = [];
    for (t += day; t <= Date.UTC(year + 1, 0, 1); t += day) {
      var off = offsetAt(t, tz);
      if (off === prev) continue;
      var lo = t - day, hi = t; // narrow the change down to the minute
      while (hi - lo > 60000) {
        var mid = lo + Math.floor((hi - lo) / 120000) * 60000;
        if (offsetAt(mid, tz) === prev) lo = mid; else hi = mid;
      }
      changes.push({ at: hi, from: prev, to: off });
      prev = off;
    }
    var lines = ['BEGIN:VTIMEZONE', 'TZID:' + tz];
    if (!changes.length) {
      lines.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:' + utcOffset(prev),
        'TZOFFSETTO:' + utcOffset(prev), 'END:STANDARD');
    }
    changes.forEach(function (c) {
      var kind = c.to > c.from ? 'DAYLIGHT' : 'STANDARD';
      var local = new Date(c.at + c.from * 60000); // onset in the time it replaces
      var mo = local.getUTCMonth() + 1;
      var d = local.getUTCDate();
      var wd = local.getUTCDay();
      var n = d + 7 > new Date(Date.UTC(year, mo, 0)).getUTCDate() ? -1 : Math.ceil(d / 7);
      var clock = 'T' + pad(local.getUTCHours()) + pad(local.getUTCMinutes()) + '00';
      var yearly = changes.length === 2;
      lines.push('BEGIN:' + kind,
        'DTSTART:' + (yearly ? '1970' + pad(mo) + pad(nthWeekday(1970, mo, wd, n))
          : '' + local.getUTCFullYear() + pad(mo) + pad(d)) + clock,
        'TZOFFSETFROM:' + utcOffset(c.from), 'TZOFFSETTO:' + utcOffset(c.to));
      if (yearly) lines.push('RRULE:FREQ=YEARLY;BYMONTH=' + mo + ';BYDAY=' + n + ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][wd]);
      lines.push('END:' + kind);
    });
    lines.push('END:VTIMEZONE');
    return lines;
  }

  function defaultZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
  }

  /**
   * An iCalendar file with one daily event per meal time, each with an alert
   * at the time itself. Neutral wording on purpose: a prompt to write down a
   * meal, never a number to hit. opts.now (a Date or ms) is for tests.
   */
  function ics(opts) {
    opts = opts || {};
    var times = opts.times || [];
    var url = opts.url || DEFAULT_URL;
    var tz = opts.tz || defaultZone();
    var now = opts.now == null ? Date.now() : +opts.now;
    var stampDate = new Date(now);
    var stamp = '' + stampDate.getUTCFullYear() + pad(stampDate.getUTCMonth() + 1) + pad(stampDate.getUTCDate()) +
      'T' + pad(stampDate.getUTCHours()) + pad(stampDate.getUTCMinutes()) + pad(stampDate.getUTCSeconds()) + 'Z';

    // Without a usable zone the times float: 08:00 wherever the calendar is.
    var wall = wallClock(now, tz);
    var zone = wall && vtimezone(tz, wall.y);
    if (!zone) {
      tz = null;
      wall = { y: stampDate.getFullYear(), mo: stampDate.getMonth() + 1, d: stampDate.getDate(),
        h: stampDate.getHours(), mi: stampDate.getMinutes() };
    }

    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Food Log//Meal reminders//EN',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'].concat(zone || []);

    times.forEach(function (t, i) {
      var m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(t && t.time || ''));
      if (!m || +m[1] > 23 || +m[2] > 59) return;
      var h = +m[1], mi = +m[2];
      var label = String(t.label || '').trim() || 'a meal';
      // Today if the time is still ahead, otherwise from tomorrow.
      var passed = h * 60 + mi <= wall.h * 60 + wall.mi;
      var start = new Date(Date.UTC(wall.y, wall.mo - 1, wall.d + (passed ? 1 : 0)));
      var date = '' + start.getUTCFullYear() + pad(start.getUTCMonth() + 1) + pad(start.getUTCDate());
      var slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'meal';
      var summary = 'Log ' + label + ' in Food Log';
      lines.push('BEGIN:VEVENT',
        'UID:' + stamp + '-' + (i + 1) + '-' + slug + '@food-log',
        'DTSTAMP:' + stamp,
        'DTSTART' + (tz ? ';TZID=' + tz : '') + ':' + date + 'T' + pad(h) + pad(mi) + '00',
        'DURATION:PT5M',
        'RRULE:FREQ=DAILY',
        'SUMMARY:' + esc(summary),
        'DESCRIPTION:' + esc('Open Food Log: ' + url),
        'URL:' + url,
        'TRANSP:TRANSPARENT', // a reminder, not a busy slot
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', 'DESCRIPTION:' + esc(summary), 'END:VALARM',
        'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(fold).join(CRLF) + CRLF;
  }

  function download(opts) {
    var text = ics(opts);
    var href = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    var a = doc.createElement('a');
    a.href = href;
    a.download = 'food-log-reminders.ics';
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(href); }, 30000);
    return text;
  }

  // ---- wiring ----------------------------------------------------------------

  function register() {
    try {
      if (!('serviceWorker' in nav) || !/^https?:$/.test(window.location.protocol)) return;
      nav.serviceWorker.register('sw.js').catch(function () {
        /* the site still works, just not offline */
      });
    } catch (e) { /* e.g. blocked storage in a sandboxed frame */ }
  }

  if (window.addEventListener) {
    window.addEventListener('online', function () { setOnline(true); });
    window.addEventListener('offline', function () { setOnline(false); });
    window.addEventListener('beforeinstallprompt', function (ev) {
      ev.preventDefault(); // the app offers its own Install button instead
      offer = ev;
      emit();
    });
    window.addEventListener('appinstalled', function () { offer = null; emit(); });
    // After the page has loaded, so the offline copy does not compete with
    // the first visit for bandwidth.
    if (doc && doc.readyState === 'complete') register();
    else window.addEventListener('load', register);
  }
  if (!isOnline) banner(true);

  window.PWA = {
    online: function () { return isOnline; },
    onChange: onChange,
    canInstall: canInstall,
    promptInstall: promptInstall,
    installed: installed
  };
  window.Reminders = { ics: ics, download: download };
})();
