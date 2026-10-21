// Bare UI (kickoff-runbook Fri 7:00 PM CDT row; added Fri Oct 16, 2026, wave 183) on jsdom, no network.
// The served shell (index.html) and js/render.js filled from the committed data, in English and Spanish, for every
// cached route. Browser checks B1-B3 (tests/e2e.py, Playwright) run the real page; these pin the same DOM contract
// (browser-checks-b1-b3-plan §1) in `npm test` and add the Spanish labels and [CS-L1-FID] finding ids.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const I = require('../js/i18n.js');
const R = require('../js/report.js');
const V = require('../js/render.js');
const { routeIds } = require('../scripts/report.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HTML = read('index.html');
const SNAP = JSON.parse(read('data/osm-dulles.json'));
const SOURCES = JSON.parse(read('data/sources.json'));
const RRI = JSON.parse(read('data/ref/rri.json'));
const WAYS = new Map(SNAP.elements.filter((e) => e.type === 'way').map((e) => [e.id, e]));
const ROUTES = R.ROUTE_IDS.map((stem) => ({ stem, file: JSON.parse(read(`data/routes/${stem}.json`)) }))
  .map((r) => ({ ...r, meta: r.file.meta }));
const dict = (lang) => JSON.parse(read(`i18n/${lang}.json`));
const BAD_WORDS = /\b(un)?safe\b|violat/i;
const BAD_LABEL = /\b(home|house|casa|hogar)\b|\bmy street\b|\bmi calle\b/i;
const dom = () => new JSDOM(HTML, { url: 'http://127.0.0.1/CrossSafe/' }).window.document;

test('U1 served index.html: shell the browser checks read (labels, disabled route picker, empty polite live region, same-origin only)', () => {
  const d = dom();
  assert.equal(d.documentElement.lang, 'en');
  assert.equal(d.querySelector('a.skip').getAttribute('href'), '#app');
  assert.ok(d.querySelector('main#app'));
  assert.equal(d.querySelector('label[for="school"]').textContent, dict('en').SCHOOL_LABEL);
  assert.equal(d.querySelector('label[for="route"]').textContent, dict('en').ROUTE_LABEL);
  const school = d.getElementById('school');
  assert.deepEqual([...school.options].map((o) => [o.value, o.textContent, o.selected]), [['481965001818', 'Dulles High School', true]]);
  const route = d.getElementById('route');
  assert.equal(route.disabled, true, 'select#route must be disabled until data-state=ready');
  assert.equal(route.options[0].value, '');
  const results = d.querySelector('section#results');
  assert.equal(results.getAttribute('aria-live'), 'polite');
  assert.equal(results.textContent.trim(), '', 'live region must be present and empty in the served markup (MDN)');
  assert.ok(results.querySelector('p#summary') && results.querySelector('ol#findings') && results.querySelector('#route-heading'));
  assert.equal(d.getElementById('source-status').getAttribute('role'), 'status');
  // EN/ES toggle in the served markup (wave 184): a real button, English page text from en.json, note hidden
  const btn = d.querySelector('button#lang');
  assert.ok(btn, 'button#lang missing');
  assert.equal(btn.getAttribute('type'), 'button');
  assert.equal(btn.textContent, dict('en').LANG_TOGGLE_TO_ES);
  assert.equal(d.getElementById('lang-note').hidden, true);
  // no outside host anywhere in the shell or the UI scripts; since the map commit (wave 184) js/map.js is the one file
  // that may name outside URLs, and only the allow-listed ones (U7)
  for (const f of ['index.html', 'js/app.js', 'js/render.js', 'js/report.js', 'js/i18n.js', 'js/letter.js', 'css/app.css']) assert.doesNotMatch(read(f), /https?:\/\/|\/\/[a-z0-9.-]+\.[a-z]{2,}\//i, `${f} names an outside URL`);
  // the map region + hint in the served markup (a11y-test-spec 'Map setup, one block'), English from en.json
  const map = d.getElementById('map');
  assert.equal(map.getAttribute('role'), 'region');
  assert.equal(map.getAttribute('aria-label'), dict('en').MAP_LABEL);
  assert.equal(map.getAttribute('aria-describedby'), 'map-hint');
  assert.equal(d.getElementById('map-hint').textContent, dict('en').MAP_KEYS_HINT);
  assert.equal(map.compareDocumentPosition(results) & 4, 4, '#map comes before #results (Tab order = visual order)');
  assert.deepEqual([...d.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')), ['js/app.js']);
});

test('U2 the page offers exactly the cached -walk/-bike routes (js/report.js ROUTE_IDS = data/routes/ files)', () => {
  assert.deepEqual(R.ROUTE_IDS, routeIds());
});

for (const lang of ['en', 'es']) {
  test(`U3 ${lang}: labels and route options from i18n/${lang}.json via js/i18n.js; every route renders its report.js findings with data-finding-id = fid`, () => {
    const D = dict(lang);
    const osmBase = SOURCES.files['data/osm-dulles.json'].osm_base;
    assert.equal(osmBase, SNAP.osm_base);
    for (const route of ROUTES) {
      const d = dom();
      V.renderControls(d, D, lang, ROUTES);
      V.renderStatus(d, lang, osmBase);
      assert.equal(d.documentElement.lang, lang);
      assert.equal(d.querySelector('label[for="school"]').textContent, D.SCHOOL_LABEL);
      assert.equal(d.querySelector('label[for="route"]').textContent, D.ROUTE_LABEL);
      const opts = [...d.getElementById('route').options];
      assert.deepEqual(opts.map((o) => o.textContent), I.routeOptions(D, ROUTES));
      assert.deepEqual(opts.map((o) => o.value), ['', ...R.ROUTE_IDS]);
      for (const o of opts) {
        assert.equal(o.children.length, 0, 'option text stays plain (a11y A11(c))');
        assert.doesNotMatch(o.textContent, BAD_LABEL, `P9(d) option "${o.textContent}"`);
      }
      const rep = R.buildReport(SNAP, route.file, route.stem, RRI);
      V.renderRoute(d, D, lang, route, rep, WAYS, RRI.modes[rep.mode]);
      const heading = d.getElementById('route-heading');
      const L = I.routeLabel(D, route.stem, route.meta);
      assert.equal(heading.textContent, L.label);
      assert.doesNotMatch(heading.textContent, BAD_LABEL);
      if (lang !== 'en') {
        const span = heading.querySelector('span[lang="en"]');
        assert.ok(span, `${route.stem}: ES heading must tag the place name lang="en" (a11y A11(a))`);
        assert.equal(span.textContent, route.meta.anchor.name, 'place name verbatim, never translated');
        for (const id of ['summary', 'findings']) assert.equal(d.getElementById(id).getAttribute('lang'), 'en', `${id} is English-only text`);
      }
      const lis = [...d.querySelectorAll('#results #findings > li.finding')];
      assert.equal(lis.length, rep.findings, `${route.stem}: rows vs report findings`);
      const fids = lis.map((li) => li.getAttribute('data-finding-id'));
      assert.deepEqual(fids, rep.list.map((f) => f.fid), `${route.stem}: data-finding-id must equal report fids, in order`);
      assert.equal(new Set(fids).size, fids.length, `${route.stem}: duplicate data-finding-id`);
      assert.deepEqual(lis.map((li) => li.getAttribute('data-osm-id')), rep.list.map((f) => f.osm_id));
      for (const li of lis) assert.ok(li.querySelector('.street').textContent.trim() && li.querySelector('.reason').textContent.trim(), `${route.stem}: empty row text`);
      const results = d.getElementById('results');
      assert.doesNotMatch(results.textContent, BAD_WORDS, `${route.stem}: wording rule (crosssafe-spec §a)`);
      const line = V.dataLine(osmBase);
      assert.ok(d.getElementById('summary').textContent.includes(line), 'summary carries the data date');
      assert.equal(d.querySelector('#source-status li[data-source="snapshot"]').textContent, line);
      assert.equal(d.getElementById('route-note').hidden, !L.note);
      if (rep.score == null) assert.doesNotMatch(d.getElementById('summary').textContent, /score \d/, 'no 0-100 number when the score is not shown (T17(d))');
    }
  });
}

test('U4 a road both walked along and crossed keeps two rows with distinct data-finding-id (same data-osm-id)', () => {
  const rep = { findings: 2, k: 1, N: 1, entrances: 0, route_m: 1000, rri_per_km: 1, score: null, confidence: 'Low', osm_base: SNAP.osm_base,
    list: [
      { fid: 'stretch:way/1', osm_id: 'way/1', kind: 'stretch', side: 'both', length_m: 50, points: 1, text: 'Sidewalk not mapped (unknown)', flags: [] },
      { fid: 'crossing:way/1', osm_id: 'way/1', kind: 'crossing', times: 2, points: 2, text: 'Test Road: mapped data shows no crossing within 30 m. Flags: no mapped crossing.', flags: ['no mapped crossing'] },
    ] };
  const d = dom();
  const route = ROUTES[0];
  V.renderRoute(d, dict('en'), 'en', route, rep, new Map([[1, { tags: { highway: 'service' } }]]), { line: 'Not enough reference routes for a 0-100 score (19 of 30 routed; 20 needed)' });
  const lis = [...d.querySelectorAll('#findings > li.finding')];
  assert.deepEqual(lis.map((li) => li.getAttribute('data-finding-id')), ['stretch:way/1', 'crossing:way/1']);
  assert.deepEqual(lis.map((li) => li.getAttribute('data-osm-id')), ['way/1', 'way/1']);
  assert.equal(lis[0].querySelector('.street').textContent, 'unnamed service road');
  assert.equal(lis[1].querySelector('.street').textContent, 'Test Road');
  assert.equal(lis[1].querySelector('.reason').textContent, 'Mapped data shows no crossing within 30 m.');
  assert.match(lis[1].querySelector('.kind').textContent, /crossed 2 times/);
  const s = d.getElementById('summary').textContent;
  assert.match(s, /Not enough reference routes for a 0-100 score/);
  assert.doesNotMatch(s, /score \d/);
  V.clearRoute(d);
  assert.equal(d.getElementById('results').textContent.trim(), '');
});

// U5 (added Fri Oct 16, 2026, wave 184): the EN/ES toggle on jsdom (a11y-test-spec A9; real clicks are e2e A9).
test('U5 renderLang: <html lang> switches, button names the other language in English, Spanish-draft note only in ES, EN-only text tagged lang=en', () => {
  const dicts = { en: dict('en'), es: dict('es') };
  const d = dom();
  const route = ROUTES[0];
  const rep = R.buildReport(SNAP, route.file, route.stem, RRI);
  const paint = (lang) => {
    V.renderLang(d, dicts, lang);
    V.renderControls(d, dicts[lang], lang, ROUTES);
    V.renderStatus(d, lang, SNAP.osm_base);
    d.getElementById('route').value = route.stem;
    V.renderRoute(d, dicts[lang], lang, route, rep, WAYS, RRI.modes[rep.mode]);
  };
  paint('es');
  const btn = d.getElementById('lang');
  const note = d.getElementById('lang-note');
  assert.equal(d.documentElement.lang, 'es');
  assert.equal(btn.textContent, dicts.en.LANG_TOGGLE_TO_EN);
  assert.equal(btn.getAttribute('lang'), 'en', 'English button text in a Spanish page must carry lang="en"');
  assert.equal(btn.getAttribute('data-switch-to'), 'en');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, dicts.en.LANG_DRAFT_NOTE);
  assert.equal(note.getAttribute('lang'), 'en');
  assert.equal(d.querySelector('label[for="route"]').textContent, dicts.es.ROUTE_LABEL);
  assert.equal(d.getElementById('route').value, route.stem, 'the chosen route stays chosen across a language switch');
  assert.equal(d.getElementById('route').selectedOptions[0].textContent, I.routeLabel(dicts.es, route.stem, route.meta).label);
  for (const sel of ['.intro', '#summary', '#findings', '#source-status li[data-source="snapshot"]']) assert.equal(d.querySelector(sel).getAttribute('lang'), 'en', `${sel} is English-only text`);
  paint('en');
  assert.equal(d.documentElement.lang, 'en');
  assert.equal(btn.textContent, dicts.en.LANG_TOGGLE_TO_ES);
  assert.equal(btn.hasAttribute('lang'), false);
  assert.equal(note.hidden, true);
  assert.equal(note.textContent, '');
  assert.equal(d.querySelector('label[for="route"]').textContent, dicts.en.ROUTE_LABEL);
  for (const sel of ['.intro', '#summary', '#findings', '#source-status li[data-source="snapshot"]']) assert.equal(d.querySelector(sel).hasAttribute('lang'), false, `${sel}: no lang in the English page`);
});

// U6 (added Fri Oct 16, 2026, wave 184): CRIS 2025-26 status line (browser-checks-b1-b3-plan §1 Data status row,
// i18n-test-spec §11 tests, offline-error E9). Texts are read from the i18n file, never typed here.
test('U6 #source-status: CRIS 2025-26 "not included" line iff raw status is not_included; exact text; no digits beyond the two ranges; never "Couldn\'t reach"', () => {
  const dicts = { en: dict('en'), es: dict('es') };
  const want = `${dicts.en.CRIS_NOT_INCLUDED}. ${dicts.en.CRIS_NOT_INCLUDED_NOTE}`;
  // [CS-CRIS-SAT-PREP-1016] (Fri Oct 16, 2026, wave 188): status-aware, so the Sat Oct 17 CRIS flip to "included" is a
  // data + README commit only. The not_included rendering is always checked, on the committed entry when it is
  // not_included, else on a short not_included copy; the committed "included" state must show no CRIS line and have
  // its aggregate in data/derived-txdot.json with the same data_as_of (kickoff-runbook test plan C, DS6).
  const st = SOURCES.raw['cris-2025-2026'].status;
  assert.ok(st === 'not_included' || st === 'included', `committed CRIS status ${st}`);
  const ni = JSON.parse(JSON.stringify(SOURCES.raw));
  if (st === 'included') {
    const e = ni['cris-2025-2026'];
    ni['cris-2025-2026'] = { status: 'not_included', source_url: e.source_url, query: e.query, attempted_at: e.fetched_at, reason: 'fixture', licence: e.licence, committed: false };
    for (const lang of ['en', 'es']) {
      const d0 = dom();
      V.renderStatus(d0, lang, SNAP.osm_base, { dicts, raw: SOURCES.raw });
      assert.deepEqual([...d0.querySelectorAll('#source-status li')].map((li) => li.getAttribute('data-source')), ['snapshot'], `${lang}: committed included -> no CRIS line`);
    }
    const der = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'derived-txdot.json'), 'utf8'));
    assert.ok(der.cris_2025_2026 && der.cris_2025_2026.data_as_of === SOURCES.raw['cris-2025-2026'].data_as_of, 'included: derived cris_2025_2026 with the same data_as_of');
  }
  for (const lang of ['en', 'es']) {
    const d = dom();
    V.renderStatus(d, lang, SNAP.osm_base, { dicts, raw: ni });
    const lis = [...d.querySelectorAll('#source-status li')];
    assert.deepEqual(lis.map((li) => li.getAttribute('data-source')), ['snapshot', 'cris-2025-2026'], `${lang}: line order`);
    const li = lis[1];
    assert.equal(li.textContent, want);
    assert.equal(li.textContent.replace('2025-26', '').replace('2020-24', '').match(/\d/), null, 'no digit outside the two fixed ranges (no date, no count, never 0)');
    assert.doesNotMatch(li.textContent, /couldn.t reach|unreachable/i);
    if (lang === 'en') assert.equal(li.hasAttribute('lang'), false);
    else assert.equal(li.getAttribute('lang'), 'en', 'no Spanish draft is shipped for §11: English text tagged lang="en"');
    assert.equal(lis[0].textContent, V.dataLine(SNAP.osm_base), 'snapshot line unchanged');
  }
  const inc = JSON.parse(JSON.stringify(SOURCES.raw));
  inc['cris-2025-2026'].status = 'included';
  const d2 = dom();
  V.renderStatus(d2, 'en', SNAP.osm_base, { dicts, raw: inc });
  assert.deepEqual([...d2.querySelectorAll('#source-status li')].map((li) => li.getAttribute('data-source')), ['snapshot'], 'no CRIS line when included');
  for (const bad of [undefined, 'failed', '']) {
    const r = JSON.parse(JSON.stringify(SOURCES.raw));
    if (bad === undefined) delete r['cris-2025-2026']; else r['cris-2025-2026'].status = bad;
    assert.throws(() => V.renderStatus(dom(), 'en', SNAP.osm_base, { dicts, raw: r }), /cris-2025-2026/, `status ${bad} must fail closed`);
  }
});

