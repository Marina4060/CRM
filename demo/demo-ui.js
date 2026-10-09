/* Demo helpers: a note on the sign-in card, and a panel with things to try,
   plus fast-forward and reset. */
(function () {
  'use strict';
  // on the sign-in card: point new visitors at sign-up
  var card = document.querySelector('.auth-card');
  var quick = document.createElement('div');
  quick.className = 'demo-quick';
  quick.innerHTML = '<p class="demo-kicker">Demo</p><p class="small">This preview starts empty, like the real site. ' +
    '<a href="#" id="demo-signup">Create an account</a> with any email and password (8+ characters) to start a 14-day trial. Nothing is sent anywhere.</p>';
  card.insertBefore(quick, card.querySelector('#invite-note'));
  document.getElementById('demo-signup').addEventListener('click', function (e) { e.preventDefault(); var l = document.querySelector('#f-signin [data-auth=signup]'); if (l) l.click(); });

  // floating panel
  var chip = document.createElement('button');
  chip.className = 'demo-chip'; chip.type = 'button'; chip.textContent = 'Demo guide';
  chip.setAttribute('aria-expanded', 'false');
  var panel = document.createElement('aside');
  panel.className = 'demo-panel'; panel.hidden = true;
  panel.innerHTML =
    '<h2>Try these</h2>' +
    '<ol>' +
    '<li><b>Sign up.</b> Create an account, fill in My details, and add a contact with <b>+ Add Contact</b>.</li>' +
    '<li><b>Map.</b> Add a few contacts with real street addresses, then tap <b>Map</b> beside Funnel and Table. Tap a pin, then <b>Who\'s within 300 m?</b></li>' +
    '<li><b>Vendor report.</b> Mark a contact <b>Listed</b>, add visitors in <b>Reports \u2192 Open Home Register</b>, then open <b>\uD83D\uDCE3 Vendor Reports</b> and preview the report.</li>' +
    '<li><b>Buyers.</b> Open <b>\uD83D\uDC65 Buyers</b>, add a buyer, then add a note like <i>Pre-approved to $800k, first home buyer, buying in the next 2 months</i> and watch them move to Qualified.</li>' +
    '<li><b>Receipts.</b> In <b>Expenses</b>, tap <b>Photo or file</b> before adding an expense.</li>' +
    '<li><b>Invite an agent.</b> Open <b>Team</b>, invite any email, sign out, then create an account with that email and tap <b>Join</b>.</li>' +
    '<li><b>Shared list.</b> As the owner, open <b>Billing</b> and try <b>Agency 10</b>. Now contacts either of you add show for both.</li>' +
    '<li><b>Team dashboard.</b> As the owner, open <b>Team</b> for each person\'s contacts added, calls, texts and emails.</li>' +
    '<li><b>Subscribe.</b> On <b>Billing</b>, tap Subscribe (payment is simulated).</li>' +
    '<li><b>Trial ending.</b> Use the button below to see what people see when the trial runs out.</li>' +
    '<li><b>Delete account.</b> Open the round button top right, then <b>Delete my account</b>.</li>' +
    '</ol>' +
    '<p class="muted small">Everything you enter stays only in this browser. Stripe and emails are simulated. Downloads and backups don\'t work inside this preview.</p>' +
    '<div class="row wrap"><button type="button" class="btn small" id="demo-end">End the free trial now</button>' +
    '<button type="button" class="btn small danger" id="demo-reset">Reset demo</button></div>';
  document.body.appendChild(chip); document.body.appendChild(panel);
  chip.addEventListener('click', function () { panel.hidden = !panel.hidden; chip.setAttribute('aria-expanded', String(!panel.hidden)); });
  document.getElementById('demo-end').addEventListener('click', function () { window.CRM_DEMO_END_TRIAL(); });
  document.getElementById('demo-reset').addEventListener('click', function () {
    var b = this;
    if (b.dataset.sure) { window.CRM_DEMO_RESET(); return; }
    b.dataset.sure = '1'; b.textContent = 'Tap again to reset everything';
    setTimeout(function () { b.dataset.sure = ''; b.textContent = 'Reset demo'; }, 4000);
  });
})();
