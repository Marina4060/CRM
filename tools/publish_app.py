#!/usr/bin/env python3
"""Roll out a new version of the CRM to every user.

    SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \\
      python3 tools/publish_app.py index.html "Faster call list, new SMS templates"

Uploads the CRM to the private "app" bucket (only people with access can
download it) and adds the notes to the "What's new" list people see in Help.
Users get the new version the next time they open or reload the app.
Keep the service role key secret: never put it in the website or in git.
"""
import datetime
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request

BUCKET = 'app'


def call(method, path, body=None, ctype='application/json', extra=None):
    url = os.environ['SUPABASE_URL'].rstrip('/') + path
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    headers = {'Authorization': 'Bearer ' + key, 'apikey': key}
    if body is not None:
        headers['Content-Type'] = ctype
    headers.update(extra or {})
    r = urllib.request.Request(url, data=body, method=method, headers=headers)
    with urllib.request.urlopen(r) as resp:
        return resp.read()


def upload(name, data, ctype):
    call('POST', '/storage/v1/object/%s/%s' % (BUCKET, name), data, ctype,
         {'x-upsert': 'true', 'cache-control': 'no-cache'})


def main():
    if len(sys.argv) != 3:
        raise SystemExit('usage: publish_app.py CRM.html "what changed"')
    for v in ('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'):
        if not os.environ.get(v):
            raise SystemExit('set %s first' % v)
    path, notes = sys.argv[1], sys.argv[2].strip()
    html = open(path, 'rb').read()
    if b'Marina' in html and b'window.ME' not in html:
        raise SystemExit('%s looks like a personal CRM, not the blank app' % path)

    try:
        info = json.loads(call('GET', '/storage/v1/object/%s/version.json' % BUCKET))
    except urllib.error.HTTPError:
        info = {}
    today = datetime.date.today().isoformat()
    version = today + '-' + hashlib.sha1(html).hexdigest()[:7]
    if info.get('version') == version:
        print('That exact file is already live (%s).' % version)
        return
    entry = {'version': version, 'date': today, 'notes': notes}
    history = [entry] + [h for h in info.get('history', []) if h.get('version') != version][:29]

    upload('crm.html', html, 'text/html; charset=utf-8')
    upload('version.json', json.dumps(dict(entry, history=history), indent=1).encode(), 'application/json')
    print('Published %s (%d KB). Users get it next time they open the app.' % (version, len(html) // 1024))


if __name__ == '__main__':
    main()
