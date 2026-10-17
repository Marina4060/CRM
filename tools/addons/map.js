/* ══ MAP VIEW: contacts as pins on a street map, coloured by funnel stage ══
   A third view beside Funnel and Table. It shows the same contacts as the
   board (same search, suburb and street filters).

   Addresses are looked up once with OpenStreetMap's Nominatim service (one a
   second, as its rules require) and remembered in crm_geo_v1, which syncs like
   the rest of the CRM. An address it can't find can be placed by hand.
   Built in by tools/add_addons.py; Leaflet is bundled with it. */
(function(){
  var LL = window.CRM_LEAFLET;
  if(!LL || typeof data === 'undefined' || typeof LANES === 'undefined') return;

  var TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  var GEOCODER = 'https://nominatim.openstreetmap.org/search';
  var GEO_KEY = 'crm_geo_v1';
  var MISS_RETRY_MS = 30 * 864e5;        // try an address that wasn't found again after 30 days
  var GAP_MS = 1100;                     // Nominatim allows one request a second

  var geo = {};
  try { geo = JSON.parse(localStorage.getItem(GEO_KEY) || '{}') || {}; } catch (e) { geo = {}; }
  var saveTimer = null;
  function saveGeo(){ clearTimeout(saveTimer); saveTimer = setTimeout(function(){ try { localStorage.setItem(GEO_KEY, JSON.stringify(geo)); } catch (e) {} }, 400); }

  var STAGE = {}; LANES.forEach(function(l, i){ STAGE[l.key] = { title: l.title, color: l.bar, rank: i }; });
  STAGE.hold = STAGE.hold || { title: 'On hold', color: '#888780', rank: 50 };
  var hidden = {};                       // stage key -> true when switched off in the legend
  var on = false, map = null, layer = null, ring = null, placing = null;
  var queue = [], busy = false, failures = 0, lastBatch = 0;

  function h(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function suburbOf(c){ return c.suburb || (typeof getSuburb === 'function' ? getSuburb(c) : '') || ''; }
  function addrOf(c){ return String(c.a || '').trim(); }
  function keyOf(c){
    var a = addrOf(c); if(!a || a === '-' || a === '—') return '';
    var s = suburbOf(c); if(s === 'Other') s = '';
    return (a + '|' + s).toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function spot(k){ var g = geo[k]; return g && typeof g.la === 'number' ? g : null; }
  function visible(){ try { return getVisible(); } catch (e) { return data.slice(); } }

  // ── the view ──
  var css = document.createElement('style');
  css.textContent = ''
    + '#map-view{display:none;padding:10px 12px 16px}'
    + '#map-view .mv-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px}'
    + '#map-view .mv-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;border:0.5px solid var(--bd2);background:var(--bg1);font-size:12px;cursor:pointer;color:var(--t1)}'
    + '#map-view .mv-chip i{width:10px;height:10px;border-radius:50%;display:inline-block}'
    + '#map-view .mv-chip.off{opacity:.4;text-decoration:line-through}'
    + '#map-view .mv-btn{padding:5px 12px;border-radius:var(--r1);border:0.5px solid var(--bd2);background:var(--bg1);font-size:12px;cursor:pointer;color:var(--t1);font-weight:500}'
    + '#map-view .mv-btn.dark{background:#16324f;color:#fff;border-color:#16324f}'
    + '#map-view .mv-status{font-size:12px;color:var(--t2);margin-left:auto}'
    + '#crm-map{height:calc(100vh - 210px);min-height:380px;border-radius:12px;border:0.5px solid var(--bd2);background:#e8eef0}'
    + '#crm-map.placing{cursor:crosshair}'
    + '#map-view .mv-panel{margin-top:10px;background:var(--bg1);border:0.5px solid var(--bd2);border-radius:12px;padding:12px 14px}'
    + '#map-view .mv-panel h3{font-size:14px;margin-bottom:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
    + '#map-view .mv-row{display:flex;gap:10px;align-items:center;padding:6px 0;border-top:0.5px solid var(--bd3);font-size:13px;flex-wrap:wrap}'
    + '#map-view .mv-row b{font-weight:600}'
    + '#map-view .mv-row .mv-sub{color:var(--t2);font-size:12px}'
    + '#map-view .mv-row .mv-act{margin-left:auto;display:flex;gap:6px}'
    + '.mv-pop{font:13px/1.45 var(--font);min-width:190px}'
    + '.mv-pop .mv-who{padding:6px 0;border-top:0.5px solid #e4e4e0}.mv-pop .mv-who:first-of-type{border-top:0}'
    + '.mv-pop .mv-tag{display:inline-block;font-size:11px;font-weight:600;padding:1px 8px;border-radius:20px;color:#fff;margin-left:4px}'
    + '.mv-pop button{margin:6px 6px 0 0;padding:4px 10px;border-radius:6px;border:0.5px solid rgba(0,0,0,.2);background:#fff;cursor:pointer;font-size:12px}'
    + '.mv-pop button.go{background:#16324f;color:#fff;border-color:#16324f}'
    + 'body.crm-map-on #board,body.crm-map-on #summary,body.crm-map-on #tbl-view{display:none !important}'
    + '@media (max-width:700px){#crm-map{height:calc(100vh - 260px)}#map-view{padding:8px}}';
  document.head.appendChild(css);

  var view = document.createElement('div'); view.id = 'map-view';
  view.innerHTML = '<div class="mv-bar" id="mv-legend"></div>'
    + '<div class="mv-bar"><button class="mv-btn" onclick="crmMapFit()">Fit all</button>'
    + '<button class="mv-btn" id="mv-missing-btn" onclick="crmMapMissing()" style="display:none"></button>'
    + '<span class="mv-status" id="mv-status"></span></div>'
    + '<div id="crm-map"></div><div id="mv-panel"></div>';
  var main = document.querySelector('.crm-main'); if(!main) return;
  main.appendChild(view);

  var tableTab = document.getElementById('vt-table');
  if(tableTab){
    var tab = document.createElement('button'); tab.className = 'vtab'; tab.id = 'vt-map'; tab.textContent = 'Map';
    tab.setAttribute('onclick', 'crmShowMap()');
    tableTab.parentNode.insertBefore(tab, tableTab.nextSibling);
  }

  // switching to Funnel or Table leaves the map
  var _setView = window.setView;
  window.setView = function(v){ hideMap(); return _setView.apply(this, arguments); };
  var _renderCurrent = window.renderCurrent;
  window.renderCurrent = function(){ var r = _renderCurrent.apply(this, arguments); if(on) draw(); return r; };

  function hideMap(){
    if(!on) return; on = false; view.style.display = 'none'; document.body.classList.remove('crm-map-on');
    var t = document.getElementById('vt-map'); if(t) t.classList.remove('on');
    queue = [];
  }

  window.crmShowMap = function(){
    on = true;
    ['summary', 'board', 'tbl-view', 'automation-view'].forEach(function(id){ var el = document.getElementById(id); if(el) el.style.display = 'none'; });
    ['vt-funnel', 'vt-table', 'vt-automation'].forEach(function(id){ var el = document.getElementById(id); if(el) el.classList.remove('on'); });
    var t = document.getElementById('vt-map'); if(t) t.classList.add('on');
    view.style.display = 'block'; document.body.classList.add('crm-map-on');
    if(!map){
      map = LL.map('crm-map', { preferCanvas: true, zoomControl: true }).setView([-31.95, 115.86], 11);
      LL.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIB }).addTo(map);
      layer = LL.layerGroup().addTo(map);
      map.on('click', function(e){ if(placing) placeAt(e.latlng); });
    }
    setTimeout(function(){ map.invalidateSize(); draw(true); }, 30);
  };

  // ── pins ──
  function groups(){
    var by = {}, missing = [], noAddr = 0;
    visible().forEach(function(c){
      if(hidden[c.stage]) return;
      var k = keyOf(c); if(!k){ noAddr++; return; }
      var g = spot(k);
      if(!g){ missing.push(c); return; }
      (by[k] = by[k] || { k: k, g: g, people: [] }).people.push(c);
    });
    return { list: Object.keys(by).map(function(k){ return by[k]; }), missing: missing, noAddr: noAddr };
  }
  function top(people){
    return people.slice().sort(function(a, b){ return (STAGE[a.stage] || { rank: 99 }).rank - (STAGE[b.stage] || { rank: 99 }).rank; })[0];
  }

  function draw(fit){
    if(!map) return;
    layer.clearLayers();
    var G = groups(), pts = [];
    G.list.forEach(function(grp){
      var c = top(grp.people), st = STAGE[c.stage] || { color: '#888780' };
      var m = LL.circleMarker([grp.g.la, grp.g.lo], { radius: grp.people.length > 1 ? 9 : 7, color: '#fff', weight: 1.5, fillColor: st.color, fillOpacity: 0.95 });
      m.bindPopup(function(){ return popup(grp); }, { maxWidth: 280 });
      m.addTo(layer); pts.push([grp.g.la, grp.g.lo]);
    });
    if(ring) ring.addTo(layer);
    legend();
    var mb = document.getElementById('mv-missing-btn');
    var unfound = G.missing.filter(function(c){ var g = geo[keyOf(c)]; return g && g.miss; });
    mb.style.display = unfound.length ? '' : 'none';
    mb.textContent = 'Not on the map (' + unfound.length + ')';
    if(fit && pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 17 });
    lookup(G.missing.filter(function(c){ var g = geo[keyOf(c)]; return !g || (g.miss && Date.now() - g.t > MISS_RETRY_MS); }), !pts.length);
    status();
  }
  window.crmMapFit = function(){ ring = null; draw(true); };

  function popup(grp){
    var html = '<div class="mv-pop"><div style="font-weight:700">' + h(grp.people[0].a) + '</div><div style="color:#666;font-size:12px">' + h(suburbOf(grp.people[0])) + '</div>';
    grp.people.forEach(function(c){
      var st = STAGE[c.stage] || { title: c.stage, color: '#888780' };
      var ph = String(c.ph || '').split('\n').filter(function(x){ return x && x !== '—' && x !== '-'; })[0] || '';
      html += '<div class="mv-who"><b>' + h(c.n) + '</b><span class="mv-tag" style="background:' + st.color + '">' + h(st.title) + '</span>'
        + (ph ? '<div><a href="tel:' + h(ph.replace(/[^0-9+]/g, '')) + '">' + h(ph) + '</a></div>' : '')
        + (c.date ? '<div style="color:#666;font-size:12px">Last contact ' + h(c.date) + '</div>' : '')
        + '<button class="go" onclick="openC(' + c.id + ')">Open card</button></div>';
    });
    html += '<div style="border-top:0.5px solid #e4e4e0;margin-top:4px;padding-top:2px">'
      + '<button onclick="crmMapAround(' + grp.people[0].id + ',300)">Who\'s within 300 m?</button>'
      + '<button onclick="crmMapMove(' + grp.people[0].id + ')">Move pin</button></div></div>';
    return html;
  }

  function legend(){
    var counts = {};
    visible().forEach(function(c){ counts[c.stage] = (counts[c.stage] || 0) + 1; });
    document.getElementById('mv-legend').innerHTML = LANES.filter(function(l){ return counts[l.key]; }).map(function(l){
      return '<span class="mv-chip' + (hidden[l.key] ? ' off' : '') + '" onclick="crmMapToggle(\'' + l.key + '\')" title="Show or hide ' + h(l.title) + '"><i style="background:' + l.bar + '"></i>' + h(l.title) + ' ' + counts[l.key] + '</span>';
    }).join('') || '<span class="mv-status" style="margin-left:0">No contacts to show. Add contacts with + Add Contact or RP Data Import.</span>';
  }
  window.crmMapToggle = function(k){ hidden[k] = !hidden[k]; draw(); };

  // ── looking up addresses ──
  function status(){
    var el = document.getElementById('mv-status'); if(!el) return;
    if(placing){ el.innerHTML = '<b>Tap the map where ' + h(placing.a) + ' is.</b> <button class="mv-btn" onclick="crmMapCancelPlace()">Cancel</button>'; return; }
    if(failures >= 3){ el.textContent = 'Can’t reach the address finder right now. It will try again when you reopen the map.'; return; }
    el.textContent = queue.length ? 'Finding ' + queue.length + ' address' + (queue.length === 1 ? '' : 'es') + ' on the map…' : '';
  }

  function lookup(list, fitWhenDone){
    var seen = {}; queue.forEach(function(c){ seen[keyOf(c)] = 1; });
    list.forEach(function(c){ var k = keyOf(c); if(k && !seen[k]){ seen[k] = 1; queue.push(c); } });
    if(fitWhenDone) lastBatch = 1;
    if(!busy) next();
  }
  function next(){
    if(!on || !queue.length || failures >= 3){ busy = false; status(); return; }
    busy = true;
    var c = queue.shift(), k = keyOf(c), sub = suburbOf(c);
    var q = addrOf(c) + (sub && sub !== 'Other' ? ', ' + sub : '') + ', Australia';
    status();
    fetch(GEOCODER + '?format=jsonv2&limit=1&countrycodes=au&q=' + encodeURIComponent(q), { headers: { 'Accept': 'application/json' } })
      .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(rows){
        failures = 0;
        var r = rows && rows[0];
        geo[k] = r ? { la: +r.lat, lo: +r.lon, t: Date.now() } : { miss: 1, t: Date.now() };
        saveGeo();
        if(on){
          draw(!!(r && lastBatch && !queue.length));
          if(!queue.length) lastBatch = 0;
        }
      })
      .catch(function(){ failures++; queue.unshift(c); })
      .then(function(){ setTimeout(next, GAP_MS); });
  }

  // ── placing a pin by hand ──
  window.crmMapMissing = function(){
    var G = groups();
    var list = G.missing.filter(function(c){ var g = geo[keyOf(c)]; return g && g.miss; });
    var p = document.getElementById('mv-panel');
    p.innerHTML = '<div class="mv-panel"><h3>Not found on the map <span class="mv-sub" style="font-weight:400;color:var(--t2);font-size:12px">Check the address on the card, or place the pin yourself.</span>'
      + '<button class="mv-btn" style="margin-left:auto" onclick="document.getElementById(\'mv-panel\').innerHTML=\'\'">Close</button></h3>'
      + list.map(function(c){
        return '<div class="mv-row"><div><b>' + h(c.a) + '</b> <span class="mv-sub">' + h(suburbOf(c)) + ' · ' + h(c.n) + '</span></div>'
          + '<div class="mv-act"><button class="mv-btn" onclick="openC(' + c.id + ')">Open card</button><button class="mv-btn dark" onclick="crmMapMove(' + c.id + ')">Place on map</button></div></div>';
      }).join('') + '</div>';
  };
  window.crmMapMove = function(id){
    var c = data[id]; if(!c) return;
    placing = c; map.closePopup();
    document.getElementById('crm-map').classList.add('placing');
    status();
  };
  window.crmMapCancelPlace = function(){ placing = null; document.getElementById('crm-map').classList.remove('placing'); status(); };
  function placeAt(ll){
    var k = keyOf(placing); placing = null;
    document.getElementById('crm-map').classList.remove('placing');
    if(k){ geo[k] = { la: ll.lat, lo: ll.lng, t: Date.now(), hand: 1 }; saveGeo(); }
    var p = document.getElementById('mv-panel'); if(p && p.querySelector('h3') && /Not found/.test(p.textContent)) window.crmMapMissing();
    draw();
  }

  // ── everyone near a property: doorknock and call-around lists ──
  function metres(a, b){
    var R = 6371000, r = Math.PI / 180, dLa = (b.la - a.la) * r, dLo = (b.lo - a.lo) * r;
    var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.la * r) * Math.cos(b.la * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  window.crmMapAround = function(id, radius){
    var centre = data[id]; if(!centre) return;
    var k = keyOf(centre), g = spot(k); if(!g) return;
    var near = [];
    visible().forEach(function(c){
      var ck = keyOf(c); if(!ck || ck === k || c.stage === 'declined') return;
      var s = spot(ck); if(!s) return;
      var d = metres(g, s); if(d <= radius) near.push({ c: c, d: d });
    });
    near.sort(function(a, b){ return a.d - b.d; });
    ring = LL.circle([g.la, g.lo], { radius: radius, color: '#16324f', weight: 1.5, fillOpacity: 0.06 });
    map.closePopup(); draw(); map.fitBounds(ring.getBounds(), { padding: [20, 20] });
    var p = document.getElementById('mv-panel');
    var sizes = [200, 300, 500, 1000].map(function(r){ return '<button class="mv-btn' + (r === radius ? ' dark' : '') + '" onclick="crmMapAround(' + id + ',' + r + ')">' + (r < 1000 ? r + ' m' : '1 km') + '</button>'; }).join('');
    p.innerHTML = '<div class="mv-panel"><h3>' + near.length + ' contact' + (near.length === 1 ? '' : 's') + ' within ' + (radius < 1000 ? radius + ' m' : '1 km') + ' of ' + h(centre.a) + ' ' + sizes
      + '<button class="mv-btn" onclick="crmMapCopyAround()">Copy list</button><button class="mv-btn" style="margin-left:auto" onclick="crmMapCloseAround()">Close</button></h3>'
      + (near.length ? '' : '<div class="mv-sub" style="font-size:13px;color:var(--t2)">Nobody on the map within this distance yet. Try a wider circle.</div>')
      + near.map(function(o){
        var c = o.c, st = STAGE[c.stage] || { title: c.stage, color: '#888780' };
        var ph = String(c.ph || '').split('\n').filter(function(x){ return x && x !== '—' && x !== '-'; })[0] || '';
        return '<div class="mv-row"><span style="width:10px;height:10px;border-radius:50%;background:' + st.color + ';display:inline-block"></span><div><b>' + h(c.n) + '</b> <span class="mv-sub">' + h(c.a) + ' · ' + Math.round(o.d) + ' m · ' + h(st.title) + '</span></div>'
          + '<div class="mv-act">' + (ph ? '<a class="mv-btn" style="text-decoration:none" href="tel:' + h(ph.replace(/[^0-9+]/g, '')) + '">Call</a>' : '') + '<button class="mv-btn" onclick="openC(' + c.id + ')">Open card</button></div></div>';
      }).join('') + '</div>';
    window.__crmMapNear = near.map(function(o){
      var ph = String(o.c.ph || '').split('\n').filter(function(x){ return x && x !== '—' && x !== '-'; }).join(', ');
      return o.c.n + '\t' + o.c.a + '\t' + (ph || '') + '\t' + Math.round(o.d) + ' m';
    });
  };
  window.crmMapCopyAround = function(){
    var txt = (window.__crmMapNear || []).join('\n');
    try { navigator.clipboard.writeText(txt); } catch (e) {}
  };
  window.__crmMap = function(){ return map; };   // for tests
  window.crmMapCloseAround = function(){ ring = null; document.getElementById('mv-panel').innerHTML = ''; draw(); };
})();
