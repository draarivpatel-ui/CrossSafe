'use strict';
// CrossSafe route-risk scoring (crosssafe-spec.md §a, tests T1-T15 in tests/score.test.js).
// Pure functions, no network, no DOM. Points are [lat, lon]; distances in metres.
// A rules-based screening score, not a crash prediction. Missing data is never read as "safe".
const { haversine, nearestOnLine } = require('./logic.js');

const R_EARTH = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const MI = 1609.344;

// ---- small geometry helpers -------------------------------------------------
function project([lat, lon], lat0) { return [rad(lon) * R_EARTH * Math.cos(rad(lat0)), rad(lat) * R_EARTH]; }
function distToLine(p, geom) {
  if (!geom || !geom.length) return Infinity;
  if (geom.length === 1) return haversine(p, geom[0]);
  let best = Infinity;
  for (let i = 0; i + 1 < geom.length; i++) best = Math.min(best, haversine(p, nearestOnLine(p, geom[i], geom[i + 1]).point));
  return best;
}
// Which side of the polyline (in its drawn direction) p lies on: 'left' | 'right', with the distance.
function sideOf(p, geom) {
  let best = { d: Infinity, side: null };
  for (let i = 0; i + 1 < geom.length; i++) {
    const n = nearestOnLine(p, geom[i], geom[i + 1]);
    const d = haversine(p, n.point);
    if (d < best.d) {
      const lat0 = p[0];
      const [ax, ay] = project(geom[i], lat0), [bx, by] = project(geom[i + 1], lat0), [px, py] = project(p, lat0);
      const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      best = { d, side: cross > 0 ? 'left' : cross < 0 ? 'right' : null };
    }
  }
  return best;
}
// Segment intersection in a local projection; returns the [lat, lon] point or null.
function segIntersect(a, b, c, d) {
  const lat0 = (a[0] + b[0] + c[0] + d[0]) / 4;
  const [x1, y1] = project(a, lat0), [x2, y2] = project(b, lat0), [x3, y3] = project(c, lat0), [x4, y4] = project(d, lat0);
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (den === 0) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

// ---- tag tables (crosssafe-spec §a "Weights and why") ----------------------
const ROAD = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
const baseClass = (h) => (h || '').replace(/_link$/, ''); // test-spec K3: *_link takes its parent class
const isRoad = (t) => !!t && ROAD.has(baseClass(t.highway));
const C_CLASS = { residential: 0.3, living_street: 0.3, service: 0.3, unclassified: 0.4, tertiary: 0.6, secondary: 0.8, primary: 1.0, trunk: 1.2 };
// Tefft 2011 death-risk ratio vs 35 mph, linearly interpolated between the spec's points.
const V_PTS = [[23, 0.31], [25, 0.41], [30, 0.67], [35, 1.0], [40, 1.38], [45, 1.83], [50, 2.31], [55, 2.6]];
function vFromMph(mph) {
  if (mph <= V_PTS[0][0]) return V_PTS[0][1];
  for (let i = 0; i + 1 < V_PTS.length; i++) {
    const [m0, v0] = V_PTS[i], [m1, v1] = V_PTS[i + 1];
    if (mph <= m1) return Math.round((v0 + ((mph - m0) / (m1 - m0)) * (v1 - v0)) * 100) / 100;
  }
  return V_PTS[V_PTS.length - 1][1]; // [DESIGN] above 55 mph: held at the 55 mph value (spec gives no higher point)
}
function parseMph(v) {
  if (!v) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?\s*$/i.exec(String(v));
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] && /mph/i.test(m[2]) ? n : Math.round((n / 1.609344) * 10) / 10; // bare numbers are km/h in OSM
}
// Per-snapshot lookup index (P3 perf, Fri Oct 16, 2026 sub-w180). Pure caching: every lookup returns exactly what the
// plain scans returned (same elements, same order); bounding boxes only skip ways that cannot be within the radius.
// Rebuilt if the snapshot's elements array is replaced or changes length.
const IDX = new WeakMap();
function idx(snap) {
  const els = snap.elements || [];
  let c = IDX.get(snap);
  if (c && c.els === els && c.n === els.length) return c;
  const ways = els.filter((e) => e.type === 'way' && e.tags);
  const wayMap = new Map(), nodeMap = new Map(), nodeRoads = new Map(), box = new Map();
  for (const e of els) {
    if (e.type === 'way' && !wayMap.has(e.id)) wayMap.set(e.id, e);
    if (e.type === 'node' && !nodeMap.has(e.id)) nodeMap.set(e.id, e);
  }
  for (const w of ways) {
    let s = Infinity, n = -Infinity, we = Infinity, ea = -Infinity;
    for (const [la, lo] of w.geometry || []) { if (la < s) s = la; if (la > n) n = la; if (lo < we) we = lo; if (lo > ea) ea = lo; }
    box.set(w, { s, n, w: we, e: ea });
    if (!isRoad(w.tags)) continue;
    for (const id of new Set(w.nodes || [])) { if (!nodeRoads.has(id)) nodeRoads.set(id, []); nodeRoads.get(id).push(w); }
  }
  const roads = ways.filter((w) => isRoad(w.tags));
  // grid of road ways by bounding box (cells of GRID degrees), so radius lookups visit only nearby roads
  const grid = new Map(), order = new Map();
  roads.forEach((w, i) => {
    order.set(w, i);
    const b = box.get(w);
    if (!b || b.s === Infinity) { (grid.get('all') || grid.set('all', []).get('all')).push(w); return; }
    for (let x = Math.floor(b.s / GRID); x <= Math.floor(b.n / GRID); x++) for (let y = Math.floor(b.w / GRID); y <= Math.floor(b.e / GRID); y++) {
      const k = x + ',' + y; (grid.get(k) || grid.set(k, []).get(k)).push(w);
    }
  });
  c = { els, n: els.length, ways, roads, grid, order, wayMap, nodeMap, nodeRoads, box, tagNodes: els.filter((e) => e.type === 'node' && e.tags), zone: new Map() };
  IDX.set(snap, c);
  return c;
}
// true when p is certainly more than r metres from every point of way w (conservative: 110 km per degree + 5 m)
function farFrom(snap, w, p, r) {
  const b = idx(snap).box.get(w);
  if (!b || b.s === Infinity) return false;
  const dLat = (r + 5) / 110000, dLon = (r + 5) / (110000 * Math.cos(rad(p[0])));
  return p[0] < b.s - dLat || p[0] > b.n + dLat || p[1] < b.w - dLon || p[1] > b.e + dLon;
}
const ways = (snap) => idx(snap).ways;
const roadWays = (snap) => idx(snap).roads; // = ways(snap).filter(isRoad), same order
const GRID = 0.002; // degrees (~200 m)
// Road ways whose box may be within r metres of p, in the same order as roadWays(snap) (a superset of the hits).
function roadsNear(snap, p, r) {
  const c = idx(snap);
  const dLat = (r + 5) / 110000, dLon = (r + 5) / (110000 * Math.cos(rad(p[0])));
  const seen = new Set(c.grid.get('all') || []);
  for (let x = Math.floor((p[0] - dLat) / GRID); x <= Math.floor((p[0] + dLat) / GRID); x++)
    for (let y = Math.floor((p[1] - dLon) / GRID); y <= Math.floor((p[1] + dLon) / GRID); y++)
      for (const w of c.grid.get(x + ',' + y) || []) seen.add(w);
  return [...seen].sort((a, b) => c.order.get(a) - c.order.get(b));
}
const wayById = (snap, id) => idx(snap).wayMap.get(id);
const nodeById = (snap, id) => idx(snap).nodeMap.get(id);

