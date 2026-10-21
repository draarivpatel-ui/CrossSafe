// T17 + T18 (crosssafe-spec §b): R50 per mode, the >= 20 / < 20 rule, the car-route guard, and R50 recomputed from the
// committed reference sample (not hard-coded) with the README "Reference sample" block matching it.
// Offline: reads only committed files. T17 inputs are SYNTHETIC numbers (invented test inputs, never real results).
// T17(d)/(e) UI halves (route card, list, print sheet, aria-live, Spanish line) wait for the UI rows; here the decision
// and the English line they will render are pinned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const R = require('../js/r50.js');

const ROOT = path.join(__dirname, '..');
const EPS = 1e-9;
const close = (a, b, eps = EPS, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);
// SYNTHETIC rows: n successes with RRI 0.1, 0.2, ... and k failures
const okRows = (n) => Array.from({ length: n }, (_, i) => ({ ok: true, reason: null, rri: (i + 1) / 10 }));
const failRows = (k, reason = 'no_route') => Array.from({ length: k }, () => ({ ok: false, reason }));
// SYNTHETIC OSRM reply: distance m, duration s
const reply = (distance, duration, n = 3) => ({ code: 'Ok', routes: [{ distance, duration, geometry: { type: 'LineString', coordinates: Array.from({ length: n }, (_, i) => [-95.58 + i * 1e-3, 29.62]) } }] });

test('T17(a) 30 successes 0.1..3.0 -> R50 1.55, n 30, score shown', () => {
  const s = R.summarize('walk', okRows(30), 30);
  close(s.r50, 1.55); assert.equal(s.n_success, 30); assert.equal(s.show_score, true); assert.equal(s.line, null);
});

test('T17(b) 20 successes + 10 no_route -> R50 1.05, boundary inclusive, scores 50/67/25/0', () => {
  const s = R.summarize('walk', okRows(20).concat(failRows(10)), 30);
  close(s.r50, 1.05); assert.equal(s.n_success, 20); assert.equal(s.show_score, true);
  assert.equal(s.reasons.no_route, 10);
  assert.equal(R.score100(1.05, s), 50);
  assert.equal(R.score100(2.1, s), 67); // 100 × 2.1 / 3.15 = 66.67 -> Math.round
  assert.equal(R.score100(0.35, s), 25);
  assert.equal(R.score100(0, s), 0);
});

test('T17(c) 21 successes -> odd n uses the middle value, R50 1.1', () => {
  close(R.summarize('walk', okRows(21), 30).r50, 1.1);
});

test('T17(d) 19 successes + 11 failures -> no 0-100 number, RRI/km fallback line', () => {
  const s = R.summarize('walk', okRows(19).concat(failRows(11)), 30);
  assert.equal(s.show_score, false);
  assert.equal(s.line, 'Not enough reference routes for a 0-100 score (19 of 30 routed; 20 needed)');
  for (const rri of [0, 0.5, 1, 5, 100]) assert.equal(R.score100(rri, s), null);
  close(s.r50, 1.0); // still computed (for the README), never used for a 0-100 score
});

test('T17(e) walk shown, bike 19 -> bike falls back, walk unaffected', () => {
  const walk = R.summarize('walk', okRows(20).concat(failRows(10)), 30);
  const bike = R.summarize('bike', okRows(19).concat(failRows(11, 'http_error')), 30);
  assert.equal(walk.show_score, true); assert.equal(R.score100(1.05, walk), 50);
  assert.equal(bike.show_score, false); assert.equal(R.score100(1.05, bike), null);
  assert.match(bike.line, /\(19 of 30 routed; 20 needed\)/);
  assert.equal(bike.reasons.http_error, 11);
});

test('T17(f) a walk route at >= 7 km/h is a car_route failure and is excluded from R50', () => {
  const car = R.classify(reply(2000, 210), 'walk'); // 2,000 m in 210 s ≈ 34 km/h (the /foot/ car-route case)
  assert.equal(car.ok, false); assert.equal(car.reason, 'car_route');
  assert.equal(R.classify(reply(7000, 3600), 'walk').reason, 'car_route', 'exactly 7.0 km/h is a car route (>= 7)');
  assert.equal(R.classify(reply(6990, 3600), 'walk').ok, true, '6.99 km/h is a walk');
  assert.equal(R.classify(reply(2000, 210), 'bike').ok, true, 'the 7 km/h guard is for walk routes only');
  // the car route must not drag the median: 29 walk successes 0.1..2.9 + one car route with a tiny RRI
  const rows = okRows(29).concat([{ ok: car.ok, reason: car.reason, rri: 0.001 }]);
  const s = R.summarize('walk', rows, 30);
  assert.equal(s.n_success, 29); assert.equal(s.reasons.car_route, 1); close(s.r50, 1.5);
});

test('T17 classify: every other failure reason', () => {
  assert.equal(R.classify(null, 'walk').reason, 'missing_file');
  assert.equal(R.classify({ error: 'HTTP 502', http_status: 502, meta: {} }, 'walk').reason, 'http_error');
  assert.equal(R.classify({ code: 'NoRoute', message: 'Impossible route' }, 'bike').reason, 'no_route');
  assert.equal(R.classify(reply(100, 100, 1), 'walk').reason, 'empty_geometry');
  assert.equal(R.classify(reply(0, 100), 'walk').reason, 'empty_geometry');
});

// ---- T18: the committed sample ----------------------------------------------------
let FULL = null;
const full = () => (FULL = FULL || { walk: R.computeRef('walk', { root: ROOT }), bike: R.computeRef('bike', { root: ROOT }) });
const committedRri = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ref', 'rri.json'), 'utf8'));

