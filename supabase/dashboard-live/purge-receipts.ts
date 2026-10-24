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
    // called on a schedule with the secret key; nobody else can call it
    if (!SERVICE_KEY || (req.headers.get("Authorization") ?? "") !== `Bearer ${SERVICE_KEY}`) throw new Oops(401, "Not allowed.");
    const body = await req.json().catch(() => ({}));
    const days = Number.isInteger(body.days) && body.days >= 30 ? body.days : 90;
    const owners = await supa("POST", "/rest/v1/rpc/receipt_owners_to_purge", { days });
    let people = 0, files = 0;
    for (const uid of owners ?? []) {
      const n = await removeReceipts(uid);
      if (n) { people++; files += n; }
    }
    return json({ people, files });
  } catch (e) {
    if (e instanceof Oops) return json({ error: e.message }, e.status);
    console.error("purge-receipts", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
