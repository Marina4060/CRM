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
var SITE_URL = ((u) => u && !/^https?:\/\//i.test(u) ? "https://" + u : u)(env("SITE_URL").replace(/\s+/g, "").replace(/[./]+$/, ""));
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
async function select(table, query, cols = "*") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(cols)}&${query}`, { headers: serverHeaders() });
  if (!r.ok) throw new Oops(500, "Database: " + (await r.text()));
  return await r.json();
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const ur = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + token } });
    const user = await ur.json().catch(() => null);
    if (!token || !ur.ok || !user?.id) throw new Oops(401, "Please sign in again.");
    const [m] = await select("team_members", `user_id=eq.${user.id}`, "team_id,role");
    if (!m) throw new Oops(409, "Please reload the page and try again.");
    if (m.role !== "owner") throw new Oops(403, "Only the team owner can manage billing.");
    const [team] = await select("teams", `id=eq.${m.team_id}`);
    if (!team?.stripe_customer_id) throw new Oops(404, "Your team doesn't have a subscription yet.");
    const sr = await fetch(STRIPE_API + "/billing_portal/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + STRIPE_KEY, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ customer: team.stripe_customer_id, return_url: `${SITE_URL}/app.html#billing` })
    });
    const s = await sr.json().catch(() => ({}));
    if (!sr.ok) throw new Oops(502, "Stripe: " + (s?.error?.message ?? sr.status));
    return json({ url: s.url });
  } catch (e) {
    if (e instanceof Oops) return json({ error: e.message }, e.status);
    console.error("billing-portal", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
