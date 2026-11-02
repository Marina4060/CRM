/* ══ HOVER HELP: a short description of each button on the main screen ══
   Rest the mouse on a button for a moment and a small box explains what it
   does. Buttons are matched by their label (emoji left out), so buttons the
   CRM adds later (Map, Vendor Reports, For sale nearby) get theirs too.
   Phones and tablets have no hover, so nothing shows there.
   Built in by tools/add_addons.py. */
(function(){
  var TIPS = {
    'my details': 'Your name, agency, phone and email. Every SMS, email and vendor report signs off with these.',
    'reset': 'Clears the CRM data saved in this browser. Take a Backup first.',
    'funnel': 'Your pipeline: every contact in a column by stage, from Hot to Sold.',
    'table': 'All your contacts in one list.',
    'map': 'Every contact as a pin on the map, coloured by stage. Handy for planning doorknocking.',
    'all': 'Show contacts from every suburb.',
    'coverage': 'How well each street has been worked, with the streets that need attention first. Click a street to filter the CRM.',
    'session log': 'Everything you do, recorded automatically: stage moves, edits, calls and emails.',
    'diary': 'Your day sheet: what is booked, who to ring back and your notes.',
    'command centre': 'Find anyone fast: search any name, address, phone or street across every suburb.',
    '+ add contact': 'Add one owner, or a whole street at once on the Whole street tab: by house numbers, from a pasted list or a spreadsheet.',
    'backup': 'Save a copy of all your data to this computer, to keep or bring back later.',
    'for sale nearby': 'Other agents’ listings in your area. Pick one to text your contacts on that street.',
    'export / save': 'Download your data: a full copy, an Excel file, or a small safety backup.',
    'message runner': 'Text a street one message at a time: pick the contacts and a template, send, then tap Next.',
    'self-audit': 'Finds what is slipping: missed callbacks, hot leads gone quiet and appraisals with no follow-up.',
    'predictive sellers': 'Ranks the owners in a suburb by how likely they are to sell soon, so you call the best ones first.',
    'call runner': 'Work through a call list one contact at a time: call, tap the result, then Save & Next.',
    'email templates': 'Write your emails once. The contact’s name, address and your sign-off fill in by themselves.',
    'sms templates': 'Write your text messages once. The contact’s name, address and your sign-off fill in by themselves.',
    'buyers': 'Your buyers, scored and sorted into Qualified, Not qualified and Purchased or paused.',
    'calendar': 'Appraisals, open homes, listing appointments and call-backs.',
    'expenses': 'Business costs and receipt photos, ready for tax time and your accountant.',
    'logbook': 'Record business trips by the kilometre for your car claim.',
    'import file': 'Bring contacts in from a spreadsheet (CSV) or a backup. Matches on address, fills gaps and adds new ones. Nothing is deleted.',
    'multi-owners': 'Owners with more than one property in your area: good leads for investment and sale conversations.',
    'investors': 'Your investor register: owners with several properties, the ones in your area first.',
    'streets': 'Your streets and how well each one has been worked.',
    'competitors': 'Keep track of other agents’ listings and sales in your area.',
    'reports': 'Your pipeline and activity in numbers, with estimated commission.',
    'vendor reports': 'A weekly report for each listing: open home numbers, enquiries and buyer feedback, ready to send to the vendor.',
    'ask ai': 'Ask about your contacts: who to call today, draft a follow-up text, or summarise your pipeline.',
    'today': 'Your plan for today: who to call and what is due.'
  };

  function label(el){
    // the button's words without emoji, arrows or extra spaces
    return (el.textContent || '').replace(/[^\w+\/&\- ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function tipFor(el){
    if(el.getAttribute('data-tip')) return el.getAttribute('data-tip');
    var t = TIPS[label(el)];
    if(t) return t;
    // a suburb tab along the top
    if(el.id && el.id.indexOf('sub-') === 0 && el.id !== 'sub-all') return 'Show only contacts in ' + el.textContent.trim() + '.';
    return '';
  }

  if(!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  var box = document.createElement('div');
  box.id = 'mi-tip'; box.setAttribute('data-addon', '1');
  box.setAttribute('role', 'tooltip');
  box.style.cssText = 'position:fixed;z-index:100000;max-width:260px;padding:8px 11px;border-radius:8px;background:#0B1F3A;color:#fff;'
    + 'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.18);'
    + 'pointer-events:none;opacity:0;transition:opacity .12s;left:0;top:0';
  document.body.appendChild(box);

  var timer = null, current = null;
  function hide(){ clearTimeout(timer); timer = null; current = null; box.style.opacity = '0'; }
  function show(el, text){
    box.textContent = text;
    var r = el.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
    var left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    var top = r.bottom + 8;
    if(top + h > window.innerHeight - 8) top = r.top - h - 8;
    box.style.left = left + 'px'; box.style.top = top + 'px'; box.style.opacity = '1';
  }

  document.addEventListener('mouseover', function(e){
    var el = e.target.closest && e.target.closest('button');
    if(el && !el.closest('.topbar')) el = null;   // only the main toolbar
    if(el === current) return;
    hide();
    if(!el) return;
    var text = tipFor(el);
    if(!text) return;
    // our box replaces the browser's own slower one
    if(el.title){ el.setAttribute('data-tip', el.title); el.removeAttribute('title'); }
    current = el;
    timer = setTimeout(function(){ if(current === el && document.body.contains(el)) show(el, text); }, 350);
  });
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);

  window.__tips = { forButton: tipFor, all: TIPS };
})();
