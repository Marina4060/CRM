// Starts a Stripe Checkout for one of the three plans:
//   per_user   $100 AUD per person per month (one unit per person)
//   agency_10  $500 AUD per month, up to 10 people, shared contact list
//   agency_20  $1000 AUD per month, up to 20 people, shared contact list
// Subscribing during the free trial doesn't cost any trial days: Stripe waits
// until the trial ends before charging.
import {
  customerFor, handle, HttpError, isPlan, json, ownerFrom, PAID, type Plan, PLAN_LIMIT, PRICES, quantityFor, SITE_URL, stripe,
} from "../_shared/common.ts";

// Stripe needs a trial end at least 48 hours away
const MIN_TRIAL_MS = 49 * 3600 * 1000;

handle("create-checkout", async (req) => {
  const body = await req.json().catch(() => ({}));
  const { user, team, members, openInvites } = await ownerFrom(req);
  const plan: Plan = isPlan(body.plan) ? body.plan : isPlan(team.plan) ? team.plan : "per_user";
  if (!PRICES[plan] || !SITE_URL) throw new HttpError(500, "Payments are not set up yet.");
  if (PAID.includes(team.subscription_status ?? "")) {
    throw new HttpError(409, "Your team already has a subscription. Use Change plan or Manage billing.");
  }
  const limit = PLAN_LIMIT[plan];
  if (limit && members > limit) {
    throw new HttpError(409, `Your team has ${members} people; that plan covers up to ${limit}.`);
  }
  const customer = await customerFor(team, user);
  const trialEnd = new Date(team.trial_ends_at).getTime();
  const keepTrial = trialEnd - Date.now() > MIN_TRIAL_MS;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: team.id,
    line_items: [plan === "per_user"
      ? {
        price: PRICES[plan],
        quantity: quantityFor(plan, members + openInvites),
        adjustable_quantity: { enabled: true, minimum: Math.max(1, members), maximum: 200 },
      }
      : { price: PRICES[plan], quantity: 1 }],
    subscription_data: {
      metadata: { team_id: team.id, plan },
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
