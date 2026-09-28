/* Demo helpers: one-tap sign-in as the sample people, and a panel with
   things to try, plus fast-forward and reset. */
(function () {
  'use strict';
  var PEOPLE = [
    { email: 'olivia@harbourrealty.demo', label: 'Olivia (agency owner)' },
    { email: 'sam@harbourrealty.demo', label: 'Sam (agent)' }
  ];
  function signInAs(email) {
    var f = document.getElementById('f-signin');
    document.querySelectorAll('[data-auth=signin]')[0] && f.hidden && document.querySelectorAll('[data-auth=signin]')[0].click();
    f.email.value = email; f.password.value = 'demo1234';
    f.requestSubmit();
  }

  // on the sign-in card
  var card = document.querySelector('.auth-card');
  var quick = document.createElement('div');
  quick.className = 'demo-quick';
  quick.innerHTML = '<p class="demo-kicker">Demo · try it as</p><div class="demo-people">' +
    PEOPLE.map(function (p) { return '<button type="button" class="btn" data-demo-as="' + p.email + '">' + p.label + '</button>'; }).join('') +
    '</div><p class="muted small">Or create your own account below: it starts a 14-day trial. Password for the sample people: <code>demo1234</code></p>';
  card.insertBefore(quick, card.querySelector('#invite-note'));
  quick.addEventListener('click', function (e) { var b = e.target.closest('[data-demo-as]'); if (b) signInAs(b.getAttribute('data-demo-as')); });

  // floating panel
  var chip = document.createElement('button');
  chip.className = 'demo-chip'; chip.type = 'button'; chip.textContent = 'Demo guide';
  chip.setAttribute('aria-expanded', 'false');
  var panel = document.createElement('aside');
  panel.className = 'demo-panel'; panel.hidden = true;
  panel.innerHTML =
    '<h2>Try these</h2>' +
    '<ol>' +
    '<li><b>Shared list.</b> As Olivia, open the CRM and add a contact. Sign out, sign in as Sam: he sees it too.</li>' +
    '<li><b>Team dashboard.</b> As Olivia, open <b>Team</b> for each agent\'s calls, texts and contacts added.</li>' +
    '<li><b>Invite someone.</b> Invite any email, sign out, then create an account with that email. They join the team.</li>' +
    '<li><b>Plans.</b> Open <b>Billing</b>, switch between Per agent and the Agency plans, then Subscribe (payment is simulated).</li>' +
    '<li><b>Trial ending.</b> Use the button below to see what people see when the trial runs out.</li>' +
    '</ol>' +
    '<p class="muted small">Everything here is sample data kept only in this browser. Stripe and emails are simulated. Downloads and backups don\'t work inside this preview.</p>' +
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
