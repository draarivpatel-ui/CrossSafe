'use strict';
// Weight sensitivity check (crosssafe-spec.md §a "Sensitivity plan" step 7: seeded, deterministic, summary table
// asserted on the committed snapshot). js/sensitivity.js + scripts/sensitivity.js; README "sensitivity" block.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../js/score.js');
const X = require('../js/sensitivity.js');
const { buildReport } = require('../js/report.js');
const { loadData } = require('../scripts/sensitivity.js');

const ROOT = path.join(__dirname, '..');
const data = loadData(ROOT);
const rri = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ref', 'rri.json'), 'utf8'));
const res = X.run(data);

test('SN1 default weights reproduce js/report.js and js/route.js exactly on every saved route', () => {
  const w = X.weights();
  assert.equal(data.demo.length, 6);
  for (const d of data.demo) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'routes', `${d.id}.json`), 'utf8'));
    const rep = buildReport(data.snap, j, d.id, rri);
    assert.deepEqual(X.findings(d.cap, w), rep.list, `${d.id}: findings list differs from report.js`);
    assert.equal(X.rriOf(d.cap, w), d.cap.rri0, `${d.id}: RRI differs from route.js`);
    for (const p of d.cap.pieces) assert.equal(p.kind === 'stretch' ? X.stretchA(p, w) : X.crossingK(p, w), p.kind === 'stretch' ? p.A0 : p.K0);
    const b = res.base.routes.find((r) => r.id === d.id);
    assert.equal(b.score, rep.score, `${d.id}: 0-100 score differs from report.js`);
  }
  for (const m of ['walk', 'bike']) assert.equal(res.base.r50[m], rri.modes[m].r50, `R50 ${m} differs from data/ref/rri.json`);
});

test('SN2 capture passes js/score.js results through and puts the functions back', () => {
  const a = S.scoreStretch, b = S.scoreAtGrade;
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'routes', 'lost-creek-park-walk.json'), 'utf8'));
  const { fromGeoJSON } = require('../js/route.js');
  X.capture(data.snap, fromGeoJSON(j.routes[0].geometry.coordinates), 'walk');
  assert.equal(S.scoreStretch, a);
  assert.equal(S.scoreAtGrade, b);
});

test('SN3 weights change only what they name (synthetic pieces)', () => {
  const st = { kind: 'stretch', L: 200, G: 0.6, unknown: true, cls: 'secondary', C: 0.8, V: 1, mph: 35, assumed: true, H: 0, M: 1 };
  const known = { ...st, unknown: false };
  const w0 = X.weights();
  assert.equal(X.stretchA(st, w0), 0.96); // 2 × 0.6 × 0.8 × 1 × 1
  assert.equal(X.stretchA(st, X.weights({ G_unknown: 0.3 })), 0.48);
  assert.equal(X.stretchA(known, X.weights({ G_unknown: 0.3 })), 0.96, 'a mapped G = 0.6 (e.g. walking lane) is not an unknown');
  assert.equal(X.stretchA(st, X.weights({ C_mul: { secondary: 1.5 } })), 1.44);
  assert.equal(X.stretchA(st, X.weights({ C_mul: { tertiary: 1.5 } })), 0.96);
  assert.equal(X.stretchA(st, X.weights({ speed_delta: 5 })), Math.round(2 * 0.6 * 0.8 * S.vFromMph(40) * 1000) / 1000);
  assert.equal(X.stretchA({ ...st, assumed: false }, X.weights({ speed_delta: 5 })), 0.96, 'a tagged speed is never moved');
  const cr = { kind: 'crossing', Q: 0.7, cmf: 0.68, N: 2, T: 1.3, tUnknown: true, V: 1, mph: 35, assumed: false, H: 1, M: 1.25 };
  assert.equal(X.crossingK(cr, w0), Math.round(Math.round(0.7 * 0.68 * 1000) / 1000 * 2 * 1.3 * 1 * 1.25 * 1000) / 1000);
  assert.equal(X.crossingK(cr, X.weights({ cmf_on: false })), Math.round(0.7 * 2 * 1.3 * 1.25 * 1000) / 1000);
  assert.equal(X.crossingK(cr, X.weights({ T_unknown: 1.6 })), Math.round(0.476 * 2 * 1.6 * 1.25 * 1000) / 1000);
  assert.equal(X.crossingK(cr, X.weights({ hist_w: 0 })), Math.round(0.476 * 2 * 1.3 * 1000) / 1000);
  assert.equal(X.crossingK({ ...cr, Q: 0.3 }, X.weights({ Q_signal: 0.15 })), Math.round(0.15 * 2 * 1.3 * 1.25 * 1000) / 1000, 'no CMF at a signal');
});

test('SN4 seeded and deterministic', () => {
  assert.equal(res.seed, 20261016);
  assert.equal(res.mc.seed, X.SENS_SEED);
  assert.equal(res.mc.draws, 1000);
  const base = X.evaluate(data, X.weights());
  assert.deepEqual(X.monteCarlo(data, base, 40), X.monteCarlo(data, base, 40));
  assert.notDeepEqual(X.monteCarlo(data, base, 40, 1), X.monteCarlo(data, base, 40, 2));
});

test('SN5 README sensitivity block = what scripts/sensitivity.js prints from the committed files', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const blk = X.blockOf(readme);
  assert.ok(blk, 'README has no sensitivity block: run node scripts/sensitivity.js --readme');
  assert.equal(blk, X.readmeBlock(res), 'README sensitivity block is stale: run node scripts/sensitivity.js --readme');
});

test('SN6 summary facts the README block states', () => {
  assert.equal(res.counts.ref_routes, rri.modes.walk.routes.filter((r) => r.ok).length + rri.modes.bike.routes.filter((r) => r.ok).length);
  assert.equal(res.counts.h_nonzero, 0, 'committed data has no history rows: if this changes, the README no-effect line must change');
  for (const r of res.rows) for (const c of [r.low, r.high].filter(Boolean)) {
    assert.ok(c.min_overlap >= 0 && c.min_overlap <= 10);
    assert.equal(c.pass, c.min_overlap >= X.PASS_OVERLAP && c.order_same);
  }
  const hist = res.rows.find((r) => r.family.startsWith('History weight'));
  assert.ok(hist.low.pass && hist.high.pass && hist.low.dscore_max === 0 && hist.high.dscore_max === 0, 'history weight has no effect while M = 1 everywhere');
});
