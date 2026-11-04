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

  // Suburb names: "Drive Somewhere" is Somewhere with the end of the
  // street name stuck to it (from an older import), and "all" is no suburb.
  // A street word at the front is dropped when the rest is a suburb other
  // contacts are already in.
  try {
    if(typeof data !== 'undefined' && data.length){
      var WORD = /^(drive|dr|road|rd|street|st|way|avenue|ave|court|ct|place|pl|crescent|cres|close|cl|lane|ln|parade|pde|terrace|tce|grove|gv|circle|cir|loop|boulevard|bvd|rise|chase|mews|approach|link|gardens|gdns|entrance|square|sq|retreat|vista|ridge|green|walk|glen|highway|hwy)\s+(.+)$/i;
      var have = {};
      data.forEach(function(c){ var s = String(c.suburb || '').trim(); if(s && !WORD.test(s)) have[s.toLowerCase()] = s; });
      var fixed = 0;
      data.forEach(function(c){
        var s = String(c.suburb || '').trim(), m = WORD.exec(s);
        if(m && have[m[2].toLowerCase()]){ c.suburb = have[m[2].toLowerCase()]; fixed++; }
        else if(/^all$/i.test(s)){
          c.suburb = (typeof rpSuburbFor === 'function' && c.a) ? (rpSuburbFor({ raw: c.a, rawLine: c.a }) || '') : '';
          if(/^all$/i.test(c.suburb)) c.suburb = '';
          fixed++;
        }
      });
      if(fixed){
        saveToStorage();
        if(typeof rebuildSuburbTabs === 'function') rebuildSuburbTabs();
        if(typeof renderCurrent === 'function') renderCurrent();
      }
    }
  } catch (e) {}
})();
