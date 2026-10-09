#!/usr/bin/env python3
"""Turn a personal copy of the CRM into a blank app that anyone can use.

    python3 tools/make_blank_crm.py MARINA_CRM_xxx.html index.html

What it does:
  * empties every contact, buyer, diary, appointment, expense, income,
    logbook, investor, listing and sale record baked into the file
  * clears the screen snapshot that the "save" feature stores in the page
  * swaps the agent's own details (name, agency, phone, email, logo) for a
    "My details" profile each user fills in on first open
  * renames the browser storage keys so the blank app can never pick up
    data saved by the original CRM in the same browser
  * builds in the add-on features (Map view, Vendor Reports) from
    tools/addons/ – see add_addons.py

It fails loudly if something it expects is missing, so it can be re-run on
later versions of the CRM and tell you what moved.
"""
import base64
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jslex  # noqa: E402
from add_addons import add_addons  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WARN = []


def warn(msg):
    WARN.append(msg)


def must(cond, msg):
    if not cond:
        raise SystemExit('make_blank_crm: ' + msg)


# ─────────────────────────── 1. data arrays ───────────────────────────

ARRAYS = [
    # (regex for the opening line, closing-line regex)
    (r'const rawData=\[\s*$', r'^\s*\];?\s*$'),
    (r'var SEED_INVESTORS=\[\s*$', r'^\s*\];?\s*$'),
    (r'var diaryTasks = \[\s*$', r'^\s*\];?\s*$'),
    (r'var appointments=\[\s*$', r'^\s*\];?\s*$'),
    (r'var income = \[\s*$', r'^\s*\];?\s*$'),
    (r'var buyers=\[\s*$', r'^\s*\];?\s*$'),
    (r'var LISTINGS=\[\s*$', r'^\s*\];*\s*$'),
    (r'var SOLD=\[\s*$', r'^\s*\];?\s*$'),
    (r'^\s*logbook = \[\s*$', r'^\s*\];?\s*$'),
    (r'var expenses = _savedExp \|\| \[\s*$', r'^\s*\];?\s*$'),
    (r'const CO=\{\s*$', r'^\s*\};?\s*$'),
]


def empty_arrays(lines):
    for start_re, end_re in ARRAYS:
        idx = [i for i, l in enumerate(lines) if re.search(start_re, l)]
        must(len(idx) == 1, 'expected one match for %r, found %d' % (start_re, len(idx)))
        s = idx[0]
        e = s + 1
        while not re.search(end_re, lines[e]):
            e += 1
        del lines[s + 1:e]
    # street lists that sort contacts into suburbs: one line each
    n = 0
    for i, l in enumerate(lines):
        m = re.match(r'^(var [A-Z_]+_STREETS=)\[.*\];\s*$', l)
        if m:
            lines[i] = m.group(1) + '[];'
            n += 1
    must(n >= 5, 'street lists not found')
    return lines


# ─────────────────────────── 2. page snapshot ───────────────────────────

def iter_scripts(html):
    """Yield (tag_start, body_start, body_end, attrs) for each real <script>
    (a '<script' written inside a script's own strings is not a new one)."""
    pos = 0
    tag = re.compile(r'<script\b([^>]*)>')
    while True:
        m = tag.search(html, pos)
        if not m:
            return
        e = html.find('</script>', m.end())
        must(e > 0, 'unclosed <script>')
        yield m.start(), m.end(), e, m.group(1)
        pos = e + 9


def script_ranges(html):
    return [(a, e + 9) for a, _, e, _ in iter_scripts(html)]


def in_ranges(pos, ranges):
    return any(a <= pos < b for a, b in ranges)


def find_element(html, el_id):
    """Return (start_of_inner, end_of_inner, open_tag_start) for the element
    with this id in the static HTML (ignores ids inside <script>)."""
    ranges = script_ranges(html)
    for m in re.finditer(r'<([a-zA-Z0-9]+)\b[^>]*\bid="%s"[^>]*>' % re.escape(el_id), html):
        if in_ranges(m.start(), ranges):
            continue
        tag = m.group(1).lower()
        if tag in ('input', 'img', 'br', 'hr', 'meta', 'link'):
            return (m.end(), m.end(), m.start())
        depth = 1
        pos = m.end()
        tok = re.compile(r'<(/?)%s\b[^>]*?(/?)>' % tag, re.I)
        while depth:
            t = tok.search(html, pos)
            must(t, 'unbalanced <%s id=%s>' % (tag, el_id))
            if t.group(1):
                depth -= 1
            elif not t.group(2):
                depth += 1
            pos = t.end()
            if depth == 0:
                return (m.end(), t.start(), m.start())
    return None


