"""CrossSafe browser checks (Playwright 1.63.0, sync API).

Serves the repo like GitHub Pages at /CrossSafe/ (case-sensitive) and runs:
the skeleton check (first Tab reaches the skip link), then B1 (390 px and
1280 px: ready, 0 console errors, no horizontal overflow, labelled pickers),
B2 (390 px: school -> route -> findings in the aria-live region within 2 s,
count and finding ids equal `node scripts/report.js dulles --route <id> --json`)
B3 (every non-local host blocked: findings, the data date and the CRIS
2025-26 line still shown, every blocked host in the allow-list and named in #source-status; then tiles alone blocked:
the tile host named), A9 (the EN/ES toggle button) and B4 (390 px: map pins = list rows = report.js findings, row
buttons pan the map, axe-core 0 serious/critical in EN and in the Spanish draft). Map, B4 and the B1 1280px map
sub-assertions: wave 184, Fri Oct 16, 2026. Wave 185 (same evening): B4 letter + print (test-spec §L: the letter lists
the same finding ids as the page and report.js on every route, keyboard path, print view, one US Letter page from the
page.pdf() bytes, axe on the open letter) and B4 ?demo=dulles (findings with no input, ms printed). Wave 187 (same
evening): A-motion (reduced motion: no Leaflet pan/zoom/fade animation or inertia, with a no-preference control that
must show them), A-nojs (JavaScript off: p#nojs shown, script-only controls hidden, 320 + 390 px), A-slow (snapshot held
1.5 s: visible role=status loading line, #results aria-busy) and E1 404 retry (offline-error-test-spec E1).
Network rule for every check (test-spec §K harness rules): same-origin requests go through; tiles from
tile.openstreetmap.org are answered with a local PNG stub, so no test ever reaches the real tile server (OSMF Tile
Usage Policy); unpkg.com/leaflet@1.9.4/dist/* goes to unpkg (route.continue_(), SRI checked by the browser) unless
LEAFLET_DIR names a local folder holding the same two files (local runs only, where unpkg is unreachable); any other
host is aborted and fails the check (performance-budget P5). DOM names and pass rules:
browser-checks-b1-b3-plan.md (bare UI, Fri Oct 16, 2026, wave 183).
One line per check; a skip is never a pass. Exit 1 on any failure.
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = 'CrossSafe'

# Declared skips only: {name: reason}. A skip is never a pass.
# Empty since the map commit (wave 184, Fri Oct 16, 2026): the three B1 1280px map sub-assertions (B1-1280-credit,
# B1-1280-zoom200-credit, B1-1280-maptab) now run inside the B1 1280px line (browser-checks-b1-b3-plan B1).
EXPECTED_SKIPS = {}
SCHOOL_ID = '481965001818'
BAD_WORDS = re.compile(r'\b(un)?safe\b|violat', re.I)

passed, failed, skipped = [], [], []


def _png(w, h, rgb):
    """A flat w x h PNG (the tile stub), built with zlib only."""
    import struct
    import zlib

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


TILE_PNG = _png(256, 256, (0xf2, 0xef, 0xe9))  # OSM land colour, flat
MAPJS = json.loads(subprocess.run(
    ['node', '-e', "const M=require('./js/map.js');process.stdout.write(JSON.stringify({hosts:M.ALLOWED_HOSTS,"
     "tile:M.TILE_HOST,leaflet:M.LEAFLET_HOST,css:M.LEAFLET.css.href,js:M.LEAFLET.js.src}))"],
    cwd=ROOT, capture_output=True, text=True, check=True).stdout)
LEAFLET_FILES = {MAPJS['css']: ('leaflet.css', 'text/css'), MAPJS['js']: ('leaflet.js', 'application/javascript')}
EN = json.load(open(os.path.join(ROOT, 'i18n', 'en.json'), encoding='utf-8'))


def install_net(context, block_tiles=False, block_all=False):
    """The network rule in the module docstring. Returns {'outside': [...], 'blocked': [...]}. block_tiles aborts tile
    requests ('blockedbyclient') instead of stubbing them; block_all aborts every non-local request (B3)."""
    rec = {'outside': [], 'blocked': []}
    local_dir = os.environ.get('LEAFLET_DIR')

    def handler(route):
        u = route.request.url
        host = urllib.parse.urlsplit(u).hostname
        if host in ('127.0.0.1', 'localhost'):
            return route.continue_()
        if block_all or (block_tiles and host == MAPJS['tile']):
            rec['blocked'].append(u)
            return route.abort('blockedbyclient')
        if host == MAPJS['tile']:
            return route.fulfill(status=200, content_type='image/png', body=TILE_PNG,
                                 headers={'Cache-Control': 'max-age=604800', 'Access-Control-Allow-Origin': '*'})
        if u in LEAFLET_FILES:
            if local_dir:
                name, ctype = LEAFLET_FILES[u]
                with open(os.path.join(local_dir, name), 'rb') as f:
                    return route.fulfill(status=200, content_type=ctype, body=f.read(),
                                         headers={'Access-Control-Allow-Origin': '*'})
            return route.continue_()
        rec['outside'].append(u)
        return route.abort('blockedbyclient')

    context.route('**/*', handler)
    return rec


def check(name, ok, detail='', measured=''):
    if ok:
        passed.append(name)
        print(f'✓ {name}' + (f': {measured}' if measured else ''))
    else:
        failed.append(name)
        print(f'✗ {name} -> {detail}')


def skip(name, reason):
    if os.environ.get('E2E_FINAL') == '1':
        failed.append(name)
        print(f'✗ {name} -> skip not allowed: E2E_FINAL=1')
    elif EXPECTED_SKIPS.get(name) != reason:
        failed.append(name)
        print(f'✗ {name} -> skip not allowed: not in EXPECTED_SKIPS')
    else:
        skipped.append(name)
        print(f'- {name}: skipped ({reason})')


class Watch:
    """Console errors, page errors and same-origin failed requests / HTTP >= 400 for one page."""

    def __init__(self, page, origin, ignore_outside=False):
        self.errors = []

        def on_console(m):
            if m.type != 'error':
                return
            src = (m.location or {}).get('url') or ''
            if ignore_outside and src and not src.startswith(origin):
                return  # B3: "Failed to load resource" for an outside URL the check blocked on purpose
            self.errors.append('console: ' + m.text)
        page.on('console', on_console)
        page.on('pageerror', lambda e: self.errors.append('pageerror: ' + str(e)))
        page.on('requestfailed', lambda r: self.errors.append(f'requestfailed: {r.url} {r.failure}')
                if r.url.startswith(origin) else None)
        page.on('response', lambda r: self.errors.append(f'HTTP {r.status}: {r.url}')
                if r.status >= 400 and r.url.startswith(origin) else None)


def ready(page):
    """Untimed ready wait (10 s). data-state="error" fails with the page's own message."""
    page.wait_for_selector('main#app[data-state="ready"], main#app[data-state="error"]', timeout=10_000)
    if page.get_attribute('main#app', 'data-state') == 'error':
        raise AssertionError('data-state=error: ' + (page.text_content('#load-error') or '').strip())


def run(name, browser, ctx_opts, fn, net=True):
    """Fresh context per check; a timeout or assertion becomes this check's failure and the run goes on.
    net=True installs the network rule (install_net); any request to a host outside the allow-list fails the check."""
    context = browser.new_context(**ctx_opts)
    try:
        rec = install_net(context) if net else None
        ok, detail, measured = fn(context)
        if rec and rec['outside']:
            ok, detail = False, (detail + '; ' if detail else '') + f"outside host not in the allow-list (P5): {rec['outside'][:3]}"
        check(name, ok, detail, measured)
    except Exception as e:  # noqa: BLE001 (Playwright TimeoutError, AssertionError, ...)
        check(name, False, f'{type(e).__name__}: {str(e).splitlines()[0] if str(e) else ""}')
    finally:
        context.close()


CREDIT_JS = """() => {
  const map = document.getElementById('map');
  map.scrollIntoView({ block: 'center' });
  const c = document.querySelector('#map .leaflet-control-attribution');
  if (!c) return { err: 'no #map .leaflet-control-attribution' };
  const links = [...c.querySelectorAll('a')];
  const cr = c.getBoundingClientRect(), mr = map.getBoundingClientRect();
  const l = links[0], lr = l ? l.getBoundingClientRect() : null;
  const top = lr ? document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2) : null;
  const cs = getComputedStyle(c);
  return { text: c.innerText.trim(), links: links.length, href: l ? l.getAttribute('href') : null,
    h: cr.height, lh: parseFloat(cs.lineHeight) || 18,
    inside: cr.right <= mr.right + 0.5 && cr.bottom <= mr.bottom + 0.5 && cr.left >= mr.left + mr.width / 2 - 0.5
      && cr.top >= mr.top + mr.height / 2 - 0.5,
    inview: !!lr && lr.left >= 0 && lr.top >= 0 && lr.right <= innerWidth && lr.bottom <= innerHeight,
    topmost: !!top && (top === l || l.contains(top)), bg: cs.backgroundColor,
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
}"""


