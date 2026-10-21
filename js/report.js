'use strict';
// Route -> findings report, shared by the Node CLI (scripts/report.js) and the page (js/app.js), so the list a reader
// sees in the browser and the `--json` line CI compares it with come from the same code (browser check B2 count truth).
// Pure: no file system, no network, no DOM, no clock. Moved here unchanged from scripts/report.js on Fri Oct 16, 2026
// (wave 183, bare UI); scripts/report.js now reads the files and calls buildReport().
// [DESIGN] findings = stretches with G >= 0.6 (no sidewalk mapped, or unknown) + crossings with Q >= 0.7 (not signalized),
// sorted by risk points, highest first. N = crossings on the route, k = crossings whose type the map does not state
// (no crossing node within 30 m, or a crossing node with neither `crossing` nor `crossing:markings`). Entrances
// (highway=service ways: driveways, parking aisles, lot entrances) are not crossings (js/route.js [DESIGN]); their
// count is reported as `entrances`. The list is deduplicated per (kind, OSM object): see dedupe() below.
const { routeGaps } = require('./logic.js');
const { scoreRoute, fromGeoJSON } = require('./route.js');
const { score100 } = require('./r50.js');

// The cached demo routes the page offers (one select#route option each), in the CLI's order (sorted file stems).
// tests/ui.test.js fails if this list and the -walk/-bike files in data/routes/ ever differ.
const ROUTE_IDS = [
  'corporate-drive-dairy-ashford-road-bike',
  'corporate-drive-dairy-ashford-road-walk',
  'greenbriar-drive-south-kirkwood-road-bike',
  'greenbriar-drive-south-kirkwood-road-walk',
  'lost-creek-park-bike',
  'lost-creek-park-walk',
];

// [DESIGN] (Fri Oct 16, 2026, wave 181) One finding per (kind, OSM object) per route, so the list a reader sees (and
// test-spec L1's letter id-set) has no duplicates. fid = `<kind>:<osm_id>` is unique in `list`.
//  - stretch: the route can run along both sides of one road (or along it twice); the pieces merge into one finding
//    for that way: side 'left' | 'right' | 'both', length_m and points summed, flags unioned, text from the
//    highest-points piece.
//  - crossing: two crossing events on the same OSM object (the same crossing node, or the same road with no crossing
//    node mapped, e.g. one road crossed at two points) merge into one finding with `times` = how many, points summed.
// A road that is both walked along and crossed keeps one stretch and one crossing finding (different fid, same osm_id).
// at = [lat, lon] where the map pin goes (wave 184 [DESIGN], js/map.js): a crossing's point where the route crosses
// that road; a stretch's midpoint of its first 10 m piece along that road. A merged finding keeps its first `at`.
// Route risk (Raw, RRI, score) is computed from every piece by js/route.js and is NOT changed by this merge.
function dedupe(list) {
  const by = new Map();
  for (const f of list) {
    const fid = `${f.kind}:${f.osm_id}`;
    const g = by.get(fid);
    if (!g) { by.set(fid, { fid, ...f, ...(f.kind === 'crossing' ? { times: 1 } : {}), _best: f.points }); continue; }
    if (f.kind === 'stretch') {
      if (g.side !== f.side) g.side = 'both';
      g.length_m = Math.round((g.length_m + f.length_m) * 10) / 10;
    } else g.times += 1;
    if (f.points > g._best) { g.text = f.text; g._best = f.points; }
    g.points = Math.round((g.points + f.points) * 1000) / 1000;
    g.flags = [...new Set([...(g.flags || []), ...(f.flags || [])])];
  }
  return [...by.values()].map(({ _best, ...f }) => f);
}

// snap = parsed data/osm-dulles.json; j = parsed data/routes/<id>.json; id = its file stem; rri = parsed
// data/ref/rri.json or null. Returns the object scripts/report.js prints as its one `--json` line.
function buildReport(snap, j, id, rri) {
  const mode = j.meta && j.meta.mode === 'bike' ? 'bike' : 'walk';
  const route = fromGeoJSON(j.routes[0].geometry.coordinates);
  const r = scoreRoute(snap, route, { mode });
  const nodes = new Map((snap.elements || []).filter((e) => e.type === 'node').map((e) => [e.id, e]));
  const crossings = r.pieces.filter((p) => p.kind === 'crossing');
  const typeUnknown = (p) => {
    if (p.node == null) return true;
    const t = (nodes.get(p.node) || {}).tags || {};
    return t.crossing == null && t['crossing:markings'] == null;
  };
  const raw = r.pieces
    .filter((p) => (p.kind === 'stretch' ? p.G >= 0.6 : p.Q >= 0.7))
    .map((p) => (p.kind === 'stretch'
      ? { osm_id: `way/${p.way}`, kind: 'stretch', side: p.side, length_m: p.length_m, points: p.A, text: p.finding, flags: p.flags, at: p.at }
      : { osm_id: p.node != null ? `node/${p.node}` : `way/${p.way}`, kind: 'crossing', points: p.K, text: p.text, flags: p.flags, at: p.at }));
  const findings = dedupe(raw)
    .sort((a, b) => b.points - a.points || (a.fid < b.fid ? -1 : a.fid > b.fid ? 1 : 0));
  const gaps = routeGaps(route, snap);
  const summary = rri && rri.modes && rri.modes[r.mode];
  const s100 = summary ? score100(r.rri, { show_score: summary.show_score, r50: summary.r50 }) : null;
  return {
    school: 'dulles',
    route: id,
    mode: r.mode,
    anchor: (j.meta && j.meta.anchor && j.meta.anchor.name) || null,
    findings: findings.length,
    N: crossings.length,
    k: crossings.filter(typeUnknown).length,
    entrances: r.n_entrances,
    gaps: gaps.length,
    gap_m: Math.round(gaps.reduce((s, g) => s + g.length_m, 0)),
    route_m: Math.round(r.route_m),
    rri_per_km: Math.round(r.rri * 100) / 100,
    score: s100,
    confidence: r.confidence,
    osm_base: snap.osm_base,
    list: findings,
  };
}

module.exports = { ROUTE_IDS, dedupe, buildReport };
