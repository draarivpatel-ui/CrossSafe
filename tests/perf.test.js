// P3 (test-spec §J P3; performance-budget-spec P3): scoring every crossing in the committed slim snapshot stays
// under the 100 ms budget. The file is read and parsed OUTSIDE the timed region; the timed region is only the
// js/score.js scoreAllCrossings call. Counts are checked against data/sources.json BEFORE any timing (P3a), and a
// missing file fails (P3b): the test always ends in pass or fail.
//
// [DESIGN] Runner-noise-robust timing (Fri Oct 16, 2026, BACKLOG [CS-P3-STABLE]). The CI median moved 34.6 -> 36.9
// -> 32.0 -> 60.5 ms with the same scoring code, because node --test runs the other test files in parallel
// processes on a shared runner, so the wall time of one call depends on what else is running. The 100 ms budget is
// NOT raised. Instead:
//   1. Warm-up: the first call (V8 compile + first allocation) is timed and logged as cold_ms but not part of the
//      median, and one more untimed call follows. The old median of 5 already discarded the cold call as its
//      largest value, so this changes no verdict on a quiet machine.
//   2. More runs: 15 timed calls instead of 5, so one or two slices of contention can't move the median.
//   3. Calibration on the runner: immediately before each timed call, a fixed CPU workload (calibrate(), 1,000,000
//      iterations of float math + allocation + one sort) is timed. Contention slows both by about the same factor,
//      so score/cal per pair is stable where raw ms is not. norm_ms = median(score_i / cal_i) x CAL_REF_MS is the
//      scoring time on the reference machine; the gate is norm_ms < 100.
//   CAL_REF_MS = 25 is the Hark sandbox (Node 22, 2 vCPU) at the SLOW end of what was measured on Fri Oct 16, 2026
//   (calibrate() medians 22.0-24.7 ms, in this test and standalone). Since norm_ms = raw x CAL_REF_MS / cal, a
//   reference at or above the sandbox's own calibration makes norm_ms >= raw ms there, so on the sandbox the gate
//   is never looser than the old raw-median gate. On a slower or busier runner the same 100 ms is applied in
//   reference-machine milliseconds instead of being raised.
//   A code regression slows score_i but not cal_i, so it still fails everywhere (planted slow-stub breaks).
//   On a runner that is not slower than reference (cal median <= CAL_REF_MS) the raw median must ALSO be
//   < 100 ms, so on a quiet reference-speed machine this test is never looser than the old one.
//   A calibration median outside 0.25x..20x CAL_REF_MS fails (a loop optimised away, or a broken runner): a failure, not a pass.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { performance } = require('node:perf_hooks');
const { snapshotCounts } = require('../js/snapshot.js');
const { scoreAllCrossings } = require('../js/score.js');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(__dirname, '..', 'data', 'osm-dulles.json');
const RUNS = 15;
const BUDGET_MS = 100;
const CAL_ITERS = 1000000;
const CAL_REF_MS = 25;

// Fixed workload; its result is returned and checked so V8 cannot drop the loop.
function calibrate(n) {
  let acc = 0;
  const a = [];
  for (let i = 0; i < n; i++) {
    const x = Math.sin(i * 0.001) * Math.cos(i * 0.0007);
    acc += x;
    if ((i & 63) === 0) a.push({ v: x, i });
  }
  a.sort((p, q) => p.v - q.v);
  return acc + a.length;
}

const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];

test('P3 score every crossing in osm-dulles.json: counts match sources.json, runner-calibrated median of 15 < 100 ms', () => {
  const buf = fs.readFileSync(FILE); // a missing file throws here: a failure (P3b)
  const snap = JSON.parse(buf.toString('utf8'));
  const want = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sources.json'), 'utf8')).files['data/osm-dulles.json'];
  const got = Object.assign({ bytes: buf.length }, snapshotCounts(snap));
  // (a) before timing: the timed input is the committed file sources.json describes, not a smaller stand-in
  assert.deepEqual(
    { bytes: got.bytes, ways: got.ways, nodes: got.nodes },
    { bytes: want.bytes, ways: want.ways, nodes: want.nodes },
    `P3(a) osm-dulles.json counts differ from data/sources.json (expected bytes=${want.bytes} ways=${want.ways} nodes=${want.nodes}, got bytes=${got.bytes} ways=${got.ways} nodes=${got.nodes})`,
  );
  const crossingNodes = snap.elements.filter((e) => e.type === 'node' && e.tags && e.tags.highway === 'crossing').length;

  // warm-up: cold call timed and logged only, then one untimed call each
  let t0 = performance.now();
  let res = scoreAllCrossings(snap);
  const coldMs = performance.now() - t0;
  res = scoreAllCrossings(snap);
  const calCheck = calibrate(CAL_ITERS);
  const ms = [];
  const cal = [];
  const ratio = [];
  for (let i = 0; i < RUNS; i++) {
    t0 = performance.now();
    const c = calibrate(CAL_ITERS);
    const tc = performance.now() - t0;
    assert.equal(c, calCheck, 'calibrate() is not deterministic');
    t0 = performance.now();
    res = scoreAllCrossings(snap);
    const ts = performance.now() - t0;
    cal.push(tc);
    ms.push(ts);
    ratio.push(ts / tc);
  }
  // (d) a result for every crossing node, so an early-return stub cannot pass on speed
  assert.ok(crossingNodes > 0, 'no crossing nodes in the snapshot');
  assert.equal(res.length, crossingNodes);
  assert.ok(res.filter((r) => Number.isFinite(r.K)).length > 0, 'no crossing was scored');
  const med = median(ms);
  const calMed = median(cal);
  const norm = median(ratio) * CAL_REF_MS;
  // (c) the one line README item 2 copies the numbers from (median_ms = raw wall time on this runner)
  console.log(`P3 osm-dulles.json bytes=${got.bytes} ways=${got.ways} nodes=${got.nodes} median_ms=${med.toFixed(1)} runs=${RUNS} cal_ms=${calMed.toFixed(1)} norm_ms=${norm.toFixed(1)} cold_ms=${coldMs.toFixed(1)} budget_ms=${BUDGET_MS}`);
  // (e) calibration sanity: never a silent pass on a loop that was optimised away or a runner that is unusable
  assert.ok(calMed >= CAL_REF_MS * 0.25 && calMed <= CAL_REF_MS * 20,
    `P3(e) calibration median ${calMed.toFixed(1)} ms is outside ${CAL_REF_MS * 0.25}..${CAL_REF_MS * 20} ms (CAL_REF_MS ${CAL_REF_MS})`);
  // (b) the budget, in reference-machine milliseconds
  assert.ok(norm < BUDGET_MS,
    `P3(b) calibrated median ${norm.toFixed(1)} ms >= ${BUDGET_MS} ms (raw median ${med.toFixed(1)} ms, calibration median ${calMed.toFixed(1)} ms vs reference ${CAL_REF_MS} ms; raw runs: ${ms.map((x) => x.toFixed(1)).join(', ')})`);
  // (b-raw) on a runner at least as fast as reference, the raw wall-clock median must meet the budget too
  if (calMed <= CAL_REF_MS) {
    assert.ok(med < BUDGET_MS, `P3(b-raw) runner at reference speed (calibration ${calMed.toFixed(1)} <= ${CAL_REF_MS} ms) but raw median ${med.toFixed(1)} ms >= ${BUDGET_MS} ms`);
  }
});
