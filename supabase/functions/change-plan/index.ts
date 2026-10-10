// Switch a paying team between per-user, Agency 10 and Agency 20.
// Stripe charges or credits the difference for the rest of the month.
import {
  admin, handle, HttpError, isPlan, json, ownerFrom, PAID, PLAN_LIMIT, PRICES, quantityFor, seatsFor, stripe,
} from "../_shared/common.ts";

handle("change-plan", async (req) => {
  const { plan } = await req.json().catch(() => ({}));
  if (!isPlan(plan)) throw new HttpError(400, "Unknown plan.");
  if (!PRICES[plan]) throw new HttpError(500, "That plan is not set up yet.");
  const { team, members } = await ownerFrom(req);
  if (!team.stripe_subscription_id || !PAID.includes(team.subscription_status ?? "")) {
    throw new HttpError(409, "Subscribe first; you can pick the plan at checkout.");
  }
  if (plan === team.plan) return json({ plan });
  const limit = PLAN_LIMIT[plan];
  if (limit && members > limit) {
    throw new HttpError(409, `Your team has ${members} people; that plan covers up to ${limit}. Remove people first.`);
  }
  const sub = await stripe.subscriptions.retrieve(team.stripe_subscription_id);
  const item = sub.items.data[0];
  const quantity = quantityFor(plan, members);
  await stripe.subscriptions.update(sub.id, {
    items: [{ id: item.id, price: PRICES[plan], quantity }],
    metadata: { ...sub.metadata, team_id: team.id, plan },
    proration_behavior: "create_prorations",
  });
  // the webhook records this too; saving now makes the change show straight away
  const { error } = await admin.from("teams").update({ plan, seats: seatsFor(plan, quantity) }).eq("id", team.id);
  if (error) throw error;
  return json({ plan });
});
