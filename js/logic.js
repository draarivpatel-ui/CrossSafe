'use strict';
// CrossSafe pure logic (kickoff-runbook 4:00 row, Test plan A1-A12). No network, no DOM.
// Points are [lat, lon] arrays unless noted; distances in metres.
const R_EARTH = 6371008.8; // mean Earth radius (IUGG), metres
const rad = (d) => (d * Math.PI) / 180;

function haversine([la1, lo1], [la2, lo2]) {
  const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Local equirectangular projection around a reference latitude (accurate to well under 1 m at < 5 km).
function project([lat, lon], lat0) {
  return [rad(lon) * R_EARTH * Math.cos(rad(lat0)), rad(lat) * R_EARTH];
}

// Closest point on segment a-b to p, as { t, point:[lat,lon] }.
function nearestOnLine(p, a, b) {
  const lat0 = (a[0] + b[0] + p[0]) / 3;
  const [px, py] = project(p, lat0), [ax, ay] = project(a, lat0), [bx, by] = project(b, lat0);
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return { t, point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] };
}

function pointToSegment(p, a, b) {
  return haversine(p, nearestOnLine(p, a, b).point);
}

function pointToLine(p, geom) {
  if (geom.length === 1) return haversine(p, geom[0]);
  let best = Infinity;
  for (let i = 0; i + 1 < geom.length; i++) best = Math.min(best, pointToSegment(p, geom[i], geom[i + 1]));
  return best;
}

// Bounding box reaching radius_m from the school in each cardinal direction.
function walkZone(school, radius_m) {
  const dLat = (radius_m / R_EARTH) * (180 / Math.PI);
  const dLon = dLat / Math.cos(rad(school.lat));
  return { south: school.lat - dLat, north: school.lat + dLat, west: school.lon - dLon, east: school.lon + dLon };
}

const pts = (g) => (g || []).map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.lat, p.lon]));
const ways = (snap) => (snap.elements || []).filter((e) => e.type === 'way');
const isSidewalkWay = (w) => {
  const t = w.tags || {};
  return t.footway === 'sidewalk' || (t.highway === 'footway' && t.footway === 'sidewalk');
};
const isRoad = (w) => {
  const t = w.tags || {};
  return !!t.highway && !['footway', 'path', 'cycleway', 'pedestrian', 'steps', 'crossing'].includes(t.highway);
};

const SIDEWALK_NEAR_M = 15;
const CROSSING_NEAR_M = 30;

// Sidewalk status of one road way: 'no' | 'yes' | 'separate' (separate way found) | 'unknown'.
function sidewalkStatus(roadWay, snap) {
  const t = roadWay.tags || {};
  const v = t.sidewalk || t['sidewalk:both'];
  if (v === 'no' || v === 'none') return 'no';
  if (v && ['both', 'left', 'right', 'yes'].includes(v)) return 'yes';
  const geom = pts(roadWay.geometry);
  const near = ways(snap).some((w) => isSidewalkWay(w) && pts(w.geometry).some((q) => pointToLine(q, geom) <= SIDEWALK_NEAR_M));
  if (near) return 'separate';
  return 'unknown';
}

// Route segments with no sidewalk way within 15 m of both ends (and not a road tagged sidewalk=both/left/right/yes).
function routeGaps(route, snap) {
  const sidewalks = ways(snap).filter(isSidewalkWay).map((w) => pts(w.geometry));
  const tagged = ways(snap).filter((w) => isRoad(w) && ['both', 'left', 'right', 'yes'].includes((w.tags || {}).sidewalk)).map((w) => pts(w.geometry));
  const covered = (p) => sidewalks.some((g) => pointToLine(p, g) <= SIDEWALK_NEAR_M) || tagged.some((g) => pointToLine(p, g) <= SIDEWALK_NEAR_M);
  const gaps = [];
  let cur = null;
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i], b = route[i + 1];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ok = covered(a) && covered(b) && covered(mid);
    const len = haversine(a, b);
    if (ok) { cur = null; continue; }
    if (!cur) { cur = { from: a, to: b, length_m: 0 }; gaps.push(cur); }
    cur.to = b; cur.length_m += len;
  }
  return gaps;
}

