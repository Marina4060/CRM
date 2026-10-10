# MICRM

**Online version with subscriptions:** see [DEPLOY.md](DEPLOY.md). It covers login and a 14-day free trial, then Stripe billing at $100 AUD per agent per month, or $500 / $1000 AUD per month for agencies of up to 10 / 20 people with a shared contact list. It also covers cloud sync between phone and computer, team roles and a team dashboard, in-app support, installing it on a phone, and draft terms of service and a privacy policy.

The rest of this page is about the single-file version.

A real estate prospecting CRM that runs as one web page in the browser, with nothing to install. It covers a funnel board of contacts by suburb and street, a map of contacts coloured by stage, weekly vendor reports for listings, the diary, calendar, call list, SMS and email templates, buyers, investors, expenses, logbook and BAS tracking.

## Using it

1. Download `index.html` and open it in Chrome, Edge or Safari. It works on a phone too.
2. On first open, fill in **My details**: name, agency, mobile and email. You can also add a website, office address, brand colour and logo. Every SMS, email and letter signs off with these details. Change them any time with **👤 My details**.
3. Add contacts with **+ Add Contact** or **RP Data Import**. Suburb tabs and street filters build themselves from your contacts.

Everything you enter is saved in **this browser on this device only**. Use **Backup** / **Export / Save** regularly, and use the backup to move to another device.

The **✦ Ask AI** assistant is optional. It asks for your own Anthropic API key, which is kept for the current session only.

## Making a new blank version

`index.html` is generated from a working copy of the CRM by a script that strips all personal data:

```
python3 tools/make_blank_crm.py path/to/your_CRM.html index.html
```

The script:

- empties every contact, buyer, diary entry, appointment, expense, income record, logbook entry, investor, listing and sale stored in the file, plus the saved screen snapshot
- replaces the owner's name, agency, phone, email, logo and brand colour with the **My details** profile
- renames the browser storage keys (`mi_…` → `crm_…`), so the blank app never picks up data the original saved in the same browser
- builds in the add-on features from `tools/addons/`: the **Map** view and **Vendor Reports**. To add them to an existing file on their own, run `python3 tools/add_addons.py index.html`

If a later version of the CRM has changed shape, the script stops with a message naming what it could not find, rather than producing a half-cleaned file. Never commit the personal source file: `.gitignore` excludes `MARINA_CRM_*.html`.
