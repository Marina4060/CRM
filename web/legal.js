// Fills the business details from config.js into the terms and privacy pages.
(function () {
  var C = window.CRM_CONFIG || {}, L = C.legal || {};
  var v = {
    app: C.appName || 'Real Estate CRM', business: L.businessName, abn: L.abn, address: L.address,
    email: L.email || C.supportEmail, support: C.supportEmail, state: L.state, gst: L.gst,
    date: L.effectiveDate, days: String(L.retentionDays || 90), trial: String(C.trialDays || 14)
  };
  document.querySelectorAll('[data-fill]').forEach(function (el) {
    var k = el.getAttribute('data-fill'); if (v[k] == null) return;
    if (el.tagName === 'A') { el.href = 'mailto:' + v[k]; }
    el.textContent = v[k];
  });
})();