test('T18(a) R50 is recomputed identically: twice in a row and in a fresh process; rri.json is not stale', () => {
  const a = full().walk.summary.r50;
  const b = R.computeR50('walk', { root: ROOT }).r50;
  assert.ok(Number.isFinite(a) && a > 0);
  assert.equal(a, b, 'same double twice in a row');
  const js = `process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(ROOT, 'js', 'r50.js'))}).computeR50('walk', { root: ${JSON.stringify(ROOT)} }).r50))`;
  const c = JSON.parse(execFileSync(process.execPath, ['-e', js], { encoding: 'utf8' }));
  assert.equal(c, a, 'same double from a fresh process');
  const bytes = fs.readFileSync(path.join(ROOT, 'data', 'ref', 'rri.json'), 'utf8');
  assert.equal(bytes, R.serializeReport(R.buildReport(full())), 'data/ref/rri.json is stale: run node scripts/ref-report.js --readme');
  for (const f of ['js/r50.js', 'js/route.js', 'scripts/ref-report.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /Math\.random|Date\.now|new Date|https?:\/\/(?!www\.openstreetmap\.org\/copyright)/, `${f}: no randomness, clock or network`);
  }
});

function tmpCopy() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-t18-'));
  fs.mkdirSync(path.join(d, 'data', 'ref'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'data', 'osm-dulles.json'), path.join(d, 'data', 'osm-dulles.json'));
  fs.copyFileSync(path.join(ROOT, 'data', 'ref', 'points.json'), path.join(d, 'data', 'ref', 'points.json'));
  fs.cpSync(path.join(ROOT, 'data', 'routes', 'ref'), path.join(d, 'data', 'routes', 'ref'), { recursive: true });
  return d;
}

test('T18(b) delete the 10 lowest-RRI walk files (per rri.json) -> walk R50 = median of the other 20 (>= before), bike unchanged', () => {
  const rep = committedRri();
  const walk = rep.modes.walk.routes.filter((r) => r.ok).sort((x, y) => x.rri - y.rri);
  assert.ok(walk.length >= 20, 'needs >= 20 walk successes');
  const d = tmpCopy();
  try {
    for (const r of walk.slice(0, 10)) fs.rmSync(path.join(d, 'data', 'routes', 'ref', 'walk', `${r.way_id}.json`));
    const s = R.computeR50('walk', { root: d });
    assert.equal(s.n_success, walk.length - 10);
    assert.equal(s.reasons.missing_file, 10);
    close(s.r50, R.median(walk.slice(10).map((r) => r.rri)), 1e-6, 'median of the remaining committed RRIs');
    assert.ok(s.r50 >= full().walk.summary.r50, 'removing the lowest 10 cannot lower R50');
    assert.equal(s.show_score, s.n_success >= 20);
    assert.equal(R.computeR50('bike', { root: d }).r50, full().bike.summary.r50, 'bike R50 unchanged');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('T18(c) delete 11 bike files -> bike n 19, RRI/km fallback (missing_file × 11), walk unchanged', () => {
  const d = tmpCopy();
  try {
    const dir = path.join(d, 'data', 'routes', 'ref', 'bike');
    const files = fs.readdirSync(dir).sort().slice(0, 11);
    for (const f of files) fs.rmSync(path.join(dir, f));
    const s = R.computeR50('bike', { root: d });
    assert.equal(s.reasons.missing_file, 11);
    assert.equal(s.n_success, full().bike.summary.n_success - 11);
    assert.equal(s.show_score, false);
    assert.equal(s.line, `Not enough reference routes for a 0-100 score (${s.n_success} of 30 routed; 20 needed)`);
    assert.equal(R.score100(full().bike.summary.r50, s), null);
    assert.equal(R.computeR50('walk', { root: d }).r50, full().walk.summary.r50, 'walk R50 unchanged');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('T18(d) SYNTHETIC 20 successes all RRI 0 -> R50 0, no 0-100 (never NaN or 100)', () => {
  const s = R.summarize('walk', Array.from({ length: 20 }, () => ({ ok: true, rri: 0 })), 30);
  assert.equal(s.r50, 0); assert.equal(s.show_score, false);
  assert.equal(s.line, 'Reference routes all scored 0; 0-100 score not meaningful');
  for (const rri of [0, 0.5, 3]) assert.equal(R.score100(rri, s), null);
});

test('T18(e) README "Reference sample" block = what scripts/ref-report.js prints from the committed files', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const parsed = R.parseBlock(readme);
  assert.ok(parsed, 'README has no Reference sample block: run node scripts/ref-report.js --readme');
  const rep = R.buildReport(full());
  assert.equal(parsed.raw, R.readmeBlock(rep), 'README block is stale: run node scripts/ref-report.js --readme');
  const pts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ref', 'points.json'), 'utf8'));
  assert.equal(parsed.seed, 20261016);
  assert.equal(parsed.osm_base, pts.osm_base);
  for (const m of R.MODES) {
    const s = full()[m].summary;
    assert.equal(parsed.modes[m].n_success, s.n_success);
    assert.equal(parsed.modes[m].n_drawn, pts.n_drawn);
    assert.equal(parsed.modes[m].r50, s.r50.toFixed(2));
    assert.equal(parsed.modes[m].failures, R.fmtReasons(s.reasons));
  }
  // the block's scope line: committed inputs only -> every crossing T = 1.3, every piece M = 1
  for (const m of R.MODES) for (const row of full()[m].rows.filter((r) => r.ok)) {
    assert.ok(row.T_set.every((t) => t === 1.3), `${m} ${row.way_id}: crossing T other than 1.3: ${row.T_set}`);
    assert.deepEqual(row.M_set, [1], `${m} ${row.way_id}: M other than 1`);
  }
});
