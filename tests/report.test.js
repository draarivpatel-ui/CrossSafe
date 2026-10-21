// A13-A16 (kickoff-runbook 6:00 row): end to end in Node on the committed data, from what the real snapshot shows.
// Real ids, read from data/osm-dulles.json (osm_base in the file): Ludwig Lane way 20904557 has separately mapped
// sidewalks (1511183768 / 1511183774); Avenue E way 1077595600 is tagged sidewalk:both=no with no sidewalk way nearby.
// If OSM moves at a re-snapshot, the given ids are updated here, never the rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const L = require('../js/logic.js');
const S = require('../js/score.js');

const ROOT = path.join(__dirname, '..');
const SNAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'osm-dulles.json'), 'utf8'));
const way = (id) => { const w = SNAP.elements.find((e) => e.type === 'way' && e.id === id); assert.ok(w, `way ${id} not in the committed snapshot`); return w; };
const len = (g) => g.slice(1).reduce((s, p, i) => s + L.haversine(g[i], p), 0);
const REPORT = path.join(ROOT, 'scripts', 'report.js');
const run = (args) => spawnSync(process.execPath, [REPORT, ...args], { cwd: ROOT, encoding: 'utf8' });
const ids = () => require('../scripts/report.js').routeIds();

test('A13 real fully mapped street: a route along Ludwig Lane (way 20904557) has no sidewalk gap, G = 0.1 both sides', () => {
  const w = way(20904557);
  assert.equal(w.tags.name, 'Ludwig Lane');
  assert.deepEqual(L.routeGaps(w.geometry, SNAP), []);
  for (const side of ['left', 'right']) assert.equal(S.scoreStretch(SNAP, w.id, { side }).G, 0.1, side);
});

test('A14 real gap where OSM has no sidewalk: Avenue E (way 1077595600, sidewalk:both=no) is one gap of its whole length', () => {
  const w = way(1077595600);
  assert.equal(w.tags.name, 'Avenue E'); assert.equal(w.tags['sidewalk:both'], 'no');
  const gaps = L.routeGaps(w.geometry, SNAP);
  assert.equal(gaps.length, 1);
  assert.ok(Math.abs(gaps[0].length_m - len(w.geometry)) <= 2, `gap ${gaps[0].length_m} m vs way ${len(w.geometry)} m`);
  const st = S.scoreStretch(SNAP, w.id, { side: 'right' });
  assert.equal(st.G, 1.0);
  assert.equal(st.finding, 'No sidewalk mapped (OSM tag `sidewalk:both=no`)');
});

