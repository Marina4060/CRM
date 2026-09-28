// Stripe tells us when a subscription starts, renews, changes seats, fails or
// ends. This is the only thing that records a team's subscription status.
import Stripe from "npm:stripe@17.7.0";
import { admin, PAID, planForPrice, seatsFor, stripe } from "../_shared/common.ts";

const SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const crypto = Stripe.createSubtleCryptoProvider();

async function saveSubscription(sub: Stripe.Subscription) {
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
  let find = admin.from("teams").select("id, stripe_subscription_id, subscription_status");
  find = teamId ? find.eq("id", teamId) : find.eq("stripe_customer_id", customer);
  const { data: teams, error: findError } = await find;
  if (findError) throw findError;
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
    const { error } = await admin.from("teams").update(row).eq("id", team.id);
    if (error) throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, req.headers.get("Stripe-Signature") ?? "", SECRET, undefined, crypto);
  } catch (e) {
    console.error("stripe-webhook: bad signature", e);
    return new Response("Bad signature", { status: 400 });
  }
  try {
    let subId: string | null = null;
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode === "subscription" && s.subscription) {
        subId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      subId = (event.data.object as Stripe.Subscription).id;
    }
    // always read the latest copy: events can arrive out of order
    if (subId) await saveSubscription(await stripe.subscriptions.retrieve(subId));
    return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("stripe-webhook", event.type, e);
    return new Response("Error", { status: 500 }); // Stripe retries later
  }
});
