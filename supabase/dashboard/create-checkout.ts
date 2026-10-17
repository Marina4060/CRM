// MICRM function "create-checkout", packaged as one file for pasting into Supabase → Edge Functions.
// Built from supabase/functions/create-checkout by tools/bundle_functions.sh; edit the source there, not this file.

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
var SITE_URL = env("SITE_URL").replace(/\/+$/, "");
var PRICES = {
  per_user: env("STRIPE_PRICE_ID"),
  // $100 AUD per person per month
  agency_10: env("STRIPE_PRICE_AGENCY_10"),
  // $500 AUD per month, up to 10 people
  agency_20: env("STRIPE_PRICE_AGENCY_20")
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
var StripeError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
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
var PAID = ["active", "trialing", "past_due"];
async function ownerFrom(req) {
  const user = await userFrom(req);
  const [m] = await db.select("team_members", `user_id=eq.${user.id}`, "team_id,role");
  if (!m) throw new HttpError(409, "Please reload the page and try again.");
  if (m.role !== "owner") throw new HttpError(403, "Only the team owner can manage billing.");
  const [team] = await db.select("teams", `id=eq.${m.team_id}`);
  if (!team) throw new HttpError(409, "Please reload the page and try again.");
  const members = await db.count("team_members", `team_id=eq.${team.id}`);
  const openInvites = await db.count(
    "invites",
    `team_id=eq.${team.id}&accepted_at=is.null&expires_at=gt.${encodeURIComponent((/* @__PURE__ */ new Date()).toISOString())}`
  );
  return { user, team, members: members || 1, openInvites };
}
async function customerFor(team, user) {
  if (team.stripe_customer_id) return team.stripe_customer_id;
  const c = await stripeApi("POST", "/customers", {
    email: user.email,
    name: team.name,
    metadata: { team_id: team.id, owner_user_id: user.id }
  });
  await db.update("teams", `id=eq.${team.id}`, { stripe_customer_id: c.id });
  return c.id;
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
  const existing = await stripeApi("GET", "/subscriptions", { customer, status: "all", limit: 20 });
  const live = existing.data.find((s) => PAID.includes(s.status) || s.status === "incomplete");
  if (live) {
    throw new HttpError(409, live.status === "incomplete" ? "A payment for your subscription is still being confirmed. Try again in a few minutes, or use Manage billing." : "Your team already has a subscription. Use Change plan or Manage billing.");
  }
  const open = await stripeApi("GET", "/checkout/sessions", { customer, status: "open", limit: 20 });
  for (const s of open.data) {
    await stripeApi("POST", `/checkout/sessions/${s.id}/expire`).catch(() => {
    });
  }
  const trialEnd = new Date(team.trial_ends_at).getTime();
  const keepTrial = trialEnd - Date.now() > MIN_TRIAL_MS;
  const session = await stripeApi("POST", "/checkout/sessions", {
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
