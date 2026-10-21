'use strict';
// Route-level risk (crosssafe-spec §a "Route": Raw = Σ Aₛ + Σ K_c, RRI = Raw / route_km), built on js/score.js.
// Pure: no network, no DOM, no clock, no randomness. Points are [lat, lon]; distances in metres.
// Inputs are the committed files only: the OSM snapshot's tags. Per-point TxDOT AADT, CRIS crash rows and HIN
// segments are not redistributed in this repo (README "Data and licences"), so callers that pass none get
// T = 1.3 "traffic count unknown" and H_hin = 0 "HIN coverage unknown" (M = 1), exactly as js/score.js defines.
const { haversine, nearestOnLine } = require('./logic.js');
const S = require('./score.js');

const STRETCH_R = 20; // spec §a: a stretch is a run of the route within 20 m of, and parallel to, road way r
const PIECE_M = 10; // [DESIGN] the route is cut into pieces of at most 10 m; each piece is matched on its midpoint
const PARALLEL_DEG = 30; // [DESIGN] "parallel" = bearings within 30° (either direction)
const SIDE_PROBE_M = 15; // [DESIGN] a crossing counts only if the route is on opposite sides of the road 15 m before and after
const SIDE_MIN_M = 2; // [DESIGN] ... and at least 2 m off the road centreline at both probes (touching/along is not crossing)
const UNKNOWN_CROSSING_M = 50; // spec §a Unknown(R): each crossing with an assumed/unknown factor counts as 50 m

const ROAD = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
const isRoadTags = (t) => !!t && ROAD.has(String(t.highway || '').replace(/_link$/, ''));
const rad = (d) => (d * Math.PI) / 180;

// OSRM GeoJSON [lon, lat] -> [lat, lon]
const fromGeoJSON = (coords) => (coords || []).map((c) => [c[1], c[0]]);

function lengthM(route) {
  const c = cumulative(route);
  return c[c.length - 1];
}
function bearing(a, b) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (Math.atan2(y, x) * 180) / Math.PI;
}
const parallel = (b1, b2) => { let d = Math.abs(b1 - b2) % 180; if (d > 90) d = 180 - d; return d <= PARALLEL_DEG; };

// Point at distance s (metres) along the route, clamped to its ends.
function pointAt(route, cum, s) {
  if (s <= 0) return route[0];
  if (s >= cum[cum.length - 1]) return route[route.length - 1];
  const i = cum.findIndex((c) => c >= s);
  const a = route[i - 1], b = route[i], c0 = cum[i - 1], seg = cum[i] - c0;
  const f = seg === 0 ? 0 : (s - c0) / seg;
  return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
}
function cumulative(route) {
  const cum = [0];
  for (let i = 0; i + 1 < route.length; i++) cum.push(cum[i] + haversine(route[i], route[i + 1]));
  return cum;
}
// Distance along the route of point p (nearest position on the polyline).
function along(route, cum, p) {
  let best = { d: Infinity, s: 0 };
  for (let i = 0; i + 1 < route.length; i++) {
    const n = nearestOnLine(p, route[i], route[i + 1]);
    const d = haversine(p, n.point);
    if (d < best.d) best = { d, s: cum[i] + haversine(route[i], n.point) };
  }
  return best.s;
}
// Nearest point of a polyline to p, with the bearing of that segment and the signed side of p.
function nearestSeg(p, geom) {
  let best = null;
  for (let i = 0; i + 1 < geom.length; i++) {
    const n = nearestOnLine(p, geom[i], geom[i + 1]);
    const d = haversine(p, n.point);
    if (!best || d < best.d) best = { d, i };
  }
  if (!best) return null;
  const a = geom[best.i], b = geom[best.i + 1];
  const lat0 = p[0];
  const k = Math.cos(rad(lat0));
  const cross = (b[1] - a[1]) * k * (p[0] - a[0]) - (b[0] - a[0]) * (p[1] - a[1]) * k;
  return { d: best.d, bearing: bearing(a, b), side: cross > 0 ? 'left' : cross < 0 ? 'right' : null };
}