// Most common tagged value of `key` among ways of this class in the snapshot (ties -> the higher value,
// so an assumed default never reads as the safer choice). null when no way of that class is tagged.
function zoneMode(snap, cls, key, parse) {
  const memo = idx(snap).zone, mk = `${cls}\u0000${key}\u0000${parse.name}`;
  if (memo.has(mk)) return memo.get(mk);
  const counts = new Map();
  for (const w of ways(snap)) {
    if (baseClass(w.tags.highway) !== cls) continue;
    const v = parse(w.tags[key]);
    if (v == null) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null, bc = 0;
  for (const [v, c] of counts) if (c > bc || (c === bc && v > best)) { best = v; bc = c; }
  memo.set(mk, best);
  return best;
}
function modeSpeed(snap, cls) { return zoneMode(snap, baseClass(cls), 'maxspeed', parseMph); }
const parseLanes = (v) => (v != null && /^\d+$/.test(String(v).trim()) ? Number(v) : null);

function speedFor(snap, tags, flags) {
  const own = parseMph(tags.maxspeed);
  if (own != null) return own;
  flags.push('speed assumed');
  const m = modeSpeed(snap, tags.highway);
  if (m != null) return m;
  flags.push('speed unknown'); // [DESIGN] no tagged way of this class in the zone: 35 mph reference (V = 1.0)
  return 35;
}
function lanesFor(snap, tags, flags) {
  const own = parseLanes(tags.lanes);
  if (own != null) return own;
  flags.push('lanes assumed');
  return zoneMode(snap, baseClass(tags.highway), 'lanes', parseLanes) || 2; // [DESIGN] 2 when the class has no tagged lanes
}
const nFromLanes = (lanes) => Math.min(3, Math.max(0.5, lanes / 2));

// ---- history (H_hin, H_cris, M) ---------------------------------------------
const TIER = (t) => (/top\s*5%/i.test(t || '') ? 3 : /top\s*10%/i.test(t || '') ? 2 : /top\s*(15|20)%/i.test(t || '') ? 1 : 0);
// `hin` = the HIN segments already found within 25 m of the piece (the caller does the spatial match).
function hinWeight(hin, mode, flags) {
  if (!Array.isArray(hin) || hin.length === 0) { flags.push('HIN coverage unknown'); return 0; }
  const key = mode === 'bike' ? 'tier_bike' : 'tier_ped';
  return Math.max(0, ...hin.map((s) => TIER(s[key])));
}
const KABCO = { K: 5, A: 5, B: 2, C: 1, O: 0.5 };
function historyWeight(point, crashes, radius_m = 50) {
  const near = (crashes || []).filter((c) => haversine(point, [c.lat, c.lon]) <= radius_m);
  const sum = near.reduce((s, c) => s + (KABCO[c.sev] || 0), 0);
  const H_cris = sum >= 5 ? 3 : sum >= 2 ? 2 : sum >= 0.5 ? 1 : 0;
  return { H_cris, sum, ids: near.map((c) => c.id) };
}
const mult = (H) => 1 + 0.25 * H;

// ---- traffic (T) --------------------------------------------------------------
// Route key: 'US Highway 90A' / 'US 90 Alt' / 'US 90 Alternate' / 'US 90A' -> 'US90A'.
function routeKey(s) {
  if (!s) return null;
  const u = String(s).toUpperCase().replace(/\b(EB|WB|NB|SB)\b.*$/, '').replace(/SERVICE ROAD|FRONTAGE( ROAD)?/g, '')
    .replace(/HIGHWAY|HWY/g, '').replace(/ALTERNATE|ALT\b/g, 'A').replace(/[^A-Z0-9]/g, '');
  return u || null;
}
const tBand = (aadt) => (aadt < 9000 ? 1.0 : aadt <= 15000 ? 1.3 : 1.6);
// `aadt` = stations already within 200 m. Matched by road (route key from ref or name), and main lanes vs
// service road by class: trunk/motorway = main lanes, any other class carrying the route = frontage/service road.
function crossingWeightByRoad(tags, aadt) {
  const keys = new Set([tags.ref, tags.name].flatMap((v) => String(v || '').split(';')).map(routeKey).filter(Boolean));
  const frontage = !['trunk', 'motorway'].includes(baseClass(tags.highway));
  const m = (aadt || []).filter((s) => keys.has(routeKey(s.road)) && /service road|frontage/i.test(s.road) === frontage);
  if (!m.length) return { station: null, aadt: null, T: 1.3, flags: ['traffic count unknown'] };
  // [DESIGN] several stations of the same kind (e.g. EB and WB service roads): the higher band, flagged.
  const pick = m.reduce((a, b) => (tBand(b.aadt) > tBand(a.aadt) ? b : a));
  return { station: pick.station, aadt: pick.aadt, year: pick.year, T: tBand(pick.aadt), flags: m.length > 1 ? ['traffic station ambiguous'] : [] };
}

// ---- crossing control (Q), with the Oct 14 §a order fix (test-spec O18/O20) ------
const SIGNAL_R = 15, CROSSING_R = 30;
function controlQ(snap, point, crossingNode) {
  const nodes = idx(snap).tagNodes;
  const near = (r, f) => nodes.filter((n) => f(n.tags) && haversine(point, [n.lat, n.lon]) <= r);
  const c = crossingNode ? [crossingNode] : near(CROSSING_R, (t) => t.highway === 'crossing' || t.footway === 'crossing');
  const flags = [];
  const t = (c[0] && c[0].tags) || {};
  // [DESIGN] a car signal alone is not a mapped pedestrian crossing (T10): no crossing node within 30 m -> 1.0
  // even next to a highway=traffic_signals node; the "signal node within 15 m" clause upgrades a crossing node.
  if (!c.length) return { Q: 1.0, cmf: 1, node: null, flags: ['no mapped crossing'], control: 'no mapped crossing' };
  if (t.crossing === 'traffic_signals' || near(SIGNAL_R, (x) => x.highway === 'traffic_signals').length) return { Q: 0.3, cmf: 1, node: c[0], flags, control: 'signalized crossing' };
  const mk = t['crossing:markings'];
  let cmf = 1;
  if (t['crossing:island'] === 'yes') cmf *= 0.68;
  if (t.flashing_lights === 'button') cmf *= 0.53;
  if (mk === 'no' || mk === 'surface') {
    if (['uncontrolled', 'marked', 'zebra'].includes(t.crossing)) flags.push('CROSSING_TAG_CONFLICT');
    if (mk === 'surface') flags.push('MARKINGS_SURFACE_ONLY');
    return { Q: 0.9, cmf, node: c[0], flags, control: 'unmarked crossing' };
  }
  if (['marked', 'uncontrolled', 'zebra'].includes(t.crossing) || (mk && mk !== 'no')) return { Q: 0.7, cmf, node: c[0], flags, control: 'marked crossing, no signal' };
  return { Q: 0.9, cmf, node: c[0], flags, control: 'unmarked crossing' };
}

function crossStreet(snap, point, name) {
  let best = null, bd = 30;
  for (const w of roadsNear(snap, point, bd)) {
    if (!w.tags.name || w.tags.name === name || farFrom(snap, w, point, bd)) continue;
    const d = distToLine(point, w.geometry);
    if (d < bd) { bd = d; best = w.tags.name; }
  }
  return best;
}

// Ways the crossing point sits on (node id in way.nodes, else a road within 2 m of the point).
function roadsAt(snap, nodeId, point) {
  const on = (idx(snap).nodeRoads.get(nodeId) || []).slice();
  if (on.length) return on;
  let best = null, bd = 2;
  for (const w of roadsNear(snap, point, bd)) { if (farFrom(snap, w, point, bd)) continue; const d = distToLine(point, w.geometry); if (d < bd) { bd = d; best = w; } }
  return best ? [best] : [];
}
// Divided road: the opposite oneway carriageway with the same name within 40 m adds its lanes.
function carriagewayLanes(snap, way, point, flags) {
  let lanes = lanesFor(snap, way.tags, flags);
  if (way.tags.oneway === 'yes' && way.tags.name) {
    let other = null, od = 40;
    for (const w of roadsNear(snap, point, od)) {
      if (w.id === way.id || w.tags.name !== way.tags.name || w.tags.oneway !== 'yes' || farFrom(snap, w, point, od)) continue;
      const d = distToLine(point, w.geometry);
      if (d > 1 && d < od) { od = d; other = w; } // > 1 m: a consecutive segment of the same carriageway is not the other side
    }
    if (other) lanes += lanesFor(snap, other.tags, flags);
  }
  return lanes;
}

function scorePoint(snap, way, point, crossingNode, opts = {}) {
  const flags = [];
  const q = controlQ(snap, point, crossingNode);
  flags.push(...q.flags);
  const lanes = carriagewayLanes(snap, way, point, flags);
  const N = nFromLanes(lanes);
  const tw = crossingWeightByRoad(way.tags, opts.aadt || []);
  flags.push(...tw.flags);
  const mph = speedFor(snap, way.tags, flags);
  const V = vFromMph(mph);
  const H_hin = hinWeight(opts.hin, opts.mode, flags);
  const H_cris = historyWeight(point, opts.crashes || []).H_cris;
  const H = Math.max(H_hin, H_cris);
  const M = mult(H);
  const Qe = q.Q === 0.3 ? q.Q : Math.round(q.Q * q.cmf * 1000) / 1000; // CMFs apply to uncontrolled crossings only
  const K = Math.round(Qe * N * tw.T * V * M * 1000) / 1000;
  const name = way.tags.name || way.tags.ref || `way ${way.id}`;
  const other = crossStreet(snap, point, way.tags.name);
  const where = other ? `${name} at ${other}` : name;
  const what = q.Q === 1.0 ? 'mapped data shows no crossing within 30 m' : `${q.control}${q.node ? ` (OSM node ${q.node.id})` : ''}`;
  const text = `${where}: ${what}. ${flags.length ? 'Flags: ' + [...new Set(flags)].join('; ') + '.' : ''}`.trim();
  return { way: way.id, node: q.node ? q.node.id : null, Q: q.Q, cmf: q.cmf, N, lanes_total: lanes, T: tw.T, station: tw.station, speed_mph: mph, V, H_hin, H_cris, M, K, flags: [...new Set(flags)], text };
}

function scoreCrossing(snap, nodeId, opts = {}) {
  const node = nodeById(snap, nodeId);
  if (!node) throw new Error(`node ${nodeId} not in snapshot`);
  const p = [node.lat, node.lon];
  const roads = roadsAt(snap, nodeId, p);
  if (!roads.length) throw new Error(`no road found at crossing node ${nodeId}`);
  return scorePoint(snap, roads[0], p, node, opts);
}
function scoreAtGrade(snap, wayId, point, opts = {}) {
  const way = wayById(snap, wayId);
  if (!way) throw new Error(`way ${wayId} not in snapshot`);
  return scorePoint(snap, way, point, null, opts);
}

// ---- stretches (G, C, V, M) -----------------------------------------------------
const SIDEWALK_R = 15;
const KNOWN = new Set(['both', 'left', 'right', 'no', 'none', 'yes', 'separate', 'lane', 'shared']);
function sidewalkTag(tags, side) {
  const raw = tags[`sidewalk:${side}`] ?? tags['sidewalk:both'];
  if (raw != null) return { key: tags[`sidewalk:${side}`] != null ? `sidewalk:${side}` : 'sidewalk:both', v: raw };
  if (tags.sidewalk != null) {
    const v = tags.sidewalk;
    if (v === 'both' || v === side) return { key: 'sidewalk', v: 'yes' };
    if ((v === 'left' || v === 'right') && v !== side) return { key: 'sidewalk', v: 'no' };
    return { key: 'sidewalk', v, plain: true };
  }
  return null;
}
function sidewalkWayOnSide(snap, road, side) {
  const rb = idx(snap).box.get(road);
  const pad = (SIDEWALK_R + 5) / 110000, padLon = rb ? pad / Math.cos(rad((rb.s + rb.n) / 2)) * 1.01 : 0;
  for (const w of ways(snap)) {
    if (w.tags.footway !== 'sidewalk' || w.id === road.id) continue;
    const b = idx(snap).box.get(w);
    // skip a sidewalk whose box is more than 15 m (+ margin) from the road's box: none of its points can be within 15 m
    if (rb && b && rb.s !== Infinity && b.s !== Infinity && (b.n < rb.s - pad || b.s > rb.n + pad || b.e < rb.w - padLon || b.w > rb.e + padLon)) continue;
    for (const p of w.geometry || []) {
      const s = sideOf(p, road.geometry);
      if (s.d <= SIDEWALK_R && s.side === side) return w.id;
    }
  }
  return null;
}
function sidewalkG(snap, road, side) {
  const tag = sidewalkTag(road.tags, side);
  let v = tag && String(tag.v).trim();
  if (v === 'seperate') v = 'separate'; // O15 typo
  if (v === 'no' || v === 'none') return { G: 1.0, unknown: false, flags: [], finding: `No sidewalk mapped (OSM tag \`${tag.key}=${tag.v}\`)` };
  if (v === 'shared') return { G: 1.0, unknown: false, flags: ['SIDEWALK_SHARED_AS_NO'], finding: `Sidewalk tagged \`${tag.key}=shared\`, scored as none` };
  if (v === 'yes' || v === 'both' || v === 'left' || v === 'right') return { G: 0.1, unknown: false, flags: [], finding: `Sidewalk mapped on this side (\`${tag.key}\`)` };
  if (v === 'lane') return { G: 0.6, unknown: false, flags: ['SIDEWALK_LANE_ONLY'], finding: 'Walking lane on the roadway, not a separated sidewalk' };
  const found = sidewalkWayOnSide(snap, road, side);
  if (found) return { G: 0.1, unknown: false, flags: [], finding: `Sidewalk mapped as a separate way (OSM way ${found})` };
  if (v === 'separate' && tag.plain) return { G: 0.6, unknown: true, flags: ['SIDEWALK_SIDE_UNKNOWN'], finding: 'Sidewalk side not stated in the map (unknown)' };
  if (v === 'separate') return { G: 0.6, unknown: true, flags: ['SIDEWALK_SEPARATE_NOT_FOUND'], finding: 'Sidewalk mapped as separate, not found within 15 m (unknown)' };
  if (tag && !KNOWN.has(v)) return { G: 0.6, unknown: true, flags: ['SIDEWALK_VALUE_UNRECOGNISED'], raw: String(tag.v).slice(0, 40), finding: 'Sidewalk tag value not recognised (unknown)' };
  return { G: 0.6, unknown: true, flags: ['SIDEWALK_UNMAPPED'], finding: 'Sidewalk not mapped (unknown)' };
}
function scoreStretch(snap, wayId, opts = {}) {
  const road = wayById(snap, wayId);
  if (!road) throw new Error(`way ${wayId} not in snapshot`);
  const side = opts.side === 'left' ? 'left' : 'right';
  const flags = [];
  const g = sidewalkG(snap, road, side);
  flags.push(...g.flags);
  const cls = baseClass(road.tags.highway);
  if (cls === 'motorway') flags.push('ROUTE_ON_MOTORWAY');
  const C = C_CLASS[cls] ?? null;
  const mph = speedFor(snap, road.tags, flags);
  const V = vFromMph(mph);
  const H_hin = hinWeight(opts.hin, opts.mode, flags);
  const mid = road.geometry[Math.floor(road.geometry.length / 2)];
  const H_cris = historyWeight(mid, opts.crashes || []).H_cris;
  const M = mult(Math.max(H_hin, H_cris));
  const L = opts.length_m ?? null;
  const A = C == null ? null : Math.round(((L ?? 100) / 100) * g.G * C * V * M * 1000) / 1000;
  return { way: road.id, side, G: g.G, C, speed_mph: mph, V, H_hin, H_cris, M, A, length_m: L, unknown: g.unknown, flags: [...new Set(flags)], finding: g.finding };
}

// ---- crossing events along a route (T9, T11) ------------------------------------
const atGrade = (t) => !t.bridge || t.bridge === 'no' ? (!t.tunnel || t.tunnel === 'no') && (t.layer == null || String(t.layer) === '0') : false;
function crossingEvents(snap, route, opts = {}) {
  const hits = [];
  let rs = Infinity, rn = -Infinity, rw = Infinity, re = -Infinity;
  for (const [la, lo] of route) { if (la < rs) rs = la; if (la > rn) rn = la; if (lo < rw) rw = lo; if (lo > re) re = lo; }
  for (const w of roadWays(snap)) {
    if (!atGrade(w.tags)) continue;
    const b = idx(snap).box.get(w); // segments can only intersect if the boxes overlap
    if (b && b.s !== Infinity && (b.n < rs || b.s > rn || b.e < rw || b.w > re)) continue;
    const g = w.geometry || [];
    for (let i = 0; i + 1 < route.length; i++) for (let j = 0; j + 1 < g.length; j++) {
      const p = segIntersect(route[i], route[i + 1], g[j], g[j + 1]);
      if (p) hits.push({ way: w, at: p });
    }
  }
  // the same carriageway split into consecutive ways meets the route at one point: keep one
  const uniq = [];
  for (const h of hits) if (!uniq.some((u) => u.way.tags.name === h.way.tags.name && haversine(u.at, h.at) <= 1)) uniq.push(h);
  const used = new Set(), events = [];
  for (let i = 0; i < uniq.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const grp = [uniq[i]];
    const a = uniq[i].way.tags;
    if (a.oneway === 'yes' && a.name) for (let j = i + 1; j < uniq.length; j++) {
      const b = uniq[j].way.tags;
      if (!used.has(j) && b.oneway === 'yes' && b.name === a.name && haversine(uniq[i].at, uniq[j].at) <= 40) { grp.push(uniq[j]); used.add(j); }
    }
    const flags = [];
    const lanes_total = grp.reduce((s, h) => s + lanesFor(snap, h.way.tags, flags), 0);
    events.push({ name: a.name || a.ref || null, way: grp[0].way.id, ways: grp.map((h) => h.way.id), at: grp[0].at, lanes_total, N: nFromLanes(lanes_total), divided: grp.length > 1, flags: [...new Set(flags)] });
  }
  return events;
}

// ---- every crossing in the snapshot (P3 perf input; the map view scores all of them) ------
// One result per node tagged highway=crossing, in snapshot order: the scorePoint result, or { node, error } when the
// node sits on no road way (e.g. a crossing mapped on a footway only), so nothing is dropped silently.
function scoreAllCrossings(snap, opts = {}) {
  const out = [];
  for (const n of idx(snap).tagNodes) {
    if (n.tags.highway !== 'crossing') continue;
    try { out.push(scoreCrossing(snap, n.id, opts)); } catch (e) { out.push({ node: n.id, error: e.message }); }
  }
  return out;
}

// ---- walk zone (T13) ------------------------------------------------------------
function inZone(school, point) {
  const r = school.radius_m || 2 * MI;
  const d = haversine([school.lat, school.lon], point);
  return d <= r ? { in: true, distance_m: d } : { in: false, distance_m: d, reason: `outside walk zone (${(d / MI).toFixed(1)} mi)` };
}

module.exports = {
  scoreCrossing, scoreAllCrossings, scoreStretch, scoreAtGrade, crossingEvents, crossingWeightByRoad, modeSpeed, inZone, historyWeight,
  vFromMph, parseMph, routeKey,
};
