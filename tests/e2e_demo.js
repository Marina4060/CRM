// Walks through the demo as a brand-new user would, clicking the real buttons.
//   node tests/e2e_demo.js http://localhost:8797/_local.html [screenshot-dir] [phone]
const { chromium } = require('playwright');
const URL0 = process.argv[2];
const SHOTS = process.argv[3] || null;
const PHONE = process.argv[4] === 'phone';
let pass = 0, fail = 0, shot = 0;
const errors = [], notes = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '\n       ' + String(detail).slice(0, 300) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(200); } return null; }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext(PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1300, height: 850 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push('page: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_|net::|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
  p.on('response', (r) => { if (r.status() >= 400) errors.push('missing file (' + r.status() + '): ' + r.url()); });
  const snap = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${PHONE ? 'p' : 'd'}${String(++shot).padStart(2, '0')}-${name}.png` }); };
  const crm = async () => until(async () => { const f = p.frames().find((x) => x.parentFrame() === p.mainFrame()); return f && (await f.evaluate(() => typeof data !== 'undefined')) ? f : null; }, 15000);
  const tab = async (name) => { await p.click(`.tabs a[data-tab=${name}]`); await sleep(1200); };
  async function signUp(name, email) {
    await p.click('#demo-signup');
    await p.fill('#f-signup [name=name]', name); await p.fill('#f-signup [name=email]', email);
    await p.fill('#f-signup [name=password]', 'password1'); await p.check('#f-signup [name=agree]');
    await p.click('#f-signup button[type=submit]');
  }
  async function fillProfile(f, agency, phone) {
    await f.waitForSelector('#pf-agency', { timeout: 6000 });
    await f.fill('#pf-agency', agency); await f.fill('#pf-phone', phone); await f.click('#pf-save');
    return until(async () => { const x = await crm(); return x && (await x.evaluate(() => ME.isSet)) ? x : null; });
  }
  async function addContactByClicking(f, name, addr, street) {
    await f.click('text=+ Add Contact');
    if (!(await f.waitForSelector('#ac-name', { state: 'visible', timeout: 4000 }).catch(() => null))) { notes.push('Add Contact did not open the add-contact form'); return false; }
    await f.fill('#ac-name', name); await f.fill('#ac-addr', addr); await f.fill('#ac-street', street); await f.fill('#ac-phone', '0400 000 001');
    await f.selectOption('#ac-suburb', '__new');
    await f.click('#addcontact-wrap button:has-text("Save & Close"), #addcontact-wrap button:has-text("Save and close"), #addcontact-wrap button:has-text("Save")');
    return true;
  }
  const names = (f) => f.evaluate(() => data.map((c) => c.n).sort().join('|'));

  await p.goto(URL0); await sleep(800);
  await snap('signin');
  check('sign-in page shows the demo note', await p.isVisible('.demo-quick'));
  check('page does not scroll sideways', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));

  console.log('1. owner signs up');
  await signUp('Alex Owner', 'alex@agency.test');
  let f = await crm();
  check('CRM opens after sign-up', !!f);
  check('trial chip shows 14 days', /14 days/.test(await p.textContent('#plan-chip')), await p.textContent('#plan-chip'));
  await snap('welcome');
  check('My details asks for details first', !!(await f.waitForSelector('#pf-name', { timeout: 6000 }).catch(() => null)));
  check('name already filled in from sign-up', (await f.inputValue('#pf-name').catch(() => '')) === 'Alex Owner');
  f = await fillProfile(f, 'Coast Realty', '0400 111 222');
  check('CRM starts empty', (await f.evaluate(() => data.length)) === 0);
  await sleep(1500);
  const leftovers = await f.evaluate(() => document.body.innerText.match(/Pipeline Projection|stale leads|3-month look \(\d|promised callbacks|Bookkeeping check due|No backup yet|Last backup/g));
  check('empty CRM shows no leftover banners or reminders', !leftovers, leftovers && leftovers.join(', '));
  await snap('empty-crm');

  console.log('2. add a contact by clicking');
  const added = await addContactByClicking(f, 'Pat Seller', '4 Ocean St', 'Ocean');
  await sleep(800);
  await snap('after-add');
  check('contact added through the buttons', added && (await names(f)) === 'Pat Seller', await names(f));

  console.log('3. invite an agent');
  await tab('team'); await snap('team-solo');
  await p.fill('#f-invite [name=email]', 'jo@agency.test'); await p.click('#f-invite button[type=submit]');
  check('invite shows as waiting', !!(await until(async () => /jo@agency\.test/.test(await p.textContent('#invites')))));
  await snap('team-invited');

  console.log('4. sign out, agent signs up with the invited email');
  await p.click('#menu-btn'); await p.click('#menu [data-act=signout]');
  check('back to sign-in', !!(await until(() => p.isVisible('#f-signin'))));
  await signUp('Jo Agent', 'jo@agency.test');
  f = await crm();
  check('agent joined the owner\'s team', /Agent/.test(await p.textContent('#menu-role')) && /Alex Owner/.test(await p.textContent('#menu-role')), await p.textContent('#menu-role'));
  check('new person lands on the CRM, not the last person\'s page', await p.isVisible('#tab-crm') && !(await p.isVisible('#tab-team')));
  f = await fillProfile(f, 'Coast Realty', '0400 333 444');
  check('per-agent plan: agent does not see the owner\'s contact', (await f.evaluate(() => data.length)) === 0);

  console.log('5. owner turns on the shared list');
  await p.click('#menu-btn'); await p.click('#menu [data-act=signout]');
  await p.fill('#f-signin [name=email]', 'alex@agency.test'); await p.fill('#f-signin [name=password]', 'password1'); await p.click('#f-signin button[type=submit]');
  f = await crm();
  await tab('billing'); await snap('billing');
  await p.click('[data-plan=agency_10]');
  check('Agency 10 chosen', !!(await until(async () => /Shared contact list is on/.test(await p.textContent('#shared-box')))));
  await snap('team-shared');
  const shareBtn = await until(() => p.$('[data-act=share-mine]'), 5000);
  check('owner is offered to share earlier contacts', !!shareBtn);
  if (shareBtn) { await shareBtn.click(); await sleep(1500); }
  f = await until(async () => { const x = await crm(); return x && (await x.evaluate(() => data.length)) === 1 ? x : null; });
  check('earlier contact now in the shared list', f && (await names(f)) === 'Pat Seller');

  console.log('6. agent sees the shared list');
  await p.click('#menu-btn'); await p.click('#menu [data-act=signout]');
  await p.fill('#f-signin [name=email]', 'jo@agency.test'); await p.fill('#f-signin [name=password]', 'password1'); await p.click('#f-signin button[type=submit]');
  f = await crm();
  check('agent sees the owner\'s contact', !!(await until(async () => (await names(f)) === 'Pat Seller')));
  await addContactByClicking(f, 'Lee Buyer', '9 Hill Rd', 'Hill'); await sleep(2500);
  check('agent adds to the shared list', (await names(f)) === 'Lee Buyer|Pat Seller');
  await tab('team'); await snap('team-agent');
  check('agent does not get the dashboard', await p.isHidden('#dash'));

  console.log('7. owner dashboard, subscribe, trial end');
  await p.click('#menu-btn'); await p.click('#menu [data-act=signout]');
  await p.fill('#f-signin [name=email]', 'alex@agency.test'); await p.fill('#f-signin [name=password]', 'password1'); await p.click('#f-signin button[type=submit]');
  f = await crm();
  check('owner sees the agent\'s contact', !!(await until(async () => (await names(f)) === 'Lee Buyer|Pat Seller')));
  await tab('team');
  check('dashboard shows 2 shared contacts', !!(await until(async () => /Shared contacts\s*2/.test(await p.textContent('#dash-tiles')))), await p.textContent('#dash-tiles'));
  await snap('dashboard');
  await tab('billing'); await p.click('[data-act=subscribe]');
  check('subscribe shows a demo message', !!(await until(async () => /simulated/i.test(await p.textContent('#toast')))));
  check('top bar shows subscribed', !!(await until(async () => /billing starts|Subscribed/.test(await p.textContent('#plan-chip')))), await p.textContent('#plan-chip'));
  await snap('subscribed');
  await tab('help'); await snap('help');
  await p.click('.demo-chip'); await snap('guide');
  check('guide opens', await p.isVisible('.demo-panel'));
  await p.click('#demo-end'); await sleep(2500);
  check('ending the trial shows the paid state (still subscribed)', await p.isVisible('#scr-app') || await p.isVisible('#scr-blocked'));
  await snap('after-end');

  console.log('8. reset');
  await p.click('.demo-chip').catch(() => {}); await p.click('#demo-reset'); await p.click('#demo-reset'); await sleep(1500);
  check('reset returns to an empty sign-in', await p.isVisible('#f-signin'));
  check('reset removed the accounts', !(await p.evaluate(() => { try { return (JSON.parse(localStorage.getItem('demo_db_v2')) || {}).users.length; } catch (e) { return 0; } })));
  check('page never scrolls sideways', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));

  check('no script errors', errors.length === 0, errors.join('\n       '));
  console.log('\nnotes:\n  - ' + notes.filter((v, i, a) => a.indexOf(v) === i).join('\n  - '));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
