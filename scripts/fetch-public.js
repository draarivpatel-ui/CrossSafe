'use strict';
// Public-domain / public sources that ARE committed (data-manifest #7, #8):
//   NCES EDGE school locations -> data/raw/schools.json   (US federal, public domain)
//   Census Reporter ACS B16001 (Fort Bend County) -> data/raw/languages.json
// Usage: node scripts/fetch-public.js [schools|languages ...]   (default: both)
const fs = require('fs');
const path = require('path');
const { ROOT, isoNow, update, curl } = require('./lib/sources');

const SOURCES = {
  schools: {
    file: 'data/raw/schools.json',
    url: "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_GEOCODE_PUBLICSCH_2223/MapServer/0/query?where=NAME%20LIKE%20%27DULLES%25%27&outFields=NAME,NCESSCH,LAT,LON,STREET&f=json",
    licence: 'LicenseRef-US-PD-NCES',
    check: (d) => {
      const hs = (d.features || []).filter((f) => f.attributes && String(f.attributes.NCESSCH) === '481965001818');
      if (hs.length !== 1) throw new Error('schools: NCESSCH 481965001818 not found exactly once (never take the first row)');
      return { note: 'Dulles HS = NCESSCH 481965001818 (selected by id, not row order)' };
    },
  },
  languages: {
    file: 'data/raw/languages.json',
    url: 'https://api.censusreporter.org/1.0/data/show/latest?table_ids=B16001&geo_ids=05000US48157',
    licence: 'LicenseRef-ACS-public',
    check: (d) => {
      if (!d.tables || !d.tables.B16001 || !d.data || !d.data['05000US48157']) throw new Error('languages: B16001 / 05000US48157 missing');
      return { data_as_of: (d.release && d.release.name) || undefined };
    },
  },
};

const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SOURCES);
for (const k of which) {
  const s = SOURCES[k];
  const out = path.join(ROOT, s.file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out + '.part';
  const buf = curl(s.url, tmp);
  const extra = s.check(JSON.parse(buf.toString('utf8')));
  fs.renameSync(tmp, out);
  update((src) => {
    src.files[s.file] = { source_url: s.url, fetched_at: isoNow(), licence: s.licence };
    if (extra.data_as_of) src.files[s.file].data_as_of = extra.data_as_of;
  });
  console.log(`${k}: ${s.file} ${buf.length} B${extra.note ? ' · ' + extra.note : ''}${extra.data_as_of ? ' · ' + extra.data_as_of : ''}`);
}
