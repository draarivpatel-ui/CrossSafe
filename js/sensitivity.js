'use strict';
// Weight sensitivity check (crosssafe-spec.md §a "Sensitivity plan" steps 1, 2, 3, 5 and 7; score-sensitivity-test-spec
// S2). Question it answers: "if you disagree with a judgment weight, do the findings and the route order change?"
// Pure: no file system, no network, no DOM, no clock. Randomness only from the seeded mulberry32 in js/ref.js.
//
// How: every demo route and every reference route is scored ONCE by the app's own code (js/route.js -> js/score.js).
// While that runs, the per-piece factor values js/score.js returns (G, C, V, Q, N, T, M, CMF, assumed speed, unrounded
// stretch length) are recorded; js/score.js and js/route.js are not changed and their results are passed through
// untouched. A changed weight is then applied to those factor values with the exact formulas and rounding of
// js/score.js (A = L/100 · G · C · V · M, K = Q·CMF · N · T · V · M, both rounded to 0.001). With every weight at its
// default this reproduces js/report.js and js/route.js exactly (tests/sensitivity.test.js checks it on all 6 routes).
//
// [DESIGN] Scope, stated in the README block:
//  - The spec's metric is "overlap@10 of the top-10 riskiest pieces in the 1-mi zone". The app has no zone-wide piece
//    list (it scores routes), so the metric here is overlap@10 of each demo route's own top-10 findings (the list a
//    reader sees), worst case over the 6 routes, plus the order of the 3 demo routes per mode by risk per km.
//  - A piece stays in or out of the findings list by its category (no sidewalk mapped or unknown; not signalized),
//    as in js/report.js; a weight change re-ranks findings but does not add or drop them.
//  - Spec steps 4 (matching radii) and 6 (history-off check against crash points) are not run: step 4 needs radius
//    parameters js/score.js does not expose, step 6 needs crash points, which this repo does not hold (licence).
const S = require('./score.js');
const R = require('./route.js');
const { dedupe } = require('./report.js');
const { median, score100 } = require('./r50.js');
const { mulberry32 } = require('./ref.js');

