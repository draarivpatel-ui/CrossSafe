'use strict';
// R50 reference sample, step B (kickoff-runbook 8:00 row; crosssafe-spec §a + §b T17/T18).
// Scores every committed reference route (data/routes/ref/{walk,bike}/<wayId>.json, drawn in data/ref/points.json)
// with js/route.js and writes data/ref/rri.json (per-route RRI, R50 per mode, failure reasons). Prints the README
// "Reference sample" block; with --readme it also rewrites that block in README.md. Offline and deterministic.
// Usage: node scripts/ref-report.js [--readme]
const fs = require('fs');
const path = require('path');
const { ROOT, update } = require('./lib/sources');
const R = require('../js/r50.js');

const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'osm-dulles.json'), 'utf8'));
const byMode = {};
for (const m of R.MODES) byMode[m] = R.computeRef(m, { root: ROOT, snap });
const rep = R.buildReport(byMode);
const out = path.join(ROOT, 'data', 'ref', 'rri.json');
fs.writeFileSync(out, R.serializeReport(rep));
const block = R.readmeBlock(rep);
console.log(block);

if (process.argv.includes('--readme')) {
  const f = path.join(ROOT, 'README.md');
  const t = fs.readFileSync(f, 'utf8');
  const a = t.indexOf(R.BLOCK_START), b = t.indexOf(R.BLOCK_END);
  let next;
  if (a >= 0 && b > a) next = t.slice(0, a) + block + t.slice(b + R.BLOCK_END.length);
  else {
    const anchor = '\n## Tests';
    const i = t.indexOf(anchor);
    if (i < 0) throw new Error('README has no "## Tests" heading to put the Reference sample block before');
    next = t.slice(0, i) + '\n' + block + '\n' + t.slice(i);
  }
  fs.writeFileSync(f, next);
  console.error('README.md: Reference sample block written');
}

const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sources.json'), 'utf8')).files;
const fetched = [src['data/routes/ref/walk/*.json'], src['data/routes/ref/bike/*.json']].map((e) => e && e.fetched_at).filter(Boolean).sort();
update((s) => {
  s.files['data/ref/rri.json'] = {
    source_url: 'scripts/ref-report.js (from data/routes/ref/{walk,bike}/*.json, data/ref/points.json, data/osm-dulles.json)',
    fetched_at: fetched[fetched.length - 1], licence: 'ODbL-1.0', osm_base: rep.osm_base,
    n_success: { walk: rep.modes.walk.n_success, bike: rep.modes.bike.n_success },
  };
});
