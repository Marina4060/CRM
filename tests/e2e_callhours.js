// The telemarketing calling-hours check, in the online app (demo build).
// The browser's clock is set to chosen days and times.
//   node tests/e2e_callhours.js http://localhost:8797/_local.html
const { chromium } = require('playwright');
const URL0 = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(ok, what, extra) { if (ok) pass++; else fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 300))); }

async function openCrm(b, when) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Australia/Perth' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.clock.install({ time: new Date(when) });
  await p.goto(URL0); await p.clock.runFor(800);
  await p.click('#demo-signup');
  await p.fill('#f-signup [name=name]', 'Hours Tester'); await p.fill('#f-signup [name=email]', 'hours@test.au');
  await p.fill('#f-signup [name=password]', 'password1'); await p.check('#f-signup [name=agree]'); await p.click('#f-signup button[type=submit]');
  const crmFrame = () => p.frames().find((y) => y.parentFrame() === p.mainFrame());
  let f = null;
  for (let i = 0; i < 60 && !f; i++) { await p.clock.runFor(300); const x = crmFrame(); try { if (x && await x.evaluate(() => typeof data !== 'undefined' && !!window.__callHours)) f = x; } catch (e) {} }
  await f.waitForSelector('#pf-agency'); await f.fill('#pf-agency', 'Test Realty'); await f.fill('#pf-phone', '0400 111 222'); await f.click('#pf-save');
  for (let i = 0; i < 40; i++) { await p.clock.runFor(300); const x = crmFrame(); try { if (x && await x.evaluate(() => ME.isSet)) { f = x; break; } } catch (e) {} }
  await f.evaluate(() => {
    data.push({ id: data.length, s: 'Sea', a: '1 Sea St', n: 'Ann Lee', ph: '0400 000 001', em: '', note: '', stage: 'warm', date: '01/10/26', apprDate: '', suburb: 'Scarborough' });
    saveToStorage(); renderCurrent();
  });
  return { p, f, ctx, errs };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });

  // ── the rules, at chosen moments ──
  const { p, f, ctx, errs } = await openCrm(b, '2026-10-12T10:00:00+08:00');   // Monday 10am in Perth
  const r = await f.evaluate(() => {
    const at = (iso, zone) => { const x = __callHours.check(zone, new Date(iso)); return x.ok ? 'ok until ' + x.until : 'no: ' + x.why + ' / next ' + x.next; };
    return {
      monMorning: at('2026-10-12T10:00:00+08:00', 'Australia/Perth'),
      monBefore9: at('2026-10-12T08:30:00+08:00', 'Australia/Perth'),
      monEvening: at('2026-10-12T20:30:00+08:00', 'Australia/Perth'),
      satAfternoon: at('2026-10-10T16:30:00+08:00', 'Australia/Perth'),
      satEvening: at('2026-10-10T17:30:00+08:00', 'Australia/Perth'),
      sunday: at('2026-10-11T11:00:00+08:00', 'Australia/Perth'),
      anzac: at('2027-04-26T11:00:00+08:00', 'Australia/Perth'),
      anzacDay: at('2026-04-25T11:00:00+08:00', 'Australia/Perth'),
      goodFriday: at('2027-03-26T11:00:00+08:00', 'Australia/Perth'),
      christmas: at('2026-12-25T11:00:00+08:00', 'Australia/Perth'),
      // 6:30pm in Perth is 8:30pm in Sydney (daylight saving): fine for a Perth owner, too late for a Sydney one
      perthOwner: at('2026-10-12T18:30:00+08:00', 'Australia/Perth'),
      sydneyOwner: at('2026-10-12T18:30:00+08:00', 'Australia/Sydney'),
      zones: [6050, 2000, 2880, 3000, 4000, 5000, 7000, 800, 2600].map((pc) => __callHours.zoneFor(pc)).join(','),
      holidays2027: [[2027, 3, 26], [2027, 3, 29], [2027, 1, 26], [2027, 6, 14]].map((d) => __callHours.holiday(...d) || '-').join(',')
    };
  });
  check(r.monMorning === 'ok until 8pm', 'Monday 10am: allowed until 8pm', r.monMorning);
  check(/^no: before 9am \/ next today at 9am/.test(r.monBefore9), 'Monday 8:30am: not yet, next today at 9am', r.monBefore9);
  check(/^no: after 8pm \/ next tomorrow at 9am/.test(r.monEvening), 'Monday 8:30pm: too late, next tomorrow 9am', r.monEvening);
  check(r.satAfternoon === 'ok until 5pm', 'Saturday 4:30pm: allowed until 5pm', r.satAfternoon);
  check(/^no: after 5pm \/ next Monday at 9am/.test(r.satEvening), 'Saturday 5:30pm: too late, next Monday 9am (Sunday is out)', r.satEvening);
  check(/^no: Sunday \/ next tomorrow at 9am/.test(r.sunday), 'Sunday: no calls', r.sunday);
  check(/^no: Anzac Day/.test(r.anzacDay), 'Anzac Day: no calls (national public holiday)', r.anzacDay);
  check(r.anzac === 'ok until 8pm', 'the Monday after Anzac Day 2027 is not on the national list', r.anzac);
  check(/^no: Good Friday/.test(r.goodFriday) && /^no: Christmas Day/.test(r.christmas), 'Good Friday and Christmas Day: no calls', [r.goodFriday, r.christmas]);
  check(r.perthOwner === 'ok until 8pm' && /^no: after 8pm/.test(r.sydneyOwner), 'the owner’s time counts: 6:30pm in Perth is 8:30pm in Sydney', [r.perthOwner, r.sydneyOwner]);
  check(r.zones === 'Australia/Perth,Australia/Sydney,Australia/Broken_Hill,Australia/Melbourne,Australia/Brisbane,Australia/Adelaide,Australia/Hobart,Australia/Darwin,Australia/Sydney', 'postcodes give the owner’s time zone (Broken Hill on SA time)', r.zones);
  check(r.holidays2027 === 'Good Friday,Easter Monday,Australia Day,-', 'Easter worked out each year; King’s Birthday is not national', r.holidays2027);

  // in hours: calls go straight through
  await f.evaluate(() => openStageList('warm', 'Warm')); await p.clock.runFor(500);
  await f.evaluate(() => { const a = document.querySelector('#stage-modal a[href="tel:0400000001"]'); a.addEventListener('click', (e) => { e.preventDefault(); window.__dialled = (window.__dialled || 0) + 1; }); a.click(); });
  check(await f.evaluate(() => !document.getElementById('ch-modal') && window.__dialled === 1), 'Monday 10am: tapping 📞 dials straight away');
  await ctx.close();

  // ── Sunday afternoon in Perth ──
  const s = await openCrm(b, '2026-10-11T14:00:00+08:00');
  await s.f.evaluate(() => openStageList('warm', 'Warm')); await s.p.clock.runFor(500);
  await s.f.evaluate(() => { const a = document.querySelector('#stage-modal a[href="tel:0400000001"]'); a.addEventListener('click', (e) => { e.preventDefault(); window.__dialled = (window.__dialled || 0) + 1; }); a.click(); });
  const modal = await s.f.evaluate(() => { const m = document.getElementById('ch-modal'); return m ? m.innerText : ''; });
  check(/Outside telemarketing calling hours/.test(modal) && /2pm on Sunday in Perth/.test(modal) && /Ann/.test(modal), 'Sunday 2pm: 📞 asks first, naming the owner’s local time', modal.slice(0, 160));
  check(/Next allowed:\s*tomorrow at 9am/.test(modal), '…and when calls are next allowed');
  check(await s.f.evaluate(() => !window.__dialled), '…and nothing was dialled');
  await s.f.click('#ch-no');
  check(await s.f.evaluate(() => !document.getElementById('ch-modal') && !window.__dialled), 'Don’t call now: closes, no call');
  await s.f.evaluate(() => document.querySelector('#stage-modal a[href="tel:0400000001"]').click());
  await s.f.click('#ch-go');
  check(await s.f.evaluate(() => window.__dialled === 1), 'They agreed to this call: the call goes ahead');

  // the Call Runner is left alone: no hours in its bar, and its numbers aren't checked
  await s.f.evaluate(() => { document.querySelectorAll('[id$="-modal"]').forEach((e) => e.remove()); openCRContact(data.length - 1); });
  let cl = null;
  for (let i = 0; i < 60 && !cl; i++) {
    await s.p.clock.runFor(250);
    try { const h = await s.f.$('#dcl-frame'); const x = h && await h.contentFrame(); if (x && await x.evaluate(() => typeof cur === 'function' && !!cur() && !!document.querySelector('button.numbtn, a[href^="tel:"]'))) cl = x; } catch (e) {}
  }
  check(await s.f.evaluate(() => !document.getElementById('dcl-hours')), 'the Call Runner’s top bar has no calling-hours note');
  if (cl) {
    await cl.evaluate(() => { window.__copied = 0; const b = document.querySelector('button.numbtn') || document.querySelector('a[href^="tel:"]'); b.addEventListener('click', (e) => { e.preventDefault(); window.__copied++; }); b.click(); });
    await s.p.clock.runFor(200);
    check(await cl.evaluate(() => window.__copied === 1 && !document.getElementById('ch-modal')), 'calling from the Call Runner goes straight through');
  } else check(false, 'the Call Runner opens on the contact');
  await s.ctx.close();

  check(errs.length === 0 && s.errs.length === 0, 'no script errors', errs.concat(s.errs));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
