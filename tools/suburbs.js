/* ══ SUBURB PICKERS BUILD THEMSELVES FROM YOUR CONTACTS ══
   Every suburb drop-down lists the suburbs you actually have, plus
   "+ New suburb…" on the add-contact forms. */
function crmSuburbList(){
  var s={};
  try{ (typeof data!=='undefined'?data:[]).forEach(function(c){ if(c.stage==='removed') return; var g=(typeof getSuburb==='function')?getSuburb(c):c.suburb; if(g) s[g]=1; }); }catch(e){}
  try{ JSON.parse(localStorage.getItem('crm_extra_suburbs')||'[]').forEach(function(g){ if(g) s[g]=1; }); }catch(e){}
  return Object.keys(s).sort();
}
function crmHasSuburb(v){ return !!v && crmSuburbList().indexOf(v)>=0; }
function crmFirstSuburb(){ return crmSuburbList()[0]||''; }
function crmEsc(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function crmSuburbOptions(selected, withAll){
  var o=crmSuburbList().map(function(k){ return '<option value="'+crmEsc(k)+'"'+(k===selected?' selected':'')+'>'+crmEsc(k)+'</option>'; }).join('');
  return (withAll?'<option value="all"'+(selected==='all'?' selected':'')+'>All suburbs</option>':'')+o;
}
var CRM_SUBURB_SELECTS={'cr-suburb-filter':'all','be-suburb':'all','ac-suburb':'new','ac-bulk-suburb':'new'};
function crmFillSuburbSelects(){
  Object.keys(CRM_SUBURB_SELECTS).forEach(function(id){
    var sel=document.getElementById(id); if(!sel) return;
    var kind=CRM_SUBURB_SELECTS[id], cur=sel.value;
    var allOpt=[].slice.call(sel.options).find(function(o){ return o.value==='all'; });
    var html=(kind==='all' && allOpt ? '<option value="all">'+crmEsc(allOpt.textContent)+'</option>' : '')
      + (kind==='new' ? '<option value="">Choose suburb…</option>' : '')
      + crmSuburbOptions(null,false)
      + (kind==='new' ? '<option value="__new">+ New suburb…</option>' : '');
    var sig=html.replace(/ selected/g,'');
    if(sel._crmSig===sig) return;
    sel._crmSig=sig; sel.innerHTML=html;
    if([].slice.call(sel.options).some(function(o){ return o.value===cur; })) sel.value=cur;
    else if(kind==='new' && sel.options.length===3) sel.selectedIndex=1;
    if(kind==='new' && !sel._crmNew){
      sel._crmNew=true;
      sel.addEventListener('change',function(){
        if(sel.value!=='__new') return;
        var n=(prompt('Suburb name (e.g. Scarborough):')||'').trim();
        if(!n){ sel.selectedIndex=0; return; }
        n=n.replace(/\b\w/g,function(c){ return c.toUpperCase(); });
        try{ var x=JSON.parse(localStorage.getItem('crm_extra_suburbs')||'[]'); if(x.indexOf(n)<0){ x.push(n); localStorage.setItem('crm_extra_suburbs',JSON.stringify(x)); } }catch(e){}
        crmFillSuburbSelects(); sel.value=n;
      });
    }
  });
}
document.addEventListener('DOMContentLoaded',function(){ try{ crmFillSuburbSelects(); }catch(e){} });
document.addEventListener('focusin',function(e){ if(e.target && CRM_SUBURB_SELECTS[e.target.id]){ var v=e.target.value; crmFillSuburbSelects(); if(v) e.target.value=v; } });