def empty_element(html, el_id, keep='', required=True):
    r = find_element(html, el_id)
    if not r:
        must(not required, 'element #%s not found' % el_id)
        return html
    return html[:r[0]] + keep + html[r[1]:]


def remove_element(html, el_id):
    r = find_element(html, el_id)
    must(r, 'element #%s not found' % el_id)
    close = html.find('>', r[1]) + 1 if r[0] != r[1] or html[r[1]:r[1] + 2] == '</' else r[1]
    return html[:r[2]] + html[close:]


def set_attr(html, el_id, attr, value):
    r = find_element(html, el_id)
    must(r, 'element #%s not found' % el_id)
    tag = html[r[2]:r[0]]
    if re.search(r'\b%s="[^"]*"' % attr, tag):
        tag2 = re.sub(r'\b%s="[^"]*"' % attr, '%s="%s"' % (attr, value), tag, count=1)
    else:
        tag2 = tag[:-1] + ' %s="%s">' % (attr, value)
    return html[:r[2]] + tag2 + html[r[0]:]


def clear_snapshot(html):
    # everything the "save" feature stored: activity, diary, buyers, money...
    html, n = re.subn(r'<script id="baked-state">.*?</script>',
                      '<script id="baked-state">try{window.__BAKED_ACT={};}catch(e){}</script>',
                      html, count=1, flags=re.S)
    must(n == 1, 'baked-state not found')

    for el in ('board', 'summary', 'street-summary', 'appt-rem-banner', 'm-body',
               'm-nm', 'm-ad', 'm-av', 'm-foot', 'tbl-head', 'tbl-body'):
        html = empty_element(html, el, required=el not in ('appt-rem-banner',))
    html = set_attr(html, 'street-summary', 'style', 'display:none')
    html = set_attr(html, 'appt-rem-banner', 'style', 'display:none')

    # suburb tabs: keep only "All" – the app rebuilds the rest from the contacts
    ranges = script_ranges(html)
    ids = [m.group(1) for m in re.finditer(r'<button class="vtab[^"]*" id="(sub-[a-z]+)"', html)
           if not in_ranges(m.start(), ranges)]
    must('sub-all' in ids and 'sub-brb' in ids, 'suburb tabs not found')
    for i in ids:
        if i != 'sub-all':
            html = remove_element(html, i)
    html = re.sub(r'(<button class="vtab)( on)?(" id="sub-all")', r'\1 on\3', html, count=1)

    # street pills: keep one empty holder (brb-pills) as the template for new suburbs
    ranges = script_ranges(html)
    pills = [m.group(1) for m in re.finditer(r'<div id="([a-z]+-pills)"', html)
             if not in_ranges(m.start(), ranges)]
    must('brb-pills' in pills, 'street pill holders not found')
    for p in pills:
        if p == 'brb-pills':
            html = empty_element(html, p)
            html = set_attr(html, p, 'style', 'display:none')
        else:
            html = remove_element(html, p)
    html = empty_element(html, 'cr-street-filter', keep='<option value="all">All Streets</option>',
                         required=False)
    # suburb drop-downs listed the old patch; they fill from the user's contacts at runtime
    for sel in ('cr-suburb-filter', 'camp-suburb', 'be-suburb'):
        html = empty_element(html, sel, keep='<option value="all">All Suburbs</option>', required=False)
    for sel in ('ac-suburb', 'ac-bulk-suburb'):
        html = empty_element(html, sel, keep='<option value="">Choose suburb…</option>', required=False)

    # banners, badges and pop-ups the CRM had added to the page when it was saved
    # (pipeline projection, "238 stale leads", "3-month look (81)", backup and
    # bookkeeping reminders). The CRM adds them again itself when there is data.
    for el in ('auto-banner', 'review-btn', 'book-chip'):
        if find_element(html, el):
            html = remove_element(html, el)
    while True:
        ranges = script_ranges(html)
        m = next((m for m in re.finditer(r'<(div|button)\b[^>]*style="position: fixed[^"]*"[^>]*>', html)
                  if not in_ranges(m.start(), ranges)), None)
        if not m:
            break
        html = _remove_at(html, m.start(), m.group(1))
    return html


