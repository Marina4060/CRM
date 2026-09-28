/* Real Estate CRM – hosted shell.
   Signs people in, checks their trial or subscription, loads the CRM, keeps
   its data in sync with the cloud, and runs the Team, Billing and Help pages. */
(function () {
  'use strict';
  var C = window.CRM_CONFIG || {};
  var API = String(C.supabaseUrl || '').replace(/\/$/, '');
  var KEY = C.supabaseAnonKey || '';

  // what the CRM saves in the browser (every key it uses starts with crm_)
  var SYNC_PREFIX = 'crm_';
  // our own bookkeeping, never synced
  var S_SESSION = 'shell_session', S_OWNER = 'shell_owner', S_PENDING = 'shell_pending',
      S_KNOWN = 'shell_known', S_LASTOK = 'shell_last_access_ok', S_SEEN_VER = 'shell_seen_version';
  var OFFLINE_GRACE_MS = 3 * 24 * 3600 * 1000;   // keep working offline this long after the last check
  var APP_CACHE = 'crm-app-v1';

  var ctx = null;         // from app_context(): user, role, team, access
  var session = null;     // {access_token, refresh_token, expires_at, user:{id,email}}
  var appVersion = null;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // ─────────────── small helpers ───────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { } }
  function isSyncKey(k) { return typeof k === 'string' && k.indexOf(SYNC_PREFIX) === 0; }
  function syncKeys() { var out = []; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (isSyncKey(k)) out.push(k); } return out; }
  function toast(msg, ms) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, ms || 3200);
  }
  function show(id) { $$('.screen').forEach(function (s) { s.hidden = s.id !== id; }); }
  function fmtDate(d) { return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function daysLeft(d) { return Math.max(0, Math.ceil((new Date(d) - Date.now()) / 86400000)); }
  function ago(d) {
    if (!d) return 'never';
    var m = Math.round((Date.now() - new Date(d)) / 60000);
    if (m < 2) return 'just now'; if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 24) return h + ' h ago';
    return Math.round(h / 24) + ' d ago';
  }
  // figures written by other team members: only ever show them as numbers
  function num(v) { v = Number(v); return isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function roleName(r) { return { owner: 'Owner', admin: 'Admin', agent: 'Agent' }[r] || r; }
  function paid(t) { return ['active', 'trialing', 'past_due'].indexOf(t && t.subscription_status) >= 0; }
  function isOwner() { return ctx && ctx.role === 'owner'; }
  function isManager() { return ctx && (ctx.role === 'owner' || ctx.role === 'admin'); }

  // ─────────────── network ───────────────
  function NetError(msg) { this.message = msg; this.offline = true; }
  function ApiError(msg, status, body) { this.message = msg; this.status = status; this.body = body; }

  function req(method, path, body, opts) {
    opts = opts || {};
    var headers = { apikey: KEY, 'Content-Type': 'application/json' };
    if (opts.auth !== false && session) headers.Authorization = 'Bearer ' + session.access_token;
    if (opts.prefer) headers.Prefer = opts.prefer;
    var doFetch = function () {
      return fetch(API + path, { method: method, headers: headers, body: body == null ? undefined : JSON.stringify(body) })
        .catch(function () { throw new NetError('You appear to be offline.'); });
    };
    var run = function () {
      return doFetch().then(function (r) {
        if (opts.raw && r.ok) return r;
        return r.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { }
          if (!r.ok) {
            var m = (j && (j.message || j.msg || j.error_description || j.error)) || ('Request failed (' + r.status + ')');
            throw new ApiError(m, r.status, j);
          }
          return j;
        });
      });
    };
    if (opts.auth === false || !session) return run();
    return ensureFresh().then(function () {
      headers.Authorization = 'Bearer ' + session.access_token;
      return run().catch(function (e) {
        // an expired token: refresh once and try again
        if (e instanceof ApiError && e.status === 401 && !opts._retried) {
          return refresh().then(function () { opts._retried = true; headers.Authorization = 'Bearer ' + session.access_token; return run(); });
        }
        throw e;
      });
    });
  }
  var rest = function (m, p, b, o) { return req(m, '/rest/v1' + p, b, o); };
  var rpc = function (fn, args) { return rest('POST', '/rpc/' + fn, args || {}); };
  var fn = function (name, args) { return req('POST', '/functions/v1/' + name, args || {}); };

  // ─────────────── auth ───────────────
  function saveSession(s) {
    session = {
      access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: s.expires_at ? s.expires_at * 1000 : Date.now() + (s.expires_in || 3600) * 1000,
      user: { id: s.user && s.user.id, email: s.user && s.user.email }
    };
    lsSet(S_SESSION, session);
  }
  var refreshing = null;
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = req('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token }, { auth: false })
      .then(function (s) { saveSession(s); })
      .catch(function (e) {
        if (e instanceof ApiError) { session = null; lsDel(S_SESSION); showAuth('signin', 'Please sign in again.'); }
        throw e;
      })
      .then(function (v) { refreshing = null; return v; }, function (e) { refreshing = null; throw e; });
    return refreshing;
  }
  function ensureFresh() {
    if (session && session.expires_at - Date.now() < 60000) return refresh();
    return Promise.resolve();
  }
  function siteUrl(extra) { return location.origin + location.pathname + (extra || ''); }

  function showAuth(which, err) {
    show('scr-auth');
    ['signin', 'signup', 'forgot', 'newpass'].forEach(function (f) { $('#f-' + f).hidden = f !== which; });
    $('#auth-check').hidden = which !== 'check';
    var e = $('#auth-err'); e.hidden = !err; e.textContent = err || '';
    var inv = sessionStorage.getItem('invite');
    $('#invite-note').hidden = !inv;
    $('#invite-note').textContent = "You've been invited to join a team. Sign in or create an account with the email address the invite was sent to.";
  }

  function authSetup() {
    $('#trial-line').textContent = (C.trialDays || 14) + ' days free, no card needed. Then ' + (C.priceLabel || '') + '.';
    if (C.termsUrl || C.privacyUrl) {
      $('#agree-text').innerHTML = 'I agree to the ' + (C.termsUrl ? '<a target="_blank" rel="noopener" href="' + esc(C.termsUrl) + '">terms</a>' : 'terms') +
        ' and ' + (C.privacyUrl ? '<a target="_blank" rel="noopener" href="' + esc(C.privacyUrl) + '">privacy policy</a>' : 'privacy policy');
    }
    $$('[data-auth]').forEach(function (a) { a.addEventListener('click', function (ev) { ev.preventDefault(); showAuth(a.getAttribute('data-auth')); }); });

    function busy(form, on) { $$('button', form).forEach(function (b) { b.disabled = on; }); }
    function fail(form, e) { busy(form, false); showAuth(form.id.slice(2), friendlyAuthError(e)); }

    $('#f-signin').addEventListener('submit', function (ev) {
      ev.preventDefault(); var f = ev.target; busy(f, true);
      req('POST', '/auth/v1/token?grant_type=password', { email: f.email.value.trim(), password: f.password.value }, { auth: false })
        .then(function (s) { saveSession(s); busy(f, false); f.reset(); return start(); })
        .catch(function (e) { fail(f, e); });
    });
    $('#f-signup').addEventListener('submit', function (ev) {
      ev.preventDefault(); var f = ev.target; busy(f, true);
      var inv = sessionStorage.getItem('invite');
      var redirect = siteUrl(inv ? '?invite=' + encodeURIComponent(inv) : '');
      req('POST', '/auth/v1/signup?redirect_to=' + encodeURIComponent(redirect),
        { email: f.email.value.trim(), password: f.password.value, data: { full_name: f.name.value.trim() } }, { auth: false })
        .then(function (r) {
          busy(f, false);
          if (r && r.access_token) { saveSession(r); f.reset(); return start(); }
          showAuth('check');
          $('#auth-check-msg').textContent = 'We sent a link to ' + f.email.value.trim() + '. Open it on this device to finish setting up your account.';
          f.reset();
        })
        .catch(function (e) { fail(f, e); });
    });
    $('#f-forgot').addEventListener('submit', function (ev) {
      ev.preventDefault(); var f = ev.target; busy(f, true);
      req('POST', '/auth/v1/recover?redirect_to=' + encodeURIComponent(siteUrl()), { email: f.email.value.trim() }, { auth: false })
        .then(function () {
          busy(f, false); showAuth('check');
          $('#auth-check-msg').textContent = 'If ' + f.email.value.trim() + ' has an account, a reset link is on its way.';
        })
        .catch(function (e) { fail(f, e); });
    });
    $('#f-newpass').addEventListener('submit', function (ev) {
      ev.preventDefault(); var f = ev.target; busy(f, true);
      req('PUT', '/auth/v1/user', { password: f.password.value })
        .then(function () { busy(f, false); f.reset(); toast('Password changed.'); return start(); })
        .catch(function (e) { fail(f, e); });
    });
  }
  function friendlyAuthError(e) {
    var m = (e && e.message) || '';
    var code = e && e.body && (e.body.error_code || e.body.code);
    if (e instanceof NetError) return 'No internet connection. Please try again when you are back online.';
    if (code === 'email_not_confirmed' || /not confirmed/i.test(m)) return 'Please open the link we emailed you to confirm your address first.';
    if (code === 'invalid_credentials' || /invalid login/i.test(m)) return 'That email and password don\'t match.';
    if (code === 'user_already_exists' || /already registered/i.test(m)) return 'There is already an account with that email. Try signing in.';
    if (code === 'weak_password' || /password/i.test(m) && /least|weak|short/i.test(m)) return 'Please choose a longer password (8+ characters).';
    if (/rate limit/i.test(m)) return 'Too many attempts. Please wait a minute and try again.';
    return m || 'Something went wrong. Please try again.';
  }

  // tokens arriving in the address bar from an email link
  function readAuthRedirect() {
    var q = new URLSearchParams(location.search);
    if (q.get('invite')) sessionStorage.setItem('invite', q.get('invite'));
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    var out = { type: null, error: null };
    if (h.get('error_description')) out.error = h.get('error_description').replace(/\+/g, ' ');
    if (h.get('access_token')) {
      saveSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'),
        expires_in: Number(h.get('expires_in')) || 3600, user: {} });
      out.type = h.get('type');
    }
    if (out.error || out.type) history.replaceState(null, '', location.pathname + (q.get('checkout') ? '?checkout=' + q.get('checkout') : ''));
    return out;
  }

  // ─────────────── sync ───────────────
  var pending = lsGet(S_PENDING, []);            // keys changed here and not yet saved to the cloud
  var known = lsGet(S_KNOWN, {});                // key -> cloud updated_at we last saw
  var flushTimer = null, flushing = null, syncState = 'ok';

  function setSync(state, text) {
    syncState = state;
    var el = $('#sync'); if (!el) return;
    el.className = 'sync' + (state === 'busy' ? ' busy' : state === 'off' ? ' off' : '');
    $('b', el).textContent = text || (state === 'busy' ? 'Saving…' : state === 'off' ? 'Offline' : 'Synced');
    el.title = state === 'off' ? 'Offline: changes are kept on this device and sent when you reconnect.' : 'Your CRM is saved to the cloud.';
  }
  function markPending(k) {
    if (pending.indexOf(k) < 0) { pending.push(k); lsSet(S_PENDING, pending); }
    setSync('busy');
    clearTimeout(flushTimer); flushTimer = setTimeout(flush, 1200);
  }
  // the CRM runs in a frame on this same site, so each change it saves reaches us as a storage event
  window.addEventListener('storage', function (e) {
    if (!session || !ctx) return;
    if (e.key === null) { syncKeys().forEach(markPending); Object.keys(known).forEach(markPending); return; }
    if (isSyncKey(e.key)) { markPending(e.key); statsSoon(e.key); }
  });

  function flush() {
    if (flushing) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 800); return flushing; }
    if (!pending.length || !session || !ctx) { if (!pending.length) setSync('ok'); return Promise.resolve(); }
    if (!ctx.access) { setSync('off', 'Not saving'); return Promise.resolve(); }
    var keys = pending.slice(), ups = [], dels = [];
    keys.forEach(function (k) {
      var v = localStorage.getItem(k);
      if (v == null) dels.push(k); else ups.push({ user_id: ctx.user.id, key: k, value: v });
    });
    setSync('busy');
    var jobs = [];
    if (ups.length) jobs.push(rest('POST', '/crm_state?on_conflict=user_id,key&select=key,updated_at', ups,
      { prefer: 'resolution=merge-duplicates,return=representation' })
      .then(function (rows) { (rows || []).forEach(function (r) { known[r.key] = r.updated_at; }); }));
    if (dels.length) jobs.push(rest('DELETE', '/crm_state?user_id=eq.' + ctx.user.id + '&key=in.(' + dels.map(function (k) { return '"' + k + '"'; }).join(',') + ')')
      .then(function () { dels.forEach(function (k) { delete known[k]; }); }));
    flushing = Promise.all(jobs).then(function () {
      pending = pending.filter(function (k) { return keys.indexOf(k) < 0; });
      lsSet(S_PENDING, pending); lsSet(S_KNOWN, known);
      setSync(pending.length ? 'busy' : 'ok');
      if (pending.length) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 500); }
    }).catch(function (e) {
      if (e instanceof NetError) setSync('off');
      else if (e.status === 401 || e.status === 403 || /row-level security/i.test(e.message)) { setSync('off', 'Not saving'); recheckAccess(); }
      else { setSync('off', 'Sync problem'); console.warn('sync', e); }
      clearTimeout(flushTimer); flushTimer = setTimeout(flush, 15000);
    }).then(function () { flushing = null; });
    return flushing;
  }
  window.addEventListener('online', function () { if (pending.length) flush(); });
  window.addEventListener('pagehide', function () { if (pending.length) flush(); });

  // bring this browser up to date with the cloud before the CRM starts
  function pull() {
    // another person signed in on this browser before: start clean, never mix accounts
    if (lsGet(S_OWNER, null) !== ctx.user.id) { clearLocal(); lsSet(S_OWNER, ctx.user.id); }
    var first = pending.length ? flush() : Promise.resolve();
    return first.then(function () {
      return rest('GET', '/crm_state?select=key,value,updated_at&user_id=eq.' + ctx.user.id);
    }).then(function (rows) {
      var onServer = {};
      rows.forEach(function (r) {
        onServer[r.key] = true;
        if (pending.indexOf(r.key) >= 0) return;          // our newer change wins; it will be sent next
        try { localStorage.setItem(r.key, r.value); } catch (e) { console.warn('storage full', e); }
        known[r.key] = r.updated_at;
      });
      // removed on another device
      syncKeys().forEach(function (k) { if (!onServer[k] && known[k] && pending.indexOf(k) < 0) { lsDel(k); delete known[k]; } });
      // this browser has data the cloud doesn't (e.g. used before signing up): send it up
      syncKeys().forEach(function (k) { if (!onServer[k] && !known[k]) markPending(k); });
      lsSet(S_KNOWN, known);
    });
  }
  function clearLocal() {
    syncKeys().forEach(lsDel);
    pending = []; known = {}; lsDel(S_PENDING); lsDel(S_KNOWN); lsDel(S_LASTOK);
  }
  // changes made on another device while this one is open
  function checkRemote() {
    if (!ctx || !ctx.access || document.hidden) return;
    rest('GET', '/crm_state?select=key,updated_at&user_id=eq.' + ctx.user.id).then(function (rows) {
      var newer = rows.some(function (r) { return pending.indexOf(r.key) < 0 && known[r.key] && r.updated_at > known[r.key]; });
      if (newer) banner('Your CRM was updated on another device.', 'Load changes', function () { reloadCrm(true); });
    }).catch(function () { });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { checkRemote(); if (pending.length) flush(); } });
  setInterval(checkRemote, 90000);

  // ─────────────── team dashboard figures ───────────────
  // counts only: no client names or details leave the agent's account
  var statsTimer = null;
  function statsSoon(k) {
    if (['crm_data_v4', 'crm_activity_log', 'crm_appts_v1'].indexOf(k) < 0) return;
    clearTimeout(statsTimer); statsTimer = setTimeout(pushStats, 20000);
  }
  function computeStats() {
    var data = lsGet('crm_data_v4', []) || [], act = lsGet('crm_activity_log', {}) || {}, appts = lsGet('crm_appts_v1', []) || [];
    var by = { hot: 0, warm: 0, potential: 0, appraisal: 0, msg: 0, cold: 0, declined: 0, listed: 0, sold: 0 }, total = 0;
    (Array.isArray(data) ? data : []).forEach(function (c) {
      if (!c || c.stage === 'removed') return;
      total++; if (by[c.stage] != null) by[c.stage]++;
    });
    var now = Date.now(), wk = now - 7 * 86400000, mo = now - 30 * 86400000;
    var s = { total: total, stages: by, calls7: 0, sms7: 0, emails7: 0, touches7: 0, touches30: 0, contacted7: 0, upcoming: 0, last_activity: null };
    Object.keys(act).forEach(function (id) {
      var hit7 = false;
      (act[id] || []).forEach(function (e) {
        var ts = Number(e && e.ts) || 0; if (!ts) return;
        if (!s.last_activity || ts > s.last_activity) s.last_activity = ts;
        if (ts >= mo) s.touches30++;
        if (ts < wk) return;
        s.touches7++; hit7 = true;
        var t = String(e.type || '');
        if (/call/i.test(t)) s.calls7++; else if (/sms|text/i.test(t)) s.sms7++; else if (/email/i.test(t)) s.emails7++;
      });
      if (hit7) s.contacted7++;
    });
    var today = new Date().toISOString().slice(0, 10);
    (Array.isArray(appts) ? appts : []).forEach(function (a) { if (a && a.date >= today && !/^\[DONE/.test(a.notes || '')) s.upcoming++; });
    if (s.last_activity) s.last_activity = new Date(s.last_activity).toISOString();
    return s;
  }
  function pushStats() {
    if (!ctx || !ctx.access) return Promise.resolve();
    return rest('POST', '/member_stats?on_conflict=user_id', [{ user_id: ctx.user.id, stats: computeStats() }],
      { prefer: 'resolution=merge-duplicates,return=minimal' }).catch(function () { });
  }

  // ─────────────── start-up ───────────────
  function start() {
    show('scr-loading'); $('#loading-msg').textContent = 'Loading…';
    var invite = sessionStorage.getItem('invite');
    return rpc('app_context', { invite_token: invite || null }).then(function (c) {
      if (invite) { sessionStorage.removeItem('invite'); toast('Welcome to ' + c.team.name + '!'); }
      ctx = c; session.user = { id: c.user.id, email: c.user.email }; lsSet(S_SESSION, session);
      if (!c.access) return blocked();
      lsSet(S_LASTOK, Date.now());
      return pull().then(openApp);
    }).catch(function (e) {
      if (e instanceof NetError) return offlineStart();
      if (invite && e instanceof ApiError && e.status < 500) {
        sessionStorage.removeItem('invite');
        toast(e.message, 7000);
        return start();
      }
      if (e instanceof ApiError && e.status === 401) { session = null; lsDel(S_SESSION); return showAuth('signin'); }
      show('scr-loading'); $('#loading-msg').innerHTML = esc(e.message) + '<br><a href="">Try again</a>';
    });
  }
  // no connection: carry on with what's on this device, if access was confirmed recently
  function offlineStart() {
    var last = lsGet(S_LASTOK, 0), owner = lsGet(S_OWNER, null);
    if (session && owner && (!session.user.id || owner === session.user.id) && Date.now() - last < OFFLINE_GRACE_MS) {
      ctx = ctx || { user: { id: owner, email: session.user.email }, role: 'agent', team: { name: '' }, access: true, offline: true };
      return openApp().then(function () { setSync('off'); toast("You're offline. Your changes are kept on this device."); });
    }
    show('scr-loading'); $('#loading-msg').innerHTML = 'No internet connection.<br><a href="">Try again</a>';
  }
  function recheckAccess() {
    return rpc('app_context', {}).then(function (c) { ctx = c; paintChrome(); if (!c.access) blocked(); }).catch(function () { });
  }

  function blocked() {
    show('scr-blocked');
    var t = ctx.team, owner = isOwner();
    var over = t.subscription_status === 'canceled' || t.subscription_status === 'unpaid' || t.subscription_status === 'incomplete_expired';
    var seatsShort = paid(t) && t.members > Math.max(t.seats, 1);
    $('#blocked-title').textContent = seatsShort ? 'Your team needs more seats' : over ? 'Your subscription has ended' : 'Your free trial has ended';
    $('#blocked-msg').textContent = seatsShort
      ? (owner ? 'Your team has ' + t.members + ' people but ' + t.seats + ' paid seats. Add seats to carry on.' : 'Your team has more people than paid seats. Please ask your team owner to add a seat.')
      : owner ? 'Subscribe to keep using the CRM. It\'s ' + (C.priceLabel || '') + '.'
        : 'Please ask your team owner to subscribe so everyone can keep using the CRM.';
    $('#blocked-subscribe').hidden = !owner || paid(t);
    $('#blocked-portal').hidden = !owner || !t.has_billing;
    $('#blocked-support').href = 'mailto:' + (C.supportEmail || '');
    if (seatsShort && owner) { $('#blocked-subscribe').hidden = false; $('#blocked-subscribe').textContent = 'Add seats'; }
  }

  function openApp() {
    show('scr-app');
    paintChrome();
    setSync(pending.length ? 'busy' : 'ok');
    if (pending.length) flush();
    route();
    return loadCrm().then(function () {
      pushStats();
      handleCheckoutReturn();
      maybeShowInstallHint();
    });
  }

  // ─────────────── the CRM itself ───────────────
  function fetchApp() {
    return req('GET', '/storage/v1/object/authenticated/app/crm.html', null, { raw: true })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        if ('caches' in window) caches.open(APP_CACHE).then(function (c) { c.put('crm.html', new Response(html, { headers: { 'Content-Type': 'text/html' } })); }).catch(function () { });
        return html;
      })
      .catch(function (e) {
        if (e instanceof NetError && 'caches' in window) {
          return caches.open(APP_CACHE).then(function (c) { return c.match('crm.html'); }).then(function (r) { if (!r) throw e; return r.text(); });
        }
        throw e;
      });
  }
  function loadCrm() {
    return fetchApp().then(function (html) {
      // first time: fill "My details" with what we know from the account
      if (!localStorage.getItem('crm_profile') && ctx.user) {
        try { localStorage.setItem('crm_profile', JSON.stringify({ name: ctx.user.full_name || '', email: ctx.user.email || '' })); markPending('crm_profile'); } catch (e) { }
      }
      var f = $('#crm-frame');
      f.srcdoc = html;
      checkVersion();
    }).catch(function (e) {
      $('#tab-crm').innerHTML = '<div class="page"><div class="card"><h2>The CRM could not be loaded</h2><p>' + esc(e.message) + '</p><p><a href="">Try again</a></p></div></div>';
    });
  }
  function reloadCrm(fromCloud) {
    hideBanner();
    (fromCloud ? pull() : Promise.resolve()).then(loadCrm);
  }
  function checkVersion() {
    req('GET', '/storage/v1/object/authenticated/app/version.json', null, { raw: true })
      .then(function (r) { return r.json(); })
      .then(function (v) {
        appVersion = v.version || null;
        var list = (v.history || [v]).slice(0, 8);
        $('#whatsnew').innerHTML = list.map(function (x) { return '<p><b>' + esc(x.date || x.version) + '</b> ' + esc(x.notes || '') + '</p>'; }).join('') || 'No updates yet.';
        var seen = lsGet(S_SEEN_VER, null);
        if (seen && seen !== v.version && v.notes) toast('Updated: ' + v.notes, 7000);
        lsSet(S_SEEN_VER, v.version);
      }).catch(function () { });
  }

  // ─────────────── top bar ───────────────
  function paintChrome() {
    if (!ctx) return;
    var t = ctx.team || {}, name = (ctx.user.full_name || ctx.user.email || '?');
    $('#menu-btn').textContent = name.trim().charAt(0).toUpperCase();
    $('#menu-name').textContent = ctx.user.full_name || 'No name yet';
    $('#menu-email').textContent = ctx.user.email || '';
    $('#menu-role').textContent = roleName(ctx.role) + (t.name ? ' · ' + t.name : '');
    var chip = $('#plan-chip');
    if (ctx.offline) { chip.textContent = 'Offline'; chip.className = 'chip warn'; }
    else if (t.subscription_status === 'past_due') { chip.textContent = 'Payment failed'; chip.className = 'chip bad'; }
    else if (paid(t) && t.subscription_status !== 'trialing') { chip.textContent = t.cancel_at_period_end ? 'Ends ' + fmtDate(t.current_period_end) : 'Subscribed'; chip.className = 'chip ' + (t.cancel_at_period_end ? 'warn' : 'good'); }
    else {
      var d = daysLeft(t.trial_ends_at);
      chip.textContent = paid(t) ? 'Trial · billing starts in ' + d + ' d' : 'Trial · ' + d + ' day' + (d === 1 ? '' : 's') + ' left';
      chip.className = 'chip' + (!paid(t) && d <= 3 ? ' warn' : '');
    }
    if (t.subscription_status === 'past_due' && isOwner()) banner('Your last payment didn\'t go through.', 'Update card', openPortal);
  }
  function banner(msg, btn, onClick) {
    var b = $('#banner'); b.hidden = false;
    b.innerHTML = '<span>' + esc(msg) + '</span>' + (btn ? '<button class="btn">' + esc(btn) + '</button>' : '') + '<button class="btn ghost" aria-label="Dismiss">✕</button>';
    var bs = $$('button', b);
    if (btn) bs[0].onclick = onClick;
    bs[bs.length - 1].onclick = hideBanner;
  }
  function hideBanner() { $('#banner').hidden = true; }

  // ─────────────── pages ───────────────
  function route() {
    var tab = (location.hash || '#crm').slice(1);
    if (['crm', 'team', 'billing', 'help'].indexOf(tab) < 0) tab = 'crm';
    $$('.tabs a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === tab); });
    $$('.tab').forEach(function (el) { el.hidden = el.id !== 'tab-' + tab; });
    if (tab === 'team') renderTeam();
    if (tab === 'billing') renderBilling();
    if (tab === 'help') renderHelp();
  }
  window.addEventListener('hashchange', function () { if (ctx && !$('#scr-app').hidden) route(); });
  $('#plan-chip').addEventListener('click', function () { location.hash = '#billing'; });

  // ── team ──
  function renderTeam() {
    var t = ctx.team || {};
    $('#team-name').textContent = t.name || 'Team';
    $('#team-sub').textContent = 'You are ' + (ctx.role === 'owner' ? 'the owner' : 'an ' + roleName(ctx.role).toLowerCase()) + ' · ' + t.members + ' ' + (t.members === 1 ? 'person' : 'people');
    $('#team-rename').hidden = !isOwner();
    $('#invite-box').hidden = !isManager();
    $('#leave-box').hidden = ctx.role === 'owner';
    $('#dash').hidden = !isManager();
    $('#f-invite').role.querySelector('[value=admin]').disabled = !isOwner();
    if (isManager()) {
      rpc('team_dashboard').then(function (d) { paintDashboard(d.members); paintPeople(d.members); paintInvites(d.invites); })
        .catch(function (e) { toast(e.message); });
    } else {
      Promise.all([rest('GET', '/team_members?select=user_id,role,joined_at'), rest('GET', '/profiles?select=id,email,full_name')])
        .then(function (r) {
          var p = {}; r[1].forEach(function (x) { p[x.id] = x; });
          paintPeople(r[0].map(function (m) { return { user_id: m.user_id, role: m.role, joined_at: m.joined_at, email: (p[m.user_id] || {}).email, full_name: (p[m.user_id] || {}).full_name }; }));
        }).catch(function (e) { toast(e.message); });
    }
  }
  function paintDashboard(members) {
    var sum = { total: 0, hot: 0, appraisal: 0, listed: 0, sold: 0, touches7: 0, calls7: 0 };
    var rows = members.map(function (m) {
      var s = m.stats || {}, st = s.stages || {};
      sum.total += num(s.total); sum.hot += num(st.hot); sum.appraisal += num(st.appraisal); sum.listed += num(st.listed);
      sum.sold += num(st.sold); sum.touches7 += num(s.touches7); sum.calls7 += num(s.calls7);
      return '<tr><td>' + esc(m.full_name || m.email) + ' <span class="role ' + esc(m.role) + '">' + esc(roleName(m.role)) + '</span></td>' +
        '<td class="num">' + num(s.total) + '</td>' +
        ['hot', 'warm', 'appraisal', 'listed', 'sold'].map(function (k) { return '<td class="num">' + num(st[k]) + '</td>'; }).join('') +
        ['calls7', 'sms7', 'emails7', 'contacted7', 'upcoming'].map(function (k) { return '<td class="num">' + num(s[k]) + '</td>'; }).join('') +
        '<td>' + (m.stats ? esc(ago(s.last_activity)) : '<span class="muted">not started</span>') + '</td></tr>';
    });
    $('#dash-table').innerHTML = '<thead><tr><th>Agent</th><th class="num">Contacts</th><th class="num">Hot</th><th class="num">Warm</th><th class="num">Appraised</th>' +
      '<th class="num">Listed</th><th class="num">Sold</th><th class="num">Calls 7d</th><th class="num">SMS 7d</th><th class="num">Emails 7d</th>' +
      '<th class="num">People reached 7d</th><th class="num">Appts ahead</th><th>Last activity</th></tr></thead><tbody>' + rows.join('') + '</tbody>';
    $('#dash-tiles').innerHTML = [
      ['Contacts', sum.total], ['Hot leads', sum.hot], ['Appraised', sum.appraisal], ['Listed', sum.listed], ['Sold', sum.sold], ['Activity this week', sum.touches7]
    ].map(function (x) { return '<div class="tile"><span>' + x[0] + '</span><b>' + x[1] + '</b></div>'; }).join('');
  }
  function paintPeople(members) {
    var me = ctx.user.id;
    $('#people').innerHTML = '<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr></thead><tbody>' +
      members.map(function (m) {
        var acts = [];
        if (m.user_id !== me && m.role !== 'owner') {
          if (isOwner()) {
            acts.push('<select data-role="' + m.user_id + '" aria-label="Role"><option value="agent"' + (m.role === 'agent' ? ' selected' : '') + '>Agent</option><option value="admin"' + (m.role === 'admin' ? ' selected' : '') + '>Admin</option></select>');
            acts.push('<button class="btn small" data-owner="' + m.user_id + '">Make owner</button>');
          }
          if (isOwner() || (ctx.role === 'admin' && m.role === 'agent')) acts.push('<button class="btn small danger" data-remove="' + m.user_id + '">Remove</button>');
        }
        return '<tr><td>' + esc(m.full_name || '—') + (m.user_id === me ? ' <span class="muted small">(you)</span>' : '') + '</td><td>' + esc(m.email || '') +
          '</td><td><span class="role ' + m.role + '">' + roleName(m.role) + '</span></td><td>' + (m.joined_at ? fmtDate(m.joined_at) : '') +
          '</td><td><div class="row">' + acts.join('') + '</div></td></tr>';
      }).join('') + '</tbody>';
    $$('[data-role]').forEach(function (s) {
      s.onchange = function () { rpc('set_member_role', { member: s.getAttribute('data-role'), new_role: s.value }).then(function () { toast('Role changed.'); renderTeam(); }).catch(function (e) { toast(e.message); renderTeam(); }); };
    });
    $$('[data-owner]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Make this person the team owner? They will manage billing and roles, and you will become an admin.')) return;
        rpc('transfer_ownership', { member: b.getAttribute('data-owner') }).then(function () { toast('Ownership handed over.'); return recheckAccess(); }).then(renderTeam).catch(function (e) { toast(e.message); });
      };
    });
    $$('[data-remove]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Remove this person from the team? Their own CRM data stays with their account.')) return;
        rpc('remove_member', { member: b.getAttribute('data-remove') }).then(function () { toast('Removed.'); return recheckAccess(); }).then(renderTeam).catch(function (e) { toast(e.message); });
      };
    });
  }
  function inviteLink(tok) { return siteUrl('?invite=' + tok); }
  function paintInvites(invs) {
    $('#invites').innerHTML = invs.length ? '<h2>Waiting to join</h2>' + invs.map(function (i) {
      return '<div class="inv"><div class="who"><b>' + esc(i.email) + '</b> <span class="role ' + i.role + '">' + roleName(i.role) + '</span><br><span class="muted small">Link expires ' + fmtDate(i.expires_at) + '</span></div>' +
        '<button class="btn small" data-copy="' + esc(i.token) + '">Copy link</button>' +
        '<a class="btn small" href="' + mailInvite(i) + '">Email invite</a>' +
        '<button class="btn small danger" data-revoke="' + esc(i.id) + '">Cancel</button></div>';
    }).join('') : '';
    $$('[data-copy]').forEach(function (b) { b.onclick = function () { copy(inviteLink(b.getAttribute('data-copy'))); }; });
    $$('[data-revoke]').forEach(function (b) { b.onclick = function () { rpc('revoke_invite', { invite_id: b.getAttribute('data-revoke') }).then(renderTeam).catch(function (e) { toast(e.message); }); }; });
  }
  function mailInvite(i) {
    var who = ctx.user.full_name || ctx.user.email;
    return 'mailto:' + encodeURIComponent(i.email) + '?subject=' + encodeURIComponent('Join ' + (ctx.team.name || 'our team') + ' on ' + (C.appName || 'Real Estate CRM')) +
      '&body=' + encodeURIComponent('Hi,\n\n' + who + ' has invited you to join ' + (ctx.team.name || 'the team') + ' on ' + (C.appName || 'Real Estate CRM') + '.\n\nOpen this link and create your account with this email address (' + i.email + '):\n' + inviteLink(i.token) + '\n\nThe link works for 14 days.');
  }
  function copy(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Invite link copied.'); })
      .catch(function () { prompt('Copy this invite link:', text); });
  }
  $('#f-invite').addEventListener('submit', function (ev) {
    ev.preventDefault(); var f = ev.target;
    rpc('create_invite', { invite_email: f.email.value.trim(), invite_role: f.role.value }).then(function (i) {
      f.reset(); renderTeam(); copy(inviteLink(i.token));
      toast('Invite created and link copied. Send it to ' + i.email + '.', 5000);
    }).catch(function (e) { toast(e.message, 5000); });
  });
  $('#team-rename').addEventListener('click', function () {
    var n = prompt('Team name:', ctx.team.name || ''); if (!n) return;
    rpc('rename_team', { new_name: n }).then(recheckAccess).then(renderTeam).catch(function (e) { toast(e.message); });
  });
  $('#team-refresh').addEventListener('click', function () { pushStats().then(recheckAccess).then(renderTeam); });

  // ── billing ──
  function renderBilling() {
    var t = ctx.team || {}, owner = isOwner(), card = $('#bill-card');
    $('#price-line').textContent = C.priceLabel || '';
    var status, cls;
    if (t.subscription_status === 'past_due') { status = 'Payment failed'; cls = 'bad'; }
    else if (paid(t) && t.subscription_status === 'trialing') { status = 'Subscribed · free until ' + fmtDate(t.trial_ends_at); cls = 'good'; }
    else if (paid(t)) { status = t.cancel_at_period_end ? 'Cancelled · access until ' + fmtDate(t.current_period_end) : 'Active'; cls = t.cancel_at_period_end ? 'warn' : 'good'; }
    else if (new Date(t.trial_ends_at) > new Date()) { status = 'Free trial · ' + daysLeft(t.trial_ends_at) + ' days left'; cls = ''; }
    else { status = t.subscription_status === 'canceled' ? 'Ended' : 'Trial ended'; cls = 'bad'; }
    var colors = { good: 'background:var(--green-soft);color:var(--green)', warn: 'background:var(--amber-soft);color:var(--amber)', bad: 'background:var(--red-soft);color:var(--red)', '': 'background:var(--blue-soft);color:var(--blue-d)' };
    var html = '<div class="plan"><div><h2>' + esc(t.name || 'Your team') + '</h2><span class="status" style="' + colors[cls] + '">' + esc(status) + '</span></div></div>' +
      '<dl class="kv">' +
      '<dt>Price</dt><dd>' + esc(C.priceLabel || '') + '</dd>' +
      '<dt>People in team</dt><dd>' + t.members + '</dd>' +
      (paid(t) ? '<dt>Paid seats</dt><dd>' + t.seats + '</dd>' : '') +
      (paid(t) && t.current_period_end ? '<dt>' + (t.cancel_at_period_end ? 'Access until' : 'Next payment') + '</dt><dd>' + fmtDate(t.current_period_end) + '</dd>' : '') +
      (!paid(t) ? '<dt>Trial ends</dt><dd>' + fmtDate(t.trial_ends_at) + '</dd>' : '') +
      '</dl>';
    if (!owner) {
      html += '<p class="muted">Billing is managed by your team owner.</p>';
    } else if (!paid(t)) {
      html += '<p>Subscribe now and you won\'t be charged until your free trial ends. You pay for one seat per person; you can change the number of seats at checkout and any time after.</p>' +
        '<div class="row wrap"><button class="btn primary" data-act="subscribe">Subscribe</button>' + (t.has_billing ? '<button class="btn" data-act="portal">Billing history</button>' : '') + '</div>';
    } else {
      html += '<div class="row wrap"><label style="flex:0 0 auto">Seats<input id="seat-n" type="number" min="' + Math.max(1, t.members) + '" max="200" value="' + t.seats + '" style="width:90px"></label>' +
        '<button class="btn" data-act="seats" style="align-self:flex-end">Change seats</button></div>' +
        '<p class="muted small">Adding a seat is charged for the rest of this month straight away; removing one gives a credit.</p>' +
        '<div class="row wrap"><button class="btn primary" data-act="portal">Manage billing</button></div>' +
        '<p class="muted small">Update your card, download tax invoices or cancel in Manage billing.</p>';
    }
    card.innerHTML = html;
  }
  function goStripe(name, args) {
    toast('Opening secure checkout…');
    return fn(name, args).then(function (r) { location.href = r.url; }).catch(function (e) { toast(e.message, 6000); });
  }
  function openPortal() { return goStripe('billing-portal'); }
  function handleCheckoutReturn() {
    var q = new URLSearchParams(location.search), c = q.get('checkout');
    if (!c) return;
    history.replaceState(null, '', location.pathname + location.hash);
    if (c === 'cancelled') { toast('Checkout cancelled. Nothing was charged.'); return; }
    toast('Thanks! Confirming your subscription…', 6000);
    var tries = 0;
    (function poll() {
      recheckAccess().then(function () {
        if (paid(ctx.team)) { toast('You\'re subscribed. Thank you!', 5000); if (location.hash === '#billing') renderBilling(); return; }
        if (++tries < 10) setTimeout(poll, 2000);
        else toast('Payment received; it can take a minute to show here.', 6000);
      });
    })();
  }

  // ── help ──
  function renderHelp() {
    $('#support-mail').textContent = C.supportEmail || ''; $('#support-mail').href = 'mailto:' + (C.supportEmail || '');
    $('#install-help').innerHTML = installHelpText();
    $('#billing-help').textContent = 'Every new account gets ' + (C.trialDays || 14) + ' days free. After that it\'s ' + (C.priceLabel || '') +
      ', paid by the team owner by card. Solo agents are a team of one.';
    rest('GET', '/support_requests?select=created_at,topic,message,status&order=created_at.desc&limit=5').then(function (rows) {
      $('#my-requests').innerHTML = rows.length ? '<h2>Your recent messages</h2>' + rows.map(function (r) {
        return '<p class="small"><b>' + fmtDate(r.created_at) + '</b> · ' + esc(r.status) + '<br>' + esc(r.message.slice(0, 140)) + (r.message.length > 140 ? '…' : '') + '</p>';
      }).join('') : '';
    }).catch(function () { });
  }
  $('#f-support').addEventListener('submit', function (ev) {
    ev.preventDefault(); var f = ev.target;
    rest('POST', '/support_requests', { user_id: ctx.user.id, email: ctx.user.email, topic: f.topic.value, message: f.message.value.trim(),
      page: navigator.userAgent.slice(0, 200), app_version: appVersion }, { prefer: 'return=minimal' })
      .then(function () { f.reset(); toast('Thanks, we\'ve got your message and will reply by email.', 5000); renderHelp(); })
      .catch(function (e) { toast(e.message); });
  });

  // ─────────────── install on phone ───────────────
  var installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installPrompt = e; $('#menu-install').hidden = false; });
  function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone; }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function installHelpText() {
    if (isStandalone()) return 'You\'re using the installed app. 👍';
    if (isIOS()) return 'Yes. In Safari, tap the <b>Share</b> button, then <b>Add to Home Screen</b>. It opens full-screen like any other app.';
    return 'Yes. In Chrome, open the menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>. On a computer, use the install icon in the address bar.';
  }
  function maybeShowInstallHint() {
    if (isStandalone() || lsGet('shell_install_hint', false)) return;
    if (!/android|iphone|ipad|ipod/i.test(navigator.userAgent)) return;
    lsSet('shell_install_hint', true);
    banner('Tip: add the CRM to your home screen to open it like an app.', 'How', function () { location.hash = '#help'; hideBanner(); });
  }

  // ─────────────── account menu & shared actions ───────────────
  $('#menu-btn').addEventListener('click', function (e) {
    e.stopPropagation(); var m = $('#menu'); m.hidden = !m.hidden; this.setAttribute('aria-expanded', String(!m.hidden));
  });
  document.addEventListener('click', function () { $('#menu').hidden = true; });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
    var a = b.getAttribute('data-act');
    if (a === 'signout') signOut();
    else if (a === 'export') exportData();
    else if (a === 'subscribe') goStripe('create-checkout');
    else if (a === 'portal') openPortal();
    else if (a === 'seats') {
      var n = parseInt($('#seat-n').value, 10);
      if (!confirm('Change to ' + n + ' seat' + (n === 1 ? '' : 's') + '? Stripe adjusts this month\'s charge.')) return;
      fn('set-seats', { seats: n }).then(function () { toast('Seats updated.'); return recheckAccess(); }).then(renderBilling).catch(function (e2) { toast(e2.message, 6000); });
    }
    else if (a === 'leave') {
      if (!confirm('Leave ' + (ctx.team.name || 'this team') + '? You keep your CRM data and move to a team of your own.')) return;
      rpc('leave_team').then(function () { location.hash = '#crm'; return start(); }).catch(function (e2) { toast(e2.message); });
    }
    else if (a === 'rename-me') {
      var n2 = prompt('Your name:', ctx.user.full_name || ''); if (n2 == null) return;
      rest('PATCH', '/profiles?id=eq.' + ctx.user.id, { full_name: n2.trim() }, { prefer: 'return=minimal' })
        .then(recheckAccess).then(function () { toast('Name saved.'); }).catch(function (e2) { toast(e2.message); });
    }
    else if (a === 'install' && installPrompt) { installPrompt.prompt(); installPrompt = null; $('#menu-install').hidden = true; }
  });
  $('#blocked-subscribe').addEventListener('click', function () {
    if (paid(ctx.team)) { show('scr-app'); paintChrome(); location.hash = '#billing'; route(); } else goStripe('create-checkout');
  });
  $('#blocked-portal').addEventListener('click', openPortal);

  function exportData() {
    var done = function (rows) {
      var out = { exported_at: new Date().toISOString(), account: ctx && ctx.user && ctx.user.email, data: {} };
      rows.forEach(function (r) { var v = r.value; try { v = JSON.parse(v); } catch (e) { } out.data[r.key] = v; });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
      a.download = 'crm-data-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
    (pending.length ? flush() : Promise.resolve()).then(function () {
      return rest('GET', '/crm_state?select=key,value&user_id=eq.' + ctx.user.id);
    }).then(done).catch(function () {
      done(syncKeys().map(function (k) { return { key: k, value: localStorage.getItem(k) }; }));
    });
  }

  function signOut() {
    var go = function () {
      clearLocal(); lsDel(S_OWNER); lsDel(S_SESSION);
      $('#crm-frame').srcdoc = '';
      var s = session; session = null; ctx = null;
      if (s) fetch(API + '/auth/v1/logout', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token } }).catch(function () { });
      showAuth('signin');
    };
    if (pending.length) {
      flush().then(function () {
        if (pending.length && !confirm('Some changes haven\'t reached the cloud yet (you may be offline). Sign out anyway and lose them?')) return;
        go();
      });
    } else go();
  }

  // ─────────────── go ───────────────
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { }); });
  }
  authSetup();
  if (!API || /YOUR-PROJECT/.test(API)) {
    show('scr-loading'); $('#loading-msg').textContent = 'This site is not connected to its database yet (see web/config.js).';
    return;
  }
  var r = readAuthRedirect();
  session = session || lsGet(S_SESSION, null);
  if (r.error) showAuth('signin', r.error);
  else if (r.type === 'recovery' && session) showAuth('newpass');
  else if (session) start();
  else showAuth(new URLSearchParams(location.search).get('invite') ? 'signup' : 'signin');

  // for tests
  window.__shell = { flush: flush, pushStats: pushStats, computeStats: computeStats, pending: function () { return pending.slice(); } };
})();
