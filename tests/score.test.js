// crosssafe-spec.md (b) T1-T15 as given/expect tests. Each test has two halves:
//  - "given": the OSM tags of the named real ids, read from the committed snapshot data/osm-dulles.json
//    (re-checked at kickoff; if OSM moved, the given is updated, never the rule);
//  - "expect": the scoring result from js/score.js. On the Fri tests-first SHA js/score.js is a stub, so
//    every T-test fails on the expect half; the scoring rows make them green.
// HIN / AADT values below are the spec's quoted layer values (raw TxDOT/H-GAC rows are not committed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../js/score.js');

const SNAP = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'osm-dulles.json'), 'utf8'));
const byId = new Map(SNAP.elements.map((e) => [e.type + '/' + e.id, e]));
const el = (type, id) => { const e = byId.get(type + '/' + id); assert.ok(e, `${type} ${id} not in the committed snapshot`); return e; };
const tags = (type, id) => el(type, id).tags || {};
// Real ids from crosssafe-spec (b), re-checked against the committed snapshot at kickoff (see the given halves).
const GIVEN = {
  T1_NODES: [13812805968, 13812805969, 13812805972],
  T3_NODES: [13812882560, 13812882561, 13812882562],
  T7_DULLES_WAY: 423183909, // snapshot 19:16Z: the Dulles carriageway the T1 crossing node sits on; sidewalk 1511186893 is 4.8 m away
  // T9 resolved on the snapshot: the spec's example ids 683327850 + 1414046710 are consecutive segments of ONE carriageway;
  // at lat 29.6157 the two opposite carriageways are 423183910 (lanes 2) and 1076774990 (lanes 3) = 5.
  T9_ROUTE: [[29.6157, -95.5840], [29.6157, -95.5810]],
  // T10 given updated Fri Oct 16, 2026 ~3:50 PM CDT (sub-w177; OSM moved, rule unchanged): the old point [29.622, -95.57068]
  // (first vertex) has signalized crossing node 13812827095 6.7 m away in the 19:16Z snapshot, so it no longer meets the
  // spec's given 'no crossing node within 30 m'. This point is on the way's long segment, 342 m from the nearest crossing node.
  T10_POINT: [29.62394, -95.57478],
  // T11 resolved on the snapshot: bridge ways 99648476/99648484 span lon -95.58222..-95.58308 at lat ~29.6273, which covers
  // the Dulles carriageways (lon -95.58259 / -95.58276), so a route along Dulles passes under them.
  T11_ROUTE: [[29.6265, -95.58259], [29.6280, -95.58259]],
  // inferred from the snapshot: US 90A frontage ways are 'US Highway 90A' (primary), main lanes 'Main Street' (trunk)
  T12_SERVICE_NAME: 'US Highway 90A',
  // SYNTHETIC stand-in: Kempner St is outside the 2-mi snapshot, so a point 3.0 mi (4,828 m) due west of the NCES point
  T13_KEMPNER_POINT: [29.619752, -95.584352 - 4828.032 / (111320 * Math.cos((29.619752 * Math.PI) / 180))],
};
const HIN_255288_100_125 = { route: '255288', frm_dfo: 1.0, to_dfo: 1.25, tier_ped: 'Top 10%', tier_bike: 'Top 5%', K_bike_cnt: 1, A_bike_cnt: 1 };
const HIN_255288_025_050 = { route: '255288', frm_dfo: 0.25, to_dfo: 0.5, tier_ped: 'Top 5%', tier_bike: '', hin_bike: 0 };

test('T1 Dulles Ave x Viking Ln, walk: Q 0.3, T 1.3 unknown, V assumed, H_hin 2 -> M 1.5', () => {
  for (const id of GIVEN.T1_NODES) {
    const t = tags('node', id);
    assert.equal(t.highway, 'crossing'); assert.equal(t.crossing, 'traffic_signals');
  }
  const r = S.scoreCrossing(SNAP, GIVEN.T1_NODES[0], { mode: 'walk', hin: [HIN_255288_100_125], aadt: [] });
  assert.equal(r.Q, 0.3); assert.equal(r.T, 1.3); assert.equal(r.H_hin, 2); assert.equal(r.M, 1.5);
  assert.ok(r.flags.includes('traffic count unknown') && r.flags.includes('speed assumed'));
  assert.ok(r.text.includes('Dulles Avenue at Viking Lane'));
});