def _remove_at(html, start, tag):
    """Remove the element whose opening tag starts at `start`."""
    depth, pos = 0, start
    tok = re.compile(r'<(/?)%s\b[^>]*?(/?)>' % tag, re.I)
    while True:
        t = tok.search(html, pos)
        must(t, 'unbalanced <%s> at %d' % (tag, start))
        if t.group(1):
            depth -= 1
        elif not t.group(2):
            depth += 1
        pos = t.end()
        if depth == 0:
            return html[:start] + html[pos:]


# ─────────────────────────── 3. the agent's identity ───────────────────────────

# (text, JS expression, HTML token) – longest first
IDENTITY = [
    ('marina.dacheva@<wbr>monarchrealestate.com.au', 'ME.email', '[[email]]'),
    ('marina.dacheva@monarchrealestate.com.au', 'ME.email', '[[email]]'),
    ('https://www.monarchrealestate.com.au', 'ME.websiteUrl', '[[websiteUrl]]'),
    ('www.monarchrealestate.com.au', 'ME.website', '[[website]]'),
    ('monarchrealestate.com.au', 'ME.website', '[[website]]'),
    ('Monarch Real Estate, 854 Beaufort Street, Inglewood WA 6052', 'ME.agencyLine', '[[agencyLine]]'),
    ('854 Beaufort Street, Inglewood WA 6052', 'ME.office', '[[office]]'),
    ('MARINA DACHEVA', 'ME.NAME', '[[NAME]]'),
    ('SALES CONSULTANT', 'ME.TITLE', '[[TITLE]]'),
    ('Marina Dacheva', 'ME.name', '[[name]]'),
    ('Real Estate Consultant', 'ME.title', '[[title]]'),
    ('Sales Consultant', 'ME.title', '[[title]]'),
    ('MONARCH REAL ESTATE', 'ME.AGENCY', '[[AGENCY]]'),
    ('Monarch Real Estate', 'ME.agency', '[[agency]]'),
    ('Monarch', 'ME.agency', '[[agency]]'),
    ('0492 296 324', 'ME.phone', '[[phone]]'),
    ('0492296324', 'ME.phoneRaw', '[[phoneRaw]]'),
    ('Marina', 'ME.first', '[[first]]'),
]
COMMENT_WORDS = [('Marina Dacheva', 'the agent'), ('Marina', 'the agent'),
                 ('Monarch Real Estate', 'the agency'), ('Monarch', 'the agency'),
                 ('0492 296 324', 'the agent\'s mobile')]

WB_L = r'(?:(?<=\\[nt])|(?<![A-Za-z0-9_]))'
WB_R = r'(?![A-Za-z0-9_])'
_ID_RE = re.compile('|'.join(
    (WB_L + re.escape(t) + WB_R) if t[0].isalnum() and t[-1].isalnum() else re.escape(t)
    for t, _, _ in IDENTITY))
_ID_MAP = {t: (js, tok) for t, js, tok in IDENTITY}


def _js_sub(text, quote):
    def rep(m):
        js = _ID_MAP[m.group(0)][0]
        if quote == '`':
            return '${' + js + '}'
        return quote + '+' + js + '+' + quote
    return _ID_RE.sub(rep, text)


def _comment_sub(text):
    for a, b in COMMENT_WORDS:
        text = re.sub(WB_L + re.escape(a) + WB_R, b, text)
    return text


def rewrite_js(src):
    """Rewrite identity text inside one script's source."""
    edits = []
    for kind, a, b, q in jslex.spans(src):
        chunk = src[a:b]
        if not _ID_RE.search(chunk) and not (kind in ('line', 'block') and 'Marina' in chunk):
            continue
        if kind in ('str', 'tpl'):
            edits.append((a, b, _js_sub(chunk, q)))
        elif kind in ('line', 'block'):
            edits.append((a, b, _comment_sub(chunk)))
        else:
            warn('identity text inside a regex left alone: ' + chunk[:80])
    for a, b, new in reversed(edits):
        src = src[:a] + new + src[b:]
    return src


