'use strict';
// Bare UI renderer (kickoff-runbook Fri 7:00 PM CDT row, pulled into Fri Oct 16, 2026 wave 183): fills the shell in
// index.html. DOM names are the [DESIGN] contract in browser-checks-b1-b3-plan.md §1 (B1-B3 read exactly these).
// Pure apart from the `doc` it is given: no network, no clock, no globals, so Node can require it and run it on jsdom
// (tests/ui.test.js) as well as in the page (js/app.js).
// Rules kept here:
//  - Every string goes in with textContent / createElement only, never innerHTML (OSM names are untrusted).
//  - Labels, placeholder and route option texts come from i18n/<lang>.json through js/i18n.js (i18n-test-spec §9).
//    Option text stays plain (no child elements); the route heading wraps the place name in <span lang="en"> in a
//    non-English page (a11y-test-spec A11, W3C best practice, not a WCAG requirement).
//  - The route summary, findings and data-date line exist in English only so far: in a Spanish page those elements
//    carry lang="en" so a screen reader reads them with English rules. No Spanish wording is invented here.
//  - Wording rule (crosssafe-spec §a): what the mapped data shows or doesn't say; never "safe", "unsafe", "violates".
//  - Each finding row carries data-osm-id (= osm_id, "<type>/<id>") and data-finding-id (= fid, "<kind>:<osm_id>",
//    unique per route: [CS-L1-FID]); a road both walked along and crossed has one row per kind.
//  - A stretch's left/right side is relative to the OSM way's drawing direction (js/route.js), which means nothing to a
//    reader, so the row shows only its length and "both sides" when the route runs along both.
const I = require('./i18n.js');

const SCHOOL = { id: '481965001818', name: 'Dulles High School' };

function el(doc, tag, attrs, text) {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }

// "Map data as of YYYY-MM-DD" from an ISO-Z osm_base (UTC calendar date; the file stores ISO-Z, check-data rule C).
function dataDate(osmBase) {
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(String(osmBase || ''));
  if (!m) throw new Error(`osm_base '${osmBase}' is not ISO-Z`);
  return m[1];
}
const dataLine = (osmBase) => `Map data as of ${dataDate(osmBase)}`;

// Visible street text for one finding row. ways = Map(way id -> way element) from the snapshot.
function streetOf(f, ways) {
  const m = /^(way|node)\/(\d+)$/.exec(f.osm_id);
  if (f.kind === 'crossing') {
    const i = String(f.text).indexOf(': ');
    if (i > 0) return f.text.slice(0, i);
  }
  if (m && m[1] === 'way') {
    const w = ways.get(Number(m[2]));
    const wt = (w && w.tags) || {};
    if (wt.name) return wt.name;
    return `unnamed ${String(wt.highway || 'road').replace(/_link$/, '')} road`;
  }
  return f.osm_id;
}

