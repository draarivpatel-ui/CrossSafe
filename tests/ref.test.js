// T16 (crosssafe-spec §b): the R50 reference sample is seeded, bounded and reproducible. Offline: reads only the
// committed slim snapshot and data/ref/points.json. Fixture numbers in (d)/(e) are SYNTHETIC test inputs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { haversine } = require('../js/logic.js');
const ref = require('../js/ref.js');

const ROOT = path.join(__dirname, '..');
const SNAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'osm-dulles.json'), 'utf8'));
const POINTS_FILE = path.join(ROOT, 'data', 'ref', 'points.json');
const committed = () => fs.readFileSync(POINTS_FILE, 'utf8');
const R = 6371008.8;
const north = (d) => ref.NCES_POINT[0] + (d / R) * (180 / Math.PI); // latitude d metres due north of the NCES point
const flat = (id, lat, tags) => ({ type: 'way', id, tags, geometry: [[lat, ref.NCES_POINT[1] - 0.0002], [lat, ref.NCES_POINT[1] + 0.0002]] });

test('T16 constants: REF_SEED 20261016, NCES point = snapshot school point, mulberry32 is deterministic', () => {
  assert.equal(ref.REF_SEED, 20261016);
  assert.deepEqual(ref.NCES_POINT, [SNAP.school.lat, SNAP.school.lon]);
  const a = ref.mulberry32(20261016), b = ref.mulberry32(20261016);
  for (let i = 0; i < 5; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});

test('T16(a)(b) sample built twice, and from reversed ways, is byte-identical to the committed points.json', () => {
  const s1 = ref.serializeSample(ref.buildSample(SNAP));
  const s2 = ref.serializeSample(ref.buildSample(SNAP));
  const rev = Object.assign({}, SNAP, { elements: SNAP.elements.slice().reverse() });
  const s3 = ref.serializeSample(ref.buildSample(rev));
  assert.equal(s1, committed(), 'points.json is stale: run node scripts/ref-points.js');
  assert.equal(s2, committed());
  assert.equal(s3, committed(), 'order of ways changed the draw');
  const doc = JSON.parse(committed());
  assert.equal(doc.seed, 20261016);
  assert.equal(doc.osm_base, SNAP.osm_base);
});

test('T16(c) seed 20261017 gives a different list (the seed is used)', () => {
  const ids = (s) => s.points.map((p) => p.way_id).join(',');
  assert.notEqual(ids(ref.buildSample(SNAP, 20261017)), ids(ref.buildSample(SNAP, 20261016)));
});

test('T16(d) bounds 402.336-3,218.688 m are inclusive at both ends', () => {
  assert.equal(ref.inBounds(402.336), true);
  assert.equal(ref.inBounds(3218.688), true);
  assert.equal(ref.inBounds(3218.689), false);
  assert.equal(ref.inBounds(400), false);
  // SYNTHETIC 3-way fixture (6-dp coordinates move a point by up to ~0.06 m, so the ways sit just inside/outside):
  // way 1 at 400.0 m, way 2 at 402.4 m, way 3 at 3,218.9 m due north of the NCES point -> only way 2.
  const fx = { osm_base: 'x', elements: [flat(1, north(400.0), { highway: 'residential' }), flat(2, north(402.4), { highway: 'residential' }), flat(3, north(3218.9), { highway: 'residential' })] };
  assert.deepEqual(ref.refCandidates(fx).map((c) => c.way_id), [2]);
});

test('T16(e) highway=residential + service=* is a candidate; highway=service is not', () => {
  const fx = { osm_base: 'x', elements: [flat(11, north(1000), { highway: 'residential', service: 'alley' }), flat(12, north(1100), { highway: 'service' })] };
  assert.deepEqual(ref.refCandidates(fx).map((c) => c.way_id), [11]);
});

test('T16 committed points: min(30, candidates) points, no duplicate way id, every point within 402.336-3,218.688 m', () => {
  const doc = JSON.parse(committed());
  const nCand = ref.refCandidates(SNAP).length;
  assert.equal(doc.n_candidates, nCand);
  assert.equal(doc.points.length, Math.min(30, nCand));
  assert.equal(doc.n_drawn, doc.points.length);
  assert.equal(new Set(doc.points.map((p) => p.way_id)).size, doc.points.length, 'duplicate way id');
  const ways = new Map(SNAP.elements.filter((e) => e.type === 'way').map((e) => [e.id, e]));
  for (const p of doc.points) {
    const d = haversine([p.lat, p.lon], ref.NCES_POINT);
    assert.ok(d >= 402.336 && d <= 3218.688, `way ${p.way_id}: ${d.toFixed(3)} m outside 0.25-2 mi`);
    assert.equal(ways.get(p.way_id).tags.highway, 'residential', `way ${p.way_id} is not highway=residential`);
    assert.ok(/^-?\d+(\.\d{1,6})?$/.test(String(p.lat)) && /^-?\d+(\.\d{1,6})?$/.test(String(p.lon)), `way ${p.way_id}: more than 6 dp`);
  }
});

test('no Math.random in js/ or scripts/ (the R50 draw must be seeded)', () => {
  const hits = [];
  for (const dir of ['js', 'scripts']) {
    const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { if (f.name !== '__pycache__') walk(p); } else if (/\.(js|mjs|cjs)$/.test(f.name) && /Math\.random\s*\(/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(ROOT, p));
    } };
    walk(path.join(ROOT, dir));
  }
  assert.deepEqual(hits, []);
});
