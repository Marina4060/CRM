/* ══ DELETE A CONTACT ══
   Each contact card gets a "Delete contact" button at the end of its bottom
   bar. It asks first, then removes the contact with its call history.
   A contact's number is its place in the list, so everything after it moves
   up one, and everything that points at contacts by number moves with it:
   the activity log, diary tasks, appointments, email campaign history, the
   quarterly review's "look again later" list, the call list's extras and
   vendor reports. Appointments and tasks for the deleted contact are kept
   (they still show the name) but no longer link to a contact.
   Contacts that came built into the CRM file itself can't be deleted here:
   they would come back the next time the file opens.
   Built in by tools/add_addons.py. */
(function(){
  if(typeof data === 'undefined' || typeof openC !== 'function') return;

  function readJSON(k, d){ try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function writeJSON(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  // an object keyed by contact number -> the same object with the numbers moved
  function moveKeys(o, fn){
    var out = {};
    Object.keys(o || {}).forEach(function(k){
      if(!/^\d+$/.test(k)){ out[k] = o[k]; return; }
      var t = fn(k); if(t != null) out[t] = o[k];
    });
    return out;
  }
  function moveIds(list, fn){
    (Array.isArray(list) ? list : []).forEach(function(x){
      if(x && x.contactId != null && x.contactId !== '') x.contactId = fn(x.contactId);
    });
  }

  function remove(id){
    var gone = Number(id);
    function fn(v){ var n = Number(v); if(isNaN(n)) return v; return n === gone ? null : (n > gone ? n - 1 : n); }

    data.splice(gone, 1);
    data.forEach(function(c, i){ c.id = i; });

    try { if(typeof actLog !== 'undefined'){ actLog = moveKeys(actLog, fn); saveActLog(); } } catch (e) {}
    try { if(typeof diaryTasks !== 'undefined'){ moveIds(diaryTasks, fn); saveDiary(); } } catch (e) {}
    try { if(typeof tasks !== 'undefined') moveIds(tasks, fn); } catch (e) {}
    try { if(typeof appointments !== 'undefined'){ moveIds(appointments, fn); if(typeof clSaveAppts === 'function') clSaveAppts(); } } catch (e) {}
    try { if(typeof campHistory !== 'undefined'){ moveIds(campHistory, fn); writeJSON('crm_camp_history', campHistory); } } catch (e) {}
    writeJSON('crm_review_parked', moveKeys(readJSON('crm_review_parked', {}), fn));
    var extras = readJSON('crm_debie_extras_v1', null);
    if(extras && extras.byCrm){ extras.byCrm = moveKeys(extras.byCrm, fn); writeJSON('crm_debie_extras_v1', extras); }
    try { if(window.__vendorReports && window.__vendorReports.remapContacts) window.__vendorReports.remapContacts(fn); } catch (e) {}

    saveToStorage();
  }

  window.deleteContact = function(id){
    var c = data[id]; if(!c) return;
    if(typeof FILE_CONTACT_COUNT !== 'undefined' && id < FILE_CONTACT_COUNT){
      alert('This contact is built into this copy of the CRM file, so it can’t be deleted here. Move it to Declined instead.');
      return;
    }
    var who = (c.n || 'this contact') + (c.a ? ' at ' + c.a : '');
    if(!confirm('Delete ' + who + '?\n\nTheir notes and call history are deleted too. This can’t be undone.')) return;
    remove(id);
    try { if(typeof logSession === 'function') logSession('Deleted contact: ' + who); } catch (e) {}
    closeM();
    renderCurrent();
  };

  var _openC = openC;
  window.openC = function(id){
    var r = _openC.apply(this, arguments);
    var foot = document.getElementById('m-foot');
    if(foot && data[id] && !foot.querySelector('.del-contact-btn')){
      var b = document.createElement('button');
      b.className = 'del-contact-btn';
      b.type = 'button';
      b.textContent = '🗑 Delete contact';
      b.title = 'Delete this contact and their call history';
      b.style.cssText = 'margin-left:auto;padding:4px 12px;border-radius:var(--r1,8px);background:#fff;color:#A32D2D;border:0.5px solid #F09595;font-size:12px;cursor:pointer;font-weight:500';
      b.onclick = function(){ window.deleteContact(id); };
      foot.appendChild(b);
    }
    return r;
  };

  window.__deleteContact = { remove: remove };
})();
