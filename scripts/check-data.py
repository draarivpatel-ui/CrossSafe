#!/usr/bin/env python3
"""check-data.py: data provenance + slim-snapshot guards for CrossSafe (CI step).

Rules (each error prints one line 'check-data: <rule> ...'; exit 1 on any error):
  DS1  every file under data/ (except sources.json, README.md) has a files[] entry, and every files[] key exists
  DS2  every files[] entry has source_url, ISO-Z fetched_at and a listed licence
  DS3  every raw[] entry is complete (included) or has exactly the short field set (cris-2025-2026 not_included)
  DS4  raw clone_path is under data/raw/, ends .json, is absent from the checkout, is gitignored, is not a files[] key
  DS5  derived_from ids resolve to raw[]; every included raw is used; a not_included raw is used by none
  DS6  data/derived-txdot.json cris_2025_2026 present iff raw["cris-2025-2026"] is included, same data_as_of, aggregates only
  C    every osm_base is ISO 8601 UTC YYYY-MM-DDTHH:MM:SSZ
  O35  every OSM key read in js/ is in the keep-list; every key in the slim file is in the keep-list; no tiger:*
  O36  slim shape: arterial ways carry nodes (len == geometry), other ways carry none, no tiger:*, <= 6 decimals
  N8   no duplicate (type, id) in the slim file
  CNT  the files[] entry of the slim file has the bytes/ways/nodes of the file on disk
Usage: python3 scripts/check-data.py [--root DIR]
"""
import json, os, re, subprocess, sys, glob
from pathlib import PurePosixPath

ROOT = sys.argv[sys.argv.index('--root') + 1] if '--root' in sys.argv else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ISO = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
LIC_FILES = {'ODbL-1.0', 'LicenseRef-TxDOT-no-redistribution', 'LicenseRef-HGAC-none-stated', 'LicenseRef-US-PD-NCES',
             'LicenseRef-ACS-public', 'LicenseRef-CrossSafe-derived'}
LIC_RAW = {'ODbL-1.0', 'LicenseRef-TxDOT-no-redistribution', 'LicenseRef-HGAC-none-stated'}
RAW_FULL = {'status', 'source_url', 'fetched_at', 'bytes', 'sha256', 'stored_at', 'clone_path', 'licence', 'committed'}
NOT_INCLUDED = {'status', 'source_url', 'query', 'attempted_at', 'reason', 'licence', 'committed'}
ARTERIAL = re.compile(r'^(trunk|primary|secondary|tertiary)(_link)?$')
SLIM = 'data/osm-dulles.json'
errors = []


def err(rule, msg):
    errors.append(f'check-data: {rule} {msg}')


def p(rel):
    return os.path.join(ROOT, rel)


def ignored(rel):
    r = subprocess.run(['git', 'check-ignore', '-q', '--no-index', rel], cwd=ROOT, stderr=subprocess.DEVNULL)
    if r.returncode in (0, 1):
        return r.returncode == 0
    # not a git checkout (e.g. a scratch copy): fall back to fnmatch over .gitignore lines
    import fnmatch
    pats = [l.strip() for l in open(p('.gitignore')) if l.strip() and not l.startswith('#')]
    return any(fnmatch.fnmatch(rel, x.replace('**/', '*')) or fnmatch.fnmatch(rel, x) for x in pats)