// Segment-segment intersection in local metres; returns [lat,lon] or null.
function intersect(a, b, c, d) {
  const lat0 = (a[0] + b[0] + c[0] + d[0]) / 4;
  const [ax, ay] = project(a, lat0), [bx, by] = project(b, lat0), [cx, cy] = project(c, lat0), [dx, dy] = project(d, lat0);
  const r1x = bx - ax, r1y = by - ay, r2x = dx - cx, r2y = dy - cy;
  const den = r1x * r2y - r1y * r2x;
  if (den === 0) return null;
  const t = ((cx - ax) * r2y - (cy - ay) * r2x) / den;
  const u = ((cx - ax) * r1y - (cy - ay) * r1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

const isMarked = (tags) => {
  const c = tags.crossing, m = tags['crossing:markings'];
  if (m === 'no' || c === 'unmarked') return false;
  return true;
};

// Every place the route crosses a road way: { way_id, point, covered, marked, finding? }.
function crossingCoverage(route, snap) {
  const nodes = (snap.elements || []).filter((e) => e.type === 'node' && (e.tags || {}).highway === 'crossing');
  const out = [];
  for (const w of ways(snap).filter(isRoad)) {
    const g = pts(w.geometry);
    for (let i = 0; i + 1 < route.length; i++) {
      for (let j = 0; j + 1 < g.length; j++) {
        const x = intersect(route[i], route[i + 1], g[j], g[j + 1]);
        if (!x) continue;
        let best = null, bestD = Infinity;
        for (const n of nodes) {
          const dd = haversine(x, [n.lat, n.lon]);
          if (dd <= CROSSING_NEAR_M && dd < bestD) { best = n; bestD = dd; }
        }
        out.push(best
          ? { way_id: w.id, point: x, covered: true, marked: isMarked(best.tags), node_id: best.id }
          : { way_id: w.id, point: x, covered: false, marked: false, finding: 'unmarked crossing' });
      }
    }
  }
  return out;
}

const AADT_NEAR_M = 200;
// [DESIGN] weight grows with the log of the nearest AADT within 200 m (log10(aadt)/5, so 100,000/day = 1.0).
function crossingWeight(point, aadtPoints) {
  let best = null, bestD = Infinity;
  for (const a of aadtPoints || []) {
    const dd = haversine(point, [a.lat, a.lon]);
    if (dd <= AADT_NEAR_M && dd < bestD) { best = a; bestD = dd; }
  }
  if (!best || !(best.aadt > 0)) return { weight: null, reason: 'traffic count unknown' };
  return { weight: Math.log10(best.aadt) / 5, aadt: best.aadt, distance_m: bestD };
}

// [DESIGN] share of walked metres with a sidewalk, x100, rounded; empty zone has no score.
function gapScore({ walk_m, gap_m }) {
  if (!(walk_m > 0)) return { score: null, reason: 'no walking route in the zone, so there is nothing to score' };
  const g = Math.max(0, Math.min(walk_m, gap_m || 0));
  return { score: Math.round((100 * (walk_m - g)) / walk_m) };
}

function letter({ school, findings, sources, observations }) {
  const files = (sources && sources.files) || {};
  const raw = (sources && sources.raw) || {};
  const osmBase = (files['data/osm-dulles.json'] || {}).osm_base;
  const lines = [];
  lines.push(`Re: walking and biking safety near ${school}`);
  lines.push('');
  lines.push(`This note lists places near ${school} where the public map data shows a missing sidewalk or a crossing without markings.`);
  lines.push('');
  for (const f of findings || []) lines.push(`- ${f.text}: ${f.location}`);
  lines.push('');
  const dates = [];
  if (osmBase) dates.push(`OpenStreetMap data as of ${osmBase}`);
  if (raw.aadt && raw.aadt.data_as_of) dates.push(`TxDOT traffic counts (AADT) for ${raw.aadt.data_as_of}`);
  if (dates.length) lines.push(`Data used: ${dates.join('; ')}.`);
  for (const [k, v] of Object.entries(raw)) {
    if (v && v.status === 'not_included') lines.push(`${k.toUpperCase().startsWith('CRIS') ? 'TxDOT CRIS crash records for 2025-2026' : k}: not included.`);
  }
  if (Array.isArray(observations) && observations.length) {
    lines.push('');
    lines.push('Observations from a site visit:');
    for (const o of observations) lines.push(`- ${o}`);
  }
  return lines.join('\n');
}

module.exports = {
  haversine, nearestOnLine, pointToSegment, walkZone, routeGaps, crossingCoverage, sidewalkStatus,
  crossingWeight, gapScore, letter,
};
