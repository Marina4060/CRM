/* ══ BUYERS: who is ready to buy, and for which property ══
   Replaces the old Buyer Register window; works on the same buyer list
   (crm_buyers_v1), so everything else that reads buyers keeps working.

   Each buyer is checked against what makes a buyer qualified: contact
   details, a budget, finance (pre-approved or cash), buying within three
   months, and not needing to sell first. Every note added is read for those
   facts ("pre-approved", "need to sell first", "budget $750k", an address)
   and the buyer is evaluated again. Buyers can be tagged to properties.
   Built in by tools/add_addons.py. */
(function(){
  if(typeof buyers === 'undefined' || typeof saveBuyers !== 'function') return;

  var FIN = ['', 'Pre-approved', 'Cash buyer', 'Seeing a broker', 'Not started'];
  var TIME = ['', 'Ready now', 'Within 3 months', '3–6 months', '6+ months or just looking'];
  var SELL = ['', 'Nothing to sell', 'Sold or under contract', 'Listed for sale', 'Needs to sell, not listed'];
  var TYPES = ['Any', 'House', 'Unit or apartment', 'Townhouse', 'Land', 'Acreage'];
  var STATUS = ['Active', 'Under Offer', 'Purchased', 'Paused'];
  var tab = 'qualified', prop = '', q = '', openId = null, flash = {};

  // ── helpers ──
  function h(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function pad(n){ return String(n).padStart(2, '0'); }
  function now(){ return (typeof perthNow === 'function') ? perthNow() : new Date(); }
  function iso(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today(){ return iso(now()); }
  function ddmmyy(s){ var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? m[3] + '/' + m[2] + '/' + m[1].slice(2) : ''; }
  function nice(s){ var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''; }
  function digits(p){ return String(p || '').replace(/[^0-9]/g, '').slice(-9); }
  function hasPh(b){ return digits(b.ph).length >= 8; }
  function hasEm(b){ return /\S+@\S+\.\S+/.test(b.em || ''); }
  function money(n){ return '$' + Math.round(n).toLocaleString('en-AU'); }
  function budgetNum(v){
    var s = String(v || '').toLowerCase().replace(/[, $]/g, ''); var m = /(\d+(?:\.\d+)?)(k|m)?/.exec(s); if(!m) return 0;
    var n = parseFloat(m[1]); if(m[2] === 'm') n *= 1e6; else if(m[2] === 'k') n *= 1e3; else if(n < 10) n *= 1e6; else if(n < 10000) n *= 1e3;
    return n;
  }
  var ST = { street: 'st', road: 'rd', avenue: 'ave', drive: 'dr', court: 'ct', place: 'pl', crescent: 'cres', lane: 'ln', parade: 'pde', terrace: 'tce', close: 'cl', boulevard: 'blvd', circuit: 'cct', grove: 'gr', highway: 'hwy', way: 'way' };
  function addrKey(a){ return String(a || '').toLowerCase().split(',')[0].replace(/[^a-z0-9\/ ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').map(function(w){ return ST[w] || w; }).join(' '); }
  function sameAddr(a, b){ var x = addrKey(a), y = addrKey(b); return !!x && !!y && (x === y || x.indexOf(y + ' ') === 0 || y.indexOf(x + ' ') === 0); }

  // every buyer gets an id and the newer fields; older notes stay as they were
  function tidy(b){
    if(!b.id) b.id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if(!Array.isArray(b.tags)) b.tags = b.property && b.property !== 'General enquiries' ? [b.property] : [];
    if(!Array.isArray(b.log)) b.log = [];
    b.status = b.status || 'Active'; b.type = b.type || 'Any'; b.beds = b.beds || 'Any';
    return b;
  }
  buyers.forEach(tidy);
  function byId(id){ return buyers.filter(function(b){ return b.id === id; })[0]; }
  function save(){ buyers.forEach(function(b){ b.property = b.tags[0] || ''; }); saveBuyers(); }

  // ── the properties a buyer can be tagged to ──
  function properties(){
    buyers.forEach(tidy);   // buyers can also be added elsewhere in the CRM, without the newer fields
    var out = [], seen = {};
    function add(a, src){ a = String(a || '').trim(); var k = addrKey(a); if(!k || seen[k]) return; seen[k] = 1; out.push({ a: a, src: src }); }
    data.forEach(function(c){ if(c.stage === 'listed' && c.a) add(c.a, 'listed'); });
    try { (window.__vendorReports ? window.__vendorReports.db().list : []).forEach(function(L){ if(!L.done) add(L.addr, 'report'); }); } catch (e) {}
    (typeof openHomes !== 'undefined' ? openHomes : []).forEach(function(o){ add(o.prop, 'open home'); });
    buyers.forEach(function(b){ b.tags.forEach(function(t){ add(t, 'tag'); }); });
    return out;
  }

  // ── reading a note for the facts that qualify a buyer ──
  function learn(b, text){
    var t = ' ' + String(text || '').toLowerCase() + ' ', got = [];
    function set(f, v, label){ if(b[f] !== v){ b[f] = v; got.push(label + ': ' + v); } }
    if(/pre-?approv|finance (is )?approved|approval in place|unconditional approval|got (their|his|her|the) approval/.test(t)) set('finance', 'Pre-approved', 'Finance');
    else if(/cash buyer|paying cash|no finance (needed|required)|\bcash\b.*\b(purchase|buy)/.test(t)) set('finance', 'Cash buyer', 'Finance');
    else if(/broker|bank appointment|applying for (a )?(loan|finance)|getting (pre-?)?approval|seeing the bank/.test(t)) set('finance', 'Seeing a broker', 'Finance');
    else if(/no finance yet|haven'?t (got|spoken to) (a )?(broker|bank|finance)|not (yet )?approved/.test(t)) set('finance', 'Not started', 'Finance');
    if(/(house|home|place|property) (is |has )?(sold|under contract|unconditional)|already sold|settled (their|our|his|her) (house|home)/.test(t)) set('sellFirst', 'Sold or under contract', 'Selling');
    else if(/(house|home|place|property) (is )?(listed|on the market|for sale)|currently selling/.test(t)) set('sellFirst', 'Listed for sale', 'Selling');
    else if(/need(s)? to sell|selling first|sell (their|our|my|his|her) (home|house|place) first|subject to (the )?sale/.test(t)) set('sellFirst', 'Needs to sell, not listed', 'Selling');
    else if(/first home buyer|nothing to sell|renting|investor/.test(t)) set('sellFirst', 'Nothing to sell', 'Selling');
    if(/ready (to buy|now)|asap|urgent|straight away|this month|ready to go/.test(t)) set('timeframe', 'Ready now', 'Timeframe');
    else if(/(next|within|in) (1|2|3|one|two|three|a couple of) (months?|weeks)|before christmas|this quarter/.test(t)) set('timeframe', 'Within 3 months', 'Timeframe');
    else if(/(next|within|in) (4|5|6|four|five|six) months/.test(t)) set('timeframe', '3–6 months', 'Timeframe');
    else if(/just looking|no rush|not in a hurry|next year|(12|twelve) months|6\+? months/.test(t)) set('timeframe', '6+ months or just looking', 'Timeframe');
    var bm = /(budget|up to|max(imum)?|spend|around|approved (for|to))\s*(is|of|about|around)?\s*\$?\s*(\d[\d,.]*\s*(k|m|mil|million)?)\b/.exec(t);
    if(bm){ var n = budgetNum(bm[5].replace(/mil(lion)?/, 'm')); if(n >= 100000 && String(Math.round(n)) !== String(budgetNum(b.budget) || '')){ b.budget = String(Math.round(n)); got.push('Budget: ' + money(n)); } }
    var bd = /(\d)\s*(\+\s*)?(bed|br\b|bedroom)/.exec(t); if(bd && b.beds !== (bd[1] >= 5 ? '5+' : bd[1])){ b.beds = bd[1] >= 5 ? '5+' : bd[1]; got.push('Beds: ' + b.beds); }
    var em = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(text || ''); if(em && !hasEm(b)){ b.em = em[0]; got.push('Email: ' + em[0]); }
    var ph = /(\+?61\s?|0)4[\d\s]{8,11}/.exec(text || ''); if(ph && !hasPh(b)){ b.ph = ph[0].trim(); got.push('Mobile: ' + b.ph); }
    properties().forEach(function(p){
      var k = addrKey(p.a); if(k && t.indexOf(k) >= 0 && !b.tags.some(function(x){ return sameAddr(x, p.a); })){ b.tags.push(p.a); got.push('Tagged: ' + p.a); }
    });
    if(/make an offer|put in an offer|offer of|second inspection|2nd inspection|wants to (view|inspect)|very keen|loved it/.test(t) && !b.keen){ b.keen = true; got.push('Keen buyer'); }
    if(/(bought|purchased) (elsewhere|another|a place)|no longer looking|not interested/.test(t) && b.status === 'Active'){ b.status = /bought|purchased/.test(t) ? 'Purchased' : 'Paused'; got.push('Status: ' + b.status); }
    return got;
  }

  // ── is this buyer qualified? ──
  function evaluate(b){
    tidy(b);
    var c = [], score = 0;
    var contact = hasPh(b) || hasEm(b), budget = budgetNum(b.budget) > 0;
    var finOk = b.finance === 'Pre-approved' || b.finance === 'Cash buyer', finPart = b.finance === 'Seeing a broker';
    var timeOk = b.timeframe === 'Ready now' || b.timeframe === 'Within 3 months', timePart = b.timeframe === '3–6 months';
    var sellOk = b.sellFirst === 'Nothing to sell' || b.sellFirst === 'Sold or under contract', sellPart = b.sellFirst === 'Listed for sale', sellBad = b.sellFirst === 'Needs to sell, not listed';
    var last = (b.log[0] && b.log[0].d) || '', recent = last && (now() - new Date(last)) / 864e5 <= 30;
    c.push({ ok: contact, t: contact ? 'Contact details' : 'No phone or email' }); if(contact) score += 15;
    c.push({ ok: budget, t: budget ? 'Budget ' + money(budgetNum(b.budget)) : 'Budget not known' }); if(budget) score += 15;
    c.push({ ok: finOk, part: finPart, t: finOk ? b.finance : finPart ? 'Seeing a broker' : b.finance === 'Not started' ? 'No finance yet' : 'Finance not known' }); score += finOk ? 30 : finPart ? 12 : 0;
    c.push({ ok: timeOk, part: timePart, t: timeOk ? b.timeframe : b.timeframe ? 'Buying in ' + b.timeframe.replace('6+ months or just looking', '6+ months') : 'Timeframe not known' }); score += timeOk ? 20 : timePart ? 8 : 0;
    c.push({ ok: sellOk, part: sellPart, t: sellOk ? b.sellFirst : sellPart ? 'Own home listed' : sellBad ? 'Needs to sell first' : 'Selling not known' }); score += sellOk ? 10 : sellPart ? 5 : 0;
    if(recent){ score += 10; c.push({ ok: true, t: 'Spoke ' + nice(last) }); }
    if(b.keen) c.push({ ok: true, t: 'Keen' });
    var qualified = contact && budget && finOk && timeOk && !sellBad;
    return { score: Math.min(100, score), qualified: qualified, checks: c, active: b.status === 'Active' || b.status === 'Under Offer' };
  }

  function addNote(b, text){
    text = String(text || '').trim(); if(!text) return [];
    var got = learn(b, text);
    b.log.unshift({ d: today(), t: text, got: got });
    b.note = ddmmyy(today()) + ': ' + text + (b.note ? '\n' + b.note : '');
    b.lastContact = ddmmyy(today());
    return got;
  }

  // ── open home visitors who aren't buyers yet ──
  function visitorsNotBuyers(){
    var out = [], seen = {};
    (typeof openHomes !== 'undefined' ? openHomes : []).forEach(function(o, i){
      if(!o.name) return;
      var k = digits(o.ph) || o.name.toLowerCase().trim(); if(seen[k]) return; seen[k] = 1;
      var known = buyers.some(function(b){ return (digits(o.ph) && digits(b.ph) === digits(o.ph)) || (b.name || '').toLowerCase().trim() === o.name.toLowerCase().trim(); });
      if(!known) out.push({ o: o, i: i });
    });
    return out;
  }
  function addVisitor(o){
    var b = tidy({ name: o.name, ph: o.ph || '', em: o.em || '', type: 'Any', beds: 'Any', budget: '', status: 'Active', note: '', tags: o.prop ? [o.prop] : [], log: [] });
    buyers.push(b);
    addNote(b, 'Open home at ' + (o.prop || 'a property') + (o.date ? ' on ' + nice(o.date) : '') + ': ' + (o.interest || '') + ' interest.' + (o.note ? ' ' + o.note : ''));
    if(/high/i.test(o.interest || '')) b.keen = true;
    return b;
  }

  // ── the window ──
  var css = document.createElement('style');
  css.textContent = ''
    + '#by-wrap{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:600;display:none;align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px 10px}'
    + '#by-box{background:var(--bg1);border-radius:14px;width:980px;max-width:100%;box-shadow:0 12px 40px rgba(15,23,42,.25);margin:auto 0}'
    + '#by-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--bd3);flex-wrap:wrap}'
    + '#by-head h2{font-size:17px;margin:0}'
    + '#by-body{padding:14px 18px 18px}'
    + '.by-btn{padding:6px 12px;border-radius:8px;border:1px solid var(--bd2);background:var(--bg1);font:500 13px var(--font);cursor:pointer;color:var(--t1);white-space:nowrap}'
    + '.by-btn.go{background:var(--crm-accent,#1F3A5F);color:#fff;border-color:var(--crm-accent,#1F3A5F)}'
    + '.by-btn.del{color:#9B2C2C;border-color:#E8C4C4}'
    + '.by-tabs{display:flex;gap:4px;background:var(--bg2);padding:4px;border-radius:10px;flex-wrap:wrap}'
    + '.by-tab{border:0;background:transparent;padding:6px 12px;border-radius:7px;font:500 13px var(--font);color:var(--t2);cursor:pointer}'
    + '.by-tab.on{background:var(--bg1);color:var(--t1);box-shadow:0 1px 2px rgba(0,0,0,.08)}'
    + '.by-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}'
    + '.by-tools select,.by-tools input,.by-f input,.by-f select,.by-f textarea,.by-note textarea{padding:7px 9px;border-radius:8px;border:1px solid var(--bd2);background:var(--bg1);color:var(--t1);font:13px var(--font)}'
    + '.by-card{border:1px solid var(--bd3);border-radius:12px;padding:12px 14px;margin-bottom:10px;background:var(--bg1)}'
    + '.by-top{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap}'
    + '.by-name{font-weight:600;font-size:15px}'
    + '.by-sub{color:var(--t2);font-size:12px}'
    + '.by-score{min-width:44px;text-align:center;border-radius:10px;padding:4px 6px;font-weight:700;font-size:15px;line-height:1.1}'
    + '.by-score small{display:block;font-size:10px;font-weight:500;opacity:.8}'
    + '.by-q{background:#E7F3EC;color:#1E6B45}.by-nq{background:#F6EFE3;color:#8A5A12}.by-arch{background:#EEF0F3;color:#5B6573}'
    + '.by-checks{display:flex;flex-wrap:wrap;gap:4px 6px;margin-top:8px}'
    + '.by-chk{font-size:12px;padding:2px 8px;border-radius:20px;border:1px solid var(--bd3);color:var(--t2);background:var(--bg2)}'
    + '.by-chk.ok{color:#1E6B45;background:#EEF7F1;border-color:#CFE5D8}.by-chk.part{color:#8A5A12;background:#FBF5EA;border-color:#EBD9B5}.by-chk.no{color:#9B2C2C;background:#FBF0F0;border-color:#EBCBCB}'
    + '.by-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;align-items:center}'
    + '.by-tag{font-size:12px;padding:2px 4px 2px 9px;border-radius:20px;background:#EAF0F7;color:#1F3A5F;display:inline-flex;align-items:center;gap:2px}'
    + '.by-tag button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:13px;padding:0 4px}'
    + '.by-note{display:flex;gap:8px;margin-top:10px;align-items:flex-end}'
    + '.by-note textarea{flex:1;min-height:38px;resize:vertical}'
    + '.by-got{margin-top:6px;font-size:12px;color:#1E6B45;background:#EEF7F1;border-radius:8px;padding:5px 9px}'
    + '.by-log{margin-top:8px;border-top:1px solid var(--bd3);padding-top:6px}'
    + '.by-log div{font-size:13px;padding:4px 0;border-bottom:1px dashed var(--bd3)}'
    + '.by-log span{color:var(--t3);font-size:12px;margin-right:6px}'
    + '.by-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px;margin-top:10px}'
    + '.by-f{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--t2)}'
    + '.by-sec{margin:14px 0 6px;font-size:13px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:.04em}'
    + '.by-sugg{background:#F5F8FC;border:1px solid #D9E3EF;border-radius:12px;padding:10px 14px;margin-bottom:12px}'
    + '.by-row{display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--bd3);font-size:13px;flex-wrap:wrap}'
    + '@media (max-width:600px){#by-body{padding:12px}#by-head{padding:12px}.by-grid{grid-template-columns:1fr 1fr}.by-note{flex-direction:column;align-items:stretch}}';
  document.head.appendChild(css);
  var wrap = document.createElement('div'); wrap.id = 'by-wrap';
  wrap.innerHTML = '<div id="by-box"><div id="by-head"></div><div id="by-body"></div></div>';
  wrap.addEventListener('click', function(e){ if(e.target === wrap) window.closeBuyers(); });
  document.body.appendChild(wrap);

  window.openBuyers = function(opts){
    opts = opts || {};
    if(opts.prop != null) prop = opts.prop;
    if(opts.tab) tab = opts.tab;
    wrap.style.display = 'flex'; draw();
  };
  window.closeBuyers = function(){ wrap.style.display = 'none'; var old = document.getElementById('buyers-wrap'); if(old) old.style.display = 'none'; };

  function list(){
    buyers.forEach(tidy);
    return buyers.map(function(b){ return { b: b, e: evaluate(b) }; }).filter(function(x){
      if(prop && !x.b.tags.some(function(t){ return sameAddr(t, prop); })) return false;
      if(q){ var hay = (x.b.name + ' ' + x.b.ph + ' ' + x.b.em + ' ' + x.b.tags.join(' ') + ' ' + (x.b.note || '')).toLowerCase(); if(hay.indexOf(q) < 0) return false; }
      return true;
    }).sort(function(a, b){ return b.e.score - a.e.score || (a.b.name || '').localeCompare(b.b.name || ''); });
  }

  function draw(){
    var all = list();
    var groups = { qualified: all.filter(function(x){ return x.e.active && x.e.qualified; }), not: all.filter(function(x){ return x.e.active && !x.e.qualified; }), done: all.filter(function(x){ return !x.e.active; }) };
    var shown = tab === 'qualified' ? groups.qualified : tab === 'not' ? groups.not : tab === 'done' ? groups.done : all;
    var props = properties();
    document.getElementById('by-head').innerHTML = '<h2>👥 Buyers</h2>'
      + '<span class="by-sub">' + groups.qualified.length + ' qualified · ' + groups.not.length + ' not yet qualified</span>'
      + '<button class="by-btn" style="margin-left:auto" onclick="closeBuyers()">Close</button>';
    var sugg = visitorsNotBuyers();
    document.getElementById('by-body').innerHTML =
      '<div class="by-tabs">'
      + [['qualified', 'Qualified', groups.qualified.length], ['not', 'Not qualified', groups.not.length], ['all', 'All', all.length], ['done', 'Purchased or paused', groups.done.length]].map(function(t){
        return '<button class="by-tab' + (tab === t[0] ? ' on' : '') + '" onclick="byTab(\'' + t[0] + '\')">' + t[1] + ' <b>' + t[2] + '</b></button>';
      }).join('') + '</div>'
      + '<div class="by-tools"><select id="by-prop" aria-label="Property"><option value="">All properties</option>' + props.map(function(p){
        var n = buyers.filter(function(b){ return b.tags.some(function(t){ return sameAddr(t, p.a); }); }).length;
        return '<option value="' + h(p.a) + '"' + (prop && sameAddr(prop, p.a) ? ' selected' : '') + '>' + h(p.a) + (n ? ' (' + n + ')' : '') + '</option>';
      }).join('') + '</select>'
      + '<input id="by-q" type="search" placeholder="Search buyers" value="' + h(q) + '" style="flex:1;min-width:140px">'
      + '<button class="by-btn go" onclick="byNew()">+ Add buyer</button></div>'
      + '<div id="by-new"></div>'
      + (sugg.length ? '<div class="by-sugg"><b>' + sugg.length + ' open home visitor' + (sugg.length === 1 ? '' : 's') + ' not in your buyers yet</b> <button class="by-btn" style="margin-left:6px" onclick="byAddVisitors()">Add all</button>'
        + sugg.slice(0, 6).map(function(s){ return '<div class="by-row"><b>' + h(s.o.name) + '</b><span class="by-sub">' + h(s.o.prop || '') + (s.o.interest ? ' · ' + h(s.o.interest) + ' interest' : '') + '</span><button class="by-btn" style="margin-left:auto" onclick="byAddVisitor(' + s.i + ')">Add</button></div>'; }).join('') + '</div>' : '')
      + (tab === 'not' && shown.length ? '<div class="by-sub" style="margin-bottom:8px">A buyer is qualified with contact details, a budget, finance pre-approved (or cash), buying within 3 months, and no home to sell first. Add notes as you learn more and they move across by themselves.</div>' : '')
      + (shown.length ? shown.map(card).join('') : '<div class="by-sub" style="padding:18px 0;font-size:13px">' + (buyers.length ? 'No buyers here' + (prop ? ' for ' + h(prop) : '') + '.' : 'No buyers yet. Tap <b>+ Add buyer</b>, or add open home visitors from the Open Home Register.') + '</div>');
    var ps = document.getElementById('by-prop'); ps.onchange = function(){ prop = ps.value; draw(); };
    var qs = document.getElementById('by-q'); qs.oninput = function(){ q = qs.value.toLowerCase().trim(); var pos = qs.selectionStart; draw(); var n = document.getElementById('by-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
    [].forEach.call(document.querySelectorAll('#by-body [data-bf]'), function(el){
      el.onchange = function(){ var b = byId(el.getAttribute('data-id')); if(!b) return; b[el.getAttribute('data-bf')] = el.value; save(); draw(); };
    });
  }

  function card(x){
    var b = x.b, e = x.e, open = openId === b.id;
    var cls = !e.active ? 'by-arch' : e.qualified ? 'by-q' : 'by-nq';
    var ph = String(b.ph || '').split('\n')[0];
    var contact = [ph ? '<a href="tel:' + h(ph.replace(/[^0-9+]/g, '')) + '">' + h(ph) + '</a>' : '', hasEm(b) ? h(b.em) : ''].filter(Boolean).join(' · ');
    var wants = [budgetNum(b.budget) ? 'up to ' + money(budgetNum(b.budget)) : '', b.beds && b.beds !== 'Any' ? b.beds + ' bed' : '', b.type && b.type !== 'Any' ? b.type.toLowerCase() : ''].filter(Boolean).join(', ');
    var props = properties().filter(function(p){ return !b.tags.some(function(t){ return sameAddr(t, p.a); }); });
    var f = flash[b.id]; delete flash[b.id];
    var opt = function(arr, v){ return arr.map(function(o){ return '<option' + (o === (v || '') ? ' selected' : '') + ' value="' + h(o) + '">' + (o || 'Not known') + '</option>'; }).join(''); };
    return '<div class="by-card" id="by-' + b.id + '"><div class="by-top">'
      + '<div class="by-score ' + cls + '">' + e.score + '<small>' + (!e.active ? h(b.status) : e.qualified ? 'Qualified' : 'Not yet') + '</small></div>'
      + '<div style="flex:1;min-width:180px"><div class="by-name">' + (b.keen ? '🔥 ' : '') + h(b.name) + '</div>'
      + '<div class="by-sub">' + (contact || 'No phone or email') + (wants ? ' · ' + h(wants) : '') + '</div></div>'
      + '<button class="by-btn" onclick="byOpen(\'' + b.id + '\')">' + (open ? 'Hide details' : 'Details') + '</button></div>'
      + '<div class="by-checks">' + e.checks.map(function(c){ return '<span class="by-chk ' + (c.ok ? 'ok' : c.part ? 'part' : 'no') + '">' + (c.ok ? '✓ ' : c.part ? '◐ ' : '✗ ') + h(c.t) + '</span>'; }).join('') + '</div>'
      + '<div class="by-tags">' + b.tags.map(function(t, i){ return '<span class="by-tag">🏠 ' + h(t) + '<button title="Remove tag" onclick="byUntag(\'' + b.id + '\',' + i + ')">×</button></span>'; }).join('')
      + '<select onchange="byTag(\'' + b.id + '\',this.value)" style="font:12px var(--font);padding:3px 6px;border-radius:20px;border:1px dashed var(--bd2);background:var(--bg1);color:var(--t2)"><option value="">+ Tag property</option>'
      + props.map(function(p){ return '<option value="' + h(p.a) + '">' + h(p.a) + '</option>'; }).join('') + '<option value="__other">Another address…</option></select></div>'
      + '<div class="by-note"><textarea id="by-n-' + b.id + '" placeholder="Add a note: e.g. Pre-approved to $750k, needs to sell first, wants 4 bed"></textarea><button class="by-btn go" onclick="byNote(\'' + b.id + '\')">Add note</button></div>'
      + (f ? '<div class="by-got">' + (f.length ? 'Updated from this note: ' + h(f.join(' · ')) : 'Note saved.') + '</div>' : '')
      + (b.log[0] && !open ? '<div class="by-log"><div><span>' + h(nice(b.log[0].d)) + '</span>' + h(b.log[0].t) + '</div></div>' : '')
      + (open ? '<div class="by-grid">'
        + '<label class="by-f">Name<input data-bf="name" data-id="' + b.id + '" value="' + h(b.name) + '"></label>'
        + '<label class="by-f">Mobile<input data-bf="ph" data-id="' + b.id + '" type="tel" value="' + h(b.ph) + '"></label>'
        + '<label class="by-f">Email<input data-bf="em" data-id="' + b.id + '" type="email" value="' + h(b.em) + '"></label>'
        + '<label class="by-f">Budget ($)<input data-bf="budget" data-id="' + b.id + '" inputmode="numeric" value="' + h(b.budget) + '"></label>'
        + '<label class="by-f">Finance<select data-bf="finance" data-id="' + b.id + '">' + opt(FIN, b.finance) + '</select></label>'
        + '<label class="by-f">Buying<select data-bf="timeframe" data-id="' + b.id + '">' + opt(TIME, b.timeframe) + '</select></label>'
        + '<label class="by-f">Home to sell<select data-bf="sellFirst" data-id="' + b.id + '">' + opt(SELL, b.sellFirst) + '</select></label>'
        + '<label class="by-f">Property type<select data-bf="type" data-id="' + b.id + '">' + opt(TYPES, b.type) + '</select></label>'
        + '<label class="by-f">Beds<select data-bf="beds" data-id="' + b.id + '">' + opt(['Any', '1', '2', '3', '4', '5+'], b.beds) + '</select></label>'
        + '<label class="by-f">Status<select data-bf="status" data-id="' + b.id + '">' + opt(STATUS, b.status) + '</select></label></div>'
        + '<div class="by-log">' + (b.log.length ? b.log.map(function(l){ return '<div><span>' + h(nice(l.d)) + '</span>' + h(l.t) + '</div>'; }).join('') : '')
        + (!b.log.length && b.note ? '<div><span>Earlier</span>' + h(b.note) + '</div>' : '') + (!b.log.length && !b.note ? '<div class="by-sub">No notes yet.</div>' : '') + '</div>'
        + '<div style="margin-top:10px;text-align:right"><button class="by-btn del" onclick="byDelete(\'' + b.id + '\')">Delete buyer</button></div>' : '')
      + '</div>';
  }

  window.byTab = function(t){ tab = t; draw(); };
  window.byOpen = function(id){ openId = openId === id ? null : id; draw(); var el = document.getElementById('by-' + id); if(el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); };
  window.byNote = function(id){
    var b = byId(id), box = document.getElementById('by-n-' + id); if(!b || !box || !box.value.trim()) return;
    var was = evaluate(b).qualified;
    flash[id] = addNote(b, box.value); save();
    var is = evaluate(b).qualified;
    if(is !== was && evaluate(b).active) flash[id].push(is ? 'Now qualified' : 'No longer qualified');
    if(is !== was && (tab === 'qualified' || tab === 'not')) tab = is ? 'qualified' : 'not';
    draw();
    var el = document.getElementById('by-' + id); if(el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  };
  window.byTag = function(id, a){
    var b = byId(id); if(!b || !a) return;
    if(a === '__other'){ a = prompt('Address to tag this buyer to:', ''); if(!a) { draw(); return; } }
    if(!b.tags.some(function(t){ return sameAddr(t, a); })) b.tags.push(a.trim());
    save(); draw();
  };
  window.byUntag = function(id, i){ var b = byId(id); if(!b) return; b.tags.splice(i, 1); save(); draw(); };
  window.byDelete = function(id){
    var i = buyers.findIndex(function(b){ return b.id === id; }); if(i < 0) return;
    if(!confirm('Delete ' + (buyers[i].name || 'this buyer') + ' and their notes?')) return;
    deleteBuyer(i); openId = null; draw();
  };
  window.byAddVisitor = function(i){ var o = openHomes[i]; if(!o) return; addVisitor(o); save(); draw(); };
  window.byAddVisitors = function(){ visitorsNotBuyers().forEach(function(s){ addVisitor(s.o); }); save(); draw(); };

  window.byNew = function(){
    var el = document.getElementById('by-new');
    if(el.innerHTML){ el.innerHTML = ''; return; }
    var props = properties();
    el.innerHTML = '<div class="by-card" style="background:var(--bg2)"><div class="by-grid" style="margin-top:0">'
      + '<label class="by-f">Name<input id="byn-name" placeholder="e.g. Sam & Alex Lee"></label>'
      + '<label class="by-f">Mobile<input id="byn-ph" type="tel" placeholder="0400 000 000"></label>'
      + '<label class="by-f">Email<input id="byn-em" type="email" placeholder="name@example.com"></label>'
      + '<label class="by-f">Budget ($)<input id="byn-budget" inputmode="numeric" placeholder="e.g. 750000"></label>'
      + '<label class="by-f">Finance<select id="byn-fin">' + FIN.map(function(o){ return '<option value="' + o + '">' + (o || 'Not known') + '</option>'; }).join('') + '</select></label>'
      + '<label class="by-f">Buying<select id="byn-time">' + TIME.map(function(o){ return '<option value="' + o + '">' + (o || 'Not known') + '</option>'; }).join('') + '</select></label>'
      + '<label class="by-f">Home to sell<select id="byn-sell">' + SELL.map(function(o){ return '<option value="' + o + '">' + (o || 'Not known') + '</option>'; }).join('') + '</select></label>'
      + '<label class="by-f">Property<select id="byn-prop"><option value="">No property yet</option>' + props.map(function(p){ return '<option' + (prop && sameAddr(prop, p.a) ? ' selected' : '') + ' value="' + h(p.a) + '">' + h(p.a) + '</option>'; }).join('') + '</select></label></div>'
      + '<label class="by-f" style="margin-top:8px">First note<textarea id="byn-note" placeholder="What they told you" style="min-height:50px"></textarea></label>'
      + '<div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end"><button class="by-btn" onclick="document.getElementById(\'by-new\').innerHTML=\'\'">Cancel</button><button class="by-btn go" onclick="bySaveNew()">Save buyer</button></div></div>';
    document.getElementById('byn-name').focus();
  };
  window.bySaveNew = function(){
    var g = function(id){ return document.getElementById(id).value.trim(); };
    if(!g('byn-name')){ document.getElementById('byn-name').focus(); return; }
    var b = tidy({ name: g('byn-name'), ph: g('byn-ph'), em: g('byn-em'), budget: String(budgetNum(g('byn-budget')) || ''), finance: g('byn-fin'), timeframe: g('byn-time'), sellFirst: g('byn-sell'),
      type: 'Any', beds: 'Any', status: 'Active', note: '', tags: g('byn-prop') ? [g('byn-prop')] : [], log: [] });
    buyers.push(b);
    if(g('byn-note')) flash[b.id] = addNote(b, g('byn-note'));
    save(); tab = evaluate(b).qualified ? 'qualified' : 'not'; draw();
  };

  // for the vendor report, the map and tests
  window.__buyers = {
    evaluate: evaluate, learn: learn, addNote: function(b, t){ var r = addNote(tidy(b), t); save(); return r; },
    forProperty: function(a){ buyers.forEach(tidy); var l = buyers.filter(function(b){ return b.tags.some(function(t){ return sameAddr(t, a); }); }); return { all: l.length, qualified: l.filter(function(b){ var e = evaluate(b); return e.active && e.qualified; }).length }; }
  };
})();
