# CrossSafe

CrossSafe maps what OpenStreetMap and public TxDOT data actually show (and leave blank) about sidewalks and crossings on the routes students walk and bike to school along Dulles Avenue, Cartwright Road, Dairy Ashford Road, and South Kirkwood Road.

- **Live link:** https://aariv.me/CrossSafe/ (pick one of the six saved walk or bike routes to Dulles High School to inspect every unmapped sidewalk stretch and unmarked crossing on an interactive map, or switch to the 1-page printable letter view with a QR code back to the live map)
- **Zero-click demo link:** https://aariv.me/CrossSafe/?demo=dulles opens with Dulles High School and the first saved route already selected, so the findings list and map pins load immediately with no typing and no location or camera prompt.

## Corridor Telemetry & Key Findings (2-Mile Dulles HS Walk/Bike Zone)

- **TxDOT Recorded Crashes (2020-2024):** `33` total pedestrian- and bicyclist-involved crashes within 2 miles of Dulles High School (`21` pedestrian crashes and `12` bicyclist crashes), plus a floor of `17` additional coordinate-mapped crashes in the 2025-2026 TxDOT CRIS extract (as of `2026-10-17`).
- **Median Reference Route Risk ($R_{50}$):** Across `30` seeded residential start points (`0.25` to `2` miles from Dulles High School), the median walk route carries `5.57` risk points per km and the median bike route carries `8.64` risk points per km.
- **Fast Client-Side Scoring:** Scoring all `717` crossing nodes across the `5,966` OpenStreetMap ways in `data/osm-dulles.json` runs in `9.3 ms` locally (`28.1 ms` median on shared CI runners, well under the `100 ms` budget).

## Judge It in 60 Seconds

1. Open https://aariv.me/CrossSafe/?demo=dulles. Dulles High School and the first saved route load automatically (`273 ms` to first finding in headless Chromium CI on commit `b224c3b`; switching routes takes `169 ms`).
2. Press **Letter for this route**. The route's findings, the OpenStreetMap snapshot date, the TxDOT CRIS 2025-26 data date, and the OpenStreetMap credit format onto a single printable US Letter page addressed `"To whom it may concern / road owner"`. Pressing **Print (one page)** prints only the letter (verified as 1 US Letter page in Chromium PDF output for both the 32-finding route and the 39-finding route).
3. Run the full verification suite offline from a fresh clone:

```bash
npm ci
npm test        # runs all 84 unit tests across 12 test files (# fail 0)
node scripts/report.js dulles --route corporate-drive-dairy-ashford-road-bike --json
# {"route":"corporate-drive-dairy-ashford-road-bike","mode":"bike","findings":32,"N":9,"k":9,"entrances":17,"route_m":3185,"rri_per_km":10.03,"score":54,"confidence":"Low",...}
wc -c data/osm-dulles.json                # 1509933
gzip -c data/osm-dulles.json | wc -c      # 252936
```

## How to Run

```bash
npm ci
npm test               # node --test tests/*.test.js (84 unit tests)
python3 tests/e2e.py   # Playwright browser + axe-core accessibility + 1-page PDF print checks
node scripts/report.js dulles                                  # findings for every cached demo route (offline)
node scripts/report.js dulles --route lost-creek-park-walk --json   # one JSON line for one route
python3 scripts/make-qr.py --check   # verifies img/qr-live.svg against a fresh segno 1.6.6 encode of live_url
node scripts/sensitivity.js          # runs the 1,000-draw Monte Carlo weight sensitivity check offline
```

## Data and Licences

