// Starts a Stripe Checkout for $100 AUD per user per month, one seat for
// each current team member. Subscribing during the free trial doesn't cost
// any trial days: Stripe waits until the trial ends before charging.
import { customerFor, handle, HttpError, json, ownerFrom, PAID, PRICE_ID, SITE_URL, stripe } from "../_shared/common.ts";

// Stripe needs a trial end at least 48 hours away
const MIN_TRIAL_MS = 49 * 3600 * 1000;

handle("create-checkout", async (req) => {
  if (!PRICE_ID || !SITE_URL) throw new HttpError(500, "Payments are not set up yet.");
  const { user, team, members, openInvites } = await ownerFrom(req);
  if (PAID.includes(team.subscription_status ?? "")) {
    throw new HttpError(409, "Your team already has a subscription. Use Manage billing to change it.");
  }
  const customer = await customerFor(team, user);
  const trialEnd = new Date(team.trial_ends_at).getTime();
  const keepTrial = trialEnd - Date.now() > MIN_TRIAL_MS;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: team.id,
    line_items: [{
      price: PRICE_ID,
      quantity: Math.max(1, members + openInvites),
      adjustable_quantity: { enabled: true, minimum: Math.max(1, members), maximum: 200 },
    }],
    subscription_data: {
      metadata: { team_id: team.id },
      ...(keepTrial ? { trial_end: Math.floor(trialEnd / 1000) } : {}),
    },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    tax_id_collection: { enabled: true },
    customer_update: { name: "auto", address: "auto" },
    success_url: `${SITE_URL}/?checkout=success#billing`,
    cancel_url: `${SITE_URL}/?checkout=cancelled#billing`,
  });
  return json({ url: session.url });
});