def main():
    src_path = p('data/sources.json')
    if not os.path.exists(src_path):
        err('DS1', 'data/sources.json missing'); return
    s = json.load(open(src_path))
    files, raw = s.get('files', {}), s.get('raw', {})

    # DS1
    on_disk = set()
    for dp, _, fs in os.walk(p('data')):
        for f in fs:
            rel = os.path.relpath(os.path.join(dp, f), ROOT).replace(os.sep, '/')
            if rel not in ('data/sources.json', 'data/README.md'):
                on_disk.add(rel)
    covered = set()
    for k, e in files.items():
        if '*' in k:
            m = sorted(x.replace(os.sep, '/') for x in glob.glob(p(k)))
            m = [os.path.relpath(x, ROOT).replace(os.sep, '/') for x in m]
            if not m:
                err('DS1', f'data/sources.json files["{k}"]: glob matches no file')
            elif e.get('count') != len(m):
                err('DS1', f'data/sources.json files["{k}"]: count {e.get("count")} != {len(m)} files on disk')
            covered.update(m)
        elif not os.path.exists(p(k)):
            err('DS1', f'data/sources.json files["{k}"]: listed but not in data/ (a raw input goes under "raw" with committed:false)')
        else:
            covered.add(k)
    for f in sorted(on_disk - covered):
        err('DS1', f'{f}: in data/ but no files[] entry')

    # DS2 + C (files)
    for k, e in files.items():
        if not e.get('source_url'):
            err('DS2', f'files["{k}"]: no source_url')
        if not ISO.match(str(e.get('fetched_at', ''))):
            err('DS2', f'files["{k}"]: fetched_at must be ISO-Z YYYY-MM-DDTHH:MM:SSZ')
        if e.get('licence') not in LIC_FILES:
            err('DS2', f'files["{k}"]: licence {e.get("licence")!r} not in the closed list')
        if 'osm_base' in e and not ISO.match(str(e['osm_base'])):
            err('C', f'files["{k}"]: osm_base must be ISO-Z')

    # DS3 + DS4
    for k, e in raw.items():
        st = e.get('status')
        if e.get('committed') is not False:
            err('DS3', f'raw["{k}"]: committed must be false')
        if st == 'not_included':
            if k != 'cris-2025-2026':
                err('DS3', f'raw["{k}"]: status not_included is allowed only on cris-2025-2026')
            if set(e) != NOT_INCLUDED:
                err('DS3', f'raw["{k}"]: not_included entry must have exactly {sorted(NOT_INCLUDED)}')
            if not ISO.match(str(e.get('attempted_at', ''))):
                err('DS3', f'raw["{k}"]: attempted_at must be ISO-Z')
            if len(str(e.get('reason', ''))) > 120 or '/workspace' in str(e.get('reason', '')):
                err('DS3', f'raw["{k}"]: reason must be one line <= 120 chars, no sandbox path')
            continue
        if st != 'included':
            err('DS3', f'raw["{k}"]: status must be included or not_included'); continue
        miss = RAW_FULL - set(e)
        if miss:
            err('DS3', f'raw["{k}"]: missing {sorted(miss)}')
        if not ('osm_base' in e or 'data_as_of' in e):
            err('DS3', f'raw["{k}"]: needs osm_base or data_as_of')
        if 'osm_base' in e and not ISO.match(str(e['osm_base'])):
            err('C', f'raw["{k}"]: osm_base must be ISO-Z')
        if not (isinstance(e.get('bytes'), int) and e['bytes'] > 0):
            err('DS3', f'raw["{k}"]: bytes must be a positive int')
        if not re.fullmatch(r'[0-9a-f]{64}', str(e.get('sha256', ''))):
            err('DS3', f'raw["{k}"]: sha256 must be 64 lowercase hex')
        if not ISO.match(str(e.get('fetched_at', ''))):
            err('DS3', f'raw["{k}"]: fetched_at must be ISO-Z')
        sa = str(e.get('stored_at', ''))
        if not sa.startswith('$RAW/') or '/workspace' in sa:
            err('DS3', f'raw["{k}"]: stored_at must be "$RAW/<file>"')
        if e.get('licence') not in LIC_RAW:
            err('DS3', f'raw["{k}"]: licence {e.get("licence")!r} not a raw licence id')
        cp = str(e.get('clone_path', ''))
        if not cp.startswith('data/raw/'):
            err('DS4', f'raw["{k}"]: clone_path must be under data/raw/')
        if PurePosixPath(cp).suffix != '.json':
            err('DS4', f'raw["{k}"]: clone_path must end .json')
        if os.path.exists(p(cp)):
            err('DS4', f'raw["{k}"]: {cp} is present in the checkout (raw file committed?)')
        elif cp and not ignored(cp):
            err('DS4', f'raw["{k}"]: {cp} is not matched by .gitignore')
        if cp in files:
            err('DS4', f'raw["{k}"]: also listed under files')

    # DS5
    used = {}
    for k, e in files.items():
        for rid in e.get('derived_from', []):
            used.setdefault(rid, []).append(k)
            if rid not in raw:
                err('DS5', f'files["{k}"]: derived_from "{rid}" has no raw[] entry')
    for rid, e in raw.items():
        if e.get('status') == 'included' and rid not in used:
            err('DS5', f'raw["{rid}"]: included but named by no derived_from')
        if e.get('status') == 'not_included' and rid in used:
            err('DS5', f'raw["{rid}"]: status not_included but named in derived_from of {used[rid]}')

    # DS6 (kickoff-runbook test plan C 'CRIS 2025-26 not included'; added Fri Oct 16, 2026 by wave 188, [CS-CRIS-SAT-PREP-1016]):
    # data/derived-txdot.json has a cris_2025_2026 key iff raw["cris-2025-2026"] is included, with the same data_as_of,
    # so a half-flipped commit fails. Aggregates only: no 8-digit Crash ID or coordinate-like number inside it.
    cris = raw.get('cris-2025-2026')
    if cris is None:
        err('DS3', 'raw["cris-2025-2026"]: missing (never omitted; not_included is the failed-export form)')
    elif os.path.exists(p('data/derived-txdot.json')):
        der = json.load(open(p('data/derived-txdot.json')))
        has = 'cris_2025_2026' in der
        if cris.get('status') == 'not_included' and has:
            err('DS6', 'data/derived-txdot.json: cris_2025_2026 present but raw["cris-2025-2026"] is not_included')
        if cris.get('status') == 'included':
            if not has:
                err('DS6', 'data/derived-txdot.json: no cris_2025_2026 but raw["cris-2025-2026"] is included')
            elif der['cris_2025_2026'].get('data_as_of') != cris.get('data_as_of'):
                err('DS6', f'data/derived-txdot.json: cris_2025_2026.data_as_of {der["cris_2025_2026"].get("data_as_of")!r} != raw {cris.get("data_as_of")!r}')
        if has and re.search(r'\b\d{8}\b|\d{2}\.\d{5,}', json.dumps(der['cris_2025_2026'])):
            err('DS6', 'data/derived-txdot.json: cris_2025_2026 holds an 8-digit ID or a coordinate (aggregates only)')

    # O35 / O36 / N8 / CNT on the slim file
    keep = json.load(open(p('scripts/osm-keep-list.json')))
    def kept(key):
        return key in keep or (key.startswith('sidewalk:') and 'sidewalk:*' in keep)
    for f in sorted(glob.glob(p('js/**/*.js'), recursive=True)):
        t = open(f).read()
        for key in set(re.findall(r'tags\[\s*[\'"]([A-Za-z_:]+)[\'"]\s*\]', t)) | set(re.findall(r'\b(?:tags|t)\.([a-z_]+)\b', t)):
            if not kept(key):
                err('O35', f'{os.path.relpath(f, ROOT)}: reads OSM key "{key}" not in scripts/osm-keep-list.json')
    if os.path.exists(p(SLIM)):
        text = open(p(SLIM)).read()
        d = json.loads(text)
        seen = set()
        for el in d.get('elements', []):
            key = (el.get('type'), el.get('id'))
            if key in seen:
                err('N8', f'duplicate {key[0]} {key[1]}'); break
            seen.add(key)
        for el in d.get('elements', []):
            tags = el.get('tags', {})
            for kk in tags:
                if kk.startswith('tiger:'):
                    err('O36', f'(c) {el["type"]} {el["id"]}: tiger:* key {kk}'); break
                if not kept(kk):
                    err('O35', f'{SLIM}: {el["type"]} {el["id"]} key "{kk}" not in the keep-list'); break
            if el.get('type') == 'way':
                art = bool(ARTERIAL.match(tags.get('highway', '')))
                n = el.get('nodes')
                if art and not (isinstance(n, list) and n and all(isinstance(x, int) for x in n) and len(n) == len(el.get('geometry', []))):
                    err('O36', f'(a) arterial way {el["id"]}: nodes missing or len(nodes) != len(geometry)')
                if not art and 'nodes' in el:
                    err('O36', f'(b) non-arterial way {el["id"]}: has nodes')
        m = re.search(r'-?\d+\.\d{7,}', text)
        if m:
            err('O36', f'(d) coordinate token {m.group(0)} has more than 6 decimals')
        if not ISO.match(str(d.get('osm_base', ''))):
            err('C', f'{SLIM}: osm_base must be ISO-Z')
        e = files.get(SLIM, {})
        ways = sum(1 for x in d['elements'] if x['type'] == 'way')
        nodes = sum(1 for x in d['elements'] if x['type'] == 'node')
        got = (os.path.getsize(p(SLIM)), ways, nodes)
        want = (e.get('bytes'), e.get('ways'), e.get('nodes'))
        if got != want:
            err('CNT', f'files["{SLIM}"]: bytes/ways/nodes {want} != file on disk {got}')

    return len(files), len(raw)


nf, nr = main() or (0, 0)
for e in errors:
    print(e)
print(f'check-data sources: {nf} files, {nr} raw, {len(errors)} error(s)')
sys.exit(1 if errors else 0)
