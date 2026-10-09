/* ══ Professional colours: the parts set in code ══
   The stage colours used by the board, table, badges and map pins, the
   accent taken from the agent's brand colour, and which top-bar buttons are
   the main actions. Runs before the map, so its pins use these colours.
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

  // the accent: the brand colour from My details, if it is dark enough for white text on it
  try {
    var b = window.ME && ME.brand, m = /^#([0-9a-f]{6})$/i.exec(b || '');
    if(m && b.toUpperCase() !== '#185FA5'){
      var n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, bl = n & 255;
      var lum = (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255;
      if(lum < 0.55){
        document.documentElement.style.setProperty('--crm-accent', b);
        document.documentElement.style.setProperty('--crm-accent-soft', 'rgba(' + r + ',' + g + ',' + bl + ',.12)');
      }
    }
  } catch (e) {}

  // the main actions keep the accent; everything else is a quiet button
  [['openAddContact()', 'crm-primary'], ['openCR()', 'crm-primary'], ['openTodayDash()', 'crm-today']].forEach(function(p){
    var el = document.querySelector('.topbar [onclick="' + p[0] + '"]'); if(el) el.classList.add(p[1]);
  });
  try { if(typeof renderCurrent === 'function') renderCurrent(); } catch (e) {}
})();
