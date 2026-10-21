'use strict';
// R50 reference sample, step B (crosssafe-spec §a "Reference sample for R50" + §b T17/T18; kickoff-runbook 8:00 row).
// Scores every cached reference route with the same route code the app uses (js/route.js -> js/score.js) and takes
// R50(mode) = median RRI of that mode's successful routes. Nothing here is hard-coded: R50 is recomputed from the
// committed files every time. Pure apart from reading files: no network, no clock, no randomness.
const fs = require('fs');
const path = require('path');
const { scoreRoute, fromGeoJSON } = require('./route.js');

const MIN_SUCCESS = 20; // spec §b: n_success >= 20 -> the 0-100 score is shown for that mode (inclusive)
const CAR_KMH = 7; // spec §a: a cached walk route with average speed >= 7 km/h is a car route
const MODES = ['walk', 'bike'];
const REASONS = ['http_error', 'no_route', 'car_route', 'empty_geometry', 'missing_file'];

// One cached reply -> success or a failure reason (spec §b "Success, per mode"). `j` = parsed file or null (missing).
function classify(j, mode) {
  if (j == null) return { ok: false, reason: 'missing_file' };
  if (j.error != null || (j.http_status != null && j.code == null)) return { ok: false, reason: 'http_error' };
  const rt = j.code === 'Ok' && Array.isArray(j.routes) ? j.routes[0] : null;
  if (!rt) return { ok: false, reason: 'no_route' };
  const coords = (rt.geometry && rt.geometry.coordinates) || [];
  if (coords.length < 2 || !(rt.distance > 0)) return { ok: false, reason: 'empty_geometry' };
  const kmh = rt.duration > 0 ? (rt.distance / rt.duration) * 3.6 : Infinity;
  if (mode === 'walk' && kmh >= CAR_KMH) return { ok: false, reason: 'car_route', kmh };
  return { ok: true, reason: null, kmh, route_km: rt.distance / 1000 };
}

// Median: even n -> mean of the two middle values; odd n -> the middle value. null for an empty list.
function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// rows: [{ ok, reason, rri }] for one mode, n_drawn = points drawn. Decides R50 and whether 0-100 is shown.
function summarize(mode, rows, n_drawn) {
  const ok = rows.filter((r) => r.ok);
  const reasons = {};
  for (const k of REASONS) reasons[k] = 0;
  for (const r of rows) if (!r.ok) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  const n_success = ok.length;
  const r50 = median(ok.map((r) => r.rri));
  let show_score = n_success >= MIN_SUCCESS && r50 != null && r50 > 0;
  let line = null;
  if (n_success < MIN_SUCCESS) line = `Not enough reference routes for a 0-100 score (${n_success} of ${n_drawn} routed; ${MIN_SUCCESS} needed)`;
  else if (!(r50 > 0)) line = 'Reference routes all scored 0; 0-100 score not meaningful';
  if (line) show_score = false;
  return { mode, n_drawn, n_success, r50, show_score, reasons, line };
}

// 0-100 score for a route RRI against a mode summary; null when that mode is on the RRI-per-km fallback.
function score100(rri, summary) {
  if (!summary || !summary.show_score || !(summary.r50 > 0) || rri == null || !Number.isFinite(rri)) return null;
  return Math.round((100 * rri) / (rri + summary.r50));
}

// Score the committed reference routes of one mode. opts.root = repo root (default: this repo), opts.snap = parsed
// snapshot (default: <root>/data/osm-dulles.json). Missing files count as `missing_file`; nothing is redrawn.
function computeRef(mode, opts = {}) {
  const root = opts.root || path.join(__dirname, '..');
  const snap = opts.snap || JSON.parse(fs.readFileSync(path.join(root, 'data', 'osm-dulles.json'), 'utf8'));
  const pts = JSON.parse(fs.readFileSync(path.join(root, 'data', 'ref', 'points.json'), 'utf8'));
  const rows = [];
  for (const p of pts.points) {
    const f = path.join(root, 'data', 'routes', 'ref', mode, `${p.way_id}.json`);
    const j = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    const c = classify(j, mode);
    const row = { way_id: p.way_id, ok: c.ok, reason: c.reason };
    if (c.ok) {
      const r = scoreRoute(snap, fromGeoJSON(j.routes[0].geometry.coordinates), { mode });
      Object.assign(row, { route_m: r.route_m, rri: r.rri, n_stretches: r.n_stretches, n_crossings: r.n_crossings, confidence: r.confidence });
      // in memory only (not written to rri.json): the T and M values used, so T18 can check the README's scope line
      row.T_set = [...new Set(r.pieces.filter((x) => x.kind === 'crossing').map((x) => x.T))];
      row.M_set = [...new Set(r.pieces.map((x) => x.M))];
    } else if (c.kmh != null) row.kmh = c.kmh;
    rows.push(row);
  }
  return { seed: pts.seed, osm_base: pts.osm_base, rows, summary: summarize(mode, rows, pts.n_drawn) };
}
const computeR50 = (mode, opts) => computeRef(mode, opts).summary;

