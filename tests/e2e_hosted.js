// End-to-end test of the hosted app against tests/mock_supabase.js.
//   node tests/e2e_hosted.js http://localhost:8787 [screenshot-dir]
const { chromium } = require('playwright');
const { Pool } = require('pg');
const BASE = process.argv[2] || 'http://localhost:8787';
const SHOTS = process.argv[3] || null;
const db = new Pool();
let pass = 0, fail = 0;
const errors = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '\n       ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(200); } return null; }
async function newUser(browser, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1300, height: 850 } }, opts));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push((opts.label || 'page') + ': ' + e.message));
  p.on('dialog', (d) => d.type() === 'prompt' ? d.accept('Scarborough') : d.accept());
  return p;
}
const crm = (p) => p.frameLocator('#crm-frame');
const frame = (p) => p.frames().find((f) => f.name() !== '' || f.parentFrame()) ;
async function crmFrame(p) { return until(async () => { const f = p.frames().find((x) => x.parentFrame() === p.mainFrame()); return f && (await f.evaluate(() => typeof window.ME === 'object')) ? f : null; }, 15000); }
async function signUp(p, name, email, pass) {
  await p.click('[data-auth=signup]').catch(() => {});
  await p.fill('#f-signup [name=name]', name); await p.fill('#f-signup [name=email]', email);
  await p.fill('#f-signup [name=password]', pass); await p.check('#f-signup [name=agree]');
  await p.click('#f-signup button[type=submit]');
}
async function addContact(f, name, addr, street) {
  await f.evaluate(() => openAddContactManual());
  await f.fill('#ac-name', name); await f.fill('#ac-addr', addr); await f.fill('#ac-street', street); await f.fill('#ac-phone', '0400 000 001');
  await f.selectOption('#ac-suburb', '__new');
  await f.evaluate(() => saveAddContact(true));
}
const serverState = async (email, key) => (await db.query(
  'select s.value from public.crm_state s join auth.users u on u.id = s.user_id where u.email = $1 and s.key = $2', [email, key])).rows[0];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });

  console.log('owner signs up and starts a trial');
  const A = await newUser(browser, { label: 'owner' });
  await A.goto(BASE + '/');
  check('sign-in page shows', await A.isVisible('#f-signin'));
  await signUp(A, 'Olivia Owner', 'olivia@agency.test', 'password123');
  check('app opens after sign-up', await until(() => A.isVisible('#scr-app')));
  check('trial shown in top bar', /Trial · 14 days left/.test(await A.textContent('#plan-chip')), await A.textContent('#plan-chip'));
  let f = await crmFrame(A);
  check('CRM loads inside the app', !!f);
  check('My details prefilled from the account', (await f.inputValue('#pf-name').catch(() => '')) === 'Olivia Owner');
  await f.fill('#pf-agency', 'Harbour Realty'); await f.fill('#pf-phone', '0411 222 333');
  await f.click('#pf-save');
  f = await until(async () => { const x = await crmFrame(A); return x && (await x.evaluate(() => ME.isSet)) ? x : null; });
  check('profile saved in the CRM', !!f);
  await addContact(f, 'Sam Seller', '4 Ocean St', 'Ocean');
  await until(async () => (await A.evaluate(() => window.__shell.pending().length)) === 0 && /Synced/.test(await A.textContent('#sync')));
  const row = await until(() => serverState('olivia@agency.test', 'crm_data_v4'));
  check('contact saved to the cloud', row && /Sam Seller/.test(row.value));
  check('profile saved to the cloud', /Harbour Realty/.test(((await serverState('olivia@agency.test', 'crm_profile')) || {}).value || ''));
  if (SHOTS) await A.screenshot({ path: SHOTS + '/1-crm.png' });

  console.log('same owner on a phone');
  const A2 = await newUser(browser, { label: 'owner-phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await A2.goto(BASE + '/');
  await A2.fill('#f-signin [name=email]', 'olivia@agency.test'); await A2.fill('#f-signin [name=password]', 'password123');
  await A2.click('#f-signin button[type=submit]');
  const f2 = await crmFrame(A2);
  const names = f2 && await until(() => f2.evaluate(() => data.map((c) => c.n).join('|')));
  check('contacts appear on the other device', names === 'Sam Seller', names);
  check('profile appears on the other device', f2 && await f2.evaluate(() => ME.agency) === 'Harbour Realty');
  await addContact(f2, 'Pat Buyer', '9 Hill Rd', 'Hill');
  await until(async () => (await A2.evaluate(() => window.__shell.pending().length)) === 0);
  await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  check('first device is told about the change', !!(await until(() => A.isVisible('#banner'))));
  await A.click('#banner .btn:not(.ghost)');
  f = await crmFrame(A);
  check('first device loads the change', f && (await until(() => f.evaluate(() => data.length === 2))));
  if (SHOTS) await A2.screenshot({ path: SHOTS + '/2-phone.png' });

  console.log('team: invite an agent');
  await A.goto(BASE + '/#team'); await crmFrame(A);
  await A.fill('#f-invite [name=email]', 'alex@agency.test'); await A.click('#f-invite button[type=submit]');
  const inv = await until(async () => (await db.query("select token from public.invites where email = 'alex@agency.test'")).rows[0]);
  check('invite created', !!inv);
  check('invite listed with copy link', !!(await until(() => A.isVisible('[data-copy]'))));
  await A.click('#invites [data-mail]');
  const mailHref = await A.getAttribute('#invite-mail', 'href');
  check('Email invite shows the message, with Open in email app', await A.isVisible('#invite-dlg') && await A.isVisible('#invite-mail') && /^mailto:alex%40agency\.test\?subject=/.test(mailHref) && mailHref.indexOf(inv.token) > 0, mailHref);
  await A.click('#invite-dlg button[value=close]');
  const B = await newUser(browser, { label: 'agent' });
  await B.goto(BASE + '/?invite=' + inv.token);
  check('invite link opens sign-up with a note', await B.isVisible('#f-signup') && await B.isVisible('#invite-note'));
  await signUp(B, 'Alex Agent', 'alex@agency.test', 'password456');
  const fb = await crmFrame(B);
  check('agent joins the team', /Agent · Olivia Owner's team/.test(await B.textContent('#menu-role')), await B.textContent('#menu-role'));
  check("agent starts with an empty CRM (can't see owner's contacts)", fb && (await fb.evaluate(() => data.length)) === 0);
  await fb.fill('#pf-agency', 'Harbour Realty'); await fb.fill('#pf-phone', '0400 999 888'); await fb.click('#pf-save');
  const fb2 = await until(async () => { const x = await crmFrame(B); return x && (await x.evaluate(() => ME.isSet)) ? x : null; });
  await addContact(fb2, 'Lee Landlord', '1 Bay Pde', 'Bay');
  await addContact(fb2, 'Kim Keen', '2 Bay Pde', 'Bay');
  await until(async () => (await B.evaluate(() => window.__shell.pending().length)) === 0);
  await B.evaluate(() => window.__shell.pushStats());
  await B.goto(BASE + '/#team'); await crmFrame(B);
  check('agent does not see the dashboard or invites', await B.isHidden('#dash') && await B.isHidden('#invite-box'));
  check('agent sees the team list', /Olivia Owner/.test(await B.textContent('#people')));
  await B.goto(BASE + '/#billing'); await crmFrame(B);
  check('agent sees billing is managed by the owner', /managed by your team owner/.test(await B.textContent('#bill-card')));

  console.log('dashboard');
  await A.goto(BASE + '/#team'); await crmFrame(A);
  await A.click('#team-refresh');
  const dash = await until(async () => { const t = await A.textContent('#dash-table'); return /Alex Agent/.test(t) && /Olivia Owner/.test(t) ? t : null; });
  check('owner sees each agent on the dashboard', !!dash, await A.textContent('#dash-table'));
  const alexRow = await A.evaluate(() => [...document.querySelectorAll('#dash-table tbody tr')].map((r) => r.innerText).find((t) => /Alex/.test(t)));
  check("dashboard shows the agent's contact count", /Alex Agent[\s\S]*\t2\t/.test(alexRow || ''), alexRow);
  check('dashboard shows no client names', !/Lee Landlord|Kim Keen/.test(await A.textContent('#tab-team')));
  // a team member can write anything into their own figures; it must never run on the owner's screen
  await db.query(`update public.member_stats set stats = '{"total": "<img src=x onerror=window.__xss=1>", "stages": {"hot": "<b>9</b>"}}' where user_id = (select id from auth.users where email = 'alex@agency.test')`);
  await A.click('#team-refresh'); await sleep(1500);
  check("a member's figures can't inject code into the dashboard", !(await A.evaluate(() => window.__xss)) && !(await A.$('#dash-table img')));
  if (SHOTS) await A.screenshot({ path: SHOTS + '/3-team.png', fullPage: true });
  await A.selectOption('select[data-role]', 'admin');
  check('owner makes the agent an admin', !!(await until(async () => (await db.query("select role from public.team_members m join auth.users u on u.id = m.user_id where u.email = 'alex@agency.test'")).rows[0].role === 'admin')));

  console.log('billing');
  await A.goto(BASE + '/#billing'); await crmFrame(A);
  check('billing shows price and trial', /\$100 AUD per agent/.test(await A.textContent('#bill-card')) && /Free trial/.test(await A.textContent('#bill-card')));
  if (SHOTS) await A.screenshot({ path: SHOTS + '/4-billing.png' });
  await A.click('[data-act=subscribe]');
  await until(() => A.url().includes('checkout=success') || /Subscribed/.test(''), 5000);
  check('after checkout the app shows Subscribed', !!(await until(async () => /Subscribed/.test(await A.textContent('#plan-chip')), 12000)), await A.textContent('#plan-chip'));
  const team = (await db.query("select t.* from public.teams t join public.team_members m on m.team_id = t.id join auth.users u on u.id = m.user_id where u.email = 'olivia@agency.test'")).rows[0];
  check('one seat per person bought', team.seats === 2, 'seats=' + team.seats);
  await A.goto(BASE + '/#billing'); await crmFrame(A);
  check('owner can change seats and manage billing', await A.isVisible('#seat-n') && await A.isVisible('[data-act=portal]'));

  console.log('help and support');
  await A.goto(BASE + '/#help'); await crmFrame(A);
  await A.selectOption('#f-support [name=topic]', 'problem'); await A.fill('#f-support [name=message]', 'The call list froze once.');
  await A.click('#f-support button[type=submit]');
  check('support message saved', !!(await until(async () => (await db.query("select 1 from public.support_requests where message like 'The call list froze%'")).rows.length)));
  check("what's new shows release notes", /Test release/.test(await A.textContent('#whatsnew')));

  console.log('subscription ends');
  await db.query("update public.teams set subscription_status = 'canceled', trial_ends_at = now() - interval '1 day' where id = $1", [team.id]);
  await A.reload();
  check('owner is blocked with Subscribe and data export', !!(await until(() => A.isVisible('#scr-blocked'))) && await A.isVisible('#blocked-subscribe'));
  const dl = A.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await A.click('#scr-blocked [data-act=export]');
  const file = await dl;
  check('data can still be downloaded', !!file);
  await B.reload();
  check('team member is blocked and told to ask the owner', !!(await until(() => B.isVisible('#scr-blocked'))) && /ask your team owner/i.test(await B.textContent('#blocked-msg')));
  if (SHOTS) await B.screenshot({ path: SHOTS + '/5-blocked.png' });

  console.log('sign out');
  await db.query("update public.teams set subscription_status = 'active' where id = $1", [team.id]);
  await A2.reload(); await crmFrame(A2);
  await A2.click('#menu-btn'); await A2.click('#menu [data-act=signout]');
  check('sign-out returns to sign-in', !!(await until(() => A2.isVisible('#f-signin'))));
  check('sign-out removes CRM data from the device', (await A2.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('crm_')).length)) === 0);

  console.log('the CRM frame only writes for the account it was opened for');
  await B.reload();
  const gf = await crmFrame(B);
  const owner0 = await B.evaluate(() => localStorage.getItem('shell_owner'));
  await gf.evaluate(() => localStorage.setItem('crm_guard_test', 'mine'));
  check('frame writes while its account is signed in', (await B.evaluate(() => localStorage.getItem('crm_guard_test'))) === 'mine');
  await B.evaluate(() => localStorage.setItem('shell_owner', JSON.stringify('someone-else')));
  await gf.evaluate(() => { localStorage.setItem('crm_guard_test', 'stale'); localStorage.removeItem('crm_data_v4'); }).catch(() => {});
  const leftAlone = await B.evaluate(() => [localStorage.getItem('crm_guard_test'), localStorage.getItem('crm_data_v4') !== null]);
  await B.evaluate((o) => { localStorage.setItem('shell_owner', o); localStorage.removeItem('crm_guard_test'); }, owner0);
  check("frame can't write once the device belongs to someone else", leftAlone[0] === 'mine' && leftAlone[1], JSON.stringify(leftAlone));
  await B.reload(); await crmFrame(B);

  console.log('email links');
  const mal = await (await fetch(BASE + '/auth/v1/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'x' },
    body: JSON.stringify({ email: 'mallory@else.test', password: 'password123', data: { full_name: 'Mallory' } }) })).json();
  let nth = 0;
  const link = (type) => BASE + '/?n=' + (++nth) + '#access_token=' + mal.access_token + '&refresh_token=' + mal.refresh_token + '&expires_in=3600&type=' + type;
  const V = await newUser(browser, { label: 'visitor' });
  await V.goto(link('signup'));
  check("a link from someone else's sign-up does not sign this browser in", !!(await until(() => V.isVisible('#f-signin'))) && !(await V.evaluate(() => localStorage.getItem('shell_session'))));
  check('…it just says the email is confirmed', /confirmed/.test(await V.textContent('#toast')));
  await V.goto(BASE + '/'); await V.goto(link('recovery'));
  check('a reset link from another browser asks for a new link instead', !!(await until(() => V.isVisible('#f-forgot'))) && !(await V.evaluate(() => localStorage.getItem('shell_session'))));
  const bId = await B.evaluate(() => JSON.parse(localStorage.getItem('shell_session')).user.id);
  await B.goto(link('signup'));
  await until(() => B.isVisible('#scr-app'));
  check('a link for another account never replaces the person signed in', (await B.evaluate(() => JSON.parse(localStorage.getItem('shell_session')).user.id)) === bId);
  check('…and says so', !!(await until(async () => /different account/.test(await B.textContent('#toast')))));
  await V.goto(BASE + '/'); await V.evaluate(() => localStorage.setItem('shell_auth_started', String(Date.now())));
  await V.goto(link('signup'));
  check('the link works in the browser where the sign-up started', !!(await crmFrame(V)) && (await V.evaluate(() => JSON.parse(localStorage.getItem('shell_session')).user.id)) === mal.user.id);

  console.log('deleting an account');
  await V.click('#menu-btn'); await V.click('#menu [data-act=delete-account]');
  check('delete asks for confirmation first', await V.isVisible('#delete-dlg') && await V.isDisabled('#delete-go'));
  await V.fill('#delete-confirm', 'delete');
  check('typing DELETE unlocks the button', await V.isEnabled('#delete-go'));
  if (SHOTS) await V.screenshot({ path: SHOTS + '/6-delete.png' });
  await V.click('#delete-go');
  check('after deleting, back to sign-in with a message', !!(await until(() => V.isVisible('#f-signin'))) && /deleted/.test(await V.textContent('#toast')));
  check('the account is gone from the database', !(await db.query("select 1 from auth.users where email = 'mallory@else.test'")).rows.length);
  check('nothing of it is left on the device', (await V.evaluate(() => Object.keys(localStorage).filter((k) => /^crm_|^shell_(session|owner)$/.test(k)).length)) === 0);
  await A.goto(BASE + '/'); await crmFrame(A);
  await A.click('#menu-btn'); await A.click('#menu [data-act=delete-account]');
  await A.fill('#delete-confirm', 'DELETE'); await A.click('#delete-go');
  check('an owner with a team is told what to do first', !!(await until(async () => /own a team with other people/.test(await A.textContent('#delete-err')))));
  check('…and nothing was deleted', (await db.query("select 1 from auth.users where id = $1", [team.owner_id || (await db.query("select user_id from public.team_members where team_id = $1 and role = 'owner'", [team.id])).rows[0].user_id])).rows.length === 1);

  check('no script errors', errors.length === 0, errors.join('\n       '));
  await browser.close(); await db.end();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
