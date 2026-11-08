// The log as spreadsheet files: one row per entry, or one row per day.
//
// Plain functions over the Tracker's public API, so they can be tested on
// their own. A nutrient an entry does not carry is a blank cell, never 0:
// a typed-in food with no vitamin data did not contain no vitamin C.
//
// Names come from photo readers and Open Food Facts, so a cell that starts
// like a spreadsheet formula (= + - @) is prefixed with an apostrophe;
// otherwise opening the file could run it.

(function () {
  'use strict';

  // Columns after energy, in the order Food is Medicine's food pages use.
  var COLS = [
    ['protein', 'Protein', 'g'], ['carbs', 'Carbohydrate', 'g'], ['sugar', 'Sugars', 'g'],
    ['fat', 'Total fat', 'g'], ['satfat', 'Saturated fat', 'g'], ['fiber', 'Fibre', 'g'],
    ['vita', 'Vitamin A', 'µg'], ['vitc', 'Vitamin C', 'mg'], ['vitd', 'Vitamin D', 'µg'],
    ['vite', 'Vitamin E', 'mg'], ['vitk', 'Vitamin K', 'µg'], ['thiamin', 'Thiamin (B1)', 'mg'],
    ['riboflavin', 'Riboflavin (B2)', 'mg'], ['niacin', 'Niacin (B3)', 'mg'],
    ['pantothenic', 'Pantothenic acid (B5)', 'mg'], ['b6', 'Vitamin B6', 'mg'],
    ['folate', 'Folate', 'µg'], ['b12', 'Vitamin B12', 'µg'], ['choline', 'Choline', 'mg'],
    ['calcium', 'Calcium', 'mg'], ['iron', 'Iron', 'mg'], ['magnesium', 'Magnesium', 'mg'],
    ['phosphorus', 'Phosphorus', 'mg'], ['potassium', 'Potassium', 'mg'], ['sodium', 'Sodium', 'mg'],
    ['zinc', 'Zinc', 'mg'], ['copper', 'Copper', 'mg'], ['manganese', 'Manganese', 'mg'],
    ['selenium', 'Selenium', 'µg']
  ];
  var SOURCES = { food: 'Search', photo: 'Photo', manual: 'Typed in', barcode: 'Packet barcode',
                  recipe: 'Recipe', supplement: 'Supplement' };
  var MEALS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

  function num(v) {
    if (v == null || !isFinite(v)) return '';
    return Math.round(v * 100) / 100;
  }

  /** One cell: numbers as they are; text quoted when needed and defused. */
  function cell(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return isFinite(v) ? String(v) : '';
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** Rows of cells as a CSV file: UTF-8 with a BOM (for Excel) and CRLF lines. */
  function build(rows) {
    return '﻿' + rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n') + '\r\n';
  }

  function header(first) {
    return first.concat(COLS.map(function (c) { return c[1] + ' (' + c[2] + ')'; }));
  }

  function time(at) {
    if (!(at > 0)) return '';
    var d = new Date(at);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  /** Every entry, oldest day first. `T` is window.Tracker. */
  function entries(T) {
    var rows = [header(['Date', 'Time', 'Meal', 'Food', 'Brand', 'Source', 'Grams', 'Grams (low)', 'Grams (high)',
                        'Measured', 'Energy (kcal)', 'Energy low (kcal)', 'Energy high (kcal)'])];
    T.allDates().slice().sort().forEach(function (date) {
      T.day(date).slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); }).forEach(function (e) {
        var n = T.nutrientsOf(e), r = T.kcalRange(e), est = T.isEstimate(e);
        rows.push([date, time(e.at), MEALS[e.meal] || e.meal, e.name, e.brand || '', SOURCES[e.source] || e.source || '',
          e.fixed ? '' : num(e.grams), est && e.gramsLow ? num(e.gramsLow) : '', est && e.gramsHigh ? num(e.gramsHigh) : '',
          e.measured ? (e.measure || 'yes') : (est ? 'estimate' : ''),
          num(n.kcal), est ? num(r[0]) : '', est ? num(r[1]) : '']
          .concat(COLS.map(function (c) { return num(n[c[0]]); })));
      });
    });
    return build(rows);
  }

  /** One row per logged day, with the energy left without vitamin data. */
  function days(T) {
    var rows = [header(['Date', 'Entries', 'Energy (kcal)', 'Energy low (kcal)', 'Energy high (kcal)',
                        'Energy without vitamin and mineral data (kcal)'])];
    T.allDates().slice().sort().forEach(function (date) {
      var t = T.totals(date);
      if (!t.count) return;
      rows.push([date, t.count, num(t.kcal), num(t.kcalLow), num(t.kcalHigh), num(t.partialKcal)]
        .concat(COLS.map(function (c) { return num(t[c[0]]); })));
    });
    return build(rows);
  }

  /** Save text as a file through a temporary link. */
  function download(text, name) {
    var href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = href; a.download = name; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(href); }, 30000);
  }

  window.Csv = { cell: cell, build: build, entries: entries, days: days, download: download, COLS: COLS };
})();