// Reason line: the finding text without the street prefix (shown as the street) and without the trailing
// "Flags: …" sentence (shown as chips). The data itself is unchanged.
function reasonOf(f, street) {
  let s = String(f.text);
  if (f.kind === 'crossing' && s.startsWith(street + ': ')) s = s.slice(street.length + 2);
  s = s.replace(/\s*Flags: [^]*$/, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "Along this road · 120 m · both sides" / "Crossing · crossed 2 times": the row's kind line without its points (shared
// with the letter view, js/letter.js, so the letter carries the same words as the list).
function whereOf(f) {
  return f.kind === 'stretch'
    ? `Along this road · ${Math.round(f.length_m)} m${f.side === 'both' ? ' · both sides' : ''}`
    : `Crossing${f.times > 1 ? ` · crossed ${f.times} times` : ''}`;
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

// The live-region summary (p#summary). English only (see header). Numbers are the report's own, unrounded further.
function summaryText(rep, modeSummary) {
  const parts = [
    plural(rep.findings, 'finding', 'findings'),
    `${rep.k} of ${rep.N} crossings: the map doesn't say what kind of crossing it is`,
    plural(rep.entrances, 'driveway/service entrance', 'driveway/service entrances') + ' crossed (not counted as crossings)',
    `${(rep.route_m / 1000).toFixed(2)} km`,
    `${rep.rri_per_km.toFixed(2)} risk points per km`,
  ];
  if (rep.score != null) parts.push(`score ${rep.score} (0-100, 50 = median reference route)`);
  else if (modeSummary && modeSummary.line) parts.push(modeSummary.line);
  parts.push(`confidence ${rep.confidence}`);
  parts.push(dataLine(rep.osm_base));
  return parts.join(' · ') + '.';
}

// Static labels + the school and route pickers, in one language. routes = [{ stem, meta }] in display order.
function renderControls(doc, dict, lang, routes) {
  doc.documentElement.setAttribute('lang', lang);
  // the intro sentence is English only so far (no ES string exists for it): tag it so it is read with English rules
  const intro = doc.querySelector('.intro');
  if (intro) { if (lang === 'en') intro.removeAttribute('lang'); else intro.setAttribute('lang', 'en'); }
  doc.querySelector('label[for="school"]').textContent = dict.SCHOOL_LABEL;
  doc.querySelector('label[for="route"]').textContent = dict.ROUTE_LABEL;
  const school = doc.getElementById('school');
  clear(school);
  const so = el(doc, 'option', { value: SCHOOL.id }, SCHOOL.name);
  so.selected = true;
  school.appendChild(so);
  const sel = doc.getElementById('route');
  const keep = sel.value;
  clear(sel);
  const texts = I.routeOptions(dict, routes);
  sel.appendChild(el(doc, 'option', { value: '' }, texts[0]));
  routes.forEach((r, i) => sel.appendChild(el(doc, 'option', { value: r.stem }, texts[i + 1])));
  if (keep && routes.some((r) => r.stem === keep)) sel.value = keep;
}

// Puts a { text, lang } from I.t() into an element; lang="…" only when the text's language differs from the page's.
function setText(e, r, pageLang) {
  e.textContent = r.text;
  if (r.lang === pageLang) e.removeAttribute('lang'); else e.setAttribute('lang', r.lang);
}

// The visible EN/ES toggle button#lang and the Spanish-draft note p#lang-note (a11y-test-spec A9 / A2m / W4; added
// Fri Oct 16, 2026, wave 184). dicts = { en, es }. The button names the language it switches TO; its text is English
// in both pages ("ES · Spanish draft" / "EN · English"; no new Spanish text), so in the Spanish page it carries
// lang="en". The note shows only in the Spanish page and says plainly that the Spanish is an unreviewed draft.
function renderLang(doc, dicts, lang) {
  doc.documentElement.setAttribute('lang', lang);
  const other = lang === 'es' ? 'en' : 'es';
  const btn = doc.getElementById('lang');
  setText(btn, I.t(dicts, lang, other === 'es' ? 'LANG_TOGGLE_TO_ES' : 'LANG_TOGGLE_TO_EN'), lang);
  btn.setAttribute('data-switch-to', other);
  const note = doc.getElementById('lang-note');
  if (lang === 'es') { setText(note, I.t(dicts, lang, 'LANG_DRAFT_NOTE'), lang); note.hidden = false; }
  else { note.textContent = ''; note.removeAttribute('lang'); note.hidden = true; }
}

// CRIS 2025-26 status line (browser-checks-b1-b3-plan §1 Data status row, i18n-test-spec §11, offline-error E9; added
// Fri Oct 16, 2026, wave 184). raw = data/sources.json "raw". Returns the <li> text as { text, lang } when
// raw["cris-2025-2026"].status is "not_included", null when "included"; any other value (or no entry) is an error,
// never a guess. The text is CRIS_NOT_INCLUDED + ". " + CRIS_NOT_INCLUDED_NOTE: it says "not included" (a build-time
// export that was not run), never the "Couldn't reach" wording (nothing was unreachable at page load). Both keys are
// English-only (no Spanish draft is shipped), so a Spanish page shows them in English with lang="en".
function crisLine(dicts, lang, raw) {
  const e = raw && raw['cris-2025-2026'];
  const st = e && e.status;
  if (st === 'included') return null;
  if (st !== 'not_included') throw new Error(`data/sources.json raw["cris-2025-2026"].status is ${JSON.stringify(st)}, want "included" or "not_included"`);
  const a = I.t(dicts, lang, 'CRIS_NOT_INCLUDED'), b = I.t(dicts, lang, 'CRIS_NOT_INCLUDED_NOTE');
  if (a.lang !== b.lang) throw new Error('CRIS_NOT_INCLUDED and CRIS_NOT_INCLUDED_NOTE must be in one language');
  return { text: `${a.text}. ${b.text}`, lang: a.lang };
}

// div#source-status[role=status] > ul > li[data-source="snapshot"], then (wave 184) li[data-source="cris-2025-2026"]
// when the CRIS 2025-26 export is not included, then (wave 184, browser-checks §3b) one li[data-source="<host>"] per
// outside host the page could not reach (opts.unreachable, in order): SOURCE_UNREACHABLE with {host} and {date} = the
// snapshot date. opts = { dicts, raw, unreachable } (raw = data/sources.json "raw"); without opts only the snapshot
// line is written.
function renderStatus(doc, lang, osmBase, opts) {
  const box = doc.getElementById('source-status');
  clear(box);
  const ul = el(doc, 'ul');
  ul.appendChild(el(doc, 'li', Object.assign({ 'data-source': 'snapshot' }, lang === 'en' ? {} : { lang: 'en' }), dataLine(osmBase)));
  const cris = opts ? crisLine(opts.dicts, lang, opts.raw) : null;
  if (cris) {
    const li = el(doc, 'li', { 'data-source': 'cris-2025-2026' });
    setText(li, cris, lang);
    ul.appendChild(li);
  }
  for (const host of (opts && opts.unreachable) || []) {
    const r = I.t(opts.dicts, lang, 'SOURCE_UNREACHABLE');
    const li = el(doc, 'li', { 'data-source': host });
    setText(li, { text: I.fill(r.text, { host, date: dataDate(osmBase) }), lang: r.lang }, lang);
    ul.appendChild(li);
  }
  box.appendChild(ul);
}

// div#map's accessible name and p#map-hint (i18n-test-spec §10; a11y-test-spec A1-map (e)), in the page language when
// a draft exists, else English with lang="en" on #map and #map-hint (Leaflet's own control names are English too).
function renderMapLabels(doc, dicts, lang) {
  const map = doc.getElementById('map');
  const hint = doc.getElementById('map-hint');
  if (!map || !hint) return;
  const label = I.t(dicts, lang, 'MAP_LABEL');
  map.setAttribute('aria-label', label.text);
  if (label.lang === lang) map.removeAttribute('lang'); else map.setAttribute('lang', label.lang);
  setText(hint, I.t(dicts, lang, 'MAP_KEYS_HINT'), lang);
}

// W3: one button.show-on-map per finding row (added once the map exists), visible text SHOW_ON_MAP, accessible name
// from js/map.js showOnMapNames() (starts with the visible text; distinct per row). Idempotent: old buttons are removed.
function addShowOnMap(doc, dicts, lang, names) {
  const lis = [...doc.querySelectorAll('#findings > li.finding')];
  for (const b of doc.querySelectorAll('#findings button.show-on-map')) b.remove();
  const rows = lis.map((li) => ({ street: li.querySelector('.street').textContent, osm_id: li.getAttribute('data-osm-id'), kind: li.getAttribute('data-finding-id').split(':')[0] }));
  const n = names(dicts, lang, rows);
  lis.forEach((li, i) => {
    const b = el(doc, 'button', Object.assign({ type: 'button', class: 'show-on-map', 'aria-label': n.names[i] }, n.lang === lang ? {} : { lang: n.lang }), n.text);
    li.appendChild(b);
  });
}

// Route card + findings into section#results (the polite live region that is already in the served markup).
// route = { stem, meta }; rep = buildReport(...) for it; ways = Map(way id -> way); modeSummary = rri.modes[mode].
function renderRoute(doc, dict, lang, route, rep, ways, modeSummary) {
  const heading = doc.getElementById('route-heading');
  const note = doc.getElementById('route-note');
  const summary = doc.getElementById('summary');
  const list = doc.getElementById('findings');
  clear(heading); clear(list);
  const L = I.routeLabel(dict, route.stem, route.meta);
  const at = L.label.indexOf(L.place);
  if (lang !== 'en' && at >= 0) {
    heading.appendChild(doc.createTextNode(L.label.slice(0, at)));
    heading.appendChild(el(doc, 'span', { lang: 'en' }, L.place));
    heading.appendChild(doc.createTextNode(L.label.slice(at + L.place.length)));
  } else heading.textContent = L.label;
  note.textContent = L.note || '';
  note.hidden = !L.note;
  const en = lang === 'en' ? {} : { lang: 'en' };
  for (const e of [summary, list]) { if (lang === 'en') e.removeAttribute('lang'); else e.setAttribute('lang', 'en'); }
  summary.textContent = summaryText(rep, modeSummary);
  for (const f of rep.list) {
    const street = streetOf(f, ways);
    const li = el(doc, 'li', { class: 'finding', 'data-osm-id': f.osm_id, 'data-finding-id': f.fid });
    li.appendChild(el(doc, 'span', { class: 'street' }, street));
    const where = whereOf(f);
    li.appendChild(el(doc, 'span', { class: 'kind' }, `${where} · ${f.points.toFixed(2)} risk points`));
    li.appendChild(el(doc, 'span', { class: 'reason' }, reasonOf(f, street)));
    if (f.flags && f.flags.length) {
      const chips = el(doc, 'ul', Object.assign({ class: 'chips' }, en));
      for (const fl of f.flags) chips.appendChild(el(doc, 'li', { class: 'chip' }, fl));
      li.appendChild(chips);
    }
    list.appendChild(li);
  }
}

// ?demo=<school> (build-plan S7 / Sat 4:00-5:30 PM row, kickoff-runbook §B4; added Fri Oct 16, 2026, wave 185): the one
// school id the page knows, 'dulles' (the id scripts/report.js uses), pre-selects that school and its first demo route,
// so a judge sees findings with no clicks. [DESIGN] "first demo route" = the first route whose meta.demo is true, else
// the first saved route in select#route order (no committed route has meta.demo true: all six start at named public
// places). Any other value (or none) returns null and the page opens as usual, with nothing picked: never a guess.
const DEMO_SCHOOLS = { dulles: SCHOOL.id };
function demoRouteStem(param, routes) {
  if (param == null || !Object.prototype.hasOwnProperty.call(DEMO_SCHOOLS, param)) return null;
  const r = routes.find((x) => x.meta && x.meta.demo === true) || routes[0];
  return r ? r.stem : null;
}

// Clears the route card (placeholder chosen again).
function clearRoute(doc) {
  for (const id of ['route-heading', 'summary', 'findings']) clear(doc.getElementById(id));
  const note = doc.getElementById('route-note');
  note.textContent = ''; note.hidden = true;
}

module.exports = { SCHOOL, DEMO_SCHOOLS, demoRouteStem, setText, whereOf, renderLang, crisLine, renderMapLabels, addShowOnMap, dataDate, dataLine, streetOf, reasonOf, summaryText, renderControls, renderStatus, renderRoute, clearRoute };
