var env = (k) => (Deno.env.get(k) ?? "").trim();
var SUPABASE_URL = env("SUPABASE_URL").replace(/\/+$/, "");
function secretKey() {
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = env("SUPABASE_SECRET_KEYS");
  try {
    const keys = JSON.parse(raw);
    if (typeof keys === "string") return keys;
    return String(keys?.default ?? Object.values(keys ?? {})[0] ?? "");
  } catch {
    return raw;
  }
}
var SERVICE_KEY = secretKey();
var STRIPE_KEY = env("STRIPE_SECRET_KEY");
var PRICES = { per_user: env("STRIPE_PRICE_ID"), agency_10: env("STRIPE_PRICE_AGENCY_10"), agency_20: env("STRIPE_PRICE_AGENCY_20") };
var PLAN_LIMIT = { per_user: null, agency_10: 10, agency_20: 20 };
var STRIPE_API = (env("STRIPE_API_BASE") || "https://api.stripe.com") + "/v1";
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
class Oops extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function serverHeaders() {
  const h = { apikey: SERVICE_KEY };
  if (SERVICE_KEY.startsWith("eyJ")) h.Authorization = "Bearer " + SERVICE_KEY;
  return h;
}
async function count(table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&${query}`, {
    headers: { ...serverHeaders(), Prefer: "count=exact", "Range-Unit": "items", Range: "0-0" }
  });
  if (!r.ok) throw new Oops(500, "Database: " + (await r.text()));
  await r.body?.cancel();
  return Number((r.headers.get("Content-Range") ?? "").split("/")[1]) || 0;
}
async function select(table, query, cols = "*") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(cols)}&${query}`, { headers: serverHeaders() });
  if (!r.ok) throw new Oops(500, "Database: " + (await r.text()));
  return await r.json();
}
async function stripe(method, path, params) {
  const r = await fetch(STRIPE_API + path, {
    method,
    headers: { Authorization: "Bearer " + STRIPE_KEY, "Stripe-Version": "2025-02-24.acacia", ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: params ? new URLSearchParams(params) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Oops(502, "Stripe: " + (j?.error?.message ?? r.status));
  return j;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { plan } = await req.json().catch(() => ({}));
    if (typeof plan !== "string" || !Object.hasOwn(PLAN_LIMIT, plan)) throw new Oops(400, "Unknown plan.");
    if (!PRICES[plan]) throw new Oops(500, "That plan is not set up yet.");
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const ur = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + token } });
    const user = await ur.json().catch(() => null);
    if (!token || !ur.ok || !user?.id) throw new Oops(401, "Please sign in again.");
    const [m] = await select("team_members", `user_id=eq.${user.id}`, "team_id,role");
    if (!m) throw new Oops(409, "Please reload the page and try again.");
    if (m.role !== "owner") throw new Oops(403, "Only the team owner can manage billing.");
    const [team] = await select("teams", `id=eq.${m.team_id}`);
    if (!team) throw new Oops(409, "Please reload the page and try again.");
    const members = (await count("team_members", `team_id=eq.${team.id}`)) || 1;
    if (!team.stripe_subscription_id || !["active", "trialing", "past_due"].includes(team.subscription_status ?? "")) {
      throw new Oops(409, "Subscribe first; you can pick the plan at checkout.");
    }
    if (plan === team.plan) return json({ plan });
    const limit = PLAN_LIMIT[plan];
    if (limit && members > limit) throw new Oops(409, `Your team has ${members} people; that plan covers up to ${limit}. Remove people first.`);
    const sub = await stripe("GET", `/subscriptions/${team.stripe_subscription_id}`);
    const item = sub.items.data[0];
    const quantity = plan === "per_user" ? Math.max(1, members) : 1;
    const params = {
      "items[0][id]": item.id,
      "items[0][price]": PRICES[plan],
      "items[0][quantity]": String(quantity),
      proration_behavior: "create_prorations"
    };
    for (const [k, v] of Object.entries({ ...(sub.metadata ?? {}), team_id: team.id, plan })) params[`metadata[${k}]`] = String(v);
    await stripe("POST", `/subscriptions/${sub.id}`, params);
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/teams?id=eq.${team.id}`, {
      method: "PATCH",
      headers: { ...serverHeaders(), "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ plan, seats: PLAN_LIMIT[plan] ?? quantity })
    });
    await pr.body?.cancel();
    return json({ plan });
  } catch (e) {
    if (e instanceof Oops) return json({ error: e.message }, e.status);
    console.error("change-plan", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
