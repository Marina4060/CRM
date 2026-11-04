/* ══ EDIT A CONTACT: street and suburb on the card too ══
   The contact card already edits the name, address, phone, email, dates and
   notes. It now also has the street and the suburb, so a wrong suburb (or a
   street name stuck to it) can be put right on the card and saved.
   Built in by tools/add_addons.py. */
(function(){
  if(typeof openC !== 'function' || typeof saveC !== 'function') return;
  function esc(x){ return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  var _open = window.openC;
  window.openC = function(id){
    var r = _open.apply(this, arguments);
    var c = data[id], addr = document.getElementById('e-addr');
    if(c && addr && !document.getElementById('e-street')){
      var f = 'font-size:12px;padding:3px 6px;border:1px solid var(--bd3,#D0D5DD);border-radius:6px;background:#fff;color:var(--t1,#101828)';
      var row = document.createElement('div');
      row.id = 'e-place';
      row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:4px;font-size:11px;color:var(--t3,#667085);flex-wrap:wrap';
      row.innerHTML = '<label>Street <input id="e-street" value="' + esc(c.s) + '" style="' + f + ';width:130px"></label>'
        + '<label>Suburb <select id="e-suburb" style="' + f + '"></select></label>';
      addr.parentNode.insertBefore(row, addr.nextSibling);
      try { CRM_SUBURB_SELECTS['e-suburb'] = 'new'; crmFillSuburbSelects(); } catch (e) {}
      var sel = document.getElementById('e-suburb'), cur = c.suburb || (typeof getSuburb === 'function' ? getSuburb(c) : '');
      if(cur && ![].slice.call(sel.options).some(function(o){ return o.value === cur; })){ var o = document.createElement('option'); o.value = cur; o.textContent = cur; sel.insertBefore(o, sel.options[1] || null); }
      sel.value = cur || '';
    }
    return r;
  };

  var _save = window.saveC;
  window.saveC = function(id){
    // a field the contact never had shows "undefined" in its box; saved as is, an
    // "undefined" appraisal date moved the contact to Appraised
    ['e-appr', 'e-date', 'e-price', 'e-settled', 'e-pyear', 'e-byear', 'e-phone', 'e-email'].forEach(function(k){
      var el = document.getElementById(k); if(el && /^(undefined|null)$/.test(el.value.trim())) el.value = '';
    });
    var c = data[id], st = document.getElementById('e-street'), sb = document.getElementById('e-suburb'), moved = false;
    if(c && st && st.value.trim() && st.value.trim() !== c.s){ c.s = st.value.trim(); moved = true; }
    if(c && sb && sb.value && sb.value !== '__new' && sb.value !== c.suburb){ c.suburb = sb.value; moved = true; }
    var r = _save.apply(this, arguments);
    if(moved){ try { if(typeof rebuildSuburbTabs === 'function') rebuildSuburbTabs(); if(typeof rebuildPills === 'function') rebuildPills(); renderCurrent(); } catch (e) {} }
    return r;
  };
})();
