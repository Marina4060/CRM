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
var STRIPE_API = "https://api.stripe.com/v1";
var PRICES = {
  per_user: env("STRIPE_PRICE_ID"),
  agency_10: env("STRIPE_PRICE_AGENCY_10"),
  agency_20: env("STRIPE_PRICE_AGENCY_20")
};
var PLAN_LIMIT = { per_user: null, agency_10: 10, agency_20: 20 };
function planForPrice(priceId) {
  for (const p of Object.keys(PRICES)) if (PRICES[p] && PRICES[p] === priceId) return p;
  return null;
}
var seatsFor = (plan, quantity) => PLAN_LIMIT[plan] ?? quantity;
var PAID = ["active", "trialing", "past_due"];
var SECRET = env("STRIPE_WEBHOOK_SECRET");

async function stripeGet(path) {
  const r = await fetch(STRIPE_API + path, {
    headers: { Authorization: "Bearer " + STRIPE_KEY, "Stripe-Version": STRIPE_VERSION }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Stripe: " + (j?.error?.message ?? r.status));
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
  const r = await fetch(SUPABASE_URL + path, {
    method,
    headers: serverHeaders(body === void 0 ? extra : { "Content-Type": "application/json", ...extra }),
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  if (!r.ok) throw new Error("Database: " + (await r.text()));
  return r;
}
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
  const q = teamId ? `id=eq.${teamId}` : `stripe_customer_id=eq.${encodeURIComponent(customer)}`;
  const teams = await (await supa("GET", `/rest/v1/teams?select=id,stripe_subscription_id,subscription_status&${q}`)).json();
  if (!teams?.length) return console.warn("stripe-webhook: no team for", customer, teamId);
  for (const team of teams) {
    const current = team.stripe_subscription_id;
    if (current && current !== sub.id && PAID.includes(team.subscription_status ?? "")) {
      if (PAID.includes(sub.status)) console.error("stripe-webhook: team", team.id, "has two live subscriptions:", current, "and", sub.id);
      continue;
    }
    const r = await supa("PATCH", `/rest/v1/teams?id=eq.${team.id}`, row, { Prefer: "return=minimal" });
    await r.body?.cancel();
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
      if (s.mode === "subscription" && s.subscription) subId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
    } else if (event.type.startsWith("customer.subscription.")) {
      subId = event.data.object.id;
    }
    if (subId) await saveSubscription(await stripeGet(`/subscriptions/${subId}`));
    return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("stripe-webhook", event.type, e);
    return new Response("Error", { status: 500 });
  }
});
