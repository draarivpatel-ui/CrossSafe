'use strict';
// Weight sensitivity check (crosssafe-spec.md §a "Sensitivity plan"; logic in js/sensitivity.js). Reads the committed
// data/ files only (no network), so it runs from a fresh clone. Deterministic: the random draws use a fixed seed.
// Usage:
//   node scripts/sensitivity.js            print the README block
//   node scripts/sensitivity.js --json     print the full result as one JSON line
//   node scripts/sensitivity.js --readme   also rewrite the block in README.md (put before "## Tests" the first time)
const fs = require('fs');
const path = require('path');
const { fromGeoJSON } = require('../js/route.js');
const { ROUTE_IDS } = require('../js/report.js');
const X = require('../js/sensitivity.js');

const ROOT = path.join(__dirname, '..');
const read = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

// Capture every demo route and every successful reference route once (the reference list = data/ref/rri.json).
function loadData(root = ROOT) {
  const rd = (...p) => JSON.parse(fs.readFileSync(path.join(root, ...p), 'utf8'));
  const snap = rd('data', 'osm-dulles.json');
  const demo = ROUTE_IDS.map((id) => {
    const j = rd('data', 'routes', `${id}.json`);
    const mode = j.meta && j.meta.mode === 'bike' ? 'bike' : 'walk';
    return { id, mode, cap: X.capture(snap, fromGeoJSON(j.routes[0].geometry.coordinates), mode) };
  });
  const rri = rd('data', 'ref', 'rri.json');
  const ref = {};
  for (const m of ['walk', 'bike']) {
    ref[m] = rri.modes[m].routes.filter((r) => r.ok).map((r) => {
      const j = rd('data', 'routes', 'ref', m, `${r.way_id}.json`);
      return X.capture(snap, fromGeoJSON(j.routes[0].geometry.coordinates), m);
    });
  }
  return { snap, demo, ref };
}

function main(argv) {
  const data = loadData();
  const res = X.run(data);
  if (argv.includes('--json')) { process.stdout.write(JSON.stringify(res) + '\n'); return 0; }
  const block = X.readmeBlock(res);
  console.log(block);
  if (argv.includes('--readme')) {
    const f = path.join(ROOT, 'README.md');
    const t = fs.readFileSync(f, 'utf8');
    const a = t.indexOf(X.BLOCK_START), b = t.indexOf(X.BLOCK_END);
    let next;
    if (a >= 0 && b > a) next = t.slice(0, a) + block + t.slice(b + X.BLOCK_END.length);
    else {
      const i = t.indexOf('\n## Tests');
      if (i < 0) throw new Error('README has no "## Tests" heading to put the sensitivity block before');
      next = t.slice(0, i) + '\n' + block + '\n' + t.slice(i);
    }
    fs.writeFileSync(f, next);
    console.error('README.md: sensitivity block written');
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { loadData, main, read };