function bboxOf(route, padDeg) {
  let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
  for (const [la, lo] of route) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  return { s: s - padDeg, n: n + padDeg, w: w - padDeg, e: e + padDeg };
}
const touches = (bb, geom) => (geom || []).some(([la, lo]) => la >= bb.s && la <= bb.n && lo >= bb.w && lo <= bb.e);

// Road ways near the route (bbox + ~110 m pad) so stretch matching does not scan the whole snapshot.
function nearbyRoads(snap, route) {
  const bb = bboxOf(route, 0.001);
  return (snap.elements || []).filter((e) => e.type === 'way' && e.tags && isRoadTags(e.tags) && (e.geometry || []).length >= 2 && touches(bb, e.geometry));
}

// Stretches: each ≤10 m piece is assigned to the nearest parallel road way within 20 m (else it is off-road, e.g. a
// park path, and is not a stretch). Pieces are summed per (way, side).
function stretches(snap, route, roads) {
  const cum = cumulative(route);
  const total = cum[cum.length - 1];
  const groups = new Map();
  const PAD = 0.0003; // ~30 m in degrees at this latitude, > STRETCH_R: a bbox prefilter only, the 20 m test decides
  const boxes = roads.map((w) => ({ w, bb: bboxOf(w.geometry, PAD) }));
  for (let i = 0; i + 1 < route.length; i++) {
    const segLen = cum[i + 1] - cum[i];
    if (segLen === 0) continue;
    const b = bearing(route[i], route[i + 1]);
    const k = Math.max(1, Math.ceil(segLen / PIECE_M));
    for (let j = 0; j < k; j++) {
      const f = (j + 0.5) / k;
      const mid = [route[i][0] + f * (route[i + 1][0] - route[i][0]), route[i][1] + f * (route[i + 1][1] - route[i][1])];
      let best = null;
      for (const { w, bb } of boxes) {
        if (mid[0] < bb.s || mid[0] > bb.n || mid[1] < bb.w || mid[1] > bb.e) continue;
        const ns = nearestSeg(mid, w.geometry);
        if (!ns || ns.d > STRETCH_R || !parallel(b, ns.bearing)) continue;
        if (!best || ns.d < best.ns.d) best = { w, ns };
      }
      if (!best) continue;
      // [DESIGN] a piece on the centreline (side null, < 0.5 m) is scored on the right side
      const side = best.ns.d < 0.5 || !best.ns.side ? 'right' : best.ns.side;
      const key = best.w.id + ':' + side;
      // at = midpoint of the first piece matched to this (way, side): the map pin for the stretch (wave 184 [DESIGN])
      const g = groups.get(key) || { way: best.w.id, side, length_m: 0, at: [Math.round(mid[0] * 1e6) / 1e6, Math.round(mid[1] * 1e6) / 1e6] };
      g.length_m += segLen / k;
      groups.set(key, g);
    }
  }
  return { total_m: total, groups: [...groups.values()].sort((a, b) => a.way - b.way || (a.side < b.side ? -1 : 1)) };
}

