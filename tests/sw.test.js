const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// test-spec SW-K0 (decision Oct 14: no service worker ships). Guards an absence, so it is green on arrival.
test('SW-K0 no service worker (decision Oct 14; SW-K2/K3 not applicable)', () => {
  const root = path.join(__dirname, '..');
  assert.ok(!fs.existsSync(path.join(root, 'sw.js')), 'sw.js exists at the repo root');
  const files = ['index.html'];
  const walk = (d) => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.js')) files.push(path.relative(root, p)); } };
  walk(path.join(root, 'js'));
  for (const f of files) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) assert.ok(!fs.readFileSync(p, 'utf8').includes('serviceWorker.register'), `${f} calls serviceWorker.register`);
  }
});
