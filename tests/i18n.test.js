// i18n-test-spec item 1 + §9 (route labels, EN/ES) on the committed i18n/en.json, i18n/es.json and data/routes/.
// Added Fri Oct 16, 2026 (wave 181). The P9(d) denylist check on these labels is in tests/privacy.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I = require('../js/i18n.js');

const ROOT = path.join(__dirname, '..');
const raw = (lang) => fs.readFileSync(path.join(ROOT, 'i18n', `${lang}.json`), 'utf8');
const dict = (lang) => JSON.parse(raw(lang));
const ROUTES = path.join(ROOT, 'data', 'routes');
const routes = () => fs.readdirSync(ROUTES).filter((f) => f.endsWith('.json') && f !== 'anchors.json').sort()
  .map((f) => ({ stem: f.replace(/\.json$/, ''), meta: JSON.parse(fs.readFileSync(path.join(ROUTES, f), 'utf8')).meta }));
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort();

// I1 key sets (changed Fri Oct 16, 2026, wave 184, js/i18n.js EN_ONLY_KEYS [DESIGN]): es.json = exactly the 8 §9 keys
// (the committed Spanish drafts); en.json = those 8 + the English-only keys, which a Spanish page shows in English with
// lang="en". Was: identical key sets (i18n-test-spec item 1), changed because no new Spanish text is written yet.
test('I1 es.json = the 8 §9 keys, en.json = those + EN_ONLY_KEYS, no empty values, no review markers, raw UTF-8', () => {
  const en = dict('en'), es = dict('es');
  assert.deepEqual(Object.keys(es).sort(), [...I.KEYS].sort());
  assert.deepEqual(Object.keys(en).sort(), [...I.KEYS, ...I.EN_ONLY_KEYS].sort());
  assert.equal(I.KEYS.filter((k) => I.EN_ONLY_KEYS.includes(k)).length, 0);
  for (const lang of ['en', 'es']) {
    for (const [k, v] of Object.entries(dict(lang))) {
      assert.equal(typeof v, 'string', `${lang}.${k}`);
      assert.ok(v.trim().length > 0 && v === v.trim() && !/ {2}/.test(v), `${lang}.${k} empty or bad spacing`);
    }
    assert.doesNotMatch(raw(lang), /⟦|⟧|\*\*|\[ES-REVIEW|\\u27e6|\\u27e7/i, `${lang}.json carries a review marker`);
  }
});

test('I2 every key carries the same placeholders in EN and ES ({anchor},{mode} / {school},{mode})', () => {
  const en = dict('en'), es = dict('es');
  for (const k of I.KEYS) assert.deepEqual(holes(es[k]), holes(en[k]), k);
  assert.deepEqual(holes(en.ROUTE_FROM), ['{anchor}', '{mode}']);
  assert.deepEqual(holes(en.ROUTE_DEMO_START), ['{mode}', '{school}']);
});

test('I3 committed routes: option texts unique per language, one mode word matching the file suffix, demo labels iff meta.demo', () => {
  const rs = routes();
  assert.ok(rs.length >= 2, 'expected the cached demo routes');
  for (const lang of ['en', 'es']) {
    const d = dict(lang);
    const opts = I.routeOptions(d, rs);
    assert.equal(new Set(opts).size, opts.length, `${lang}: two select#route options share text: ${opts.join(' | ')}`);
    for (const r of rs) {
      // I9m: demo labels need a demo route = the school anchor with meta.demo true (i18n-test-spec §9, P9(a))
      assert.equal(r.meta.demo === true, r.meta.anchor.kind === 'school', `${r.stem}.json: meta.demo ${r.meta.demo} with anchor kind ${r.meta.anchor.kind} (demo labels only on the school demo route)`);
      const L = I.routeLabel(d, r.stem, r.meta);
      const want = r.stem.endsWith('-walk') ? d.ROUTE_MODE_WALK : d.ROUTE_MODE_BIKE;
      const other = r.stem.endsWith('-walk') ? d.ROUTE_MODE_BIKE : d.ROUTE_MODE_WALK;
      assert.ok(L.label.endsWith(` · ${want}`) && !L.label.includes(other), `${lang} ${r.stem}: mode word in "${L.label}"`);
      assert.ok(L.label.includes(r.meta.anchor.name), `${lang} ${r.stem}: anchor name not verbatim`);
      if (r.meta.demo === true) { assert.equal(L.key, 'ROUTE_DEMO_START'); assert.equal(L.note, d.ROUTE_DEMO_NOTE); }
      else { assert.equal(L.key, 'ROUTE_FROM'); assert.equal(L.note, null, `${lang} ${r.stem}: demo note on a non-demo route`); }
    }
  }
  // an intersection keeps its "&" in Spanish (never turned into "y")
  const inter = rs.find((r) => r.meta.anchor.kind === 'intersection');
  if (inter) assert.ok(I.routeLabel(dict('es'), inter.stem, inter.meta).label.includes(' & '));
});

test('I4 routeLabel: no -walk/-bike suffix is an error; names are substituted literally; demo route uses the demo labels', () => {
  const en = dict('en'), es = dict('es');
  assert.throws(() => I.routeLabel(en, 'lost-creek-park', { anchor: { name: 'Lost Creek Park' } }), /no -walk\/-bike suffix/);
  assert.throws(() => I.routeLabel(en, 'x-walk', { anchor: {} }), /no meta.anchor.name/);
  assert.equal(I.routeLabel(en, 'x-bike', { anchor: { name: 'A {mode} $& B' } }).label, 'From A {mode} $& B · Bike');
  const demo = I.routeLabel(es, 'school-walk', { demo: true, anchor: { kind: 'school', name: 'Dulles High School' } });
  assert.equal(demo.label, 'Inicio de demostración: entrada principal de Dulles High School · A pie');
  assert.equal(demo.note, es.ROUTE_DEMO_NOTE);
  assert.throws(() => I.fill('From {anchor}', {}), /\{anchor\} has no value/);
});

// I5 (added Fri Oct 16, 2026, wave 184): no new Spanish text. es.json is byte-for-byte the file committed in ee98bd5 with
// the 8 §9 Spanish drafts (machine-drafted, not yet reviewed). A reviewed or new Spanish string must change this pin in
// the same commit, on purpose. t() falls back to English (lang 'en') for every EN-only key in a Spanish page.
test('I5 es.json unchanged (sha256 of the ee98bd5 file); t() gives EN-only keys in English with lang en', () => {
  const sha = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'i18n', 'es.json'))).digest('hex');
  assert.equal(sha, '23f4055414280e3d75d234b91e795ff0662e534d1f591e56fd2d8ae380dd5a23', 'i18n/es.json changed: new or edited Spanish text');
  const dicts = { en: dict('en'), es: dict('es') };
  for (const k of I.EN_ONLY_KEYS) assert.deepEqual(I.t(dicts, 'es', k), { text: dicts.en[k], lang: 'en' }, k);
  for (const k of I.KEYS) assert.deepEqual(I.t(dicts, 'es', k), { text: dicts.es[k], lang: 'es' }, k);
  assert.throws(() => I.t(dicts, 'es', 'NO_SUCH_KEY'), /NO_SUCH_KEY is missing/);
  assert.doesNotMatch(dicts.en.LANG_TOGGLE_TO_ES + dicts.en.LANG_TOGGLE_TO_EN, /[áéíóúñ¿¡]|Español/i, 'toggle text stays English (no new Spanish)');
  assert.match(dicts.en.LANG_DRAFT_NOTE, /^Spanish draft, machine-drafted and not yet reviewed\./);
});