// Crossings: js/score.js crossingEvents, kept only where the route really goes from one side of that road to the
// other (probes 15 m before/after along the route, both ≥ 2 m off the road, opposite sides).
// [DESIGN] (Fri Oct 16, 2026, wave 181) A road way tagged highway=service (driveways, parking aisles, drive-throughs,
// lot entrances and other access roads, with or without a service=* subtag) is an entrance, not a street crossing:
// it is NOT counted in N, adds no K to Raw, and is returned separately as `entrances` so the count stays visible.
// Stretches along a service road are still scored (spec §a C = 0.3); only the crossing count changes.
const isEntranceTags = (t) => !!t && String(t.highway || '') === 'service';
function crossings(snap, route, roads, entrances = []) {
  const cum = cumulative(route);
  const out = [];
  // Only the road ways near the route can intersect it; their lane counts are recomputed on the full snapshot by
  // scoreAtGrade below, so the sub-snapshot's zone-mode lanes (ev.N) are not used.
  for (const ev of S.crossingEvents({ elements: roads }, route)) {
    const w = (snap.elements || []).find((e) => e.type === 'way' && e.id === ev.way);
    const s = along(route, cum, ev.at);
    const p1 = pointAt(route, cum, s - SIDE_PROBE_M), p2 = pointAt(route, cum, s + SIDE_PROBE_M);
    const a = nearestSeg(p1, w.geometry), b = nearestSeg(p2, w.geometry);
    if (!a || !b || a.d < SIDE_MIN_M || b.d < SIDE_MIN_M || !a.side || !b.side || a.side === b.side) continue;
    if (isEntranceTags(w.tags)) { entrances.push({ way: ev.way, at: ev.at }); continue; }
    out.push(ev);
  }
  return out;
}

const UNKNOWN_FLAG = /unknown|assumed|ambiguous|not found|unrecognised|UNKNOWN|NOT_FOUND|UNRECOGNISED|UNMAPPED/;

// Score one route. opts: { mode: 'walk'|'bike', aadt, hin, crashes } (all optional; see the header).
function scoreRoute(snap, route, opts = {}) {
  const mode = opts.mode === 'bike' ? 'bike' : 'walk';
  const roads = nearbyRoads(snap, route);
  const st = stretches(snap, route, roads);
  const pieces = [];
  let rawA = 0, unknown_m = 0;
  for (const g of st.groups) {
    const r = S.scoreStretch(snap, g.way, { side: g.side, length_m: g.length_m, mode, hin: opts.hin, crashes: opts.crashes });
    const A = r.A == null ? 0 : r.A; // motorway (C = null): no A, flagged ROUTE_ON_MOTORWAY by score.js
    rawA += A;
    if (r.unknown) unknown_m += g.length_m;
    pieces.push({ kind: 'stretch', way: g.way, side: g.side, at: g.at, length_m: Math.round(g.length_m * 10) / 10, G: r.G, C: r.C, V: r.V, M: r.M, A, flags: r.flags, finding: r.finding });
  }
  let rawK = 0, unknown_c = 0;
  const entrances = [];
  for (const ev of crossings(snap, route, roads, entrances)) {
    const r = S.scoreAtGrade(snap, ev.way, ev.at, { mode, aadt: opts.aadt, hin: opts.hin, crashes: opts.crashes });
    rawK += r.K;
    if (r.flags.some((f) => UNKNOWN_FLAG.test(f))) unknown_c += 1;
    pieces.push({ kind: 'crossing', way: ev.way, node: r.node, at: [Math.round(ev.at[0] * 1e6) / 1e6, Math.round(ev.at[1] * 1e6) / 1e6], Q: r.Q, N: r.N, T: r.T, V: r.V, M: r.M, K: r.K, flags: r.flags, text: r.text });
  }
  const route_m = st.total_m;
  const raw = rawA + rawK;
  const rri = route_m > 0 ? raw / (route_m / 1000) : null;
  const unknown_share = route_m > 0 ? Math.min(1, (unknown_m + unknown_c * UNKNOWN_CROSSING_M) / route_m) : null;
  const confidence = unknown_share == null ? null : unknown_share < 0.2 ? 'High' : unknown_share <= 0.4 ? 'Medium' : 'Low';
  return { mode, route_m, raw, rri, stretch_m: st.groups.reduce((s, g) => s + g.length_m, 0), n_stretches: st.groups.length, n_crossings: pieces.filter((p) => p.kind === 'crossing').length, n_entrances: entrances.length, unknown_share, confidence, pieces };
}

module.exports = { scoreRoute, fromGeoJSON, lengthM, isEntranceTags, STRETCH_R, PIECE_M, PARALLEL_DEG, SIDE_PROBE_M, SIDE_MIN_M };
