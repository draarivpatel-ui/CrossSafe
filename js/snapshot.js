'use strict';
// Shared snapshot counts (runbook 3:10 row): the slim script writes these into data/sources.json,
// and the Sat P3 perf test compares the loaded file against them before timing.
function snapshotCounts(snapshot) {
  const els = (snapshot && snapshot.elements) || [];
  let ways = 0, nodes = 0;
  for (const e of els) { if (e.type === 'way') ways++; else if (e.type === 'node') nodes++; }
  return { ways, nodes };
}
if (typeof module !== 'undefined') module.exports = { snapshotCounts };
