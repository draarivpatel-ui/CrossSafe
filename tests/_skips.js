'use strict';
// Allowed skips (kickoff-runbook 'npm test final mode' -> 'Allowed skips', [DESIGN]). The ONLY way a test may skip.
// skipOrFail(t, reason): under NPM_TEST_FINAL=1 every skip fails; a name/reason not listed here fails in every run;
// otherwise t.skip(reason). A new entry needs a dated line in the runbook + a11y/test-spec, and is removed in the same
// commit that builds what it waits for. The two F2 entries stay dormant until tests/a11y.test.js calls skipOrFail.
const assert = require('node:assert/strict');

const ALLOWED_SKIPS = {
  'a11y F2 rendered EN': 'renderer not requireable',
  'a11y F2 rendered ES': 'renderer not requireable',
};

function skipOrFail(t, reason) {
  const name = t.name;
  if (process.env.NPM_TEST_FINAL === '1') assert.fail(`skip not allowed: NPM_TEST_FINAL=1 (${name}: ${reason})`);
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_SKIPS, name) || ALLOWED_SKIPS[name] !== reason) {
    assert.fail(`skip not allowed: not in ALLOWED_SKIPS (${name}: ${reason})`);
  }
  t.skip(reason);
}

module.exports = { ALLOWED_SKIPS, skipOrFail };
