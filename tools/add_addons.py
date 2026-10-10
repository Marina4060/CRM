#!/usr/bin/env python3
"""Build the add-on features into the CRM page.

    python3 tools/add_addons.py index.html

Adds the add-on features from tools/addons/ just before </body>, between
ADDONS markers, so running it again replaces them rather than adding a second
copy: the Map view (map.js, with Leaflet bundled from vendor/), Vendor Reports
(vendor_report.js), Buyers (buyers.js), the Call Runner's missing-details
tools (callrunner.js), receipts on expenses (receipts.js), the professional colours (theme.css, theme.js) and the
iPhone fit fixes (iphone.css). It also repairs a few markup mistakes in the
CRM itself (see FIXES), and lets the page reach the map's address finder in
its Content-Security-Policy (map tiles are images, which the policy already
allows).

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
        read('theme.js'),
        read('map.js'),
        read('vendor_report.js'),
        read('buyers.js'),
        read('callrunner.js'),
        read('receipts.js'),
        read('fixes.js'),
    ]
    for s in scripts:
        if '</script' in s.lower():
            raise SystemExit('add_addons: a script contains </script>')
    return (BEGIN + '\n<style>\n' + read('vendor', 'leaflet.css') + '\n' + read('theme.css') + '\n' + read('iphone.css') + '\n</style>\n'
            + ''.join('<script>\n' + s + '\n</script>\n' for s in scripts) + END + '\n')


# Markup fixes for the CRM itself. Each applies only if the problem is still
# there, so a later copy of the CRM that has it fixed builds cleanly.
FIXES = [
    # The expenses table was wrapped in an unclosed <div id="buyers-table-wrap">,
    # which put the Buyers window inside the (hidden) Expenses window: the
    # Buyers button showed nothing. That opening tag belongs around the buyers
    # table (which already has its closing tag), which "Group by property"
    # hides and shows.
    ('<div id="buyers-table-wrap"><table class="exp-table">', '<table class="exp-table">'),
    ('<div style="overflow-x:auto"><table class="feat-table"><thead><tr><th>Name</th><th>Phone</th>',
     '<div id="buyers-table-wrap"><div style="overflow-x:auto"><table class="feat-table"><thead><tr><th>Name</th><th>Phone</th>'),
    # the summary tiles counted every stage except Listed and Sold, which always showed 0
    ('var cnt = {hot:0,warm:0,potential:0,appraisal:0,msg:0,cold:0,declined:0};',
     'var cnt = {hot:0,warm:0,potential:0,appraisal:0,msg:0,cold:0,declined:0,listed:0,sold:0};'),
    # leftovers of the original agency in the AI assistant: sign off as the agent
    ("Sign off as M&I team.';", "Sign off as '+ME.name+', '+ME.agency+'.';"),
    ('M&amp;I AI assistant', 'MICRM AI assistant'),
]


def fix_markup(html):
    for old, new in FIXES:
        if html.count(old) == 1 and (new in old or new not in html):   # once only
            html = html.replace(old, new)
    return html


def add_addons(html):
    html = re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END) + r'\n?', '', html, flags=re.S)
    html = fix_markup(html)
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
    # receipts are shown from the browser's own file storage (blob: addresses)
    m = re.search(r'(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")', html)
    if m and re.search(r'img-src(?![^;]*blob:)', m.group(2)):
        csp = re.sub(r'(img-src)', r'\1 blob:', m.group(2), count=1)
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