test('A15 report.js dulles --route <id> --json: one JSON line per cached route with the pinned keys, offline', () => {
  const list = ids();
  let typedSeen = 0;
  assert.ok(list.length >= 2, 'expected the cached demo routes');
  for (const id of list) {
    const r = run(['dulles', '--route', id, '--json']);
    assert.equal(r.status, 0, `${id}: exit ${r.status} ${r.stderr}`);
    const lines = r.stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, `${id}: exactly one JSON line`);
    const o = JSON.parse(lines[0]);
    assert.equal(o.school, 'dulles'); assert.equal(o.route, id);
    for (const k of ['findings', 'N', 'k']) assert.ok(Number.isInteger(o[k]) && o[k] >= 0, `${id}: ${k} must be a non-negative integer`);
    assert.ok(o.k <= o.N, `${id}: k ${o.k} > N ${o.N}`);
    assert.equal(o.findings, o.list.length, `${id}: findings = number of listed findings`);
    assert.equal(o.osm_base, SNAP.osm_base);
    for (const f of o.list) assert.match(f.osm_id, /^(way|node)\/\d+$/);
    // k (crossing type not stated) is bounded by the listed crossings: a listed crossing with no node (way/<id>) counts
    // in k; a listed crossing node that carries crossing=* or crossing:markings=* does not
    const tagsOf = (nid) => (SNAP.elements.find((e) => e.type === 'node' && e.id === nid) || {}).tags || {};
    const cr = o.list.filter((f) => f.kind === 'crossing');
    const noNode = cr.filter((f) => f.osm_id.startsWith('way/')).length;
    const typed = cr.filter((f) => f.osm_id.startsWith('node/')).filter((f) => { const t = tagsOf(Number(f.osm_id.slice(5))); return t.crossing != null || t['crossing:markings'] != null; }).length;
    assert.ok(o.k >= noNode && o.k <= o.N - typed, `${id}: k ${o.k} outside [${noNode}, ${o.N - typed}]`);
    typedSeen += typed;
  }
  assert.ok(typedSeen >= 1, 'the real demo routes list at least one typed crossing node (keeps the k bound meaningful)');
  const src = fs.readFileSync(REPORT, 'utf8');
  assert.doesNotMatch(src, /https?:\/\/|\bfetch\(|require\(['"](https?|net)['"]\)/, 'report.js must not touch the network');
});

test('A16 real gaps found on a real route, and the CLI fails loudly on bad input', () => {
  // every cached demo route crosses at least one stretch the map marks as no/unknown sidewalk and has a routeGaps gap
  for (const id of ids()) {
    const o = JSON.parse(execFileSync(process.execPath, [REPORT, 'dulles', '--route', id, '--json'], { cwd: ROOT, encoding: 'utf8' }));
    assert.ok(o.gaps >= 1 && o.gap_m > 0, `${id}: expected a real sidewalk gap`);
    assert.ok(o.list.some((f) => f.kind === 'stretch'), `${id}: expected a stretch finding`);
    // sorted by risk points, highest first
    for (let i = 1; i < o.list.length; i++) assert.ok(o.list[i - 1].points >= o.list[i].points, `${id}: findings not sorted`);
  }
  const bad = run(['dulles', '--route', 'no-such-route', '--json']);
  assert.equal(bad.status, 2); assert.match(bad.stderr, /unknown route 'no-such-route'; cached routes: /);
  const noRoute = run(['dulles', '--json']);
  assert.equal(noRoute.status, 2); assert.match(noRoute.stderr, /--json needs --route/);
  const school = run(['kempner']);
  assert.equal(school.status, 2); assert.match(school.stderr, /unknown school 'kempner'/);
});

// ---- Findings dedupe + entrances (wave 181, Fri Oct 16, 2026; supports test-spec L1 "no duplicates") -------------
// L1 compares the findings list with the letter's list by id; these tests pin that report.js emits each
// (kind, OSM object) once, with a unique `fid`, and that driveway/service entrances are not counted as crossings.
const { dedupe, report } = require('../scripts/report.js');
const { scoreRoute, lengthM, isEntranceTags } = require('../js/route.js');
const RRI = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ref', 'rri.json'), 'utf8'));

test('L1-support(a) every cached route: fid = kind:osm_id is unique, one finding per (kind, OSM object), findings = list length', () => {
  for (const id of ids()) {
    const o = report(SNAP, id, RRI);
    const fids = o.list.map((f) => f.fid);
    assert.equal(new Set(fids).size, fids.length, `${id}: duplicate fid ${fids.filter((x, i) => fids.indexOf(x) !== i)}`);
    for (const f of o.list) assert.equal(f.fid, `${f.kind}:${f.osm_id}`, `${id}: fid ${f.fid}`);
    assert.equal(o.findings, o.list.length);
    for (const f of o.list.filter((x) => x.kind === 'crossing')) assert.ok(Number.isInteger(f.times) && f.times >= 1, `${id}: ${f.fid} times`);
    for (const f of o.list.filter((x) => x.kind === 'stretch')) assert.ok(['left', 'right', 'both'].includes(f.side), `${id}: ${f.fid} side ${f.side}`);
  }
});

test('L1-support(b) dedupe(): both sides of one road merge to side "both", one road crossed twice merges with times 2, stretch + crossing of one road stay two', () => {
  const out = dedupe([
    { osm_id: 'way/1', kind: 'stretch', side: 'left', length_m: 10, points: 0.5, text: 'a', flags: ['X'] },
    { osm_id: 'way/1', kind: 'stretch', side: 'right', length_m: 20.04, points: 1.25, text: 'b', flags: ['Y'] },
    { osm_id: 'way/2', kind: 'crossing', points: 2, text: 'c', flags: [] },
    { osm_id: 'way/2', kind: 'crossing', points: 3, text: 'd', flags: ['Z'] },
    { osm_id: 'way/3', kind: 'stretch', side: 'right', length_m: 5, points: 0.1, text: 'e', flags: [] },
    { osm_id: 'way/3', kind: 'crossing', points: 1, text: 'f', flags: [] },
    { osm_id: 'node/9', kind: 'crossing', points: 1, text: 'g', flags: [] },
  ]);
  const by = Object.fromEntries(out.map((f) => [f.fid, f]));
  assert.deepEqual(Object.keys(by).sort(), ['crossing:node/9', 'crossing:way/2', 'crossing:way/3', 'stretch:way/1', 'stretch:way/3']);
  assert.equal(by['stretch:way/1'].side, 'both'); assert.equal(by['stretch:way/1'].length_m, 30); assert.equal(by['stretch:way/1'].points, 1.75);
  assert.equal(by['stretch:way/1'].text, 'b'); assert.deepEqual(by['stretch:way/1'].flags, ['X', 'Y']);
  assert.equal(by['crossing:way/2'].times, 2); assert.equal(by['crossing:way/2'].points, 5); assert.equal(by['crossing:way/2'].text, 'd');
  assert.equal(by['crossing:node/9'].times, 1);
  for (const f of out) assert.ok(!('_best' in f), 'no internal fields leak');
});

test('L1-support(c) dedupe changes the list only, never route risk: summed finding points = summed qualifying piece points', () => {
  for (const id of ids()) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'routes', `${id}.json`), 'utf8'));
    const route = j.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);
    const r = scoreRoute(SNAP, route, { mode: j.meta.mode });
    assert.equal(r.mode, j.meta.mode);
    assert.equal(r.route_m, lengthM(route));
    const want = r.pieces.filter((p) => (p.kind === 'stretch' ? p.G >= 0.6 : p.Q >= 0.7)).reduce((s, p) => s + (p.kind === 'stretch' ? p.A : p.K), 0);
    const got = report(SNAP, id, RRI).list.reduce((s, f) => s + f.points, 0);
    assert.ok(Math.abs(want - got) < 0.01, `${id}: findings ${got} vs pieces ${want}`);
  }
});

