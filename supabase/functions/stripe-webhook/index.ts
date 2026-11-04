// Stripe tells us when a subscription starts, renews, changes seats, fails or
// ends. This is the only thing that records a team's subscription status.
import { db, PAID, planForPrice, seatsFor, stripeApi, type StripeObject, verifyStripeSignature } from "../_shared/common.ts";

const SECRET = (Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "").trim();

async function saveSubscription(sub: StripeObject) {
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const teamId = sub.metadata?.team_id;
  const item = sub.items?.data?.[0];
  // the billing period moved onto the subscription item in newer API versions
  const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end ??
    (item as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  // which plan was bought comes from the price, never from anything the customer can edit
  const plan = planForPrice(item?.price?.id);
  if (!plan) console.warn("stripe-webhook: unknown price", item?.price?.id);
  const row = {
    stripe_customer_id: customer,
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    ...(plan ? { plan } : {}),
    seats: sub.status === "canceled" || !plan ? 0 : seatsFor(plan, item?.quantity ?? 0),
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
  };
  // which team: the one named when the checkout was made, otherwise by customer
  const teams = await db.select("teams",
    teamId ? `id=eq.${teamId}` : `stripe_customer_id=eq.${encodeURIComponent(customer)}`,
    "id,stripe_subscription_id,subscription_status");
  if (!teams?.length) return console.warn("stripe-webhook: no team for", customer, teamId);
  for (const team of teams) {
    // a late event about an older subscription must not overwrite the one that is running
    const current = team.stripe_subscription_id;
    if (current && current !== sub.id && PAID.includes(team.subscription_status ?? "")) {
      if (PAID.includes(sub.status)) {
        console.error("stripe-webhook: team", team.id, "has two live subscriptions:", current, "and", sub.id, "- cancel one in Stripe");
      }
      continue;
    }
    await db.update("teams", `id=eq.${team.id}`, row);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.text();
  if (!(await verifyStripeSignature(body, req.headers.get("Stripe-Signature") ?? "", SECRET))) {
    console.error("stripe-webhook: bad signature");
    return new Response("Bad signature", { status: 400 });
  }
  let event: StripeObject;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    let subId: string | null = null;
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      if (s.mode === "subscription" && s.subscription) {
        subId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      subId = event.data.object.id;
    }
    // always read the latest copy: events can arrive out of order
    if (subId) await saveSubscription(await stripeApi("GET", `/subscriptions/${subId}`));
    return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("stripe-webhook", event.type, e);
    return new Response("Error", { status: 500 }); // Stripe retries later
  }
});
