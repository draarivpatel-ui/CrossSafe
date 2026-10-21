'use strict';
// Derived TxDOT / H-GAC values (committed) from the raw layers in RAW_DIR (never committed).
// TxDOT's item licence forbids redistributing the rows; H-GAC's HIN layer states no licence. So only
// aggregate counts go in data/derived-txdot.json; per-segment AADT classes and HIN weights are added
// by the scoring step from the same raw files. Usage: RAW_DIR=<dir> node scripts/derive-txdot.js
const fs = require('fs');
const path = require('path');
const { ROOT, isoNow, sha256, update } = require('./lib/sources');

const RAW_DIR = process.env.RAW_DIR || path.join(ROOT, 'data', 'raw');
const OUT_REL = 'data/derived-txdot.json';
const log = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'fetch-log.json'), 'utf8'));
const read = (id) => { const buf = fs.readFileSync(path.join(RAW_DIR, id + '.json')); return { buf, d: JSON.parse(buf.toString('utf8')) }; };
const attrs = (d) => (d.features || []).map((f) => f.attributes);
const tally = (rows, key) => { const o = {}; for (const r of rows) { const k = String(r[key]); o[k] = (o[k] || 0) + 1; } return o; };

const A = read('aadt'), C = read('crashes-2020-2024'), H = read('hin');
const aadt = attrs(A.d), crashes = attrs(C.d), hin = attrs(H.d);
const years = [...new Set(aadt.map((r) => r.AADT_RPT_YEAR))].sort();
const byRoad = {};
for (const r of aadt) {
  const k = r.ON_ROAD || '(unnamed)';
  const e = byRoad[k] || (byRoad[k] = { stations: 0, aadt_min: null, aadt_max: null });
  e.stations++;
  e.aadt_min = e.aadt_min === null ? r.AADT_RPT_QTY : Math.min(e.aadt_min, r.AADT_RPT_QTY);
  e.aadt_max = e.aadt_max === null ? r.AADT_RPT_QTY : Math.max(e.aadt_max, r.AADT_RPT_QTY);
}
const crashYear = (r) => new Date(r.crash_date).getUTCFullYear();
const out = {
  schema: 1,
  note: 'Aggregates only. Raw TxDOT/H-GAC rows are not redistributed (TxDOT item licence; H-GAC states no licence).',
  zone: { center: [29.619752, -95.584352], radius_m: 3218.69 },
  aadt: { stations: aadt.length, report_years: years, by_road: Object.fromEntries(Object.keys(byRoad).sort().map((k) => [k, byRoad[k]])) },
  crashes_2020_2024: {
    total: crashes.length,
    pedestrian: crashes.filter((r) => r.pedestrian_involved_fl === 1).length,
    bicyclist: crashes.filter((r) => r.bicyclist_involved_fl === 1).length,
    by_crash_sev_id: tally(crashes, 'crash_sev_id'),
    by_year: tally(crashes.map((r) => ({ y: crashYear(r) })), 'y'),
  },
  hin: { segments: hin.length, routes: new Set(hin.map((r) => r.ria_rte_id)).size, by_tier_all: tally(hin, 'tier_all'), by_tier_ped: tally(hin, 'tier_ped') },
};
fs.writeFileSync(path.join(ROOT, OUT_REL), JSON.stringify(out, null, 2) + '\n');
const now = isoNow();
update((s) => {
  s.files[OUT_REL] = { source_url: 'scripts/derive-txdot.js', fetched_at: now, licence: 'LicenseRef-CrossSafe-derived', derived_from: ['aadt', 'crashes-2020-2024', 'hin'] };
  const entry = (id, R, rows, lic, asOf) => ({ status: 'included', source_url: log[id].source_url, fetched_at: log[id].fetched_at,
    data_as_of: asOf, bytes: R.buf.length, sha256: sha256(R.buf), rows, stored_at: `$RAW/${id}.json`,
    clone_path: `data/raw/${id}.json`, licence: lic, committed: false });
  s.raw.aadt = entry('aadt', A, aadt.length, 'LicenseRef-TxDOT-no-redistribution', years.join(','));
  s.raw['crashes-2020-2024'] = entry('crashes-2020-2024', C, crashes.length, 'LicenseRef-TxDOT-no-redistribution', '2020-2024');
  s.raw.hin = entry('hin', H, hin.length, 'LicenseRef-HGAC-none-stated', 'draft Safety Action Plan layer');
  if (!s.raw['cris-2025-2026'] || s.raw['cris-2025-2026'].status !== 'included') {
    s.raw['cris-2025-2026'] = { status: 'not_included', source_url: 'https://cris.dot.state.tx.us/public/Query/app/home',
      query: 'Units; Crash Years 2025-2026; County FORT BEND; Unit Description 3-PEDALCYCLIST, 4-PEDESTRIAN',
      attempted_at: now, reason: 'Browser-only export not run yet (planned re-pull Sat Oct 17)',
      licence: 'LicenseRef-TxDOT-no-redistribution', committed: false };
  }
});
console.log(`derived ${OUT_REL}: aadt ${aadt.length} (years ${years}), crashes ${crashes.length}, hin ${hin.length}`);
