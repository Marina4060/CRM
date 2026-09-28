// Public settings for the hosted CRM. Nothing here is secret: the anon key
// only lets people do what the database's row-security rules allow.
window.CRM_CONFIG = {
  appName: 'Real Estate CRM',
  // Supabase → Project Settings → API
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY',
  priceLabel: '$100 AUD per user per month',
  trialDays: 14,
  supportEmail: 'support@example.com',
  // links shown on the sign-up page (add these pages before launch)
  termsUrl: '',
  privacyUrl: ''
};
