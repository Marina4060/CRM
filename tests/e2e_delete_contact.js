// Deleting a contact from its card (and everything that points at contacts
// by number moving with it), Import file telling the same address in two
// suburbs apart, adding a street by house numbers, pasting ID4me rows and
// contact lines onto the right card, the ID4me details tab, and the hover help on the toolbar buttons,
// inside the online app (demo build).
//   node tests/e2e_delete_contact.js http://localhost:8797/_local.html
const { chromium } = require('playwright');
const URL0 = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(ok, what, extra) { if (ok) pass++; else fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 300))); }

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  // the demo answers every question with yes, so the test answers them itself
  const answer = (yes) => f.evaluate((y) => { window.__asked = ''; window.confirm = function (m) { window.__asked = m; return y; }; }, yes);
  const asked = () => f.evaluate(() => window.__asked);

  await p.goto(URL0); await sleep(600);
  await p.click('#demo-signup');
  await p.fill('#f-signup [name=name]', 'Del Tester'); await p.fill('#f-signup [name=email]', 'del@test.au');
  await p.fill('#f-signup [name=password]', 'password1'); await p.check('#f-signup [name=agree]'); await p.click('#f-signup button[type=submit]');
  const crmFrame = () => p.frames().find((y) => y.parentFrame() === p.mainFrame());
  let f = null;
  for (let i = 0; i < 60 && !f; i++) { const x = crmFrame(); try { if (x && await x.evaluate(() => typeof data !== 'undefined')) f = x; } catch (e) {} await sleep(250); }
  await f.waitForSelector('#pf-agency'); await f.fill('#pf-agency', 'Test Realty'); await f.fill('#pf-phone', '0400 111 222'); await f.click('#pf-save');
  for (let i = 0; i < 40; i++) { await sleep(250); const x = crmFrame(); try { if (x && await x.evaluate(() => ME.isSet)) { f = x; break; } } catch (e) {} }

  // four contacts, with things that point at the second, third and fourth by number
  await f.evaluate(() => {
    [['Ann Lee', '1 Sea St'], ['Bob Kerr', '2 Sea St'], ['Cy Tan', '3 Sea St'], ['Di Moss', '4 Sea St']].forEach(function (r) {
      data.push({ id: data.length, s: 'Sea', a: r[1], n: r[0], ph: '0400 000 00' + data.length, em: '', note: 'Test.', stage: 'warm', date: '25/09/26', apprDate: '', suburb: 'Scarborough' });
    });
    saveToStorage(); if (typeof rebuildSuburbTabs === 'function') rebuildSuburbTabs(); renderCurrent();
    actLog = { 1: [{ type: 'Called', note: 'spoke to Bob' }], 2: [{ type: 'Called', note: 'spoke to Cy' }], 3: [{ type: 'Called', note: 'spoke to Di' }] }; saveActLog();
    appointments.push({ id: 'a_bob', type: 'followup', date: '2026-12-01', time: '09:00', contact: 'Bob Kerr', contactId: 1, notes: '' });
    appointments.push({ id: 'a_di', type: 'followup', date: '2026-12-02', time: '09:00', contact: 'Di Moss', contactId: 3, notes: '' });
    clSaveAppts();
    diaryTasks.push({ id: 't_cy', task: 'Ring Cy', contact: 'Cy Tan', contactId: 2, date: '-', type: 'upcoming', done: false }); saveDiary();
    localStorage.setItem('crm_review_parked', JSON.stringify({ 2: '01/12/26', 3: '02/12/26' }));
  });
  await sleep(300);

  // ───────── the button on the card ─────────
  await f.evaluate(() => openC(1)); await sleep(200);
  check(!!(await f.$('#m-foot .del-contact-btn')), 'a contact card has a Delete contact button');
  check((await f.$$('#m-foot .del-contact-btn')).length === 1, '…just one, however often the card opens', await f.$$eval('#m-foot .del-contact-btn', (x) => x.length));

  // cancelling keeps the contact
  await answer(false);
  await f.click('#m-foot .del-contact-btn'); await sleep(200);
  const q = await asked();
  check(/Delete Bob Kerr at 2 Sea St\?/.test(q) && /can.t be undone/.test(q), 'it asks first, naming the contact', q);
  check(await f.evaluate(() => data.length === 4 && data[1].n === 'Bob Kerr'), 'saying no keeps the contact');

  // saying yes deletes it
  await answer(true);
  await f.evaluate(() => openC(1)); await sleep(200);
  await f.click('#m-foot .del-contact-btn'); await sleep(300);
  const after = await f.evaluate(() => ({
    names: data.map((c) => c.n), ids: data.map((c) => c.id), open: document.getElementById('mwrap').style.display,
    board: document.getElementById('board').textContent,
    act: actLog,
    appts: appointments.filter((a) => /^a_(bob|di)$/.test(a.id)).map((a) => [a.id, a.contactId]),
    task: diaryTasks.filter((t) => t.id === 't_cy').map((t) => t.contactId)[0],
    parked: JSON.parse(localStorage.getItem('crm_review_parked') || '{}'),
    saved: JSON.parse(localStorage.getItem('crm_data_v4') || '[]').map((s) => s.n),
    log: (sessionLog[0] || {}).action
  }));
  check(after.names.join() === 'Ann Lee,Cy Tan,Di Moss', 'Bob is gone and the others stay', after.names);
  check(after.ids.join() === '0,1,2', 'the contacts after him move up', after.ids);
  check(after.open === 'none' && !/Bob Kerr/.test(after.board), 'the card closes and the board no longer shows him');
  check(after.saved.join() === 'Ann Lee,Cy Tan,Di Moss', 'the deletion is saved (and so syncs)', after.saved);
  check(!JSON.stringify(after.act).includes('Bob') && /Cy/.test(JSON.stringify(after.act[1])) && /Di/.test(JSON.stringify(after.act[2])), 'call history goes with him; Cy’s and Di’s move with them', after.act);
  check(JSON.stringify(after.appts) === '[["a_bob",null],["a_di",2]]', 'his appointment stays but is unlinked; Di’s still points at Di', after.appts);
  check(after.task === 1, 'Cy’s diary task still points at Cy', after.task);
  check(after.parked[1] === '01/12/26' && after.parked[2] === '02/12/26' && Object.keys(after.parked).length === 2, 'the review’s "look again later" list moves too', after.parked);
  check(/Deleted contact: Bob Kerr/.test(after.log || ''), 'the Session Log records it', after.log);

  // it stays deleted after the page reloads
  await f.evaluate(() => location.reload()); await sleep(1500);
  f = crmFrame();
  for (let i = 0; i < 40; i++) { try { if (await f.evaluate(() => typeof data !== 'undefined' && data.length > 0)) break; } catch (e) {} await sleep(250); f = crmFrame(); }
  check(await f.evaluate(() => data.map((c) => c.n).join() === 'Ann Lee,Cy Tan,Di Moss'), 'still gone after reloading', await f.evaluate(() => data.map((c) => c.n)));

  // ───────── Import file: the same address in two suburbs ─────────
  await f.evaluate(() => { window.confirm = function () { return true; }; window.alert = function () {}; });
  const imp = await f.evaluate(() => {
    const before = data.length;
    crmImportText(JSON.stringify({ contacts: [
      { a: '12 Example St', s: 'Example', n: 'Owner not yet verified', suburb: 'Ellenbrook', stage: 'cold', note: '' },
      { a: '12 Example St', s: 'Example', n: 'Owner not yet verified', suburb: 'Bayswater', stage: 'cold', note: '' },
      { a: '12 Example St', s: 'Example', n: 'Owner not yet verified', suburb: 'Ellenbrook', stage: 'warm', note: 'second copy' }],
      activity: { 1: [{ ts: 1, type: 'Called', note: 'Bayswater call' }] },
      diary: [{ id: 't_imp', task: 'Ring Bayswater owner', contact: 'Owner not yet verified', contactId: 1, date: '-', type: 'upcoming', done: false }] }), 'backup.json');
    const by = data.filter((c) => c.a === '12 Example St');
    const bay = data.findIndex((c) => c.a === '12 Example St' && c.suburb === 'Bayswater');
    return { added: data.length - before, subs: by.map((c) => c.suburb).sort().join(), ell: by.find((c) => c.suburb === 'Ellenbrook').stage,
      act: JSON.stringify(actLog[bay] || []), task: (diaryTasks.find((t) => t.id === 't_imp') || {}).contactId === bay };
  });
  check(imp.added === 2 && imp.subs === 'Bayswater,Ellenbrook', 'importing the same address in two suburbs keeps both contacts', imp);
  check(imp.ell === 'warm', '…while a repeat in the same suburb joins the first (and moves it on)', imp.ell);
  check(/Bayswater call/.test(imp.act) && imp.task, 'imported call history and diary tasks attach to the right contact', imp);
  await f.evaluate(() => location.reload()); await sleep(1500);
  f = crmFrame();
  for (let i = 0; i < 40; i++) { try { if (await f.evaluate(() => typeof data !== 'undefined' && data.length > 0)) break; } catch (e) {} await sleep(250); f = crmFrame(); }
  check(await f.evaluate(() => data.filter((c) => c.a === '12 Example St').length === 2), 'both are still there after reloading');

  // ───────── Add a street by house numbers ─────────
  await f.evaluate(() => openStreetBuilder()); await sleep(200);
  await f.fill('#sb-name', 'example'); await f.selectOption('#sb-type', 'Way');
  await f.selectOption('#sb-suburb', 'Scarborough');
  await f.fill('#sb-from', '1'); await f.fill('#sb-to', '4'); await f.fill('#sb-extra', '1, 2A'); await sleep(150);
  check(/5 new properties/.test(await f.textContent('#sb-preview')), 'the street builder previews 1-4 plus 2A, with 1 typed twice counted once', await f.textContent('#sb-preview'));
  await f.click('#sb-go'); await sleep(300);
  const built = await f.evaluate(() => data.filter((c) => /Example Way$/.test(c.a)).map((c) => c.a + '|' + c.n + '|' + c.suburb));
  check(built.length === 5 && built.every((x) => /Owner not yet verified\|Scarborough$/.test(x)), '…and adds them as Owner not yet verified in that suburb', built);
  await f.evaluate(() => openStreetBuilder()); await sleep(200);
  await f.fill('#sb-name', 'Example'); await f.selectOption('#sb-type', 'Way'); await f.selectOption('#sb-suburb', 'Scarborough');
  await f.fill('#sb-from', '1'); await f.fill('#sb-to', '6'); await sleep(150);
  check(/2 new properties.*4 already in your CRM/.test(await f.textContent('#sb-preview')), 'running it again skips the houses already there', await f.textContent('#sb-preview'));
  await f.evaluate(() => document.getElementById('sb-modal').remove());

  // ───────── Paste a list: ID4me rows add phones and emails to the right card ─────────
  await f.evaluate(() => {
    [['Alex John Tester', '1 Probe Way'], ['Someone Else', '12 Rental Street'], ['Bea Mary Tester', '3 Probe Way']].forEach(function (r) {
      data.push({ id: data.length, s: r[1].split(' ')[1], a: r[1], n: r[0], ph: '-', em: '-', note: '', stage: 'cold', date: '', suburb: 'Scarborough' });
    });
    saveToStorage();
    openRPImport();
    document.getElementById('rp-paste').value = [
      'Bea Mary Tester, 0400 333 444, Probe Way, Scarborough',
      'Alex John Tester\t01/01/1970\t12 Rental Street SCARBOROUGH WA 6019\t0400 111 222\talex@example.com',
      'Nobody Known\t03/03/1990\t50 New Place SCARBOROUGH WA 6019\t0400 555 666'].join('\n');
    rpPreview(); rpApply();
    var m = document.getElementById('rp-modal'); if (m) m.remove();
  });
  const id4 = await f.evaluate(() => ({ alex: data.find((c) => c.n === 'Alex John Tester'), other: data.find((c) => c.n === 'Someone Else'), bea: data.find((c) => c.n === 'Bea Mary Tester'),
    nobody: data.some((c) => /New Place|Nobody Known/.test(c.a + c.n)) }));
  check(/0400 111 222/.test(id4.alex.ph) && /alex@example.com/.test(id4.alex.em) && id4.other.ph === '-', 'an ID4me row adds the phone and email to the person (found by name), not to whoever owns the address on the row', id4);
  check(/0400 333 444/.test(id4.bea.ph), '"Name, phone, street, suburb" finds the right card', id4.bea);
  check(!id4.nobody, 'an ID4me row for someone not in the CRM adds nothing (no address is added)');

  // ───────── ID4me row: also add the address as another property, in the suburb on the row ─────────
  await f.evaluate(() => {
    data.push({ id: data.length, s: 'Probe', a: '4 Probe Tce', n: 'Pat Kim Coowner & Sam Lee Prober', ph: '-', em: '-', note: '', stage: 'cold', date: '', suburb: 'Scarborough' });
    saveToStorage(); openRPImport();
    document.getElementById('rp-paste').value = 'Sam Lee Prober\t17 Probe Court, Testville WA 6999\tprober@example.com';
    rpPreview();
  });
  check(await f.evaluate(() => !!document.querySelector('#rp-result button[onclick^="rpAlsoNew"]')), 'a person found by name is offered "Also add as another property"');
  await f.evaluate(() => { document.querySelector('#rp-result button[onclick^="rpAlsoNew"]').click(); rpApply(); var m = document.getElementById('rp-modal'); if (m) m.remove(); });
  const also = await f.evaluate(() => ({ card: data.find((c) => c.a === '4 Probe Tce'), extra: data.find((c) => /^17 Probe C/.test(c.a)) }));
  check(/prober@example.com/.test(also.card.em) && also.extra && also.extra.n === 'Sam Lee Prober' && also.extra.suburb === 'Testville',
    '…which keeps the email on their card and adds the address owned by them, in the suburb on the row', also);

  // ───────── ID4me details tab: phones and emails onto existing cards, nothing new ─────────
  const id4n0 = await f.evaluate(() => {
    [['Gil Ann Prober', '21 Probe Way', 'Scarborough'], ['Pat Kim & Hal Prober', '23 Probe Way', 'Scarborough'], ['Ivy Prober', '25 Probe Way', 'Scarborough'], ['Ivy Prober', '27 Far Road', 'Otherton']]
      .forEach(function (r) { data.push({ id: data.length, s: 'Probe', a: r[1], n: r[0], ph: '-', em: '-', note: '', stage: 'cold', date: '', suburb: r[2] }); });
    saveToStorage(); renderCurrent(); return data.length;
  });
  await f.evaluate(() => openAddContactManual()); await sleep(200);
  await f.click('#ac-tab-id4me');
  await f.fill('#id4-paste', ['PROBER, GIL ANN', '12 OLD STREET ELSEWHERE WA 6000', '0400 211 211', 'gil@example.com', '',
    'HAL PROBER', '7 RENTAL LANE SCARBOROUGH WA 6019', '0400 233 233', '',
    'Ivy Prober\t01/01/1970\t20 Some Street, Otherton WA 6200\t0400 255 255', 'NOBODY PROBER', '50 NEW PLACE SCARBOROUGH WA 6019', '0400 277 277'].join('\n'));
  await f.click('#id4-find'); await sleep(200);
  check(/Add to 3 cards/.test(await f.textContent('#id4-go')), 'the ID4me tab finds three people by name (one written surname first) and skips the one not in the CRM', await f.textContent('#id4-go'));
  await f.evaluate(() => { window.alert = function () {}; }); await f.click('#id4-go'); await sleep(200);
  const id4r = await f.evaluate((n0) => ({ gil: data.find((c) => c.a === '21 Probe Way'), hal: data.find((c) => c.a === '23 Probe Way'), ivyHere: data.find((c) => c.a === '25 Probe Way'),
    ivyThere: data.find((c) => c.a === '27 Far Road'), added: data.length - n0 }), id4n0);
  check(/0400 211 211/.test(id4r.gil.ph) && /gil@example.com/.test(id4r.gil.em) && /0400 233 233/.test(id4r.hal.ph) && !/0400 211 211/.test(id4r.hal.ph),
    '…each person\u2019s own phone and email go on their own card', id4r);
  check(/0400 255 255/.test(id4r.ivyThere.ph) && id4r.ivyHere.ph === '-', 'two contacts with the same name: the one in the suburb on the ID4me row is picked', id4r);
  check(id4r.added === 0, 'nothing new is created and no ID4me address is added', id4r.added);
  await f.evaluate(() => closeAddContact());

  // ───────── hover help ─────────
  const missing = await f.$$eval('.topbar button', (bs) => bs.filter((x) => x.offsetParent && !window.__tips.forButton(x)).map((x) => x.textContent.trim()));
  check(!missing.length, 'every toolbar button has a description', missing);
  const cr = f.locator('.topbar button', { hasText: 'Call Runner' }).first();
  await cr.hover(); await sleep(600);
  const tip = await f.$eval('#mi-tip', (e) => [e.style.opacity, e.textContent]);
  check(tip[0] === '1' && /call list one contact at a time/.test(tip[1]), 'resting on Call Runner shows its description', tip);
  const colour = await cr.evaluate((e) => { const s = getComputedStyle(e); return [s.backgroundColor, s.color]; });
  check(colour[0] !== colour[1] && colour[0] !== 'rgb(249, 250, 251)', 'Call Runner stays readable while hovered', colour);
  await p.mouse.move(5, 800); await sleep(300);
  check(await f.$eval('#mi-tip', (e) => e.style.opacity) === '0', 'the description goes when the mouse moves away');

  check(!errs.length, 'no page errors', errs.slice(0, 3));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