def rewrite_identity(html):
    out = []
    pos = 0
    for _, b, e, attrs in iter_scripts(html):
        out.append(_html_sub(html[pos:b]))
        body = html[b:e]
        if 'text/plain' in attrs:
            out.append(body)
        else:
            out.append(rewrite_js(body))
        pos = e
    out.append(_html_sub(html[pos:]))
    return ''.join(out)


def _html_sub(text):
    return _ID_RE.sub(lambda m: _ID_MAP[m.group(0)][1], text)


# ─────────────────────────── 4. embedded call list ───────────────────────────

def rewrite_call_list(html):
    m = re.search(r'(<script id="dcl-src" type="text/plain">)([A-Za-z0-9+/=\s]+)(</script>)', html)
    must(m, 'embedded call list not found')
    src = base64.b64decode(m.group(2)).decode('utf-8')

    # the call list reads the CRM's "My details" profile instead of Marina's card
    old = re.search(r"const MARINA = \{[^\n]*\};", src)
    must(old, 'call list profile constant not found')
    src = src.replace(old.group(0),
        "const MARINA = (function(){ var P={}; try{ P=(window.parent&&window.parent.ME)||{}; }catch(e){}"
        " return { id:'marina', name:P.rawName||'', title:P.rawTitle||'', agency:P.rawAgency||'',"
        " phone:P.rawPhone||'', email:P.rawEmail||'' }; })();")
    # one profile – yours – instead of a "Debie" default plus Marina
    src = src.replace("S.meta.profiles = [Object.assign({ id:'debie', name:(old.name || S.meta.owner || 'Debie'),",
                      "S.meta.profiles = [Object.assign({ id:'marina', name:(old.name || S.meta.owner || MARINA.name),")
    src = src.replace(", { id:'debie' })];", ", { id:'marina' }, Object.fromEntries(Object.entries(MARINA).filter(([, v]) => v)))];")
    must("id:'debie'" not in src, 'call list still has the Debie profile')

    for a, b, n in REPLACE:
        if n == 0:
            src = src.replace(a, b)
    # the call list was set up for one agent's patch (Duncraig): start from the user's own suburbs instead
    for a, b in [
        ("const NEAR_DUNCRAIG = ['Carine','Greenwood','Hamersley','Hillarys','Kingsley','Marmion','Padbury','Sorrento','Warwick'];",
         "// suburbs from the CRM's own contacts, suggested for the list\n"
         "const crmSuburbs = () => [...new Set((S.contacts || []).map(c => titleCase(c.suburb)).filter(Boolean))].sort();"),
        ("const mySubs = () => S.meta.suburbs || (S.meta.suburbs = ['Duncraig']);",
         "const mySubs = () => S.meta.suburbs || (S.meta.suburbs = crmSuburbs());"),
        ("const left = NEAR_DUNCRAIG.filter(", "const left = crmSuburbs().filter("),
        ('<p class="hint" style="margin:14px 0 0">Near Duncraig, tap to add:</p>',
         '<p class="hint" style="margin:14px 0 0">Suburbs in your CRM, tap to add:</p>'),
        ("text:'Duncraig is set up already. Add the other suburbs you work here, and see progress for each one.'",
         "text:'The suburbs you work. Add them here and see progress for each one.'"),
        ("15 Nicholli Street Duncraig WA 6023 Sold $850,000 12 Aug 2026", "15 Example Street Suburb WA 6000 Sold $850,000 12 Aug 2026"),
        ('"a property on your street at 15 Nicholli Street sold in August for $850,000"', '"a property on your street at 15 Example Street sold in August for $850,000"'),
        ("like 15 Nicholli Street Duncraig WA 6023 Sold $850,000.", "like 15 Example Street Suburb WA 6000 Sold $850,000."),
        ("like 1 Abelia Court Duncraig WA 6023.", "like 1 Example Court Suburb WA 6000."),
    ]:
        must(src.count(a) >= 1, 'call list text not found: ' + a[:60])
        src = src.replace(a, b)
    must('Duncraig' not in src, 'call list still mentions Duncraig')
    # templates: the agency comes from the profile placeholder
    src = re.sub(r'\bMonarch Real Estate\b', '{my agency}', src)
    src = re.sub(r'\bMarina Dacheva\b', '{my name}', src)
    src = src.replace("(Marina's templates)", '(my templates)')
    # keep the call list's own save with the CRM's other crm_ keys (so it backs up and syncs)
    must(src.count("'debie-call-list-v1'") == 1, 'call list storage key not found')
    src = src.replace("'debie-call-list-v1'", "'crm_call_list_v1'")
    src = src.replace("(activeProfile().name || 'Debie')", "(activeProfile().name || MARINA.name || 'Me')")
    for a, b in COMMENT_WORDS:
        src = re.sub(r'(//[^\n]*?)\b%s\b' % re.escape(a), lambda mm: mm.group(1) + b, src)
    left = re.findall(r'.{0,60}\b(?:Marina|Monarch|0492|Debie|Debbie)\b.{0,60}', src)
    for l in left:
        warn('call list: ' + l.strip())
    enc = base64.b64encode(src.encode('utf-8')).decode('ascii')
    return html[:m.start(2)] + enc + html[m.end(2):]


