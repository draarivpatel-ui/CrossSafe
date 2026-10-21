'use strict';
// Cached walk + bike routes from each public anchor in data/routes/anchors.json to Dulles HS (data-manifest #6,
// crosssafe-spec §a, privacy-test-spec P9). FOSSGIS demo servers only (routing.openstreetmap.de routed-foot /
// routed-bike; router.project-osrm.org /foot/ returns CAR routes), one request at a time, >= 1.1 s apart, cached:
// the app never calls OSRM live. Writes data/routes/<anchor-slug>-{walk,bike}.json and the sources.json entries.
// Usage: node scripts/fetch-routes.js
const fs = require('fs');
const path = require('path');
const { ROOT, isoNow, curl, update } = require('./lib/sources');

const DIR = path.join(ROOT, 'data', 'routes');
const PROFILE = { walk: 'routed-foot', bike: 'routed-bike' };
const BASE = 'https://routing.openstreetmap.de/%P/route/v1/driving/%S;%E?overview=full&geometries=geojson&steps=true';
// Way anchors (parks) start at one outline vertex on a public path, never a vertex on a residential cul-de-sac:
// Lost Creek Park geometry[41] snaps 0.6 m to the park path on routed-foot and routed-bike (OSRM nearest, Oct 16, 2026).
const START_VERTEX = { 'way/543759642': 41 };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const slug = (s) => s.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const doc = JSON.parse(fs.readFileSync(path.join(DIR, 'anchors.json'), 'utf8'));
const school = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'osm-dulles.json'), 'utf8')).school;
let first = true;
const at = {};
for (const a of doc.anchors) {
  const key = `${a.osm_type}/${a.osm_id}`;
  let start;
  if (a.osm_type === 'node') start = [a.lat, a.lon];
  else if (key in START_VERTEX) start = a.geometry[START_VERTEX[key]];
  else throw new Error(`${key}: way anchor without a START_VERTEX entry`);
  for (const [mode, prof] of Object.entries(PROFILE)) {
    if (!first) sleep(1100);
    first = false;
    const url = BASE.replace('%P', prof).replace('%S', `${start[1]},${start[0]}`).replace('%E', `${school.lon},${school.lat}`);
    const out = path.join(DIR, `${slug(a.name)}-${mode}.json`);
    const r = JSON.parse(curl(url, out + '.part').toString('utf8'));
    fs.unlinkSync(out + '.part');
    if (r.code !== 'Ok' || !r.routes || !r.routes.length) throw new Error(`${key} ${mode}: OSRM code ${r.code}`);
    at[mode] = isoNow();
    r.meta = {
      anchor: { osm_type: a.osm_type, osm_id: a.osm_id, kind: a.kind, name: a.name },
      demo: false, mode, source_url: url, fetched_at: at[mode], start, start_from: a.osm_type === 'node' ? 'node' : `geometry[${START_VERTEX[key]}]`,
      destination: { name: school.name, nces_id: school.nces_id, lat: school.lat, lon: school.lon },
      licence: 'ODbL-1.0', attribution: '© OpenStreetMap contributors; routing: FOSSGIS routing.openstreetmap.de (OSRM)',
    };
    fs.writeFileSync(out, JSON.stringify(r) + '\n');
    const rt = r.routes[0];
    console.log(`${path.basename(out)} ${rt.distance.toFixed(0)} m ${rt.duration.toFixed(0)} s ${(rt.distance / rt.duration * 3.6).toFixed(2)} km/h`);
  }
}
update((s) => {
  s.files['data/routes/anchors.json'] = { source_url: doc.endpoint, fetched_at: doc.fetched_at, licence: 'ODbL-1.0', osm_base: doc.osm_base, count_anchors: doc.anchors.length };
  for (const [mode, prof] of Object.entries(PROFILE)) {
    const n = fs.readdirSync(DIR).filter((f) => f.endsWith(`-${mode}.json`)).length;
    s.files[`data/routes/*-${mode}.json`] = { source_url: `https://routing.openstreetmap.de/${prof}/route/v1/driving/ (scripts/fetch-routes.js)`, fetched_at: at[mode], licence: 'ODbL-1.0', count: n };
  }
});