test('Entrances [DESIGN]: highway=service ways (driveways, parking aisles, lot entrances) are not crossings: not in N, no K, counted as entrances', () => {
  assert.equal(isEntranceTags({ highway: 'service' }), true);
  assert.equal(isEntranceTags({ highway: 'service', service: 'driveway' }), true);
  assert.equal(isEntranceTags({ highway: 'residential' }), false);
  // synthetic: a straight 200 m north-south route crossed by one residential and one service way (east-west)
  const lat0 = 29.62, lon0 = -95.59, dLat = 200 / 111195;
  const route = [[lat0, lon0], [lat0 + dLat, lon0]];
  const ew = (lat, id, tags) => ({ type: 'way', id, tags, geometry: [[lat, lon0 - 0.001], [lat, lon0 + 0.001]] });
  const snap = { osm_base: 'x', elements: [ew(lat0 + dLat / 3, 1, { highway: 'residential', name: 'A Street' }), ew(lat0 + (2 * dLat) / 3, 2, { highway: 'service' })] };
  const r = scoreRoute(snap, route, { mode: 'walk' });
  assert.equal(r.n_crossings, 1, 'only the residential way is a crossing');
  assert.equal(r.n_entrances, 1, 'the service way is an entrance');
  assert.deepEqual(r.pieces.filter((p) => p.kind === 'crossing').map((p) => p.way), [1]);
  // real data: no crossing piece on any cached route is on a highway=service way, and the real service way 896398372
  // (listed twice as a crossing before this change) is not a crossing finding on any route
  const wayTags = new Map(SNAP.elements.filter((e) => e.type === 'way').map((e) => [e.id, e.tags || {}]));
  let entrances = 0;
  for (const id of ids()) {
    const o = report(SNAP, id, RRI);
    assert.ok(Number.isInteger(o.entrances) && o.entrances >= 0, `${id}: entrances`);
    entrances += o.entrances;
    assert.ok(!o.list.some((f) => f.fid === 'crossing:way/896398372'), `${id}: service way 896398372 listed as a crossing`);
    for (const f of o.list.filter((x) => x.kind === 'crossing' && x.osm_id.startsWith('way/'))) {
      assert.notEqual(wayTags.get(Number(f.osm_id.slice(4))).highway, 'service', `${id}: ${f.fid} is a service way`);
    }
  }
  assert.ok(entrances >= 1, 'the real demo routes do pass driveway/service entrances (keeps this test meaningful)');
});
