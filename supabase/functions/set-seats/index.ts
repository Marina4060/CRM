// Change how many paid seats the team has (e.g. to invite another agent).
// Stripe charges or credits the difference for the rest of the month.
import { admin, handle, HttpError, json, ownerFrom, PAID, stripe } from "../_shared/common.ts";

handle("set-seats", async (req) => {
  const { seats } = await req.json().catch(() => ({}));
  const want = Number(seats);
  if (!Number.isInteger(want) || want < 1 || want > 200) throw new HttpError(400, "Please choose between 1 and 200 seats.");
  const { team, members } = await ownerFrom(req);
  if (!team.stripe_subscription_id || !PAID.includes(team.subscription_status ?? "")) {
    throw new HttpError(409, "Subscribe first; you can choose the number of seats at checkout.");
  }
  if (want < members) {
    throw new HttpError(409, `Your team has ${members} people. Remove someone before going below ${members} seats.`);
  }
  const sub = await stripe.subscriptions.retrieve(team.stripe_subscription_id);
  const item = sub.items.data[0];
  const updated = await stripe.subscriptions.update(sub.id, {
    items: [{ id: item.id, quantity: want }],
    proration_behavior: "create_prorations",
  });
  // the webhook will record this too; saving now makes the change show straight away
  const { error } = await admin.from("teams").update({ seats: updated.items.data[0].quantity ?? want }).eq("id", team.id);
  if (error) throw error;
  return json({ seats: want });
});
