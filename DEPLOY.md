# Putting the CRM online with subscriptions

This turns the CRM into an online service. People sign up and get a 14-day free trial with no card needed. After that they pay monthly by card through Stripe on one of three plans:

| Plan | Price (AUD) | People | Contacts |
|---|---|---|---|
| **Per agent** | $100 per agent per month | any number | private to each agent |
| **Agency 10** | $500 per month | up to 10 | one shared list for the whole agency |
| **Agency 20** | $1000 per month | up to 20 | one shared list for the whole agency |

Data is saved to the cloud and syncs between phone and computer. Teams have roles (owner, admin, agent) and a team dashboard. The owner can try any plan during the trial and switch plans later.

```
web/                 the website: index.html is the front page (features, plans, Start free trial);
                     app.html is the app people sign in to (CRM, Team, Billing, Help); terms, privacy
index.html           the CRM itself; uploaded to private storage, only paying users can load it
supabase/migrations  database: accounts, teams, roles, invites, trial, synced data, support, receipts
supabase/functions   Stripe: checkout, change plan, change seats, billing portal, webhook
tools/publish_app.py rolls out a new CRM version to everyone
tests/               end-to-end test (see Testing)
```

You need three accounts: **Supabase** (database and logins), **Stripe** (payments; you already have this) and a static host such as **Netlify** or **Cloudflare Pages** (the website). Do everything in **Stripe test mode first**.

## 1. Supabase

1. Create a project at supabase.com. Choose the **Sydney** region so client data stays in Australia.
2. **Database:** open *SQL Editor*, paste in the whole of `supabase/migrations/20260928000000_subscriptions.sql`, and run it.
   (Or, with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.)
