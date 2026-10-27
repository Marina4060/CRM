// Public settings for the hosted CRM. Nothing here is secret: the anon key
// only lets people do what the database's row-security rules allow.
window.CRM_CONFIG = {
  appName: 'MICRM',
  // Supabase → Project Settings → API
  supabaseUrl: 'https://uzdmzewtixarwgronzhm.supabase.co',
  supabaseAnonKey: 'sb_publishable_gQmqFNPzg5zqGVI0T_bl2w_dODyP_Lw',
  // prices are set in app.js (PLANS) and shown with GST worked in, following legal.gst below
  agencyPlans: false,   // true offers the Agency 10 / Agency 20 plans (one shared contact list) again
  trialDays: 14,
  supportEmail: 'support@micrm.com.au',
  // the terms of service and privacy policy (web/terms.html, web/privacy.html) fill in these details
  termsUrl: 'terms.html',
  privacyUrl: 'privacy.html',
  legal: {
    businessName: 'MICRM',
    abn: '18 537 952 610',
    address: '[Business address]',
    email: 'support@micrm.com.au',           // for privacy requests and complaints
    state: 'Western Australia',              // whose laws and courts apply
    gst: 'include GST',                      // 'include GST', 'plus GST' (the front page then shows prices with GST added, as one total)
                                             // or 'no GST' if you're not registered. Check with your accountant.
    effectiveDate: '[start date]',
    retentionDays: 90                        // how long data is kept after an account closes, before deletion
  }
};
