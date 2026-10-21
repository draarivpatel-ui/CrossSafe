'use strict';
// End to end in Node (kickoff-runbook 6:00 row): cached route -> routeGaps + scored pieces -> findings list.
// Reads committed data/ only (no network), so it runs from a fresh clone after `npm ci`.
// Usage:
//   node scripts/report.js dulles                      every cached demo route, human-readable
//   node scripts/report.js dulles --route <id>         one route (id = file name in data/routes/ without .json)
//   node scripts/report.js dulles --route <id> --json  ONE JSON line (keys pinned in the runbook 6:00 row; B2 reads `findings`)
// The report itself (findings, N, k, dedupe, score) is built by js/report.js, which the page uses too (wave 183).
// [DESIGN] findings = stretches with G >= 0.6 (no sidewalk mapped, or unknown) + crossings with Q >= 0.7 (not signalized),
// sorted by risk points, highest first. N = crossings on the route, k = crossings whose type the map does not state
// (no crossing node within 30 m, or a crossing node with neither `crossing` nor `crossing:markings`). Entrances
// (highway=service ways: driveways, parking aisles, lot entrances) are not crossings (js/route.js [DESIGN]); their
// count is reported as `entrances`. The list is deduplicated per (kind, OSM object): see dedupe() in js/report.js.
const fs = require('fs');
const path = require('path');
const { buildReport, dedupe } = require('../js/report.js');

const ROOT = path.join(__dirname, '..');
const SCHOOLS = { dulles: { name: 'Dulles High School', nces_id: '481965001818' } };
const ROUTES = path.join(ROOT, 'data', 'routes');

function routeIds() {
  return fs.readdirSync(ROUTES).filter((f) => /-(walk|bike)\.json$/.test(f)).map((f) => f.replace(/\.json$/, '')).sort();
}

function report(snap, id, rri) {
  const j = JSON.parse(fs.readFileSync(path.join(ROUTES, `${id}.json`), 'utf8'));
  return buildReport(snap, j, id, rri);
}

function main(argv) {
  const school = argv[0];
  if (!SCHOOLS[school]) { console.error(`usage: node scripts/report.js dulles [--route <id>] [--json] (unknown school '${school || ''}')`); return 2; }
  const i = argv.indexOf('--route');
  const want = i >= 0 ? argv[i + 1] : null;
  const json = argv.includes('--json');
  const ids = routeIds();
  if (want != null && !ids.includes(want)) { console.error(`unknown route '${want}'; cached routes: ${ids.join(', ')}`); return 2; }
  if (json && want == null) { console.error('--json needs --route <id> (one JSON line per route)'); return 2; }
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'osm-dulles.json'), 'utf8'));
  const rriFile = path.join(ROOT, 'data', 'ref', 'rri.json');
  const rri = fs.existsSync(rriFile) ? JSON.parse(fs.readFileSync(rriFile, 'utf8')) : null;
  for (const id of want ? [want] : ids) {
    const r = report(snap, id, rri);
    if (json) { process.stdout.write(JSON.stringify(r) + '\n'); continue; }
    console.log(`${SCHOOLS[school].name} · ${id} (${r.mode}${r.anchor ? `, from ${r.anchor}` : ''}) · ${(r.route_m / 1000).toFixed(2)} km`);
    console.log(`  ${r.findings} findings · ${r.k} of ${r.N} crossings: the map doesn't say what kind of crossing it is · ${r.entrances} driveway/service entrances crossed (not counted as crossings) · sidewalk gaps ${r.gaps} (${r.gap_m} m)`);
    console.log(`  ${r.rri_per_km.toFixed(2)} risk points per km${r.score != null ? ` · score ${r.score} (0-100, 50 = median reference route)` : ''} · confidence ${r.confidence} · map data ${r.osm_base}`);
    r.list.forEach((f, n) => console.log(`  ${n + 1}. [${f.osm_id}] ${f.points.toFixed(2)} pts · ${f.text}`));
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { report, routeIds, main, dedupe };
