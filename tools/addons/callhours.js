/* ══ CALLING HOURS: the telemarketing rules, checked before each call ══
   Under the Telecommunications (Telemarketing and Research Calls) Industry
   Standard 2017, telemarketing calls may be made on weekdays 9am to 8pm and
   Saturdays 9am to 5pm, not on Sundays or national public holidays, in the
   time where the person lives. Calls outside those times need the person's
   prior consent.

   Tapping a call link in the CRM outside those hours asks first (the Call
   Runner is left as it is). The owner's time zone comes from their
   postcode when there is one (Broken Hill keeps South Australian time),
   otherwise from this device, in Australia, or else Perth.
   Built in by tools/add_addons.py. */
(function(){
  var PERTH = 'Australia/Perth';
  function homeZone(){
    try { var z = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; return /^Australia\//.test(z) ? z : PERTH; } catch (e) { return PERTH; }
  }
  // postcode -> time zone
  function zoneFor(pc){
    var n = parseInt(String(pc || '').replace(/\D/g, ''), 10); if(isNaN(n)) return null;
    if(n === 2880) return 'Australia/Broken_Hill';
    if(n >= 6000 && n <= 6999) return 'Australia/Perth';
    if(n >= 800 && n <= 999) return 'Australia/Darwin';
    if(n >= 5000 && n <= 5999) return 'Australia/Adelaide';
    if((n >= 4000 && n <= 4999) || (n >= 9000 && n <= 9999)) return 'Australia/Brisbane';
    if((n >= 3000 && n <= 3999) || (n >= 8000 && n <= 8999)) return 'Australia/Melbourne';
    if(n >= 7000 && n <= 7999) return 'Australia/Hobart';
    if((n >= 1000 && n <= 2999) || (n >= 200 && n <= 299)) return 'Australia/Sydney';
    return null;
  }
  var PLACE = { 'Australia/Perth':'Perth', 'Australia/Darwin':'Darwin', 'Australia/Adelaide':'Adelaide', 'Australia/Broken_Hill':'Broken Hill',
    'Australia/Brisbane':'Brisbane', 'Australia/Melbourne':'Melbourne', 'Australia/Hobart':'Hobart', 'Australia/Sydney':'Sydney' };
  function place(z){ return PLACE[z] || String(z).split('/').pop().replace(/_/g, ' '); }

  // the local date and time in a zone
  function parts(date, zone){
    var o = {};
    new Intl.DateTimeFormat('en-AU', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(date).forEach(function(p){ o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute, wd: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(o.weekday) };
  }
  // national public holidays: New Year's Day, Australia Day, Good Friday, Easter Monday, Anzac Day, Christmas Day, Boxing Day
  function easter(y){
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(y, mo - 1, da));
  }
  function holiday(p){
    var md = p.m * 100 + p.d;
    if(md === 101) return 'New Year’s Day'; if(md === 126) return 'Australia Day'; if(md === 425) return 'Anzac Day';
    if(md === 1225) return 'Christmas Day'; if(md === 1226) return 'Boxing Day';
    var e = easter(p.y), t = Date.UTC(p.y, p.m - 1, p.d), day = 864e5;
    if(t === e.getTime() - 2 * day) return 'Good Friday';
    if(t === e.getTime() + day) return 'Easter Monday';
    return '';
  }
  function windowFor(p){   // allowed [start, end) in minutes, or null
    if(holiday(p) || p.wd === 0) return null;
    return p.wd === 6 ? [540, 1020] : [540, 1200];
  }
  function fmtTime(mins){ var h = Math.floor(mins / 60), m = mins % 60, ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + (m ? ':' + String(m).padStart(2, '0') : '') + ap; }
  // is a call allowed now, and if not, when next?
  function check(zone, now){
    zone = zone || homeZone(); now = now || new Date();
    var p = parts(now, zone), w = windowFor(p), mins = p.h * 60 + p.min;
    var why = holiday(p) ? holiday(p) + ' (a national public holiday)' : p.wd === 0 ? 'Sunday' : '';
    if(w && mins >= w[0] && mins < w[1]) return { ok: true, zone: zone, local: p, until: fmtTime(w[1]) };
    // next allowed start: today later, or the next allowed day
    var next = null;
    if(w && mins < w[0]) next = 'today at 9am';
    else for(var i = 1; i <= 7 && !next; i++){
      var q = parts(new Date(now.getTime() + i * 864e5), zone);
      if(windowFor(q)) next = (i === 1 ? 'tomorrow' : ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][q.wd]) + ' at 9am';
    }
    return { ok: false, zone: zone, local: p, why: why || (w && mins >= w[1] ? 'after ' + fmtTime(w[1]) : 'before 9am'), next: next };
  }
  function localLine(r){
    var d = r.local, wd = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.wd];
    return fmtTime(d.h * 60 + d.min) + ' on ' + wd + ' in ' + place(r.zone);
  }

  // ── asking before a call outside the hours ──
  function ask(doc, r, who, go){
    var old = doc.getElementById('ch-modal'); if(old) old.remove();
    var m = doc.createElement('div'); m.id = 'ch-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,sans-serif';
    m.innerHTML = '<div role="alertdialog" aria-labelledby="ch-t" style="background:#fff;color:#101828;border-radius:14px;max-width:440px;width:100%;padding:20px 22px;box-shadow:0 20px 50px rgba(0,0,0,.3)">'
      + '<div id="ch-t" style="font-weight:700;font-size:17px;margin-bottom:8px">Outside telemarketing calling hours</div>'
      + '<p style="margin:0 0 8px;font-size:14px;line-height:1.5">It’s <b>' + localLine(r) + '</b>' + (who ? ', where ' + who + ' lives' : '') + ' (' + r.why + ').</p>'
      + '<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#475467">Sales calls are allowed weekdays 9am–8pm and Saturdays 9am–5pm, not on Sundays or national public holidays, unless the person agreed beforehand to a call at this time.</p>'
      + (r.next ? '<p style="margin:0 0 14px;font-size:14px"><b>Next allowed:</b> ' + r.next + ' (' + place(r.zone) + ' time).</p>' : '')
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">'
      + '<button type="button" id="ch-go" style="padding:9px 14px;border-radius:8px;border:1px solid #D0D5DD;background:#fff;color:#344054;font:inherit;font-size:14px;cursor:pointer">They agreed to this call</button>'
      + '<button type="button" id="ch-no" style="padding:9px 14px;border-radius:8px;border:0;background:#1F3A5F;color:#fff;font:inherit;font-size:14px;font-weight:600;cursor:pointer">Don’t call now</button></div></div>';
    doc.body.appendChild(m);
    doc.getElementById('ch-no').onclick = function(){ m.remove(); };
    doc.getElementById('ch-go').onclick = function(){ m.remove(); go(); };
    m.onclick = function(e){ if(e.target === m) m.remove(); };
    doc.getElementById('ch-no').focus();
  }

  // a click on a call link in a document: check first
  function guard(doc, lookup){
    doc.addEventListener('click', function(e){
      var t = e.target && e.target.closest && e.target.closest('a[href^="tel:"]');
      if(!t || t.__chOk) return;
      var info = lookup(t) || {}, r = check(info.zone || null);
      if(r.ok) return;
      e.preventDefault(); e.stopImmediatePropagation();
      ask(doc, r, info.who, function(){ t.__chOk = true; t.click(); setTimeout(function(){ t.__chOk = false; }, 0); });
    }, true);
  }

  // the CRM page: find the contact by the number being called
  guard(document, function(t){
    var dig = String(t.getAttribute('href') || '').replace(/\D/g, '').slice(-9); if(dig.length < 8 || typeof data === 'undefined') return null;
    var c = data.filter(function(x){ return String(x.ph || '').replace(/\D/g, '').indexOf(dig) >= 0; })[0];
    return c ? { who: String(c.n || '').split(/\s*(?:&|and|,)\s*/)[0] || null, zone: zoneFor(c.pc || c.postcode) } : null;
  });

  window.__callHours = { check: check, zoneFor: zoneFor, holiday: function(y, m, d){ return holiday({ y: y, m: m, d: d }); } };
})();
