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
async function supa(method, path, body) {
  const r = await fetch(SUPABASE_URL + path, {
    method,
    headers: { ...serverHeaders(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text();
  if (!r.ok) {
    let m = t;
    try { const j = JSON.parse(t); m = j.message ?? j.msg ?? j.error ?? t; } catch {}
    throw new Oops(r.status >= 500 ? 500 : 409, String(m || "Request failed"));
  }
  return t ? JSON.parse(t) : null;
}
async function removeReceipts(userId) {
  let removed = 0;
  for (;;) {
    const files = await supa("POST", "/storage/v1/object/list/receipts", { prefix: userId, limit: 1000, offset: 0 });
    if (!files?.length) return removed;
    await supa("DELETE", "/storage/v1/object/receipts", { prefixes: files.map((f) => `${userId}/${f.name}`) });
    removed += files.length;
  }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    if (body.confirm !== "DELETE") throw new Oops(400, "Type DELETE to confirm.");
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const ur = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + token } });
    const user = await ur.json().catch(() => null);
    if (!token || !ur.ok || !user?.id) throw new Oops(401, "Please sign in again.");
    // checks only: refuses an owner who still has people in their team
    const check = await supa("POST", "/rest/v1/rpc/delete_account", { uid: user.id, dry_run: true });
    const sub = check?.cancel_subscription;
    if (sub) {
      const r = await fetch(`${STRIPE_API}/subscriptions/${sub}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + STRIPE_KEY, "Stripe-Version": "2025-02-24.acacia" }
      });
      const j = await r.json().catch(() => ({}));
      // already gone in Stripe is fine; anything else stops here, before any data is deleted
      if (!r.ok && j?.error?.code !== "resource_missing") throw new Oops(502, "Stripe: " + (j?.error?.message ?? r.status));
    }
    await removeReceipts(user.id);
    await supa("POST", "/rest/v1/rpc/delete_account", { uid: user.id, dry_run: false });
    return json({ deleted: true });
  } catch (e) {
    if (e instanceof Oops) return json({ error: e.message }, e.status);
    console.error("delete-account", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
