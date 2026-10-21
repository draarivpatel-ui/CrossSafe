'use strict';
// Letter view (test-spec §L, browser-checks-b1-b3-plan §1 Letter row; added Fri Oct 16, 2026, wave 185):
// button#letter-open opens article#letter, a one-page printable list of the chosen route's findings with the generic
// addressee, the data dates and the OpenStreetMap credit as printed text. Pure apart from the `doc` it is given (no network, no clock, no
// globals), so tests/ui.test.js runs it on jsdom and js/app.js runs it in the page.
// Rules kept here:
//  - [DESIGN] The spec names the button `button#letter` and the article `article#letter`; HTML ids must be unique in a
//    page, so the button is `button#letter-open` (dated note in test-spec §L and browser-checks §1 Letter row).
//  - The letter lists exactly the findings the page lists for that route: same report (js/report.js buildReport), same
//    order, one li per finding with data-finding-id = fid and data-osm-id = osm_id (test-spec L1, [CS-L1-FID]); the
//    street / kind / reason words come from js/render.js, so the paper says what the screen says.
//  - Addressee is exactly "To whom it may concern / road owner" (decision-sheets l.63). No person's name, no sender, no
//    signature, no contact details and no wording that says it was delivered anywhere (L2). Nothing is typed into it:
//    it has no input, textarea, select or contenteditable (L9).
//  - Observations: data/field-checks.json is not shipped yet, so there is NO section#letter-observations and no
//    "Checked on foot" count line (L3/L4 not built; never a placeholder sentence).
//  - Data dates (L6): the snapshot date ("Map data as of …", same text as #source-status) and the CRIS 2025-26 line
//    (exactly CRIS_NOT_INCLUDED when not included, no digit beyond the label). [DESIGN] No AADT year line: the scores
//    use no traffic counts (every piece carries "traffic count unknown", js/route.js header), so naming a traffic-count
//    year on paper would suggest they were used.
//  - Wording rule (crosssafe-spec §a, L8): what the mapped data shows or doesn't say; never "safe", "unsafe",
//    "dangerous", "violates".
//  - QR + printed live link (test-spec L5, wave 186): figure#letter-qr holds the committed static img/qr-live.svg
//    (made once by scripts/make-qr.py with segno 1.6.6; the page loads no QR library and asks no outside host) and
//    figcaption#letter-url prints data/sources.json live_url as text, so paper that can't be scanned still has the link.
//    The URL is never typed in this file: it comes from sources.json, and an unusable value (not https, a local host)
//    throws instead of printing a wrong link. [DESIGN] live_url is the plain page (no ?demo=): the letter can be for
//    any of the six saved routes, and ?demo=dulles would open the first one.
//  - Every string goes in with textContent / createElement only, never as an HTML string (OSM names are untrusted;
//    tests/ui.test.js U8 greps this file for the HTML-string DOM APIs, test-spec L4).
//  - Language: all letter strings are English-only keys (no Spanish draft is shipped), so in a Spanish page the whole
//    article carries lang="en" and the route label is the English one.
const I = require('./i18n.js');
const V = require('./render.js');

const KEYS = ['LETTER_PRINT', 'LETTER_BACK', 'LETTER_TITLE', 'LETTER_TO', 'LETTER_INTRO', 'LETTER_ROUTE',
  'LETTER_FINDINGS_HEADING', 'LETTER_DATES_HEADING', 'LETTER_CRIS_AS_OF', 'LETTER_CREDIT', 'LETTER_QR_ALT'];

function el(doc, tag, attrs, text) {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}
function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }

// One letter row per finding: { fid, osm_id, text } in report order. ways = Map(way id -> way element).
function letterRows(rep, ways) {
  return rep.list.map((f) => {
    const street = V.streetOf(f, ways);
    return { fid: f.fid, osm_id: f.osm_id, street, text: `${V.whereOf(f)} · ${V.reasonOf(f, street)}` };
  });
}

// The CRIS 2025-26 line for the letter's data dates: CRIS_NOT_INCLUDED alone when not included (L6 exact text; the
// "Crash counts cover 2020-24 only." note stays on the page's status line), LETTER_CRIS_AS_OF with data_as_of when
// included. Any other status fails closed, like js/render.js crisLine().
function letterCris(dicts, lang, raw) {
  const e = raw && raw['cris-2025-2026'];
  const st = e && e.status;
  if (st === 'not_included') return I.t(dicts, lang, 'CRIS_NOT_INCLUDED');
  if (st === 'included') {
    if (!e.data_as_of) throw new Error('data/sources.json raw["cris-2025-2026"] is included but has no data_as_of');
    const r = I.t(dicts, lang, 'LETTER_CRIS_AS_OF');
    return { text: I.fill(r.text, { date: e.data_as_of }), lang: r.lang };
  }
  throw new Error(`data/sources.json raw["cris-2025-2026"].status is ${JSON.stringify(st)}, want "included" or "not_included"`);
}

