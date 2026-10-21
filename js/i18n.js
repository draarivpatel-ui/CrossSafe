'use strict';
// Route labels for select#route options and the route heading (i18n-test-spec §9, EN + ES). Pure: no DOM, no network.
// The caller puts the returned strings into the page with textContent only, never innerHTML (an OSM name is untrusted).
// i18n/en.json and i18n/es.json hold the templates; every ES string is a Spanish draft (machine-drafted by Hark, an AI,
// not yet reviewed by a human).
// [DESIGN] (i18n-test-spec §9): {anchor} = meta.anchor.name verbatim (never translated; an intersection keeps its "&"),
// {school} = the school's OSM name, {mode} = ROUTE_MODE_WALK / ROUTE_MODE_BIKE from the file stem's -walk / -bike
// suffix. A stem with neither suffix is an error, never a guess. Demo labels (ROUTE_DEMO_START + ROUTE_DEMO_NOTE) are
// used if and only if meta.demo === true; every other route uses ROUTE_FROM.
const KEYS = ['SCHOOL_LABEL', 'ROUTE_LABEL', 'ROUTE_PLACEHOLDER', 'ROUTE_FROM', 'ROUTE_DEMO_START', 'ROUTE_DEMO_NOTE', 'ROUTE_MODE_WALK', 'ROUTE_MODE_BIKE'];
// [DESIGN] (Fri Oct 16, 2026, wave 184) English-only keys. i18n/es.json holds exactly the 8 KEYS above (the committed
// Spanish drafts) and no new Spanish text is written until a human review path exists, so these keys live in en.json
// only. In a Spanish page t() returns the English text with lang 'en', and the caller puts lang="en" on the element so
// a screen reader reads it with English rules (same rule as the English-only summary and findings). This replaces
// i18n-test-spec item 1's "identical key sets" with: es keys == KEYS, en keys == KEYS + EN_ONLY_KEYS (tests/i18n.test.js).
const EN_ONLY_KEYS = ['LANG_TOGGLE_TO_ES', 'LANG_TOGGLE_TO_EN', 'LANG_DRAFT_NOTE', 'CRIS_NOT_INCLUDED', 'CRIS_NOT_INCLUDED_NOTE',
  'MAP_LABEL', 'MAP_KEYS_HINT', 'SHOW_ON_MAP', 'SHOW_ON_MAP_NAME', 'SOURCE_UNREACHABLE',
  // letter view (wave 185, test-spec §L): English only, like the summary and findings it copies
  'LETTER_OPEN', 'LETTER_PRINT', 'LETTER_BACK', 'LETTER_TITLE', 'LETTER_TO', 'LETTER_INTRO', 'LETTER_ROUTE',
  'LETTER_FINDINGS_HEADING', 'LETTER_DATES_HEADING', 'LETTER_CRIS_AS_OF', 'LETTER_CREDIT',
  // letter QR (wave 186, test-spec §L L5)
  'LETTER_QR_ALT'];
const LANGS = ['en', 'es'];

// dicts = { en: parsed en.json, es: parsed es.json }. Returns { text, lang }: lang is the language the text is really in.
function t(dicts, lang, key) {
  const d = dicts[lang] || {};
  if (Object.prototype.hasOwnProperty.call(d, key)) return { text: d[key], lang };
  if (Object.prototype.hasOwnProperty.call(dicts.en || {}, key)) return { text: dicts.en[key], lang: 'en' };
  throw new Error(`i18n key ${key} is missing`);
}
const MODE_KEY = { walk: 'ROUTE_MODE_WALK', bike: 'ROUTE_MODE_BIKE' };

// One pass over the template: a substituted value is never re-scanned, so a name containing "{mode}" or "$&" stays literal.
function fill(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => {
    if (!Object.prototype.hasOwnProperty.call(vars, k)) throw new Error(`template placeholder {${k}} has no value`);
    return String(vars[k]);
  });
}

function modeOf(stem) {
  const m = /-(walk|bike)$/.exec(String(stem));
  if (!m) throw new Error(`route file '${stem}' has no -walk/-bike suffix`);
  return m[1];
}

// dict = parsed i18n/<lang>.json; stem = route file name without .json; meta = that file's meta ({anchor, demo}).
function routeLabel(dict, stem, meta) {
  const mode = dict[MODE_KEY[modeOf(stem)]];
  const a = (meta && meta.anchor) || {};
  if (!a.name) throw new Error(`route '${stem}' has no meta.anchor.name`);
  if (meta.demo === true) return { key: 'ROUTE_DEMO_START', label: fill(dict.ROUTE_DEMO_START, { school: a.name, mode }), note: dict.ROUTE_DEMO_NOTE, place: a.name };
  return { key: 'ROUTE_FROM', label: fill(dict.ROUTE_FROM, { anchor: a.name, mode }), note: null, place: a.name };
}

// Visible option texts of select#route in one language: the value="" placeholder first, then one per route file.
function routeOptions(dict, routes) {
  return [dict.ROUTE_PLACEHOLDER, ...routes.map((r) => routeLabel(dict, r.stem, r.meta).label)];
}

module.exports = { KEYS, EN_ONLY_KEYS, LANGS, t, fill, modeOf, routeLabel, routeOptions };
