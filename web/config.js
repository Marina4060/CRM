// Public settings for the hosted CRM. Nothing here is secret: the anon key
// only lets people do what the database's row-security rules allow.
window.CRM_CONFIG = {
  appName: 'Real Estate CRM',
  // Supabase → Project Settings → API
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY',
  // shown on sign-up and when a trial ends; the plans themselves are listed in app.js (PLANS)
  priceLabel: 'from $100 AUD per agent per month',
  trialDays: 14,
  supportEmail: 'support@example.com',
  // the terms of service and privacy policy (web/terms.html, web/privacy.html) fill in these details
  termsUrl: 'terms.html',
  privacyUrl: 'privacy.html',
  legal: {
    businessName: '[Your business name]',
    abn: '[ABN]',
    address: '[Business address]',
    email: 'privacy@example.com',            // for privacy requests and complaints
    state: 'Western Australia',              // whose laws and courts apply
    gst: 'include GST',                      // or 'are plus GST'. Check with your accountant.
    effectiveDate: '[start date]',
    retentionDays: 90                        // how long data is kept after an account closes, before deletion
  }
};
