// MICRM function "delete-account", packaged as one file for pasting into Supabase → Edge Functions.
// Built from supabase/functions/delete-account by tools/bundle_functions.sh; edit the source there, not this file.

// supabase/functions/_shared/common.ts
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
var STRIPE_VERSION = "2025-02-24.acacia";
var STRIPE_API = (env("STRIPE_API_BASE") || "https://api.stripe.com") + "/v1";
var SITE_URL = ((u) => u && !/^https?:\/\//i.test(u) ? "https://" + u : u)(
  env("SITE_URL").replace(/\s+/g, "").replace(/[./]+$/, "")
);
var PRICES = {
  per_user: env("STRIPE_PRICE_ID"),
  // $399 AUD per person per month
  agency_10: env("STRIPE_PRICE_AGENCY_10"),
  // agency plans: not currently offered in the app
  agency_20: env("STRIPE_PRICE_AGENCY_20")
};
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
function handle(name, fn) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof StripeError) {
        console.error(name, "Stripe said:", e.status, e.code, e.message);
        return json({ error: "Stripe: " + e.message }, 502);
      }
      console.error(name, e);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  });
}
var StripeError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "StripeError";
  }
};
function formEncode(params) {
  const out = [];
  const add = (key, v) => {
    if (v === void 0 || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => add(`${key}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v)) add(`${key}[${k}]`, x);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  return out.join("&");
}
async function stripeApi(method, path, params = {}) {
  if (!STRIPE_KEY) throw new HttpError(500, "Payments are not set up yet.");
  const body = formEncode(params);
  const url = STRIPE_API + path + (method === "GET" && body ? "?" + body : "");
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: "Bearer " + STRIPE_KEY,
      "Stripe-Version": STRIPE_VERSION,
      ...method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}
    },
    body: method === "POST" ? body : void 0
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = j?.error ?? {};
    throw new StripeError(r.status, err.code, err.message ?? `Stripe request failed (${r.status})`);
  }
  return j;
}
function serverHeaders(extra = {}) {
  const h = { apikey: SERVICE_KEY, ...extra };
  if (SERVICE_KEY.startsWith("eyJ")) h.Authorization = "Bearer " + SERVICE_KEY;
  return h;
}
async function supa(method, path, body, extra = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new HttpError(500, "The server isn't set up yet.");
  const r = await fetch(SUPABASE_URL + path, {
    method,
    headers: serverHeaders(body === void 0 ? extra : { "Content-Type": "application/json", ...extra }),
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  if (!r.ok) {
    const t = await r.text();
    let m = t;
    try {
      const j = JSON.parse(t);
      m = j.message ?? j.msg ?? j.error_description ?? j.error ?? t;
    } catch {
    }
    throw new HttpError(r.status >= 500 ? 500 : 409, String(m || `Request failed (${r.status})`));
  }
  return r;
}
var db = {
  // e.g. db.select("teams", "id=eq.123", "*")
  async select(table, query, columns = "*") {
    const r = await supa("GET", `/rest/v1/${table}?select=${encodeURIComponent(columns)}${query ? "&" + query : ""}`);
    return await r.json();
  },
  async count(table, query) {
    const r = await supa(
      "GET",
      `/rest/v1/${table}?select=*${query ? "&" + query : ""}`,
      void 0,
      { Prefer: "count=exact", "Range-Unit": "items", Range: "0-0" }
    );
    await r.body?.cancel();
    const total = (r.headers.get("Content-Range") ?? "").split("/")[1];
    return Number(total) || 0;
  },
  async update(table, query, values) {
    const r = await supa("PATCH", `/rest/v1/${table}?${query}`, values, { Prefer: "return=minimal" });
    await r.body?.cancel();
  },
  async rpc(fn, args) {
    const r = await supa("POST", `/rest/v1/rpc/${fn}`, args);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
};
async function userFrom(req) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !SUPABASE_URL) throw new HttpError(401, "Please sign in again.");
  const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + token }
  });
  const u = await r.json().catch(() => null);
  if (!r.ok || !u?.id) throw new HttpError(401, "Please sign in again.");
  return { id: u.id, email: u.email };
}
async function removeReceipts(userId) {
  let removed = 0;
  for (; ; ) {
    const r = await supa("POST", "/storage/v1/object/list/receipts", { prefix: userId, limit: 1e3, offset: 0 });
    const files = await r.json();
    if (!files?.length) return removed;
    const d = await supa("DELETE", "/storage/v1/object/receipts", { prefixes: files.map((f) => `${userId}/${f.name}`) });
    await d.body?.cancel();
    removed += files.length;
  }
}

// supabase/functions/delete-account/index.ts
handle("delete-account", async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "DELETE") throw new HttpError(400, "Type DELETE to confirm.");
  const user = await userFrom(req);
  const check = await db.rpc("delete_account", { uid: user.id, dry_run: true });
  const sub = check?.cancel_subscription;
  if (sub) {
    try {
      await stripeApi("DELETE", `/subscriptions/${sub}`);
    } catch (e) {
      if (!(e instanceof StripeError) || e.code !== "resource_missing") throw e;
    }
  }
  await removeReceipts(user.id);
  await db.rpc("delete_account", { uid: user.id, dry_run: false });
  return json({ deleted: true });
});
