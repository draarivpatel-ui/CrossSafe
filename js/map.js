'use strict';
// Map view (wave 184, Fri Oct 16, 2026): exactly a11y-test-spec A2 'Map setup, one block' + CS-W1-PINS hazard pins +
// the W3 row button, with Leaflet 1.9.4 from unpkg (SRI) and tiles from tile.openstreetmap.org (build-plan Sat
// 9:00-11:00 row, kickoff-runbook Notes, attribution.md). This is the ONLY file allowed to name an outside URL
// (tests/ui.test.js U1 / U7), and the two hosts below are the whole runtime allow-list (performance-budget P5,
// privacy-test-spec P2, browser-checks-b1-b3-plan §3b).
// The pure parts (constants, pins(), routeLatLngs(), showOnMapNames()) run in Node for the unit tests; createMap()
// needs the browser's Leaflet global and is driven by js/app.js. Nothing here caches or pre-fetches a tile, and no
// tile request is answered by our code: the browser's own HTTP cache handles tiles (OSMF Tile Usage Policy,
// test-spec §K).
const I = require('./i18n.js');

const LEAFLET_HOST = 'unpkg.com';
const TILE_HOST = 'tile.openstreetmap.org';
const ALLOWED_HOSTS = [LEAFLET_HOST, TILE_HOST];
// Integrity hashes as published on https://leafletjs.com/download.html (re-read Fri Oct 16, 2026 ~8:00 PM EDT) and
// re-computed from the unpkg bytes the same evening (sha256, base64): both matched.
const LEAFLET = {
  css: { href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', integrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=' },
  js: { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=' },
};
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// Never translated (OSMF: "Attribution must be to “OpenStreetMap”"); prefix: false drops Leaflet's own link
// (attribution.md 'Leaflet attribution control'; Leaflet is credited in the README instead).
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
// CS-W1-PINS: L.circleMarker, 24 CSS px across (WCAG 2.2 SC 2.5.8 AA), never a default L.marker, no tooltip/popup.
const PIN = { radius: 12, weight: 2 };

// One pin per finding row, in list order. rep = buildReport(...); every finding carries at = [lat, lon] (js/report.js).
function pins(rep) {
  return rep.list.map((f) => {
    if (!Array.isArray(f.at) || f.at.length !== 2 || !f.at.every(Number.isFinite)) throw new Error(`finding ${f.fid} has no map position`);
    return { fid: f.fid, osm_id: f.osm_id, lat: f.at[0], lon: f.at[1] };
  });
}

// OSRM GeoJSON [lon, lat] -> Leaflet [lat, lon] for the route line.
function routeLatLngs(routeFile) {
  return routeFile.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
}

// W3 'Show-on-map name rule' (i18n-test-spec §12 = a11y-test-spec W3) [DESIGN]: visible text SHOW_ON_MAP, accessible
// name SHOW_ON_MAP_NAME with {finding} = the row's street text, tie-break " · OSM <osm_id>" when two rows share it.
// [DESIGN] (wave 184) A road both walked along and crossed has two rows with the same street AND the same osm_id
// ([CS-L1-FID]), so the spec's tie-break alone can repeat a name; such rows also get " · " + their kind word
// ("along the road" / "crossing"), so every name is distinct (W3 assertion (c)). rows = [{ street, osm_id, kind }].
// Both keys are English-only for now (no Spanish draft shipped), so in a Spanish page they come back with lang 'en'.
function showOnMapNames(dicts, lang, rows) {
  const vis = I.t(dicts, lang, 'SHOW_ON_MAP');
  const tpl = I.t(dicts, lang, 'SHOW_ON_MAP_NAME');
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const byStreet = count(rows.map((r) => r.street));
  const byStreetId = count(rows.map((r) => `${r.street}\u0000${r.osm_id}`));
  const names = rows.map((r) => {
    let finding = r.street;
    if (byStreet.get(r.street) > 1) finding += ` · OSM ${r.osm_id}`;
    if (byStreetId.get(`${r.street}\u0000${r.osm_id}`) > 1) finding += ` · ${r.kind === 'stretch' ? 'along the road' : 'crossing'}`;
    return I.fill(tpl.text, { finding });
  });
  return { text: vis.text, lang: vis.lang, names };
}

// Reduced motion (wave 187, Fri Oct 16, 2026; a11y-test-spec reduced-motion row): when the visitor's system asks for
// less motion (prefers-reduced-motion: reduce), the map neither animates a zoom, fades tiles or pins, nor glides after
// a drag (inertia). Leaflet has no switch for animated pans (keyboard arrows, panTo/setView call panBy with animation
// on), so createMap() also makes every panBy() on that map jump straight to its end (animate: false). Pure, for the
// unit tests; app.js passes the media-query result as opts.reducedMotion.
function motionOptions(reduced) {
  return reduced ? { zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false } : {};
}

// Browser only. L = window.L (Leaflet 1.9.4); el = div#map. opts.onTileError() runs on the first tile that fails;
// opts.reducedMotion = true turns every map animation off (motionOptions above).
// Returns a small handle; js/app.js never touches Leaflet directly.
function createMap(L, el, opts = {}) {
  const map = L.map(el, Object.assign({ attributionControl: false }, motionOptions(!!opts.reducedMotion)));
  if (opts.reducedMotion) {
    const panBy = map.panBy.bind(map);
    map.panBy = (offset, o) => panBy(offset, Object.assign({}, o, { animate: false }));
  }
  L.control.attribution({ prefix: false }).addTo(map);
  const tiles = L.tileLayer(TILE_URL, { attribution: ATTRIBUTION }).addTo(map);
  let tileFailed = false;
  tiles.on('tileerror', () => { if (!tileFailed) { tileFailed = true; if (opts.onTileError) opts.onTileError(); } });
  const layer = L.layerGroup().addTo(map);
  const fit = (latlngs) => map.fitBounds(L.latLngBounds(latlngs), { padding: [16, 16], animate: false });
  return {
    map,
    // Overview before a route is chosen: every cached route in view.
    overview(allLatLngs) { layer.clearLayers(); fit(allLatLngs); },
    // The route line (not interactive, so the only `path.leaflet-interactive` in #map are the pins) + one pin per
    // finding, in list order, each tagged data-finding-id. A pin click runs onPin(pin) = the row button's action.
    show(latlngs, pinList, onPin) {
      layer.clearLayers();
      L.polyline(latlngs, { interactive: false, color: '#1a1a1a', weight: 4, opacity: 0.8 }).addTo(layer);
      for (const p of pinList) {
        const m = L.circleMarker([p.lat, p.lon], PIN).addTo(layer);
        m.on('click', () => onPin(p));
        const e = m.getElement && m.getElement();
        if (e) e.setAttribute('data-finding-id', p.fid);
      }
      fit(latlngs);
    },
    // W3: one tap, no drag, keeps the zoom, no animation (reduced motion holds; getCenter() is final at once).
    panTo(p) { map.panTo([p.lat, p.lon], { animate: false }); },
  };
}

module.exports = { LEAFLET_HOST, TILE_HOST, ALLOWED_HOSTS, LEAFLET, TILE_URL, ATTRIBUTION, PIN, pins, routeLatLngs, showOnMapNames, motionOptions, createMap };
