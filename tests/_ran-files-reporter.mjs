// K0i [DESIGN]: list each test file in which >=1 real test() ran (passed or failed),
// one repo-relative path per line, sorted. Skipped/todo tests and node's synthetic
// file-level entry (name == file path: empty file / no test() calls) do not count.
import { relative } from 'node:path';
export default async function* ranFiles(source) {
  const seen = new Set();
  for await (const ev of source) {
    if (ev.type !== 'test:pass' && ev.type !== 'test:fail') continue;
    const d = ev.data;
    if (!d.file || d.skip !== undefined || d.todo !== undefined) continue;
    if (d.details?.type === 'suite') continue;
    const rel = relative(process.cwd(), d.file);
    if (d.name === rel || d.name === d.file) continue;
    seen.add(rel);
  }
  for (const f of [...seen].sort()) yield f + '\n';
}
