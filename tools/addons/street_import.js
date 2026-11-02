/* ══ WHOLE STREET: bulk adding where people look for it ══
   The Add Contacts window's second tab becomes "Whole street (bulk)". At its
   top: add a street by its house numbers (every house as "Owner not yet
   verified", for doorknocking and calling), paste a list from your own
   spreadsheet or notes (the Contact Import, which works out street and
   suburb, matches what is already here and shows a preview first), or import
   a spreadsheet or saved file. The typed list (one owner per line) stays
   underneath; Import All now says how many were saved and closes the window.
   Pasted lines like "Name, phone, street, suburb" and ID4me rows find the right
   existing card by the person's name and add only the phone or email to it: an
   ID4me address (maybe an old home or a rental) is never matched on, and only
   added when you choose "Also add as another property" or "Add as a property".
   Built in by tools/add_addons.py. */
(function(){
  var tab = document.getElementById('ac-tab-bulk'), box = document.getElementById('ac-bulk');
  if(!tab || !box || typeof openRPImport !== 'function') return;
  tab.textContent = '📋 Whole street (bulk)';
  tab.style.fontWeight = '600';
  var single = document.getElementById('ac-tab-single'); if(single) single.textContent = '✏️ One contact';

  // Import All: say how many were saved and close the window
  if(typeof importBulk === 'function'){
    var _bulk = importBulk;
    window.importBulk = function(){
      var before = data.length;
      var r = _bulk.apply(this, arguments);
      var added = data.length - before;
      if(added > 0){
        alert(added + ' contact' + (added === 1 ? '' : 's') + ' saved.');
        try { if(typeof closeAddContact === 'function') closeAddContact(); } catch (e) {}
      } else if(document.getElementById('ac-bulk-data').value.trim() && !/^(|__new)$/.test(document.getElementById('ac-bulk-suburb').value)){
        alert('Nothing was saved. Each line needs at least a name, a street and an address, for example:\nJohn Smith, 12 Example St, 0412 345 678');
      }
      return r;
    };
  }

  if(!document.getElementById('ac-street-tools')){
    var t = document.createElement('div');
    t.id = 'ac-street-tools';
    t.style.cssText = 'background:#FFF8E6;border:1px solid #F2DFA8;border-radius:10px;padding:12px 14px;margin-bottom:12px';
    t.innerHTML = '<div style="font-size:13px;font-weight:700;color:#3D2600;margin-bottom:4px">Add a whole street in one go</div>'
      + '<div style="font-size:12px;color:#5a4a20;margin-bottom:10px;line-height:1.5">Create every house in a street by its numbers and fill in the owners as you go, '
      + 'or paste a list of owners and addresses from your own spreadsheet or notes. Properties already in your CRM are never added twice.</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + '<button type="button" id="ac-street-build" style="padding:9px 16px;border-radius:8px;background:#E3A92B;color:#1A1203;border:0;font-size:13px;font-weight:700;cursor:pointer">\uD83C\uDFE0 Add a street by house numbers</button>'
      + '<button type="button" id="ac-street-paste" style="padding:9px 14px;border-radius:8px;background:#fff;color:#344054;border:1px solid #D0D5DD;font-size:13px;font-weight:600;cursor:pointer">\uD83D\uDCCB Paste a list or ID4me rows</button>'
      + '<button type="button" id="ac-street-file" style="padding:9px 14px;border-radius:8px;background:#fff;color:#344054;border:1px solid #D0D5DD;font-size:13px;font-weight:600;cursor:pointer">\uD83D\uDCC2 Import a spreadsheet</button>'
      + '</div>'
      + '<div style="font-size:11.5px;color:#7a6a40;margin-top:10px">Or type them in below, one owner per line.</div>';
    box.insertBefore(t, box.firstChild);
    var close = function(){ try { if(typeof closeAddContact === 'function') closeAddContact(); } catch (e) {} };
    document.getElementById('ac-street-paste').onclick = function(){ close(); openRPImport(); };
    document.getElementById('ac-street-build').onclick = function(){ close(); openStreetBuilder(); };
    document.getElementById('ac-street-file').onclick = function(){ close(); if(typeof crmImportFile === 'function') crmImportFile(); };
  }

  // the paste window: about any list, not one data provider
  var _rp = openRPImport;
  window.openRPImport = function(){
    var r = _rp.apply(this, arguments);
    var m = document.getElementById('rp-modal');
    if(m){
      var h = m.querySelector('h3'); if(h) h.textContent = '📋 Paste a list of properties';
      var d = h && h.parentNode && h.parentNode.nextElementSibling;
      if(d && d.tagName === 'DIV') d.innerHTML = 'Paste owners and addresses from your own spreadsheet, notes or an email: a whole street, a single property, '
        + 'or rows of names with phones and emails. One property per line works best, for example <b>12 EXAMPLE WAY SUBURB WA 6000</b> with the owner on the next line. '
        + '<b>New properties are added</b> with the street and suburb worked out from the address. Properties already in your CRM only have their gaps filled, '
        + 'and you see a preview before anything is written.<br><b>ID4me rows</b> (name, date of birth, address, phones, emails): each person is found by their name '
        + 'and only their phones and emails are added to their card. The address on the row is never added, as it may be an old home or a rental.';
      var ta = document.getElementById('rp-paste'); if(ta) ta.placeholder = 'Paste your list here...';
    }
    return r;
  };

  // ── Add a street by house numbers ──
  var TYPES = ['Street', 'Road', 'Drive', 'Way', 'Avenue', 'Place', 'Court', 'Crescent', 'Close', 'Lane', 'Parade', 'Terrace', 'Grove', 'Circle', 'Circuit', 'Loop', 'Boulevard', 'Rise', 'Chase', 'Link', 'Approach', 'Gardens', 'Entrance', 'Retreat', 'Mews', 'Square', 'Ramble', 'View', 'Vista', 'Ridge', 'Highway'];
  function esc(x){ return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function title(x){ return String(x || '').trim().toLowerCase().replace(/\b[a-z]/g, function(c){ return c.toUpperCase(); }); }
  function numbers(from, to, which, extra){
    var out = [], a = parseInt(from, 10), b = parseInt(to, 10);
    if(!isNaN(a) && !isNaN(b)){
      if(a > b){ var t = a; a = b; b = t; }
      for(var n = a; n <= b && out.length < 1000; n++){
        if(which === 'odd' && n % 2 === 0) continue;
        if(which === 'even' && n % 2 === 1) continue;
        out.push(String(n));
      }
    }
    String(extra || '').split(/[\s,;]+/).forEach(function(x){ x = x.trim().toUpperCase(); if(/^\d+[A-Z]?(\/\d+[A-Z]?)?$/.test(x) && out.indexOf(x) < 0) out.push(x); });
    return out;
  }
  function have(addr, suburb){
    var k = (typeof rpKey === 'function' ? rpKey(addr) : addr.toLowerCase()), s = String(suburb || '').toLowerCase().trim();
    return data.some(function(c){ return c.stage !== 'removed' && String(c.suburb || '').toLowerCase().trim() === s && (typeof rpKey === 'function' ? rpKey(c.a) : String(c.a || '').toLowerCase()) === k; });
  }
  function plan(){
    var name = title(document.getElementById('sb-name').value), type = document.getElementById('sb-type').value, sub = document.getElementById('sb-suburb').value;
    var nums = numbers(document.getElementById('sb-from').value, document.getElementById('sb-to').value, document.getElementById('sb-which').value, document.getElementById('sb-extra').value);
    var street = (name + ' ' + type).trim();
    var add = [], skip = [];
    if(name && sub && sub !== '__new') nums.forEach(function(n){ var a = n + ' ' + street; (have(a, sub) ? skip : add).push(a); });
    return { name: name, street: street, sub: sub, add: add, skip: skip, nums: nums };
  }
  function show(){
    var p = plan(), out = document.getElementById('sb-preview'), go = document.getElementById('sb-go');
    if(!p.name){ out.textContent = 'Type the street name.'; go.disabled = true; return; }
    if(!p.sub || p.sub === '__new'){ out.textContent = 'Choose the suburb.'; go.disabled = true; return; }
    if(!p.nums.length){ out.textContent = 'Type the house numbers (from and to).'; go.disabled = true; return; }
    out.innerHTML = '<b>' + p.add.length + '</b> new propert' + (p.add.length === 1 ? 'y' : 'ies') + ' in ' + esc(p.street) + ', ' + esc(p.sub)
      + (p.skip.length ? ' &middot; ' + p.skip.length + ' already in your CRM (skipped)' : '')
      + (p.add.length ? '<div style="font-size:11px;color:#667085;margin-top:4px">' + esc(p.add.slice(0, 8).join(', ')) + (p.add.length > 8 ? ' &hellip;' : '') + '</div>' : '');
    go.disabled = !p.add.length;
    go.textContent = p.add.length ? 'Add ' + p.add.length + ' propert' + (p.add.length === 1 ? 'y' : 'ies') : 'Add';
  }
  window.openStreetBuilder = function(){
    var m = document.getElementById('sb-modal'); if(m) m.remove();
    m = document.createElement('div'); m.id = 'sb-modal'; m.setAttribute('data-addon', '1');
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:640;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px';
    var f = 'width:100%;padding:8px 10px;border-radius:8px;border:1px solid #D0D5DD;background:#fff;font-size:13px;box-sizing:border-box';
    var l = 'display:block;font-size:11.5px;color:#475467;margin:0 0 4px';
    m.innerHTML = '<div style="background:#fff;border-radius:14px;width:560px;max-width:100%;margin:auto;padding:16px 18px;box-shadow:0 10px 30px rgba(0,0,0,.2)">'
      + '<div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0;font-size:16px;color:#0B1F3A">🏠 Add a street by house numbers</h3>'
      + '<button type="button" id="sb-x" style="background:none;border:0;font-size:22px;cursor:pointer;color:#667085">&times;</button></div>'
      + '<div style="font-size:12px;color:#475467;margin:6px 0 12px;line-height:1.5">Every house is added as <b>Owner not yet verified</b>, ready for doorknocking and calling. Fill in the owner on each card as you find out.</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
      + '<div><label style="' + l + '">Street name</label><input id="sb-name" placeholder="e.g. Vista" style="' + f + '"></div>'
      + '<div><label style="' + l + '">Street type</label><select id="sb-type" style="' + f + '">' + TYPES.map(function(t){ return '<option>' + t + '</option>'; }).join('') + '</select></div>'
      + '<div style="grid-column:1/-1"><label style="' + l + '">Suburb</label><select id="sb-suburb" style="' + f + '"></select></div>'
      + '<div><label style="' + l + '">House numbers from</label><input id="sb-from" inputmode="numeric" placeholder="1" style="' + f + '"></div>'
      + '<div><label style="' + l + '">to</label><input id="sb-to" inputmode="numeric" placeholder="60" style="' + f + '"></div>'
      + '<div><label style="' + l + '">Which numbers</label><select id="sb-which" style="' + f + '"><option value="all">All</option><option value="odd">Odd side only</option><option value="even">Even side only</option></select></div>'
      + '<div><label style="' + l + '">Stage</label><select id="sb-stage" style="' + f + '"><option value="cold">Cold</option><option value="msg">Message left</option><option value="potential">No answer</option></select></div>'
      + '<div style="grid-column:1/-1"><label style="' + l + '">Extra numbers (optional)</label><input id="sb-extra" placeholder="e.g. 2A, 14B, 3/20" style="' + f + '"></div>'
      + '</div>'
      + '<div id="sb-preview" style="margin:12px 0;padding:10px 12px;background:#F5F2EA;border-radius:8px;font-size:13px;color:#101828">Type the street name.</div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" id="sb-cancel" style="padding:8px 14px;border-radius:8px;background:#fff;border:1px solid #D0D5DD;cursor:pointer;font-size:13px">Cancel</button>'
      + '<button type="button" id="sb-go" disabled style="padding:8px 16px;border-radius:8px;background:#E3A92B;color:#1A1203;border:0;cursor:pointer;font-size:13px;font-weight:700">Add</button></div></div>';
    document.body.appendChild(m);
    try { CRM_SUBURB_SELECTS['sb-suburb'] = 'new'; crmFillSuburbSelects(); } catch (e) {}
    var closeIt = function(){ m.remove(); };
    document.getElementById('sb-x').onclick = closeIt; document.getElementById('sb-cancel').onclick = closeIt;
    m.addEventListener('click', function(e){ if(e.target === m) closeIt(); });
    ['sb-name', 'sb-type', 'sb-suburb', 'sb-from', 'sb-to', 'sb-which', 'sb-extra'].forEach(function(id){
      var el = document.getElementById(id); el.addEventListener('input', show); el.addEventListener('change', show);
    });
    document.getElementById('sb-go').onclick = function(){
      var p = plan(); if(!p.add.length) return;
      var stage = document.getElementById('sb-stage').value;
      var d = new Date(), stamp = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getFullYear()).slice(-2);
      p.add.forEach(function(a){
        data.push({ id: data.length, s: p.name, a: a, n: 'Owner not yet verified', ph: '-', em: '-', note: 'Added with the street ' + stamp + '.', stage: stage, date: '',
          apprDate: '', salePrice: '', settledDate: '', suburb: p.sub, purchaseYear: '', buildYear: '' });
      });
      saveToStorage();
      try { if(typeof rebuildSuburbTabs === 'function') rebuildSuburbTabs(); if(typeof rebuildPills === 'function') rebuildPills(); } catch (e) {}
      renderCurrent();
      try { if(typeof logSession === 'function') logSession('Added ' + p.add.length + ' properties in ' + p.street + ', ' + p.sub); } catch (e) {}
      closeIt();
      alert(p.add.length + ' propert' + (p.add.length === 1 ? 'y' : 'ies') + ' added in ' + p.street + ', ' + p.sub + '.' + (p.skip.length ? '\n' + p.skip.length + ' already in your CRM were left as they are.' : ''));
    };
    setTimeout(function(){ document.getElementById('sb-name').focus(); }, 30);
  };

  // ── Paste a list: "Name, phone, street, suburb" finds the right card ──
  // A line without an address used to read the street and suburb as part of the
  // person's name, so it matched nobody. The street and suburb are now taken out
  // of the name and used to pick the right contact; a line with a house number
  // and street is matched on that address like any other.
  var STREETWORD = /\b(road|rd|street|st|way|avenue|ave|place|pl|drive|dr|court|ct|crescent|cres|close|cl|lane|ln|parade|pde|terrace|tce|grove|gr|gv|circle|cir|circuit|loop|boulevard|bvd|rise|chase|link|approach|gardens|entrance|retreat|mews|square|highway|hwy|vista|ridge|green|walk|glen|ramble|view|turn|glade|promenade|esplanade|bend|meander|outlook|heights)\b\.?$/i;
  var PH = /\b0[45]\d{2}\s?\d{3}\s?\d{3}\b|\b0[2378]\s?\d{4}\s?\d{4}\b|\(0\d\)\s?\d{4}\s?\d{4}/g, EM = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  function suburbs(){
    var o = {};
    data.forEach(function(c){ if(c.suburb) o[String(c.suburb).toLowerCase().trim()] = 1; });
    try { JSON.parse(localStorage.getItem('crm_extra_suburbs') || '[]').forEach(function(x){ o[String(x).toLowerCase().trim()] = 1; }); } catch (e) {}
    return o;
  }
  function wordsOf(x){ return String(x || '').toLowerCase().replace(/[^a-z' \-]/g, ' ').split(/\s+/).filter(function(w){ return w.length > 1 && !STREETWORD.test(w); }); }
  if(typeof rpParse === 'function'){
    var _parse = rpParse;
    window.rpParse = function(txt){
      var out = _parse.apply(this, arguments), subs = suburbs();
      out.forEach(function(r){
        if(!r || !r._contactOnly || !r.rawLine) return;
        var fields = String(r.rawLine).replace(EM, ' ').replace(PH, ' ').split(/[,\t;|]|\s{2,}/).map(function(f){ return f.replace(/\b(name|phone|mobile|mob|ph|email|e-mail|street|suburb|address)\s*[:\-]/ig, ' ').replace(/\s+/g, ' ').trim(); }).filter(Boolean);
        if(fields.length < 2) return;
        var name = '', street = '', suburb = '', addr = '';
        fields.forEach(function(f){
          var low = f.toLowerCase();
          if(subs[low] || /^(wa|nsw|vic|qld|sa|tas|nt|act)?\s*\d{4}$/i.test(f)){ if(subs[low]) suburb = f; return; }
          var bits = f.split(/\s+/), lastSub = '';
          // "Testing Way Sampleville" or "Sampleville" at the end of a street field
          for(var n = 3; n >= 1 && !lastSub; n--){ var tail = bits.slice(-n).join(' ').toLowerCase(); if(bits.length > n && subs[tail]){ lastSub = bits.slice(-n).join(' '); bits = bits.slice(0, -n); } }
          var rest = bits.join(' ');
          if(STREETWORD.test(rest)){
            if(lastSub) suburb = lastSub;
            if(/^\d+[A-Za-z]?(\/\d+[A-Za-z]?)?\s/.test(rest)) addr = rest; else street = rest;
            return;
          }
          if(!name && /^[A-Za-z][A-Za-z'\-\.&]*(\s+[A-Za-z'\-\.&]+){1,6}$/.test(f)) name = f;
        });
        if(name) r.names = [name];
        if(street) r._streetHint = street;
        if(suburb) r._suburbHint = suburb;
        if(addr){ r.raw = addr.toUpperCase(); r._contactOnly = false; r._idm = true; if(suburb) r.rawLine = addr + ' ' + suburb; }
      });
      // An ID4me row (or a pasted contact line) carries the PERSON's address, which may be
      // an old home or a rental. It is matched on the person's name first; the address only
      // helps choose between two people with exactly the same name, and is never added.
      out.forEach(function(r){
        if(!r || !r._idm || !r.raw) return;
        r._idmAddr = r.raw;
        if(!r._streetHint){ var m = String(r.raw).match(/^\S+\s+(.+)$/); if(m){ r._streetHint = m[1]; r._hintWeak = true; } }
        r.raw = '';
      });
      return out;
    };
  }
  if(typeof rpNameCandidates === 'function'){
    var _cands = rpNameCandidates;
    window.rpNameCandidates = function(p){
      var hits = _cands.apply(this, arguments);
      if(!p || !(p._streetHint || p._suburbHint)) return hits;
      var st = wordsOf(p._streetHint), sub = String(p._suburbHint || '').toLowerCase().trim();
      var fits = function(di){
        var c = data[di]; if(!c) return false;
        if(sub && String(c.suburb || '').toLowerCase().trim() !== sub) return false;
        var where = ' ' + String((c.s || '') + ' ' + (c.a || '')).toLowerCase().replace(/[^a-z' \-]/g, ' ') + ' ';
        return st.every(function(w){ return where.indexOf(' ' + w + ' ') >= 0; });
      };
      var narrowed = hits.filter(fits);
      if(narrowed.length){ if(narrowed.length === 1) p._surnameOnly = false; return narrowed; }
      // no name match at all: the surname at that street and suburb (only for a street
      // typed on the line, not an ID4me address, which may be an old home)
      if(p._hintWeak) return hits;
      var sur = (p.names[0] || '').toLowerCase().replace(/[^a-z' \-]/g, ' ').trim().split(/\s+/).pop();
      var found = [];
      if(sur && sur.length > 2) data.forEach(function(c, di){ if(c.stage !== 'removed' && fits(di) && (' ' + String(c.n || '').toLowerCase() + ' ').indexOf(' ' + sur + ' ') >= 0) found.push(di); });
      if(found.length === 1){ p._surnameOnly = false; return found; }
      return found.length ? found : hits;
    };
  }

  // "add as a property anyway" on an ID4me row: it needs its address back
  if(typeof rpMakeNew === 'function'){
    var _mk = rpMakeNew;
    window.rpMakeNew = function(k){ try { var p = _rpParsed[k]; if(p && p._idmAddr && !p.raw) p.raw = p._idmAddr; } catch (e) {} return _mk.apply(this, arguments); };
  }

  // ── ID4me rows: the suburb from the row, and "also add as another property" ──
  // The address on an ID4me row is not added on its own (it may be an old home or a
  // rental), but it can be: for a person already in the CRM, "Also add as another
  // property" adds it owned by them as well as putting their phone and email on their
  // card; for someone not in the CRM, "Add as a property owned by ..." adds it.
  var _also = {};
  function rowSuburb(txt, addr){
    var lines = String(txt || '').split(/\n/), key = String(addr || '').toLowerCase();
    for(var i = 0; i < lines.length; i++){
      if(key && lines[i].toLowerCase().indexOf(key) >= 0){
        var m = lines[i].match(/([A-Za-z][A-Za-z'\- ]{2,30}?)\s*,?\s+(?:WA|NSW|VIC|QLD|SA|TAS|NT|ACT)\s*\d{4}/);
        return { line: lines[i], sub: m ? title(m[1].replace(/^.*\b(court|ct|street|st|road|rd|way|avenue|ave|place|pl|drive|dr|crescent|cres|close|cl|lane|parade|pde|terrace|tce|grove|loop|circle|boulevard|approach|gardens|entrance|retreat|mews|rise|chase|link|square|vista|view)\b\s*/i, '').trim()) : '' };
      }
    }
    return null;
  }
  var _parse2 = window.rpParse;
  window.rpParse = function(txt){
    var out = _parse2.apply(this, arguments);
    out.forEach(function(r){
      if(!r || !r._idmAddr) return;
      var f = rowSuburb(txt, r._idmAddr);
      if(f){ r._idmLine = f.line; if(f.sub) r._idmSuburb = f.sub; }
    });
    return out;
  };
  if(typeof rpNewRecord === 'function'){
    var _new = rpNewRecord;
    window.rpNewRecord = function(p){
      var rec = _new.apply(this, arguments);
      if(rec){
        if(p && p._idmSuburb && (p._suburbGuessed || !rec.suburb || /^all$/i.test(rec.suburb))){
          rec.suburb = p._idmSuburb; p._suburbGuessed = false;
          rec.note = String(rec.note || '').replace(/!! Suburb not read from the paste - set to [^,.]*, check it\. ?/, '');
        }
        if(/^all$/i.test(rec.suburb || '')) rec.suburb = '';   // never the "All suburbs" filter as a suburb
      }
      return rec;
    };
  }
  window.rpAlsoNew = function(k){ if(_also[k]) delete _also[k]; else _also[k] = true; rpRenderPreview(); };
  window.rpAllNew = function(ks){ ks.forEach(function(k){ var p = _rpParsed[k]; if(p && p._idmAddr && !p.raw) p.raw = p._idmAddr; _rpForceNew[k] = true; }); rpRenderPreview(); };
  if(typeof rpPreview === 'function'){
    var _prev = rpPreview;
    window.rpPreview = function(){ _also = {}; return _prev.apply(this, arguments); };
  }
  if(typeof rpRenderPreview === 'function'){
    var _render = rpRenderPreview;
    window.rpRenderPreview = function(){
      var r = _render.apply(this, arguments);
      try {
        var box = document.getElementById('rp-result'); if(!box) return r;
        var unmatched = [];
        [].slice.call(box.querySelectorAll('button[onclick^="rpMakeNew("]')).forEach(function(b){
          var k = parseInt((b.getAttribute('onclick').match(/\d+/) || [])[0], 10), p = _rpParsed[k];
          if(!p || !p._idmAddr) return;
          var addr = title(p._idmAddr) + (p._idmSuburb ? ', ' + p._idmSuburb : '');
          if(/add as a property anyway/i.test(b.textContent)){
            // someone not in the CRM yet
            b.textContent = '➕ Add ' + addr + ' as a property owned by ' + (p.names[0] || 'them');
            b.style.cssText = 'margin-left:6px;font-size:11px;padding:3px 8px;cursor:pointer;background:#E3A92B;color:#1A1203;border:0;border-radius:6px;font-weight:600';
            var cell = b.parentNode; if(cell && cell.firstChild && cell.firstChild.nodeType === 3) cell.firstChild.nodeValue = 'Not in your CRM yet. The address on the row may be an old home or a rental, so it was not added by itself. ';
            unmatched.push(k);
          } else {
            // found by name: phone and email go on their card; the address can be added as well
            var a = document.createElement('button');
            a.textContent = _also[k] ? '✓ ' + addr + ' will be added too (undo)' : '➕ Also add ' + addr + ' as another property';
            a.setAttribute('onclick', 'rpAlsoNew(' + k + ')');
            a.style.cssText = 'margin-left:6px;font-size:11px;padding:3px 8px;cursor:pointer;border-radius:6px;font-weight:600;' + (_also[k] ? 'background:#E3F6EC;color:#085D3A;border:1px solid #9FD8B8' : 'background:#E3A92B;color:#1A1203;border:0');
            b.parentNode.insertBefore(a, b);
            b.remove();   // "instead" would drop the phone and email from their card
          }
        });
        if(unmatched.length > 1){
          var all = document.createElement('button');
          all.textContent = '➕ Add all ' + unmatched.length + ' people not in your CRM as new properties';
          all.setAttribute('onclick', 'rpAllNew([' + unmatched.join(',') + '])');
          all.style.cssText = 'margin:6px 0;font-size:12px;padding:6px 12px;cursor:pointer;background:#E3A92B;color:#1A1203;border:0;border-radius:7px;font-weight:700';
          box.insertBefore(all, box.firstChild);
        }
      } catch (e) {}
      return r;
    };
  }
  if(typeof rpApply === 'function'){
    var _apply = rpApply;
    window.rpApply = function(){
      try {
        Object.keys(_also).forEach(function(k){
          var p = _rpParsed[k]; if(!p || !p._idmAddr) return;
          var q = {}; Object.keys(p).forEach(function(f){ q[f] = p[f]; });
          q.raw = p._idmAddr; q.rawLine = p._idmLine || p._idmAddr; q._idm = false; q._contactOnly = false;
          var rec = rpNewRecord(q), sub = rec ? String(rec.suburb || '').toLowerCase() : '';
          var key = rec ? (typeof rpKey === 'function' ? rpKey(rec.a) : rec.a.toLowerCase()) : '';
          if(rec && !data.some(function(c){ return String(c.suburb || '').toLowerCase() === sub && (typeof rpKey === 'function' ? rpKey(c.a) : String(c.a).toLowerCase()) === key; })) _rpNew.push(q);
        });
      } catch (e) {}
      _also = {};
      return _apply.apply(this, arguments);
    };
  }
})();
