// The Map view and Vendor Reports, inside the online app (demo build).
// The address finder and map tiles are replaced by stand-ins, so this runs offline.
//   node tests/e2e_addons.js http://localhost:8797/_local.html [phone]
const { chromium } = require('playwright');
const URL0 = process.argv[2], PHONE = process.argv[3] === 'phone';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(ok, what, extra) { if (ok) pass++; else fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 300))); }

// stand-in address finder: houses along a line near Scarborough WA, ~40 m apart
const BASE = { la: -31.894, lo: 115.757 };
const geoCalls = [];
function fakeGeo(q) {
  const m = /^(\d+)\s+(\w+)/.exec(q); if (!m || /Nowhere/.test(q)) return [];
  const street = { Sea: 0, Hill: 1, Bay: 2 }[m[2]] || 0;
  return [{ lat: String(BASE.la + street * 0.004), lon: String(BASE.lo + (+m[1]) * 0.0004) }];
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext(PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1300, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await ctx.route('https://nominatim.openstreetmap.org/**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q');
    geoCalls.push({ q, t: Date.now() });
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(fakeGeo(q)) });
  });
  await ctx.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  // sign up and fill in My details
  await p.goto(URL0); await sleep(600);
  await p.click('#demo-signup');
  await p.fill('#f-signup [name=name]', 'Map Tester'); await p.fill('#f-signup [name=email]', 'map@test.au');
  await p.fill('#f-signup [name=password]', 'password1'); await p.check('#f-signup [name=agree]'); await p.click('#f-signup button[type=submit]');
  const crmFrame = () => p.frames().find((y) => y.parentFrame() === p.mainFrame());
  let f = null;
  for (let i = 0; i < 60 && !f; i++) { const x = crmFrame(); try { if (x && await x.evaluate(() => typeof data !== 'undefined')) f = x; } catch (e) {} await sleep(250); }
  await f.waitForSelector('#pf-agency'); await f.fill('#pf-agency', 'Test Realty'); await f.fill('#pf-phone', '0400 111 222'); await f.click('#pf-save');
  for (let i = 0; i < 40; i++) { await sleep(250); const x = crmFrame(); try { if (x && await x.evaluate(() => ME.isSet)) { f = x; break; } } catch (e) {} }

  await f.evaluate(() => {
    var rows = [['Ann Lee', '1 Sea St', 'Sea', 'Scarborough', 'hot'], ['Bob Kerr', '2 Sea St', 'Sea', 'Scarborough', 'warm'], ['Cy Tan', '3 Hill Rd', 'Hill', 'Doubleview', 'appraisal'],
      ['Di Moss', '4 Hill Rd', 'Hill', 'Doubleview', 'listed'], ['Ed Fox', '5 Bay Ave', 'Bay', 'Scarborough', 'sold'], ['Flo Ng', '6 Bay Ave', 'Bay', 'Scarborough', 'cold'],
      ['Gus O\'Neil', '9 Nowhere Rd', 'Nowhere', 'Scarborough', 'warm'], ['Hal Ito', '2 Sea St', 'Sea', 'Scarborough', 'cold']];
    rows.forEach(function (r) { data.push({ id: data.length, s: r[2], a: r[1], n: r[0], ph: '0400 000 00' + data.length, em: 'x' + data.length + '@example.com', note: 'Test contact.', stage: r[4], date: '25/09/26', apprDate: '', suburb: r[3] }); });
    saveToStorage(); if (typeof rebuildSuburbTabs === 'function') rebuildSuburbTabs(); renderCurrent();
  });
  await sleep(500);

  // ───────── Map ─────────
  check(await f.isVisible('#vt-map'), 'Map tab sits beside Funnel and Table');
  await f.click('#vt-map'); await sleep(300);
  check(await f.isVisible('#crm-map') && !(await f.isVisible('#board')), 'Map replaces the board', await f.evaluate(() => ({ map: getComputedStyle(document.getElementById('map-view')).display, h: document.getElementById('crm-map').offsetHeight, board: getComputedStyle(document.getElementById('board')).display, boardStyle: document.getElementById('board').getAttribute('style') })));
  for (let i = 0; i < 40; i++) { await sleep(300); if (await f.evaluate(() => !document.getElementById('mv-status').textContent)) break; }
  await sleep(600);
  const geo = await f.evaluate(() => JSON.parse(localStorage.getItem('crm_geo_v1') || '{}'));
  const found = Object.values(geo).filter((g) => typeof g.la === 'number').length, missed = Object.values(geo).filter((g) => g.miss).length;
  check(found === 6 && missed === 1, 'every address looked up once: 6 found, 1 not found (2 Sea St has two owners)', { found, missed, calls: geoCalls.length });
  check(geoCalls.length === 7, 'no address asked for twice', geoCalls.map((c) => c.q));
  const gaps = geoCalls.slice(1).map((c, i) => c.t - geoCalls[i].t);
  check(gaps.every((g) => g >= 1000), 'at most one lookup a second (the service’s rule)', gaps);
  check(/Australia/.test(geoCalls[0].q) && /Scarborough|Doubleview/.test(geoCalls[0].q), 'lookups include suburb and country', geoCalls[0].q);
  const legend = await f.textContent('#mv-legend');
  check(/Hot 1/.test(legend) && /Warm 2/.test(legend) && /Listed 1/.test(legend), 'legend counts contacts by stage', legend);
  check(await f.isVisible('#mv-missing-btn') && /\(1\)/.test(await f.textContent('#mv-missing-btn')), '"Not on the map (1)" offered for the address it couldn’t find');

  // click the pin for 2 Sea St (two owners)
  async function clickPin(la, lo) {
    await f.evaluate(() => document.getElementById('crm-map').scrollIntoView({ block: 'center' })); await sleep(200);
    const pt = await f.evaluate(([la, lo]) => { var m = __crmMap(); var r = m.latLngToContainerPoint([la, lo]); var b = document.getElementById('crm-map').getBoundingClientRect(); return { x: b.left + r.x, y: b.top + r.y }; }, [la, lo]);
    await f.evaluate(() => {});
    const box = await (await f.frameElement()).boundingBox();
    await p.mouse.click(box.x + pt.x, box.y + pt.y);
    await sleep(400);
  }
  await f.evaluate(([la, lo]) => __crmMap().setView([la, lo], 17), [BASE.la, BASE.lo + 2 * 0.0004]); await sleep(400);
  await clickPin(BASE.la, BASE.lo + 2 * 0.0004);
  const pop = await f.evaluate(() => { var e = document.querySelector('.leaflet-popup-content'); return e ? e.innerText : ''; });
  check(/2 Sea St/.test(pop) && /Bob Kerr/.test(pop) && /Hal Ito/.test(pop), 'pin popup lists both owners of 2 Sea St', pop);
  check(/Open card/.test(pop), 'popup has Open card');
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/map-' + (PHONE ? 'phone' : 'desktop') + '.png' });
  await f.evaluate(() => { [...document.querySelectorAll('.leaflet-popup-content button')].find((x) => /within/.test(x.textContent)).click(); }); await sleep(400);
  let panel = await f.textContent('#mv-panel');
  check(/contacts? within 300 m of 2 Sea St/.test(panel) && /Ann Lee/.test(panel) && !/Bob Kerr/.test(panel), 'Who’s within 300 m lists neighbours, not the property itself', panel.slice(0, 200));
  check(!/Cy Tan/.test(panel), '300 m leaves out the next street (about 440 m away)');
  await f.evaluate(() => { [...document.querySelectorAll('#mv-panel button')].find((x) => x.textContent === '1 km').click(); }); await sleep(300);
  panel = await f.textContent('#mv-panel');
  check(/within 1 km/.test(panel) && /Cy Tan/.test(panel), 'a wider circle takes in the next street');
  await f.evaluate(() => crmMapCloseAround());

  // hide a stage
  await f.evaluate(() => { [...document.querySelectorAll('#mv-legend .mv-chip')].find((x) => /^Hot/.test(x.textContent)).click(); }); await sleep(200);
  check(await f.evaluate(() => [...document.querySelectorAll('#mv-legend .mv-chip')].find((x) => /^Hot/.test(x.textContent)).classList.contains('off')), 'tapping a stage in the legend hides it');
  await f.evaluate(() => { [...document.querySelectorAll('#mv-legend .mv-chip')].find((x) => /^Hot/.test(x.textContent)).click(); });

  // place the missing one by hand
  await f.click('#mv-missing-btn'); await sleep(200);
  check(/9 Nowhere Rd/.test(await f.textContent('#mv-panel')), 'the not-found list names the address');
  await f.evaluate(() => { [...document.querySelectorAll('#mv-panel button')].find((x) => /Place on map/.test(x.textContent)).click(); }); await sleep(200);
  check(/Tap the map where 9 Nowhere Rd is/.test(await f.textContent('#mv-status')), 'asks where to put the pin');
  await f.evaluate(() => document.getElementById('crm-map').scrollIntoView({ block: 'center' })); await sleep(200);
  const mbox = await f.evaluate(() => { var b = document.getElementById('crm-map').getBoundingClientRect(); return { x: b.left + 60, y: b.top + 60 }; });
  const fbox = await (await f.frameElement()).boundingBox();
  await p.mouse.click(fbox.x + mbox.x, fbox.y + mbox.y); await sleep(500);
  const hand = await f.evaluate(() => { var g = JSON.parse(localStorage.getItem('crm_geo_v1') || '{}'); return Object.keys(g).filter((k) => g[k].hand).map((k) => k); });
  check(hand.length === 1 && /nowhere/.test(hand[0]), 'the pin is saved where it was placed', hand);
  check(!(await f.isVisible('#mv-missing-btn')), 'nothing left off the map');

  // search filters the map too
  await f.fill('#search', 'Ann'); await f.evaluate(() => renderCurrent()); await sleep(200);
  check(/Hot 1/.test(await f.textContent('#mv-legend')) && !/Warm/.test(await f.textContent('#mv-legend')), 'search narrows the map like the board');
  await f.fill('#search', ''); await f.evaluate(() => renderCurrent());

  // back to the board, then the map again without asking for the addresses again
  await f.click('#vt-table'); await sleep(200);
  check(!(await f.isVisible('#map-view')) && await f.isVisible('#tbl-view'), 'Table hides the map');
  await f.click('#vt-funnel'); await sleep(200);
  check(await f.isVisible('#board') && !(await f.isVisible('#map-view')), 'Funnel brings the board back');
  const before = geoCalls.length;
  await f.click('#vt-map'); await sleep(1500);
  check(geoCalls.length === before, 'reopening the map uses the saved locations');

  // ───────── Vendor reports ─────────
  await f.click('#vt-funnel');
  check(await f.isVisible('#vr-open-btn'), 'Vendor Reports button in the top bar');
  await f.click('#vr-open-btn'); await sleep(200);
  let body = await f.textContent('#vr-body');
  check(/Contacts marked Listed/.test(body) && /4 Hill Rd/.test(body), 'suggests the contact marked Listed', body.slice(0, 200));
  await f.evaluate(() => { [...document.querySelectorAll('#vr-body button')].find((x) => /Start report/.test(x.textContent)).click(); }); await sleep(200);
  check(await f.inputValue('[data-f="addr"]') === '4 Hill Rd' && await f.inputValue('[data-f="vendor"]') === 'Di Moss', 'report starts with the address and vendor filled in');
  check(await f.inputValue('[data-f="vendorEm"]') !== '' && await f.inputValue('[data-f="vendorPh"]') !== '', 'vendor email and mobile copied from the card');

  // the listing went live 20 days ago; open homes in the register, written slightly differently
  const T = await f.evaluate(() => { var d = perthNow(); var s = (n) => { var x = new Date(d); x.setDate(x.getDate() - n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }; return { t0: s(0), t2: s(2), t10: s(10), t20: s(20) }; });
  await f.fill('[data-f="listedOn"]', T.t20); await f.dispatchEvent('[data-f="listedOn"]', 'change'); await sleep(100);
  await f.evaluate((T) => {
    openHomes.push({ prop: '4 Hill Road, Doubleview', date: T.t2, name: 'Pat Private', ph: '0411 999 888', em: 'pat@private.au', interest: 'High', note: 'Loved the kitchen' });
    openHomes.push({ prop: '4 hill rd', date: T.t2, name: 'Quinn Q', ph: '', em: '', interest: 'Medium', note: '' });
    openHomes.push({ prop: '4 Hill Rd', date: T.t0, name: 'Ria R', ph: '', em: '', interest: 'Just Looking', note: '' });
    openHomes.push({ prop: '4 Hill Rd', date: T.t10, name: 'Old Week', ph: '', em: '', interest: 'Low', note: 'Too small' });
    openHomes.push({ prop: '14 Hill Rd', date: T.t2, name: 'Other House', ph: '', em: '', interest: 'High', note: 'Wrong house' });
    _saveExtra();
  }, T);
  await f.evaluate(() => { var d = document.getElementById('vr-week'); d.dispatchEvent(new Event('change')); }); await sleep(100);
  await f.fill('[data-w="views"]', '1240'); await f.fill('[data-w="enq"]', '6'); await f.fill('[data-w="insp"]', '2');
  await f.fill('#vr-fb-buyer', 'Sam Secret 0499 123 456'); await f.selectOption('#vr-fb-int', 'High');
  await f.fill('#vr-fb-price', '$650k–$680k'); await f.fill('#vr-fb-comment', 'Would offer if the patio was bigger');
  await f.evaluate(() => vrAddFeedback()); await sleep(100);
  await f.fill('#vr-fb-price', '700,000'); await f.fill('#vr-fb-comment', 'Second inspection booked');
  await f.evaluate(() => vrAddFeedback()); await sleep(100);
  await f.fill('[data-f="comments"]', 'Strong interest from families.');
  await f.fill('[data-f="next"]', 'Open home Saturday 11am.');
  body = await f.textContent('#vr-body');
  check(/Open homes this week:.*\(2 groups\).*\(1 group\)/.test(body), 'open homes this week counted from the register (Road/Rd and suburb ignored)', body.match(/Open homes this week:[^+]*/)[0]);
  check(/\$650,000 to \$700,000/.test(body), 'price feedback summarised as a range', (body.match(/Price feedback so far:[^.]*/) || [''])[0]);

  await f.evaluate(() => vrGo('preview')); await sleep(200);
  const rep = await f.textContent('#vr-body');
  if (process.env.SHOTS) { await f.evaluate(() => document.getElementById('vr-wrap').scrollTop = 0); await p.screenshot({ path: process.env.SHOTS + '/report-' + (PHONE ? 'phone' : 'desktop') + '.png', fullPage: false }); }
  check(/Campaign report/.test(rep) && /4 Hill Rd/.test(rep) && /Prepared for Di Moss/.test(rep), 'report header: address and vendor');
  check(/20\s*days on market/.test(rep), 'days on market', (rep.match(/\d+\s*days on market/) || [''])[0]);
  check(/3\s*groups through/.test(rep) && /2 open homes this week/.test(rep), '3 groups through 2 open homes this week (last week’s left out)');
  check(/1,240\s*online views/.test(rep) && /6\s*enquiries/.test(rep) && /2 private inspections/.test(rep), 'online views, enquiries, inspections');
  check(/Loved the kitchen/.test(rep) && /Would offer if the patio was bigger/.test(rep) && !/Too small/.test(rep) && !/Wrong house/.test(rep), 'this week’s feedback for this house only');
  check(!/Sam Secret|0499|Pat Private|0411|pat@private/.test(rep), 'no buyer names, phones or emails in the report');
  check(/Strong interest from families/.test(rep) && /Open home Saturday 11am/.test(rep), 'agent comments and next steps');
  check(/Test Realty/.test(rep) && /0400 111 222/.test(rep), 'signed with My details');
  check(/Whole campaign: 4 groups through 3 open homes/.test(rep), 'whole-campaign totals include earlier weeks', (rep.match(/Whole campaign:[^.]*/) || [''])[0]);

  await f.evaluate(() => vrSend('copy')); await sleep(400);
  const clip = await f.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check(/Hi Di/.test(clip) && /1,240 online views/.test(clip) && !/Sam Secret/.test(clip), 'Copy for email: text version reads well', clip.slice(0, 160));
  await f.evaluate(() => vrSend('email')); await sleep(300);
  check(await f.evaluate(() => !!document.getElementById('mail-chooser')), 'Email vendor opens the email chooser');
  await f.evaluate(() => { var m = document.getElementById('mail-chooser'); if (m) m.remove(); });

  // saved: still there after a reload
  const saved = await f.evaluate(() => JSON.parse(localStorage.getItem('crm_vendor_reports_v1')));
  const L = saved.list[0];
  check(L && L.addr === '4 Hill Rd' && L.feedback.length === 2 && L.weeks[T.t0].views === '1240' && L.sent.length === 2, 'report saved (synced key crm_vendor_reports_v1)', L && { f: L.feedback.length, s: L.sent.length });
  const wk = await f.evaluate((T) => __vendorReports.stats(__vendorReports.db().list[0], T.t10), T);
  check(wk.groups === 1 && wk.views === null, 'an earlier week shows that week’s figures only', wk);
  check(JSON.stringify(await f.evaluate(() => [__vendorReports.prices('$1.2m'), __vendorReports.prices('650-680k'), __vendorReports.prices('high 600s')])) === '[[1200000],[650000,680000],[600000]]', 'price opinions read in common forms');

  await f.evaluate(() => closeVendorReports());
  check(errs.length === 0, 'no script errors', errs);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
