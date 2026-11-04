/* ══ ID4ME DETAILS: phones and emails onto the cards you already have ══
   A third tab in the Add Contacts window. Paste one or many people copied from
   ID4me; each person (a name line starts a new person) is found in the CRM by
   name and shown next to the card their details will go on. Only phones and
   emails are added. The address on ID4me is never added (it is often an old
   home or a rental) and nothing new is created. When two contacts share the
   name, or only the surname matches, you pick the right one.
   Built in by tools/add_addons.py. */
(function(){
  var single = document.getElementById('ac-tab-single'), bulk = document.getElementById('ac-tab-bulk');
  var singleBox = document.getElementById('ac-single'), bulkBox = document.getElementById('ac-bulk');
  if(!single || !bulk || !singleBox || !bulkBox || typeof data === 'undefined') return;

  function esc(x){ return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function title(x){ return String(x || '').trim().toLowerCase().replace(/\b[a-z]/g, function(c){ return c.toUpperCase(); }); }
  function digits(x){ return String(x || '').replace(/[^0-9]/g, ''); }
  var PH = /(?:\+?61\s?|0)[2-578](?:[\s\-]?\d){8}|\(0\d\)\s?\d{4}\s?\d{4}/g;
  var EM = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  var STREET = /\b(road|rd|street|st|way|avenue|ave|place|pl|drive|dr|court|ct|crescent|cres|close|cl|lane|ln|parade|pde|terrace|tce|grove|gr|gv|circle|cir|circuit|cct|loop|boulevard|bvd|rise|chase|link|approach|app|gardens|gdns|entrance|retreat|mews|square|sq|highway|hwy|vista|ridge|green|walk|glen|ramble|view|turn|glade|promenade|esplanade|bend|heights)\b/i;
  var STATE = /\b(WA|NSW|VIC|QLD|SA|TAS|NT|ACT)\s*\d{4}\b/;
  var LABEL = /^\s*(name|full name|mobile|mob|phone|ph|landline|home|work|email|e-mail|address|current address|previous address|dob|date of birth|age|gender|occupation)\s*[:\-]?\s*/i;

  function isAddress(t){ return /\d/.test(t) && (STREET.test(t) || STATE.test(t)); }
  function asName(t){
    t = String(t || '').replace(LABEL, '').replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
    if(!t || /\d|@/.test(t)) return '';
    if(!/^[A-Za-z][A-Za-z'\-\. ]*(,\s*[A-Za-z][A-Za-z'\-\. ]*)?$/.test(t)) return '';
    var parts = t.split(/\s*,\s*/);
    var full = parts.length === 2 ? parts[1] + ' ' + parts[0] : t;   // "SURNAME, First Middle"
    if(full.split(/\s+/).length < 2) return '';
    return /[a-z]/.test(full) && !/^[A-Z][A-Z'\-\. ]+$/.test(full) ? full : title(full);
  }
  function suburbOf(t){ var m = String(t || '').match(/([A-Za-z][A-Za-z'\- ]{2,30}?)\s*,?\s+(?:WA|NSW|VIC|QLD|SA|TAS|NT|ACT)\s*\d{4}/); return m ? title(m[1].replace(new RegExp('^.*' + STREET.source + '\\s*', 'i'), '').trim()) : ''; }

  // the paste -> one entry per person
  function parse(txt){
    var people = [], cur = null;
    function start(name){ cur = { name: name, phones: [], emails: [], addr: '', suburb: '' }; people.push(cur); }
    function take(t){
      (t.match(EM) || []).forEach(function(e){ if(cur && cur.emails.indexOf(e.toLowerCase()) < 0) cur.emails.push(e.toLowerCase()); });
      var rest = t.replace(EM, ' ');
      (rest.match(PH) || []).forEach(function(p){ var d = digits(p); if(cur && d.length >= 9 && !cur.phones.some(function(x){ return digits(x) === d; })) cur.phones.push(p.trim()); });
    }
    String(txt || '').split(/\r?\n/).forEach(function(line){
      var l = line.trim(); if(!l) return;
      var fields = l.split(/\t|\s{3,}|\s\|\s/).map(function(f){ return f.trim(); }).filter(Boolean);
      if(fields.length > 1){
        // a row with several fields: name, date of birth, address, phones, emails
        var nm = '';
        fields.forEach(function(f){ if(!nm && !isAddress(f)) nm = asName(f); });
        if(nm) start(nm);
        fields.forEach(function(f){ if(cur && isAddress(f) && !cur.addr){ cur.addr = f; cur.suburb = suburbOf(f); } });
        if(cur) take(l);
        return;
      }
      if(isAddress(l)){ if(cur && !cur.addr){ cur.addr = l; cur.suburb = suburbOf(l); } return; }
      var n = (/[,]/.test(l) || !/(@|\d)/.test(l)) ? asName(l) : '';
      if(n && !LABEL.test(l.replace(/^\s*name\s*[:\-]/i, ''))){ start(n); return; }
      if(cur) take(l);
    });
    return people.filter(function(p){ return p.phones.length || p.emails.length; });
  }

  // a person -> the contacts that could be them
  function words(x){ return String(x || '').toLowerCase().replace(/[^a-z' \-]/g, ' ').split(/\s+/).filter(function(w){ return w.length > 1; }); }
  function owner(c){ return ' ' + words(c.n).join(' ') + ' '; }
  function candidates(p){
    var w = words(p.name), live = data.map(function(c, i){ return i; }).filter(function(i){ return data[i] && data[i].stage !== 'removed' && !/not yet verified/i.test(data[i].n || ''); });
    var has = function(i, list){ var o = owner(data[i]); return list.every(function(x){ return o.indexOf(' ' + x + ' ') >= 0; }); };
    var exact = live.filter(function(i){ return has(i, w); });
    if(exact.length) return { list: exact, how: 'name' };
    if(w.length > 2){ var fl = [w[0], w[w.length - 1]], short = live.filter(function(i){ return has(i, fl); }); if(short.length) return { list: short, how: 'first and last name' }; }
    var sur = w[w.length - 1], same = sur && sur.length > 2 ? live.filter(function(i){ return has(i, [sur]); }).slice(0, 12) : [];
    return { list: same, how: same.length ? 'surname only' : '' };
  }
  function pick(p, c){
    if(c.list.length === 1 && c.how !== 'surname only') return c.list[0];
    if(c.how !== 'surname only' && p.suburb){
      var s = p.suburb.toLowerCase(), here = c.list.filter(function(i){ return String(data[i].suburb || '').toLowerCase() === s; });
      if(here.length === 1){ p._bySuburb = true; return here[0]; }
    }
    return -1;
  }
  function label(i){ var c = data[i]; return c.a + (c.suburb ? ', ' + c.suburb : '') + ' — ' + (c.n || ''); }
  function newOnes(p, c){
    var ph = p.phones.filter(function(x){ return digits(c.ph).indexOf(digits(x).slice(-9)) < 0; });
    var em = p.emails.filter(function(x){ return String(c.em || '').toLowerCase().indexOf(x) < 0; });
    return { ph: ph, em: em };
  }

  var rows = [];
  function draw(){
    var out = document.getElementById('id4-result'), go = document.getElementById('id4-go');
    if(!rows.length){ out.innerHTML = '<div style="color:#B42318;font-size:12.5px">No phones or emails found in the paste. Paste the person’s name with their phones and emails from ID4me.</div>'; go.style.display = 'none'; return; }
    var n = 0;
    out.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px">' + rows.map(function(r, k){
      var sel = r.cands.list.length ? '<select data-k="' + k + '" class="id4-pick" style="width:100%;padding:5px;border-radius:6px;border:1px solid #D0D5DD;font-size:12px">'
        + '<option value="-1">' + (r.choice < 0 ? 'Choose the right contact…' : 'Don’t add') + '</option>'
        + r.cands.list.map(function(i){ return '<option value="' + i + '"' + (i === r.choice ? ' selected' : '') + '>' + esc(label(i)) + '</option>'; }).join('') + '</select>'
        : '<span style="color:#B42318">Not found in your CRM, so nothing is added.</span>';
      var add = r.choice >= 0 ? newOnes(r, data[r.choice]) : null;
      if(add && (add.ph.length || add.em.length)) n++;
      return '<tr style="border-top:1px solid #EAECF0;vertical-align:top">'
        + '<td style="padding:7px 6px;width:30%"><b>' + esc(r.name) + '</b><div style="color:#667085;font-size:11px">' + esc(r.phones.concat(r.emails).join(', ')) + '</div>'
        + (r.addr ? '<div style="color:#98A2B3;font-size:10.5px">ID4me address not added: ' + esc(r.addr) + '</div>' : '') + '</td>'
        + '<td style="padding:7px 6px">' + sel + (r._bySuburb && r.choice >= 0 ? '<div style="color:#B54708;font-size:10.5px;margin-top:2px">' + r.cands.list.length + ' contacts have this name; picked the one in ' + esc(r.suburb) + ' from the ID4me address \u2014 check it</div>' : '') + (r.cands.how && r.cands.how !== 'name' ? '<div style="color:#B54708;font-size:10.5px;margin-top:2px">Matched on ' + r.cands.how + ' — check it is the right person</div>' : '')
        + (add ? '<div style="font-size:11px;margin-top:3px;color:' + (add.ph.length || add.em.length ? '#067647' : '#667085') + '">'
          + (add.ph.length || add.em.length ? 'Will add: ' + esc(add.ph.concat(add.em).join(', ')) : 'Already has these details') + '</div>' : '') + '</td></tr>';
    }).join('') + '</table>';
    [].slice.call(out.querySelectorAll('.id4-pick')).forEach(function(s){ s.onchange = function(){ rows[+s.getAttribute('data-k')].choice = +s.value; draw(); }; });
    go.style.display = 'inline-block';
    go.disabled = !n;
    go.textContent = n ? 'Add to ' + n + ' card' + (n === 1 ? '' : 's') : 'Nothing new to add';
  }
  function find(){
    rows = parse(document.getElementById('id4-paste').value).map(function(p){ var c = candidates(p); p.cands = c; p.choice = pick(p, c); return p; });
    draw();
  }
  function apply(){
    var d = new Date(), stamp = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getFullYear()).slice(-2), done = [];
    rows.forEach(function(r){
      if(r.choice < 0) return;
      var c = data[r.choice], add = newOnes(r, c);
      if(!add.ph.length && !add.em.length) return;
      if(add.ph.length) c.ph = (c.ph && c.ph !== '-' && c.ph !== '—' ? c.ph + '\n' : '') + add.ph.join('\n');
      if(add.em.length) c.em = (c.em && c.em !== '-' && c.em !== '—' ? c.em + '\n' : '') + add.em.join('\n');
      c.note = '[' + stamp + '] Added from ID4me: ' + add.ph.concat(add.em).join(', ') + '\n' + (c.note || '');
      done.push(c.a);
    });
    if(!done.length) return;
    saveToStorage();
    try { renderCurrent(); } catch (e) {}
    try { if(typeof logSession === 'function') logSession('ID4me details added to ' + done.length + ' contact' + (done.length === 1 ? '' : 's')); } catch (e) {}
    alert('Phones and emails added to ' + done.length + ' card' + (done.length === 1 ? '' : 's') + ':\n' + done.slice(0, 12).join('\n') + (done.length > 12 ? '\n…' : ''));
    document.getElementById('id4-paste').value = ''; rows = []; document.getElementById('id4-result').innerHTML = ''; document.getElementById('id4-go').style.display = 'none';
  }

  // the tab and its box
  if(!document.getElementById('ac-tab-id4me')){
    var tab = document.createElement('button');
    tab.className = 'vtab'; tab.id = 'ac-tab-id4me'; tab.type = 'button'; tab.textContent = '🪪 ID4me details';
    bulk.parentNode.insertBefore(tab, bulk.nextSibling);
    var box = document.createElement('div');
    box.id = 'ac-id4me'; box.style.display = 'none';
    box.innerHTML = '<div style="font-size:12.5px;color:#344054;margin-bottom:8px;line-height:1.5">Paste one or many people from ID4me. Each person is found in your CRM by name, '
      + 'and <b>only their phones and emails</b> are added to the card you already have. The ID4me address is never added.</div>'
      + '<textarea id="id4-paste" rows="8" placeholder="Paste from ID4me here..." style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #D0D5DD;font-size:12px;box-sizing:border-box;font-family:inherit"></textarea>'
      + '<div style="display:flex;gap:8px;margin:8px 0"><button type="button" id="id4-find" style="padding:8px 16px;border-radius:8px;background:#0B1F3A;color:#fff;border:0;font-size:13px;font-weight:600;cursor:pointer">Find contacts</button>'
      + '<button type="button" id="id4-go" style="display:none;padding:8px 16px;border-radius:8px;background:#E3A92B;color:#1A1203;border:0;font-size:13px;font-weight:700;cursor:pointer">Add to cards</button></div>'
      + '<div id="id4-result"></div>';
    bulkBox.parentNode.insertBefore(box, bulkBox.nextSibling);
    var show = function(which){
      singleBox.style.display = which === 'single' ? 'block' : 'none';
      bulkBox.style.display = which === 'bulk' ? 'block' : 'none';
      box.style.display = which === 'id4me' ? 'block' : 'none';
      single.classList.toggle('on', which === 'single'); bulk.classList.toggle('on', which === 'bulk'); tab.classList.toggle('on', which === 'id4me');
    };
    single.addEventListener('click', function(){ show('single'); });
    bulk.addEventListener('click', function(){ show('bulk'); });
    tab.addEventListener('click', function(){ show('id4me'); setTimeout(function(){ document.getElementById('id4-paste').focus(); }, 20); });
    document.getElementById('id4-find').onclick = find;
    document.getElementById('id4-go').onclick = apply;
    // the window always opens on "One contact"
    if(typeof openAddContactManual === 'function'){
      var _open = openAddContactManual;
      window.openAddContactManual = function(){ var r = _open.apply(this, arguments); show('single'); return r; };
    }
  }

  window.__id4me = { parse: parse, candidates: candidates };
})();
