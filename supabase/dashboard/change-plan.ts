// MICRM function "change-plan", packaged as one file for pasting into Supabase → Edge Functions.
// Built from supabase/functions/change-plan by tools/bundle_functions.sh; edit the source there, not this file.

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
var seatsFor = (plan, quantity) => PLAN_LIMIT[plan] ?? quantity;
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

// supabase/functions/change-plan/index.ts
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
    proration_behavior: "create_prorations"
  });
  const { error } = await admin.from("teams").update({ plan, seats: seatsFor(plan, quantity) }).eq("id", team.id);
  if (error) throw error;
  return json({ plan });
});
