// Test plan A1-A12 (kickoff-runbook 'Test plan' A). Tests first: on the Fri 3:30 PM SHA these run against
// the js/logic.js stub and fail one by one; the 4:00 PM row makes them green.
// Fixtures are SYNTHETIC (ids >= 9,000,000,000,000 so they never collide with real OSM ids).
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

const R_EARTH = 6371008.8; // mean Earth radius (IUGG), metres
const rad = (d) => (d * Math.PI) / 180;
// Reference haversine written out in the test (A1), independent of js/logic.js.
function refHaversine([la1, lo1], [la2, lo2]) {
  const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}
const ID = 9000000000000;
const LAT0 = 29.6, LON0 = -95.58;
const east = (m) => m / (111320 * Math.cos(rad(LAT0))); // metres -> degrees of longitude at LAT0 (fixture offsets only)
const road = (id, tags, geometry) => ({ type: 'way', id, tags, geometry });
const ROAD_GEOM = [[LAT0, LON0], [LAT0 + 0.0025, LON0], [LAT0 + 0.005, LON0]];
const ROUTE = ROAD_GEOM.map(([a, b]) => [a, b]);
const SIDEWALK = road(ID + 2, { highway: 'footway', footway: 'sidewalk' }, ROAD_GEOM.map(([a, b]) => [a, b + east(10)]));
const snap = (elements) => ({ schema: 1, osm_base: '2026-10-16T19:00:00Z', elements });

test('A1 haversine matches the written-out formula within 1 m', () => {
  // Plan text names Sugar Land Town Square -> City Hall; coordinates for those two were not on file, so this
  // uses the recorded NCES Dulles HS point and a point 0.01 deg north-east of it (same formula check).
  const a = [29.619752, -95.584352], b = [29.629752, -95.574352];
  assert.ok(Math.abs(L.haversine(a, b) - refHaversine(a, b)) <= 1);
});

test('A2 pointToSegment: on the segment = 0, beyond an end = distance to that end, degenerate segment', () => {
  const a = [LAT0, LON0], b = [LAT0 + 0.001, LON0];
  assert.ok(L.pointToSegment([LAT0 + 0.0005, LON0], a, b) < 0.01);
  const beyond = [LAT0 + 0.002, LON0];
  assert.ok(Math.abs(L.pointToSegment(beyond, a, b) - refHaversine(beyond, b)) <= 1);
  const p = [LAT0, LON0 + east(50)];
  assert.ok(Math.abs(L.pointToSegment(p, a, a) - refHaversine(p, a)) <= 1);
});

test('A3 walkZone(school, 1609): bbox contains the school and reaches ~1 mile each way (±1%)', () => {
  const s = { lat: 29.619752, lon: -95.584352 };
  const z = L.walkZone(s, 1609);
  assert.ok(z.south < s.lat && s.lat < z.north && z.west < s.lon && s.lon < z.east);
  for (const [p, q] of [[[z.north, s.lon], [s.lat, s.lon]], [[z.south, s.lon], [s.lat, s.lon]], [[s.lat, z.east], [s.lat, s.lon]], [[s.lat, z.west], [s.lat, s.lon]]]) {
    assert.ok(Math.abs(refHaversine(p, q) - 1609) <= 16.09);
  }
});

test('A4 routeGaps: a route along a road with a sidewalk way within 15 m has no gap', () => {
  const r = road(ID + 1, { highway: 'residential' }, ROAD_GEOM);
  assert.deepEqual(L.routeGaps(ROUTE, snap([r, SIDEWALK])), []);
});

test('A5 routeGaps: same route with the sidewalk removed gives one gap of the route length (±2 m)', () => {
  const r = road(ID + 1, { highway: 'residential' }, ROAD_GEOM);
  const gaps = L.routeGaps(ROUTE, snap([r]));
  assert.equal(gaps.length, 1);
  const len = refHaversine(ROUTE[0], ROUTE[1]) + refHaversine(ROUTE[1], ROUTE[2]);
  assert.ok(Math.abs(gaps[0].length_m - len) <= 2);
});

