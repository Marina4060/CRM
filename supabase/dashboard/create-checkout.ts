// MICRM function "create-checkout", packaged as one file for pasting into Supabase → Edge Functions.
// Built from supabase/functions/create-checkout by tools/bundle_functions.sh; edit the source there, not this file.

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
var isPlan = (p) => p === "per_user" || p === "agency_10" || p === "agency_20";
var quantityFor = (plan, people) => plan === "per_user" ? Math.max(1, people) : 1;
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
var PAID = ["active", "trialing", "past_due"];
async function userFrom(req) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in again.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Please sign in again.");
  return data.user;
}
async function ownerFrom(req) {
  const user = await userFrom(req);
  const { data: m, error } = await admin.from("team_members").select("team_id, role").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!m) throw new HttpError(409, "Please reload the page and try again.");
  if (m.role !== "owner") throw new HttpError(403, "Only the team owner can manage billing.");
  const { data: team, error: e2 } = await admin.from("teams").select("*").eq("id", m.team_id).single();
  if (e2) throw e2;
  const { count: members } = await admin.from("team_members").select("user_id", { count: "exact", head: true }).eq("team_id", team.id);
  const { count: openInvites } = await admin.from("invites").select("id", { count: "exact", head: true }).eq("team_id", team.id).is("accepted_at", null).gt("expires_at", (/* @__PURE__ */ new Date()).toISOString());
  return { user, team, members: members ?? 1, openInvites: openInvites ?? 0 };
}
async function customerFor(team, user) {
  if (team.stripe_customer_id) return team.stripe_customer_id;
  const c = await stripe.customers.create({
    email: user.email,
    name: team.name,
    metadata: { team_id: team.id, owner_user_id: user.id }
  });
  const { error } = await admin.from("teams").update({ stripe_customer_id: c.id }).eq("id", team.id);
  if (error) throw error;
  return c.id;
}
function handle(name, fn) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(name, e);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  });
}

// supabase/functions/create-checkout/index.ts
var MIN_TRIAL_MS = 49 * 3600 * 1e3;
handle("create-checkout", async (req) => {
  const body = await req.json().catch(() => ({}));
  const { user, team, members, openInvites } = await ownerFrom(req);
  const plan = isPlan(body.plan) ? body.plan : isPlan(team.plan) ? team.plan : "per_user";
  if (!PRICES[plan] || !SITE_URL) throw new HttpError(500, "Payments are not set up yet.");
  if (PAID.includes(team.subscription_status ?? "")) {
    throw new HttpError(409, "Your team already has a subscription. Use Change plan or Manage billing.");
  }
  const limit = PLAN_LIMIT[plan];
  if (limit && members > limit) {
    throw new HttpError(409, `Your team has ${members} people; that plan covers up to ${limit}.`);
  }
  const customer = await customerFor(team, user);
  const existing = await stripe.subscriptions.list({ customer, status: "all", limit: 20 });
  const live = existing.data.find((s) => PAID.includes(s.status) || s.status === "incomplete");
  if (live) {
    throw new HttpError(409, live.status === "incomplete" ? "A payment for your subscription is still being confirmed. Try again in a few minutes, or use Manage billing." : "Your team already has a subscription. Use Change plan or Manage billing.");
  }
  for await (const open of stripe.checkout.sessions.list({ customer, status: "open", limit: 20 })) {
    await stripe.checkout.sessions.expire(open.id).catch(() => {
    });
  }
  const trialEnd = new Date(team.trial_ends_at).getTime();
  const keepTrial = trialEnd - Date.now() > MIN_TRIAL_MS;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: team.id,
    line_items: [plan === "per_user" ? {
      price: PRICES[plan],
      quantity: quantityFor(plan, members + openInvites),
      adjustable_quantity: { enabled: true, minimum: Math.max(1, members), maximum: 200 }
    } : { price: PRICES[plan], quantity: 1 }],
    subscription_data: {
      metadata: { team_id: team.id, plan },
      ...keepTrial ? { trial_end: Math.floor(trialEnd / 1e3) } : {}
    },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    tax_id_collection: { enabled: true },
    customer_update: { name: "auto", address: "auto" },
    success_url: `${SITE_URL}/app.html?checkout=success#billing`,
    cancel_url: `${SITE_URL}/app.html?checkout=cancelled#billing`
  });
  return json({ url: session.url });
});
