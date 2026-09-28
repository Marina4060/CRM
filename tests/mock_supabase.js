// A stand-in for Supabase, for testing the hosted app on one machine.
// Database calls run against a real Postgres (with the real migration, row
// security and functions) as the signed-in user; login, file storage and the
// Stripe functions are faked.
//
//   PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=crm_e2e node tests/mock_supabase.js 8787
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = Number(process.argv[2] || 8787);
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const APP_FILES = { 'crm.html': path.join(ROOT, 'index.html'), 'version.json': path.join(__dirname, 'fixtures', 'version.json') };
const pool = new Pool();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unb64 = (s) => { try { return JSON.parse(Buffer.from(s, 'base64url').toString()); } catch (e) { return null; } };
function sessionFor(u) {
  return { access_token: 'tok.' + b64({ sub: u.id, email: u.email, exp: Date.now() + 3600e3 }), token_type: 'bearer',
    expires_in: 3600, refresh_token: 'ref.' + b64({ sub: u.id, email: u.email }), user: { id: u.id, email: u.email } };
}
function claims(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!t.startsWith('tok.')) return null;
  const c = unb64(t.slice(4));
  return c && c.exp > Date.now() ? c : null;
}
function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'application/json' });
  res.end(body == null ? '' : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)));
}
function readBody(req) {
  return new Promise((ok) => { let d = ''; req.on('data', (c) => d += c); req.on('end', () => { try { ok(d ? JSON.parse(d) : null); } catch (e) { ok(null); } }); });
}
// run SQL as the signed-in user, like PostgREST does
async function asUser(sub, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('role', 'authenticated', true), set_config('request.jwt.claim.sub', $1, true)", [sub]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}
function pgError(res, e) {
  const status = e.code === '42501' ? 403 : e.code === 'P0001' ? 400 : /^23/.test(e.code || '') ? 409 : 400;
  send(res, status, { code: e.code, message: e.message });
}
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error('bad identifier ' + s), { code: '42601' }); return '"' + s + '"'; };

// just enough of PostgREST's query language: select, eq/in/is/gt filters, order, limit
function parseQuery(q, params) {
  const where = []; let select = '*', order = '', limit = '', onConflict = null;
  for (const [k, v] of q) {
    if (k === 'select') select = v.split(',').map(ident).join(', ');
    else if (k === 'order') order = ' order by ' + v.split(',').map((o) => { const [c, d] = o.split('.'); return ident(c) + (d === 'desc' ? ' desc' : ''); }).join(', ');
    else if (k === 'limit') limit = ' limit ' + Number(v);
    else if (k === 'on_conflict') onConflict = v.split(',').map(ident);
    else {
      const m = v.match(/^(eq|gt|lt|is|in)\.(.*)$/s); if (!m) continue;
      if (m[1] === 'in') {
        const items = m[2].replace(/^\(|\)$/g, '').match(/"[^"]*"|[^,]+/g) || [];
        where.push(ident(k) + ' = any($' + params.push(items.map((x) => x.replace(/^"|"$/g, ''))) + ')');
      } else if (m[1] === 'is') where.push(ident(k) + ' is ' + (m[2] === 'null' ? 'null' : 'not null'));
      else where.push(ident(k) + { eq: ' = ', gt: ' > ', lt: ' < ' }[m[1]] + '$' + params.push(m[2]));
    }
  }
  return { select, where: where.length ? ' where ' + where.join(' and ') : '', order, limit, onConflict };
}