test('A6 sidewalk=no is a gap with no footway geometry; sidewalk=separate looks for the separate way', () => {
  const no = road(ID + 1, { highway: 'residential', sidewalk: 'no' }, ROAD_GEOM);
  assert.equal(L.routeGaps(ROUTE, snap([no])).length, 1);
  const sep = road(ID + 1, { highway: 'residential', sidewalk: 'separate' }, ROAD_GEOM);
  assert.deepEqual(L.routeGaps(ROUTE, snap([sep, SIDEWALK])), []);
});

test('A7 crossing a road with a highway=crossing node within 30 m is covered; none = "unmarked crossing" finding', () => {
  const cross = road(ID + 3, { highway: 'secondary' }, [[LAT0 + 0.0025, LON0 - east(100)], [LAT0 + 0.0025, LON0 + east(100)]]);
  const node = { type: 'node', id: ID + 4, lat: LAT0 + 0.0025, lon: LON0 + east(20), tags: { highway: 'crossing', crossing: 'marked' } };
  assert.equal(L.crossingCoverage(ROUTE, snap([cross, node]))[0].covered, true);
  const none = L.crossingCoverage(ROUTE, snap([cross]));
  assert.equal(none[0].covered, false);
  assert.equal(none[0].finding, 'unmarked crossing');
});

test('A8 crossing=unmarked / crossing:markings=no counts as a crossing but is flagged lower', () => {
  const cross = road(ID + 3, { highway: 'secondary' }, [[LAT0 + 0.0025, LON0 - east(100)], [LAT0 + 0.0025, LON0 + east(100)]]);
  for (const tags of [{ highway: 'crossing', crossing: 'unmarked' }, { highway: 'crossing', 'crossing:markings': 'no' }]) {
    const c = L.crossingCoverage(ROUTE, snap([cross, { type: 'node', id: ID + 4, lat: LAT0 + 0.0025, lon: LON0, tags }]))[0];
    assert.equal(c.covered, true);
    assert.equal(c.marked, false);
  }
});

test('A9 missing data is a finding: no sidewalk tag and no nearby footway = "unknown", never "safe"', () => {
  const r = road(ID + 1, { highway: 'residential' }, ROAD_GEOM);
  assert.equal(L.sidewalkStatus(r, snap([r])), 'unknown');
});

test('A10 crossingWeight: higher AADT -> higher weight; no AADT point within 200 m -> "traffic count unknown"', () => {
  const p = [LAT0, LON0];
  const lo = L.crossingWeight(p, [{ lat: LAT0, lon: LON0 + east(50), aadt: 5000 }]);
  const hi = L.crossingWeight(p, [{ lat: LAT0, lon: LON0 + east(50), aadt: 50000 }]);
  assert.ok(hi.weight > lo.weight);
  const far = L.crossingWeight(p, [{ lat: LAT0, lon: LON0 + east(250), aadt: 50000 }]);
  assert.equal(far.weight, null);
  assert.equal(far.reason, 'traffic count unknown');
});

test('A11 gapScore: empty zone -> null with a reason (not 0, not 100); small fixture matches by hand', () => {
  const empty = L.gapScore({ walk_m: 0, gap_m: 0 });
  assert.equal(empty.score, null);
  assert.ok(typeof empty.reason === 'string' && empty.reason.length > 0);
  assert.equal(L.gapScore({ walk_m: 1000, gap_m: 250 }).score, 75); // [DESIGN] share of walked metres with a sidewalk, x100
});

test('A12 letter(): school, every finding with its location, data dates, CRIS "not included", only given observations', () => {
  const sources = { files: { 'data/osm-dulles.json': { osm_base: '2026-10-16T19:00:00Z' } },
    raw: { aadt: { data_as_of: '2025' }, 'cris-2025-2026': { status: 'not_included' } } };
  const findings = [{ text: 'Unmarked crossing', location: 'Dulles Ave at Avenue E' }, { text: 'Sidewalk gap', location: 'Avenue E, 120 m' }];
  const t = L.letter({ school: 'Dulles High School', findings, sources, observations: [] });
  assert.ok(t.includes('Dulles High School'));
  for (const f of findings) assert.ok(t.includes(f.location));
  assert.ok(t.includes('2026-10-16T19:00:00Z'));
  assert.ok(t.includes('2025'));
  assert.ok(/not included/.test(t));
  assert.ok(!/observ/i.test(t), 'empty evidence must give no observation paragraph');
});
