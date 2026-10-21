'use strict';
// Fetch the licensed TxDOT / H-GAC layers (data-manifest #2, #3, #5) for the 2-mile zone around Dulles HS.
// These rows are NOT redistributed: they are written to RAW_DIR (default data/raw/, gitignored) and only
// derived values (scripts/derive-txdot.js -> data/derived-txdot.json) are committed.
// Usage: RAW_DIR=<dir> node scripts/fetch.js
const fs = require('fs');
const path = require('path');
const { ROOT, isoNow, curl } = require('./lib/sources');

const RAW_DIR = process.env.RAW_DIR || path.join(ROOT, 'data', 'raw');
const A = 'geometry=-95.584352,29.619752&geometryType=esriGeometryPoint&inSR=4326&distance=3218.69&units=esriSRUnit_Meter&outSR=4326&f=json';
const LAYERS = {
  aadt: 'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_AADT_Annuals_(Public_View)/FeatureServer/0/query?where=1%3D1&' + A +
    '&outFields=TRFC_STATN_ID,ON_ROAD,AADT_RPT_YEAR,AADT_RPT_QTY,AADT_RPT_HIST_01_QTY,AADT_RPT_HIST_02_QTY',
  'crashes-2020-2024': 'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TXDOT_Statewide_Bicyclist_Involved_Crashes/FeatureServer/0/query?where=pedestrian_involved_fl%3D1%20OR%20bicyclist_involved_fl%3D1&' + A +
    '&outFields=crash_id,crash_date,crash_time,crash_sev_id,pedestrian_involved_fl,bicyclist_involved_fl',
  hin: 'https://services2.arcgis.com/S5d6CWOTC6u65yob/arcgis/rest/services/High_Injury_Network/FeatureServer/0/query?where=1%3D1&' + A +
    '&outFields=ria_rte_id,frm_dfo,to_dfo,jurisdictn,hin_all,tier_all,hin_ped,tier_ped,hin_bike,tier_bike,hin_vru,K_ped_cnt,K_bike_cnt,A_ped_cnt,A_bike_cnt,B_ped_cnt,B_bike_cnt',
};
fs.mkdirSync(RAW_DIR, { recursive: true });
const logPath = path.join(RAW_DIR, 'fetch-log.json');
const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : {};
for (const [id, url] of Object.entries(LAYERS)) {
  const out = path.join(RAW_DIR, id + '.json');
  const buf = curl(url, out + '.part');
  const d = JSON.parse(buf.toString('utf8'));
  if (d.error) throw new Error(id + ': ArcGIS error ' + JSON.stringify(d.error));
  if (d.exceededTransferLimit) throw new Error(id + ': exceededTransferLimit (reply truncated)');
  fs.renameSync(out + '.part', out);
  log[id] = { source_url: url, fetched_at: isoNow() };
  console.log(`${id}: ${(d.features || []).length} features, ${buf.length} B`);
}
fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');
