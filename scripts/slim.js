'use strict';
// Slim the raw Overpass Q1 reply (never committed) into data/osm-dulles.json (ODbL Derivative Database).
// Usage: RAW_DIR=<dir with osm-q1.json> OVP_EP=<interpreter that served it> node scripts/slim.js
// Keeps only the tag keys in scripts/osm-keep-list.json (test-spec O35), compact [lat,lon] pairs rounded
// to 6 decimals (O36 d), way node-id lists on arterial ways only (O36 a/b), no tiger:* (O36 c).
const fs = require('fs');
const path = require('path');
const { ROOT, isoNow, sha256, update } = require('./lib/sources');
const { snapshotCounts } = require('../js/snapshot');

const RAW_DIR = process.env.RAW_DIR || path.join(ROOT, 'data', 'raw');
const RAW_FILE = path.join(RAW_DIR, 'osm-q1.json');
const OUT_REL = 'data/osm-dulles.json';
const OUT = path.join(ROOT, OUT_REL);
const KEEP = JSON.parse(fs.readFileSync(path.join(__dirname, 'osm-keep-list.json'), 'utf8'));
const ARTERIAL = /^(trunk|primary|secondary|tertiary)(_link)?$/;
const SCHOOL = { name: 'Dulles High School', nces_id: '481965001818', lat: 29.619752, lon: -95.584352, radius_m: 3219 };

const P2_BUDGET = 1500000; // performance-budget-spec P2: slim file <= 1.5 MB raw
let DP = 6;
const r6 = (x) => Math.round(x * 10 ** DP) / 10 ** DP;
const keepKey = (k) => !k.startsWith('tiger:') && (KEEP.includes(k) || (k.startsWith('sidewalk:') && KEEP.includes('sidewalk:*')));
function slimTags(t) {
  const o = {};
  for (const k of Object.keys(t || {}).sort()) if (keepKey(k)) o[k] = t[k];
  return o;
}

const buf = fs.readFileSync(RAW_FILE);
const raw = JSON.parse(buf.toString('utf8'));
if (raw.remark) throw new Error('raw reply has a remark: not slimmed (runbook 2:15 accept check a)');
const osmBase = raw.osm3s && raw.osm3s.timestamp_osm_base;
if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(osmBase || '')) throw new Error('osm_base is not ISO-Z: ' + osmBase);

function build() {
  const seen = new Set();
  const elements = [];
  for (const e of raw.elements) {
    const key = e.type + '/' + e.id;
    if (seen.has(key)) continue; // N8: one record per (type, id)
    seen.add(key);
    if (e.type === 'node') {
      elements.push({ type: 'node', id: e.id, lat: r6(e.lat), lon: r6(e.lon), tags: slimTags(e.tags) });
    } else if (e.type === 'way') {
      const w = { type: 'way', id: e.id, tags: slimTags(e.tags), geometry: (e.geometry || []).map((g) => [r6(g.lat), r6(g.lon)]) };
      if (ARTERIAL.test((e.tags || {}).highway || '')) {
        if (!Array.isArray(e.nodes) || e.nodes.length !== w.geometry.length) throw new Error('arterial way ' + e.id + ': nodes/geometry mismatch');
        w.nodes = e.nodes;
      }
      elements.push(w);
    } else if (e.type === 'relation') {
      elements.push({ type: 'relation', id: e.id, tags: slimTags(e.tags) });
    }
  }
  const snap = { schema: 1, school: SCHOOL, osm_base: osmBase, coord_decimals: DP, licence: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)', elements };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snap) + '\n');
  return snap;
}
let snap = build();
// P2 trim order step 2 (performance-budget-spec): over budget at 6 decimals -> round every coordinate to 5 decimals and stop.
if (fs.statSync(OUT).size > P2_BUDGET) { DP = 5; snap = build(); }
const bytes = fs.statSync(OUT).size;
const { ways, nodes } = snapshotCounts(snap);
const now = isoNow();
update((s) => {
  s.files[OUT_REL] = { source_url: 'scripts/slim.js', fetched_at: now, licence: 'ODbL-1.0', osm_base: osmBase,
    bytes, ways, nodes, coord_decimals: DP, p2_budget_bytes: P2_BUDGET, p2_met: bytes <= P2_BUDGET, derived_from: ['osm-q1'] };
  s.raw['osm-q1'] = { status: 'included', source_url: process.env.OVP_EP || 'unknown',
    query_file: 'scripts/q1.overpassql', fetched_at: process.env.Q1_FETCHED_AT || now, osm_base: osmBase,
    bytes: buf.length, sha256: sha256(buf), elements: raw.elements.length,
    stored_at: '$RAW/osm-q1.json', clone_path: 'data/raw/osm-q1.json', licence: 'ODbL-1.0', committed: false };
});
console.log(`slim ${OUT_REL} bytes=${bytes} ways=${ways} nodes=${nodes} dp=${DP} p2=${bytes <= P2_BUDGET ? 'met' : 'over'} (raw ${buf.length} B, ${raw.elements.length} elements, osm_base ${osmBase})`);
