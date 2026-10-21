'use strict';
// R50 reference routes, step A (kickoff-runbook 5:30 row; crosssafe-spec §a + T16-T18).
// For every seeded point in data/ref/points.json: one routed-foot and one routed-bike call to the NCES school point on
// the FOSSGIS servers (routing.openstreetmap.de only; router.project-osrm.org /foot/ returns CAR routes), one request at
// a time, >= 1.1 s apart (FOSSGIS policy: max 1 req/s, valid UA + referrer), up to 3 retries 8 s apart on HTTP 000/429/5xx.
// Each reply -> data/routes/ref/{walk,bike}/<wayId>.json (OSRM reply + meta). A call that still fails is saved as
// {error, http_status, meta} so step B (T17/T18) counts it as a failure; no redraws.
// Usage: node scripts/fetch-ref.js [--mode walk|bike] [--force]
//   Re-running skips points whose file already holds an OSRM "Ok" reply (resumable); --force refetches everything.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, UA, isoNow, update } = require('./lib/sources');
const { NCES_POINT } = require('../js/ref.js');

const PROFILE = { walk: 'routed-foot', bike: 'routed-bike' };
const BASE = 'https://routing.openstreetmap.de/%P/route/v1/driving/%S;%E?overview=full&geometries=geojson&steps=true';
const REFERER = 'https://github.com/draarivpatel-ui/CrossSafe';
const GAP_MS = 1100, BACKOFF_MS = 8000, RETRIES = 3;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? null : process.argv[i + 1]; };
const force = process.argv.includes('--force');
const modes = arg('--mode') ? [arg('--mode')] : ['walk', 'bike'];

const pts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ref', 'points.json'), 'utf8'));
let last = 0;
function get(url, tmp) {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) sleep(wait);
  let code = '000';
  try {
    code = execFileSync('curl', ['-sS', '-m', '60', '-A', UA, '-e', REFERER, '-o', tmp, '-w', '%{http_code}', url],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) { code = (e.stdout || '000').toString().trim() || '000'; }
  last = Date.now();
  return code;
}
const okFile = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).code === 'Ok'; } catch (e) { return false; } };

const at = {};
for (const mode of modes) {
  const prof = PROFILE[mode];
  if (!prof) throw new Error(`unknown mode ${mode}`);
  const dir = path.join(ROOT, 'data', 'routes', 'ref', mode);
  fs.mkdirSync(dir, { recursive: true });
  let ok = 0, fail = 0, skip = 0;
  for (const p of pts.points) {
    const out = path.join(dir, `${p.way_id}.json`), tmp = out + '.part';
    if (!force && okFile(out)) { skip++; ok++; continue; }
    const url = BASE.replace('%P', prof).replace('%S', `${p.lon},${p.lat}`).replace('%E', `${NCES_POINT[1]},${NCES_POINT[0]}`);
    let code, body = null;
    for (let a = 0; a <= RETRIES; a++) {
      if (a) sleep(BACKOFF_MS);
      code = get(url, tmp);
      body = null;
      try { body = JSON.parse(fs.readFileSync(tmp, 'utf8')); } catch (e) { /* not JSON */ }
      if (!(code === '000' || code === '429' || code[0] === '5')) break;
    }
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    const meta = {
      ref: true, way_id: p.way_id, mode, seed: pts.seed, source_url: url, fetched_at: isoNow(), start: [p.lat, p.lon],
      destination: { nces_id: '481965001818', lat: NCES_POINT[0], lon: NCES_POINT[1] },
      licence: 'ODbL-1.0', attribution: '© OpenStreetMap contributors; routing: FOSSGIS routing.openstreetmap.de (OSRM)',
    };
    at[mode] = meta.fetched_at;
    let rec;
    if (code === '200' && body && body.code === 'Ok') { rec = body; ok++; }
    else {
      rec = { error: body && body.code ? body.code : `HTTP ${code}`, http_status: Number(code) || 0 };
      if (body && body.message) rec.message = body.message;
      fail++;
    }
    rec.meta = meta;
    fs.writeFileSync(out, JSON.stringify(rec) + '\n');
    const rt = rec.routes && rec.routes[0];
    console.log(`${mode}/${p.way_id} HTTP ${code} ${rt ? `${rt.distance.toFixed(0)} m ${(rt.distance / rt.duration * 3.6).toFixed(2)} km/h` : rec.error}`);
  }
  console.log(`${mode}: ${ok} Ok (${skip} cached), ${fail} failed, of ${pts.points.length}`);
}
update((s) => {
  for (const mode of Object.keys(PROFILE)) {
    const dir = path.join(ROOT, 'data', 'routes', 'ref', mode);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const key = `data/routes/ref/${mode}/*.json`;
    const prev = s.files[key] || {};
    const times = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).meta.fetched_at).sort();
    s.files[key] = {
      source_url: `https://routing.openstreetmap.de/${PROFILE[mode]}/route/v1/driving/ (scripts/fetch-ref.js)`,
      fetched_at: times[times.length - 1] || prev.fetched_at, licence: 'ODbL-1.0', count: files.length,
    };
  }
});
