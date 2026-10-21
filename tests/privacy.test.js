// privacy-test-spec P9 (a)-(d): route start points never reveal where Aariv lives. Drafted by sub-w177 (Fri Oct 16, 2026
// ~4:10 PM CDT); checked by sub-w178 against the committed anchors.json + 6 route files (Fri Oct 16, 2026 ~4:55 PM CDT),
// which added the anchors.json name/kind match and the P9(b) intersection check against the slim snapshot.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROUTES = path.join(ROOT, 'data', 'routes');
const KINDS = new Set(['intersection', 'park', 'park_entrance', 'library', 'community_centre', 'school']);
const HOUSE = new Set(['house', 'residential', 'detached', 'apartments', 'semidetached_house', 'terrace']);
const DEMO_SCHOOL_ANCHOR = { osm_type: 'way', osm_id: 457328707 };
const BAD_LABEL = /\b(home|house|casa|hogar)\b|\bmy street\b|\bmi calle\b/i;
const HOUSE_NO = /^\d+\s+\w+/;

const hav = ([a1, o1], [a2, o2]) => { const r = (d) => (d * Math.PI) / 180; const h = Math.sin(r(a2 - a1) / 2) ** 2 + Math.cos(r(a1)) * Math.cos(r(a2)) * Math.sin(r(o2 - o1) / 2) ** 2; return 2 * 6371008.8 * Math.asin(Math.sqrt(h)); };
function toSeg(p, a, b) { // metres from p to segment a-b (local equirectangular)
  const k = Math.cos((p[0] * Math.PI) / 180);
  const P = [p[1] * k, p[0]], A = [a[1] * k, a[0]], B = [b[1] * k, b[0]];
  const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L2)) : 0;
  return hav(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
}
const routeFiles = () => (fs.existsSync(ROUTES) ? fs.readdirSync(ROUTES).filter((f) => f.endsWith('.json') && f !== 'anchors.json') : []);
let SNAP; const snap = () => (SNAP = SNAP || JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'osm-dulles.json'), 'utf8')));
const anchorsDoc = () => JSON.parse(fs.readFileSync(path.join(ROUTES, 'anchors.json'), 'utf8'));
// first coordinate of an OSRM reply: routes[0].geometry.coordinates[0] is [lon, lat]
const firstCoord = (r) => { const c = r.routes[0].geometry.coordinates[0]; return [c[1], c[0]]; };