test('T2 same crossing, bike: H_hin 3 (tier_bike) -> M 1.75', () => {
  const r = S.scoreCrossing(SNAP, GIVEN.T1_NODES[0], { mode: 'bike', hin: [HIN_255288_100_125], aadt: [] });
  assert.equal(r.H_hin, 3); assert.equal(r.M, 1.75);
});

test('T3 Dulles Ave x Avenue E: walk H_hin 3 -> M 1.75; bike H_hin 0 without the unknown flag', () => {
  for (const id of GIVEN.T3_NODES) assert.equal(tags('node', id).crossing, 'traffic_signals');
  const w = S.scoreCrossing(SNAP, GIVEN.T3_NODES[0], { mode: 'walk', hin: [HIN_255288_025_050], aadt: [] });
  assert.equal(w.H_hin, 3); assert.equal(w.M, 1.75);
  const b = S.scoreCrossing(SNAP, GIVEN.T3_NODES[0], { mode: 'bike', hin: [HIN_255288_025_050], aadt: [] });
  assert.equal(b.H_hin, 0); assert.ok(!b.flags.includes('HIN coverage unknown'));
});

test('T4 Avenue E way 1077597299 sidewalk:both=no: G 1.0 (real tag), C 0.6, finding names the tag', () => {
  const t = tags('way', 1077597299);
  assert.equal(t['sidewalk:both'], 'no'); assert.equal(t.highway, 'tertiary');
  const r = S.scoreStretch(SNAP, 1077597299, { side: 'right' });
  assert.equal(r.G, 1.0); assert.equal(r.C, 0.6); assert.ok(r.flags.includes('speed assumed'));
  assert.ok(r.finding.includes('sidewalk:both=no')); assert.equal(r.unknown, false);
});

test('T5 Avenue E way 230172339: left side G 1.0; right side with no separate way within 15 m G 0.6 + SIDEWALK_SEPARATE_NOT_FOUND', () => {
  const t = tags('way', 230172339);
  assert.equal(t['sidewalk:left'], 'no'); assert.equal(t['sidewalk:right'], 'separate');
  assert.equal(S.scoreStretch(SNAP, 230172339, { side: 'left' }).G, 1.0);
  const nosep = { ...SNAP, elements: SNAP.elements.filter((e) => !(e.type === 'way' && e.tags && e.tags.footway === 'sidewalk')) };
  const b = S.scoreStretch(nosep, 230172339, { side: 'right' });
  assert.equal(b.G, 0.6); assert.ok(b.flags.includes('SIDEWALK_SEPARATE_NOT_FOUND'));
});

test('T6 Avenue E way 230172339 with no HIN segment within 25 m: H_hin 0 + "HIN coverage unknown"', () => {
  const r = S.scoreStretch(SNAP, 230172339, { side: 'left', hin: [] });
  assert.equal(r.H_hin, 0); assert.ok(r.flags.includes('HIN coverage unknown'));
  assert.ok(!/not on the High-Injury Network/i.test(r.finding || ''));
});

test('T7 Dulles Ave next to Viking Ln with sidewalk way 1511186893 within 15 m: G 0.1, no "no sidewalk" finding', () => {
  const t = tags('way', 1511186893);
  assert.equal(t.highway, 'footway'); assert.equal(t.footway, 'sidewalk');
  const r = S.scoreStretch(SNAP, GIVEN.T7_DULLES_WAY, { side: 'right' });
  assert.equal(r.G, 0.1); assert.ok(!/no sidewalk/i.test(r.finding || ''));
});

test('T8 Dulles Ave has no maxspeed: V = modeSpeed(snapshot, "secondary") with "speed assumed"', () => {
  const dulles = SNAP.elements.filter((e) => e.type === 'way' && e.tags && e.tags.name === 'Dulles Avenue');
  assert.ok(dulles.length > 0); assert.ok(dulles.every((w) => !w.tags.maxspeed));
  const r = S.scoreStretch(SNAP, dulles[0].id, { side: 'right' });
  assert.equal(r.speed_mph, S.modeSpeed(SNAP, 'secondary')); assert.ok(r.flags.includes('speed assumed'));
});

test('T9 Dulles Ave as a divided road: two oneway carriageways within 40 m = one crossing event, lanes 5 -> N 2.5', () => {
  const r = S.crossingEvents(SNAP, GIVEN.T9_ROUTE);
  const d = r.filter((e) => e.name === 'Dulles Avenue');
  assert.equal(d.length, 1); assert.equal(d[0].lanes_total, 5); assert.equal(d[0].N, 2.5);
});

