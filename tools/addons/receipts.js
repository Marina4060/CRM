/* ══ RECEIPTS: a photo or file with each expense ══
   "Receipt" in the add-expense form takes a photo (on a phone the camera is
   offered) or attaches a file such as a PDF invoice. Rows with a receipt show
   🧾 to view it; rows without show 📎 to add one later.

   Photos are shrunk to at most 1600 px. Each receipt is kept in this
   browser's file storage (IndexedDB) for speed and, in the online version,
   uploaded to the private receipts store, so it opens on every device and
   is backed up. A receipt saved while offline uploads later.
   Built in by tools/add_addons.py. */
(function(){
  if(typeof addExpense !== 'function' || typeof renderExp !== 'function') return;
  var DB = 'crm_receipts', STORE = 'files', MAX = 1600, pending = null, attachTo = null;

  function h(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function idb(){
    return new Promise(function(res, rej){
      if(!window.indexedDB){ rej(new Error('no storage')); return; }
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function(){ r.result.createObjectStore(STORE); };
      r.onsuccess = function(){ res(r.result); }; r.onerror = function(){ rej(r.error); };
    });
  }
  function tx(mode, fn){ return idb().then(function(db){ return new Promise(function(res, rej){ var t = db.transaction(STORE, mode), s = t.objectStore(STORE), out = fn(s); t.oncomplete = function(){ res(out && out.result); }; t.onerror = function(){ rej(t.error); }; }); }); }
  function put(id, rec){ return tx('readwrite', function(s){ s.put(rec, id); }); }
  function get(id){ return tx('readonly', function(s){ return s.get(id); }); }
  function del(id){ return tx('readwrite', function(s){ s.delete(id); }); }
  function save(){ try { localStorage.setItem('crm_expenses', JSON.stringify(expenses)); } catch (e) {} }
  // the online store, when the CRM runs inside the online app
  function cloud(){ try { return window.CRM_UID && window.parent !== window && window.parent.CRM_RECEIPTS ? window.parent.CRM_RECEIPTS : null; } catch (e) { return null; } }
  function upload(exp, blob){
    var c = cloud(); if(!c || !exp.receipt) return Promise.resolve(false);
    return c.upload(window.CRM_UID, exp.id, blob).then(function(){ exp.receipt.cloud = true; save(); return true; }, function(){ return false; });
  }
  // receipts saved before signing in or while offline go up when they can
  function catchUp(){
    if(!cloud()) return;
    expenses.filter(function(e){ return e.receipt && !e.receipt.cloud; }).forEach(function(e){
      get(e.id).then(function(rec){ if(rec) return upload(e, rec.blob).then(function(ok){ if(ok) try { renderExp(); } catch (x) {} }); }).catch(function(){});
    });
  }

  // photos are shrunk; PDFs and other files are kept as they are
  function shrink(file){
    if(!/^image\//.test(file.type) || /gif|svg/.test(file.type)) return Promise.resolve(file);
    return new Promise(function(res){
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function(){
        var k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function(b){ res(b && b.size < file.size ? b : file); }, 'image/jpeg', 0.75);
      };
      img.onerror = function(){ URL.revokeObjectURL(url); res(file); };
      img.src = url;
    });
  }
  function store(exp, file){
    return shrink(file).then(function(blob){
      var name = file.name || 'receipt';
      if(blob !== file) name = name.replace(/\.[a-z0-9]+$/i, '') + '.jpg';
      return put(exp.id, { blob: blob, name: name, type: blob.type || file.type, added: Date.now() }).then(function(){
        exp.receipt = { name: name, type: blob.type || file.type, size: blob.size }; save();
        return upload(exp, blob);
      });
    });
  }

  // ── in the add-expense form ──
  var input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*,application/pdf'; input.id = 'exp-receipt-file'; input.style.display = 'none';
  document.body.appendChild(input);
  var addBtn = document.querySelector('#expense-form-row .exp-add-btn');
  if(addBtn){
    var g = document.createElement('div'); g.className = 'exp-form-group'; g.id = 'exp-receipt-group';
    g.innerHTML = '<div class="exp-form-label">Receipt</div><button type="button" class="exp-input" id="exp-receipt-btn" style="cursor:pointer;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">📷 Photo or file</button>';
    addBtn.parentNode.insertBefore(g, addBtn);
    document.getElementById('exp-receipt-btn').onclick = function(){ attachTo = null; input.value = ''; input.click(); };
  }
  function showPending(){
    var b = document.getElementById('exp-receipt-btn'); if(!b) return;
    b.textContent = pending ? '✓ ' + (pending.name || 'Receipt') : '📷 Photo or file';
    b.title = pending ? 'Tap to choose a different receipt' : '';
    b.style.color = pending ? '#067647' : '';
  }
  input.addEventListener('change', function(){
    var f = input.files && input.files[0]; if(!f) return;
    if(attachTo){
      var e = expenses.filter(function(x){ return x.id === attachTo; })[0]; attachTo = null;
      if(e) store(e, f).then(function(){ renderExp(); }).catch(failed);
      return;
    }
    pending = f; showPending();
  });
  function failed(){ alert('The receipt couldn’t be saved on this device. Check there is free space, or try a smaller photo.'); }

  var _add = window.addExpense;
  window.addExpense = function(){
    var before = {}; expenses.forEach(function(e){ before[e.id] = 1; });
    var r = _add.apply(this, arguments);
    var added = expenses.filter(function(e){ return !before[e.id]; })[0];
    if(added && pending){
      var f = pending; pending = null; showPending();
      store(added, f).then(function(){ renderExp(); }).catch(failed);
    }
    return r;
  };
  var _del = window.deleteExpense;
  window.deleteExpense = function(el){
    var id = el && el.getAttribute && el.getAttribute('data-id');
    var r = _del.apply(this, arguments);
    if(id && !expenses.some(function(e){ return e.id === id; })){ del(id).catch(function(){}); var c = cloud(); if(c) c.remove(window.CRM_UID, id).catch(function(){}); }
    return r;
  };

  // ── on each row: view the receipt, or add one ──
  var _render = window.renderExp;
  window.renderExp = function(){
    var r = _render.apply(this, arguments);
    [].forEach.call(document.querySelectorAll('#exp-tbody .exp-del[data-id]'), function(b){
      var id = b.getAttribute('data-id'), e = expenses.filter(function(x){ return x.id === id; })[0]; if(!e) return;
      var x = document.createElement('button'); x.type = 'button'; x.className = 'exp-del exp-rcpt';
      x.style.cssText = 'margin-right:4px;' + (e.receipt ? 'color:#067647;border-color:#ABEFC6' : 'color:var(--t3)');
      x.textContent = e.receipt ? '🧾' : '📎';
      x.title = e.receipt ? 'View receipt: ' + e.receipt.name : 'Add a receipt';
      x.setAttribute('aria-label', x.title);
      x.onclick = function(){ if(e.receipt) view(e); else { attachTo = e.id; input.value = ''; input.click(); } };
      b.parentNode.insertBefore(x, b);
    });
    var n = expenses.filter(function(e){ return e.receipt; }).length, note = document.getElementById('exp-receipt-note');
    if(!note){ var tb = document.getElementById('exp-tbody'); var tbl = tb && tb.closest('table'); if(tbl){ note = document.createElement('div'); note.id = 'exp-receipt-note'; note.style.cssText = 'font-size:12px;color:var(--t3);margin:6px 2px'; tbl.parentNode.insertBefore(note, tbl.nextSibling); } }
    var waiting = expenses.filter(function(e){ return e.receipt && !e.receipt.cloud; }).length;
    if(note) note.textContent = !n ? '' : cloud()
      ? n + ' receipt' + (n === 1 ? '' : 's') + ' saved online' + (waiting ? ', ' + waiting + ' waiting to upload' : '') + '.'
      : n + ' receipt' + (n === 1 ? '' : 's') + ' saved on this device. Download any you need to keep elsewhere.';
    return r;
  };

  // ── viewing a receipt ──
  function view(e){
    get(e.id).then(function(rec){
      if(rec) return rec;
      var c = cloud();
      if(!c || !e.receipt.cloud) return null;
      return c.download(window.CRM_UID, e.id).then(function(blob){
        var r = { blob: blob, name: e.receipt.name, type: blob.type || e.receipt.type, added: Date.now() };
        return put(e.id, r).then(function(){ return r; }, function(){ return r; });
      }, function(){ return null; });
    }).then(function(rec){
      if(!rec){ alert(e.receipt.cloud ? 'The receipt couldn\u2019t be downloaded. Check your internet connection and try again.' : 'This receipt was added on another device and hasn\u2019t uploaded yet. Open the CRM on that device to send it.'); return; }
      var url = URL.createObjectURL(rec.blob), isImg = /^image\//.test(rec.type);
      var m = document.createElement('div'); m.id = 'rcpt-modal';
      m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:900;display:flex;align-items:center;justify-content:center;padding:14px';
      m.innerHTML = '<div style="background:var(--bg1);border-radius:14px;max-width:min(720px,100%);max-height:100%;display:flex;flex-direction:column;overflow:hidden">'
        + '<div style="display:flex;gap:8px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--bd3)"><b style="flex:1;font-size:14px">' + h(e.desc || 'Receipt') + ' · $' + (+e.amount || 0).toFixed(2) + '</b>'
        + '<a class="exp-close-btn" style="text-decoration:none;color:inherit" href="' + url + '" download="' + h(rec.name) + '">Download</a>'
        + '<button class="exp-close-btn" id="rcpt-replace">Replace</button><button class="exp-close-btn" id="rcpt-remove" style="color:#9B2C2C">Remove</button><button class="exp-close-btn" id="rcpt-close">Close</button></div>'
        + '<div style="overflow:auto;padding:10px;text-align:center;background:#F2F4F7">' + (isImg ? '<img src="' + url + '" alt="Receipt" style="max-width:100%;height:auto">'
          : '<div style="padding:30px 10px;font-size:14px">📄 ' + h(rec.name) + '<br><a href="' + url + '" target="_blank" rel="noopener">Open the file</a></div>') + '</div></div>';
      document.body.appendChild(m);
      var close = function(){ m.remove(); setTimeout(function(){ URL.revokeObjectURL(url); }, 1000); };
      m.onclick = function(ev){ if(ev.target === m) close(); };
      m.querySelector('#rcpt-close').onclick = close;
      m.querySelector('#rcpt-replace').onclick = function(){ close(); attachTo = e.id; input.value = ''; input.click(); };
      m.querySelector('#rcpt-remove').onclick = function(){
        if(!confirm('Remove this receipt?')) return;
        var c = cloud(); if(c && e.receipt.cloud) c.remove(window.CRM_UID, e.id).catch(function(){});
        del(e.id).then(function(){ delete e.receipt; save(); close(); renderExp(); });
      };
    }).catch(function(){ alert('Receipts can’t be opened in this browser.'); });
  }

  setTimeout(catchUp, 2500);
  window.addEventListener('online', catchUp);
  var _open = window.openExp;
  if(_open) window.openExp = function(){ var r = _open.apply(this, arguments); catchUp(); return r; };

  window.__receipts = { get: get, view: function(id){ var e = expenses.filter(function(x){ return x.id === id; })[0]; if(e) view(e); } };
})();
