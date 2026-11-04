/* ══ Professional colours: the parts set in code ══
   The stage colours used by the board, table, badges and map pins, and
   which top-bar buttons are the main actions. Runs before the map, so its
   pins use these colours.
   Built in by tools/add_addons.py; the rest is in theme.css. */
(function(){
  var STAGE = {
    hot:       ['#D92D20', '#FEF3F2', '#B42318'],
    warm:      ['#DC6803', '#FFFAEB', '#B54708'],
    potential: ['#7A8BA3', '#F2F4F7', '#475467'],
    appraisal: ['#7F56D9', '#F4F3FF', '#6941C6'],
    msg:       ['#2E90FA', '#EFF8FF', '#175CD3'],
    cold:      ['#98A2B3', '#F2F4F7', '#475467'],
    declined:  ['#912018', '#FEF3F2', '#912018'],
    listed:    ['#12B76A', '#ECFDF3', '#067647'],
    sold:      ['#087443', '#E3F6EC', '#085D3A']
  };
  try { LANES.forEach(function(l){ var s = STAGE[l.key]; if(s) l.bar = s[0]; }); } catch (e) {}
  try { Object.keys(STAGE).forEach(function(k){ if(SB[k]){ SB[k].bg = STAGE[k][1]; SB[k].cl = STAGE[k][2]; } }); } catch (e) {}

  // the main buttons are always gold (theme.css); the brand colour from My details
  // still goes on emails, letters and vendor reports

  // soft colours by kind of task: people and contacts, planning, insight, money, files
  var SOFT = {
    'soft-blue':  ['openRPImport()', 'crmImportFile()', 'openStreetCampaign()', 'openEmail()', 'openSMS()'],
    'soft-green': ['openDiary()', 'openCal()', 'openCommand()', 'openStreetCoverage()', 'openSessionLog()', 'openStreetTracker()'],
    'soft-lilac': ['openPredictive()', 'openSelfAudit()', 'openExtra()', 'openVendorReports()', 'openCompete()', 'toggleAI()'],
    'soft-sand':  ['openExp()', 'openLog()'],
    'soft-rose':  ['openBuyers()', 'openInvestors()', 'showMultiOwners()'],
    'soft-grey':  ['crmBackup()', 'exportCRM()']
  };
  function soft(){
    Object.keys(SOFT).forEach(function(cls){ SOFT[cls].forEach(function(oc){ var el = document.querySelector('.topbar [onclick="' + oc + '"]'); if(el) el.classList.add(cls); }); });
    var nb = document.getElementById('nearby-btn'); if(nb) nb.classList.add('soft-lilac');
  }
  soft(); setTimeout(soft, 0); window.addEventListener('load', soft);   // some buttons are added by later scripts
  // the main actions keep the accent; everything else is a quiet button
  [['openAddContact()', 'crm-primary'], ['openCR()', 'crm-primary'], ['openTodayDash()', 'crm-today']].forEach(function(p){
    var el = document.querySelector('.topbar [onclick="' + p[0] + '"]'); if(el) el.classList.add(p[1]);
  });
  try { if(typeof renderCurrent === 'function') renderCurrent(); } catch (e) {}
})();
