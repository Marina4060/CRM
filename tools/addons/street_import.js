/* ══ WHOLE STREET: bulk adding where people look for it ══
   The Add Contacts window's second tab becomes "Whole street (bulk)". At its
   top: paste a whole street copied from RP Data or ID4me (the Contact Import,
   which works out street and suburb, matches what is already here and shows
   a preview first), or import a spreadsheet or saved file. The typed list
   (one owner per line) stays underneath; Import All now says how many were
   saved and closes the window.
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
      + '<div style="font-size:12px;color:#5a4a20;margin-bottom:10px;line-height:1.5">In RP Data or ID4me, open the street, select the list of properties and owners, copy it (Ctrl+C), then click below and paste it (Ctrl+V). '
      + 'Street and suburb are worked out for you, owners already in your CRM just have their gaps filled, and you see a preview before anything is added.</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + '<button type="button" id="ac-street-paste" style="padding:9px 16px;border-radius:8px;background:#E3A92B;color:#1A1203;border:0;font-size:13px;font-weight:700;cursor:pointer">📋 Paste a whole street from RP Data or ID4me</button>'
      + '<button type="button" id="ac-street-file" style="padding:9px 14px;border-radius:8px;background:#fff;color:#344054;border:1px solid #D0D5DD;font-size:13px;font-weight:600;cursor:pointer">📂 Import a spreadsheet or file</button>'
      + '</div>'
      + '<div style="font-size:11.5px;color:#7a6a40;margin-top:10px">Or type them in below, one owner per line.</div>';
    box.insertBefore(t, box.firstChild);
    var close = function(){ try { if(typeof closeAddContact === 'function') closeAddContact(); } catch (e) {} };
    document.getElementById('ac-street-paste').onclick = function(){ close(); openRPImport(); };
    document.getElementById('ac-street-file').onclick = function(){ close(); if(typeof crmImportFile === 'function') crmImportFile(); };
  }
})();