async function rest(req, res, url, sub) {
  const m = url.pathname.match(/^\/rest\/v1\/(rpc\/)?([a-z_]+)$/);
  if (!m) return send(res, 404, { message: 'not found' });
  const body = await readBody(req);
  const prefer = req.headers.prefer || '';
  try {
    const out = await asUser(sub, async (c) => {
      if (m[1]) {
        const args = Object.keys(body || {}); const vals = args.map((a) => body[a]);
        const r = await c.query('select public.' + ident(m[2]) + '(' + args.map((a, i) => ident(a) + ' => $' + (i + 1)).join(', ') + ') as v', vals);
        return { status: 200, body: r.rows[0].v };
      }
      const params = []; const q = parseQuery(url.searchParams, params); const t = 'public.' + ident(m[2]);
      if (req.method === 'GET') return { status: 200, body: (await c.query('select ' + q.select + ' from ' + t + q.where + q.order + q.limit, params)).rows };
      if (req.method === 'DELETE') { await c.query('delete from ' + t + q.where, params); return { status: 204 }; }
      if (req.method === 'PATCH') {
        const cols = Object.keys(body);
        const set = cols.map((k) => ident(k) + ' = $' + params.push(body[k])).join(', ');
        await c.query('update ' + t + ' set ' + set + q.where, params); return { status: 204 };
      }
      if (req.method === 'POST') {
        const rows = Array.isArray(body) ? body : [body]; const cols = Object.keys(rows[0]); const p2 = [];
        const values = rows.map((r) => '(' + cols.map((k) => '$' + p2.push(typeof r[k] === 'object' && r[k] !== null ? JSON.stringify(r[k]) : r[k])).join(', ') + ')').join(', ');
        let sql = 'insert into ' + t + ' (' + cols.map(ident).join(', ') + ') values ' + values;
        if (q.onConflict && /ignore-duplicates/.test(prefer)) sql += ' on conflict (' + q.onConflict.join(', ') + ') do nothing';
        else if (q.onConflict && /merge-duplicates/.test(prefer)) {
          sql += ' on conflict (' + q.onConflict.join(', ') + ') do update set ' +
            cols.filter((k) => !q.onConflict.includes(ident(k))).map((k) => ident(k) + ' = excluded.' + ident(k)).join(', ');
        }
        if (/return=representation/.test(prefer)) return { status: 201, body: (await c.query(sql + ' returning ' + q.select, p2)).rows };
        await c.query(sql, p2); return { status: 201 };
      }
      return { status: 405, body: { message: 'method' } };
    });
    send(res, out.status, out.body === undefined ? null : out.body);
  } catch (e) { pgError(res, e); }
}