def credit_problems(page):
    """a11y-test-spec A2 attribution rows (1280x900 and 640x450 @2x): exact credit text, 1 link, 1 line, bottom-right
    inside #map, link in the viewport and topmost, solid white box, no horizontal scroll."""
    c = page.evaluate(CREDIT_JS)
    if c.get('err'):
        return [c['err']]
    p = []
    if c['text'] != '© OpenStreetMap contributors':
        p.append(f"credit text {c['text']!r}")
    if c['links'] != 1 or c['href'] != 'https://www.openstreetmap.org/copyright':
        p.append(f"{c['links']} link(s) in the credit, first {c['href']!r}")
    if c['h'] >= 1.5 * c['lh']:
        p.append(f"credit is not one line ({c['h']:.1f} px tall, line-height {c['lh']})")
    if not c['inside']:
        p.append('credit not bottom-right inside #map')
    if not c['inview'] or not c['topmost']:
        p.append(f"credit link in viewport {c['inview']}, topmost {c['topmost']}")
    if c['bg'] != 'rgb(255, 255, 255)':
        p.append(f"credit background {c['bg']}")
    if c['sw'] > c['cw']:
        p.append(f"horizontal scroll ({c['sw']} > {c['cw']})")
    return p


def maptab(page):
    """a11y-test-spec A10-map at 1280: with a route chosen, from a focused #map 4 Tabs go Zoom in -> Zoom out ->
    the OSM credit -> the first row's Show on map button (never still in #map at the end); Shift+Tab x4 -> #map."""
    rid = page.eval_on_selector('#route', "s => [...s.options].map(o => o.value).find(v => v !== '')")
    page.select_option('#route', rid)
    page.wait_for_selector('#findings button.show-on-map', timeout=5000)
    desc = ("() => { const a = document.activeElement; if (!a) return 'none'; if (a.id === 'map') return '#map';"
            " if (a.classList.contains('leaflet-control-zoom-in')) return 'zoom-in';"
            " if (a.classList.contains('leaflet-control-zoom-out')) return 'zoom-out';"
            " if (a.closest('.leaflet-control-attribution')) return 'credit';"
            " if (a.matches('button.show-on-map') && a === document.querySelector('#findings button.show-on-map')) return 'first-row-button';"
            " return a.tagName + (a.id ? '#' + a.id : '') + '.' + a.className; }")
    page.focus('#map')
    seq = []
    for _ in range(4):
        page.keyboard.press('Tab')
        seq.append(page.evaluate(desc))
    back = []
    for _ in range(4):
        page.keyboard.press('Shift+Tab')
        back.append(page.evaluate(desc))
    want = ['zoom-in', 'zoom-out', 'credit', 'first-row-button']
    p = []
    if seq != want:
        p.append(f'Tab order from #map {seq} != {want}')
    if back[-1] != '#map':
        p.append(f'Shift+Tab x4 ends on {back[-1]} (path {back}), want #map')
    return {'problems': p, 'n': len(seq)}


