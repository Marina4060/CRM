# MICRM launch checklist

## Done
- Website on micrm.com.au (Netlify, HTTPS, visibility Private for now)
- Emails sent from noreply@micrm.com.au (Resend, SMTP in Supabase)
- support@micrm.com.au forwards to the owner's inbox (ImprovMX)
- Stripe sandbox: $399 AUD per agent per month, webhook working
- Nightly clean-ups: purge-expired-crm-data (3:30) and purge-expired-receipts (3:45), tested 200
- Business details in web/config.js: MICRM, ABN 18 537 952 610, Ballajura WA 6066, Western Australia
- Business accounts moved off the work email; two-step login on

## Before launch
1. Upload the latest website zip to Netlify (business details)
2. Full test run in test mode: sign up, subscribe with card 4242 4242 4242 4242, use the CRM, cancel
3. Register MICRM as a business name with ASIC, linked to the ABN
4. Insurance: tech professional indemnity + cyber
5. Lawyer review of web/terms.html and web/privacy.html
6. Supabase Pro (daily backups), the week before launch
7. Stripe live mode: recreate the $399 price and the webhook, update STRIPE_* secrets
8. Launch day: set legal.effectiveDate in web/config.js, Netlify visibility Public, Supabase sign-ups on

## After launch
- iPhone (App Store) and Android (Google Play) apps, sign-in only