# ─────────────────────────── 5. storage keys ───────────────────────────

def rename_keys(html):
    html, n = re.subn(r"(['\"])mi_(?:crm_)?([a-z0-9_]+)", r'\1crm_\2', html)
    must(n > 30, 'storage keys not found')
    return html


# ─────────────────────────── 6. profile + fixes ───────────────────────────

def add_profile(html):
    with open(os.path.join(HERE, 'profile.js'), encoding='utf-8') as f:
        js = f.read()
    # must run before any other script builds a string with ME.*
    html, n = re.subn(r'(<title>)[^<]*(</title>)', r'\1Real Estate CRM\2', html, count=1)
    must(n == 1, 'title not found')
    i = html.find('<style>')
    must(i > 0, 'first <style> not found')
    html = html[:i] + '<script>\n' + js + '\n</script>\n' + html[i:]
    # a "My details" button beside the logo
    html, n = re.subn(r'(<div class="logo">)(.*?)(</div>)',
                      r'\1Real Estate <span>CRM</span>\3<button class="pill" style="width:auto;align-self:flex-start" onclick="openProfile()" '
                      r'title="Your name, agency, phone and email used in messages">👤 My details</button>',
                      html, count=1, flags=re.S)
    must(n == 1, 'logo not found')
    return html


PATCHES = [
    # the app used Brabham as its starting suburb and as the anchor for new suburb tabs
    ("var suburbF = 'Brabham';", "var suburbF = 'all';"),
    ("var tabRow=document.getElementById('sub-brb');", "var tabRow=document.getElementById('sub-all');"),
    ("var PINNED_SUBURBS=['Alexander Heights'];", "var PINNED_SUBURBS=[];"),
    # brand colour and logos come from the profile
    ("var MONARCH_ORANGE='#FE8D03', MONARCH_BROWN='#000000';",
     "var MONARCH_ORANGE=ME.brand, MONARCH_BROWN='#000000';"),
]


def apply_patches(html):
    for a, b in PATCHES:
        must(html.count(a) == 1, 'patch target not found exactly once: ' + a[:70])
        html = html.replace(a, b)
    # logos: the agency's own, or nothing
    for name in ('MONARCH_LOGO', 'MONARCH_CARD_ICON', 'MONARCH_ICON'):
        html, n = re.subn(r"var %s='data:image/[^']*';" % name, 'var %s=ME.logo;' % name, html, count=1)
        must(n == 1, name + ' not found')
    return html


