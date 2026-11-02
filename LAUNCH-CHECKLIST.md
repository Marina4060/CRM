# MICRM launch checklist

## Done
- Website on micrm.com.au (Netlify, HTTPS, visibility Private for now)
- Emails sent from noreply@micrm.com.au (Resend, SMTP in Supabase)
- support@micrm.com.au forwards to the owner's inbox (ImprovMX)
- Stripe sandbox: $399 AUD per agent per month, webhook working
- Nightly clean-ups: purge-expired-crm-data (3:30) and purge-expired-receipts (3:45), tested 200
- Business details in web/config.js: MICRM, ABN 18 537 952 610, Ballajura WA 6066, Western Australia
- Business accounts moved off the work email; two-step login on
- Latest website (business details) uploaded to Netlify
- Full test run in test mode: log in, $399 plan active, add contact, saved online, Manage billing opens

## Supabase: to do later (while we are still testing the CRM)
- Upload the latest CRM to Storage → app: delete the old crm.html and
  version.json, upload the new ones. The newest is version 2026-11-02-1843386
  (street by house numbers, whole street tab, stages stick, suburbs wrap, Midnight & Gold, Delete
  contact, hover help, import by address and suburb). crm.html is index.html
  from this repository; Claude makes a fresh version.json each time.
- When ready: upgrade to Supabase Pro for daily backups (week before launch).
- With the Stripe live switch: replace STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
  and STRIPE_PRICE_ID in Edge Functions → Secrets with the live ones.
- Launch day: Authentication → turn sign-ups back on.
- Nightly clean-ups are set up and tested (nothing to do).

## Next session (before launch)
- Move contacts to Supabase rows: each contact its own row (like the agency
  shared list, team_contacts), only changed contacts sent, no overwriting
  between devices. Keep an offline copy in IndexedDB instead of localStorage
  (about 5 MB; 4,124 contacts already use about 3.8 MB). One-time automatic
  move of existing data, tested on a copy first.
- Ask AI: hide it for launch, or build it properly (key on the server, only
  the relevant contacts sent, privacy policy updated). Decision pending.

## Before launch
1. Register MICRM as a business name with ASIC, linked to the ABN
2. Insurance: tech professional indemnity + cyber
3. Lawyer review of web/terms.html and web/privacy.html
4. Supabase Pro (daily backups), the week before launch
5. Stripe live mode: recreate the $399 price and the webhook, update STRIPE_* secrets
6. Launch day: set legal.effectiveDate in web/config.js, Netlify visibility Public, Supabase sign-ups on

## After launch
- iPhone (App Store) and Android (Google Play) apps, sign-in only
