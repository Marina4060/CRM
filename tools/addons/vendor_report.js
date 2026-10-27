/* ══ VENDOR REPORTS: a weekly campaign report for each of the agent's listings ══
   Open home numbers and feedback come straight from the Open Home Register.
   The agent adds the week's online views and enquiries, buyer price feedback
   and a comment, then prints it, emails it or texts a summary to the vendor.
   Buyer names and numbers never appear in the report.
   Saved in crm_vendor_reports_v1, which syncs like the rest of the CRM.
   Built in by tools/add_addons.py. */
(function(){
  if(typeof data === 'undefined') return;
  var KEY = 'crm_vendor_reports_v1';
  var DB = { list: [] };
  try { DB = JSON.parse(localStorage.getItem(KEY) || 'null') || { list: [] }; } catch (e) {}
  if(!Array.isArray(DB.list)) DB.list = [];
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) {} }

  var cur = null, weekEnd = today(), mode = 'list';

  // ── small helpers ──
  function h(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function pad(n){ return String(n).padStart(2, '0'); }
  function iso(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today(){ return iso((typeof perthNow === 'function') ? perthNow() : new Date()); }
  function parseIso(s){ var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; }
  function addDays(s, n){ var d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); }
  function nice(s){ var d = parseIso(s); return d ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  function short(s){ var d = parseIso(s); return d ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''; }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function num(v){ var n = parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10); return isNaN(n) ? null : n; }
  function fmtN(n){ return n == null ? '—' : n.toLocaleString('en-AU'); }
  function money(n){ return '$' + Math.round(n).toLocaleString('en-AU'); }
  function first(name){ var s = String(name || '').trim(); if(!s) return 'there'; return s.split(/\s*(?:&|and|,)\s*/i)[0].split(/\s+/)[0]; }
  var TYPES = { street: 'st', road: 'rd', avenue: 'ave', drive: 'dr', court: 'ct', place: 'pl', crescent: 'cres', lane: 'ln', parade: 'pde', terrace: 'tce', close: 'cl', boulevard: 'blvd', boulevarde: 'blvd', circuit: 'cct', grove: 'gr', highway: 'hwy', square: 'sq', way: 'way', loop: 'loop', rise: 'rise', retreat: 'rtt', gardens: 'gdns' };
  function addrKey(a){
    return String(a || '').toLowerCase().split(',')[0].replace(/[^a-z0-9\/ ]/g, ' ').replace(/\s+/g, ' ').trim()
      .split(' ').map(function(w){ return TYPES[w] || w; }).join(' ');
  }
  function sameAddr(a, b){
    var x = addrKey(a), y = addrKey(b); if(!x || !y) return false;
    return x === y || x.indexOf(y + ' ') === 0 || y.indexOf(x + ' ') === 0;
  }
  // "$650k", "650-680k", "$1.2m", "700,000" -> numbers in dollars
  function prices(t){
    var out = [], s = String(t || '').toLowerCase().replace(/,/g, '');
    var unit = /\d\s*m\b/.test(s) ? 1e6 : (/\d\s*k\b/.test(s) ? 1e3 : 0);
    (s.match(/\d+(?:\.\d+)?\s*[km]?/g) || []).forEach(function(m){
      var v = parseFloat(m), u = /m$/.test(m.trim()) ? 1e6 : /k$/.test(m.trim()) ? 1e3 : unit;
      if(!u) u = v < 10 ? 1e6 : v < 10000 ? 1e3 : 1;
      v = v * u; if(v >= 50000 && v <= 50000000) out.push(v);
    });
    return out;
  }

  // ── the numbers behind a report ──
  function week(L){ return (L.weeks = L.weeks || {})[weekEnd] = L.weeks[weekEnd] || {}; }
  function inWeek(d){ return d && d > addDays(weekEnd, -7) && d <= weekEnd; }
  function visitors(L){ return (typeof openHomes !== 'undefined' ? openHomes : []).filter(function(o){ return sameAddr(o.prop, L.addr); }); }
  function stats(L){
    var all = visitors(L).filter(function(o){ return !o.date || o.date <= weekEnd; });
    var wk = all.filter(function(o){ return inWeek(o.date); });
    var dates = {}; wk.forEach(function(o){ dates[o.date] = (dates[o.date] || 0) + 1; });
    var allDates = {}; all.forEach(function(o){ if(o.date) allDates[o.date] = 1; });
    var level = {}; wk.forEach(function(o){ level[o.interest] = (level[o.interest] || 0) + 1; });
    var fb = (L.feedback || []).filter(function(f){ return inWeek(f.date); });
    var comments = wk.filter(function(o){ return o.note; }).map(function(o){ return { interest: o.interest, comment: o.note, price: '' }; })
      .concat(fb.map(function(f){ return { interest: f.interest, comment: f.comment, price: f.price }; }));
    var pr = []; (L.feedback || []).filter(function(f){ return f.date <= weekEnd; }).forEach(function(f){ pr = pr.concat(prices(f.price)); });
    var w = (L.weeks || {})[weekEnd] || {};
    var tot = { views: 0, enq: 0, insp: 0 };
    Object.keys(L.weeks || {}).forEach(function(k){ if(k <= weekEnd){ var x = L.weeks[k]; tot.views += num(x.views) || 0; tot.enq += num(x.enq) || 0; tot.insp += num(x.insp) || 0; } });
    var listed = parseIso(L.listedOn), end = parseIso(weekEnd);
    return {
      groups: wk.length, groupsAll: all.length, opens: Object.keys(dates).sort().map(function(d){ return { date: d, n: dates[d] }; }),
      opensAll: Object.keys(allDates).length, level: level, comments: comments,
      low: pr.length ? Math.min.apply(null, pr) : null, high: pr.length ? Math.max.apply(null, pr) : null, nPrices: pr.length,
      views: num(w.views), enq: num(w.enq), insp: num(w.insp), tot: tot,
      dom: listed && end ? Math.max(0, Math.round((end - listed) / 864e5)) : null
    };
  }

  // ── the report itself: inline styles so it survives being pasted into an email ──
  function reportHTML(L){
    var S = stats(L), brand = (window.ME && ME.brand) || '#185FA5';
    var tile = function(v, label, sub){ return '<td style="padding:10px 8px;text-align:center;border:1px solid #e6e6e2;border-radius:8px;width:25%"><div style="font-size:22px;font-weight:700;color:#1a1a18">' + v + '</div><div style="font-size:12px;color:#5a5a56">' + label + '</div>' + (sub ? '<div style="font-size:11px;color:#9a9a94">' + sub + '</div>' : '') + '</td>'; };
    var lv = ['High', 'Medium', 'Low', 'Just Looking'].filter(function(k){ return S.level[k]; }).map(function(k){ return S.level[k] + ' ' + (k === 'Just Looking' ? 'just looking' : k.toLowerCase() + ' interest'); }).join(', ');
    var sec = function(t){ return '<h3 style="font-size:15px;margin:22px 0 8px;color:' + brand + '">' + t + '</h3>'; };
    var html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a18;max-width:680px;margin:0 auto;font-size:14px;line-height:1.5">'
      + '<div style="background:' + brand + ';color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">'
      + (window.ME && ME.logo ? '<img src="' + h(ME.logo) + '" alt="" style="max-height:44px;max-width:180px;float:right;background:#fff;border-radius:6px;padding:4px">' : '')
      + '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.9">Campaign report · week ending ' + h(nice(weekEnd)) + '</div>'
      + '<div style="font-size:22px;font-weight:700;margin-top:2px">' + h(L.addr) + (L.suburb ? ', ' + h(L.suburb) : '') + '</div>'
      + '<div style="font-size:13px;opacity:.95">Prepared for ' + h(L.vendor || 'the owners') + ' by ' + h(window.ME ? ME.name : '') + ', ' + h(window.ME ? ME.agency : '') + '</div></div>'
      + '<div style="border:1px solid #e6e6e2;border-top:0;border-radius:0 0 10px 10px;padding:16px 20px">'
      + '<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:6px;margin:0 -6px"><tr>'
      + tile(S.dom == null ? '—' : S.dom, 'days on market', L.price ? h(L.price) : '')
      + tile(S.groups, 'groups through', S.opens.length ? S.opens.length + ' open home' + (S.opens.length === 1 ? '' : 's') + ' this week' : 'this week')
      + tile(fmtN(S.views), 'online views', 'this week')
      + tile(fmtN(S.enq), 'enquiries', 'this week') + '</tr></table>'
      + sec('Open homes')
      + (S.opens.length ? '<div>' + S.opens.map(function(o){ return h(short(o.date)) + ': ' + o.n + ' group' + (o.n === 1 ? '' : 's'); }).join(' · ') + '</div>' + (lv ? '<div style="color:#5a5a56">' + h(lv) + '.</div>' : '') : '<div style="color:#5a5a56">No open homes this week.</div>')
      + (S.insp ? '<div>' + S.insp + ' private inspection' + (S.insp === 1 ? '' : 's') + ' this week.</div>' : '')
      + '<div style="color:#5a5a56;font-size:13px">Whole campaign: ' + S.groupsAll + ' group' + (S.groupsAll === 1 ? '' : 's') + ' through ' + S.opensAll + ' open home' + (S.opensAll === 1 ? '' : 's')
      + (S.tot.views ? ', ' + fmtN(S.tot.views) + ' online views' : '') + (S.tot.enq ? ', ' + fmtN(S.tot.enq) + ' enquiries' : '') + '.</div>'
      + sec('Buyer feedback')
      + (S.nPrices ? '<div style="background:#f5f5f3;border-radius:8px;padding:8px 12px;margin-bottom:8px"><b>Price feedback so far:</b> ' + (S.low === S.high ? 'around ' + money(S.low) : money(S.low) + ' to ' + money(S.high)) + ' <span style="color:#5a5a56">(' + S.nPrices + ' opinion' + (S.nPrices === 1 ? '' : 's') + ')</span></div>' : '')
      + (S.comments.length ? '<ul style="margin:0;padding-left:18px">' + S.comments.map(function(c){ return '<li style="margin:3px 0">' + (c.interest ? '<span style="color:#5a5a56">' + h(c.interest === 'Just Looking' ? 'Just looking' : c.interest + ' interest') + ':</span> ' : '') + h(c.comment) + (c.price ? ' <span style="color:#5a5a56">(price: ' + h(c.price) + ')</span>' : '') + '</li>'; }).join('') + '</ul>' : '<div style="color:#5a5a56">No buyer feedback recorded this week.</div>')
      + (L.comments ? sec('My comments') + '<div>' + h(L.comments).replace(/\n/g, '<br>') + '</div>' : '')
      + (L.next ? sec('Next steps') + '<div>' + h(L.next).replace(/\n/g, '<br>') + '</div>' : '')
      + '<div style="margin-top:22px;padding-top:12px;border-top:1px solid #e6e6e2;font-size:13px;color:#5a5a56">Any questions, call me any time.<br><b style="color:#1a1a18">' + h(window.ME ? ME.name : '') + '</b> · ' + h(window.ME ? ME.agency : '') + '<br>' + h(window.ME ? ME.phone : '') + ' · ' + h(window.ME ? ME.email : '') + '</div>'
      + '</div></div>';
    return html;
  }
  function reportText(L){
    var S = stats(L), lines = [];
    lines.push('Hi ' + first(L.vendor) + ',', '', 'Here’s your campaign update for ' + L.addr + ' (week ending ' + short(weekEnd) + '):');
    if(S.dom != null) lines.push('• ' + S.dom + ' days on market');
    lines.push('• ' + S.groups + ' group' + (S.groups === 1 ? '' : 's') + ' through ' + (S.opens.length ? S.opens.length + ' open home' + (S.opens.length === 1 ? '' : 's') : 'open homes'));
    if(S.views != null || S.enq != null) lines.push('• ' + (S.views != null ? fmtN(S.views) + ' online views' : '') + (S.views != null && S.enq != null ? ', ' : '') + (S.enq != null ? S.enq + ' enquiries' : ''));
    if(S.insp) lines.push('• ' + S.insp + ' private inspection' + (S.insp === 1 ? '' : 's'));
    if(S.nPrices) lines.push('• Buyer price feedback: ' + (S.low === S.high ? 'around ' + money(S.low) : money(S.low) + ' to ' + money(S.high)));
    if(S.comments.length){ lines.push('', 'What buyers said:'); S.comments.forEach(function(c){ lines.push('- ' + c.comment + (c.price ? ' (price: ' + c.price + ')' : '')); }); }
    if(L.comments) lines.push('', L.comments);
    if(L.next) lines.push('', 'Next steps: ' + L.next);
    lines.push('', window.ME ? ME.name : '', window.ME ? ME.agency + ' · ' + ME.phone : '');
    return lines.join('\n');
  }
  function smsText(L){
    var S = stats(L);
    var bits = [S.groups + ' group' + (S.groups === 1 ? '' : 's') + ' through'];
    if(S.views != null) bits.push(fmtN(S.views) + ' online views');
    if(S.enq != null) bits.push(S.enq + ' enquiries');
    var t = 'Hi ' + first(L.vendor) + ', update on ' + L.addr + ' this week: ' + bits.join(', ') + '.';
    if(S.nPrices) t += ' Buyer price feedback ' + (S.low === S.high ? 'around ' + money(S.low) : money(S.low) + '–' + money(S.high)) + '.';
    t += ' Full report on its way by email. ' + (window.ME ? ME.first : '');
    return t;
  }

  // ── the window ──
  var css = document.createElement('style');
  css.textContent = ''
    + '#vr-wrap{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:600;display:none;align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px 10px}'
    + '#vr-box{background:var(--bg1);border-radius:16px;width:860px;max-width:100%;box-shadow:0 8px 40px rgba(0,0,0,.25);margin:auto 0}'
    + '#vr-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:0.5px solid var(--bd2)}'
    + '#vr-head h2{font-size:17px;margin:0}'
    + '#vr-body{padding:14px 18px 18px}'
    + '.vr-btn{padding:6px 12px;border-radius:var(--r1);border:0.5px solid var(--bd2);background:var(--bg1);font-size:13px;cursor:pointer;color:var(--t1);font-weight:500;font-family:inherit}'
    + '.vr-btn.go{background:#16324f;color:#fff;border-color:#16324f}.vr-btn.green{background:#1D9E75;color:#fff;border-color:#1D9E75}'
    + '.vr-btn.del{color:#A32D2D;border-color:#F09595}'
    + '.vr-card{border:0.5px solid var(--bd2);border-radius:12px;padding:12px 14px;margin-bottom:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;cursor:pointer}'
    + '.vr-card:hover{background:var(--bg2)}'
    + '.vr-sub{color:var(--t2);font-size:12px}'
    + '.vr-sec{margin-top:16px}.vr-sec>h3{font-size:14px;margin:0 0 8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}'
    + '.vr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}'
    + '.vr-f{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--t2)}'
    + '.vr-f input,.vr-f select,.vr-f textarea{padding:7px 9px;border-radius:var(--r1);border:0.5px solid var(--bd2);background:var(--bg1);color:var(--t1);font:13px var(--font)}'
    + '.vr-f textarea{min-height:64px;resize:vertical}'
    + '.vr-row{display:flex;gap:8px;align-items:center;padding:6px 0;border-top:0.5px solid var(--bd3);font-size:13px;flex-wrap:wrap}'
    + '.vr-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:12px;border-top:0.5px solid var(--bd2)}'
    + '.vr-note{background:#FFF9DB;border:0.5px solid #E8C848;border-radius:8px;padding:8px 10px;font-size:12px;color:#5c4b00}'
    + '@media (max-width:600px){#vr-body{padding:12px}.vr-grid{grid-template-columns:1fr 1fr}}';
  document.head.appendChild(css);
  var wrap = document.createElement('div'); wrap.id = 'vr-wrap';
  wrap.innerHTML = '<div id="vr-box"><div id="vr-head"></div><div id="vr-body"></div></div>';
  wrap.addEventListener('click', function(e){ if(e.target === wrap) window.closeVendorReports(); });
  document.body.appendChild(wrap);

  var reportsBtn = document.querySelector('button[onclick="openExtra()"]');
  if(reportsBtn){
    var b = document.createElement('button'); b.className = 'cal-btn-top'; b.id = 'vr-open-btn';
    b.style.cssText = 'background:#16324f;color:#fff;border-color:#16324f;font-weight:600';
    b.textContent = '📣 Vendor Reports'; b.setAttribute('onclick', 'openVendorReports()');
    reportsBtn.parentNode.insertBefore(b, reportsBtn.nextSibling);
  }

  window.openVendorReports = function(id){
    wrap.style.display = 'flex';
    if(id){ cur = byId(id); mode = 'edit'; } else if(!cur) mode = 'list';
    draw();
  };
  window.closeVendorReports = function(){ wrap.style.display = 'none'; };
  function byId(id){ return DB.list.filter(function(L){ return L.id === id; })[0] || null; }
  function head(title, back){
    document.getElementById('vr-head').innerHTML = (back ? '<button class="vr-btn" onclick="vrGo(\'' + back + '\')">← Back</button>' : '')
      + '<h2>' + title + '</h2><button class="vr-btn" style="margin-left:auto" onclick="closeVendorReports()">Close</button>';
  }
  window.vrGo = function(m){ mode = m; if(m === 'list') cur = null; draw(); };

  function draw(){
    if(mode === 'edit' && cur) return drawEdit();
    if(mode === 'preview' && cur) return drawPreview();
    mode = 'list'; drawList();
  }

  function drawList(){
    head('📣 Vendor Reports');
    var active = DB.list.filter(function(L){ return !L.done; }), done = DB.list.filter(function(L){ return L.done; });
    var have = {}; DB.list.forEach(function(L){ have[addrKey(L.addr)] = 1; });
    var listed = data.filter(function(c){ return c.stage === 'listed' && c.a && !have[addrKey(c.a)]; });
    var card = function(L){
      var S = (function(){ var w = weekEnd; weekEnd = today(); var s = stats(L); weekEnd = w; return s; })();
      var last = (L.sent || [])[0];
      return '<div class="vr-card" onclick="openVendorReports(\'' + L.id + '\')"><div><b>' + h(L.addr) + '</b>' + (L.suburb ? ' <span class="vr-sub">' + h(L.suburb) + '</span>' : '')
        + '<div class="vr-sub">' + h(L.vendor || 'Vendor not set') + (S.dom != null ? ' · ' + S.dom + ' days on market' : '') + ' · ' + S.groupsAll + ' groups through so far</div></div>'
        + '<div class="vr-sub" style="margin-left:auto">' + (last ? 'Last report ' + h(short(last.date)) + ' by ' + h(last.how) : 'No report sent yet') + '</div></div>';
    };
    document.getElementById('vr-body').innerHTML =
      '<p class="vr-sub" style="font-size:13px;margin:0 0 12px">A weekly report for each of your listings. Open home numbers come from the Open Home Register; you add online views, enquiries and buyer feedback.</p>'
      + '<button class="vr-btn green" onclick="vrNew()">+ New listing</button>'
      + (listed.length ? '<div class="vr-sec"><h3>Contacts marked Listed <span class="vr-sub" style="font-weight:400">Start a report for one of these</span></h3>'
        + listed.slice(0, 12).map(function(c){ return '<div class="vr-row"><div><b>' + h(c.a) + '</b> <span class="vr-sub">' + h(c.suburb || (typeof getSuburb === 'function' ? getSuburb(c) : '')) + ' · ' + h(c.n) + '</span></div><button class="vr-btn" style="margin-left:auto" onclick="vrNew(' + c.id + ')">Start report</button></div>'; }).join('') + '</div>' : '')
      + '<div class="vr-sec"><h3>Your listings</h3>' + (active.length ? active.map(card).join('') : '<div class="vr-sub" style="font-size:13px">No listings yet. Tap <b>+ New listing</b> to start.</div>') + '</div>'
      + (done.length ? '<div class="vr-sec"><h3>Sold or withdrawn</h3>' + done.map(card).join('') + '</div>' : '');
  }

  window.vrNew = function(cid){
    var c = cid != null ? data[cid] : null;
    var L = { id: uid(), addr: c ? c.a : '', suburb: c ? (c.suburb || (typeof getSuburb === 'function' && getSuburb(c) !== 'Other' ? getSuburb(c) : '')) : '',
      vendor: c ? c.n : '', vendorEm: c && c.em && c.em !== '-' ? c.em : '', vendorPh: c ? String(c.ph || '').split('\n').filter(function(x){ return x && x !== '—' && x !== '-'; })[0] || '' : '',
      listedOn: today(), price: '', method: 'Private treaty', weeks: {}, feedback: [], comments: '', next: '', sent: [], contactId: c ? c.id : null, created: Date.now() };
    DB.list.unshift(L); save(); cur = L; weekEnd = today(); mode = 'edit'; draw();
    setTimeout(function(){ var f = document.querySelector('#vr-body [data-f="addr"]'); if(f && !f.value) f.focus(); }, 30);
  };

  function field(label, f, val, type, extra){
    return '<label class="vr-f">' + label + '<input data-f="' + f + '" type="' + (type || 'text') + '" value="' + h(val) + '"' + (extra || '') + '></label>';
  }
  function drawEdit(){
    var L = cur, S = stats(L), w = (L.weeks || {})[weekEnd] || {};
    head(h(L.addr || 'New listing'), 'list');
    var opts = ['Private treaty', 'Auction', 'Offers', 'Expressions of interest'].map(function(m){ return '<option' + (m === L.method ? ' selected' : '') + '>' + m + '</option>'; }).join('');
    var lvOpts = ['High', 'Medium', 'Low', 'Just Looking'];
    var visitorsWk = visitors(L).filter(function(o){ return inWeek(o.date); });
    document.getElementById('vr-body').innerHTML =
      '<div class="vr-sec" style="margin-top:0"><h3>The listing</h3><div class="vr-grid">'
      + field('Address', 'addr', L.addr, 'text', ' placeholder="e.g. 12 Example St"') + field('Suburb', 'suburb', L.suburb)
      + field('Vendor name(s)', 'vendor', L.vendor) + field('Vendor email', 'vendorEm', L.vendorEm, 'email') + field('Vendor mobile', 'vendorPh', L.vendorPh, 'tel')
      + field('Listed on', 'listedOn', L.listedOn, 'date') + field('Price or guide', 'price', L.price, 'text', ' placeholder="e.g. Offers from $650,000"')
      + '<label class="vr-f">Method<select data-f="method">' + opts + '</select></label></div></div>'
      + '<div class="vr-sec"><h3>Week ending <input type="date" id="vr-week" value="' + h(weekEnd) + '" style="font:13px var(--font);padding:4px 8px;border-radius:6px;border:0.5px solid var(--bd2)"> <span class="vr-sub" style="font-weight:400">' + h(short(addDays(weekEnd, -6))) + ' to ' + h(short(weekEnd)) + '</span></h3>'
      + '<div class="vr-grid">'
      + '<label class="vr-f">Online views (all portals)<input data-w="views" inputmode="numeric" value="' + h(w.views || '') + '" placeholder="e.g. 1240"></label>'
      + '<label class="vr-f">Enquiries<input data-w="enq" inputmode="numeric" value="' + h(w.enq || '') + '" placeholder="e.g. 6"></label>'
      + '<label class="vr-f">Private inspections<input data-w="insp" inputmode="numeric" value="' + h(w.insp || '') + '" placeholder="e.g. 2"></label></div>'
      + '<div class="vr-row" style="border-top:0;margin-top:6px"><b>Open homes this week:</b> ' + (S.opens.length ? S.opens.map(function(o){ return h(short(o.date)) + ' (' + o.n + ' group' + (o.n === 1 ? '' : 's') + ')'; }).join(', ') : '<span class="vr-sub">none recorded in the Open Home Register for this address</span>')
      + ' <button class="vr-btn" style="margin-left:auto" onclick="vrOpenRegister()">+ Add open home visitors</button></div>'
      + (window.__buyers ? (function(){ var n = window.__buyers.forProperty(L.addr); return '<div class="vr-row"><b>Buyers for this property:</b> ' + n.all + ' tagged, ' + n.qualified + ' qualified <span class="vr-sub">(for you only, not in the report)</span><button class="vr-btn" style="margin-left:auto" onclick="vrBuyers()">View buyers</button></div>'; })() : '')
      + '</div>'
      + '<div class="vr-sec"><h3>Buyer feedback <span class="vr-sub" style="font-weight:400">The buyer’s name is for you only; the vendor sees the comment and price.</span></h3>'
      + '<div class="vr-grid">'
      + '<label class="vr-f">Date<input type="date" id="vr-fb-date" value="' + h(weekEnd > today() ? today() : weekEnd) + '"></label>'
      + '<label class="vr-f">Buyer (private)<input id="vr-fb-buyer" placeholder="e.g. Sam, 0400 000 000"></label>'
      + '<label class="vr-f">Interest<select id="vr-fb-int">' + lvOpts.map(function(x){ return '<option>' + x + '</option>'; }).join('') + '</select></label>'
      + '<label class="vr-f">Price opinion<input id="vr-fb-price" placeholder="e.g. $650k–$680k"></label></div>'
      + '<div style="display:flex;gap:8px;margin-top:8px;align-items:flex-end"><label class="vr-f" style="flex:1">Comment<input id="vr-fb-comment" placeholder="e.g. Loved the kitchen, worried about the small backyard"></label><button class="vr-btn green" onclick="vrAddFeedback()">+ Add</button></div>'
      + (function(){
        var rows = (L.feedback || []).filter(function(f){ return inWeek(f.date); }).map(function(f){
          return '<div class="vr-row"><span class="vr-sub">' + h(short(f.date)) + '</span><b>' + h(f.interest) + '</b> ' + h(f.comment) + (f.price ? ' <span class="vr-sub">(price: ' + h(f.price) + ')</span>' : '') + (f.buyer ? ' <span class="vr-sub">· ' + h(f.buyer) + '</span>' : '')
            + '<button class="vr-btn del" style="margin-left:auto;padding:3px 9px;font-size:12px" onclick="vrDelFeedback(\'' + f.id + '\')">Delete</button></div>';
        }).concat(visitorsWk.filter(function(o){ return o.note; }).map(function(o){
          return '<div class="vr-row"><span class="vr-sub">' + h(short(o.date)) + '</span><b>' + h(o.interest) + '</b> ' + h(o.note) + ' <span class="vr-sub">· from the open home register</span></div>';
        }));
        return rows.length ? '<div style="margin-top:8px">' + rows.join('') + '</div>' : '<div class="vr-sub" style="margin-top:8px">No feedback this week yet.</div>';
      })()
      + (S.nPrices ? '<div class="vr-note" style="margin-top:8px">Price feedback so far: <b>' + (S.low === S.high ? 'around ' + money(S.low) : money(S.low) + ' to ' + money(S.high)) + '</b> from ' + S.nPrices + ' opinion' + (S.nPrices === 1 ? '' : 's') + '.</div>' : '')
      + '</div>'
      + '<div class="vr-sec"><h3>Your comments</h3><div class="vr-grid" style="grid-template-columns:1fr">'
      + '<label class="vr-f">Comments and recommendation<textarea data-f="comments" placeholder="e.g. Strong interest from young families. Two buyers are waiting on finance approval.">' + h(L.comments) + '</textarea></label>'
      + '<label class="vr-f">Next steps<textarea data-f="next" placeholder="e.g. Open home Saturday 11:00–11:30. Follow up both second-inspection buyers on Monday.">' + h(L.next) + '</textarea></label></div></div>'
      + '<div class="vr-actions"><button class="vr-btn go" onclick="vrGo(\'preview\')">Preview report</button>'
      + '<button class="vr-btn" onclick="vrSend(\'email\')">✉ Email vendor</button>'
      + '<button class="vr-btn" onclick="vrSend(\'sms\')">📱 Text summary</button>'
      + '<button class="vr-btn" onclick="vrSend(\'print\')">🖶 Print or save PDF</button>'
      + '<button class="vr-btn" onclick="vrSend(\'copy\')">📋 Copy for email</button>'
      + '<span style="margin-left:auto"></span>'
      + (L.done ? '<button class="vr-btn" onclick="vrDone(false)">Move back to active</button>' : '<button class="vr-btn" onclick="vrDone(true)">Sold or withdrawn</button>')
      + '<button class="vr-btn del" onclick="vrDelete()">Delete</button></div>'
      + '<div id="vr-msg" class="vr-sub" style="margin-top:8px;min-height:1em"></div>'
      + ((L.sent || []).length ? '<div class="vr-sub" style="margin-top:4px">Sent: ' + L.sent.slice(0, 6).map(function(s){ return h(short(s.date)) + ' by ' + h(s.how); }).join(' · ') + '</div>' : '');

    var body = document.getElementById('vr-body');
    [].forEach.call(body.querySelectorAll('[data-f]'), function(el){
      el.addEventListener('input', function(){ L[el.getAttribute('data-f')] = el.value; save(); if(el.getAttribute('data-f') === 'addr') document.querySelector('#vr-head h2').textContent = el.value || 'New listing'; });
      el.addEventListener('change', function(){ if(['addr', 'listedOn'].indexOf(el.getAttribute('data-f')) >= 0) drawEdit(); });
    });
    [].forEach.call(body.querySelectorAll('[data-w]'), function(el){
      el.addEventListener('input', function(){ var wk = week(L); wk[el.getAttribute('data-w')] = el.value.replace(/[^0-9]/g, ''); save(); });
    });
    document.getElementById('vr-week').addEventListener('change', function(e){ if(parseIso(e.target.value)){ weekEnd = e.target.value; drawEdit(); } });
  }

  window.vrAddFeedback = function(){
    var g = function(id){ return document.getElementById(id).value.trim(); };
    var comment = g('vr-fb-comment'), price = g('vr-fb-price');
    if(!comment && !price){ document.getElementById('vr-fb-comment').focus(); return; }
    (cur.feedback = cur.feedback || []).unshift({ id: uid(), date: g('vr-fb-date') || today(), buyer: g('vr-fb-buyer'), interest: g('vr-fb-int'), price: price, comment: comment });
    save(); drawEdit();
  };
  window.vrDelFeedback = function(id){ cur.feedback = (cur.feedback || []).filter(function(f){ return f.id !== id; }); save(); drawEdit(); };
  window.vrDone = function(v){ cur.done = v; save(); mode = 'list'; cur = null; draw(); };
  window.vrDelete = function(){
    if(!confirm('Delete the report for ' + (cur.addr || 'this listing') + '? Its weekly figures and feedback will be removed. The open home register is not changed.')) return;
    DB.list = DB.list.filter(function(L){ return L !== cur; }); save(); mode = 'list'; cur = null; draw();
  };
  window.vrBuyers = function(){ if(typeof openBuyers === 'function') openBuyers({ prop: cur.addr, tab: 'all' }); };
  window.vrOpenRegister = function(){
    window.closeVendorReports();
    try { openExtra(); setExtraTab('openhouse', [].filter.call(document.querySelectorAll('#extra-wrap .feat-tab'), function(b){ return /Open Home/.test(b.textContent); })[0]); } catch (e) {}
    var p = document.getElementById('oh-prop'); if(p) p.value = cur.addr || '';
    var d = document.getElementById('oh-date'); if(d) d.value = today();
    var n = document.getElementById('oh-name'); if(n) n.focus();
  };
  // back from the register: the report shows the new visitors
  var _closeExtra = window.closeExtra;
  if(_closeExtra) window.closeExtra = function(){ var r = _closeExtra.apply(this, arguments); if(cur && mode === 'edit' && wrap.style.display === 'none' && document.getElementById('oh-prop') && sameAddr(document.getElementById('oh-prop').value, cur.addr)) window.openVendorReports(cur.id); return r; };

  function drawPreview(){
    head('Report preview', 'edit');
    document.getElementById('vr-body').innerHTML = '<div class="vr-actions" style="margin:0 0 14px;padding:0;border:0">'
      + '<button class="vr-btn" onclick="vrSend(\'email\')">✉ Email vendor</button><button class="vr-btn" onclick="vrSend(\'sms\')">📱 Text summary</button>'
      + '<button class="vr-btn" onclick="vrSend(\'print\')">🖶 Print or save PDF</button><button class="vr-btn" onclick="vrSend(\'copy\')">📋 Copy for email</button></div>'
      + '<div id="vr-msg" class="vr-sub" style="margin-bottom:8px;min-height:1em"></div>'
      + '<div style="background:#fff;border-radius:10px;padding:12px">' + reportHTML(cur) + '</div>';
  }

  function msg(t){ var m = document.getElementById('vr-msg'); if(m) m.textContent = t; }
  function sent(how){ (cur.sent = cur.sent || []).unshift({ date: today(), how: how, week: weekEnd }); save(); }
  window.vrSend = function(how){
    var L = cur; if(!L) return;
    if(!L.addr){ msg('Add the address first.'); return; }
    var subj = 'Campaign report: ' + L.addr + ' – week ending ' + short(weekEnd);
    if(how === 'email'){
      var body = reportText(L);
      if(typeof showMailChooser === 'function') showMailChooser(L.vendorEm || '', subj, body);
      else location.href = 'mailto:' + encodeURIComponent(L.vendorEm || '') + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body);
      sent('email'); msg('Your email opened with the report filled in. Tip: “Copy for email” copies the branded version to paste in instead.');
    } else if(how === 'sms'){
      var ph = String(L.vendorPh || '').replace(/[^0-9+]/g, '');
      if(!ph){ msg('Add the vendor’s mobile first.'); return; }
      location.href = 'sms:' + ph + '?&body=' + encodeURIComponent(smsText(L));
      sent('text');
    } else if(how === 'print'){
      var w = window.open('', '_blank');
      if(!w){ msg('Your browser blocked the print window. Allow pop-ups for this site and try again.'); return; }
      w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + h(subj) + '</title><style>@page{margin:14mm}body{margin:0;padding:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>' + reportHTML(L) + '</body></html>');
      w.document.close(); setTimeout(function(){ try { w.focus(); w.print(); } catch (e) {} }, 300);
      sent('print');
    } else if(how === 'copy'){
      var html = reportHTML(L), text = reportText(L);
      var done = function(){ msg('Copied. Paste it into a new email to ' + (L.vendor || 'the vendor') + '.'); sent('email (copied)'); };
      try {
        navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]).then(done, function(){
          navigator.clipboard.writeText(text).then(done, function(){ msg('Couldn’t copy here. Use Print or save PDF instead.'); });
        });
      } catch (e) { msg('Couldn’t copy here. Use Print or save PDF instead.'); }
    }
  };

  // for tests and the AI assistant
  window.__vendorReports = { stats: function(L, we){ var o = weekEnd; weekEnd = we || weekEnd; var s = stats(L); weekEnd = o; return s; }, prices: prices, sameAddr: sameAddr, db: function(){ return DB; } };
})();
