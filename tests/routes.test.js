// Cached demo routes (data/routes/<anchor>-{walk,bike}.json, crosssafe-spec §a, data-manifest #6).
// Car-route guard: router.project-osrm.org /foot/ answers with the CAR route, so a cached walk route whose
// average speed is >= 7 km/h is a car route, not a walking one (crosssafe-spec §a "walk route avg speed < 7 km/h").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '..', 'data', 'routes');
const files = (mode) => fs.readdirSync(ROUTES).filter((f) => f.endsWith(`-${mode}.json`));
const load = (f) => JSON.parse(fs.readFileSync(path.join(ROUTES, f), 'utf8'));
const kmh = (rt) => (rt.distance / rt.duration) * 3.6;

test('walk route avg speed < 7 km/h (catches a car route cached as a walk route)', () => {
  const walk = files('walk');
  assert.ok(walk.length >= 2, `expected >= 2 cached walk routes, found ${walk.length}`);
  for (const f of walk) {
    const rt = load(f).routes[0];
    assert.ok(rt.distance > 0 && rt.duration > 0, `${f}: distance/duration must be > 0`);
    assert.ok(kmh(rt) < 7, `${f}: walk route avg speed ${kmh(rt).toFixed(2)} km/h >= 7 (car route?)`);
  }
});

test('every cached route is an OSRM Ok reply from routing.openstreetmap.de with a walk/bike pair per anchor', () => {
  const anchors = JSON.parse(fs.readFileSync(path.join(ROUTES, 'anchors.json'), 'utf8')).anchors;
  const walk = files('walk'), bike = files('bike');
  assert.equal(walk.length, anchors.length, 'one walk route per anchor');
  assert.equal(bike.length, anchors.length, 'one bike route per anchor');
  for (const [mode, list] of [['walk', walk], ['bike', bike]]) for (const f of list) {
    const r = load(f);
    assert.equal(r.code, 'Ok', `${f}: OSRM code`);
    assert.ok(r.routes[0].geometry.coordinates.length >= 2, `${f}: geometry has < 2 points`);
    assert.equal(r.meta.mode, mode, `${f}: meta.mode`);
    const prof = mode === 'walk' ? 'routed-foot' : 'routed-bike';
    assert.ok(r.meta.source_url.startsWith(`https://routing.openstreetmap.de/${prof}/`), `${f}: not fetched from ${prof}`);
  }
});