def axe_bad(page):
    """a11y-test-spec A3 pass rule: axe-core 4.14.0 default run, 0 violations with impact serious or critical."""
    page.add_script_tag(path=os.path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'))
    r = page.evaluate("async () => { const r = await axe.run(document); return { v: axe.version,"
                      " bad: r.violations.filter(x => x.impact === 'serious' || x.impact === 'critical')"
                      ".map(x => x.id + ':' + x.impact + ' (' + x.nodes.length + ')'), all: r.violations.length }; }")
    if r['v'] != '4.14.0':
        return [f"axe version {r['v']} != 4.14.0"], r
    return r['bad'], r


def report_json(route_id):
    """The Node truth for B2: one JSON line from scripts/report.js (runbook 6:00 row)."""
    out = subprocess.run(['node', os.path.join(ROOT, 'scripts', 'report.js'), 'dulles', '--route', route_id, '--json'],
                         cwd=ROOT, capture_output=True, text=True, timeout=60)
    lines = [x for x in out.stdout.splitlines() if x.strip()]
    if out.returncode != 0 or len(lines) != 1:
        raise AssertionError(f'report.js --json for {route_id}: exit {out.returncode}, {len(lines)} lines, {out.stderr.strip()[:200]}')
    o = json.loads(lines[0])
    if not isinstance(o.get('findings'), int):
        raise AssertionError(f'report.js --json for {route_id} has no integer "findings" key')
    return o


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def main():
    port = free_port()
    site = tempfile.mkdtemp()
    os.symlink(ROOT, os.path.join(site, REPO))
    server = subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'],
        cwd=site, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f'http://127.0.0.1:{port}/{REPO}/'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        deadline = time.time() + 5
        up = False
        while time.time() < deadline:
            try:
                if opener.open(url, timeout=1).status == 200:
                    up = True
                    break
            except OSError:
                pass
            time.sleep(0.1)
        if not up:
            print('✗ server did not start')
            sys.exit(1)

        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
            origin = f'http://127.0.0.1:{port}/'

            # skeleton contract: first Tab reaches the skip link
            context = browser.new_context(viewport={'width': 1280, 'height': 900})
            install_net(context)
            page = context.new_page()
            errors = []
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(url)
            page.keyboard.press('Tab')
            info = page.evaluate(
                "() => { const a = document.activeElement;"
                " return { tag: a.tagName, cls: a.className, href: a.getAttribute('href'),"
                " app: !!document.getElementById('app') }; }")
            ok = (info['tag'] == 'A' and 'skip' in info['cls'].split()
                  and info['href'] == '#app' and info['app'])
            check('first Tab reaches the skip link (→ #app)', ok,
                  f"{info['tag']}.{info['cls']} href={info['href']} app={info['app']}")
            for e in errors:
                print(f'  console error: {e}')
            context.close()

            # B1: loads clean at 390 px and 1280 px
            def b1(width, height):
                def fn(context):
                    page = context.new_page()
                    w = Watch(page, origin)
                    page.goto(url)
                    ready(page)
                    page.wait_for_selector('#map[data-map="ready"]', timeout=10_000)
                    page.wait_for_load_state('networkidle')
                    sw, cw = page.evaluate('() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]')
                    # exact label texts from en.json (wave 184): get_by_label('Route') is a substring match and since the
                    # map commit it also finds #map (aria-label "Map of the route"), so B1 now asks for each picker's
                    # own label exactly (browser-checks-b1-b3-plan B1 pass rule 3, dated note)
                    n_school = page.get_by_label(EN['SCHOOL_LABEL'], exact=True).count()
                    n_route = page.get_by_label(EN['ROUTE_LABEL'], exact=True).count()
                    problems = []
                    if sw > cw:
                        problems.append(f'horizontal overflow (scrollWidth {sw} > {cw})')
                    if n_school != 1 or n_route != 1:
                        problems.append(f"labels: get_by_label {EN['SCHOOL_LABEL']!r}={n_school}, {EN['ROUTE_LABEL']!r}={n_route} (want 1 each)")
                    measured = f'ready, 0 console errors, no horizontal overflow (scrollWidth {sw} ≤ {cw})'
                    if width == 1280:
                        # named sub-assertions of B1 1280px (browser-checks-b1-b3-plan B1 'Shared list with A2/A10'):
                        # same page, plus one 640x450 @2x context for the 200 % row
                        problems += ['B1-1280-credit: ' + x for x in credit_problems(page)]
                        z = browser.new_context(viewport={'width': 640, 'height': 450}, device_scale_factor=2)
                        try:
                            zrec = install_net(z)
                            zp = z.new_page()
                            zw = Watch(zp, origin)
                            zp.goto(url)
                            ready(zp)
                            zp.wait_for_selector('#map[data-map="ready"]', timeout=10_000)
                            problems += ['B1-1280-zoom200-credit: ' + x for x in credit_problems(zp)]
                            if zw.errors or zrec['outside']:
                                problems.append(f"B1-1280-zoom200-credit: errors {zw.errors[:3]} outside {zrec['outside'][:3]}")
                        finally:
                            z.close()
                        tabs = maptab(page)
                        problems += ['B1-1280-maptab: ' + x for x in tabs['problems']]
                        measured += f"; credit ok @1280 + @200%; map Tab-out {tabs['n']}"
                    if w.errors:
                        problems.append(f'{len(w.errors)} console/page/request errors: ' + ' | '.join(w.errors[:5]))
                    return (not problems, '; '.join(problems), measured)
                return fn

            run('B1 390px', browser, {'viewport': {'width': 390, 'height': 844}}, b1(390, 844))
            run('B1 1280px', browser, {'viewport': {'width': 1280, 'height': 900}}, b1(1280, 900))

            # B2 / B3 shared steps: ready -> school -> first saved route -> findings
            def pick_and_read(page, w, limit_ms, origin_check=True):
                ready(page)
                page.select_option('#school', SCHOOL_ID)
                rid = page.eval_on_selector('#route', "s => [...s.options].map(o => o.value).find(v => v !== '')")
                if not rid:
                    raise AssertionError('select#route has no route option')
                truth = report_json(rid)
                t0 = time.monotonic()
                page.select_option('#route', rid)
                page.wait_for_function("document.querySelectorAll('#results #findings > li.finding').length > 0",
                                       timeout=limit_ms)
                ms = (time.monotonic() - t0) * 1000
                dom = page.evaluate("""() => {
                  const lis = [...document.querySelectorAll('#findings > li.finding')];
                  const live = document.getElementById('findings').closest('[aria-live]');
                  return {
                    n: lis.length,
                    fids: lis.map(li => li.getAttribute('data-finding-id')),
                    osm: lis.map(li => li.getAttribute('data-osm-id')),
                    live: live ? live.id + ':' + live.getAttribute('aria-live') : null,
                    summary: (document.getElementById('summary').textContent || '').trim(),
                    status: (document.querySelector('#source-status li[data-source="snapshot"]') || {}).textContent || '',
                    results: document.getElementById('results').innerText,
                  };
                }""")
                problems = []
                if dom['live'] != 'results:polite':
                    problems.append(f"#findings live region is {dom['live']}, want results:polite")
                m = re.match(r'^Map data as of (\d{4}-\d{2}-\d{2})$', dom['status'].strip())
                if not m:
                    problems.append(f"#source-status snapshot line is {dom['status']!r}")
                elif not dom['summary'] or m.group(1) not in dom['summary']:
                    problems.append(f"#summary {dom['summary'][:80]!r} lacks the data date {m.group(1)}")
                if dom['n'] != truth['findings']:
                    problems.append(f"{dom['n']} li.finding vs report.js findings {truth['findings']}")
                want_fids = [f['fid'] for f in truth['list']]
                if dom['fids'] != want_fids:
                    problems.append('data-finding-id list != report.js fids (CS-L1-FID)')
                if dom['osm'] != [f['osm_id'] for f in truth['list']]:
                    problems.append('data-osm-id list != report.js osm_ids')
                if len(set(dom['fids'])) != len(dom['fids']):
                    problems.append('duplicate data-finding-id')
                bad = BAD_WORDS.search(dom['results'])
                if bad:
                    problems.append(f'wording rule: {bad.group(0)!r} in #results')
                if w.errors:
                    problems.append(f'{len(w.errors)} console/page/request errors: ' + ' | '.join(w.errors[:5]))
                return rid, truth, dom, ms, problems

            def b2(context):
                page = context.new_page()
                w = Watch(page, origin)
                page.goto(url)
                raw = opener.open(url, timeout=5).read().decode('utf-8')
                tag = re.search(r'<section[^>]*\bid="results"[^>]*>', raw)
                problems = []
                if not tag or 'aria-live="polite"' not in tag.group(0):
                    problems.append('served index.html has no <section id="results" aria-live="polite">')
                rid, truth, dom, ms, more = pick_and_read(page, w, 2000)
                problems += more
                if ms > 2000:
                    problems.append(f'{ms:.0f} ms > 2000')
                return (not problems, '; '.join(problems),
                        f"{dom['n']} findings in #results (aria-live=polite) {ms:.0f} ms ≤ 2000, "
                        f"matches report.js ({truth['findings']}; route {rid}; finding ids equal)")

            run('B2 390px', browser, {'viewport': {'width': 390, 'height': 844}}, b2)

            # B3 from the map commit (browser-checks-b1-b3-plan §3b, wave 184): every non-local host blocked ->
            # blocked is non-empty, every blocked host is in js/map.js ALLOWED_HOSTS, and each one is named in
            # #source-status li[data-source="<host>"] with SOURCE_UNREACHABLE; findings, the data date and the CRIS line
            # still show; no text says "safe". Then, in a second context, Leaflet loads but tiles are blocked: the tile
            # host is named the same way (offline-error E6: tested with the tile route aborted, never the real host).
            src = json.load(open(os.path.join(ROOT, 'data', 'sources.json'), encoding='utf-8'))
            cris_want = (f"{EN['CRIS_NOT_INCLUDED']}. {EN['CRIS_NOT_INCLUDED_NOTE']}"
                         if src['raw']['cris-2025-2026']['status'] == 'not_included' else None)

            def status_lines(page):
                return page.evaluate("() => Object.fromEntries([...document.querySelectorAll('#source-status li')]"
                                     ".map(li => [li.getAttribute('data-source'), li.textContent]))")

            def unreachable_text(host, page):
                d = page.evaluate("() => (document.querySelector('#source-status li[data-source=\"snapshot\"]') || {}).textContent || ''")
                m = re.search(r'(\d{4}-\d{2}-\d{2})', d)
                return EN['SOURCE_UNREACHABLE'].replace('{host}', host).replace('{date}', m.group(1) if m else '?')

            def b3(context):
                rec = install_net(context, block_all=True)
                page = context.new_page()
                w = Watch(page, origin, ignore_outside=True)
                page.goto(url)
                rid, truth, dom, ms, problems = pick_and_read(page, w, 5000)
                page.wait_for_selector('#map[data-map="unavailable"]', state='attached', timeout=10_000)
                page.wait_for_load_state('networkidle')
                hosts = sorted({urllib.parse.urlsplit(u).hostname for u in rec['blocked']})
                lines = status_lines(page)
                if not hosts:
                    problems.append('blocked is empty (the map commit must try its outside hosts)')
                for h in hosts:
                    if h not in MAPJS['hosts']:
                        problems.append(f'blocked host {h} not in the allow-list {MAPJS["hosts"]} (P5)')
                    elif lines.get(h) != unreachable_text(h, page):
                        problems.append(f'#source-status for {h}: {lines.get(h)!r}')
                if lines.get('cris-2025-2026') != cris_want:
                    problems.append(f"CRIS line {lines.get('cris-2025-2026')!r} != {cris_want!r}")
                if page.is_visible('#map'):
                    problems.append('#map still visible with Leaflet blocked')
                if BAD_WORDS.search(page.inner_text('#source-status')):
                    problems.append('wording rule in #source-status')
                # tiles only
                t = browser.new_context(viewport={'width': 1280, 'height': 900}, service_workers='block')
                try:
                    trec = install_net(t, block_tiles=True)
                    tp = t.new_page()
                    tw = Watch(tp, origin, ignore_outside=True)
                    tp.goto(url)
                    ready(tp)
                    tp.wait_for_selector('#map[data-map="ready"]', timeout=10_000)
                    tp.select_option('#route', rid)
                    tp.wait_for_selector(f'#source-status li[data-source="{MAPJS["tile"]}"]', timeout=5000)
                    tl = status_lines(tp)
                    if tl.get(MAPJS['tile']) != unreachable_text(MAPJS['tile'], tp):
                        problems.append(f"tiles blocked: #source-status {tl.get(MAPJS['tile'])!r}")
                    if not trec['blocked'] or trec['outside']:
                        problems.append(f"tiles blocked: {len(trec['blocked'])} blocked, outside {trec['outside'][:3]}")
                    n_t = tp.locator('#findings > li.finding').count()
                    if n_t != truth['findings']:
                        problems.append(f"tiles blocked: {n_t} rows vs report.js {truth['findings']}")
                    if tw.errors:
                        problems.append(f'tiles blocked: errors {tw.errors[:3]}')
                finally:
                    t.close()
                return (not problems, '; '.join(problems),
                        f"{', '.join(hosts)} → named in #source-status; {dom['n']} findings shown, data date shown, "
                        f"CRIS 2025-26 line {'shown' if cris_want else 'absent (included)'}; "
                        f"tiles alone blocked → {MAPJS['tile']} named")

            run('B3 outside hosts blocked', browser,
                {'viewport': {'width': 1280, 'height': 900}, 'service_workers': 'block'}, b3, net=False)

            # A9: the visible EN/ES toggle (a11y-test-spec A9 lang switch, A2m 44x44, W4 a button: no reload, focus
            # stays). Added Fri Oct 16, 2026 (wave 184). Strings come from i18n/*.json, never literals here.
            def a9(context):
                en = json.load(open(os.path.join(ROOT, 'i18n', 'en.json'), encoding='utf-8'))
                es = json.load(open(os.path.join(ROOT, 'i18n', 'es.json'), encoding='utf-8'))
                page = context.new_page()
                w = Watch(page, origin)
                page.goto(url)
                ready(page)
                rid = page.eval_on_selector('#route', "s => [...s.options].map(o => o.value).find(v => v !== '')")
                page.select_option('#route', rid)
                page.wait_for_function("document.querySelectorAll('#findings > li.finding').length > 0", timeout=5000)
                n0 = page.locator('#findings > li.finding').count()
                page.evaluate('() => { window.__noReload = 1; }')
                problems = []
                box = page.locator('button#lang').bounding_box()
                if not box or box['width'] < 43.99 or box['height'] < 43.99:
                    problems.append(f"button#lang {box and round(box['width'], 2)}x{box and round(box['height'], 2)} < 44x44 (A2m)")
                if page.text_content('button#lang') != en['LANG_TOGGLE_TO_ES']:
                    problems.append(f"EN button text {page.text_content('button#lang')!r}")
                page.focus('button#lang')
                page.keyboard.press('Enter')
                page.wait_for_function("document.documentElement.lang === 'es'", timeout=2000)
                st = page.evaluate('''() => ({
                  active: document.activeElement && document.activeElement.id,
                  kept: window.__noReload === 1,
                  school: document.querySelector('label[for="school"]').textContent,
                  route: document.querySelector('label[for="route"]').textContent,
                  ph: document.querySelector('#route option[value=""]').textContent,
                  value: document.getElementById('route').value,
                  btn: document.getElementById('lang').textContent,
                  btnLang: document.getElementById('lang').getAttribute('lang'),
                  note: document.getElementById('lang-note').hidden ? null : document.getElementById('lang-note').textContent,
                  noteLang: document.getElementById('lang-note').getAttribute('lang'),
                  n: document.querySelectorAll('#findings > li.finding').length,
                  enOnly: ['.intro', '#summary', '#findings'].filter(s => document.querySelector(s).getAttribute('lang') !== 'en'),
                  search: location.search,
                })''')
                want = {'active': 'lang', 'kept': True, 'school': es['SCHOOL_LABEL'], 'route': es['ROUTE_LABEL'],
                        'ph': es['ROUTE_PLACEHOLDER'], 'value': rid, 'btn': en['LANG_TOGGLE_TO_EN'], 'btnLang': 'en',
                        'note': en['LANG_DRAFT_NOTE'], 'noteLang': 'en', 'n': n0, 'enOnly': [], 'search': '?lang=es'}
                for k, v in want.items():
                    if st[k] != v:
                        problems.append(f'ES {k}: {st[k]!r} != {v!r}')
                page.click('button#lang')
                page.wait_for_function("document.documentElement.lang === 'en'", timeout=2000)
                back = page.evaluate('''() => ({ route: document.querySelector('label[for="route"]').textContent,
                  note: document.getElementById('lang-note').hidden, kept: window.__noReload === 1,
                  btn: document.getElementById('lang').textContent, search: location.search })''')
                if back != {'route': en['ROUTE_LABEL'], 'note': True, 'kept': True, 'btn': en['LANG_TOGGLE_TO_ES'], 'search': ''}:
                    problems.append(f'back to EN: {back}')
                if w.errors:
                    problems.append(f'{len(w.errors)} console/page/request errors: ' + ' | '.join(w.errors[:5]))
                return (not problems, '; '.join(problems),
                        f"Enter → <html lang=es>, labels from es.json, {n0} findings kept, focus on button#lang, no reload; "
                        f"click → en; button {box['width']:.0f}x{box['height']:.0f}")

            run('A9 lang toggle 390px', browser, {'viewport': {'width': 390, 'height': 844}}, a9)

            # B4 (kickoff-runbook test plan §B4, map part; wave 184). Built here: map and list show the same findings
            # (one pin per row, same fids, = report.js), the row button's name rule + pan (a11y-test-spec W3), zoom
            # buttons 44x44 (A2), #map region name + hint (A1-map (e)), axe-core 4.14.0 0 serious/critical at 390 px
            # in EN and in the Spanish draft (A3 pass), and the toggle switches lang with the map present (A9).
            # The letter + Print-to-one-page and ?demo=dulles are the next two checks (wave 185).
            def b4(context):
                page = context.new_page()
                w = Watch(page, origin)
                page.goto(url)
                ready(page)
                page.wait_for_selector('#map[data-map="ready"]', timeout=10_000)
                rid = page.eval_on_selector('#route', "s => [...s.options].map(o => o.value).find(v => v !== '')")
                truth = report_json(rid)
                page.select_option('#route', rid)
                page.wait_for_function(
                    "() => { const n = document.querySelectorAll('#findings > li.finding').length; return n > 0"
                    " && document.querySelectorAll('#map path.leaflet-interactive').length === n"
                    " && document.querySelectorAll('#findings button.show-on-map').length === n; }", timeout=5000)
                st_js = '''() => ({
                  rows: [...document.querySelectorAll('#findings > li.finding')].map(li => li.getAttribute('data-finding-id')),
                  pins: [...document.querySelectorAll('#map path.leaflet-interactive')].map(p => p.getAttribute('data-finding-id')),
                  pinTab: [...document.querySelectorAll('#map path.leaflet-interactive')].filter(p => p.tabIndex >= 0 || p.hasAttribute('tabindex')).length,
                  texts: [...document.querySelectorAll('#findings button.show-on-map')].map(b => b.textContent),
                  names: [...document.querySelectorAll('#findings button.show-on-map')].map(b => b.getAttribute('aria-label')),
                  btnLang: [...new Set([...document.querySelectorAll('#findings button.show-on-map')].map(b => b.getAttribute('lang')))],
                  zoom: ['.leaflet-control-zoom-in', '.leaflet-control-zoom-out'].map(s => { const r = document.querySelector('#map ' + s).getBoundingClientRect(); return [r.width, r.height]; }),
                  role: document.getElementById('map').getAttribute('role'),
                  label: document.getElementById('map').getAttribute('aria-label'),
                  mapLang: document.getElementById('map').getAttribute('lang'),
                  describedby: document.getElementById('map').getAttribute('aria-describedby'),
                  hint: document.getElementById('map-hint').textContent,
                  lang: document.documentElement.lang,
                })'''
                st = page.evaluate(st_js)
                problems = []
                want_fids = [f['fid'] for f in truth['list']]
                if not (st['rows'] == st['pins'] == want_fids):
                    problems.append(f"map/list parity: {len(st['pins'])} pins, {len(st['rows'])} rows, report.js {len(want_fids)} (fids equal: {st['rows'] == st['pins'] == want_fids})")
                if st['pinTab']:
                    problems.append(f"{st['pinTab']} pins in the Tab order (CS-W1-PINS: never)")
                if set(st['texts']) != {EN['SHOW_ON_MAP']}:
                    problems.append(f"W3(a) button texts {sorted(set(st['texts']))[:3]}")
                if len(set(st['names'])) != len(st['rows']) or not all(n.startswith(EN['SHOW_ON_MAP'] + ': ') for n in st['names']):
                    problems.append(f"W3(b/c) names: {len(set(st['names']))} distinct of {len(st['rows'])}")
                for (zw, zh), nm in zip(st['zoom'], ('zoom-in', 'zoom-out')):
                    if zw < 43.99 or zh < 43.99:
                        problems.append(f'A2 .leaflet-control-{nm} {zw:.0f}x{zh:.0f} < 44x44')
                if st['role'] != 'region' or st['label'] != EN['MAP_LABEL'] or st['describedby'] != 'map-hint' or st['hint'] != EN['MAP_KEYS_HINT']:
                    problems.append(f"A1-map(e) role {st['role']} label {st['label']!r} hint {st['hint']!r}")
                if page.get_by_role('region', name=EN['MAP_LABEL']).count() != 1:
                    problems.append('A1-map(e): no single region named MAP_LABEL in the accessibility tree')
                # W3: click (no drag) the k-th row's button -> that pin sits at the map's centre
                k = min(2, len(st['rows']) - 1)
                fid = st['rows'][k]
                page.locator('#findings button.show-on-map').nth(k).click()
                try:
                    page.wait_for_function(
                        "(fid) => { const m = document.getElementById('map').getBoundingClientRect();"
                        " const p = document.querySelector(`#map path.leaflet-interactive[data-finding-id=\"${fid}\"]`);"
                        " if (!p) return false; const r = p.getBoundingClientRect();"
                        " return Math.abs(r.left + r.width / 2 - (m.left + m.width / 2)) <= 2"
                        " && Math.abs(r.top + r.height / 2 - (m.top + m.height / 2)) <= 2; }", arg=fid, timeout=2000)
                except Exception:  # noqa: BLE001
                    problems.append(f'W3: row {k} button did not centre pin {fid}')
                bad_en, r_en = axe_bad(page)
                if bad_en:
                    problems.append(f'axe EN: {bad_en}')
                page.click('button#lang')
                page.wait_for_function("document.documentElement.lang === 'es'", timeout=2000)
                es = page.evaluate(st_js)
                if es['rows'] != st['rows'] or es['pins'] != st['pins']:
                    problems.append('ES: rows/pins changed on the language switch')
                if es['label'] != EN['MAP_LABEL'] or es['mapLang'] != 'en' or es['hint'] != EN['MAP_KEYS_HINT'] or es['btnLang'] != ['en']:
                    problems.append(f"ES: English-only map strings must carry lang=en (map lang {es['mapLang']}, buttons {es['btnLang']})")
                bad_es, r_es = axe_bad(page)
                if bad_es:
                    problems.append(f'axe ES: {bad_es}')
                if w.errors:
                    problems.append(f'{len(w.errors)} console/page/request errors: ' + ' | '.join(w.errors[:5]))
                return (not problems, '; '.join(problems),
                        f"{len(st['pins'])} pins = {len(st['rows'])} rows = report.js {truth['findings']} (route {rid}); "
                        f"row button {k} centred its pin; zoom {st['zoom'][0][0]:.0f}x{st['zoom'][0][1]:.0f}; "
                        f"axe 4.14.0 serious/critical 0 EN ({r_en['all']} minor/moderate) + 0 ES ({r_es['all']}); lang es")

            run('B4 390px map + list', browser, {'viewport': {'width': 390, 'height': 844}}, b4)

            # B4 letter + print (test-spec §L; kickoff-runbook §B4 'keyboard-only path to the letter' and 'Print -> 1
            # Letter page'; wave 185, Fri Oct 16, 2026). [DESIGN] the button is button#letter-open (HTML ids are unique;
            # the article keeps #letter). Built and asserted: L0 (both present), L1 for every select#route option
            # (letter data-finding-id set = #findings = report.js fids, same count, no duplicates), L2 addressee + no
            # email/phone/greeting/delivery wording, L6 print view (only the letter shown, OSM credit visible as printed
            # text with the copyright URL, data dates = #source-status, CRIS line exact), L7 one US Letter page counted
            # from page.pdf() bytes for the first route and L7b for the route with the most findings (findings text
            # >= 10 pt), L8 wording, L9 no inputs, L10 Tab -> Enter -> focus on the letter heading, Escape and Back
            # return focus, axe-core 4.14.0 0 serious/critical on the open letter at 390 px in EN and in the Spanish
            # page. Not built, so not asserted: L3 count line / L4 observations (no data/field-checks.json yet).
            # L5 QR + printed live link (wave 186, Fri Oct 16, 2026): in the print view of both printed routes, the QR image
            # the browser renders is screenshotted and DECODED (zxing-cpp, pinned in requirements-dev.txt) and must read
            # data/sources.json live_url, which must be https://aariv.me/CrossSafe/ (the GitHub Pages URL in the README);
            # figcaption#letter-url prints that same URL as visible text; the served img/qr-live.svg is byte-identical
            # to a fresh segno 1.6.6 encode of live_url (scripts/make-qr.py encode(), test-spec L5(b)); the alt text is
            # LETTER_QR_ALT; the only img in the letter is the QR; no request leaves the origin (run(): P5).
            L_BAD = re.compile(r'\b(safe|unsafe|dangerous|violat\w*)\b', re.I)
            L_PRIVATE = [(re.compile(r'\S+@\S+\.\w+'), 'email'), (re.compile(r'\d{3}[-.\s)]+\d{3}[-.\s]\d{4}'), 'phone'),
                         (re.compile(r'\bDear\b|\bsent\b|submitted to|\bsincerely\b', re.I), 'greeting/delivery wording')]

            LIVE_URL = 'https://aariv.me/CrossSafe/'  # README live link; sources.json live_url must equal it

            def qr_check(tag):
                """L5 on the open letter in the current media: decode what the browser drew, caption, alt, bytes."""
                import io
                from PIL import Image
                import zxingcpp
                sys.path.insert(0, os.path.join(ROOT, 'scripts'))
                import importlib
                mq = importlib.import_module('make-qr')
                out = []
                live = src.get('live_url')
                if live != LIVE_URL:
                    out.append(f'L5 {tag}: data/sources.json live_url {live!r} != {LIVE_URL!r}')
                q = page_ref['p'].evaluate('''() => {
                  const f = document.getElementById('letter-qr'), img = f && f.querySelector('img'), cap = document.getElementById('letter-url');
                  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && r.width > 0 && r.height > 0; };
                  const r = img ? img.getBoundingClientRect() : null;
                  return { fig: !!f, src: img ? img.getAttribute('src') : null, alt: img ? img.getAttribute('alt') : null,
                           loaded: !!img && img.complete && img.naturalWidth > 0, imgVis: vis(img), w: r ? r.width : 0,
                           cap: cap ? cap.textContent : null, capVis: vis(cap), imgs: document.querySelectorAll('#letter img').length,
                           inLetter: !!f && !!f.closest('article#letter') };
                }''')
                if not (q['fig'] and q['inLetter'] and q['src'] == 'img/qr-live.svg'):
                    out.append(f"L5 {tag}: want figure#letter-qr > img[src=img/qr-live.svg] inside article#letter, got {q}")
                if q['imgs'] != 1:
                    out.append(f"L4/L5 {tag}: {q['imgs']} img in the letter, want only the QR")
                if q['alt'] != EN['LETTER_QR_ALT']:
                    out.append(f"L5 {tag}: QR alt {q['alt']!r}")
                if not (q['loaded'] and q['imgVis']):
                    out.append(f"L5 {tag}: QR image not loaded/visible (loaded {q['loaded']}, visible {q['imgVis']})")
                if q['cap'] != live or not q['capVis']:
                    out.append(f"L5(a) {tag}: printed link {q['cap']!r} (visible {q['capVis']}) != live_url {live!r}")
                got = []
                if q['imgVis']:  # a hidden QR is named above; a screenshot of it would only time out
                    png = page_ref['p'].locator('#letter-qr > img').screenshot(timeout=5000)
                    im = Image.open(io.BytesIO(png)).convert('L')
                    im = im.resize((im.width * 4, im.height * 4), Image.NEAREST)
                    got = [r.text for r in zxingcpp.read_barcodes(im)]
                if got != [live]:
                    out.append(f'L5 {tag}: QR drawn by the browser decodes to {got!r}, want [{live!r}]')
                served = opener.open(url + 'img/qr-live.svg', timeout=5).read()
                _, _, fresh, code = mq.encode(ROOT)
                if served != fresh:
                    out.append(f'L5(b) {tag}: served img/qr-live.svg ({len(served)} B) != fresh segno encode of live_url ({len(fresh)} B)')
                return out, f"QR decodes to {got[0] if got else None} ({q['w']:.0f} px, v{code.version}-{code.error}), printed next to it, SVG = re-encode"

            page_ref = {}

            def pdf_pages(pdf):
                """test-spec L7: page count from the PDF bytes, never pdfinfo. Fails (None) if it can't be read."""
                leaf = len(re.findall(rb'/Type\s*/Page(?![a-zA-Z])', pdf))
                counts = [int(m) for d in re.findall(rb'<<(?:(?!>>).)*?/Type\s*/Pages\b(?:(?!>>).)*>>', pdf, re.S)
                          for m in re.findall(rb'/Count\s+(\d+)', d)]
                if not leaf or not counts:
                    return None, leaf, counts
                return (counts[0] if counts[0] == leaf else -1), leaf, counts

            LETTER_STATE = '''() => {
              const a = document.getElementById('letter');
              const act = document.activeElement;
              return {
                open: document.getElementById('app').getAttribute('data-letter') === 'open' && !a.hidden,
                active: act ? (act.id || act.tagName) : null,
                rows: [...document.querySelectorAll('#findings > li.finding')].map(li => li.getAttribute('data-finding-id')),
                letter: [...document.querySelectorAll('#letter-findings > li')].map(li => li.getAttribute('data-finding-id')),
                to: (document.getElementById('letter-to').textContent || '').trim(),
                text: a.innerText,
                inputs: a.querySelectorAll('input, textarea, select, [contenteditable]').length,
                obs: !!document.getElementById('letter-observations'),
                dates: Object.fromEntries([...document.querySelectorAll('#letter-dates > li')].map(li => [li.getAttribute('data-source'), li.textContent])),
                status: (document.querySelector('#source-status li[data-source="snapshot"]') || {}).textContent || '',
                lang: a.getAttribute('lang'),
                pageLang: document.documentElement.lang,
              };
            }'''

            def b4_letter(context):
                page = context.new_page()
                page_ref['p'] = page
                w = Watch(page, origin)
                page.goto(url)
                ready(page)
                page.wait_for_selector('#map[data-map="ready"]', timeout=10_000)
                problems = []
                if page.locator('button#letter-open').count() != 1 or page.locator('article#letter').count() != 1:
                    problems.append('L0: want exactly one button#letter-open and one article#letter')
                if not page.is_disabled('button#letter-open'):
                    problems.append('letter button enabled before a route is chosen')
                rids = page.eval_on_selector('#route', "s => [...s.options].map(o => o.value).filter(v => v !== '')")
                counts = {}
                first = True
                for rid in rids:
                    truth = report_json(rid)
                    want = [f['fid'] for f in truth['list']]
                    counts[rid] = truth['findings']
                    page.select_option('#route', rid)
                    page.wait_for_function("document.querySelectorAll('#findings > li.finding').length > 0", timeout=5000)
                    # L10 keyboard path: from select#route, Tab reaches button#letter-open, Enter opens, focus on the heading
                    page.focus('#route')
                    page.keyboard.press('Tab')
                    at = page.evaluate('() => document.activeElement && document.activeElement.id')
                    if at != 'letter-open':
                        problems.append(f'L10 {rid}: Tab from #route lands on {at!r}, want letter-open')
                        page.focus('button#letter-open')
                    page.keyboard.press('Enter')
                    page.wait_for_function("document.getElementById('app').getAttribute('data-letter') === 'open'", timeout=2000)
                    st = page.evaluate(LETTER_STATE)
                    if st['active'] != 'letter-title':
                        problems.append(f"L10 {rid}: focus after Enter on {st['active']!r}, want letter-title")
                    # L1: same set and count as #findings and report.js, no duplicates
                    only_list = sorted(set(st['rows']) - set(st['letter']))
                    only_letter = sorted(set(st['letter']) - set(st['rows']))
                    if only_list or only_letter or len(st['letter']) != len(st['rows']) or st['letter'] != want:
                        problems.append(f"L1 {rid}: letter {len(st['letter'])} vs list {len(st['rows'])} vs report.js {len(want)}; "
                                        f"only in #findings {only_list[:3]}, only in the letter {only_letter[:3]}")
                    if len(set(st['letter'])) != len(st['letter']):
                        problems.append(f'L1 {rid}: duplicate data-finding-id in the letter')
                    if st['to'] != 'To whom it may concern / road owner':
                        problems.append(f"L2 {rid}: addressee {st['to']!r}")
                    for rx, what in L_PRIVATE:
                        if rx.search(st['text']):
                            problems.append(f'L2 {rid}: {what} in the letter: {rx.search(st["text"]).group(0)!r}')
                    bad = L_BAD.search(st['text'])
                    if bad:
                        problems.append(f'L8 {rid}: wording {bad.group(0)!r} in the letter')
                    if st['inputs']:
                        problems.append(f"L9 {rid}: {st['inputs']} input element(s) in the letter")
                    if st['obs']:
                        problems.append(f'L3 {rid}: section#letter-observations present with no field checks shipped')
                    if st['dates'].get('snapshot') != st['status'] or st['dates'].get('cris-2025-2026') != (EN['CRIS_NOT_INCLUDED'] if cris_want else st['dates'].get('cris-2025-2026')):
                        problems.append(f"L6 {rid}: letter dates {st['dates']} vs #source-status {st['status']!r}")
                    if first:
                        first = False
                        bad_en, r_en = axe_bad(page)
                        if bad_en:
                            problems.append(f'L10 axe EN (letter open): {bad_en}')
                        # Back button returns focus
                        page.click('#letter-back')
                        if page.evaluate("() => [document.getElementById('app').getAttribute('data-letter'), document.activeElement.id]") != [None, 'letter-open']:
                            problems.append('L10: Back did not close the letter and return focus to button#letter-open')
                        page.keyboard.press('Enter')
                        page.wait_for_function("document.getElementById('app').getAttribute('data-letter') === 'open'", timeout=2000)
                    page.keyboard.press('Escape')
                    esc = page.evaluate("() => [document.getElementById('app').getAttribute('data-letter'), document.activeElement && document.activeElement.id, document.getElementById('letter').hidden]")
                    if esc != [None, 'letter-open', True]:
                        problems.append(f'L10 {rid}: Escape left {esc}, want closed + focus on button#letter-open')
                        if esc[0] == 'open':
                            page.click('#letter-back')  # so the next route can be picked and the run names this failure

                # L6 + L7: print view of the first route, then L7b the route with the most findings
                def print_check(rid, tag):
                    page.select_option('#route', rid)
                    page.wait_for_function("document.querySelectorAll('#findings > li.finding').length > 0", timeout=5000)
                    page.click('button#letter-open')
                    page.wait_for_function("document.getElementById('app').getAttribute('data-letter') === 'open'", timeout=2000)
                    page.emulate_media(media='print')
                    pv = page.evaluate('''() => {
                      const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0; };
                      const credit = document.getElementById('letter-credit');
                      const shown = [...document.querySelectorAll('body > *, #app > *')].filter(e => e.id !== 'letter' && e.id !== 'app' && getComputedStyle(e).display !== 'none').map(e => e.tagName + (e.id ? '#' + e.id : '.' + e.className));
                      const li = document.querySelector('#letter-findings > li');
                      return { credit: vis(credit) ? credit.innerText : null, shown, tools: getComputedStyle(document.getElementById('letter-tools')).display,
                               fontPx: li ? parseFloat(getComputedStyle(li).fontSize) : 0, n: document.querySelectorAll('#letter-findings > li').length };
                    }''')
                    if not pv['credit'] or '© OpenStreetMap contributors' not in pv['credit'] or 'openstreetmap.org/copyright' not in pv['credit']:
                        problems.append(f"L6 {tag}: credit in print {pv['credit']!r}")
                    shown = [x for x in pv['shown'] if not x.startswith(('SCRIPT', 'LINK', 'STYLE'))]
                    if shown:
                        problems.append(f'L6 {tag}: shown outside article#letter in print: {shown[:5]}')
                    if pv['tools'] != 'none':
                        problems.append(f"L6 {tag}: #letter-tools display {pv['tools']} in print")
                    if pv['fontPx'] < 13.3:
                        problems.append(f"L7b {tag}: findings text {pv['fontPx']:.2f}px < 10 pt")
                    qp, qm = qr_check(tag + ' print')
                    problems.extend(qp)
                    qms.append(qm)
                    pdf = page.pdf(format='Letter')
                    pages, leaf, cnt = pdf_pages(pdf)
                    page.emulate_media(media='screen')
                    page.click('#letter-back')  # Back, not Escape: Escape is checked (and named) in the L10 loop above
                    if pages is None:
                        problems.append(f'L7 {tag}: page count not readable (leaf {leaf}, /Count {cnt})')
                    elif pages != 1 or leaf != 1:
                        problems.append(f'L7 {tag}: {leaf} page(s) (/Count {cnt}), want 1 US Letter page')
                    return f"{tag} {pv['n']} findings → {leaf} page"

                most = max(rids, key=lambda r: (counts[r], r))
                qms = []
                p1 = print_check(rids[0], 'L7')
                p2 = print_check(most, 'L7b')
                # L10 in the Spanish page: switch (letter closed: the toggle is hidden while it is open), reopen, axe
                page.click('button#lang')
                page.wait_for_function("document.documentElement.lang === 'es'", timeout=2000)
                page.click('button#letter-open')
                page.wait_for_function("document.getElementById('app').getAttribute('data-letter') === 'open'", timeout=2000)
                st = page.evaluate(LETTER_STATE)
                if st['lang'] != 'en' or st['pageLang'] != 'es':
                    problems.append(f"ES: letter lang {st['lang']!r} in a {st['pageLang']!r} page, want English-only text tagged lang=en")
                if page.get_attribute('button#letter-open', 'lang') != 'en':
                    problems.append('ES: button#letter-open English text must carry lang=en')
                bad_es, r_es = axe_bad(page)
                if bad_es:
                    problems.append(f'L10 axe ES (letter open): {bad_es}')
                if w.errors:
                    problems.append(f'{len(w.errors)} console/page/request errors: ' + ' | '.join(w.errors[:5]))
                return (not problems, '; '.join(problems),
                        f"L1 letter ids = #findings = report.js on {len(rids)} routes ({', '.join(str(counts[r]) for r in rids)} findings, no duplicates); "
                        f"Tab → Enter → heading, Back + Escape return focus; print: only the letter, credit printed; {p1}, {p2}; "
                        f"L5 {qms[0] if qms else 'not run'}; "
                        f"axe 4.14.0 serious/critical 0 EN ({r_en['all']}) + 0 ES ({r_es['all']}), letter lang=en in ES")

            run('B4 letter + print 390px', browser, {'viewport': {'width': 390, 'height': 844}}, b4_letter)

            # B4 ?demo=dulles (kickoff-runbook §B4 "`?demo=dulles` shows the first finding with no input (ms printed;
            # 20 s = human target, S7)", build-plan S7; wave 185, Fri Oct 16, 2026). No click, key or select here: open
            # the link, wait for the first li.finding, print the ms from goto() to it. Then: school + first route picked
            # (= the first select#route option, js/render.js demoRouteStem), rows = report.js fids, focus not moved,
            # the letter button enabled, one pin per row once the map is up; ?demo=dulles&lang=es gives the same rows in
            # the Spanish-draft page; an unknown ?demo= value picks nothing.
            def b4_demo(context):
                page = context.new_page()
                w = Watch(page, origin)
                t0 = time.monotonic()
                page.goto(url + '?demo=dulles')
                page.wait_for_function("document.querySelectorAll('#findings > li.finding').length > 0", timeout=20_000)
                ms = (time.monotonic() - t0) * 1000
                ready(page)
                problems = []
                first = page.eval_on_selector('#route', "s => [...s.options].map(o => o.value).find(v => v !== '')")
                st = page.evaluate('''() => ({ route: document.getElementById('route').value, school: document.getElementById('school').value,
                  rows: [...document.querySelectorAll('#findings > li.finding')].map(li => li.getAttribute('data-finding-id')),
                  active: document.activeElement ? document.activeElement.tagName : null,
                  letter: !document.getElementById('letter-open').disabled, search: location.search })''')
                truth = report_json(first)
                want = [f['fid'] for f in truth['list']]
                if st['route'] != first or st['school'] != SCHOOL_ID:
                    problems.append(f"picked route {st['route']!r} school {st['school']!r}, want {first!r} {SCHOOL_ID!r}")
                if st['rows'] != want:
                    problems.append(f"{len(st['rows'])} rows vs report.js {len(want)} (fids equal: {st['rows'] == want})")
                if st['active'] != 'BODY':
                    problems.append(f"focus moved to {st['active']} with no input")
                if not st['letter']:
                    problems.append('letter button not enabled after the demo pick')
                if st['search'] != '?demo=dulles':
                    problems.append(f"URL changed to {st['search']!r}")
                page.wait_for_selector('#map[data-map="ready"]', timeout=10_000)
                page.wait_for_function("document.querySelectorAll('#map path.leaflet-interactive').length === document.querySelectorAll('#findings > li.finding').length", timeout=5000)
                # Spanish-draft page through the same link
                es = context.new_page()
                ws = Watch(es, origin)
                es.goto(url + '?demo=dulles&lang=es')
                es.wait_for_function("document.querySelectorAll('#findings > li.finding').length > 0", timeout=20_000)
                ready(es)
                e = es.evaluate("() => ({ lang: document.documentElement.lang, route: document.getElementById('route').value,"
                                " rows: [...document.querySelectorAll('#findings > li.finding')].map(li => li.getAttribute('data-finding-id')) })")
                if e != {'lang': 'es', 'route': first, 'rows': want}:
                    problems.append(f"?demo=dulles&lang=es: lang {e['lang']}, route {e['route']}, rows {len(e['rows'])}")
                # an unknown value picks nothing
                un = context.new_page()
                wu = Watch(un, origin)
                un.goto(url + '?demo=elsewhere')
                ready(un)
                u = un.evaluate("() => [document.getElementById('route').value, document.querySelectorAll('#findings > li.finding').length]")
                if u != ['', 0]:
                    problems.append(f'?demo=elsewhere picked {u}, want nothing')
                errs = w.errors + ws.errors + wu.errors
                if errs:
                    problems.append(f'{len(errs)} console/page/request errors: ' + ' | '.join(errs[:5]))
                return (not problems, '; '.join(problems),
                        f"first li.finding {ms:.0f} ms after opening ?demo=dulles with no input (20 s = human target, S7); "
                        f"route {first}, {len(want)} findings = report.js, {len(want)} pins, focus not moved; "
                        f"&lang=es same rows; ?demo=elsewhere picks nothing")

            run('B4 ?demo=dulles 390px', browser, {'viewport': {'width': 390, 'height': 844}}, b4_demo)

            # Wave 187 (Fri Oct 16, 2026): a11y + robustness pass. Four checks, each with a planted break that fails it.
            # A-motion: prefers-reduced-motion: reduce -> no zoom animation, no tile/pin fade, no animated pan (arrow
            # keys) and no inertia after a drag (js/map.js motionOptions + panBy forced to animate: false). The same
            # probe runs with no preference first and must SEE the animations, so the check cannot pass by measuring
            # nothing. Leaflet marks an animated pan with .leaflet-pan-anim and an animated zoom with .leaflet-zoom-anim
            # on the map pane; a MutationObserver (attributeOldValue) records every class those ever had.
            MOTION_PROBE = """() => { window.__anim = []; const m = document.getElementById('map');
              const add = (s) => { for (const c of String(s || '').split(/\\s+/)) if (/^leaflet-(pan|zoom)-anim$/.test(c) && !window.__anim.includes(c)) window.__anim.push(c); };
              new MutationObserver((ms) => ms.forEach((x) => { add(x.oldValue); add(x.target.getAttribute('class')); }))
                .observe(m, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
              return { fade: m.classList.contains('leaflet-fade-anim'), zoomProxy: m.querySelectorAll('.leaflet-proxy').length }; }"""
            PANE = "() => document.querySelector('#map .leaflet-map-pane').style.transform"
            # zoom level = the z of the tile images Leaflet asked for (tiles are stubbed, the src keeps /z/x/y.png);
            # .leaflet-proxy exists only when Leaflet sets up animated zoom (zoomAnimation on)
            TILEZ = "() => Math.max(...[...document.querySelectorAll('#map img.leaflet-tile')].map(i => +i.src.split('/').slice(-3)[0]))"

            def motion_probe(page):
                page.goto(url + '?demo=dulles')
                ready(page)
                page.wait_for_selector('#map[data-map="ready"]', timeout=10_000)
                page.wait_for_function("document.querySelectorAll('#map path.leaflet-interactive').length > 1", timeout=5000)
                page.wait_for_timeout(400)
                o = page.evaluate(MOTION_PROBE)
                t0 = page.evaluate(PANE)
                page.focus('#map')
                page.keyboard.press('ArrowRight')
                page.wait_for_timeout(500)
                o['keyMoved'] = page.evaluate(PANE) != t0
                z0 = page.evaluate(TILEZ)
                page.click('#map .leaflet-control-zoom-in')
                page.wait_for_timeout(600)
                o['zoom'] = [z0, page.evaluate(TILEZ)]
                box = page.locator('#map').bounding_box()
                cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
                page.mouse.move(cx, cy)
                page.mouse.down()
                for i in range(1, 6):
                    page.mouse.move(cx - 30 * i, cy, steps=1)
                page.mouse.up()
                d1 = page.evaluate(PANE)
                page.wait_for_timeout(600)
                o['glideAfterDrag'] = page.evaluate(PANE) != d1
                o['anim'] = page.evaluate('() => window.__anim')
                return o

            def a_motion(context):
                problems = []
                ctl_ctx = browser.new_context(viewport={'width': 390, 'height': 844}, reduced_motion='no-preference')
                try:
                    install_net(ctl_ctx)
                    ctl = motion_probe(ctl_ctx.new_page())
                finally:
                    ctl_ctx.close()
                if not ({'leaflet-pan-anim', 'leaflet-zoom-anim'} <= set(ctl['anim']) and ctl['fade'] and ctl['zoomProxy']):
                    problems.append(f"control (no preference) shows no animation, so the probe proves nothing: {ctl}")
                page = context.new_page()
                w = Watch(page, origin)
                red = motion_probe(page)
                if red['anim']:
                    problems.append(f"reduced motion: Leaflet still animated: {red['anim']}")
                if red['fade'] or red['zoomProxy']:
                    problems.append(f"reduced motion: fade/zoom animation still set up (fade {red['fade']}, zoom proxy {red['zoomProxy']})")
                if not red['keyMoved']:
                    problems.append('reduced motion: ArrowRight did not move the map')
                if red['zoom'][1] != red['zoom'][0] + 1:
                    problems.append(f"reduced motion: zoom-in went from tile zoom {red['zoom'][0]} to {red['zoom'][1]}, want +1")
                if red['glideAfterDrag']:
                    problems.append('reduced motion: the map kept gliding after the drag (inertia)')
                if w.errors:
                    problems.append(f'{len(w.errors)} console/page/request errors: ' + ' | '.join(w.errors[:5]))
                return (not problems, '; '.join(problems),
                        f"reduce: no pan/zoom animation class, no fade, arrow key + zoom ({red['zoom'][0]}→{red['zoom'][1]}) still work, no glide after a drag; "
                        f"control (no preference) saw {sorted(ctl['anim'])}, fade {ctl['fade']}, glide {ctl['glideAfterDrag']}")

            run('A-motion reduced motion 390px', browser, {'viewport': {'width': 390, 'height': 844}, 'reduced_motion': 'reduce'}, a_motion)

            # A-nojs: JavaScript off -> p#nojs says the page needs JavaScript and the controls that cannot work are hidden.
            NOJS_HIDE = ['#lang', '#load-status', '.pickers', '#letter-open', '#map', '#map-hint', '#results', '#source-status']

            def a_nojs(context):
                problems, seen = [], []
                for width in (320, 390):
                    page = context.new_page()
                    page.set_viewport_size({'width': width, 'height': 800})
                    page.goto(url)
                    if not page.locator('#nojs').is_visible():
                        problems.append(f'{width}px: p#nojs not visible')
                    else:
                        seen.append((page.text_content('#nojs') or '').strip())
                    shown = [s for s in NOJS_HIDE if page.locator(s).first.is_visible()]
                    if shown:
                        problems.append(f'{width}px: controls that need JavaScript still shown: {shown}')
                    sw = page.evaluate('document.documentElement.scrollWidth')
                    if sw > width:
                        problems.append(f'{width}px: horizontal overflow {sw}')
                    page.close()
                if seen and not seen[0].startswith('CrossSafe needs JavaScript'):
                    problems.append(f'message {seen[0]!r}')
                return (not problems, '; '.join(problems),
                        f"320 + 390 px: {seen[0][:60] if seen else ''}… shown; {len(NOJS_HIDE)} script-only parts hidden; no sideways scroll")

            run('A-nojs no JavaScript 320/390px', browser, {'viewport': {'width': 390, 'height': 800}, 'java_script_enabled': False}, a_nojs)

            # A-slow: the 1.5 MB snapshot is held back 1.5 s -> a visible status line says it is loading, #results is
            # aria-busy, the pickers stay disabled; when it arrives the status line goes and the page works.
            def a_slow(context):
                problems, held = [], []
                context.route('**/data/osm-dulles.json', lambda r: held.append(r))
                page = context.new_page()
                w = Watch(page, origin)
                page.goto(url, wait_until='domcontentloaded')
                for _ in range(100):
                    if held:
                        break
                    page.wait_for_timeout(50)
                if not held:
                    return False, 'snapshot request never made', ''
                page.wait_for_timeout(1500)
                st = page.evaluate("""() => { const s = document.getElementById('load-status'); const r = s.getBoundingClientRect();
                  return { state: document.getElementById('app').getAttribute('data-state'), text: s.textContent.trim(), role: s.getAttribute('role'),
                    shown: !s.hidden && r.height > 0 && getComputedStyle(s).visibility === 'visible', busy: document.getElementById('results').getAttribute('aria-busy'),
                    route: document.getElementById('route').disabled, letter: document.getElementById('letter-open').disabled }; }""")
                if not (st['state'] == 'loading' and st['shown'] and st['role'] == 'status' and st['text'].startswith('Loading')):
                    problems.append(f'while loading: {st}')
                if st['busy'] != 'true' or not st['route'] or not st['letter']:
                    problems.append(f"while loading: aria-busy {st['busy']}, route disabled {st['route']}, letter disabled {st['letter']}")
                held[0].continue_()
                ready(page)
                after = page.evaluate("() => [document.getElementById('load-status').hidden, document.getElementById('results').hasAttribute('aria-busy')]")
                if after != [True, False]:
                    problems.append(f'after load: status hidden / aria-busy = {after}')
                first = page.eval_on_selector('#route', "s => [...s.options].map(o => o.value).find(v => v !== '')")
                page.select_option('#route', first)
                page.wait_for_function("document.querySelectorAll('#findings > li.finding').length > 0", timeout=5000)
                n = page.locator('#findings > li.finding').count()
                if n != report_json(first)['findings']:
                    problems.append(f'{n} findings after the slow load vs report.js')
                if w.errors:
                    problems.append(f'{len(w.errors)} console/page/request errors: ' + ' | '.join(w.errors[:5]))
                return (not problems, '; '.join(problems),
                        f"snapshot held 1.5 s: '{st['text']}' shown (role=status), #results aria-busy, pickers disabled; then cleared, {n} findings")

            run('A-slow loading state 390px', browser, {'viewport': {'width': 390, 'height': 844}}, a_slow)

            # E1 (offline-error-test-spec): the snapshot 404s once -> a visible message naming the file, no blank map box,
            # a retry button (>= 44 px, keyboard); Enter on it reloads, the second try loads, findings work.
            def e1_retry(context):
                problems, hits = [], []

                def h(r):
                    hits.append(r.request.url)
                    if len(hits) == 1:
                        return r.fulfill(status=404, content_type='text/plain', body='not found')
                    return r.continue_()
                context.route('**/data/osm-dulles.json', h)
                page = context.new_page()
                page.goto(url)
                page.wait_for_selector('main#app[data-state="error"]', timeout=10_000)
                st = page.evaluate("""() => { const b = document.getElementById('load-retry').getBoundingClientRect(); const e = document.getElementById('load-error');
                  return { msg: e.hidden ? null : e.textContent, role: e.getAttribute('role'), retry: !document.getElementById('load-retry').hidden, size: [b.width, b.height],
                    map: document.getElementById('map').getBoundingClientRect().height, status: document.getElementById('load-status').hidden,
                    busy: document.getElementById('results').hasAttribute('aria-busy'), route: document.getElementById('route').disabled }; }""")
                if not st['msg'] or 'data/osm-dulles.json' not in st['msg'] or '404' not in st['msg'] or st['role'] != 'alert':
                    problems.append(f"message {st['msg']!r} (role {st['role']}) does not name data/osm-dulles.json + 404")
                if not st['retry'] or st['size'][0] < 44 or st['size'][1] < 44:
                    problems.append(f"retry button shown {st['retry']} size {st['size']}")
                if st['map'] > 0:
                    problems.append(f"blank map box still shown ({st['map']:.0f} px tall)")
                if not st['status'] or st['busy'] or not st['route']:
                    problems.append(f"loading state left on (status hidden {st['status']}, aria-busy {st['busy']}) or route enabled {not st['route']}")
                bad, _ = axe_bad(page)
                if bad:
                    problems.append(f'axe on the error state: {bad}')
                if not st['retry'] or st['size'][0] < 44 or st['size'][1] < 44:
                    return False, '; '.join(problems), ''  # no usable retry button: name it instead of timing out on it
                page.focus('#load-retry')
                with page.expect_navigation(timeout=10_000):
                    page.keyboard.press('Enter')
                ready(page)
                first = page.eval_on_selector('#route', "s => [...s.options].map(o => o.value).find(v => v !== '')")
                page.select_option('#route', first)
                page.wait_for_function("document.querySelectorAll('#findings > li.finding').length > 0", timeout=5000)
                n = page.locator('#findings > li.finding').count()
                vis = page.evaluate("() => [document.getElementById('load-error').hidden, document.getElementById('load-retry').hidden]")
                if n != report_json(first)['findings'] or vis != [True, True] or len(hits) != 2:
                    problems.append(f'after retry: {n} findings, error/retry hidden {vis}, snapshot requests {len(hits)}')
                return (not problems, '; '.join(problems),
                        f"404 -> '{st['msg']}' (role=alert), no map box, Try again {st['size'][0]:.0f}x{st['size'][1]:.0f}, axe 0 serious/critical; "
                        f"Enter -> reload -> {n} findings = report.js")

            run('E1 404 retry 390px', browser, {'viewport': {'width': 390, 'height': 844}}, e1_retry)
            browser.close()
    finally:
        server.terminate()
        shutil.rmtree(site, ignore_errors=True)

    print(f'{len(passed)} passed, {len(failed)} failed, {len(skipped)} skipped')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
