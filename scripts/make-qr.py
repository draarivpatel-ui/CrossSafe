#!/usr/bin/env python3
"""make-qr.py: write img/qr-live.svg, the QR code printed on the letter (test-spec §L L5), from data/sources.json.

Added Fri Oct 16, 2026 (wave 186). The page never makes a QR code: this script is run once by hand (or by
tests/e2e.py to re-encode and compare) and the SVG it writes is committed. No QR library is loaded by the page and no
outside host is asked for anything (performance-budget P5 allow-list unchanged).

Encoder: segno 1.6.6 (PyPI, pure Python, BSD-3-Clause; pinned in requirements-dev.txt so CI re-encodes with the same
version). The URL and every encode parameter are read from data/sources.json "live_url" / "live_url_qr", so the
committed SVG, the caption printed under it and the re-encode check all use one recorded value.

usage: python3 scripts/make-qr.py            write img/qr-live.svg
       python3 scripts/make-qr.py --check    exit 1 if img/qr-live.svg differs from a fresh encode (bytes)
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def encode(root=ROOT):
    import segno
    src = json.load(open(os.path.join(root, 'data', 'sources.json'), encoding='utf-8'))
    url, q = src['live_url'], src['live_url_qr']
    if segno.__version__ != q['segno']:
        raise SystemExit(f"segno {segno.__version__} installed, data/sources.json live_url_qr wants {q['segno']}")
    p = q['params']
    code = segno.make(url, error=p['error'], micro=p['micro'], boost_error=p['boost_error'])
    buf = io.BytesIO()
    code.save(buf, kind='svg', scale=p['scale'], border=p['border'], omitsize=p['omitsize'], xmldecl=p['xmldecl'])
    return url, q['file'], buf.getvalue(), code


def main():
    url, rel, svg, code = encode()
    path = os.path.join(ROOT, rel)
    if '--check' in sys.argv:
        same = os.path.exists(path) and open(path, 'rb').read() == svg
        print(f"{rel}: {'matches' if same else 'DIFFERS from'} a fresh encode of {url} (QR version {code.version}, level {code.error})")
        sys.exit(0 if same else 1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'wb').write(svg)
    print(f'wrote {rel}: {len(svg)} bytes, {url} (QR version {code.version}, level {code.error})')


if __name__ == '__main__':
    main()