# ─────────────────────────── 7. suburb defaults and examples ───────────────────────────
# (old, new, how many times it must appear; 0 = any number incl. none)
REPLACE = [
    # the app started on Brabham everywhere
    ("var predSuburb = 'Brabham';", "var predSuburb = '';", 1),
    ("var campSuburb='Brabham';", "var campSuburb='';", 1),
    ("var trackerSuburb = 'Brabham';", "var trackerSuburb = 'all';", 1),
    ("  var el=document.getElementById('pred-inner'); if(!el) return;\n  var res=buildPredictive();",
     "  var el=document.getElementById('pred-inner'); if(!el) return;\n"
     "  if(!crmHasSuburb(predSuburb)) predSuburb=crmFirstSuburb();\n  var res=buildPredictive();", 1),
    ("  var rows=campaignStreetStats(campSuburb);",
     "  if(!crmHasSuburb(campSuburb)) campSuburb=crmFirstSuburb();\n  var rows=campaignStreetStats(campSuburb);", 1),
    ("(typeof suburbF!=='undefined'&&suburbF)||'Brabham'", "(typeof suburbF!=='undefined'&&suburbF)||''", 1),
    ("campaignStreetStats(suburbF||'Brabham')", "campaignStreetStats(suburbF||'')", 1),
    ("suburbF!=='all') ? suburbF : 'Brabham';", "suburbF!=='all') ? suburbF : '';", 2),
    ("document.getElementById('ac-suburb').value=suburbF==='Brabham'?'Brabham':'Parkerville';",
     "crmFillSuburbSelects(); if(suburbF && suburbF!=='all' && crmHasSuburb(suburbF)) document.getElementById('ac-suburb').value=suburbF;", 1),
    ("    +'<option value=\"Brabham\">Brabham</option><option value=\"Parkerville\">Parkerville</option>'\n"
     "    +'<option value=\"Midland\">Midland</option><option value=\"Caversham\">Caversham</option>'\n"
     "    +'<option value=\"Woodbridge\">Woodbridge</option><option value=\"Stoneville\">Stoneville</option>'\n"
     "    +'<option value=\"Darlington\">Darlington</option><option value=\"all\">All suburbs</option></select>'",
     "    +crmSuburbOptions(trackerSuburb,true)+'</select>'", 1),
    ("  return 'Parkerville';\n}", "  return 'Other';\n}", 1),
    ("(c.suburb||'Parkerville')", "(c.suburb||getSuburb(c))", 0),
    ("var suburbOrder=['Parkerville','Brabham','Midland','Caversham'];", "var suburbOrder=[];", 1),
    # a suburb must be picked now that the list starts empty
    ("  var suburb=document.getElementById('ac-suburb').value;\n",
     "  var suburb=document.getElementById('ac-suburb').value;\n"
     "  if(!suburb||suburb==='__new'){ alert('Please choose a suburb, or pick \"+ New suburb\" to add one.'); return; }\n", 1),
    ("  var suburb=document.getElementById('ac-bulk-suburb').value;\n",
     "  var suburb=document.getElementById('ac-bulk-suburb').value;\n"
     "  if(!suburb||suburb==='__new'){ alert('Please choose a suburb, or pick \"+ New suburb\" to add one.'); return; }\n", 1),
    # a brand-new user's first contact in a suburb should get its own tab
    ("var MY_SUBURB_MIN=2;", "var MY_SUBURB_MIN=1;", 1),
    # no logo uploaded: leave the logo spots out of emails
    ("    + (_eo.logo ? ('<tr>", "    + (_eo.logo && MONARCH_LOGO ? ('<tr>", 1),
    # file names for backups and exports
    ("var name='MARINA_CRM_BACKUP_'", "var name='CRM_BACKUP_'", 1),
    ("var name='MARINA_CRM_'+", "var name='CRM_'+", 1),
    ("var name='MARINA_CONTACTS_'", "var name='CRM_CONTACTS_'", 1),
    ("// ── MONARCH BRANDED", "// ── BRANDED", 0),
    ("""/* ══ SUBURB GROUPING RULE — confirmed by Marina 08/08/26 ══
   MIDLAND is an umbrella working group, not a strict suburb.
   It intentionally includes: Viveash, Stratton, Swan View, Bellevue
   (and historically Woodbridge, which currently has its own tab).
   Records tagged Midland whose notes name Viveash/Bellevue/etc are
   CORRECT. Do not 'fix' them back out.
   Every record now carries an explicit suburb tag - the fallback
   below is a safety net only, it should never fire in normal use. */""",
     "/* Every record carries an explicit suburb tag; the street lists below are an unused fallback. */", 1),
    ("  // Stratton, Viveash, Swan View, Midvale, Bellevue are their own suburbs (same postcode 6056, but distinct areas) - no longer collapsed into Midland", "", 1),
    ("including ones added later (Sorrento, Duncraig, Stratton, Viveash, Midvale...)", "including ones added later", 0),
    # "+ Add Contact" opens the add-contact form (RP Data has its own button)
    ("  // the fastest way in is a paste from RP Data - offer that first\n  openRPImport();\n  return;",
     "  // RP Data paste has its own button; this one opens the form\n  openAddContactManual();\n  return;", 1),
    # online, everything is saved to the cloud as you go, so no "back up now" reminder
    ("function backupNudge(){\n  try{", "function backupNudge(){\n  if(window.CRM_HOSTED) return;\n  try{", 1),
    # AI assistant
    ("'You are an AI assistant in M&I CRM for a real estate team in Parkerville WA 6081.",
     "'You are an AI assistant in the CRM of '+ME.name+', a real estate agent at '+ME.agency+'.", 1),
    ("Hi! I know all your Parkerville contacts.", "Hi! I know all your contacts.", 1),
    ("askQ('Draft a just-sold SMS for Parkerville contacts')", "askQ('Draft a just-sold SMS for my contacts')", 1),
    # page and panel titles
    (" — Parkerville</div>", "</div>", 0),
    ("+' — Parkerville</title>", "+'</title>", 1),
    ("+' — Parkerville</h2>", "+'</h2>", 1),
    ("'Market Update — Parkerville'", "'Market Update'", 1),
    # example text in inputs
    ('placeholder="e.g. Fuel — client visits Parkerville"', 'placeholder="e.g. Fuel — client visits"', 1),
    ('placeholder="e.g. Commission — 815 Granite Road Parkerville"', 'placeholder="e.g. Commission — 12 Example St"', 1),
    ('placeholder="e.g. 123 Wedgetail Cir, Parkerville"', 'placeholder="e.g. 12 Example St, Suburb"', 1),
    ('placeholder="e.g. 310 Wedgetail Cir"', 'placeholder="e.g. 12 Example St"', 1),
    ('placeholder="e.g. 815 Granite Rd" value="535 Thomas Rd"', 'placeholder="e.g. 12 Example St" value=""', 1),
    ('placeholder="e.g. Brooking"', 'placeholder="e.g. Example"', 1),
    ('placeholder="e.g. 123 Brooking Rd"', 'placeholder="e.g. 12 Example St"', 1),
    ('John Smith, 123 Brooking Rd, 0412 345 678', 'John Smith, 12 Example St, 0412 345 678', 1),
    ('Jane Doe, Granite, 456 Granite Rd, 0423 456 789', 'Jane Doe, Sample, 45 Sample Rd, 0423 456 789', 1),
    ('just sold a property in Parkerville for {price}', 'just sold a property in your area for {price}', 1),
    ('e.g. Call Richard Bray re listing', 'e.g. Call John Smith re listing', 1),
    # templates that named one listing
    ("have a home open this weekend at 17 Garigal Street, Brabham.", "have a home open this weekend at [address].", 1),
    ("purchasing a property in Brabham, please", "purchasing a property in [suburb], please", 1),
    ("headline:'17 Garigal Street, Brabham'", "headline:'[Address]'", 1),
    ("?subject=Open%20home%2017%20Garigal%20Street%20Brabham'", "?subject=Open%20home'", 1),
    # the old default "nearby" template check named the agent's mobile
    ("|Marina 0492 296 324$)", ")", 1),
    # client names used as examples in code comments
    ('"Cheryl & Robert Simpson" -> "Cheryl Simpson, Robert Simpson"', '"Jane & John Citizen" -> "Jane Citizen, John Citizen"', 0),
    ('("Cheryl" inside "Cheryl Leigh Simpson")', '("Jane" inside "Jane Ann Citizen")', 0),
    ('"Bruce Paul Condren & Ingrid Ann Condren"', '"John Paul Citizen & Jane Ann Citizen"', 0),
    ('Alick Craig Campbell / 294 Summerlakes Parade Ballajura 6066', 'John Craig Citizen / 1 Example Parade Suburb 6000', 0),
    ('"Thi Duyen Nguyen" and "Thi Ngoc Anh Nguyen"', '"Mary Anne Lee" and "Mary Jane Ann Lee"', 0),
    ('"Deborah Ann George" -> "Deborah"', '"Jane Ann Citizen" -> "Jane"', 0),
    ('"Summerlakes Pde" shows as "Summerlakes Parade"', '"Example Pde" shows as "Example Parade"', 0),
    ("Debbie's call list", 'the call list', 0),
    ('"Cheryl Simpson" and "Cheryl Leigh Simpson"', '"Jane Citizen" and "Jane Ann Citizen"', 0),
    ('"Marie Young"', '"Jane Citizen"', 0),
    ('// Debbie-only things', '// call-list-only things', 0),
    ('generated from M&I CRM', 'generated from the CRM', 0),
    # bookkeeping: the agent's own accounts, accountant and regular bills
    ("basState[fy].note='Lodged with the ATO through DPS Accounting';", "basState[fy].note='Lodged with the ATO';", 1),
    ("var acct=/2947|BUSINESS ESSENTIALS/i.test(text)?'Business 2947':(/1385|ACCESS ADVANTAGE/i.test(text)?'Personal 1385':'Bank account');",
     "var acct='Bank account';", 1),
    ("  {key:'id4me', label:'ID4ME.BIZ', test:function(e){return /id4me/i.test(e.desc||'');}},\n", "", 1),
    ("Lodging through DPS Accounting may give you later dates.", "Lodging through a tax agent may give you later dates.", 1),
    ("'Business 2947 and personal 1385, since your last check'", "'Every account you pay business costs from, since your last check'", 1),
    # demo "automation" screen (not reachable from the menus, but it named clients)
    ('Joyce de Haas - 4A Parker Road', 'Example Client - 1 Example Rd', 0),
    ('// Joyce Follow-up', '// Appraisal follow-up', 0),
    ('815 Granite Road', '1 Example Road', 0),
    ('Parkerville Market Update - 47 Recipients', 'Market Update - 47 Recipients', 0),
    ('upcoming listings for Parkerville warm leads', 'upcoming listings for warm leads', 0),
]


