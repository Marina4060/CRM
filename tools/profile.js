/* ══ MY DETAILS: the agent using this CRM ══
   Everything that signs a message (name, agency, phone, email, logo, brand
   colour) comes from here. Saved in this browser only. */
(function(){
  var KEY='crm_profile';
  var P={};
  try{ P=JSON.parse(localStorage.getItem(KEY)||'{}')||{}; }catch(e){ P={}; }
  function v(k){ return String(P[k]||'').trim(); }
  var name=v('name'), agency=v('agency'), phone=v('phone'), website=v('website').replace(/^https?:\/\//i,'').replace(/\/$/,'');
  var ME={
    // raw values, empty when not filled in
    rawName:name, rawTitle:v('title'), rawAgency:agency, rawPhone:phone, rawEmail:v('email'),
    // values used in messages – a visible placeholder until filled in
    name: name || '[Your name]',
    first: name ? name.split(/\s+/)[0] : '[Your name]',
    title: v('title') || 'Sales Consultant',
    agency: agency || '[Your agency]',
    phone: phone || '[Your mobile]',
    phoneRaw: phone.replace(/[^0-9+]/g,''),
    email: v('email') || '[your email]',
    website: website || '[your website]',
    websiteUrl: website ? 'https://'+website : '#',
    office: v('office') || '[Office address]',
    brand: /^#[0-9a-f]{6}$/i.test(v('brand')) ? v('brand') : '#185FA5',
    logo: v('logo'),
    isSet: !!(name && agency && phone)
  };
  ME.NAME=ME.name.toUpperCase(); ME.TITLE=ME.title.toUpperCase(); ME.AGENCY=ME.agency.toUpperCase();
  ME.agencyLine=ME.agency+(v('office')?', '+v('office'):'');
  window.ME=ME;

  // [[name]]-style tokens in the page's own HTML
  function fill(s){ return s.replace(/\[\[(\w+)\]\]/g,function(m,k){ return ME[k]!=null?ME[k]:m; }); }
  function fillPage(){
    var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null,false), n;
    while((n=w.nextNode())){ if(n.nodeValue.indexOf('[[')>=0) n.nodeValue=fill(n.nodeValue); }
    [].forEach.call(document.querySelectorAll('*'),function(el){
      for(var i=0;i<el.attributes.length;i++){ var a=el.attributes[i]; if(a.value.indexOf('[[')>=0) el.setAttribute(a.name,fill(a.value)); }
      if((el.tagName==='TEXTAREA'||el.tagName==='INPUT') && el.value && el.value.indexOf('[[')>=0) el.value=fill(el.value);
    });
  }
  window.fillProfileTokens=fill;

  var FIELDS=[
    ['name','Your full name','e.g. Alex Taylor'],
    ['title','Your title','e.g. Sales Consultant'],
    ['agency','Agency','e.g. Taylor Real Estate'],
    ['phone','Mobile','e.g. 0400 000 000'],
    ['email','Email','e.g. alex@agency.com.au'],
    ['website','Website','e.g. www.agency.com.au'],
    ['office','Office address','e.g. 1 Main St, Perth WA 6000'],
    ['brand','Brand colour','#185FA5']
  ];
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
  window.openProfile=function(first){
    var old=document.getElementById('profile-modal'); if(old) old.remove();
    var m=document.createElement('div'); m.id='profile-modal';
    m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3000;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px;font-family:inherit';
    var rows=FIELDS.map(function(f){
      var type=f[0]==='brand'?'color':(f[0]==='email'?'email':(f[0]==='phone'?'tel':'text'));
      var val=v(f[0])||(f[0]==='brand'?'#185FA5':'');
      return '<label style="display:block;margin:0 0 10px;font-size:12px;color:#5a5a56">'+f[1]
        +'<input id="pf-'+f[0]+'" type="'+type+'" value="'+esc(val)+'" placeholder="'+esc(f[2])+'" style="display:block;width:100%;margin-top:3px;padding:8px 10px;border:1px solid #ccc;border-radius:8px;font-size:14px;box-sizing:border-box'+(type==='color'?';height:38px;padding:2px':'')+'"></label>';
    }).join('');
    m.innerHTML='<div style="background:#fff;border-radius:12px;max-width:440px;width:100%;padding:20px 22px;box-shadow:0 10px 40px rgba(0,0,0,.25)">'
      +'<h2 style="margin:0 0 4px;font-size:18px;color:#185FA5">'+(first?'Welcome! Set up your CRM':'My details')+'</h2>'
      +'<p style="margin:0 0 14px;font-size:12.5px;color:#5a5a56;line-height:1.45">These sign your SMS, emails and letters. They are saved in this browser only. You can change them any time from <b>👤 My details</b>.</p>'
      +rows
      +'<label style="display:block;margin:0 0 14px;font-size:12px;color:#5a5a56">Logo for emails (optional)'
      +'<input id="pf-logo" type="file" accept="image/*" style="display:block;margin-top:4px;font-size:12px"></label>'
      +(v('logo')?'<div style="margin:-6px 0 14px;display:flex;align-items:center;gap:10px"><img src="'+esc(v('logo'))+'" style="max-height:48px;max-width:160px"><button id="pf-logo-rm" style="font-size:12px;border:1px solid #ccc;background:#fff;border-radius:6px;padding:3px 8px;cursor:pointer">Remove logo</button></div>':'')
      +'<div style="display:flex;gap:8px;justify-content:flex-end">'
      +'<button id="pf-cancel" style="padding:8px 16px;border:1px solid #ccc;background:#fff;border-radius:20px;cursor:pointer">'+(first?'Later':'Cancel')+'</button>'
      +'<button id="pf-save" style="padding:8px 18px;border:0;background:#185FA5;color:#fff;border-radius:20px;font-weight:600;cursor:pointer">Save</button></div></div>';
    document.body.appendChild(m);
    var logo=v('logo');
    document.getElementById('pf-cancel').onclick=function(){ m.remove(); if(first){ try{ localStorage.setItem(KEY+'_asked','1'); }catch(e){} } };
    var rm=document.getElementById('pf-logo-rm'); if(rm) rm.onclick=function(){ logo=''; rm.parentNode.remove(); };
    document.getElementById('pf-logo').onchange=function(ev){
      var file=ev.target.files[0]; if(!file) return;
      var r=new FileReader();
      r.onload=function(){
        // shrink to a sensible email size
        var img=new Image(); img.onload=function(){
          var s=Math.min(1,440/img.width), c=document.createElement('canvas');
          c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
          c.getContext('2d').drawImage(img,0,0,c.width,c.height); logo=c.toDataURL('image/png');
        }; img.src=r.result;
      };
      r.readAsDataURL(file);
    };
    document.getElementById('pf-save').onclick=function(){
      var np={};
      FIELDS.forEach(function(f){ np[f[0]]=document.getElementById('pf-'+f[0]).value.trim(); });
      np.logo=logo;
      if(!np.name||!np.agency||!np.phone){ alert('Please fill in at least your name, agency and mobile.'); return; }
      try{ localStorage.setItem(KEY,JSON.stringify(np)); }catch(e){ alert('Could not save: '+e.message); return; }
      location.reload();
    };
  };

  document.addEventListener('DOMContentLoaded',function(){
    try{ fillPage(); }catch(e){}
    var asked=false; try{ asked=!!localStorage.getItem(KEY+'_asked'); }catch(e){}
    if(!ME.isSet && !asked) setTimeout(function(){ openProfile(true); },400);
  });
})();
