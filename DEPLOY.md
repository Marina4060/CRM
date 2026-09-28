# Putting the CRM online with subscriptions

This turns the CRM into an online service. People sign up, get a 14-day free trial with no card needed, and then pay **$100 AUD per user per month** by card through Stripe. Their data is saved to the cloud and syncs between phone and computer. Agencies can have a team of agents with roles and a team dashboard.

```
web/                 the website people open (sign in, CRM, Team, Billing, Help)
index.html           the CRM itself; uploaded to private storage, only paying users can load it
supabase/migrations  database: accounts, teams, roles, invites, trial, synced data, support
supabase/functions   Stripe: checkout, change seats, billing portal, webhook
tools/publish_app.py rolls out a new CRM version to everyone
tests/               end-to-end test (see Testing)
```

You need three accounts: **Supabase** (database and logins), **Stripe** (payments; you already have this) and a static host such as **Netlify** or **Cloudflare Pages** (the website). Do everything in **Stripe test mode first**.

## 1. Supabase

1. Create a project at supabase.com. Choose the **Sydney** region so client data stays in Australia.
2. **Database:** open *SQL Editor*, paste in the whole of `supabase/migrations/20260928000000_subscriptions.sql`, and run it.
   (Or, with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.)
3. **Authentication → URL Configuration:** set *Site URL* to your website address, e.g. `https://crm.yourdomain.com.au`. Add the same address to *Redirect URLs*.
4. **Authentication → Providers → Email:** keep *Confirm email* on.
5. **Authentication → Emails → SMTP:** set up your own email sender (e.g. Resend, Postmark or your domain's mail server). Supabase's built-in sender only sends a few emails an hour, which isn't enough once people sign up. Edit the email templates so they carry your business name.
6. **Project Settings → API:** copy the *Project URL* and the *anon public* key for step 4. The *service_role* key is secret: use it only in step 5, and never put it in the website or in git.

## 2. Stripe

1. **Product catalogue → Add product:** name it "Real Estate CRM". Give it a **recurring** price of **100.00 AUD per month**, charged per unit (each unit is one user). Copy the price ID (`price_…`).
   - GST: decide with your accountant whether $100 includes GST. If you're registered, turn on Stripe Tax or set the price as tax-inclusive, and add your ABN under *Settings → Business → Tax details*, so invoices show it.
2. **Settings → Billing → Customer portal:** allow customers to update their payment method, view invoices, **change quantity** and cancel (cancel at the end of the billing period).
3. **Developers → API keys:** copy the **secret key** (`sk_test_…` for now).

## 3. Server functions

With the [Supabase CLI](https://supabase.com/docs/guides/cli) installed and linked to your project:

```
supabase functions deploy create-checkout
supabase functions deploy set-seats
supabase functions deploy billing-portal
supabase functions deploy stripe-webhook --no-verify-jwt

supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_PRICE_ID=price_... SITE_URL=https://crm.yourdomain.com.au
```

Then in Stripe, go to **Developers → Webhooks → Add endpoint**:
- URL: `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed` and all `customer.subscription.*` events (created, updated, deleted, paused, resumed).
- Copy the signing secret, then run `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`

## 4. The website

1. Edit `web/config.js`: `supabaseUrl`, `supabaseAnonKey`, `supportEmail`, and the links to your terms and privacy pages.
2. Deploy the `web/` folder to Netlify or Cloudflare Pages. With Netlify you can drag and drop the folder, then connect your domain. HTTPS is required for installing it as a phone app.

## 5. Upload the CRM

```
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
  python3 tools/publish_app.py index.html "First release"
```

Do the same whenever you change the CRM. Everyone gets the new version the next time they open the app, and your note appears under *Help → What's new*. To regenerate `index.html` from a newer personal copy, run `python3 tools/make_blank_crm.py your_file.html index.html` first.

## 6. Try it (test mode)

1. Open the site, create an account and check the confirmation email.
2. Add a contact, then sign in on your phone and check the contact is there. On your phone, use *Add to Home Screen*.
3. **Team:** invite a second email address, open the link in another browser and sign up. The dashboard should show both people.
4. **Billing → Subscribe:** pay with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC). The top bar should change to *Subscribed*.
5. Open **Manage billing**, cancel, and check the app shows when access ends.

When everything works, switch Stripe to live mode: create the product and webhook again in live mode, and set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` to the live values.

## Running the service

- **Support messages** from the app's Help page are in Supabase → *Table editor → support_requests*. Reply by email, then set `status` to `answered`. To get an email for each new message, add a Database Webhook on that table.
- **Customers and payments** are in Stripe. The trial and subscription state of each team is in the `teams` table.
- **Giving someone free access** (e.g. a pilot agency): in the `teams` table, set `trial_ends_at` to a later date.
- **Costs to run:** check each provider's current pricing. Supabase's free plan pauses inactive projects, so use the Pro plan once you have paying customers. Netlify and Cloudflare Pages are free at this size, and Stripe takes a fee on each card payment.

## Before you launch

- **Terms of service and a privacy policy.** Agents will store their clients' personal information, so your policy needs to cover the Australian Privacy Principles: what's stored, where (Sydney), who can see it, and how people get it deleted. Link both pages in `web/config.js`.
- An ABN on invoices, and a decision on GST (see step 2).
- A support email address you check.

## How access works

- Every account is part of a team. A solo agent is a team of one, and they are its **owner**.
- **Owner:** billing, seats, roles and invites. **Admin:** invites agents and sees the team dashboard. **Agent:** their own CRM only.
- Each agent's contacts are private to them. The team dashboard shows counts only (contacts, hot leads, appraisals, listings, sales, calls and texts this week), never client names or details.
- The trial is 14 days from when a person signs up. Leaving and re-joining teams doesn't restart it.
- A team has access while it's in trial, or while it's paying for at least as many seats as it has people. When a card fails (`past_due`), access continues while Stripe retries. After a subscription ends, people can still sign in to download their data, but can't use the CRM.
- These rules are enforced by the database itself (row-level security), not just the website. `supabase/tests/permissions_test.sh` checks them.

## Testing

On a machine with PostgreSQL 16 and Node:

```
# the database rules (42 checks)
PGHOST=localhost PGUSER=postgres supabase/tests/permissions_test.sh

# the whole app in a browser against a local stand-in for Supabase and Stripe (36 checks)
cd tests && npm install && cd ..
PGDATABASE=crm_e2e tests/setup_e2e_db.sh
PGDATABASE=crm_e2e node tests/mock_supabase.js 8787 &
PGDATABASE=crm_e2e node tests/e2e_hosted.js http://localhost:8787
```

The browser test covers sign-up, the trial, syncing between a computer and a phone, inviting an agent, keeping agents' data private, the dashboard, roles, subscribing, the Help form, what happens when a subscription ends, and sign-out.
