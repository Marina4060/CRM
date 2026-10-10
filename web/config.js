// Public settings for the hosted CRM. Nothing here is secret: the anon key
// only lets people do what the database's row-security rules allow.
window.CRM_CONFIG = {
  appName: 'MICRM',
  // Supabase → Project Settings → API
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY',
  // prices are set in app.js (PLANS) and shown with GST worked in, following legal.gst below
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
    gst: 'include GST',                      // 'include GST', 'plus GST' (the front page then shows prices with GST added, as one total)
                                             // or 'no GST' if you're not registered. Check with your accountant.
    effectiveDate: '[start date]',
    retentionDays: 90                        // how long data is kept after an account closes, before deletion
  }
};
