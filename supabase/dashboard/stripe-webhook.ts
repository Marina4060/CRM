// MICRM function "stripe-webhook", packaged as one file for pasting into Supabase → Edge Functions.
// Built from supabase/functions/stripe-webhook by tools/bundle_functions.sh; edit the source there, not this file.

// supabase/functions/stripe-webhook/index.ts
import Stripe2 from "npm:stripe@17.7.0";

// supabase/functions/_shared/common.ts
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
var stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")?.trim() || "sk_missing", {
  httpClient: Stripe.createFetchHttpClient()
});
function secretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
  try {
    const keys = JSON.parse(raw);
    if (typeof keys === "string") return keys;
    return String(keys?.default ?? Object.values(keys ?? {})[0] ?? "");
  } catch {
    return raw;
  }
}
var SERVICE_KEY = secretKey();
var admin = createClient(
  Deno.env.get("SUPABASE_URL") || "http://localhost",
  SERVICE_KEY || "missing",
  { auth: { persistSession: false } }
);
var SITE_URL = (Deno.env.get("SITE_URL") ?? "").trim().replace(/\/+$/, "");
var PRICES = {
  per_user: Deno.env.get("STRIPE_PRICE_ID") ?? "",
  // $100 AUD per person per month
  agency_10: Deno.env.get("STRIPE_PRICE_AGENCY_10") ?? "",
  // $500 AUD per month, up to 10 people
  agency_20: Deno.env.get("STRIPE_PRICE_AGENCY_20") ?? ""
  // $1000 AUD per month, up to 20 people
};
var PLAN_LIMIT = { per_user: null, agency_10: 10, agency_20: 20 };
function planForPrice(priceId) {
  for (const p of Object.keys(PRICES)) if (PRICES[p] && PRICES[p] === priceId) return p;
  return null;
}
var seatsFor = (plan, quantity) => PLAN_LIMIT[plan] ?? quantity;
var PAID = ["active", "trialing", "past_due"];

// supabase/functions/stripe-webhook/index.ts
var SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
var crypto = Stripe2.createSubtleCryptoProvider();
async function saveSubscription(sub) {
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const teamId = sub.metadata?.team_id;
  const item = sub.items?.data?.[0];
  const periodEnd = sub.current_period_end ?? item?.current_period_end;
  const plan = planForPrice(item?.price?.id);
  if (!plan) console.warn("stripe-webhook: unknown price", item?.price?.id);
  const row = {
    stripe_customer_id: customer,
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    ...plan ? { plan } : {},
    seats: sub.status === "canceled" || !plan ? 0 : seatsFor(plan, item?.quantity ?? 0),
    current_period_end: periodEnd ? new Date(periodEnd * 1e3).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end
  };
  let find = admin.from("teams").select("id, stripe_subscription_id, subscription_status");
  find = teamId ? find.eq("id", teamId) : find.eq("stripe_customer_id", customer);
  const { data: teams, error: findError } = await find;
  if (findError) throw findError;
  if (!teams?.length) return console.warn("stripe-webhook: no team for", customer, teamId);
  for (const team of teams) {
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
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      req.headers.get("Stripe-Signature") ?? "",
      SECRET,
      void 0,
      crypto
    );
  } catch (e) {
    console.error("stripe-webhook: bad signature", e);
    return new Response("Bad signature", { status: 400 });
  }
  try {
    let subId = null;
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      if (s.mode === "subscription" && s.subscription) {
        subId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      subId = event.data.object.id;
    }
    if (subId) await saveSubscription(await stripe.subscriptions.retrieve(subId));
    return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("stripe-webhook", event.type, e);
    return new Response("Error", { status: 500 });
  }
});
