const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('skeleton: index.html has the skip link and #app', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('href="#app"'), 'index.html has no href="#app" skip link');
  assert.ok(html.includes('id="app"'), 'index.html has no element with id="app"');
});