3. **Authentication → URL Configuration:** set *Site URL* to the app's address, e.g. `https://micrm.com.au/app.html`. Add the same address to *Redirect URLs*. (The front page is at `https://micrm.com.au/`; sign-up, confirmation and password emails all lead to the app.)
4. **Authentication → Providers → Email:** keep *Confirm email* on.
5. **Authentication → Emails → SMTP:** set up your own email sender (e.g. Resend, Postmark or your domain's mail server). Supabase's built-in sender only sends a few emails an hour, which isn't enough once people sign up. Edit the email templates so they carry your business name.
6. **Project Settings → API:** copy the *Project URL* and the *anon public* key for step 4. The *service_role* key is secret: use it only in step 5, and never put it in the website or in git.

## 2. Stripe

1. **Product catalogue → Add product:** name it "MICRM" and add three **recurring monthly** prices in **AUD**. Copy each price ID (`price_…`):
   - **Per agent:** 100.00 AUD per month, **per unit** (each unit is one agent) → `STRIPE_PRICE_ID`
   - **Agency 10:** 500.00 AUD per month, flat → `STRIPE_PRICE_AGENCY_10`
   - **Agency 20:** 1000.00 AUD per month, flat → `STRIPE_PRICE_AGENCY_20`
   - GST: decide with your accountant whether these prices include GST (and set `gst` in `web/config.js` to match). If you're registered, turn on Stripe Tax or mark the prices tax-inclusive, and add your ABN under *Settings → Business → Tax details*, so invoices show it.
2. **Settings → Billing → Customer portal:** allow customers to update their payment method, view invoices, **change quantity** and cancel (cancel at the end of the billing period). Plan changes happen inside the app, so switching products in the portal can stay off.
3. **Developers → API keys:** copy the **secret key** (`sk_test_…` for now).

## 3. Server functions

With the [Supabase CLI](https://supabase.com/docs/guides/cli) installed and linked to your project:

```
supabase functions deploy create-checkout
supabase functions deploy change-plan
supabase functions deploy set-seats
supabase functions deploy billing-portal
supabase functions deploy delete-account
supabase functions deploy purge-receipts
supabase functions deploy stripe-webhook --no-verify-jwt

supabase secrets set STRIPE_SECRET_KEY=sk_test_... SITE_URL=https://micrm.com.au \
  STRIPE_PRICE_ID=price_... STRIPE_PRICE_AGENCY_10=price_... STRIPE_PRICE_AGENCY_20=price_...
```

Then in Stripe, go to **Developers → Webhooks → Add endpoint**:
- URL: `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed` and all `customer.subscription.*` events (created, updated, deleted, paused, resumed).
- Copy the signing secret, then run `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`

## 4. The website

1. Edit `web/config.js`: `supabaseUrl`, `supabaseAnonKey`, `supportEmail`, and the `legal` section. The terms of service and privacy policy fill in your business name, ABN, address, privacy contact email, state, GST wording and start date from there.
2. Deploy the `web/` folder to Netlify or Cloudflare Pages. Your address shows the front page (`index.html`); its buttons lead to the app (`app.html`). The front page's screenshots are in `web/img/`, taken from the demo with made-up names. With Netlify you can drag and drop the folder, then connect your domain. HTTPS is required for installing it as a phone app.

## 5. Upload the CRM

```
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
  python3 tools/publish_app.py index.html "First release"
```

Do the same whenever you change the CRM. Everyone gets the new version the next time they open the app, and your note appears under *Help → What's new*. To regenerate `index.html` from a newer personal copy, run `python3 tools/make_blank_crm.py your_file.html index.html` first.

## 6. Try it (test mode)

1. Open the site, create an account and open the confirmation email's link in the same browser.
2. Add a contact, then sign in on your phone and check the contact is there. On your phone, use *Add to Home Screen*.
3. **Team:** invite a second email address, open the link in another browser and sign up. The dashboard should show both people.
4. **Billing → Subscribe:** pay with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC). The top bar should change to *Subscribed*.
5. Open **Manage billing**, cancel, and check the app shows when access ends.

6. **Agency plan:** under **Billing**, click *Try Agency 10*. Sign in as the invited agent in another browser: you should both see and edit the same contacts. When one of you adds a contact, the other gets a *"contacts were updated by your team"* note.

When everything works, switch Stripe to live mode: create the product, the three prices and the webhook again in live mode, and set `STRIPE_SECRET_KEY`, the three price IDs and `STRIPE_WEBHOOK_SECRET` to the live values.

## 7. Deleting data after accounts end

The privacy policy promises that data is deleted 90 days after a team's trial or subscription ends. Turn on the daily clean-up once: in Supabase, go to *Database → Extensions*, enable **pg_cron**, then run this in the SQL Editor:

```
select cron.schedule('purge-expired-crm-data', '30 3 * * *', 'select public.purge_expired_data(90)');
```

Receipts are files, which only the Storage API can delete, so a second job calls the `purge-receipts` function each night. Also enable **pg_net** under *Database → Extensions*, then run this once, with your project address and *service_role* key from *Project Settings → API*. The key goes into Supabase's Vault, not into the job itself:

```
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<service_role key>', 'service_role_key');
select cron.schedule('purge-expired-receipts', '45 3 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/purge-receipts',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{"days": 90}'::jsonb)
$$);
```

If someone asks for their account to be deleted, the simplest way is for them to use *Delete my account* in the app, which removes everything including their receipts. If you delete them yourself in *Authentication → Users*, their CRM data goes with them, but also delete their folder (named after their user id) in *Storage → receipts*.

## Running the service

- **Support messages** from the app's Help page are in Supabase → *Table editor → support_requests*. Reply by email, then set `status` to `answered`. To get an email for each new message, add a Database Webhook on that table.
- **Customers and payments** are in Stripe. The trial and subscription state of each team is in the `teams` table.
- **Giving someone free access** (e.g. a pilot agency): in the `teams` table, set `trial_ends_at` to a later date.
- **Costs to run:** check each provider's current pricing. Supabase's free plan pauses inactive projects, so use the Pro plan once you have paying customers. Netlify and Cloudflare Pages are free at this size, and Stripe takes a fee on each card payment.

## Before you launch

- **Terms of service and privacy policy:** drafts are in `web/terms.html` and `web/privacy.html`, written for Australian law (Privacy Act and APPs, Spam Act, Do Not Call Register, Australian Consumer Law, Notifiable Data Breaches). Fill in the `legal` details in `web/config.js`, and **have a lawyer review both before launch**. Check that the service providers listed in the privacy policy match the ones you actually use (e.g. your email sender and website host).
- An ABN on invoices, and a decision on GST (see step 2). Set `legal.gst` in `web/config.js` to `include GST`, `plus GST` or `no GST`; the front page always shows each price as the total a customer pays, as the Australian Consumer Law requires. Your ABN shows in the front page footer once `legal.abn` is filled in.
- **Website wording and the law:** the front page (`web/index.html`) was written with the Australian Consumer Law (no misleading claims, single total prices, clear subscription terms), the Privacy Act, the Spam Act, the Do Not Call Register and telemarketing calling hours, and WA's real estate agent laws in mind. Its "rules you prospect under" section is general information for agents. Before launch, have your lawyer check it with the terms and privacy policy, and re-check it whenever you change prices, providers or features. Don't add testimonials or claims you can't back up.
- **Automated decisions (from 10 December 2026):** the Privacy Act will require privacy policies to explain computer-made decisions that significantly affect people. MICRM's buyer scores are suggestions shown only to the agent; the privacy policy says so. Ask your lawyer whether anything more is needed.
- A support email address you check.
- **Map services:** the Map view uses OpenStreetMap's free map tiles and address finder (Nominatim). Their rules allow light use: each address is looked up once, at most one a second, and saved. That is fine for a pilot. Before advertising widely, move to a paid map provider (for example MapTiler, Stadia Maps or Geoscape) and update the provider list in the privacy policy. The addresses are set at the top of `tools/addons/map.js`; if the address finder changes, also change `GEOCODER` in `tools/add_addons.py` so the page is allowed to reach it.

## How access works

- Every account is part of a team. A solo agent is a team of one, and they are its **owner**.
- **Owner:** billing, plan, seats, roles and invites. **Admin:** invites agents and sees the team dashboard. **Agent:** the CRM.
- **Per agent plan:** each agent's contacts are private to them. The team dashboard shows counts only (contacts, hot leads, appraisals, listings, sales, calls and texts this week), never client names or details.
- **Agency plans:** the contact list and each contact's activity (calls, texts, notes) are shared by everyone in the team. Each contact is saved separately, so two agents working at the same time don't overwrite each other. If both edit the *same* contact at once, the later save wins. Every call, text and note records who made it, and the dashboard shows each agent's contacts added and activity. Diary, appointments, templates, expenses, logbook and buyers stay personal.
- **Moving to an agency plan:** each person's earlier contacts stay private. The Team page offers to add them to the shared list. **Moving back to Per agent:** everyone returns to their own contacts, and the shared list is kept in case you return.
- **Limits:** Agency 10 allows up to 10 people and Agency 20 up to 20, counting pending invites. A trial team can have up to 20 people.
- **Invites:** the invite link joins the team. Someone who signs up with an invited email but without the link sees "… invited you to join …" with a **Join** button: nobody is added to a team without saying yes. Joining checks the team still has room (its plan limit, or its paid seats).
- Use the CRM in one browser tab at a time. Two tabs on the same device share one local copy. Signing out in one tab closes the account in every tab, and a tab left open never sends anything once another account is signed in on the device.
- **Email links** (confirm email, reset password) sign in only in the browser where they were asked for. Opened anywhere else, the app just asks the person to sign in (or to ask for a new reset link), so a link made by someone else can't sign a person into the wrong account.
- **Removed agents** lose the agency's shared list on their screen straight away, and it is never copied into their own account.
- **Payments:** a team can't start a second subscription while one is running or awaiting a card check, and starting checkout closes any older checkout page. A late Stripe event about an old subscription never overwrites the one that is running.
- On agency plans, the database credits each new call, text or note to whoever saved it, so nobody can log activity in a teammate's name.
- The trial is 14 days from when a person signs up. Leaving and re-joining teams doesn't restart it.
- A team has access while it's in trial, or while it's paying for at least as many seats as it has people. When a card fails (`past_due`), access continues while Stripe retries. After a subscription ends, people can still sign in to download their data, but can't use the CRM.
- **Deleting an account:** anyone can delete their own account from the account menu (type DELETE to confirm). Their login, their own CRM data, dashboard figures and support messages are deleted at once. A paying owner on their own has the subscription cancelled in Stripe first; an owner with other people must hand over or remove them first. Contacts added to an agency's shared list stay with the agency. Apple requires this for App Store apps.
- Data of accounts that ended, and of people who are no longer in any team, is deleted by `purge_expired_data` after the retention period (see step 7).
- These rules are enforced by the database itself (row-level security), not just the website. `supabase/tests/permissions_test.sh` checks them.

## Testing

On a machine with PostgreSQL 16 and Node:

```
# the database rules (96 checks)
PGHOST=localhost PGUSER=postgres supabase/tests/permissions_test.sh

# the whole app in a browser against a local stand-in for Supabase and Stripe (73 + 38 checks)
cd tests && npm install && cd ..
PGDATABASE=crm_e2e tests/setup_e2e_db.sh
PGDATABASE=crm_e2e node tests/mock_supabase.js 8787 & MOCK=$!
PGDATABASE=crm_e2e node tests/e2e_hosted.js http://localhost:8787
kill $MOCK; PGDATABASE=crm_e2e tests/setup_e2e_db.sh     # a fresh database for the next test
PGDATABASE=crm_e2e node tests/mock_supabase.js 8787 & MOCK=$!
PGDATABASE=crm_e2e node tests/e2e_agency.js http://localhost:8787
kill $MOCK

# the clickable demo: a new user's whole journey (37 checks), every CRM feature opened (37),
# and the Map view and Vendor Reports (43; the map's address finder and tiles are stand-ins, so it runs offline)
python3 tools/make_demo.py
# serve demo/build over http, wrapping page.html in <html><body>…</body></html> as _local.html, then:
node tests/e2e_demo.js http://localhost:8797/_local.html          # add "" phone for a phone-sized screen
node tests/e2e_features.js http://localhost:8797/_local.html
node tests/e2e_addons.js http://localhost:8797/_local.html        # add phone for a phone-sized screen
node tests/e2e_iphone_width.js http://localhost:8797/_local.html 375   # nothing wider than an iPhone (45 checks; also try 320 and 390)
node tests/e2e_buyers.js http://localhost:8797/_local.html         # Buyers, Call Runner details, receipts, colours (38 checks); add phone
```

The first browser test covers sign-up, the trial, syncing between a computer and a phone, inviting an agent, keeping agents' data private, the dashboard, roles, subscribing, the Help form, what happens when a subscription ends, sign-out, email links opened in the wrong browser, and the CRM not writing for a signed-out account. The agency test covers trying Agency 10, sharing earlier contacts, an agent seeing and adding to the shared list, two people adding at the same moment, an out-of-date screen not deleting a teammate's work, renaming, the shared dashboard, subscribing, switching back to Per agent, signing out with a second tab open, another person signing in on the same browser, and a removed agent losing the shared list.
