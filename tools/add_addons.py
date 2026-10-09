#!/usr/bin/env python3
"""Build the add-on features into the CRM page.

    python3 tools/add_addons.py index.html

Adds the Map view (tools/addons/map.js, with Leaflet bundled from
tools/addons/vendor/) and Vendor Reports (tools/addons/vendor_report.js) just
before </body>, between ADDONS markers, so running it again replaces them
rather than adding a second copy. It also lets the page reach the map's
address finder in its Content-Security-Policy (map tiles are images, which the
policy already allows).

make_blank_crm.py runs this at the end, so a regenerated blank CRM keeps them.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ADDONS = os.path.join(HERE, 'addons')
BEGIN, END = '<!-- ADDONS:BEGIN -->', '<!-- ADDONS:END -->'
GEOCODER = 'https://nominatim.openstreetmap.org'


def read(*p):
    with open(os.path.join(ADDONS, *p), encoding='utf-8') as f:
        return f.read()


def block():
    scripts = [
        read('vendor', 'leaflet.js'),
        # keep any page variable called L untouched; the map uses CRM_LEAFLET
        'window.CRM_LEAFLET = L.noConflict();',
        read('map.js'),
        read('vendor_report.js'),
    ]
    for s in scripts:
        if '</script' in s.lower():
            raise SystemExit('add_addons: a script contains </script>')
    return (BEGIN + '\n<style>\n' + read('vendor', 'leaflet.css') + '\n</style>\n'
            + ''.join('<script>\n' + s + '\n</script>\n' for s in scripts) + END + '\n')


def add_addons(html):
    html = re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END) + r'\n?', '', html, flags=re.S)
    i = html.rfind('</body>')
    if i < 0:
        raise SystemExit('add_addons: </body> not found')
    html = html[:i] + block() + html[i:]
    # the address finder must be reachable from the page
    m = re.search(r'(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")', html)
    if m and GEOCODER not in m.group(2):
        csp = m.group(2)
        if re.search(r'(^|;)\s*connect-src', csp):
            csp = re.sub(r'((?:^|;)\s*connect-src)', r'\1 ' + GEOCODER, csp, count=1)
        else:
            csp = re.sub(r'((?:^|;)\s*default-src)', r'\1 ' + GEOCODER, csp, count=1)
        html = html[:m.start(2)] + csp + html[m.end(2):]
    return html


def main(path):
    with open(path, encoding='utf-8') as f:
        html = f.read()
    html = add_addons(html)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('added map and vendor reports to %s (%d KB)' % (path, len(html.encode('utf-8')) // 1024))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: add_addons.py CRM.html')
    main(sys.argv[1])