| Data | Source | Licence / terms | In this repo |
|---|---|---|---|
| Streets, crossings, signals | © OpenStreetMap contributors (snapshot via https://maps.mail.ru/osm/tools/overpass/api/interpreter) | ODbL 1.0 (https://www.openstreetmap.org/copyright) | Slim extract `data/osm-dulles.json` (ODbL; osm_base 2026-10-16T19:16:19Z; 5966 ways, 717 nodes, 1509933 bytes). The raw query reply is not committed; `scripts/slim.js` rebuilds the extract from it. |
| School location | NCES EDGE 2022-23 (U.S. Dept. of Education, IES) | Public domain | `data/raw/schools.json` (fetched 2026-10-16T18:45:04Z) |
| Language counts (Fort Bend County, table B16001) | U.S. Census Bureau ACS via Census Reporter (ACS 2024 1-year) | Public | `data/raw/languages.json` (fetched 2026-10-16T18:45:06Z) |
| Traffic counts (AADT) | Texas Department of Transportation, item d5f56ecd2b274b4d8dc3c2d6fe067d37 | TxDOT terms (quoted below) | **Derived values only**: aggregate counts per road in `data/derived-txdot.json` (24 stations read, report year 2025) |
| Pedestrian- and bicyclist-involved crashes 2020-24 / CRIS | Texas Department of Transportation, item 93b84dccf1ec4440b1475c4290ac21ff ("TXDOT Statewide Bicyclist Involved Crashes" layer, queried for crashes involving a pedestrian or a bicyclist) | TxDOT terms (quoted below) | **Aggregate counts only.** No crash rows. CRIS 2025-26 (Jan 2025 to data as of 2026-10-17): aggregate counts only, a floor (rows without coordinates can't be placed) |
| High Injury Network | H-GAC / City of Sugar Land Safety Action Plan (draft), public ArcGIS layer | No licence stated | **Derived counts only** (`data/derived-txdot.json`) |
| Walk and bike demo routes | OSRM on the FOSSGIS demo servers (https://routing.openstreetmap.de, `routed-foot` / `routed-bike`), over © OpenStreetMap contributors data; start points looked up via Overpass | ODbL 1.0; FOSSGIS usage policy (non-commercial, max 1 request/s, cached) | `data/routes/` (fetched 2026-10-16 by `scripts/fetch-routes.js`): 3 public start points in `anchors.json` (Lost Creek Park; Corporate Drive & Dairy Ashford Road; Greenbriar Drive & South Kirkwood Road), one walk and one bike route each to Dulles High School. Routes are fetched once and cached here, so the app never needs to call the routing server live. No home address or home location is used. |
| Map background (shown in the page, not stored) | OpenStreetMap standard tiles from https://tile.openstreetmap.org, loaded by the reader's browser | © OpenStreetMap contributors, ODbL 1.0; OSMF Tile Usage Policy (https://operations.osmfoundation.org/policies/tiles/) | Nothing: tiles are never saved, pre-fetched or cached by this code (the browser's own HTTP cache only); the map credits "© OpenStreetMap contributors" |
| Reference routes (for the 0-100 scale) | Same OSRM servers and data as above | ODbL 1.0; FOSSGIS usage policy (max 1 request/s, cached) | `data/ref/points.json`: 30 start points drawn with fixed seed 20261016 from the 655 midpoints of OSM residential streets 0.25-2 mi from the school (`js/ref.js`, rebuilt by `node scripts/ref-points.js`). `data/routes/ref/{walk,bike}/` holds one cached walk and one bike route from each point (fetched 2026-10-16 by `scripts/fetch-ref.js`, one request at a time). These are road centrelines anyone can regenerate, not anyone's home. `node scripts/ref-report.js` scores them into `data/ref/rri.json` (see Reference sample below). |

TxDOT's licence text for its AADT layer reads: "GIS content and data provided is the property of TxDOT and may not be used for commercial purposes or resold. Distribution of this content to third parties without TxDOT's written consent is strictly prohibited."

Because of that licence, TxDOT and H-GAC data are fetched by `scripts/fetch.js` at build time and are **not redistributed**: raw rows are gitignored, and this repo and its GitHub Pages site carry only derived aggregate counts. Anyone can re-run the fetch with the query URLs in `scripts/fetch.js` (also recorded in `data/sources.json`).

<!-- ref-sample:start (written by node scripts/ref-report.js --readme; do not edit by hand) -->
### Reference sample

- Seed: 20261016 (`js/ref.js`, mulberry32). OSM snapshot `osm_base`: 2026-10-16T19:16:19Z.
- Walk: n = 30 successful of 30 drawn; R₅₀ = 5.57 risk points per km; failures: none; 0-100 score can be shown for this mode.
- Bike: n = 30 successful of 30 drawn; R₅₀ = 8.64 risk points per km; failures: none; 0-100 score can be shown for this mode.
- R₅₀ is the median route risk per km of these routes, recomputed from the committed files by `scripts/ref-report.js` (per-route table: `data/ref/rri.json`); CI re-derives every number above (test T18).
- Scored from the committed OpenStreetMap tags only: TxDOT traffic counts and H-GAC/TxDOT crash and High Injury Network rows are not in this repo, so every crossing uses T = 1.3 ("traffic count unknown") and every piece uses M = 1. R₅₀ is a reference point for the 0-100 scale (50 = as risky per km as the median reference route), not a crash prediction.
<!-- ref-sample:end -->

Driveway and service-road entrances (OSM `highway=service`: driveways, parking aisles, lot entrances) do not count as street crossings (`js/route.js`, marked `[DESIGN]`); `report.js` lists them as `entrances` instead. With that distinction, $R_{50}$ is `5.57` risk points per km (walk) and `8.64` (bike).

<!-- sensitivity:start (written by node scripts/sensitivity.js --readme; do not edit by hand) -->
### What if you disagree with the weights? (sensitivity check)

Several weights are judgment calls, not published values (crosssafe-spec.md "Weights and why"). `node scripts/sensitivity.js` changes them one family at a time and re-ranks the findings of the 6 saved routes (224 scored pieces: 154 stretches, 70 crossings) and the 60 reference routes, using the app's own scoring code. Each cell reads: **top-10 findings kept** (worst of the 6 routes) · **largest move of a top-3 finding** (places) · **order of the 3 saved routes per mode** · **change in the 0-100 score** (R₅₀ recomputed with the same weights). It passes when at least 8 of the top 10 stay and the route order does not change.

| Weight family | Values tried (low / high) | Low | High | Passes? |
|---|---|---|---|---|
| Sidewalk unknown G (default 0.6) | 0.3 / 0.9 | 9 of 10 · 0 · **changed (bike)** · −2 to +1 | 7 of 10 · 1 · same · −2 to +1 | **no** |
| Signalized crossing Q (default 0.3) | 0.15 / 0.45 | 10 of 10 · 0 · same · 0 | 10 of 10 · 0 · **changed (bike)** · −1 to 0 | **no** |
| Marked crossing Q (default 0.7) | 0.35 / 1.0 | 9 of 10 · 0 · same · 0 to +1 | 10 of 10 · 1 · **changed (bike)** · −2 to 0 | **no** |
| Unmarked crossing Q (default 0.9) | 0.45 / 1.0 | 10 of 10 · 0 · same · 0 | 10 of 10 · 0 · same · 0 | yes |
| Road class C (all classes) | ×0.5 / ×1.5 | 9 of 10 · 0 · **changed (bike)** · −1 to +1 | 7 of 10 · 1 · same · −2 to +1 | **no** |
| Traffic T (all values) | ×0.5 / ×1.5 | 7 of 10 · 1 · same · −3 to +1 | 9 of 10 · 0 · **changed (bike)** · −1 to +1 | **no** |
| History weight (default 0.25) | 0 / 0.5 | 10 of 10 · 0 · same · 0 | 10 of 10 · 0 · same · 0 | yes |
| Crossing CMFs (island, RRFB, PHB) | off | 10 of 10 · 0 · same · 0 | n/a | yes |
| Assumed speeds (untagged roads) | −5 / +5 mph | 9 of 10 · 1 · same · −1 to 0 | 10 of 10 · 1 · **changed (bike)** · −1 to 0 | **no** |

- Rows that cannot change anything with the committed data: the history weight (every piece has M = 1: crash and High Injury Network rows are not in this repo); the crossing CMFs (none of the 70 crossings on the saved routes is tagged with an island, RRFB or PHB); the split between traffic bands (every crossing uses T = 1.3 "traffic count unknown", so only the overall T level is tested). A passing row there says nothing about those weights. The crash severity (KABCO) weights are not tried for the same reason.
- Fewer than 8 of a route's top 10 findings stayed for: Sidewalk unknown G (default 0.6); Road class C (all classes); Traffic T (all values). The findings list depends on these judgment weights.
- The order of the saved routes changed for: Sidewalk unknown G (default 0.6): bike; Signalized crossing Q (default 0.3): bike; Marked crossing Q (default 0.7): bike; Road class C (all classes): bike; Traffic T (all values): bike; Assumed speeds (untagged roads): bike. With the default weights the routes rank, in risk points per km, walk: greenbriar-drive-south-kirkwood-road-walk 16.86 > corporate-drive-dairy-ashford-road-walk 9.15 > lost-creek-park-walk 8.77 (closest gap 0.38); bike: greenbriar-drive-south-kirkwood-road-bike 14.17 > corporate-drive-dairy-ashford-road-bike 10.03 > lost-creek-park-bike 9.98 (closest gap 0.05). Routes this close should be read as about equal, not as ranked.
- A top-3 finding moved at most 1 place in any row (score-sensitivity-test-spec S2 allows 1).
- Unknown data at best and at worst (every unknown sidewalk G = 0.1 / 1.0 and every unknown traffic T = 1.0 / 1.6; 129 unknown-sidewalk stretches and 70 unknown-traffic crossings on the saved routes), 0-100 score with R₅₀ recomputed the same way: corporate-drive-dairy-ashford-road-bike 54 (unknowns at best 51, at worst 55; risk per km 10.03, at best 5.96, at worst 13.62); corporate-drive-dairy-ashford-road-walk 62 (unknowns at best 60, at worst 61; risk per km 9.15, at best 5.44, at worst 12.41); greenbriar-drive-south-kirkwood-road-bike 62 (unknowns at best 63, at worst 62; risk per km 14.17, at best 9.38, at worst 18.53); greenbriar-drive-south-kirkwood-road-walk 75 (unknowns at best 77, at worst 74; risk per km 16.86, at best 11.64, at worst 21.69); lost-creek-park-bike 54 (unknowns at best 54, at worst 54; risk per km 9.98, at best 6.66, at worst 13.00); lost-creek-park-walk 61 (unknowns at best 60, at worst 60; risk per km 8.77, at best 5.35, at worst 11.78). 0 of 6 scores differ by more than 10 points, so no score is shown as a range. The 0-100 score moves little because the reference routes move with it; the risk per km moves more.
- Random draws: 1000 draws (seed 20261016, mulberry32), each of 12 judgment weights (unknown-sidewalk G, the three crossing-control values, the 8 road-class values) multiplied by a random factor between 0.7 and 1.3. Same top-10 set as the default weights in: corporate-drive-dairy-ashford-road-bike 758; corporate-drive-dairy-ashford-road-walk 911; greenbriar-drive-south-kirkwood-road-bike 576; greenbriar-drive-south-kirkwood-road-walk 911; lost-creek-park-bike 556; lost-creek-park-walk 550. Findings that stay in the top 10 in at least 80 % of draws: 10 of 10, 10 of 10, 9 of 10, 10 of 10, 8 of 10, 8 of 10. Route order unchanged in 990 (walk) and 541 (bike) of 1000 draws.
- 216 of the 224 pieces use an assumed speed (the road has no `maxspeed` tag); the "Assumed speeds" row moves every one of them 5 mph down or up.
- Not run: changing the matching radii (spec step 4; the radii are fixed in `js/score.js`) and checking crash points against the riskiest pieces (step 6; crash rows are not in this repo). The check ranks each saved route's own findings, not every piece within 1 mile of the school as the spec first planned, because the app scores routes. CI re-derives every number in this block (`tests/sensitivity.test.js`).
<!-- sensitivity:end -->

## Tests

Unit tests use Node's built-in test runner (`npm test`); they read the committed `data/` files only and make no network calls:

- `tests/logic.test.js`: distance and geometry helpers, the walk zone, sidewalk gaps along a route, crossing coverage, the AADT crossing weight, the gap score, and the letter text builder.
- `tests/score.test.js`: the scoring factors in `js/score.js` (sidewalk G, road class C, speed V, crossing control Q, lanes N, traffic T, history M) on real Dulles-area OSM ways from the committed snapshot, plus synthetic fixtures where the repo has no raw crash data.
- `tests/report.test.js`: `scripts/report.js` end to end on the cached demo routes, verifying `--json` output keys, deduplication per kind and OSM object, and driveway/service-road entrance separation.
- `tests/routes.test.js`: verifies every cached demo route is an OSRM `Ok` reply with a walk/bike pair and rejects walk routes averaging 7 km/h or faster as car routes.
- `tests/privacy.test.js`: verifies every demo route starts within 30 m of a named public anchor in `data/routes/anchors.json` (a park or a major street intersection), never at a house or residential address.
- `tests/i18n.test.js`: verifies `i18n/es.json` and `i18n/en.json` key sets, placeholder parity, and language fallback tagging (`lang="en"` on English-only strings inside a Spanish page).
- `tests/ref.test.js`: verifies the reference-point draw is seeded (`mulberry32`, seed `20261016`), reproducible, and never uses `Math.random`.
- `tests/r50.test.js`: verifies the $R_{50}$ median rules, the 20-route minimum threshold, and that `data/ref/rri.json` and the README Reference sample block match `scripts/ref-report.js`.
- `tests/sensitivity.test.js`: verifies `js/sensitivity.js` reproduces `scripts/report.js` at default weights, restores scoring functions cleanly, runs 1,000 seeded Monte Carlo draws deterministically, and matches the README sensitivity table.
- `tests/perf.test.js`: verifies scoring all 717 crossing nodes in `data/osm-dulles.json` stays well under the 100 ms budget (`9.3 ms` local median).
- `tests/ui.test.js`: verifies the DOM shell in `index.html`, `js/render.js`, `js/map.js`, and `js/letter.js` on jsdom in English and Spanish, including SRI hashes, pin distances within 30 m of the route, accessible button labels, wording rules, and QR code rules.
- `tests/smoke.test.js` and `tests/sw.test.js`: verify the skip link, `#app` container, and that no service worker is registered.

## Libraries and APIs

- Node.js built-in test runner (`node:test`)
- Leaflet 1.9.4 (BSD 2-Clause, © 2010-2023 Volodymyr Agafonkin), loaded from `https://unpkg.com/leaflet@1.9.4/` with Subresource Integrity hashes
- OpenStreetMap standard tile layer (`https://tile.openstreetmap.org`) under the OSMF Tile Usage Policy
- Dev only: Playwright 1.63.0, Pillow 12.3.0, jsdom 24.1.3, axe-core 4.14.0, segno 1.6.6, and zxing-cpp 3.1.1

## Honest Limits

- **Unmapped vs. absent:** When OpenStreetMap has no `sidewalk=*` tag on a street, CrossSafe reports it as `"sidewalk not mapped (unknown)"` rather than claiming no sidewalk exists on the ground. Always verify conditions on site.
- **Aggregate crash data only:** Because TxDOT licence terms prohibit redistributing raw crash rows, the repository ships only aggregate counts in `data/derived-txdot.json`, and per-piece scoring uses `T = 1.3` (`traffic count unknown`) and `M = 1` on the committed offline snapshot.
- **Spanish translation scope:** Only the picker labels and route names in `i18n/es.json` are translated so far (machine-drafted); the findings list and printable letter remain in English and are tagged with `lang="en"` when viewing the Spanish draft.

## License

MIT (see `LICENSE`).
