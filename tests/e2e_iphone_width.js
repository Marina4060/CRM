// iPhone width check. Safari on iPhone stretches a frame to fit its widest
// content, and counts panels parked off the edge of the screen. So nothing in
// the app or the CRM may reach past the screen, open or closed, on every screen.
//   node tests/e2e_iphone_width.js http://localhost:8797/_local.html [width]
const { chromium } = require('playwright');
const URL0 = process.argv[2], W = +(process.argv[3] || 375);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(ok, what, extra) { if (ok) pass++; else fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (ok || extra === undefined ? '' : '\n       ' + JSON.stringify(extra).slice(0, 400))); }

// everything drawn past the right edge that no scrolling box clips (past the left edge never widens the page)
function overflow() {
  const vw = document.documentElement.clientWidth, out = [];
  const clipped = (e) => { for (let a = e.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) { const s = getComputedStyle(a); if (/(hidden|auto|scroll|clip)/.test(s.overflowX)) { const r = a.getBoundingClientRect(); if (r.right <= vw + 1 && r.left >= -1) return true; } } return false; };
  for (const e of document.querySelectorAll('body *')) {
    const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') continue;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (r.right > vw + 1 && !clipped(e)) out.push((e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : '')) + (e.closest('[id]') && e.closest('[id]') !== e ? ' in #' + e.closest('[id]').id : '') + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
  }
  return { vw, sw: document.documentElement.scrollWidth, n: out.length, first: out.slice(0, 5) };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: W, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  const p = await ctx.newPage();
  const fits = async (fr, label) => { const o = await fr.evaluate(overflow); check(o.n === 0 && o.sw <= o.vw, label + ' fits ' + W + ' px', o); };
  const small = async (fr, label) => { const n = await fr.evaluate(() => [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=file]):not([type=hidden]), select, textarea')].filter((e) => e.offsetWidth && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => (e.id || e.name || e.className) + ' ' + getComputedStyle(e).fontSize)); check(!n.length, label + ': text boxes 16 px or more (no iPhone zoom)', n.slice(0, 6)); };

  await p.goto(URL0); await sleep(800);
  await fits(p, 'sign-in page'); await small(p, 'sign-in page');
  await p.click('#demo-signup'); await sleep(200);
  await fits(p, 'sign-up form');
  await p.fill('#f-signup [name=name]', 'Iris Phone'); await p.fill('#f-signup [name=email]', 'iris@test.au');
  await p.fill('#f-signup [name=password]', 'password1'); await p.check('#f-signup [name=agree]'); await p.click('#f-signup button[type=submit]');
  const crmFrame = () => p.frames().find((y) => y.parentFrame() === p.mainFrame());
  let f = null;
  for (let i = 0; i < 60 && !f; i++) { const x = crmFrame(); try { if (x && await x.evaluate(() => typeof data !== 'undefined')) f = x; } catch (e) {} await sleep(250); }
  await f.waitForSelector('#pf-agency'); await sleep(300);
  await fits(f, 'My details (first open)'); await small(f, 'My details');
  await f.fill('#pf-agency', 'Test Realty'); await f.fill('#pf-phone', '0400 111 222'); await f.click('#pf-save');
  for (let i = 0; i < 40; i++) { await sleep(250); const x = crmFrame(); try { if (x && await x.evaluate(() => ME.isSet)) { f = x; break; } } catch (e) {} }
  await f.evaluate(() => {
    [['Ann Lee', '1 Sea St', 'Sea', 'Scarborough', 'hot'], ['Di Moss', '4 Hill Rd', 'Hill', 'Doubleview', 'listed'], ['Ed Fox', '5 Bay Ave', 'Bay', 'Scarborough', 'sold']]
      .forEach(function (r) { data.push({ id: data.length, s: r[2], a: r[1], n: r[0], ph: '0400 000 00' + data.length, em: 'x@example.com', note: 'Test.', stage: r[4], date: '25/09/26', apprDate: '', suburb: r[3] }); });
    saveToStorage(); if (typeof rebuildSuburbTabs === 'function') rebuildSuburbTabs(); renderCurrent();
  });
  await sleep(600);
  await fits(p, 'app around the CRM');
  await fits(f, 'CRM main screen'); await small(f, 'CRM main screen');
  for (const v of ['vt-table', 'vt-map', 'vt-funnel']) { await f.click('#' + v); await sleep(400); await fits(f, 'CRM ' + v.slice(3) + ' view'); }

  // every top-bar button, then a contact card
  const buttons = await f.$$eval('.topbar [onclick]', (els) => [...new Set(els.map((e) => (e.getAttribute('onclick') || '').trim()).filter(Boolean))]);
  const skip = /clearStorage|exportCRM|downloadFile|openProfile|location\.reload|crmBackup|crmImportFile|setView|setSuburb|toggleMissing|crmShowMap/;
  for (const oc of buttons) {
    if (skip.test(oc)) continue;
    try { await f.evaluate((code) => { new Function(code).call(document.body); }, oc); } catch (e) {}
    await sleep(500);
    await fits(f, oc.replace(/\(.*$/, ''));
    await f.evaluate(() => {
      document.querySelectorAll('[id$="-modal"]').forEach(function (e) { e.remove(); });
      document.querySelectorAll('[id$="-wrap"]').forEach(function (e) { if (getComputedStyle(e).position === 'fixed') e.style.display = 'none'; });
      document.querySelectorAll('body > div').forEach(function (e) { var s = getComputedStyle(e); if (s.position === 'fixed' && e.offsetHeight > 200 && !/dcl-wrap/.test(e.id)) e.style.display = 'none'; });
      try { if (typeof dclClose === 'function') dclClose(); } catch (e) {}
      try { if (typeof closeTodayDash === 'function') closeTodayDash(); } catch (e) {}
      var tb = document.getElementById('td-box'); if (tb) tb.classList.remove('open');
    }).catch(() => {});
  }
  for (const t of ['team', 'billing', 'help']) { await p.click(`.tabs a[data-tab=${t}]`); await sleep(900); await fits(p, t + ' page'); await small(p, t + ' page'); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
