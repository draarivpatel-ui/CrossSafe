'use strict';
// Page glue for the bare UI (Fri Oct 16, 2026, wave 183). Browser only; everything testable lives in the CommonJS
// modules it loads (js/report.js, js/render.js, js/i18n.js, js/route.js, js/score.js, js/logic.js, js/r50.js).
// [DESIGN] Those modules are shared with Node (`require` / `module.exports`), so this file loads them with a tiny
// same-origin CommonJS loader: fetch each file from js/, wrap it in a function (require, module, exports) and run it
// once. No bundle step, so the bytes the page runs are the bytes the Node tests run. Only files under js/ on this
// origin are ever evaluated. Note for later: a Content-Security-Policy would need 'unsafe-eval' for this loader (or a
// bundle step instead). 'fs' and 'path' resolve to stubs that throw if called: js/r50.js requires them at the top
// but the page only uses its pure score100().
// Outside hosts: only js/map.js's allow-list (unpkg.com for Leaflet 1.9.4 with SRI, tile.openstreetmap.org for tiles;
// wave 184). Everything else the page loads is same-origin. If either host fails, the list still works and
// #source-status names the host (browser check B3).
// Language: English by default; the visible toggle button#lang (or ?lang=es) switches to the Spanish draft labels from
// i18n/es.json (wave 184). Text with no committed Spanish draft stays English and is tagged lang="en".
// Letter (wave 185, test-spec §L): button#letter-open shows article#letter (js/letter.js) for the chosen route as its own
// view; print CSS (css/app.css) puts only the letter on one US Letter page.
// ?demo=dulles (wave 185): opens with the school and its first demo route already picked (js/render.js demoRouteStem).
// Loading and errors (wave 187, offline-error-test-spec E1): while the data loads, p#load-status says so and #results
// is aria-busy; if a file fails (e.g. the snapshot 404s), #load-error names it, the empty map box is hidden and
// button#load-retry reloads the page to try again. Reduced motion: js/map.js motionOptions().
(function () {
  const app = document.getElementById('app');
  const cache = new Map();
  const stub = (name) => new Proxy({}, { get: (o, k) => () => { throw new Error(`${name}.${String(k)} is not available in the browser`); } });
  const builtins = { fs: stub('fs'), path: stub('path') };

  async function fetchText(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`could not load ${url} (HTTP ${r.status})`);
    return r.text();
  }
  async function fetchJSON(url) {
    const text = await fetchText(url);
    try { return JSON.parse(text); } catch (e) { throw new Error(`could not read ${url} (${e.message})`); }
  }

  // Load the module graph: fetch every file reachable through require('./x.js'), then evaluate on demand.
  const src = new Map();
  async function fetchModule(name) {
    if (src.has(name)) return;
    src.set(name, null);
    const text = await fetchText(`js/${name}`);
    src.set(name, text);
    const deps = [...text.matchAll(/require\(\s*'\.\/([\w-]+\.js)'\s*\)/g)].map((m) => m[1]);
    await Promise.all(deps.map(fetchModule));
  }
  function req(name) {
    if (Object.prototype.hasOwnProperty.call(builtins, name)) return builtins[name];
    const key = String(name).replace(/^\.\//, '');
    if (cache.has(key)) return cache.get(key).exports;
    const text = src.get(key);
    if (typeof text !== 'string') throw new Error(`module js/${key} was not loaded`);
    const module = { exports: {} };
    cache.set(key, module);
    // eslint-disable-next-line no-new-func
    new Function('require', 'module', 'exports', `${text}\n//# sourceURL=js/${key}`)(req, module, module.exports);
    return module.exports;
  }

  function loaded() {
    document.getElementById('load-status').hidden = true;
    document.getElementById('results').removeAttribute('aria-busy');
  }
  function fail(err) {
    app.setAttribute('data-state', 'error');
    loaded();
    const msg = document.getElementById('load-error');
    msg.textContent = `CrossSafe could not start: ${err && err.message ? err.message : err}`;
    msg.hidden = false;
    document.getElementById('load-retry').hidden = false;
    const sel = document.getElementById('route');
    if (sel) sel.disabled = true;
    document.getElementById('letter-open').disabled = true;
    // no blank map box: a map that never got its data is hidden with its key hint
    const mapEl = document.getElementById('map');
    if (mapEl.getAttribute('data-map') !== 'ready') { mapEl.hidden = true; document.getElementById('map-hint').hidden = true; }
  }
  document.getElementById('load-retry').addEventListener('click', () => location.reload());

  // Leaflet 1.9.4 from unpkg with SRI (js/map.js LEAFLET), added by script so the page can tell which outside host
  // failed (browser-checks §3b). crossorigin="" = anonymous, which SRI on a cross-origin file needs.
  function loadTag(tag, attrs) {
    return new Promise((resolve, reject) => {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      e.addEventListener('load', resolve);
      e.addEventListener('error', () => reject(new Error(`could not load ${attrs.href || attrs.src}`)));
      if (tag === 'link') document.head.insertBefore(e, document.querySelector('link[rel="stylesheet"]'));
      else document.head.appendChild(e);
    });
  }
  async function loadLeaflet(M) {
    await Promise.all([
      loadTag('link', { rel: 'stylesheet', href: M.LEAFLET.css.href, integrity: M.LEAFLET.css.integrity, crossorigin: '' }),
      loadTag('script', { src: M.LEAFLET.js.src, integrity: M.LEAFLET.js.integrity, crossorigin: '' }),
    ]);
    if (!window.L || window.L.version !== '1.9.4') throw new Error('Leaflet 1.9.4 did not start');
    return window.L;
  }

  async function start() {
    let lang = new URLSearchParams(location.search).get('lang') === 'es' ? 'es' : 'en';
    await Promise.all(['report.js', 'render.js', 'map.js', 'letter.js'].map(fetchModule));
    const R = req('./report.js');
    const V = req('./render.js');
    const M = req('./map.js');
    const LT = req('./letter.js');
    // The map is optional: the list, the data date and the status lines never wait for it (B3: every outside host
    // blocked -> the findings still show and #source-status names the host). Started now, used when it arrives.
    const leaflet = loadLeaflet(M);
    leaflet.catch(() => {});
    const dicts = {};
    const loadDict = async (l) => { if (!dicts[l]) dicts[l] = await fetchJSON(`i18n/${l}.json`); return dicts[l]; };
    const [, , snap, sources, rri, routeFiles] = await Promise.all([
      loadDict('en'),
      loadDict(lang),
      fetchJSON('data/osm-dulles.json'),
      fetchJSON('data/sources.json'),
      fetchJSON('data/ref/rri.json'),
      Promise.all(R.ROUTE_IDS.map((id) => fetchJSON(`data/routes/${id}.json`))),
    ]);
    const routes = R.ROUTE_IDS.map((stem, i) => ({ stem, meta: routeFiles[i].meta, file: routeFiles[i] }));
    const snapEntry = (sources.files || {})['data/osm-dulles.json'] || {};
    if (snapEntry.osm_base !== snap.osm_base) throw new Error('data/sources.json osm_base does not match data/osm-dulles.json');
    const ways = new Map(snap.elements.filter((e) => e.type === 'way').map((e) => [e.id, e]));
    const sel = document.getElementById('route');
    const mapEl = document.getElementById('map');
    const hintEl = document.getElementById('map-hint');
    const reports = new Map();
    const unreachable = [];
    let view = null; // js/map.js createMap() handle once Leaflet is up
    let current = null; // { route, rep, pins } of the chosen route
    const letterBtn = document.getElementById('letter-open');
    const letterEl = document.getElementById('letter');
    const letterOpen = () => app.getAttribute('data-letter') === 'open';
    function paintStatus() { V.renderStatus(document, lang, snapEntry.osm_base, { dicts, raw: sources.raw, unreachable }); }
    function noteUnreachable(host) { if (!unreachable.includes(host)) { unreachable.push(host); paintStatus(); } }
    function onPin(p) { if (view) view.panTo(p); }
    function paintMap(refit) {
      if (!view) return;
      if (!current) { if (refit) view.overview([].concat(...routes.map((r) => M.routeLatLngs(r.file)))); return; }
      V.addShowOnMap(document, dicts, lang, M.showOnMapNames);
      if (refit) view.show(M.routeLatLngs(current.route.file), current.pins, onPin);
    }
    function paintRoute(refit) {
      const route = routes.find((r) => r.stem === sel.value);
      if (!route) { current = null; V.clearRoute(document); closeLetter(false); LT.renderLetterButton(document, dicts, lang, false); paintMap(refit); return; }
      if (!reports.has(route.stem)) reports.set(route.stem, R.buildReport(snap, route.file, route.stem, rri));
      const rep = reports.get(route.stem);
      current = { route, rep, pins: M.pins(rep) };
      V.renderRoute(document, dicts[lang], lang, route, rep, ways, rri.modes && rri.modes[rep.mode]);
      LT.renderLetterButton(document, dicts, lang, true);
      if (letterOpen()) paintLetter();
      paintMap(refit);
    }
    // Letter view (test-spec §L, wave 185): the letter follows the chosen route; opening it moves focus to its heading,
    // Back or Escape closes it and returns focus to button#letter-open (L10). Nothing is typed into it (L9).
    function paintLetter() {
      LT.renderLetter(document, dicts, lang, current.route, current.rep, ways, rri.modes && rri.modes[current.rep.mode], sources.raw, sources.live_url);
    }
    function openLetter() {
      if (!current) return;
      paintLetter();
      letterEl.hidden = false;
      app.setAttribute('data-letter', 'open');
      window.scrollTo(0, 0);
      document.getElementById('letter-title').focus();
    }
    function closeLetter(focusBack) {
      if (!letterOpen()) return;
      app.removeAttribute('data-letter');
      letterEl.hidden = true;
      if (view) view.map.invalidateSize({ animate: false });
      if (focusBack) letterBtn.focus();
    }
    function paint() {
      V.renderLang(document, dicts, lang);
      LT.renderLetterButton(document, dicts, lang, !!current);
      V.renderControls(document, dicts[lang], lang, routes);
      V.renderMapLabels(document, dicts, lang);
      paintStatus();
    }
    paint();
    // ?demo=dulles (wave 185): school + first demo route picked before the page reports ready, so the findings appear
    // with no input. Focus is not moved and nothing is stored; an unknown value leaves the page as usual.
    const demoStem = V.demoRouteStem(new URLSearchParams(location.search).get('demo'), routes);
    if (demoStem) {
      document.getElementById('school').value = V.SCHOOL.id;
      sel.value = demoStem;
      paintRoute(true);
    }
    sel.addEventListener('change', () => { try { paintRoute(true); } catch (e) { fail(e); } });
    letterBtn.addEventListener('click', () => { try { openLetter(); } catch (e) { fail(e); } });
    document.getElementById('letter-back').addEventListener('click', () => closeLetter(true));
    document.getElementById('letter-print').addEventListener('click', () => window.print());
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && letterOpen()) { ev.preventDefault(); closeLetter(true); } });
    // W3: a row's "Show on map" button pans the map to that finding (the keyboard / screen-reader route to every pin).
    document.getElementById('findings').addEventListener('click', (ev) => {
      const b = ev.target.closest && ev.target.closest('button.show-on-map');
      if (!b || !current) return;
      const fid = b.closest('li.finding').getAttribute('data-finding-id');
      const p = current.pins.find((x) => x.fid === fid);
      if (p) onPin(p);
    });
    // EN/ES toggle (a11y-test-spec A9/W4): a button, so the switch is an activation, not "on input". It re-renders the
    // labels, the route options (the chosen route stays chosen) and the route card in place: no reload, no navigation,
    // focus stays on the button. The URL keeps ?lang=es (history.replaceState) so a reload or a shared link opens the
    // same language; nothing is stored in the browser. The map view is not moved by a language switch.
    document.getElementById('lang').addEventListener('click', async () => {
      try {
        const next = lang === 'es' ? 'en' : 'es';
        await loadDict(next);
        lang = next;
        paint();
        if (sel.value) paintRoute(false);
        const u = new URL(location.href);
        if (lang === 'es') u.searchParams.set('lang', 'es'); else u.searchParams.delete('lang');
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      } catch (e) { fail(e); }
    });
    sel.disabled = false;
    loaded();
    app.setAttribute('data-state', 'ready');
    // The map, when (if) Leaflet arrives. Unreachable unpkg.com: no map, #map and #map-hint hidden, one status line.
    leaflet.then((L) => {
      const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      view = M.createMap(L, mapEl, { onTileError: () => noteUnreachable(M.TILE_HOST), reducedMotion });
      paintMap(true);
      mapEl.setAttribute('data-map', 'ready');
    }, () => {
      mapEl.hidden = true;
      hintEl.hidden = true;
      mapEl.setAttribute('data-map', 'unavailable');
      noteUnreachable(M.LEAFLET_HOST);
    }).catch(fail);
  }

  start().catch(fail);
}());