// U7 (added Fri Oct 16, 2026, wave 184): js/map.js pure parts + the map-related renderers.
test('U7 map: allow-listed URLs only, SRI pinned; one pin per finding at its route position; show-on-map names distinct and start with the visible text; unreachable-host lines', () => {
  const M = require('../js/map.js');
  const dicts = { en: dict('en'), es: dict('es') };
  // URLs: every URL in js/map.js is one of the allow-listed ones (performance-budget P5, privacy P2)
  const urls = read('js/map.js').match(/https?:\/\/[^\s'"`)]+/g);
  const allowed = new Set([M.LEAFLET.css.href, M.LEAFLET.js.src, M.TILE_URL, 'https://www.openstreetmap.org/copyright', 'https://leafletjs.com/download.html']);
  for (const u of urls) assert.ok(allowed.has(u), `js/map.js names ${u}`);
  assert.deepEqual(M.ALLOWED_HOSTS, ['unpkg.com', 'tile.openstreetmap.org']);
  assert.equal(new URL(M.LEAFLET.css.href).host, 'unpkg.com');
  assert.equal(new URL(M.TILE_URL.replace(/[{}]/g, '')).host, 'tile.openstreetmap.org');
  assert.equal(M.LEAFLET.css.integrity, 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=');
  assert.equal(M.LEAFLET.js.integrity, 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=');
  assert.match(M.LEAFLET.js.src, /\/leaflet@1\.9\.4\/dist\/leaflet\.js$/);
  assert.deepEqual(M.PIN, { radius: 12, weight: 2 });
  assert.equal(M.ATTRIBUTION, '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');
  // pins: one per finding, same order, each within 30 m of the route line
  const near = (p, line) => {
    const k = Math.cos(p[0] * Math.PI / 180) * 111320, m = 110540;
    let best = Infinity;
    for (let i = 0; i + 1 < line.length; i++) {
      const ax = line[i][1] * k, ay = line[i][0] * m, bx = line[i + 1][1] * k, by = line[i + 1][0] * m, px = p[1] * k, py = p[0] * m;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
    }
    return best;
  };
  for (const route of ROUTES) {
    const rep = R.buildReport(SNAP, route.file, route.stem, RRI);
    const pins = M.pins(rep);
    assert.deepEqual(pins.map((p) => p.fid), rep.list.map((f) => f.fid), `${route.stem}: pins = findings, in order`);
    const line = M.routeLatLngs(route.file);
    for (const p of pins) assert.ok(near([p.lat, p.lon], line) <= 30, `${route.stem} ${p.fid}: pin ${near([p.lat, p.lon], line).toFixed(1)} m from the route`);
    // names on the real rows, EN and ES
    for (const lang of ['en', 'es']) {
      const d = dom();
      V.renderRoute(d, dicts[lang], lang, route, rep, WAYS, RRI.modes[rep.mode]);
      V.addShowOnMap(d, dicts, lang, M.showOnMapNames);
      const btns = [...d.querySelectorAll('#findings > li.finding > button.show-on-map')];
      assert.equal(btns.length, rep.findings);
      for (const b of btns) {
        assert.equal(b.textContent, dicts.en.SHOW_ON_MAP);
        assert.equal(b.getAttribute('type'), 'button');
        assert.ok(b.getAttribute('aria-label').startsWith(dicts.en.SHOW_ON_MAP + ': '), 'name starts with the visible text (SC 2.5.3)');
        assert.equal(b.getAttribute('lang'), lang === 'en' ? null : 'en');
      }
      assert.equal(new Set(btns.map((b) => b.getAttribute('aria-label'))).size, btns.length, `${route.stem} ${lang}: names distinct (W3 (c))`);
      V.addShowOnMap(d, dicts, lang, M.showOnMapNames);
      assert.equal(d.querySelectorAll('button.show-on-map').length, rep.findings, 'idempotent');
    }
  }
  assert.throws(() => M.pins({ list: [{ fid: 'x:way/1' }] }), /no map position/);
  // the name rule's tie-breaks: same street -> OSM id; same street and same id (stretch + crossing) -> kind word
  const n = M.showOnMapNames(dicts, 'en', [
    { street: 'A Road', osm_id: 'way/1', kind: 'stretch' }, { street: 'A Road', osm_id: 'way/1', kind: 'crossing' },
    { street: 'A Road', osm_id: 'way/2', kind: 'crossing' }, { street: 'B Road', osm_id: 'way/3', kind: 'crossing' }]);
  assert.deepEqual(n.names, ['Show on map: A Road · OSM way/1 · along the road', 'Show on map: A Road · OSM way/1 · crossing', 'Show on map: A Road · OSM way/2', 'Show on map: B Road']);
  // map labels: English in both pages, lang="en" on #map and #map-hint in the Spanish page
  const d = dom();
  V.renderMapLabels(d, dicts, 'es');
  assert.equal(d.getElementById('map').getAttribute('aria-label'), dicts.en.MAP_LABEL);
  assert.equal(d.getElementById('map').getAttribute('lang'), 'en');
  assert.equal(d.getElementById('map-hint').getAttribute('lang'), 'en');
  V.renderMapLabels(d, dicts, 'en');
  assert.equal(d.getElementById('map').hasAttribute('lang'), false);
  // unreachable hosts: one line per host after snapshot + CRIS, SOURCE_UNREACHABLE text, the snapshot date
  V.renderStatus(d, 'en', SNAP.osm_base, { dicts, raw: SOURCES.raw, unreachable: ['unpkg.com', 'tile.openstreetmap.org'] });
  const lis = [...d.querySelectorAll('#source-status li')];
  const crisLi = SOURCES.raw['cris-2025-2026'].status === 'not_included' ? ['cris-2025-2026'] : []; // wave 188: status-aware
  assert.deepEqual(lis.map((li) => li.getAttribute('data-source')), ['snapshot', ...crisLi, 'unpkg.com', 'tile.openstreetmap.org']);
  assert.equal(lis[1 + crisLi.length].textContent, I.fill(dicts.en.SOURCE_UNREACHABLE, { host: 'unpkg.com', date: V.dataDate(SNAP.osm_base) }));
  assert.doesNotMatch(d.getElementById('source-status').textContent, BAD_WORDS);
});

// U8 (added Fri Oct 16, 2026, wave 185): the letter view on jsdom (test-spec §L L0/L1/L2/L3/L6 text/L8/L9; the real
// keyboard path, print CSS and the one-page PDF are e2e 'B4 letter + print'). Texts are read from i18n/en.json.
test('U8 letter: L0 shell; every route EN+ES lists exactly the report.js findings by data-finding-id (no duplicates); addressee; data dates incl. CRIS; credit as printed text; QR + printed live link = sources.json live_url (L5); no inputs, no observations section, no innerHTML; wording rule', () => {
  const dicts = { en: dict('en'), es: dict('es') };
  const EN = dicts.en;
  const LT = require('../js/letter.js');
  // L0: the button and the article are both in the served markup ([DESIGN] the button is #letter-open: ids are unique)
  const d0 = dom();
  const btn = d0.querySelector('button#letter-open');
  const art = d0.querySelector('article#letter');
  assert.ok(btn && art, 'L0: button#letter-open and article#letter must both exist (or neither)');
  assert.equal(btn.getAttribute('type'), 'button');
  assert.equal(btn.disabled, true, 'no route chosen yet: the letter button is disabled');
  assert.equal(btn.textContent, EN.LETTER_OPEN);
  assert.equal(art.hidden, true);
  assert.equal(d0.querySelectorAll('[id="letter"]').length, 1, 'one element with id="letter"');
  const src = read('js/letter.js');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML/, 'L4 grep guard: no HTML strings in the letter renderer');
  assert.doesNotMatch(src, /prompt\(|localStorage|sessionStorage/, 'L9: no other input path');
  for (const route of ROUTES) {
    const rep = R.buildReport(SNAP, route.file, route.stem, RRI);
    for (const lang of ['en', 'es']) {
      const d = dom();
      LT.renderLetter(d, dicts, lang, route, rep, WAYS, RRI.modes[rep.mode], SOURCES.raw, SOURCES.live_url);
      const a = d.getElementById('letter');
      const lis = [...a.querySelectorAll('#letter-findings > li')];
      const fids = lis.map((li) => li.getAttribute('data-finding-id'));
      assert.deepEqual(fids, rep.list.map((f) => f.fid), `${route.stem} ${lang}: L1 letter ids = report fids, in order`);
      assert.equal(new Set(fids).size, fids.length, `${route.stem}: L1 duplicate data-finding-id in the letter`);
      assert.equal(lis.length, rep.findings);
      assert.deepEqual(lis.map((li) => li.getAttribute('data-osm-id')), rep.list.map((f) => f.osm_id));
      // the same street words as the list rows
      V.renderRoute(d, dicts[lang], lang, route, rep, WAYS, RRI.modes[rep.mode]);
      assert.deepEqual(lis.map((li) => li.querySelector('.street').textContent), [...d.querySelectorAll('#findings > li.finding .street')].map((x) => x.textContent));
      assert.equal(d.getElementById('letter-to').textContent.trim(), 'To whom it may concern / road owner', 'L2 addressee');
      const text = a.textContent;
      assert.doesNotMatch(text, /\S+@\S+\.\w+/, 'L2 no email');
      assert.doesNotMatch(text, /\d{3}[-.\s)]+\d{3}[-.\s]\d{4}/, 'L2 no phone');
      assert.doesNotMatch(text, /\bDear\b|\bsent\b|submitted to|\bsincerely\b/i, 'L2 no greeting to a person, no sender, no delivery claim');
      assert.doesNotMatch(text, /\b(safe|unsafe|dangerous|violat\w*)\b/i, 'L8 wording rule');
      assert.equal(a.querySelectorAll('input, textarea, select, [contenteditable]').length, 0, 'L9 no input in the letter');
      assert.equal(a.querySelector('#letter-observations'), null, 'L3: no observations section (data/field-checks.json not shipped)');
      assert.doesNotMatch(text, /observation|checked on foot/i, 'no placeholder observation text');
      const dates = Object.fromEntries([...a.querySelectorAll('#letter-dates > li')].map((li) => [li.getAttribute('data-source'), li.textContent]));
      assert.deepEqual(Object.keys(dates), ['snapshot', 'cris-2025-2026']);
      assert.equal(dates.snapshot, V.dataLine(SNAP.osm_base), 'L6 snapshot date = #source-status text');
      const cris = SOURCES.raw['cris-2025-2026']; // wave 188: status-aware (L6: "not included" or the export's data_as_of)
      assert.equal(dates['cris-2025-2026'], cris.status === 'not_included' ? EN.CRIS_NOT_INCLUDED : I.fill(EN.LETTER_CRIS_AS_OF, { date: cris.data_as_of }),
        'L6 CRIS line exactly CRIS_NOT_INCLUDED, or LETTER_CRIS_AS_OF with data_as_of when included');
      const credit = d.getElementById('letter-credit').textContent;
      assert.ok(credit.includes('© OpenStreetMap contributors') && credit.includes('openstreetmap.org/copyright'), 'L6 credit + URL as printed text');
      assert.ok(d.getElementById('letter-route').textContent.includes(V.summaryText(rep, RRI.modes[rep.mode])), 'route line carries the page summary');
      // L5(a) (wave 186): the printed live link = data/sources.json live_url exactly; the only img is the QR, with alt text
      assert.equal(d.getElementById('letter-url').textContent, SOURCES.live_url, 'L5(a) printed link = sources.json live_url');
      assert.deepEqual([...a.querySelectorAll('img')].map((i) => [i.parentElement.id, i.getAttribute('src'), i.getAttribute('alt')]),
        [['letter-qr', 'img/qr-live.svg', EN.LETTER_QR_ALT]], 'L4/L5: one img in the letter, the QR, with LETTER_QR_ALT');
      if (lang === 'en') assert.equal(a.hasAttribute('lang'), false);
      else assert.equal(a.getAttribute('lang'), 'en', 'English-only letter in the Spanish page carries lang="en"');
      for (const id of ['letter-title', 'letter-intro', 'letter-print', 'letter-back', 'letter-findings-heading', 'letter-dates-heading']) assert.ok(d.getElementById(id).textContent.trim(), `${id} empty`);
    }
  }
  // L5 (wave 186): live_url is the public https page; a bad value throws instead of printing a wrong link
  assert.equal(SOURCES.live_url, 'https://aariv.me/CrossSafe/', 'L5 live_url = the GitHub Pages URL in the README');
  assert.ok(read('README.md').includes(SOURCES.live_url), 'README names live_url');
  assert.equal(SOURCES.live_url_qr.file, 'img/qr-live.svg');
  for (const bad of ['http://aariv.me/CrossSafe/', 'https://localhost:8000/CrossSafe/', 'https://127.0.0.1/CrossSafe/', '', undefined]) {
    assert.throws(() => LT.letterUrl(bad), /live_url/, `L5(a) ${bad} must throw`);
  }
  // L5(d): the QR is a committed static SVG: no QR library in the page, nothing outside the file, no script in it
  const svg = read('img/qr-live.svg');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/, 'qr-live.svg: plain SVG with a viewBox');
  assert.doesNotMatch(svg.replace('xmlns="http://www.w3.org/2000/svg"', ''), /https?:|href|<script|<image|<foreignObject/i, 'qr-live.svg: no links, scripts or embedded images');
  for (const f of ['index.html', ...fs.readdirSync(path.join(ROOT, 'js')).map((x) => `js/${x}`)]) {
    assert.doesNotMatch(read(f), /qrcodegen|new\s+QRCode|qrcode\.js|kjua|zxing|require\('\.\/qr/i, `L5(d) ${f} loads no QR library`);
  }
  // CRIS included -> data_as_of; unknown status fails closed
  const inc = JSON.parse(JSON.stringify(SOURCES.raw));
  inc['cris-2025-2026'].status = 'included';
  inc['cris-2025-2026'].data_as_of = '2026-10-12';
  assert.equal(LT.letterCris(dicts, 'en', inc).text, I.fill(EN.LETTER_CRIS_AS_OF, { date: '2026-10-12' }));
  const bad = JSON.parse(JSON.stringify(SOURCES.raw));
  bad['cris-2025-2026'].status = 'failed';
  assert.throws(() => LT.letterCris(dicts, 'en', bad), /cris-2025-2026/);
  // the button: English text, lang="en" in the Spanish page, enabled once a route is chosen
  LT.renderLetterButton(d0, dicts, 'es', true);
  assert.equal(btn.disabled, false);
  assert.equal(btn.getAttribute('lang'), 'en');
});

// U9 (added Fri Oct 16, 2026, wave 185): ?demo=dulles picks the school's first demo route; anything else picks nothing.
test('U9 ?demo=: "dulles" -> the first meta.demo route, else the first saved route; unknown or missing value -> null (page opens as usual)', () => {
  assert.deepEqual(V.DEMO_SCHOOLS, { dulles: '481965001818' });
  assert.ok(ROUTES.every((r) => r.meta.demo !== true), 'committed routes: none is marked demo (all start at named public places)');
  assert.equal(V.demoRouteStem('dulles', ROUTES), R.ROUTE_IDS[0], 'first saved route in select#route order');
  const marked = ROUTES.map((r, i) => (i === 3 ? { ...r, meta: { ...r.meta, demo: true } } : r));
  assert.equal(V.demoRouteStem('dulles', marked), R.ROUTE_IDS[3], 'a route marked meta.demo wins');
  for (const bad of [null, undefined, '', 'Dulles', 'DULLES', 'dulles ', 'other', '481965001818', 'toString', '__proto__', 'constructor']) {
    assert.equal(V.demoRouteStem(bad, ROUTES), null, `?demo=${String(bad)} must pick nothing`);
  }
  assert.equal(V.demoRouteStem('dulles', []), null);
  assert.match(read('js/app.js'), /demoRouteStem\(new URLSearchParams\(location\.search\)\.get\('demo'\), routes\)/, 'app.js reads ?demo= through demoRouteStem');
});

// U10 (added Fri Oct 16, 2026, wave 187; a11y pass): reduced motion on the map, the no-JavaScript message, the loading
// state and the E1 retry button, as served (index.html) and as js/map.js / js/app.js wire them. The browser checks
// 'A-motion', 'A-nojs', 'A-slow' and 'E1 404 retry' in tests/e2e.py run the same four in Chromium.
const M10 = require('../js/map.js');
test('U10 reduced motion off on the map, no-JS message + hidden controls, loading status + aria-busy, E1 retry button', () => {
  // (a) motionOptions + createMap with a fake Leaflet: every animation option off and panBy forced to animate: false
  assert.deepEqual(M10.motionOptions(true), { zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false });
  assert.deepEqual(M10.motionOptions(false), {});
  const made = [];
  const fakeL = (reduced) => {
    const calls = [];
    const layer = { addTo() { return this; }, on() { return this; }, clearLayers() {} };
    const map = { panBy(o, opt) { calls.push(opt); return this; }, fitBounds() {}, panTo() {} };
    return { calls, map, L: {
      map: (el, o) => { made.push([reduced, o]); return map; },
      control: { attribution: () => layer }, tileLayer: () => layer, layerGroup: () => layer,
    } };
  };
  for (const reduced of [true, false]) {
    const f = fakeL(reduced);
    const h = M10.createMap(f.L, {}, { reducedMotion: reduced });
    h.map.panBy([10, 0]);
    h.map.panBy([0, 10], { animate: true, duration: 0.25 });
    if (reduced) assert.deepEqual(f.calls.map((c) => c.animate), [false, false], 'reduced: every panBy jumps (no pan animation)');
    else assert.deepEqual(f.calls, [undefined, { animate: true, duration: 0.25 }], 'no preference: Leaflet defaults untouched');
  }
  assert.deepEqual(made, [[true, { attributionControl: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false }],
    [false, { attributionControl: false }]]);
  assert.match(read('js/app.js'), /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches[\s\S]{0,200}createMap\([\s\S]{0,120}reducedMotion \}\)/, 'app.js passes the media query to createMap');
  // (b) no JavaScript: one message in <noscript>, and a <noscript> style hiding every control that needs the script
  const d = dom();
  const ns = [...d.querySelectorAll('noscript')].map((n) => n.innerHTML).join('\n');
  assert.match(ns, /<p id="nojs" class="error">CrossSafe needs JavaScript[^<]*<\/p>/);
  const hidden = (ns.match(/<style>([^{]*)\{\s*display:\s*none !important;\s*\}<\/style>/) || [])[1] || '';
  for (const sel of ['#lang', '#load-status', '.pickers', '#letter-open', '#map', '#map-hint', '#results', '#source-status']) {
    assert.ok(hidden.split(',').map((s) => s.trim()).includes(sel), `no-JS style must hide ${sel}`);
  }
  assert.doesNotMatch(ns, BAD_WORDS);
  // (c) loading: a visible status line and an aria-busy results region in the served markup; app.js clears both
  const ls = d.getElementById('load-status');
  assert.equal(ls.getAttribute('role'), 'status');
  assert.equal(ls.hidden, false);
  assert.equal(ls.getAttribute('lang'), 'en');
  assert.match(ls.textContent, /^Loading /);
  assert.equal(d.getElementById('results').getAttribute('aria-busy'), 'true');
  const app = read('js/app.js');
  assert.match(app, /function loaded\(\) \{\s*document\.getElementById\('load-status'\)\.hidden = true;\s*document\.getElementById\('results'\)\.removeAttribute\('aria-busy'\);/);
  assert.match(app, /sel\.disabled = false;\s*loaded\(\);\s*app\.setAttribute\('data-state', 'ready'\);/, 'loading state cleared when ready');
  // (d) E1: a hidden retry button in the markup; fail() shows it, clears loading and hides an empty map
  const rb = d.getElementById('load-retry');
  assert.equal(rb.tagName, 'BUTTON');
  assert.equal(rb.getAttribute('type'), 'button');
  assert.equal(rb.hidden, true);
  assert.equal(rb.textContent, 'Try again');
  const failSrc = app.slice(app.indexOf('function fail('), app.indexOf("addEventListener('click', () => location.reload())"));
  assert.match(failSrc, /loaded\(\);/);
  assert.match(failSrc, /getElementById\('load-retry'\)\.hidden = false/);
  assert.match(failSrc, /mapEl\.hidden = true/);
  assert.match(app, /getElementById\('load-retry'\)\.addEventListener\('click', \(\) => location\.reload\(\)\)/);
  for (const el of [ls, rb, d.getElementById('load-error')]) assert.doesNotMatch(el.textContent, BAD_WORDS);
});