// ---- data/ref/rri.json and the README block -------------------------------------
const r6 = (x) => (x == null ? null : Math.round(x * 1e6) / 1e6);
function buildReport(byMode) {
  const any = byMode.walk || byMode.bike;
  const out = {
    schema: 1,
    seed: any.seed,
    osm_base: any.osm_base,
    scorer: 'js/route.js scoreRoute (js/score.js G/C/V/Q/N/T/H); committed inputs only: T = 1.3 "traffic count unknown" and M = 1 "HIN coverage unknown" on every piece (TxDOT/H-GAC rows are not in this repo)',
    rule: `R50 = median RRI (risk points per km) of successful routes per mode; 0-100 shown only when >= ${MIN_SUCCESS} succeed`,
    licence: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright); routes: OSRM on routing.openstreetmap.de (FOSSGIS)',
    modes: {},
  };
  for (const m of MODES) {
    const c = byMode[m];
    if (!c) continue;
    const s = c.summary;
    out.modes[m] = {
      n_drawn: s.n_drawn, n_success: s.n_success, r50: r6(s.r50), show_score: s.show_score, reasons: s.reasons, line: s.line,
      routes: c.rows.map((r) => (r.ok
        ? { way_id: r.way_id, ok: true, route_m: Math.round(r.route_m * 10) / 10, rri: r6(r.rri), n_stretches: r.n_stretches, n_crossings: r.n_crossings, confidence: r.confidence }
        : Object.assign({ way_id: r.way_id, ok: false, reason: r.reason }, r.kmh != null ? { kmh: Math.round(r.kmh * 100) / 100 } : {}))),
    };
  }
  return out;
}
const serializeReport = (rep) => JSON.stringify(rep, null, 2) + '\n'; // key order is fixed by buildReport

const BLOCK_START = '<!-- ref-sample:start (written by node scripts/ref-report.js --readme; do not edit by hand) -->';
const BLOCK_END = '<!-- ref-sample:end -->';
const fmtReasons = (r) => {
  const parts = REASONS.filter((k) => r[k] > 0).map((k) => `${k} × ${r[k]}`);
  return parts.length ? parts.join(', ') : 'none';
};
function readmeBlock(rep) {
  const L = [BLOCK_START, '### Reference sample', ''];
  L.push(`- Seed: ${rep.seed} (\`js/ref.js\`, mulberry32). OSM snapshot \`osm_base\`: ${rep.osm_base}.`);
  for (const m of MODES) {
    const s = rep.modes[m];
    if (!s) continue;
    const r50 = s.r50 == null ? 'n/a' : s.r50.toFixed(2);
    const shown = s.show_score ? '0-100 score can be shown for this mode' : `RRI per km only (${s.line})`;
    L.push(`- ${m === 'walk' ? 'Walk' : 'Bike'}: n = ${s.n_success} successful of ${s.n_drawn} drawn; R₅₀ = ${r50} risk points per km; failures: ${fmtReasons(s.reasons)}; ${shown}.`);
  }
  L.push('- R₅₀ is the median route risk per km of these routes, recomputed from the committed files by `scripts/ref-report.js` (per-route table: `data/ref/rri.json`); CI re-derives every number above (test T18).');
  L.push('- Scored from the committed OpenStreetMap tags only: TxDOT traffic counts and H-GAC/TxDOT crash and High Injury Network rows are not in this repo, so every crossing uses T = 1.3 ("traffic count unknown") and every piece uses M = 1. R₅₀ is a reference point for the 0-100 scale (50 = as risky per km as the median reference route), not a crash prediction.');
  L.push(BLOCK_END);
  return L.join('\n');
}
// Parse the README block back into numbers (T18e).
function parseBlock(text) {
  const a = text.indexOf(BLOCK_START), b = text.indexOf(BLOCK_END);
  if (a < 0 || b < a) return null;
  const blk = text.slice(a, b);
  const seed = Number((blk.match(/Seed: (\d+)/) || [])[1]);
  const osm_base = (blk.match(/`osm_base`: ([^\s]+)\./) || [])[1] || null;
  const modes = {};
  for (const m of MODES) {
    const re = new RegExp(`- ${m === 'walk' ? 'Walk' : 'Bike'}: n = (\\d+) successful of (\\d+) drawn; R₅₀ = ([0-9.]+|n/a) risk points per km; failures: ([^;]+);`);
    const x = blk.match(re);
    if (x) modes[m] = { n_success: Number(x[1]), n_drawn: Number(x[2]), r50: x[3] === 'n/a' ? null : x[3], failures: x[4] };
  }
  return { seed, osm_base, modes, raw: text.slice(a, b + BLOCK_END.length) };
}

module.exports = {
  MIN_SUCCESS, CAR_KMH, MODES, REASONS, classify, median, summarize, score100, computeRef, computeR50,
  buildReport, serializeReport, readmeBlock, parseBlock, fmtReasons, BLOCK_START, BLOCK_END,
};
