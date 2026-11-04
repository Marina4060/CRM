/* ══ IMPORT FILE: match on address AND suburb ══
   The same street address can be in two suburbs (12 Example St in two
   suburbs are two different houses), so a contact in the file now joins an
   existing contact only when the suburb agrees too. When either side has no
   suburb, the address alone decides, as before.
   The importer also remembers which contact each record in the file became,
   so the call history and diary tasks brought in with it attach to the right
   contact (they carry the file's own contact numbers, which mean nothing in
   this CRM).
   Built in by tools/add_addons.py. */
(function(){
  if(typeof crmMergeContacts !== 'function' || typeof crmMergeState !== 'function') return;

  function sub(s){ return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }
  var map = {};   // record number in the file -> contact number here

  window.crmMergeContacts = function(list, source){
    var full = {}, bare = {}, noSub = {};
    function remember(c, i){
      var a = rpKey(c.a), a2 = (c.a || '').toLowerCase().trim(), s = sub(c.suburb);
      [a, a2].forEach(function(k){
        if(s && full[k + '|' + s] === undefined) full[k + '|' + s] = i;
        if(bare[k] === undefined) bare[k] = i;
        if(!s && noSub[k] === undefined) noSub[k] = i;
      });
    }
    data.forEach(remember);
    function find(r){
      var a = rpKey(r.a), a2 = (r.a || '').toLowerCase().trim(), s = sub(r.suburb), i;
      if(s){
        i = full[a + '|' + s]; if(i === undefined) i = full[a2 + '|' + s];
        if(i === undefined) i = noSub[a]; if(i === undefined) i = noSub[a2];   // the one here has no suburb yet
        return i;
      }
      i = bare[a]; if(i === undefined) i = bare[a2];
      return i;
    }

    map = {};
    var upd = 0, add = 0, same = 0;
    var tag = ' [merged ' + (new Date()).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ']';
    var blank = function(v){ return !v || v === '-' || !String(v).trim(); };
    list.forEach(function(r, n){
      if(!r || !r.a) return;
      var i = find(r);
      if(i === undefined){
        var rec = { s: r.s || '', a: r.a, n: r.n || '', ph: r.ph || '', em: r.em || '', note: r.note || '', stage: r.stage || 'cold', date: r.date || '',
          suburb: r.suburb || '', purchaseYear: r.purchaseYear || '', buildYear: r.buildYear || '', apprDate: r.apprDate || '', salePrice: r.salePrice || '', settledDate: r.settledDate || '' };
        if(!rec.s){ var sm = String(rec.a).match(/^\S+\s+(.+?)\s+\S+$/); rec.s = sm ? sm[1] : ''; }
        if(!rec.suburb && typeof rpSuburbFor === 'function') rec.suburb = rpSuburbFor({ raw: rec.a, rawLine: rec.a });
        rec.id = data.length; data.push(rec); remember(rec, rec.id); map[n] = rec.id; add++; return;
      }
      map[n] = i;
      var c = data[i], changed = false;
      ['ph', 'em', 'n', 'purchaseYear', 'buildYear', 'apprDate', 'salePrice', 'settledDate', 'suburb', 's'].forEach(function(f){
        if(!blank(r[f]) && blank(c[f])){ c[f] = r[f]; changed = true; }
      });
      // phones and emails: add any number or address we do not already hold
      ['ph', 'em'].forEach(function(f){
        if(blank(r[f]) || blank(c[f]) || c[f] === r[f]) return;
        var have = f === 'ph' ? re_digits(c[f]) : String(c[f]).toLowerCase();
        var extra = String(r[f]).split(/\n/).filter(function(x){ x = x.trim(); if(!x) return false; return f === 'ph' ? have.indexOf(re_digits(x)) < 0 && re_digits(x).length >= 8 : have.indexOf(x.toLowerCase()) < 0; });
        if(extra.length){ c[f] = c[f] + '\n' + extra.join('\n'); changed = true; }
      });
      // stage and date: the more advanced stage wins; the newer date wins
      var rd = _crmDateVal(r.date), cd = _crmDateVal(c.date);
      if(rd > cd){ c.date = r.date; changed = true; if(r.stage && r.stage !== c.stage){ c.stage = r.stage; } }
      else if(r.stage && (CRM_STAGE_RANK[r.stage] || 0) > (CRM_STAGE_RANK[c.stage] || 0)){ c.stage = r.stage; changed = true; }
      // notes: keep everything - if the file's note is a superset take it, if it is different append it
      var rn = String(r.note || '').trim(), cn = String(c.note || '').trim();
      if(rn && rn !== cn){
        if(!cn || rn.indexOf(cn) >= 0){ c.note = rn; changed = true; }
        else if(cn.indexOf(rn) < 0){ c.note = cn + '\n' + rn + tag; changed = true; }
      }
      if(changed) upd++; else same++;
    });
    return { updated: upd, added: add, same: same };
  };

  var _state = crmMergeState;
  window.crmMergeState = function(pack){
    var msg = '';
    // call history: each record's entries go to the contact it became
    if(pack.act && typeof actLog !== 'undefined'){
      var got = 0;
      Object.keys(pack.act).forEach(function(k){
        var t = map[k]; if(t === undefined || !data[t]) return;
        actLog[t] = actLog[t] || [];
        (pack.act[k] || []).forEach(function(en){
          if(!actLog[t].some(function(x){ return x.ts === en.ts && x.type === en.type; })){ actLog[t].push(en); got++; }
        });
      });
      if(got){ if(typeof saveActLog === 'function') saveActLog(); msg += ', ' + got + ' activity entries'; }
    }
    // diary tasks: point at the contact here, or at nobody (they keep the name)
    var diary = (pack.diary || []).map(function(t){
      if(!t || t.contactId == null || t.contactId === '') return t;
      var c = {}; Object.keys(t).forEach(function(f){ c[f] = t[f]; });
      var to = map[t.contactId]; c.contactId = to === undefined ? null : to;
      return c;
    });
    var rest = {}; Object.keys(pack).forEach(function(f){ rest[f] = pack[f]; });
    rest.act = {}; rest.diary = diary;
    return msg + _state(rest);
  };

  window.__import = { map: function(){ return map; } };
})();