test('P9(a)-(d) every demo route starts at a named public anchor, never near a home', () => {
  const files = routeFiles();
  if (!files.length) return; // nothing to check until the routes commit
  const doc = anchorsDoc();
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(ROUTES, f), 'utf8'));
    const a = r.meta && r.meta.anchor;
    assert.ok(a && a.osm_type && a.osm_id && KINDS.has(a.kind) && a.name, `${f}: P9(a) meta.anchor missing/invalid`);
    const e = doc.anchors.find((x) => x.osm_type === a.osm_type && x.osm_id === a.osm_id);
    assert.ok(e, `${f}: P9(a) no anchors.json entry for ${a.osm_type}/${a.osm_id}`);
    assert.ok(e.name === a.name && e.kind === a.kind, `${f}: P9(a) meta.anchor name/kind differ from anchors.json`);
    if (a.kind === 'intersection') { // P9(b): a node shared by >= 2 ways of the slim snapshot with different names
      const names = new Set(snap().elements.filter((w) => w.type === 'way' && (w.nodes || []).includes(a.osm_id) && w.tags && w.tags.name).map((w) => w.tags.name));
      assert.ok(a.osm_type === 'node' && names.size >= 2, `${f}: P9(b) intersection ${a.osm_id} is not shared by 2 differently named ways in data/osm-dulles.json`);
    }
    const t = e.tags || {};
    const demo = r.meta.demo === true && a.kind === 'school' && a.osm_type === DEMO_SCHOOL_ANCHOR.osm_type && a.osm_id === DEMO_SCHOOL_ANCHOR.osm_id
      && t.amenity === 'school' && t.name === 'Dulles High School';
    for (const k of ['addr:housenumber', 'shop', 'office', 'craft']) {
      if (k === 'addr:housenumber' && demo) continue; // P9(b-demo): addr:* only, this one way, demo only
      assert.ok(!(k in t), `${f}: P9(b) anchor tag ${k}`);
    }
    assert.ok(!HOUSE.has(t.building), `${f}: P9(b) anchor building=${t.building}`);
    const p0 = firstCoord(r);
    let d;
    if (e.osm_type === 'node') d = hav(p0, [e.lat, e.lon]);
    else { const g = e.geometry; d = Infinity; for (let i = 0; i + 1 < g.length; i++) d = Math.min(d, toSeg(p0, g[i], g[i + 1])); }
    assert.ok(d <= 30, `${f}: P9(c) first coordinate ${d.toFixed(1)} m from the anchor (> 30 m)`);
    for (const label of [a.name, f]) {
      assert.ok(!BAD_LABEL.test(label), `${f}: P9(d) label "${label}"`);
      assert.ok(!HOUSE_NO.test(label), `${f}: P9(d) house-number pattern "${label}"`);
    }
  }
});
// P9(e) (added Fri Oct 16, 2026 ~5:10 PM CDT by sub-w179 with js/ref.js, R50 step A): every reference route starts at a
// seeded point, never one added by hand. The ids are regenerated from REF_SEED + the slim snapshot, not read from
// points.json, so a hand edit of points.json and the ref dirs together is caught too.
test('P9(e) every data/routes/ref/{walk,bike}/<wayId>.json is a seeded point, and the count matches', () => {
  const REF = path.join(ROUTES, 'ref');
  if (!fs.existsSync(REF)) return; // nothing to check until the R50 step A commit
  const { buildSample } = require('../js/ref.js');
  const want = buildSample(snap()).points.map((p) => String(p.way_id)).sort();
  const extra = fs.readdirSync(REF).filter((f) => !['walk', 'bike'].includes(f));
  assert.deepEqual(extra, [], `P9(e) unexpected entries in data/routes/ref/: ${extra.join(', ')}`);
  for (const mode of ['walk', 'bike']) {
    const dir = path.join(REF, mode);
    const got = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    for (const f of got) {
      const m = /^(\d+)\.json$/.exec(f);
      assert.ok(m && want.includes(m[1]), `data/routes/ref/${mode}/${f}: P9(e) not a seeded point (REF_SEED 20261016)`);
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      assert.ok(r.meta && String(r.meta.way_id) === m[1] && r.meta.mode === mode, `data/routes/ref/${mode}/${f}: P9(e) meta.way_id/mode mismatch`);
    }
    assert.equal(got.length, want.length, `data/routes/ref/${mode}/: P9(e) ${got.length} files for ${want.length} seeded points`);
  }
});

// P9(d) on the route labels (i18n-test-spec §9; added Fri Oct 16, 2026, wave 181, with i18n/en.json + i18n/es.json):
// every §9 template, EN and ES, with an empty and a sample substitution, and every label built for a committed route,
// passes the denylist and has no leading house number. Mutation P9m3 ("From home" in i18n/en.json) fails here.
test('P9(d) route label templates and built labels, EN and ES: no home/house/casa/hogar/my street/mi calle, no house number', () => {
  const I = require('../js/i18n.js');
  const check = (where, s) => {
    assert.ok(!BAD_LABEL.test(s), `${where}: P9(d) label "${s}"`);
    assert.ok(!HOUSE_NO.test(s), `${where}: P9(d) house-number pattern "${s}"`);
  };
  for (const lang of ['en', 'es']) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', `${lang}.json`), 'utf8'));
    for (const [k, v] of Object.entries(d)) {
      check(`i18n/${lang}.json ${k}`, v);
      // every placeholder a template uses gets a value (wave 184: EN-only keys may carry e.g. {host}, {date}, {finding})
      const holes = [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const sample = { anchor: 'Lost Creek Park', school: 'Dulles High School', mode: d.ROUTE_MODE_WALK, host: 'unpkg.com', date: '2026-10-16', finding: 'Dulles Avenue' };
      check(`i18n/${lang}.json ${k} (empty)`, I.fill(v, Object.fromEntries(holes.map((h) => [h, '']))));
      check(`i18n/${lang}.json ${k} (sample)`, I.fill(v, Object.fromEntries(holes.map((h) => [h, sample[h] == null ? '' : sample[h]]))));
    }
    for (const f of routeFiles()) {
      const meta = JSON.parse(fs.readFileSync(path.join(ROUTES, f), 'utf8')).meta;
      const L = I.routeLabel(d, f.replace(/\.json$/, ''), meta);
      check(`${lang} ${f}`, L.label);
      if (L.note) check(`${lang} ${f} note`, L.note);
    }
  }
});

