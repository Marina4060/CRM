/* Demo mode: a stand-in for Supabase and Stripe that runs in the browser.
   Everything is kept in this browser's local storage. It follows the same
   rules as the real database (teams, roles, trial, plans, shared list) so the
   app behaves as it will when it goes live. */
(function () {
  'use strict';
  var BASE = 'https://demo.crm.local';
  window.CRM_CONFIG.supabaseUrl = BASE;
  window.CRM_CONFIG.supabaseAnonKey = 'demo';
  window.CRM_DEMO = true;
  var realFetch = window.fetch.bind(window);
  var DBKEY = 'demo_db_v2';   // v2: starts empty, like the live site
  var DAY = 86400000;
  var LIMIT = { per_user: null, agency_10: 10, agency_20: 20 };

  // the viewer can't show browser dialogs, so questions answer "yes" in the demo
  window.confirm = function () { return true; };
  window.alert = function () { };
  window.prompt = function (m, d) { return d != null && d !== '' ? d : ''; };

  function iso(t) { return new Date(t).toISOString(); }
  function now() { return iso(Date.now()); }
  function uid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }
  function load() { try { return JSON.parse(localStorage.getItem(DBKEY)) || null; } catch (e) { return null; } }
  function save() { try { localStorage.setItem(DBKEY, JSON.stringify(db)); } catch (e) { } }
  function Err(status, message) { this.status = status; this.message = message; }

  // starts empty, exactly like the live site: people sign up and add their own contacts
  function seed() {
    return { users: [], teams: [], members: [], invites: [], crm_state: [], member_stats: [], team_contacts: [], support: [] };
  }
  // an older preview kept sample contacts in this browser: clear them so the demo starts empty
  try { if (localStorage.getItem('demo_db_v1') !== null) localStorage.clear(); } catch (e) { }
  var db = load() || seed(); save();
  window.CRM_DEMO_RESET = function () { try { localStorage.clear(); } catch (e) { } location.reload(); };
  window.CRM_DEMO_END_TRIAL = function () {
    var u = me(); if (!u) return;
    var t = teamOf(u.id); if (!t) return;
    t.trial_ends_at = iso(Date.now() - DAY); t.subscription_status = null; t.seats = 0; save(); location.reload();
  };

  // ── helpers mirroring the database rules ──
  var currentUser = null;
  function me() { return currentUser; }
  function memberOf(userId) { return db.members.filter(function (m) { return m.user_id === userId; })[0] || null; }
  function teamOf(userId) { var m = memberOf(userId); return m ? db.teams.filter(function (t) { return t.id === m.team_id; })[0] : null; }
  function roleOf(userId) { var m = memberOf(userId); return m ? m.role : 'none'; }
  function count(teamId) { return db.members.filter(function (m) { return m.team_id === teamId; }).length; }
  function openInvites(teamId) { return db.invites.filter(function (i) { return i.team_id === teamId && !i.accepted_at && i.expires_at > now(); }); }
  function paid(t) { return ['active', 'trialing', 'past_due'].indexOf(t.subscription_status) >= 0; }
  function shared(t) { return t.plan === 'agency_10' || t.plan === 'agency_20'; }
  function hasAccess(userId) {
    var t = teamOf(userId); if (!t) return false;
    return t.trial_ends_at > now() || (paid(t) && count(t.id) <= Math.max(t.seats, 1));
  }
  function user(id) { return db.users.filter(function (u) { return u.id === id; })[0]; }
  function session(u) {
    return { access_token: 'demo.' + u.id, refresh_token: 'demo-refresh.' + u.id, expires_in: 86400, user: { id: u.id, email: u.email } };
  }

  // ── actions (the database functions) ──
  var rpc = {
    app_context: function (a) {
      var u = me(), cur = memberOf(u.id), inv = null;
      if (a.invite_token) {
        inv = db.invites.filter(function (i) { return i.token === a.invite_token && !i.accepted_at && i.expires_at > now(); })[0];
        if (!inv) throw new Err(400, 'This invite link has expired or was already used.');
        if (inv.email.toLowerCase() !== u.email.toLowerCase()) throw new Err(400, 'This invite was sent to ' + inv.email + '. Sign in with that email address to accept it.');
      }
      if (inv && (!cur || cur.team_id !== inv.team_id)) {
        var it = db.teams.filter(function (x) { return x.id === inv.team_id; })[0], ni = count(inv.team_id);
        if (LIMIT[it.plan] && ni >= LIMIT[it.plan]) throw new Err(400, it.name + ' is full: its plan covers up to ' + LIMIT[it.plan] + ' people. Ask the owner to make room.');
        if (it.plan === 'per_user' && paid(it) && ni >= Math.max(it.seats, 1)) throw new Err(400, it.name + ' has no free paid seat. Ask the owner to add a seat under Billing.');
        if (!paid(it) && ni >= 20) throw new Err(400, it.name + ' is full: during the free trial a team can have up to 20 people.');
        if (cur) {
          var n0 = count(cur.team_id), t0 = teamOf(u.id);
          if (cur.role === 'owner' && n0 > 1) throw new Err(400, 'You own a team with other members. Hand it over or remove them before joining another team.');
          if (cur.role === 'owner' && paid(t0)) throw new Err(400, 'Your own subscription is still active. Cancel it under Billing before joining another team.');
          db.members = db.members.filter(function (m) { return m.user_id !== u.id; });
          if (n0 === 1) db.teams = db.teams.filter(function (t) { return t.id !== cur.team_id; });
        }
        db.members.push({ team_id: inv.team_id, user_id: u.id, role: inv.role, joined_at: now() });
        inv.accepted_at = now();
      } else if (!cur) {
        var t = { id: uid(), name: (u.full_name || u.email.split('@')[0]) + "'s team", created_at: now(), trial_ends_at: u.trial_ends_at,
          plan: 'per_user', seats: 0, subscription_status: null, current_period_end: null, cancel_at_period_end: false, stripe_customer_id: null };
        db.teams.push(t);
        db.members.push({ team_id: t.id, user_id: u.id, role: 'owner', joined_at: now() });
      }
      var team = teamOf(u.id), m = memberOf(u.id);
      // an invite to another team waiting for this email: offered, never accepted silently
      var o = db.invites.filter(function (i) { return i.email.toLowerCase() === u.email.toLowerCase() && !i.accepted_at && i.expires_at > now() && i.team_id !== team.id; }).pop();
      var ot = o && db.teams.filter(function (x) { return x.id === o.team_id; })[0], ob = o && user(o.invited_by);
      return {
        pending_invite: o && ot ? { token: o.token, team_name: ot.name, role: o.role, invited_by: ob ? (ob.full_name || ob.email) : 'Someone' } : null,
        user: { id: u.id, email: u.email, full_name: u.full_name }, role: m.role,
        team: { id: team.id, name: team.name, trial_ends_at: team.trial_ends_at, subscription_status: team.subscription_status, seats: team.seats,
          members: count(team.id), plan: team.plan, plan_limit: LIMIT[team.plan], shared: shared(team),
          current_period_end: team.current_period_end, cancel_at_period_end: team.cancel_at_period_end, has_billing: !!team.stripe_customer_id },
        access: hasAccess(u.id), now: now()
      };
    },
    rename_team: function (a) {
      if (roleOf(me().id) !== 'owner') throw new Err(400, 'Only the team owner can rename the team.');
      teamOf(me().id).name = String(a.new_name || '').trim() || teamOf(me().id).name; return null;
    },
    set_trial_plan: function (a) {
      var u = me(), t = teamOf(u.id);
      if (roleOf(u.id) !== 'owner') throw new Err(400, 'Only the team owner can choose the plan.');
      if (paid(t)) throw new Err(400, 'Your team is subscribed. Use Change plan under Billing.');
      if (LIMIT[a.new_plan] && count(t.id) > LIMIT[a.new_plan]) throw new Err(400, 'Your team has ' + count(t.id) + ' people; that plan covers up to ' + LIMIT[a.new_plan] + '.');
      t.plan = a.new_plan; return null;
    },
    create_invite: function (a) {
      var u = me(), r = roleOf(u.id), t = teamOf(u.id), email = String(a.invite_email || '').trim().toLowerCase();
      if (r !== 'owner' && r !== 'admin') throw new Err(400, 'Only owners and admins can invite people.');
      if (a.invite_role === 'admin' && r !== 'owner') throw new Err(400, 'Only the owner can invite admins.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Err(400, 'Please enter a valid email address.');
      if (db.members.some(function (m) { return m.team_id === t.id && (user(m.user_id) || {}).email === email; })) throw new Err(400, email + ' is already in your team.');
      var used = count(t.id) + openInvites(t.id).length;
      if (LIMIT[t.plan] && used >= LIMIT[t.plan]) throw new Err(400, 'Your plan covers up to ' + LIMIT[t.plan] + ' people.' + (t.plan === 'agency_10' ? ' The owner can switch to Agency 20 under Billing.' : ''));
      if (t.plan === 'per_user' && paid(t) && used >= t.seats) throw new Err(400, 'All ' + t.seats + ' paid seats are in use. The owner can add a seat under Billing.');
      if (!paid(t) && used >= 20) throw new Err(400, 'During the free trial a team can have up to 20 people.');
      db.invites = db.invites.filter(function (i) { return !(i.team_id === t.id && i.email === email && !i.accepted_at); });
      var inv = { id: uid(), team_id: t.id, email: email, role: a.invite_role, invited_by: u.id, token: uid().replace(/-/g, ''), created_at: now(), expires_at: iso(Date.now() + 14 * DAY), accepted_at: null };
      db.invites.push(inv);
      return { id: inv.id, token: inv.token, email: inv.email, role: inv.role, expires_at: inv.expires_at };
    },
    revoke_invite: function (a) { var t = teamOf(me().id); db.invites = db.invites.filter(function (i) { return !(i.id === a.invite_id && i.team_id === t.id); }); return null; },
    set_member_role: function (a) {
      if (roleOf(me().id) !== 'owner') throw new Err(400, 'Only the team owner can change roles.');
      var m = memberOf(a.member); if (!m || m.team_id !== teamOf(me().id).id) throw new Err(400, 'That person is not in your team.');
      m.role = a.new_role; return null;
    },
    transfer_ownership: function (a) {
      if (roleOf(me().id) !== 'owner') throw new Err(400, 'Only the team owner can do this.');
      memberOf(me().id).role = 'admin'; memberOf(a.member).role = 'owner'; return null;
    },
    remove_member: function (a) {
      var mine = roleOf(me().id), them = roleOf(a.member);
      if (them === 'owner') throw new Err(400, 'The owner cannot be removed.');
      if (mine === 'admin' && them !== 'agent') throw new Err(400, 'Admins can only remove agents.');
      if (mine !== 'owner' && mine !== 'admin') throw new Err(400, 'Only owners and admins can remove people.');
      db.members = db.members.filter(function (m) { return m.user_id !== a.member; }); return null;
    },
    leave_team: function () {
      if (roleOf(me().id) === 'owner') throw new Err(400, 'The owner cannot leave. Make someone else owner first.');
      db.members = db.members.filter(function (m) { return m.user_id !== me().id; }); return null;
    },
    team_dashboard: function () {
      var r = roleOf(me().id), t = teamOf(me().id);
      if (r !== 'owner' && r !== 'admin') throw new Err(400, 'Only owners and admins can see the team dashboard.');
      var members = db.members.filter(function (m) { return m.team_id === t.id; }).sort(function (a, b) { return (b.role === 'owner') - (a.role === 'owner') || (a.joined_at < b.joined_at ? -1 : 1); })
        .map(function (m) {
          var u = user(m.user_id), s = db.member_stats.filter(function (x) { return x.user_id === m.user_id; })[0];
          return { user_id: m.user_id, email: u.email, full_name: u.full_name, role: m.role, joined_at: m.joined_at, stats: s ? s.stats : null };
        });
      var sh = null;
      if (shared(t)) {
        var rows = db.team_contacts.filter(function (c) { return c.team_id === t.id; }), stages = {}, by = {}, week = Date.now() - 7 * DAY;
        rows.forEach(function (c) { var st = c.record.stage; if (st) stages[st] = (stages[st] || 0) + 1; });
        members.forEach(function (m) { by[m.user_id] = { added: rows.filter(function (c) { return c.created_by === m.user_id; }).length, calls7: 0, sms7: 0, emails7: 0, touches7: 0, contacted7: 0 }; });
        rows.forEach(function (c) {
          var hit = {};
          (c.activity || []).forEach(function (e) {
            if (!e || !by[e.by] || !(Number(e.ts) >= week)) return;
            var f = by[e.by], ty = String(e.type || '');
            f.touches7++; hit[e.by] = true;
            if (/call/i.test(ty)) f.calls7++; else if (/sms|text/i.test(ty)) f.sms7++; else if (/email/i.test(ty)) f.emails7++;
          });
          Object.keys(hit).forEach(function (k) { by[k].contacted7++; });
        });
        sh = { total: rows.filter(function (c) { return c.record.stage !== 'removed'; }).length, stages: stages, by_member: by };
      }
      return { shared: sh, members: members, invites: openInvites(t.id).map(function (i) { return { id: i.id, email: i.email, role: i.role, token: i.token, expires_at: i.expires_at }; }) };
    }
  };

  // ── tables (with the database's visibility rules) ──
  function inMyTeam(userId) { var a = memberOf(me().id), b = memberOf(userId); return a && b && a.team_id === b.team_id; }
  var tables = {
    profiles: { rows: function () { return db.users.map(function (u) { return { id: u.id, email: u.email, full_name: u.full_name }; }); },
      visible: function (r) { return r.id === me().id || inMyTeam(r.id); },
      patch: function (filter, body) { if (filter.id !== me().id) throw new Err(403, 'permission denied'); user(me().id).full_name = String(body.full_name || '').trim() || null; } },
    team_members: { rows: function () { return db.members; }, visible: function (r) { var m = memberOf(me().id); return m && r.team_id === m.team_id; } },
    crm_state: { rows: function () { return db.crm_state; }, visible: function (r) { return r.user_id === me().id; },
      key: ['user_id', 'key'], canWrite: function (r) { return r.user_id === me().id && hasAccess(me().id) && /^crm_[a-z0-9_-]+$/.test(r.key); } },
    member_stats: { rows: function () { return db.member_stats; }, visible: function (r) { return r.user_id === me().id; },
      key: ['user_id'], canWrite: function (r) { return r.user_id === me().id; } },
    team_contacts: { rows: function () { return db.team_contacts; },
      visible: function (r) { var t = teamOf(me().id); return t && r.team_id === t.id && shared(t); },
      key: ['team_id', 'ckey'], canWrite: function (r) { var t = teamOf(me().id); return t && r.team_id === t.id && shared(t) && hasAccess(me().id); },
      stamp: function (r, old) { r.created_at = old ? old.created_at : now(); r.created_by = old ? old.created_by : me().id; r.updated_by = me().id; } },
    support_requests: { rows: function () { return db.support; }, visible: function (r) { return r.user_id === me().id; },
      canWrite: function (r) { return r.user_id === me().id; }, add: function (r) { r.created_at = now(); r.status = 'open'; db.support.push(r); } }
  };
  var store = { crm_state: 'crm_state', member_stats: 'member_stats', team_contacts: 'team_contacts' };

  function parse(qs) {
    var out = { filters: [], select: null, order: [], limit: null, onConflict: null };
    new URLSearchParams(qs).forEach(function (v, k) {
      if (k === 'select') out.select = v.split(',');
      else if (k === 'order') out.order = v.split(',').map(function (o) { var p = o.split('.'); return [p[0], p[1] === 'desc' ? -1 : 1]; });
      else if (k === 'limit') out.limit = Number(v);
      else if (k === 'on_conflict') out.onConflict = v.split(',');
      else {
        var m = v.match(/^(eq|gt|lt|in)\.([\s\S]*)$/); if (!m) return;
        var val = m[1] === 'in' ? (m[2].replace(/^\(|\)$/g, '').match(/"[^"]*"|[^,]+/g) || []).map(function (x) { return x.replace(/^"|"$/g, ''); }) : m[2];
        out.filters.push([k, m[1], val]);
      }
    });
    return out;
  }
  function match(r, f) {
    return f.every(function (x) {
      var v = r[x[0]];
      if (x[1] === 'eq') return String(v) === x[2];
      if (x[1] === 'in') return x[2].indexOf(String(v)) >= 0;
      if (x[1] === 'gt') return String(v) > x[2];
      if (x[1] === 'lt') return String(v) < x[2];
      return true;
    });
  }
  function pick(r, sel) { if (!sel) return JSON.parse(JSON.stringify(r)); var o = {}; sel.forEach(function (k) { o[k] = r[k] === undefined ? null : JSON.parse(JSON.stringify(r[k])); }); return o; }

  function restCall(method, name, q, body, prefer) {
    var T = tables[name]; if (!T) throw new Err(404, 'not found');
    if (method === 'GET') {
      var rows = T.rows().filter(T.visible).filter(function (r) { return match(r, q.filters); });
      q.order.forEach(function () { });
      if (q.order.length) rows.sort(function (a, b) { for (var i = 0; i < q.order.length; i++) { var k = q.order[i][0], d = q.order[i][1]; if (a[k] < b[k]) return -d; if (a[k] > b[k]) return d; } return 0; });
      if (q.limit) rows = rows.slice(0, q.limit);
      return rows.map(function (r) { return pick(r, q.select); });
    }
    if (method === 'PATCH') { var f = {}; q.filters.forEach(function (x) { f[x[0]] = x[2]; }); T.patch(f, body); return null; }
    if (method === 'DELETE') {
      var list = db[store[name]], keep = [];
      list.forEach(function (r) {
        if (T.visible(r) && match(r, q.filters)) { if (!T.canWrite(r)) throw new Err(403, 'new row violates row-level security policy'); }
        else keep.push(r);
      });
      db[store[name]] = keep; return null;
    }
    if (method === 'POST') {
      var items = Array.isArray(body) ? body : [body], back = [];
      items.forEach(function (it) {
        var r = JSON.parse(JSON.stringify(it));
        if (!T.canWrite(r)) throw new Err(403, 'new row violates row-level security policy for table "' + name + '"');
        if (T.add) { T.add(r); back.push(r); return; }
        var list = db[store[name]], keyCols = T.key;
        var old = list.filter(function (x) { return keyCols.every(function (k) { return x[k] === r[k]; }); })[0];
        if (old && /ignore-duplicates/.test(prefer)) return;
        if (old && !/merge-duplicates/.test(prefer)) throw new Err(409, 'duplicate key');
        r.updated_at = now();
        if (T.stamp) T.stamp(r, old);
        if (old) { Object.keys(r).forEach(function (k) { old[k] = r[k]; }); back.push(old); } else { list.push(r); back.push(r); }
      });
      return /return=representation/.test(prefer) ? back.map(function (r) { return pick(r, q.select); }) : null;
    }
    throw new Err(405, 'method');
  }

  // ── Stripe, simulated: checkout "completes" straight away ──
  function stripeFn(name, body) {
    var u = me(), t = teamOf(u.id);
    if (name === 'delete-account') {
      if (body.confirm !== 'DELETE') throw new Err(400, 'Type DELETE to confirm.');
      var mm = memberOf(u.id);
      if (mm && mm.role === 'owner' && count(t.id) > 1) throw new Err(409, 'You own a team with other people. Make someone else the owner, or remove them, before deleting your account.');
      var mine = function (r) { return r.user_id !== u.id; };
      db.crm_state = db.crm_state.filter(mine); db.member_stats = db.member_stats.filter(mine); db.support = db.support.filter(mine);
      db.invites = db.invites.filter(function (i) { return !(i.email.toLowerCase() === u.email.toLowerCase() && !i.accepted_at); });
      if (mm && mm.role === 'owner') {
        db.teams = db.teams.filter(function (x) { return x.id !== t.id; });
        db.team_contacts = db.team_contacts.filter(function (x) { return x.team_id !== t.id; });
        db.invites = db.invites.filter(function (i) { return i.team_id !== t.id; });
      }
      db.members = db.members.filter(mine);
      db.users = db.users.filter(function (x) { return x.id !== u.id; });
      return { deleted: true };
    }
    if (roleOf(u.id) !== 'owner') throw new Err(403, 'Only the team owner can manage billing.');
    var n = count(t.id);
    if (name === 'create-checkout') {
      var plan = body.plan || t.plan;
      if (LIMIT[plan] && n > LIMIT[plan]) throw new Err(409, 'Your team has ' + n + ' people; that plan covers up to ' + LIMIT[plan] + '.');
      t.plan = plan; t.seats = LIMIT[plan] || Math.max(1, n + openInvites(t.id).length);
      t.subscription_status = t.trial_ends_at > now() ? 'trialing' : 'active';
      t.current_period_end = iso(Math.max(Date.now(), Date.parse(t.trial_ends_at)) + 30 * DAY);
      t.stripe_customer_id = 'cus_demo';
      return { demo: true, message: 'Demo: payment simulated. On the live site this opens Stripe\'s secure checkout.' };
    }
    if (name === 'change-plan') {
      if (LIMIT[body.plan] && n > LIMIT[body.plan]) throw new Err(409, 'Your team has ' + n + ' people; that plan covers up to ' + LIMIT[body.plan] + '.');
      t.plan = body.plan; t.seats = LIMIT[body.plan] || n; return { plan: body.plan };
    }
    if (name === 'set-seats') { t.seats = Number(body.seats); return { seats: t.seats }; }
    if (name === 'billing-portal') return { demo: true, message: 'Demo: on the live site this opens Stripe, where the owner updates the card, downloads invoices or cancels.' };
    throw new Err(404, 'no such function');
  }

  // ── the CRM itself, with the dialog stand-ins added ──
  var SHIM = '<script>window.confirm=function(){return true};window.alert=function(){};' +
    'window.prompt=function(m,d){return d!=null&&d!==""?d:(/suburb/i.test(m)?"Cottesloe":"")};</' + 'script>';
  function serveFile(name) {
    return realFetch(name).then(function (r) { return r.text(); }).then(function (txt) {
      if (name === 'crm.html') txt = txt.replace(/<head>/i, '<head>' + SHIM);
      return new Response(txt, { status: 200, headers: { 'Content-Type': name.slice(-4) === 'json' ? 'application/json' : 'text/html' } });
    });
  }

  function json(status, body) { return new Response(body == null ? '' : JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } }); }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    if (url.indexOf(BASE) !== 0) return realFetch(input, init);
    init = init || {};
    var method = (init.method || 'GET').toUpperCase(), headers = init.headers || {};
    var body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch (e) { }
    var u = new URL(url), path = u.pathname;
    var token = String(headers.Authorization || headers.authorization || '').replace(/^Bearer /, '');
    currentUser = token.indexOf('demo.') === 0 ? user(token.slice(5)) || null : null;
    return new Promise(function (ok) { setTimeout(ok, 60 + Math.random() * 120); }).then(function () {
      try {
        // sign-in
        if (path === '/auth/v1/signup') {
          var email = String(body.email || '').trim().toLowerCase();
          if (db.users.some(function (x) { return x.email === email; })) return json(422, { error_code: 'user_already_exists', msg: 'User already registered' });
          if (String(body.password || '').length < 8) return json(422, { error_code: 'weak_password', msg: 'Password should be at least 8 characters' });
          var nu = { id: uid(), email: email, password: body.password, full_name: (body.data && body.data.full_name) || null, created_at: now(), trial_ends_at: iso(Date.now() + 14 * DAY) };
          db.users.push(nu); save(); return json(200, session(nu));
        }
        if (path === '/auth/v1/token') {
          if (u.searchParams.get('grant_type') === 'refresh_token') {
            var ru = user(String(body.refresh_token || '').replace('demo-refresh.', ''));
            return ru ? json(200, session(ru)) : json(400, { msg: 'Invalid Refresh Token' });
          }
          var lu = db.users.filter(function (x) { return x.email === String(body.email || '').trim().toLowerCase() && x.password === body.password; })[0];
          return lu ? json(200, session(lu)) : json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        }
        if (path === '/auth/v1/user') { if (!currentUser) return json(401, {}); currentUser.password = body.password; save(); return json(200, {}); }
        if (path === '/auth/v1/recover' || path === '/auth/v1/logout') return json(200, {});
        if (!currentUser) return json(401, { message: 'JWT expired' });
        // storage: only people with access can download the CRM
        var sm = path.match(/^\/storage\/v1\/object\/authenticated\/app\/(.+)$/);
        if (sm) return hasAccess(currentUser.id) ? serveFile(sm[1]) : json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
        var fm = path.match(/^\/functions\/v1\/(.+)$/);
        if (fm) { var fr = stripeFn(fm[1], body || {}); save(); return json(200, fr); }
        var rm = path.match(/^\/rest\/v1\/rpc\/(.+)$/);
        if (rm) { if (!rpc[rm[1]]) return json(404, { message: 'no such function' }); var rr = rpc[rm[1]](body || {}); save(); return json(200, rr); }
        var tm = path.match(/^\/rest\/v1\/(.+)$/);
        if (tm) { var out = restCall(method, tm[1], parse(u.search), body, String(headers.Prefer || '')); save(); return json(method === 'POST' ? 201 : 200, out); }
        return json(404, { message: 'not found' });
      } catch (e) {
        if (e instanceof Err) return json(e.status, { message: e.message });
        console.error(e); return json(500, { message: String(e.message || e) });
      }
    });
  };
})();
