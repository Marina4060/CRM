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
    const { seats } = await req.json().catch(() => ({}));
    const want = Number(seats);
    if (!Number.isInteger(want) || want < 1 || want > 200) throw new Oops(400, "Please choose between 1 and 200 seats.");
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
      throw new Oops(409, "Subscribe first; you can choose the number of seats at checkout.");
    }
    if (team.plan !== "per_user") throw new Oops(409, "Agency plans cover a set number of people. Use Change plan to move between them.");
    if (want < members) throw new Oops(409, `Your team has ${members} people. Remove someone before going below ${members} seats.`);
    const sub = await stripe("GET", `/subscriptions/${team.stripe_subscription_id}`);
    const item = sub.items.data[0];
    const updated = await stripe("POST", `/subscriptions/${sub.id}`, {
      "items[0][id]": item.id,
      "items[0][quantity]": String(want),
      proration_behavior: "create_prorations"
    });
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/teams?id=eq.${team.id}`, {
      method: "PATCH",
      headers: { ...serverHeaders(), "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ seats: updated.items?.data?.[0]?.quantity ?? want })
    });
    await pr.body?.cancel();
    return json({ seats: want });
  } catch (e) {
    if (e instanceof Oops) return json({ error: e.message }, e.status);
    console.error("set-seats", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
