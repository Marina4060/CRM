// MICRM function "stripe-webhook", packaged as one file for pasting into Supabase → Edge Functions.
// Built from supabase/functions/stripe-webhook by tools/bundle_functions.sh; edit the source there, not this file.

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
var PLAN_LIMIT = { per_user: null, agency_10: 10, agency_20: 20 };
function planForPrice(priceId) {
  for (const p of Object.keys(PRICES)) if (PRICES[p] && PRICES[p] === priceId) return p;
  return null;
}
var seatsFor = (plan, quantity) => PLAN_LIMIT[plan] ?? quantity;
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
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
async function verifyStripeSignature(body, header, secret, toleranceSec = 300) {
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1e3 - Number(t)) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | c.charCodeAt(0) ^ hex.charCodeAt(i), 0) === 0);
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
var PAID = ["active", "trialing", "past_due"];

// supabase/functions/stripe-webhook/index.ts
var SECRET = (Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "").trim();
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
  const teams = await db.select(
    "teams",
    teamId ? `id=eq.${teamId}` : `stripe_customer_id=eq.${encodeURIComponent(customer)}`,
    "id,stripe_subscription_id,subscription_status"
  );
  if (!teams?.length) return console.warn("stripe-webhook: no team for", customer, teamId);
  for (const team of teams) {
    const current = team.stripe_subscription_id;
    if (current && current !== sub.id && PAID.includes(team.subscription_status ?? "")) {
      if (PAID.includes(sub.status)) {
        console.error("stripe-webhook: team", team.id, "has two live subscriptions:", current, "and", sub.id, "- cancel one in Stripe");
      }
      continue;
    }
    await db.update("teams", `id=eq.${team.id}`, row);
  }
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.text();
  if (!await verifyStripeSignature(body, req.headers.get("Stripe-Signature") ?? "", SECRET)) {
    console.error("stripe-webhook: bad signature");
    return new Response("Bad signature", { status: 400 });
  }
  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad request", { status: 400 });
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
    if (subId) await saveSubscription(await stripeApi("GET", `/subscriptions/${subId}`));
    return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("stripe-webhook", event.type, e);
    return new Response("Error", { status: 500 });
  }
});