const SENS_SEED = 20261016; // [DESIGN] same kickoff-date seed as the reference draw (js/ref.js REF_SEED)
const MC_DRAWS = 1000; // spec step 5
const MC_LO = 0.7, MC_HI = 1.3; // spec step 5: each judgment weight × U(0.7, 1.3)
const STABLE = 0.8; // spec step 5: "stable" only when a finding stays in the top 10 in >= 80 % of draws
const PASS_OVERLAP = 8; // spec step 1: pass = overlap@10 >= 8 and the demo route order unchanged
const RANGE_PTS = 10; // spec step 2: show the score as a range when best/worst differ by more than 10 points
const CLASSES = ['residential', 'living_street', 'service', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk'];

const r3 = (x) => Math.round(x * 1000) / 1000;
const r6 = (x) => (x == null ? null : Math.round(x * 1e6) / 1e6);
const baseClass = (h) => String(h || '').replace(/_link$/, '');

// ---- weights ------------------------------------------------------------------------------------------------
// Defaults = js/score.js. Q_* replace the base control value by category; C_mul multiplies the class value.
function weights(over = {}) {
  const w = { G_unknown: 0.6, Q_signal: 0.3, Q_marked: 0.7, Q_unmarked: 0.9, Q_none: 1.0, C_mul: {}, T_mul: 1, T_unknown: null, hist_w: 0.25, cmf_on: true, speed_delta: 0 };
  for (const c of CLASSES) w.C_mul[c] = 1;
  for (const [k, v] of Object.entries(over)) {
    if (k === 'C_mul') Object.assign(w.C_mul, v);
    else if (k === 'C_all') for (const c of CLASSES) w.C_mul[c] = v;
    else w[k] = v;
  }
  return w;
}

// ---- capture the factor values of one route, scored by the app's own code -----------------------------------
const WAYS = new WeakMap();
function wayClass(snap, id) {
  let m = WAYS.get(snap);
  if (!m) { m = new Map(); for (const e of snap.elements || []) if (e.type === 'way' && e.tags && !m.has(e.id)) m.set(e.id, baseClass(e.tags.highway)); WAYS.set(snap, m); }
  return m.get(id);
}
function capture(snap, route, mode) {
  const recs = [];
  const oS = S.scoreStretch, oA = S.scoreAtGrade;
  S.scoreStretch = (sn, wayId, o = {}) => { const r = oS(sn, wayId, o); recs.push({ L: o.length_m, r }); return r; };
  S.scoreAtGrade = (sn, wayId, at, o = {}) => { const r = oA(sn, wayId, at, o); recs.push({ r }); return r; };
  let out;
  try { out = R.scoreRoute(snap, route, { mode }); } finally { S.scoreStretch = oS; S.scoreAtGrade = oA; }
  if (recs.length !== out.pieces.length) throw new Error(`capture: ${recs.length} factor records for ${out.pieces.length} pieces`);
  const pieces = out.pieces.map((p, i) => {
    const r = recs[i].r;
    const common = { mph: r.speed_mph, V: r.V, assumed: r.flags.includes('speed assumed'), H: Math.round((r.M - 1) / 0.25), M: r.M };
    if (p.kind === 'stretch') {
      if (r.way !== p.way) throw new Error(`capture: stretch ${i} way ${r.way} != ${p.way}`);
      return { kind: 'stretch', way: p.way, side: p.side, at: p.at, length_m: p.length_m, L: recs[i].L, G: r.G, unknown: !!r.unknown, cls: wayClass(snap, p.way), C: r.C, flags: p.flags, finding: p.finding, A0: p.A, ...common };
    }
    if (r.way !== p.way) throw new Error(`capture: crossing ${i} way ${r.way} != ${p.way}`);
    return { kind: 'crossing', way: p.way, node: p.node, at: p.at, Q: r.Q, cmf: r.cmf, N: r.N, T: r.T, tUnknown: r.station == null, flags: p.flags, text: p.text, K0: p.K, ...common };
  });
  return { mode, route_m: out.route_m, rri0: out.rri, pieces };
}

// ---- recompute with changed weights (same formulas and rounding as js/score.js) -----------------------------
function vOf(p, w) { return p.assumed && w.speed_delta ? S.vFromMph(p.mph + w.speed_delta) : p.V; }
function mOf(p, w) { return w.hist_w === 0.25 ? p.M : 1 + w.hist_w * p.H; }
function stretchA(p, w) {
  if (p.C == null) return 0; // motorway: no A (js/route.js)
  const G = p.unknown ? w.G_unknown : p.G;
  const C = w.C_mul[p.cls] === 1 || w.C_mul[p.cls] == null ? p.C : p.C * w.C_mul[p.cls];
  return Math.round(((p.L ?? 100) / 100) * G * C * vOf(p, w) * mOf(p, w) * 1000) / 1000;
}
function qOf(p, w) { return p.Q === 0.3 ? w.Q_signal : p.Q === 0.7 ? w.Q_marked : p.Q === 0.9 ? w.Q_unmarked : w.Q_none; }
function crossingK(p, w) {
  const Q = qOf(p, w);
  const cmf = w.cmf_on ? p.cmf : 1;
  const Qe = p.Q === 0.3 ? Q : Math.round(Q * cmf * 1000) / 1000;
  const T = p.tUnknown && w.T_unknown != null ? w.T_unknown : w.T_mul === 1 ? p.T : p.T * w.T_mul;
  return Math.round(Qe * p.N * T * vOf(p, w) * mOf(p, w) * 1000) / 1000;
}
const pts = (p, w) => (p.kind === 'stretch' ? stretchA(p, w) : crossingK(p, w));

function rriOf(c, w) {
  let rawA = 0, rawK = 0;
  for (const p of c.pieces) if (p.kind === 'stretch') rawA += stretchA(p, w);
  for (const p of c.pieces) if (p.kind === 'crossing') rawK += crossingK(p, w);
  return c.route_m > 0 ? (rawA + rawK) / (c.route_m / 1000) : null;
}
// The findings list as js/report.js builds it (membership by the default category), ranked with weights w.
function findings(c, w) {
  const raw = c.pieces
    .filter((p) => (p.kind === 'stretch' ? p.G >= 0.6 : p.Q >= 0.7))
    .map((p) => (p.kind === 'stretch'
      ? { osm_id: `way/${p.way}`, kind: 'stretch', side: p.side, length_m: p.length_m, points: pts(p, w), text: p.finding, flags: p.flags, at: p.at }
      : { osm_id: p.node != null ? `node/${p.node}` : `way/${p.way}`, kind: 'crossing', points: pts(p, w), text: p.text, flags: p.flags, at: p.at }));
  return dedupe(raw).sort((a, b) => b.points - a.points || (a.fid < b.fid ? -1 : a.fid > b.fid ? 1 : 0));
}

// ---- evaluate one weight set over the demo and reference routes ---------------------------------------------
// data = { demo: [{ id, mode, cap }], ref: { walk: [cap...], bike: [cap...] } }
function evaluate(data, w, withScores = true) {
  const r50 = {};
  if (withScores) for (const m of ['walk', 'bike']) r50[m] = r6(median(data.ref[m].map((c) => rriOf(c, w))));
  const routes = data.demo.map((d) => {
    const rri = rriOf(d.cap, w);
    const list = findings(d.cap, w);
    return { id: d.id, mode: d.mode, rri, score: withScores ? score100(rri, { show_score: true, r50: r50[d.mode] }) : null, fids: list.map((f) => f.fid), list };
  });
  const order = {};
  for (const m of ['walk', 'bike']) order[m] = routes.filter((r) => r.mode === m).sort((a, b) => b.rri - a.rri || (a.id < b.id ? -1 : 1)).map((r) => r.id);
  return { r50, routes, order };
}
function compare(base, ev) {
  const per = base.routes.map((b, i) => {
    const e = ev.routes[i];
    const top = new Set(e.fids.slice(0, 10));
    const overlap = b.fids.slice(0, 10).filter((f) => top.has(f)).length;
    const move = Math.max(...b.fids.slice(0, 3).map((f, r) => Math.abs(e.fids.indexOf(f) - r)));
    return { id: b.id, overlap, top3_move: move, dscore: e.score != null && b.score != null ? e.score - b.score : null, rri: e.rri, score: e.score };
  });
  const changed = ['walk', 'bike'].filter((m) => base.order[m].join() !== ev.order[m].join());
  const orderSame = changed.length === 0;
  const minOverlap = Math.min(...per.map((p) => p.overlap));
  const ds = per.map((p) => p.dscore).filter((x) => x != null);
  return { per, min_overlap: minOverlap, max_top3_move: Math.max(...per.map((p) => p.top3_move)), order_same: orderSame, order_changed: changed,
    dscore_min: ds.length ? Math.min(...ds) : null, dscore_max: ds.length ? Math.max(...ds) : null, pass: minOverlap >= PASS_OVERLAP && orderSame };
}

// ---- the plan -------------------------------------------------------------------------------------------------
// Step 1: one family at a time, about ±50 % (values from crosssafe-spec §a step 1; Q_marked tops out at 1.0, the
// "no mapped crossing" value). Q_unmarked is not in the spec's list; tried because it is part of the same Q spacing.
const STEP1 = [
  { family: 'Sidewalk unknown G (default 0.6)', low: { G_unknown: 0.3 }, high: { G_unknown: 0.9 }, label: '0.3 / 0.9' },
  { family: 'Signalized crossing Q (default 0.3)', low: { Q_signal: 0.15 }, high: { Q_signal: 0.45 }, label: '0.15 / 0.45' },
  { family: 'Marked crossing Q (default 0.7)', low: { Q_marked: 0.35 }, high: { Q_marked: 1.0 }, label: '0.35 / 1.0' },
  { family: 'Unmarked crossing Q (default 0.9)', low: { Q_unmarked: 0.45 }, high: { Q_unmarked: 1.0 }, label: '0.45 / 1.0' },
  { family: 'Road class C (all classes)', low: { C_all: 0.5 }, high: { C_all: 1.5 }, label: '×0.5 / ×1.5' },
  { family: 'Traffic T (all values)', low: { T_mul: 0.5 }, high: { T_mul: 1.5 }, label: '×0.5 / ×1.5' },
  { family: 'History weight (default 0.25)', low: { hist_w: 0 }, high: { hist_w: 0.5 }, label: '0 / 0.5' },
  { family: 'Crossing CMFs (island, RRFB, PHB)', low: { cmf_on: false }, high: null, label: 'off' },
];
const STEP3 = { family: 'Assumed speeds (untagged roads)', low: { speed_delta: -5 }, high: { speed_delta: 5 }, label: '−5 / +5 mph' };
const MC_KEYS = ['G_unknown', 'Q_signal', 'Q_marked', 'Q_unmarked', ...CLASSES.map((c) => 'C_' + c)];

function monteCarlo(data, base, draws = MC_DRAWS, seed = SENS_SEED) {
  const rnd = mulberry32(seed);
  const d0 = weights();
  const stay = base.routes.map((b) => Object.fromEntries(b.fids.slice(0, 10).map((f) => [f, 0])));
  const same = base.routes.map(() => 0);
  const orderSame = { walk: 0, bike: 0 };
  for (let k = 0; k < draws; k++) {
    const over = { C_mul: {} };
    for (const key of MC_KEYS) {
      const f = MC_LO + (MC_HI - MC_LO) * rnd();
      if (key.startsWith('C_')) over.C_mul[key.slice(2)] = f; else over[key] = d0[key] * f;
    }
    const ev = evaluate(data, weights(over), false);
    ev.routes.forEach((e, i) => {
      const top = e.fids.slice(0, 10);
      const set = new Set(top);
      for (const f of Object.keys(stay[i])) if (set.has(f)) stay[i][f] += 1;
      const bt = new Set(base.routes[i].fids.slice(0, 10));
      if (top.length === bt.size && top.every((f) => bt.has(f))) same[i] += 1;
    });
    for (const m of ['walk', 'bike']) if (ev.order[m].join() === base.order[m].join()) orderSame[m] += 1;
  }
  const per = base.routes.map((b, i) => {
    const shares = Object.values(stay[i]).map((n) => n / draws);
    return { id: b.id, same_top10: same[i], stable: shares.filter((s) => s >= STABLE).length, of: shares.length, min_share: Math.min(...shares) };
  });
  return { draws, seed, keys: MC_KEYS, lo: MC_LO, hi: MC_HI, per, order_same: orderSame };
}

function run(data) {
  const w0 = weights();
  const base = evaluate(data, w0);
  const rows = [];
  for (const f of [...STEP1, STEP3]) {
    const low = compare(base, evaluate(data, weights(f.low)));
    const high = f.high ? compare(base, evaluate(data, weights(f.high))) : null;
    rows.push({ family: f.family, label: f.label, low, high, step: f === STEP3 ? 3 : 1 });
  }
  const best = evaluate(data, weights({ G_unknown: 0.1, T_unknown: 1.0 }));
  const worst = evaluate(data, weights({ G_unknown: 1.0, T_unknown: 1.6 }));
  const bounds = base.routes.map((b, i) => ({ id: b.id, mode: b.mode, score: b.score, best: best.routes[i].score, worst: worst.routes[i].score, rri: b.rri, rri_best: best.routes[i].rri, rri_worst: worst.routes[i].rri }));
  const all = data.demo.flatMap((d) => d.cap.pieces);
  const counts = {
    pieces: all.length,
    stretches: all.filter((p) => p.kind === 'stretch').length,
    crossings: all.filter((p) => p.kind === 'crossing').length,
    g_unknown: all.filter((p) => p.kind === 'stretch' && p.unknown).length,
    speed_assumed: all.filter((p) => p.assumed).length,
    t_unknown: all.filter((p) => p.kind === 'crossing' && p.tUnknown).length,
    h_nonzero: all.filter((p) => p.H !== 0).length,
    cmf: all.filter((p) => p.kind === 'crossing' && p.cmf !== 1).length,
    ref_routes: data.ref.walk.length + data.ref.bike.length,
  };
  return { seed: SENS_SEED, base: { r50: base.r50, order: base.order, routes: base.routes.map((r) => ({ id: r.id, mode: r.mode, rri: r.rri, score: r.score, findings: r.fids.length })) }, rows, bounds, mc: monteCarlo(data, base), counts };
}

// ---- README block -------------------------------------------------------------------------------------------
const BLOCK_START = '<!-- sensitivity:start (written by node scripts/sensitivity.js --readme; do not edit by hand) -->';
const BLOCK_END = '<!-- sensitivity:end -->';
const sgn = (x) => (x > 0 ? '+' + x : String(x).replace('-', '−'));
const rng = (c) => (c.dscore_min === c.dscore_max ? sgn(c.dscore_min) : `${sgn(c.dscore_min)} to ${sgn(c.dscore_max)}`);
const cell = (c) => `${c.min_overlap} of 10 · ${c.max_top3_move} · ${c.order_same ? 'same' : `**changed (${c.order_changed.join(', ')})**`} · ${rng(c)}`;
const f2 = (x) => x.toFixed(2);
function readmeBlock(res) {
  const n = res.counts;
  const L = [BLOCK_START, '### What if you disagree with the weights? (sensitivity check)', ''];
  L.push(`Several weights are judgment calls, not published values (crosssafe-spec.md "Weights and why"). \`node scripts/sensitivity.js\` changes them one family at a time and re-ranks the findings of the 6 saved routes (${n.pieces} scored pieces: ${n.stretches} stretches, ${n.crossings} crossings) and the ${n.ref_routes} reference routes, using the app's own scoring code. Each cell reads: **top-10 findings kept** (worst of the 6 routes) · **largest move of a top-3 finding** (places) · **order of the 3 saved routes per mode** · **change in the 0-100 score** (R₅₀ recomputed with the same weights). It passes when at least 8 of the top 10 stay and the route order does not change.`);
  L.push('');
  L.push('| Weight family | Values tried (low / high) | Low | High | Passes? |');
  L.push('|---|---|---|---|---|');
  for (const r of res.rows) {
    const pass = r.low.pass && (!r.high || r.high.pass);
    L.push(`| ${r.family} | ${r.label} | ${cell(r.low)} | ${r.high ? cell(r.high) : 'n/a'} | ${pass ? 'yes' : '**no**'} |`);
  }
  L.push('');
  const noEffect = [];
  if (n.h_nonzero === 0) noEffect.push('the history weight (every piece has M = 1: crash and High Injury Network rows are not in this repo)');
  if (n.cmf === 0) noEffect.push(`the crossing CMFs (none of the ${n.crossings} crossings on the saved routes is tagged with an island, RRFB or PHB)`);
  if (n.t_unknown === n.crossings) noEffect.push('the split between traffic bands (every crossing uses T = 1.3 "traffic count unknown", so only the overall T level is tested)');
  if (noEffect.length) L.push(`- Rows that cannot change anything with the committed data: ${noEffect.join('; ')}. A passing row there says nothing about those weights. The crash severity (KABCO) weights are not tried for the same reason.`);
  const both = (r) => [r.low, r.high].filter(Boolean);
  const lowTop = res.rows.filter((r) => both(r).some((c) => c.min_overlap < PASS_OVERLAP)).map((r) => r.family);
  const ordered = res.rows.filter((r) => both(r).some((c) => !c.order_same)).map((r) => `${r.family}: ${[...new Set(both(r).flatMap((c) => c.order_changed))].join(', ')}`);
  L.push(lowTop.length ? `- Fewer than 8 of a route's top 10 findings stayed for: ${lowTop.join('; ')}. The findings list depends on these judgment weights.` : '- At least 8 of every route\'s top 10 findings stayed in every row.');
  if (ordered.length) {
    const near = ['walk', 'bike'].map((m) => {
      const rs = res.base.routes.filter((r) => r.mode === m).sort((a, b) => b.rri - a.rri);
      const gap = Math.min(...rs.slice(1).map((r, i) => rs[i].rri - r.rri));
      return `${m}: ${rs.map((r) => `${r.id} ${f2(r.rri)}`).join(' > ')} (closest gap ${f2(gap)})`;
    });
    L.push(`- The order of the saved routes changed for: ${ordered.join('; ')}. With the default weights the routes rank, in risk points per km, ${near.join('; ')}. Routes this close should be read as about equal, not as ranked.`);
  }
  if (!lowTop.length && !ordered.length) L.push('- Every row passes.');
  const mv = Math.max(...res.rows.flatMap((r) => both(r).map((c) => c.max_top3_move)));
  L.push(`- A top-3 finding moved at most ${mv} place${mv === 1 ? '' : 's'} in any row (score-sensitivity-test-spec S2 allows 1).`);
  L.push(`- Unknown data at best and at worst (every unknown sidewalk G = 0.1 / 1.0 and every unknown traffic T = 1.0 / 1.6; ${n.g_unknown} unknown-sidewalk stretches and ${n.t_unknown} unknown-traffic crossings on the saved routes), 0-100 score with R₅₀ recomputed the same way: ` +
    res.bounds.map((b) => `${b.id} ${b.score} (unknowns at best ${b.best}, at worst ${b.worst}; risk per km ${f2(b.rri)}, at best ${f2(b.rri_best)}, at worst ${f2(b.rri_worst)})`).join('; ') + `. ${res.bounds.filter((b) => Math.abs(b.worst - b.best) > RANGE_PTS).length} of 6 scores differ by more than ${RANGE_PTS} points, so no score is shown as a range. The 0-100 score moves little because the reference routes move with it; the risk per km moves more.`);
  const mc = res.mc;
  L.push(`- Random draws: ${mc.draws} draws (seed ${mc.seed}, mulberry32), each of ${mc.keys.length} judgment weights (unknown-sidewalk G, the three crossing-control values, the ${CLASSES.length} road-class values) multiplied by a random factor between ${mc.lo} and ${mc.hi}. Same top-10 set as the default weights in: ` +
    mc.per.map((p) => `${p.id} ${p.same_top10}`).join('; ') + `. Findings that stay in the top 10 in at least ${Math.round(STABLE * 100)} % of draws: ` + mc.per.map((p) => `${p.stable} of ${p.of}`).join(', ') +
    `. Route order unchanged in ${mc.order_same.walk} (walk) and ${mc.order_same.bike} (bike) of ${mc.draws} draws.`);
  L.push(`- ${n.speed_assumed} of the ${n.pieces} pieces use an assumed speed (the road has no \`maxspeed\` tag); the "Assumed speeds" row moves every one of them 5 mph down or up.`);
  L.push('- Not run: changing the matching radii (spec step 4; the radii are fixed in `js/score.js`) and checking crash points against the riskiest pieces (step 6; crash rows are not in this repo). The check ranks each saved route\'s own findings, not every piece within 1 mile of the school as the spec first planned, because the app scores routes. CI re-derives every number in this block (`tests/sensitivity.test.js`).');
  L.push(BLOCK_END);
  return L.join('\n');
}
function blockOf(text) {
  const a = text.indexOf(BLOCK_START), b = text.indexOf(BLOCK_END);
  return a >= 0 && b > a ? text.slice(a, b + BLOCK_END.length) : null;
}

module.exports = {
  SENS_SEED, MC_DRAWS, PASS_OVERLAP, CLASSES, STEP1, STEP3, MC_KEYS, weights, capture, stretchA, crossingK, rriOf, findings,
  evaluate, compare, monteCarlo, run, readmeBlock, blockOf, BLOCK_START, BLOCK_END,
};
