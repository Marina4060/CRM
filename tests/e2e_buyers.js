// Buyers (qualified or not, notes, property tags), the Call Runner's
// missing-details tools, receipts on expenses and the colours, inside the
// online app (demo build).
//   node tests/e2e_buyers.js http://localhost:8797/_local.html [phone]
const { chromium } = require('playwright');
const URL0 = process.argv[2], PHONE = process.argv[3] === 'phone';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(ok, what, extra) { if (ok) pass++; else fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 300))); }
// a small red PNG, made on the fly
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR42mP8z8DwnxEFMBkYAQDfvwf9e7a2OAAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext(PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1300, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());

  await p.goto(URL0); await sleep(600);
  await p.click('#demo-signup');
  await p.fill('#f-signup [name=name]', 'Buyer Tester'); await p.fill('#f-signup [name=email]', 'buy@test.au');
  await p.fill('#f-signup [name=password]', 'password1'); await p.check('#f-signup [name=agree]'); await p.click('#f-signup button[type=submit]');
  const crmFrame = () => p.frames().find((y) => y.parentFrame() === p.mainFrame());
  let f = null;
  for (let i = 0; i < 60 && !f; i++) { const x = crmFrame(); try { if (x && await x.evaluate(() => typeof data !== 'undefined')) f = x; } catch (e) {} await sleep(250); }
  await f.waitForSelector('#pf-agency'); await f.fill('#pf-agency', 'Test Realty'); await f.fill('#pf-phone', '0400 111 222'); await f.click('#pf-save');
  for (let i = 0; i < 40; i++) { await sleep(250); const x = crmFrame(); try { if (x && await x.evaluate(() => ME.isSet)) { f = x; break; } } catch (e) {} }
  await f.evaluate(() => {
    [['Ann Lee', '1 Sea St', 'Sea', 'Scarborough', 'cold', '0400 000 001', ''], ['Bob Kerr', '2 Sea St', 'Sea', 'Scarborough', 'cold', '0400 000 002', 'bob@example.com'],
     ['Cy Tan', '3 Sea St', 'Sea', 'Scarborough', 'cold', '', ''], ['Di Moss', '4 Hill Rd', 'Hill', 'Doubleview', 'listed', '0400 000 004', 'di@example.com']]
      .forEach(function (r) { data.push({ id: data.length, s: r[2], a: r[1], n: r[0], ph: r[5], em: r[6], note: 'Test.', stage: r[4], date: '25/09/26', apprDate: '', suburb: r[3] }); });
    saveToStorage(); if (typeof rebuildSuburbTabs === 'function') rebuildSuburbTabs(); renderCurrent();
    openHomes.push({ prop: '4 Hill Road', date: '2026-10-04', name: 'Pat Visitor', ph: '0411 222 333', em: 'pat@example.com', interest: 'High', note: 'Pre-approved, loved the kitchen' });
    _saveExtra();
  });
  await sleep(400);

  // ───────── Missing phone or email: out of the pipeline ─────────
  check(!(await f.$('#missing-btn')), 'no Missing phone or email button in the pipeline');
  check(!/No phone|No email/.test(await f.textContent('#board')), 'no "No phone" / "No email" labels on the cards');

  // ───────── ...and still in the Call Runner ─────────
  await f.click('.topbar [onclick="openCR()"]');
  let cl = null;
  for (let i = 0; i < 40 && !cl; i++) { await sleep(250); const x = p.frames().find((y) => y.parentFrame() === f); try { if (x && await x.evaluate(() => !!document.querySelector('#chips [data-f="nodetails"]'))) cl = x; } catch (e) {} }
  check(!!cl, 'the Call Runner opens with its "No phone or email" filter');
  if (cl) {
    const chip = await cl.textContent('#chips [data-f="nodetails"]');
    check(/No phone or email\s*2/.test(chip), 'the filter counts the 2 contacts missing a phone or an email', chip);
    await cl.click('#chips [data-f="nodetails"]'); await sleep(300);
    const rows = await cl.textContent('#rows');
    check(/Ann Lee/.test(rows) && /Cy Tan/.test(rows) && !/Bob Kerr/.test(rows), 'it lists Ann (no email) and Cy (no phone or email), not Bob', rows.slice(0, 200));
  }
  await f.evaluate(() => dclClose());

  // ───────── Buyers ─────────
  await f.click('.topbar [onclick="openBuyers()"]'); await sleep(300);
  check(await f.isVisible('#by-wrap'), 'Buyers button opens the Buyers window');
  check(/1 open home visitor not in your buyers yet/.test(await f.textContent('#by-body')), 'offers the open home visitor who isn’t a buyer yet');
  await f.evaluate(() => byAddVisitors()); await sleep(200);
  let pat = await f.evaluate(() => buyers.find((x) => x.name === 'Pat Visitor'));
  check(pat && pat.finance === 'Pre-approved' && pat.tags.length === 1 && /4 Hill/.test(pat.tags[0]) && pat.keen, 'visitor added: tagged to 4 Hill Road, pre-approved read from the note, keen', pat);

  // a new buyer through the form
  await f.evaluate(() => byNew()); await sleep(100);
  await f.fill('#byn-name', 'Sam Lee'); await f.fill('#byn-ph', '0422 333 444'); await f.fill('#byn-note', 'Looking for a 4 bed family home');
  await f.evaluate(() => bySaveNew()); await sleep(200);
  let sam = await f.evaluate(() => buyers.find((x) => x.name === 'Sam Lee'));
  check(sam && sam.beds === '4' && sam.log.length === 1, 'new buyer saved; the first note set 4 beds', sam);
  let ev = await f.evaluate(() => __buyers.evaluate(buyers.find((x) => x.name === 'Sam Lee')));
  check(!ev.qualified && ev.score < 50, 'Sam is not qualified yet (no budget, finance or timeframe)', ev);
  await f.evaluate(() => byTab('not')); await sleep(100);
  check(/Sam Lee/.test(await f.textContent('#by-body')), 'Sam is under Not qualified');

  // each new note is read and Sam is evaluated again
  const samId = sam.id;
  await f.fill('#by-n-' + samId, 'Spoke today. Pre-approved to $820k with the bank, first home buyer, wants to buy in the next 2 months');
  await f.evaluate((id) => byNote(id), samId); await sleep(200);
  sam = await f.evaluate(() => buyers.find((x) => x.name === 'Sam Lee'));
  ev = await f.evaluate(() => __buyers.evaluate(buyers.find((x) => x.name === 'Sam Lee')));
  check(sam.finance === 'Pre-approved' && sam.budget === '820000' && sam.timeframe === 'Within 3 months' && sam.sellFirst === 'Nothing to sell', 'the note set finance, budget, timeframe and selling', sam);
  check(ev.qualified && ev.score >= 90, 'Sam is now qualified', ev);
  const got = await f.textContent('#by-' + samId + ' .by-got');
  check(/Now qualified/.test(got) && /Budget: \$820,000/.test(got), 'the card says what the note changed', got);
  check(/Sam Lee/.test(await f.textContent('#by-body')) && await f.evaluate(() => document.querySelector('.by-tab.on').textContent.indexOf('Qualified') === 0), 'Sam moved to the Qualified tab');

  await f.fill('#by-n-' + samId, 'Update: they need to sell their house first');
  await f.evaluate((id) => byNote(id), samId); await sleep(200);
  ev = await f.evaluate(() => __buyers.evaluate(buyers.find((x) => x.name === 'Sam Lee')));
  check(!ev.qualified && ev.checks.some((c) => /Needs to sell first/.test(c.t)), 'needing to sell first takes Sam off Qualified', ev.checks);
  check(/No longer qualified/.test(await f.textContent('#by-' + samId + ' .by-got')), 'and the card says so');

  // tagging
  await f.evaluate((id) => byTag(id, '4 Hill Rd'), samId); await sleep(100);
  sam = await f.evaluate(() => buyers.find((x) => x.name === 'Sam Lee'));
  check(sam.tags.indexOf('4 Hill Rd') >= 0, 'Sam tagged to 4 Hill Rd');
  await f.selectOption('#by-prop', { label: '4 Hill Rd (2)' }).catch(() => {}); await f.evaluate(() => byTab('all')); await sleep(100);
  const filt = await f.textContent('#by-body');
  check(/Sam Lee/.test(filt) && /Pat Visitor/.test(filt), 'filtering by 4 Hill Rd shows both tagged buyers (Road and Rd count as one)');
  const fp = await f.evaluate(() => __buyers.forProperty('4 Hill Rd'));
  check(fp.all === 2 && fp.qualified === 0, 'property count: 2 tagged, 0 qualified (Pat has no budget or timeframe yet)', fp);
  await f.evaluate((id) => byUntag(id, 0), samId);
  check(await f.evaluate(() => buyers.find((x) => x.name === 'Sam Lee').tags.length) === 0, 'a tag can be removed');

  // details panel and persistence
  await f.selectOption('#by-prop', ''); await sleep(100);
  await f.evaluate((id) => byOpen(id), samId); await sleep(100);
  await f.selectOption(`[data-bf="sellFirst"][data-id="${samId}"]`, 'Sold or under contract'); await sleep(200);
  ev = await f.evaluate(() => __buyers.evaluate(buyers.find((x) => x.name === 'Sam Lee')));
  check(ev.qualified, 'changing "Home to sell" in Details re-evaluates (qualified again)');
  const stored = await f.evaluate(() => JSON.parse(localStorage.getItem('crm_buyers_v1')).find((x) => x.name === 'Sam Lee'));
  check(stored && stored.log.length === 3 && stored.finance === 'Pre-approved' && /need to sell/.test(stored.note), 'saved to crm_buyers_v1 with the notes', stored && stored.log.length);
  await f.evaluate(() => closeBuyers());

  // the vendor report shows the buyers for its property
  await f.evaluate(() => openVendorReports()); await sleep(200);
  await f.evaluate(() => { [...document.querySelectorAll('#vr-body button')].find((x) => /Start report/.test(x.textContent)).click(); }); await sleep(200);
  check(/Buyers for this property:\s*1 tagged/.test(await f.textContent('#vr-body')), 'the vendor report shows buyers tagged to the listing', (await f.textContent('#vr-body')).match(/Buyers for this property:[^V]*/));
  await f.evaluate(() => vrBuyers()); await sleep(200);
  check(await f.isVisible('#by-wrap') && /Pat Visitor/.test(await f.textContent('#by-body')) && !/Sam Lee/.test(await f.textContent('#by-body')), 'View buyers opens Buyers for that property');
  await f.evaluate(() => { closeBuyers(); closeVendorReports(); });

  // ───────── Receipts on expenses ─────────
  await f.evaluate(() => openExp()); await sleep(300);
  check(await f.isVisible('#exp-receipt-btn'), 'Expenses has a Receipt button');
  check(await f.getAttribute('#exp-receipt-file', 'accept') === 'image/*,application/pdf', 'it takes photos (camera on a phone) or PDF files');
  await f.setInputFiles('#exp-receipt-file', { name: 'fuel.png', mimeType: 'image/png', buffer: PNG }); await sleep(200);
  check(/fuel/.test(await f.textContent('#exp-receipt-btn')), 'the chosen receipt shows on the button');
  await f.fill('#exp-desc', 'Fuel for appraisals'); await f.fill('#exp-amount', '88'); await f.evaluate(() => addExpense()); await sleep(800);
  const e1 = await f.evaluate(() => expenses.find((x) => x.desc === 'Fuel for appraisals'));
  check(e1 && e1.receipt && /fuel/.test(e1.receipt.name), 'the expense is saved with its receipt', e1);
  const rec = await f.evaluate((id) => __receipts.get(id).then((r) => r ? { type: r.type, size: r.blob.size } : null), e1.id);
  check(rec && rec.size > 0, 'the receipt file is stored on the device', rec);
  check(/1 receipt saved on this device/.test(await f.textContent('#exp-receipt-note')), 'Expenses says how many receipts are saved');
  await f.evaluate((id) => document.querySelector('#exp-tbody .exp-del[data-id="' + id + '"]').previousElementSibling.click(), e1.id); await sleep(500);
  check(await f.isVisible('#rcpt-modal') && await f.evaluate(() => { const i = document.querySelector('#rcpt-modal img'); return !!i && i.complete && i.naturalWidth > 0; }), 'tapping 🧾 shows the receipt photo');
  check(await f.evaluate(() => !!document.querySelector('#rcpt-modal a[download]')), 'with a Download link');
  await f.click('#rcpt-close');
  // a PDF added later to an expense that had none
  await f.fill('#exp-desc', 'Signboards'); await f.fill('#exp-amount', '220'); await f.evaluate(() => addExpense()); await sleep(400);
  const e2 = await f.evaluate(() => expenses.find((x) => x.desc === 'Signboards'));
  check(e2 && !e2.receipt, 'an expense can be saved without a receipt');
  await f.evaluate((id) => document.querySelector('#exp-tbody .exp-del[data-id="' + id + '"]').previousElementSibling.click(), e2.id);
  await f.setInputFiles('#exp-receipt-file', { name: 'invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%test\n') }); await sleep(600);
  check(await f.evaluate(() => (expenses.find((x) => x.desc === 'Signboards').receipt || {}).name) === 'invoice.pdf', '📎 adds a receipt (PDF) to an existing expense');
  // deleting the expense deletes its receipt
  await f.evaluate((id) => deleteExpense(document.querySelector('#exp-tbody .exp-del[data-id="' + id + '"]')), e1.id); await sleep(400);
  check(await f.evaluate((id) => __receipts.get(id).then((r) => !r), e1.id), 'deleting an expense deletes its receipt');
  await f.evaluate(() => closeExp());

  // ───────── colours ─────────
  const look = await f.evaluate(() => ({
    add: getComputedStyle(document.querySelector('.topbar [onclick="openAddContact()"]')).backgroundColor,
    plain: getComputedStyle(document.querySelector('.topbar [onclick="openExp()"]')).backgroundColor,
    hot: LANES.find((l) => l.key === 'hot').bar,
  }));
  check(look.add === 'rgb(31, 58, 95)' && look.plain === 'rgb(255, 255, 255)' && look.hot === '#D92D20', 'main actions use the accent, other buttons are plain, stage colours updated', look);

  check(errs.length === 0, 'no script errors', errs);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
