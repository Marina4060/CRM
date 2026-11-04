/* ══ A SAVED COPY STARTS CLEAN ══
   Export / Save writes the page as it is on screen, so a saved file already
   holds the buttons, windows and styles the add-ons made last time (the Map
   tab, Vendor Reports, ...). They are removed here, before the add-ons run,
   so each appears once.
   Built in by tools/add_addons.py (runs before the other add-ons). */
(function(){
  ['vt-map', 'map-view', 'vr-wrap', 'vr-open-btn', 'by-wrap', 'mi-tip', 'exp-receipt-file', 'exp-receipt-group', 'rcpt-modal']
    .forEach(function(id){ var n; while((n = document.getElementById(id))) n.remove(); });
  [].slice.call(document.querySelectorAll('[data-addon]')).forEach(function(n){ n.remove(); });
  // things the add-ons put at the end of the page come after these scripts in a
  // saved file, so they are only there once the page has loaded: keep the new one
  // (the first, made by the add-ons as they ran) and drop the saved copies
  document.addEventListener('DOMContentLoaded', function(){
    ['mi-tip', 'vr-wrap', 'by-wrap', 'exp-receipt-file', 'rcpt-modal'].forEach(function(id){
      [].slice.call(document.querySelectorAll('[id="' + id + '"]')).slice(1).forEach(function(n){ n.remove(); });
    });
  });
})();
