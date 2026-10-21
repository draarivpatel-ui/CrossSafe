'use strict';
// Writes data/ref/points.json from the committed slim snapshot (R50 step A, kickoff-runbook 5:30 row; T16).
// Offline and deterministic: same snapshot + REF_SEED -> same bytes. Usage: node scripts/ref-points.js
const fs = require('fs');
const path = require('path');
const { ROOT, update } = require('./lib/sources');
const { buildSample, serializeSample, REF_SEED } = require('../js/ref.js');

const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'osm-dulles.json'), 'utf8'));
const s = buildSample(snapshot, REF_SEED);
const out = path.join(ROOT, 'data', 'ref', 'points.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, serializeSample(s));
console.log(`points.json: seed ${s.seed}, ${s.n_drawn} of ${s.n_candidates} candidates, osm_base ${s.osm_base}`);
const slim = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sources.json'), 'utf8')).files['data/osm-dulles.json'];
update((src) => {
  src.files['data/ref/points.json'] = {
    source_url: 'scripts/ref-points.js (from data/osm-dulles.json, REF_SEED 20261016)',
    fetched_at: slim.fetched_at, licence: 'ODbL-1.0', osm_base: s.osm_base, count_points: s.n_drawn,
  };
});