test('T10 US 90A way 1108545932 at grade, no crossing node within 30 m: Q 1.0 "no mapped crossing", T 1.6, V 2.60', () => {
  const t = tags('way', 1108545932);
  assert.equal(t.highway, 'trunk'); assert.equal(t.maxspeed, '55 mph'); assert.equal(t.oneway, 'yes');
  const crossingNodes = SNAP.elements.filter((e) => e.type === 'node' && e.tags && (e.tags.highway === 'crossing' || e.tags.footway === 'crossing'));
  const hav = ([a1, o1], [a2, o2]) => { const r = (d) => (d * Math.PI) / 180; const h = Math.sin(r(a2 - a1) / 2) ** 2 + Math.cos(r(a1)) * Math.cos(r(a2)) * Math.sin(r(o2 - o1) / 2) ** 2; return 2 * 6371008.8 * Math.asin(Math.sqrt(h)); };
  assert.ok(crossingNodes.every((n) => hav([n.lat, n.lon], GIVEN.T10_POINT) > 30), 'given: no crossing node within 30 m of the T10 point');
  const r = S.scoreAtGrade(SNAP, 1108545932, GIVEN.T10_POINT, { aadt: [{ station: '80H34A', road: 'US 90A', aadt: 54994, year: 2025 }], hin: [] });
  assert.equal(r.Q, 1.0); assert.equal(r.T, 1.6); assert.equal(r.V, 2.6);
  assert.ok(r.text.includes('mapped data shows no crossing')); assert.ok(!/illegal|unsafe/i.test(r.text));
});

test('T11 US 90A bridge ways (bridge=yes, layer=1) over a Dulles Ave route: 0 crossing events for them', () => {
  for (const id of [99648476, 99648484]) { const t = tags('way', id); assert.equal(t.bridge, 'yes'); assert.equal(t.layer, '1'); }
  const ev = S.crossingEvents(SNAP, GIVEN.T11_ROUTE).filter((e) => [99648476, 99648484].includes(e.way));
  assert.equal(ev.length, 0);
});

test('T12 two TxDOT stations within 200 m: T uses the station matched by road (service road 17,339), never the nearer/larger one', () => {
  const aadt = [{ station: '80H34A', road: 'US 90A', aadt: 54994, year: 2025 }, { station: '80H34EBSR', road: 'US 90A EB service road', aadt: 17339, year: 2025 }];
  const r = S.crossingWeightByRoad({ highway: 'primary', name: GIVEN.T12_SERVICE_NAME }, aadt);
  assert.equal(r.station, '80H34EBSR'); assert.equal(r.T, 1.6);
});

test('T13 Kempner Street ~3.0 mi out: excluded "outside walk zone", no score', () => {
  const r = S.inZone(SNAP.school, GIVEN.T13_KEMPNER_POINT);
  assert.equal(r.in, false); assert.match(r.reason, /^outside walk zone \(3\.0 mi\)$/);
});

test('T14 Viking Lane way 20873693 (unclassified, no other tags): G 0.6 unknown, C 0.4, SIDEWALK_UNMAPPED', () => {
  const t = tags('way', 20873693);
  assert.equal(t.highway, 'unclassified');
  const nofoot = { ...SNAP, elements: SNAP.elements.filter((e) => !(e.type === 'way' && e.tags && e.tags.highway === 'footway')) };
  const r = S.scoreStretch(nofoot, 20873693, { side: 'right' });
  assert.equal(r.G, 0.6); assert.equal(r.C, 0.4); assert.equal(r.unknown, true); assert.ok(r.flags.includes('SIDEWALK_UNMAPPED'));
  assert.ok(!/\bsafe\b|no sidewalk\b/i.test(r.finding));
});

test('T15 synthetic CRIS-style K crash (SYN-0001): piece at 30 m H_cris 3 (capped), piece at 120 m none', () => {
  const crash = { id: 'SYN-0001', sev: 'K', lat: 29.6, lon: -95.58 }; // SYNTHETIC, invented
  const at = (m) => [29.6, -95.58 + m / (111320 * Math.cos((29.6 * Math.PI) / 180))];
  assert.equal(S.historyWeight(at(30), [crash]).H_cris, 3);
  assert.equal(S.historyWeight(at(120), [crash]).H_cris, 0);
});
