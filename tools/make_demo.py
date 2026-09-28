#!/usr/bin/env python3
"""Build a clickable demo of the online CRM that runs entirely in the browser.

    python3 tools/make_demo.py            # writes demo/build/

The demo uses demo/demo-backend.js in place of Supabase and Stripe (sample
agency, simulated payments, data kept in the browser). The page itself is
demo/build/page.html; the other files in demo/build/ sit next to it.
"""
import json
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
DEMO = os.path.join(ROOT, 'demo')
OUT = os.path.join(DEMO, 'build')


def read(*p):
    with open(os.path.join(*p), encoding='utf-8') as f:
        return f.read()


def main():
    os.makedirs(os.path.join(OUT, 'icons'), exist_ok=True)
    html = read(WEB, 'index.html')
    body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
    body = re.sub(r'<script[^>]*></script>\s*', '', body)          # scripts are inlined below
    scripts = [read(WEB, 'config.js'), read(DEMO, 'demo-backend.js'), read(WEB, 'app.js'), read(DEMO, 'demo-ui.js')]
    for s in scripts:
        assert '</script' not in s.lower(), 'a script contains </script>'
    page = ('<title>Real Estate CRM Online</title>\n'
            '<meta name="theme-color" content="#185FA5">\n'
            '<link rel="icon" href="icons/icon-192.png" type="image/png">\n'
            '<style>\n' + read(WEB, 'styles.css') + '\n' + read(DEMO, 'demo.css') + '\n</style>\n'
            + body.strip() + '\n'
            + ''.join('<script>\n' + s + '\n</script>\n' for s in scripts))
    with open(os.path.join(OUT, 'page.html'), 'w', encoding='utf-8') as f:
        f.write(page)
    shutil.copy(os.path.join(ROOT, 'index.html'), os.path.join(OUT, 'crm.html'))
    for n in ('terms.html', 'privacy.html', 'styles.css', 'config.js', 'legal.js'):
        shutil.copy(os.path.join(WEB, n), os.path.join(OUT, n))
    for n in os.listdir(os.path.join(WEB, 'icons')):
        shutil.copy(os.path.join(WEB, 'icons', n), os.path.join(OUT, 'icons', n))
    notes = {'version': 'demo', 'date': 'Demo', 'notes': 'Preview of the online version: teams, agency plans with a shared contact list, billing and help.'}
    with open(os.path.join(OUT, 'version.json'), 'w') as f:
        json.dump(dict(notes, history=[notes]), f)
    print('demo written to', OUT, '(%d KB page)' % (len(page) // 1024))


if __name__ == '__main__':
    main()
