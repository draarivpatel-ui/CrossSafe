'use strict';
// data/sources.json is written only by the fetch/slim/derive scripts (never by hand).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'data', 'sources.json');
const UA = 'CrossSafe/0.1 (Neighborhood Hacks student project; contact 287273626+draarivpatel-ui@users.noreply.github.com)';

function isoNow() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function load() {
  if (!fs.existsSync(SRC)) return { schema: 1, files: {}, raw: {} };
  return JSON.parse(fs.readFileSync(SRC, 'utf8'));
}
function update(fn) {
  const s = load(); fn(s);
  const order = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  s.files = order(s.files); s.raw = order(s.raw);
  fs.mkdirSync(path.dirname(SRC), { recursive: true });
  fs.writeFileSync(SRC, JSON.stringify(s, null, 2) + '\n');
}
// curl (not Node fetch): it honours the system proxy settings the same way on a laptop, in CI and in the build sandbox.
function curl(url, out) {
  const code = execFileSync('curl', ['-sS', '-m', '120', '-A', UA, '-o', out, '-w', '%{http_code}', url], { encoding: 'utf8' });
  if (code.trim() !== '200') throw new Error(`HTTP ${code.trim()} for ${url}`);
  return fs.readFileSync(out);
}
module.exports = { ROOT, SRC, UA, isoNow, sha256, load, update, curl };
