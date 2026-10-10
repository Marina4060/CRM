// Opens every CRM feature inside the online app (demo build) with a few
// contacts in it, and reports script errors and any leftover personal data.
//   node tests/e2e_features.js http://localhost:8797/_local.html [screenshot-dir] [phone]
const { chromium } = require('playwright');
const URL0 = process.argv[2], SHOTS = process.argv[3] || null, PHONE = process.argv[4] === 'phone';
const OLD = /Marina|Dacheva|Monarch|Parkerville|Brabham|Garigal|Wedgetail|Brooking|Beaufort|0492|Debie|Debbie|Harbour Realty|Joyce|Granite R|Duncraig|Nicholli|Abelia|Greenwood|Hillarys/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext(PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1300, height: 850 } });
  const p = await ctx.newPage();
  let errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL0); await sleep(600);
  await p.click('#demo-signup');
  await p.fill('#f-signup [name=name]', 'Feature Tester'); await p.fill('#f-signup [name=email]', 'ft@test.au');
  await p.fill('#f-signup [name=password]', 'password1'); await p.check('#f-signup [name=agree]'); await p.click('#f-signup button[type=submit]');
  let f = null;
  for (let i = 0; i < 60 && !f; i++) { const x = p.frames().find((y) => y.parentFrame() === p.mainFrame()); try { if (x && await x.evaluate(() => typeof data !== 'undefined')) f = x; } catch (e) {} await sleep(250); }
  await f.waitForSelector('#pf-agency'); await f.fill('#pf-agency', 'Test Realty'); await f.fill('#pf-phone', '0400 111 222'); await f.click('#pf-save');
  for (let i = 0; i < 40; i++) { await sleep(250); const x = p.frames().find((y) => y.parentFrame() === p.mainFrame()); try { if (x && await x.evaluate(() => ME.isSet)) { f = x; break; } } catch (e) {} }
  // a few contacts across stages and suburbs
  await f.evaluate(() => {
    var rows = [['Ann Lee', '1 Sea St', 'Sea', 'Scarborough', 'hot'], ['Bob Kerr', '2 Sea St', 'Sea', 'Scarborough', 'warm'], ['Cy Tan', '3 Hill Rd', 'Hill', 'Doubleview', 'appraisal'],
      ['Di Moss', '4 Hill Rd', 'Hill', 'Doubleview', 'listed'], ['Ed Fox', '5 Bay Ave', 'Bay', 'Scarborough', 'sold'], ['Flo Ng', '6 Bay Ave', 'Bay', 'Scarborough', 'cold']];
    rows.forEach(function (r) { data.push({ id: data.length, s: r[2], a: r[1], n: r[0], ph: '0400 000 00' + data.length, em: 'x' + data.length + '@example.com', note: 'Test contact.', stage: r[4], date: '25/09/26', apprDate: '', salePrice: '', settledDate: '', suburb: r[3] }); });
    saveToStorage(); if (typeof rebuildSuburbTabs === 'function') rebuildSuburbTabs(); renderCurrent();
  });
  await sleep(800);

  const buttons = await f.$$eval('.topbar [onclick], .topbar button', (els) => [...new Set(els.map((e) => (e.getAttribute('onclick') || '').trim()).filter(Boolean))]);
  const skip = /clearStorage|exportCRM|downloadFile|openProfile|location\.reload/;
  const report = [];
  for (const oc of buttons) {
    if (skip.test(oc)) continue;
    errs = [];
    let opened = '';
    try {
      await f.evaluate((code) => { new Function(code).call(document.body); }, oc);
      await sleep(500);
      opened = await f.evaluate(() => {
        // text of whatever panel or modal is on top
        var els = [...document.querySelectorAll('body > div, body > aside, [id$="-modal"], [id$="-wrap"]')].filter(function (e) { var s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && (s.position === 'fixed' || s.position === 'absolute') && e.offsetHeight > 80; });
        return els.map(function (e) { return e.innerText; }).join('\n');
      });
    } catch (e) { errs.push('click: ' + e.message.split('\n')[0]); }
    // the call list runs in its own frame inside the CRM
    for (const inner of p.frames().filter((x) => x.parentFrame() === f)) {
      try { await sleep(700); opened += '\n' + await inner.evaluate(() => document.body.innerText + [...document.querySelectorAll('dialog')].map(function (d) { return d.innerHTML; }).join(' ')); } catch (e) {}
    }
    const old = (opened.match(OLD) || [])[0];
    report.push({ oc: oc.slice(0, 60), errs: errs.slice(), old: old || '' });
    if (SHOTS && (errs.length || old)) await p.screenshot({ path: `${SHOTS}/feat-${report.length}.png` });
    // close whatever opened
    await f.evaluate(() => {
      document.querySelectorAll('[id$="-modal"]').forEach(function (e) { e.remove(); });
      document.querySelectorAll('[id$="-wrap"]').forEach(function (e) { if (getComputedStyle(e).position === 'fixed') e.style.display = 'none'; });
      document.querySelectorAll('body > div').forEach(function (e) { var s = getComputedStyle(e); if (s.position === 'fixed' && e.offsetHeight > 200 && !e.id.match(/dcl-wrap/)) e.style.display = 'none'; });
    }).catch(() => {});
    await p.keyboard.press('Escape');
    // the call list opens full screen; close it
    await f.evaluate(() => { try { if (typeof dclClose === 'function') dclClose(); } catch (e) {} }).catch(() => {});
  }
  // also the card modal of one contact
  errs = [];
  await f.evaluate(() => { var c = document.querySelector('.card'); if (c) c.click(); }); await sleep(600);
  const cardText = await f.evaluate(() => document.body.innerText);
  report.push({ oc: 'open a contact card', errs: errs.slice(), old: (cardText.match(OLD) || [''])[0] });
  let bad = 0;
  for (const r of report) {
    const ok = !r.errs.length && !r.old;
    if (!ok) bad++;
    console.log((ok ? '  ok   ' : '  FAIL ') + r.oc + (r.errs.length ? '\n       errors: ' + r.errs.join(' | ').slice(0, 300) : '') + (r.old ? '\n       old data: ' + r.old : ''));
  }
  console.log('\n' + (report.length - bad) + ' of ' + report.length + ' features clean');
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
