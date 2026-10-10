/* ══ Small fixes to the CRM itself ══ */
(function(){
  // A new user starts their bookkeeping today: the first monthly check falls
  // due next month, not in their first minute with an empty CRM.
  try {
    if(typeof BOOK !== 'undefined' && !BOOK.lastDone && !localStorage.getItem('crm_book') && typeof saveBook === 'function'){
      var t = (typeof _todayISO === 'function') ? _todayISO() : new Date().toISOString().slice(0, 10);
      BOOK.lastDone = t; BOOK.startMonth = t.slice(0, 7); saveBook();
    }
  } catch (e) {}
})();
