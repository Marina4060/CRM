// End-to-end test of the agency plans' shared contact list, against tests/mock_supabase.js.
//   node tests/e2e_agency.js http://localhost:8787 [screenshot-dir]
const { chromium } = require('playwright');
const { Pool } = require('pg');
const BASE = process.argv[2] || 'http://localhost:8787';
const SHOTS = process.argv[3] || null;
const db = new Pool();
let pass = 0, fail = 0;
const errors = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '\n       ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(200); } return null; }
async function newUser(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(label + ': ' + e.message));
  p.on('dialog', (d) => d.type() === 'prompt' ? d.accept('Scarborough') : d.accept());
  return p;
}
async function crmFrame(p) {
  return until(async () => { const f = p.frames().find((x) => x.parentFrame() === p.mainFrame()); return f && (await f.evaluate(() => typeof window.ME === 'object' && typeof data !== 'undefined')) ? f : null; }, 15000);
}
async function signUp(p, name, email) {
  await p.click('[data-auth=signup]').catch(() => {});
  await p.fill('#f-signup [name=name]', name); await p.fill('#f-signup [name=email]', email);
  await p.fill('#f-signup [name=password]', 'password123'); await p.check('#f-signup [name=agree]');
  await p.click('#f-signup button[type=submit]');
}
async function setupProfile(p) {
  let f = await crmFrame(p);
  if (await f.waitForSelector('#pf-agency', { timeout: 6000 }).then(() => true).catch(() => false)) {
    await f.fill('#pf-agency', 'Harbour Realty'); await f.fill('#pf-phone', '0400 111 222'); await f.click('#pf-save');
  }
  return until(async () => { const x = await crmFrame(p); return x && (await x.evaluate(() => ME.isSet)) ? x : null; });
}
async function addContact(f, name, addr, street) {
  await f.evaluate(() => openAddContactManual());
  await f.fill('#ac-name', name); await f.fill('#ac-addr', addr); await f.fill('#ac-street', street); await f.fill('#ac-phone', '0400 000 001');
  await f.selectOption('#ac-suburb', '__new');
  await f.evaluate(() => saveAddContact(true));
}
const settled = (p) => until(async () => /Synced/.test(await p.textContent('#sync')) && !(await p.evaluate(() => localStorage.getItem('shell_team_dirty'))) && (await p.evaluate(() => window.__shell.pending().length)) === 0);
const teamNames = async (team) => (await db.query("select record->>'n' n from public.team_contacts where team_id = $1 order by 1", [team])).rows.map((r) => r.n);
const names = (f) => f.evaluate(() => data.map((c) => c.n).sort().join('|'));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });

  console.log('owner starts on the per-agent plan with a private contact');
  const A = await newUser(browser, 'owner');
  await A.goto(BASE + '/');
  await signUp(A, 'Morgan Principal', 'morgan@bay.test');
  let fa = await setupProfile(A);
  await addContact(fa, 'Early Private', '1 First St', 'First');
  await settled(A);
  const team = (await db.query("select t.id from public.teams t join public.team_members m on m.team_id = t.id join auth.users u on u.id = m.user_id where u.email = 'morgan@bay.test'")).rows[0].id;

  console.log('owner tries Agency 10');
  await A.goto(BASE + '/#billing'); await crmFrame(A);
  check('billing lists the three plans', (await A.$$eval('.plan-card h3', (h) => h.map((x) => x.textContent).join('|'))).replace(/Current/g, '').includes('Agency 10'));
  if (SHOTS) await A.screenshot({ path: SHOTS + '/a1-plans.png', fullPage: true });
  await A.click('[data-plan=agency_10]');
  check('team is on Agency 10', !!(await until(async () => (await db.query('select plan from public.teams where id = $1', [team])).rows[0].plan === 'agency_10')));
  check('team page says the shared list is on', !!(await until(async () => /Shared contact list is on/.test(await A.textContent('#shared-box')))));
  fa = await crmFrame(A);
  check('the CRM now shows the (empty) shared list', (await fa.evaluate(() => data.length)) === 0);
  check('earlier private contacts are offered for sharing', !!(await until(() => A.isVisible('[data-act=share-mine]'))));
  await A.click('[data-act=share-mine]');
  fa = await until(async () => { const f = await crmFrame(A); return f && (await f.evaluate(() => data.length)) === 1 ? f : null; });
  check('private contact added to the shared list', fa && (await names(fa)) === 'Early Private');
  check('…and it is in the database as a shared contact', (await teamNames(team)).join('|') === 'Early Private');
  check('sync shows it is shared', !!(await until(async () => /shared/i.test(await A.textContent('#sync')))), await A.textContent('#sync'));

  console.log('an agent joins and sees the shared list');
  await A.goto(BASE + '/#team'); await crmFrame(A);
  await sleep(1500);
  check('once shared, the offer to share goes away', !(await A.isVisible('[data-act=share-mine]')));
  await A.fill('#f-invite [name=email]', 'riley@bay.test'); await A.click('#f-invite button[type=submit]');
  const inv = await until(async () => (await db.query("select token from public.invites where email = 'riley@bay.test'")).rows[0]);
  const B = await newUser(browser, 'agent');
  await B.goto(BASE + '/?invite=' + inv.token);
  await signUp(B, 'Riley Agent', 'riley@bay.test');
  let fb = await setupProfile(B);
  check("agent sees the owner's contacts", fb && (await until(() => names(fb).then((n) => n === 'Early Private'))));

  console.log('agent adds a contact and logs a call');
  await addContact(fb, 'Agent Lead', '2 Second St', 'Second');
  await fb.evaluate(() => { var i = data.findIndex((c) => c.n === 'Agent Lead'); actLog[i] = [{ type: '📞 Called', note: 'Keen to sell', date: '28/09/26', ts: Date.now() }]; saveActLog(); });
  await settled(B);
  const row = (await db.query("select created_by, activity from public.team_contacts where team_id = $1 and record->>'n' = 'Agent Lead'", [team])).rows[0];
  const riley = (await db.query("select id from auth.users where email = 'riley@bay.test'")).rows[0].id;
  check('agent contact saved to the shared list, credited to the agent', row && row.created_by === riley);
  check('the call is saved with the contact and tagged with the agent', row && row.activity.length === 1 && row.activity[0].by === riley, row && JSON.stringify(row.activity));

  console.log('owner is told and loads the change');
  await A.goto(BASE + '/#crm'); fa = await crmFrame(A);
  await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  check('owner sees "updated by your team"', !!(await until(async () => /updated by your team/.test(await A.textContent('#banner')))));
  await A.click('#banner .btn:not(.ghost)');
  fa = await until(async () => { const f = await crmFrame(A); return f && (await f.evaluate(() => data.length)) === 2 ? f : null; });
  check("owner now has the agent's contact", !!fa);
  check("…with the agent's call on it", fa && (await fa.evaluate(() => { var i = data.findIndex((c) => c.n === 'Agent Lead'); return (actLog[i] || []).length; })) === 1);

  console.log('two people adding at the same time');
  await Promise.all([addContact(fa, 'Owner Same Time', '3 Third St', 'Third'), addContact(fb, 'Agent Same Time', '4 Fourth St', 'Fourth')]);
  await Promise.all([settled(A), settled(B)]);
  const both = await teamNames(team);
  check('neither addition is lost', both.includes('Owner Same Time') && both.includes('Agent Same Time'), both.join('|'));

  console.log("an out-of-date screen can't delete a teammate's work");
  // the owner has not loaded "Agent Same Time"; they change one of their own contacts
  await fa.evaluate(() => { var c = data.find((x) => x.n === 'Owner Same Time'); c.stage = 'hot'; saveToStorage(); });
  await settled(A);
  const after = await teamNames(team);
  check("teammate's contact survives the owner's save", after.includes('Agent Same Time'), after.join('|'));
  check("owner's change is saved", (await db.query("select record->>'stage' s from public.team_contacts where team_id = $1 and record->>'n' = 'Owner Same Time'", [team])).rows[0].s === 'hot');

  console.log('renaming a contact');
  await fb.evaluate(() => { var c = data.find((x) => x.n === 'Agent Lead'); c.n = 'Agent Lead Renamed'; saveToStorage(); });
  await settled(B);
  const renamed = await teamNames(team);
  check('renamed contact replaces the old one (no duplicate)', renamed.includes('Agent Lead Renamed') && !renamed.includes('Agent Lead'), renamed.join('|'));

  console.log('dashboard');
  await A.goto(BASE + '/#team'); await crmFrame(A);
  const tiles = await until(async () => { const t = await A.textContent('#dash-tiles'); return /Shared contacts\s*4/.test(t) ? t : null; });
  check('dashboard counts the shared list', !!tiles, await A.textContent('#dash-tiles'));
  const rrow = await A.evaluate(() => [...document.querySelectorAll('#dash-table tbody tr')].map((r) => r.innerText).find((t) => /Riley/.test(t)));
  check('agent row: 2 contacts added, 1 call this week', /Riley Agent[\s\S]*\t2\t1\t/.test(rrow || ''), rrow);
  if (SHOTS) await A.screenshot({ path: SHOTS + '/a2-team.png', fullPage: true });

  console.log('subscribe to Agency 10');
  await A.goto(BASE + '/#billing'); await crmFrame(A);
  await A.click('[data-act=subscribe]');
  check('subscribed', !!(await until(async () => /Subscribed/.test(await A.textContent('#plan-chip')), 12000)));
  const t2 = (await db.query('select plan, seats from public.teams where id = $1', [team])).rows[0];
  check('Agency 10 covers 10 people', t2.plan === 'agency_10' && t2.seats === 10, JSON.stringify(t2));

  console.log('two tabs: signing out in one must not touch the cloud from the other');
  const B2 = await B.context().newPage();
  B2.on('pageerror', (e) => errors.push('agent tab 2: ' + e.message));
  await B2.goto(BASE + '/#crm'); await crmFrame(B2);
  await sleep(1500);
  const rileyRows = async () => (await db.query("select key, value from public.crm_state where user_id = $1 order by key", [riley])).rows;
  const beforeRows = JSON.stringify(await rileyRows());
  const beforeTeam = (await teamNames(team)).join('|');
  await B.click('#menu-btn'); await B.click('#menu [data-act=signout]');
  await until(() => B.isVisible('#f-signin'));
  await sleep(4000);
  check('shared list untouched after signing out in the other tab', (await teamNames(team)).join('|') === beforeTeam, (await teamNames(team)).join('|'));
  check("agent's own cloud copy untouched", JSON.stringify(await rileyRows()) === beforeRows);
  check('the other tab went back to sign-in', !!(await until(() => B2.isVisible('#f-signin'))));
  console.log('someone else signs in on the same browser');
  await signUp(B, 'Sam Solo', 'sam@elsewhere.test');
  let fs = await setupProfile(B);
  await addContact(fs, 'Sam Private', '9 Ninth St', 'Ninth');
  await settled(B); await sleep(3000);
  check("the new person's contact never reaches the agency's list", !(await teamNames(team)).includes('Sam Private'));
  check("…nor the agent's own cloud copy", !JSON.stringify(await rileyRows()).includes('Sam Private'));
  const fs2 = await until(async () => { await B2.reload(); const f = await crmFrame(B2); return f && (await names(f)) === 'Sam Private' ? f : null; });
  check('the other tab now shows the new person, not the agency list', !!fs2);
  await B2.close();
  await B.click('#menu-btn'); await B.click('#menu [data-act=signout]');
  await until(() => B.isVisible('#f-signin'));
  await B.fill('#f-signin [name=email]', 'riley@bay.test'); await B.fill('#f-signin [name=password]', 'password123'); await B.click('#f-signin button[type=submit]');
  fb = await until(async () => { const f = await crmFrame(B); return f && (await f.evaluate(() => data.length)) === 4 ? f : null; });
  check('agent signs back in to the shared list', !!fb);

  console.log('switching back to per-agent');
  await A.goto(BASE + '/#billing'); await crmFrame(A);
  await A.click('[data-plan=per_user]');
  check('plan switched', !!(await until(async () => (await db.query('select plan from public.teams where id = $1', [team])).rows[0].plan === 'per_user')));
  await B.reload(); fb = await crmFrame(B);
  check('agent is back to their own private list', fb && (await fb.evaluate(() => data.length)) === 0);
  check('the shared list is kept for later', (await teamNames(team)).length === 4);

  console.log('a removed agent keeps nothing');
  await A.goto(BASE + '/#billing'); await crmFrame(A);
  await A.click('[data-plan=agency_10]');
  await until(async () => (await db.query('select plan from public.teams where id = $1', [team])).rows[0].plan === 'agency_10');
  fb = await until(async () => { await B.reload(); const f = await crmFrame(B); return f && (await f.evaluate(() => data.length)) === 4 ? f : null; });
  check('agent has the shared list again', !!fb);
  await A.goto(BASE + '/#team'); await crmFrame(A);
  await A.click(`[data-remove="${riley}"]`);
  await until(async () => !(await db.query('select 1 from public.team_members where user_id = $1 and team_id = $2', [riley, team])).rows.length);
  // the agent's screen is still open and they keep working
  await fb.evaluate(() => { var c = data[0]; c.stage = 'hot'; saveToStorage(); });
  const cleared = await until(async () => { const f = await crmFrame(B); return f && (await f.evaluate(() => data.length)) === 0 ? f : null; }, 20000);
  check("removed agent's screen drops the agency's list", !!cleared);
  await sleep(2500);
  const leaked = (await rileyRows()).filter((r) => /Early Private|Owner Same Time|Agent Same Time/.test(r.value));
  check("the agency's contacts were not copied into the removed agent's account", !leaked.length, leaked.map((r) => r.key).join(','));
  check('the shared list itself is unchanged', (await teamNames(team)).length === 4);

  check('no script errors', errors.length === 0, errors.join('\n       '));
  await browser.close(); await db.end();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