def apply_replacements(html):
    # statement corrections for the original owner's own expenses
    html, k = re.subn(r'(// corrections from the ANZ statement[^\n]*\n\(function\(\)\{\n  var fixes=)\{.*?\};\n',
                      r'\1{};\n', html, count=1)
    must(k == 1, 'expense corrections not found')
    # regular bills the bookkeeping check expects each month: start with none
    html, k = re.subn(r"(var BOOK = \(function\(\)\{\n  var d=\{[^\n]*\n    recurring:\[)\n.*?\n(    \]\};)",
                      r'\1\n\2', html, count=1, flags=re.S)
    must(k == 1, 'recurring bills not found')
    html, k = re.subn(r"(    \+ )('<td width=\"56\"[^\n]*MONARCH_CARD_ICON\)\+'[^\n]*</td>')", r"\1(MONARCH_ICON ? \2 : '')", html, count=1)
    must(k == 1, 'email card icon not found')
    for a, b, n in REPLACE:
        c = html.count(a)
        must(c == n or (n == 0), 'replacement expected %d, found %d: %s' % (n, c, a[:70]))
        html = html.replace(a, b)
    # preview texts of the demo automation screen
    html, k = re.subn(r'(function previewAutomation\(type\) \{\n  var messages = \{\n).*?(\n  \};)',
                      lambda m: m.group(1) + '    sample: "Subject: Example\\\\n\\\\nHi {name},\\\\n\\\\n..."' + m.group(2),
                      html, count=1, flags=re.S)
    must(k == 1, 'previewAutomation messages not found')
    # dead "Brabham marketing campaign" panel: sample sales and contact counts
    r = find_element(html, 'brabham-campaign-wrap')
    must(r, 'brabham campaign panel not found')
    html = html[:r[0]] + html[r[1]:]
    return html


def add_runtime(html):
    with open(os.path.join(HERE, 'suburbs.js'), encoding='utf-8') as f:
        js = f.read()
    i = html.find('<script>\nconst CO=')
    must(i > 0, 'main script not found')
    return html[:i] + '<script>\n' + js + '\n</script>\n' + html[i:]


def main(src_path, out_path):
    with open(src_path, encoding='utf-8') as f:
        html = f.read()
    lines = html.split('\n')
    html = '\n'.join(empty_arrays(lines))
    html = clear_snapshot(html)
    html = apply_patches(html)
    html = apply_replacements(html)
    html = add_runtime(html)
    html = rewrite_identity(html)
    html = rewrite_call_list(html)
    html = rename_keys(html)
    html = add_profile(html)
    html = add_addons(html)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote %s (%d KB)' % (out_path, len(html.encode('utf-8')) // 1024))
    for w in WARN:
        print('  note:', w)


if __name__ == '__main__':
    must(len(sys.argv) == 3, 'usage: make_blank_crm.py SOURCE.html OUT.html')
    main(sys.argv[1], sys.argv[2])
