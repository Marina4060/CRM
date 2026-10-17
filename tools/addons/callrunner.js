/* ══ MISSING PHONE OR EMAIL: in the Call Runner, not the pipeline ══
   The pipeline no longer has the "Missing phone or email" button or the
   "No phone" / "No email" labels on its cards. The Call Runner (the call
   list) keeps its own "No phone or email" filter, which is where those
   contacts are worked through.
   Built in by tools/add_addons.py. */
(function(){
  var btn = document.getElementById('missing-btn'); if(btn) btn.remove();
  try { missingOnly = false; } catch (e) {}
  if(typeof missingWhat === 'function') window.missingWhat = function(){ return ''; };
})();