// The live link printed under the QR (L5a): an https URL that is not a local address, used as given (no re-casing,
// no trailing-slash fix-up), so the caption equals sources.json live_url byte for byte.
function letterUrl(liveUrl) {
  let u;
  try { u = new URL(liveUrl); } catch (e) { throw new Error(`data/sources.json live_url ${JSON.stringify(liveUrl)} is not a URL`); }
  if (u.protocol !== 'https:' || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname) || /\s/.test(liveUrl)) {
    throw new Error(`data/sources.json live_url ${JSON.stringify(liveUrl)} must be a public https address`);
  }
  return liveUrl;
}

// Fills article#letter (the empty shell in index.html) for one route. dicts = { en, es }; route = { stem, meta };
// rep = buildReport(...) for it; ways = Map; modeSummary = rri.modes[mode]; raw = data/sources.json "raw";
// liveUrl = data/sources.json "live_url".
function renderLetter(doc, dicts, lang, route, rep, ways, modeSummary, raw, liveUrl) {
  const art = doc.getElementById('letter');
  const tx = Object.fromEntries(KEYS.map((k) => [k, I.t(dicts, lang, k)]));
  const langs = new Set(Object.values(tx).map((r) => r.lang));
  if (langs.size !== 1) throw new Error('letter strings must all be in one language');
  const tl = [...langs][0];
  if (tl === lang) art.removeAttribute('lang'); else art.setAttribute('lang', tl);
  const school = V.SCHOOL.name;
  const label = I.routeLabel(dicts[tl] || dicts.en, route.stem, route.meta).label;
  doc.getElementById('letter-print').textContent = tx.LETTER_PRINT.text;
  doc.getElementById('letter-back').textContent = tx.LETTER_BACK.text;
  doc.getElementById('letter-title').textContent = I.fill(tx.LETTER_TITLE.text, { school });
  doc.getElementById('letter-to').textContent = tx.LETTER_TO.text;
  doc.getElementById('letter-intro').textContent = I.fill(tx.LETTER_INTRO.text, { school });
  doc.getElementById('letter-route').textContent = `${I.fill(tx.LETTER_ROUTE.text, { route: label })} ${V.summaryText(rep, modeSummary)}`;
  doc.getElementById('letter-findings-heading').textContent = tx.LETTER_FINDINGS_HEADING.text;
  const ol = doc.getElementById('letter-findings');
  clear(ol);
  for (const r of letterRows(rep, ways)) {
    const li = el(doc, 'li', { 'data-osm-id': r.osm_id, 'data-finding-id': r.fid });
    li.appendChild(el(doc, 'span', { class: 'street' }, r.street));
    li.appendChild(doc.createTextNode(` · ${r.text}`));
    ol.appendChild(li);
  }
  doc.getElementById('letter-dates-heading').textContent = tx.LETTER_DATES_HEADING.text;
  const ul = doc.getElementById('letter-dates');
  clear(ul);
  ul.appendChild(el(doc, 'li', { 'data-source': 'snapshot' }, V.dataLine(rep.osm_base)));
  const cris = letterCris(dicts, tl, raw);
  ul.appendChild(el(doc, 'li', { 'data-source': 'cris-2025-2026' }, cris.text));
  doc.getElementById('letter-credit').textContent = tx.LETTER_CREDIT.text;
  doc.querySelector('#letter-qr > img').setAttribute('alt', tx.LETTER_QR_ALT.text);
  doc.getElementById('letter-url').textContent = letterUrl(liveUrl);
}

// button#letter-open: its text (English-only key, lang="en" in a Spanish page) and whether a route is chosen.
function renderLetterButton(doc, dicts, lang, enabled) {
  const b = doc.getElementById('letter-open');
  if (!b) return;
  V.setText(b, I.t(dicts, lang, 'LETTER_OPEN'), lang);
  b.disabled = !enabled;
}

module.exports = { KEYS, letterRows, letterCris, letterUrl, renderLetter, renderLetterButton };