async function auth(req, res, url) {
  const body = (await readBody(req)) || {};
  const grant = url.searchParams.get('grant_type');
  if (url.pathname === '/auth/v1/signup') {
    const ex = await pool.query('select id from auth.users where lower(email) = lower($1)', [body.email]);
    if (ex.rows.length) return send(res, 422, { error_code: 'user_already_exists', msg: 'User already registered' });
    const r = await pool.query('insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning id, email',
      [body.email, body.password, JSON.stringify(body.data || {})]);
    return send(res, 200, sessionFor(r.rows[0]));
  }
  if (url.pathname === '/auth/v1/token' && grant === 'password') {
    const r = await pool.query('select id, email from auth.users where lower(email) = lower($1) and encrypted_password = $2', [body.email, body.password]);
    if (!r.rows.length) return send(res, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    return send(res, 200, sessionFor(r.rows[0]));
  }
  if (url.pathname === '/auth/v1/token' && grant === 'refresh_token') {
    const c = unb64(String(body.refresh_token || '').slice(4));
    if (!c) return send(res, 400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
    return send(res, 200, sessionFor({ id: c.sub, email: c.email }));
  }
  if (url.pathname === '/auth/v1/user' && req.method === 'PUT') {
    const c = claims(req); if (!c) return send(res, 401, { msg: 'no' });
    await pool.query('update auth.users set encrypted_password = $1 where id = $2', [body.password, c.sub]);
    return send(res, 200, { id: c.sub, email: c.email });
  }
  if (url.pathname === '/auth/v1/recover' || url.pathname === '/auth/v1/logout') return send(res, 200, {});
  send(res, 404, { msg: 'not found' });
}

async function storage(req, res, url, sub) {
  const m = url.pathname.match(/^\/storage\/v1\/object\/authenticated\/app\/(.+)$/);
  if (!m || !APP_FILES[m[1]]) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
  const ok = await asUser(sub, (c) => c.query("select count(*)::int n from storage.objects where bucket_id = 'app' and name = $1", [m[1]]));
  if (!ok.rows[0].n) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
  send(res, 200, fs.readFileSync(APP_FILES[m[1]]), m[1].endsWith('.json') ? 'application/json' : 'text/html');
}

// the Stripe functions, faked: checkout "succeeds" when the test visits /__test/stripe
async function functions(req, res, url, sub) {
  const body = (await readBody(req)) || {};
  const r = await pool.query("select m.role, t.* from public.team_members m join public.teams t on t.id = m.team_id where m.user_id = $1", [sub]);
  const t = r.rows[0];
  if (!t || t.role !== 'owner') return send(res, 403, { error: 'Only the team owner can manage billing.' });
  const name = url.pathname.split('/').pop();
  const LIMIT = { per_user: null, agency_10: 10, agency_20: 20 };
  const n = (await pool.query('select count(*)::int n from public.team_members where team_id = $1', [t.id])).rows[0].n;
  if (name === 'create-checkout') {
    const plan = body.plan || t.plan;
    if (LIMIT[plan] && n > LIMIT[plan]) return send(res, 409, { error: 'Your team is too big for that plan.' });
    return send(res, 200, { url: '/__test/stripe?team=' + t.id + '&plan=' + plan + '&seats=' + (LIMIT[plan] || n) });
  }
  if (name === 'change-plan') {
    if (LIMIT[body.plan] && n > LIMIT[body.plan]) return send(res, 409, { error: 'Your team is too big for that plan.' });
    await pool.query('update public.teams set plan = $1, seats = $2 where id = $3', [body.plan, LIMIT[body.plan] || n, t.id]);
    return send(res, 200, { plan: body.plan });
  }
  if (name === 'set-seats') {
    await pool.query('update public.teams set seats = $1 where id = $2', [body.seats, t.id]);
    return send(res, 200, { seats: body.seats });
  }
  if (name === 'billing-portal') return send(res, 200, { url: '/__test/portal' });
  send(res, 404, { error: 'no such function' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  try {
    if (url.pathname.startsWith('/auth/v1/')) return await auth(req, res, url);
    if (/^\/(rest|storage|functions)\/v1\//.test(url.pathname)) {
      const c = claims(req);
      if (!c) return send(res, 401, { message: 'JWT expired', code: 'PGRST301' });
      if (url.pathname.startsWith('/rest/')) return await rest(req, res, url, c.sub);
      if (url.pathname.startsWith('/storage/')) return await storage(req, res, url, c.sub);
      return await functions(req, res, url, c.sub);
    }
    if (url.pathname === '/__test/stripe') {   // "pay", then return like Stripe does
      await pool.query("update public.teams set subscription_status = 'active', seats = $1, plan = $3, stripe_customer_id = 'cus_' || left(id::text, 8), stripe_subscription_id = 'sub_x', current_period_end = now() + interval '30 days' where id = $2",
        [Number(url.searchParams.get('seats')), url.searchParams.get('team'), url.searchParams.get('plan') || 'per_user']);
      res.writeHead(302, { Location: '/?checkout=success#billing' }); return res.end();
    }
    if (url.pathname === '/__test/portal') return send(res, 200, '<h1>Stripe billing portal (test)</h1>', 'text/html');
    if (url.pathname === '/config.js') {
      return send(res, 200, fs.readFileSync(path.join(WEB, 'config.js'), 'utf8')
        .replace("'https://YOUR-PROJECT.supabase.co'", JSON.stringify('http://localhost:' + PORT))
        .replace("'YOUR-ANON-KEY'", "'test-anon-key'"), 'application/javascript');
    }
    let f = path.join(WEB, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!f.startsWith(WEB) || !fs.existsSync(f)) return send(res, 404, 'not found', 'text/plain');
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    send(res, 200, fs.readFileSync(f), types[path.extname(f)] || 'application/octet-stream');
  } catch (e) { console.error(e); send(res, 500, { message: String(e.message) }); }
}).listen(PORT, () => console.log('mock supabase on http://localhost:' + PORT));
