'use strict';
// R50 reference sample, step A (crosssafe-spec §a "Reference sample for R50" + §b T16; kickoff-runbook 5:30 row).
// 30 seeded start points = length-midpoints of OSM highway=residential ways, 402.336-3,218.688 m (0.25-2 mi,
// both ends inclusive) from the NCES point of Dulles HS. Pure: no network, no Date, no Math.random.
const { haversine } = require('./logic.js');

const REF_SEED = 20261016; // [DESIGN] kickoff date; also written into data/ref/points.json and the README
const REF_N = 30;
const NCES_POINT = [29.619752, -95.584352]; // NCES 481965001818 (Dulles H S), data/raw/schools.json
const MIN_M = 402.336; // 0.25 mi, inclusive
const MAX_M = 3218.688; // 2 mi, inclusive

// mulberry32 PRNG [DESIGN]: returns a function giving floats in [0, 1).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const inBounds = (d) => d >= MIN_M && d <= MAX_M;

// Midpoint by length along a [lat, lon] polyline, rounded to 6 decimal places.
function wayMidpoint(geom) {
  if (!geom || !geom.length) return null;
  if (geom.length === 1) return [round6(geom[0][0]), round6(geom[0][1])];
  const seg = [];
  let total = 0;
  for (let i = 0; i + 1 < geom.length; i++) { const l = haversine(geom[i], geom[i + 1]); seg.push(l); total += l; }
  let half = total / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i] || i === seg.length - 1) {
      const f = seg[i] === 0 ? 0 : Math.min(1, half / seg[i]);
      const a = geom[i], b = geom[i + 1];
      return [round6(a[0] + f * (b[0] - a[0])), round6(a[1] + f * (b[1] - a[1]))];
    }
    half -= seg[i];
  }
  return null;
}

// Every highway=residential way (any other tags, e.g. service=*, allowed) whose rounded midpoint is in bounds,
// sorted by way id ascending so the draw does not depend on the order Overpass returned the ways.
function refCandidates(snapshot, centre = NCES_POINT) {
  const out = [];
  for (const w of (snapshot && snapshot.elements) || []) {
    if (w.type !== 'way' || !w.tags || w.tags.highway !== 'residential') continue;
    const m = wayMidpoint(w.geometry);
    if (!m) continue;
    const d = haversine(m, centre);
    if (inBounds(d)) out.push({ way_id: w.id, lat: m[0], lon: m[1], dist_m: Math.round(d * 10) / 10 });
  }
  return out.sort((x, y) => x.way_id - y.way_id);
}

// Seeded partial Fisher-Yates over the sorted candidates: draw min(n, candidates) without replacement.
function buildSample(snapshot, seed = REF_SEED, n = REF_N) {
  const c = refCandidates(snapshot);
  const rng = mulberry32(seed);
  const k = Math.min(n, c.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (c.length - i));
    const t = c[i]; c[i] = c[j]; c[j] = t;
  }
  return {
    schema: 1,
    seed,
    osm_base: snapshot.osm_base,
    centre: { nces_id: '481965001818', lat: NCES_POINT[0], lon: NCES_POINT[1] },
    bounds_m: [MIN_M, MAX_M],
    rule: 'midpoint by length of OSM highway=residential ways, sorted by way id, mulberry32 partial Fisher-Yates',
    n_candidates: c.length,
    n_drawn: k,
    licence: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)',
    points: c.slice(0, k),
  };
}

// Canonical bytes of data/ref/points.json (T16 compares these byte for byte).
function serializeSample(s) {
  const head = Object.assign({}, s); delete head.points;
  const lines = s.points.map((p) => '    ' + JSON.stringify(p));
  const h = JSON.stringify(head, null, 2);
  return h.slice(0, -2) + ',\n  "points": [\n' + lines.join(',\n') + '\n  ]\n}\n';
}

module.exports = { REF_SEED, REF_N, NCES_POINT, MIN_M, MAX_M, mulberry32, inBounds, wayMidpoint, refCandidates, buildSample, serializeSample };
