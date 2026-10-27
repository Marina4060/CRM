// Shared helpers for the server functions.
// No outside libraries: Stripe and Supabase are called over plain HTTPS, so
// nothing has to be downloaded or bundled when a function starts. (With the
// Stripe and Supabase npm packages, functions deployed from the Supabase
// website could hang without answering.)

const env = (k: string) => (Deno.env.get(k) ?? "").trim();

// ─────────────── settings ───────────────
export const SUPABASE_URL = env("SUPABASE_URL").replace(/\/+$/, "");
// the project's server key: the legacy service_role key, or on projects that
// only have Supabase's newer keys, the first of its secret keys
function secretKey(): string {
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
export const SERVICE_KEY = secretKey();
// every server key the project has (legacy service_role and any new secret keys)
export function serverKeys(): string[] {
  const out = [env("SUPABASE_SERVICE_ROLE_KEY")];
  const raw = env("SUPABASE_SECRET_KEYS");
  try {
    const keys = JSON.parse(raw);
    if (typeof keys === "string") out.push(keys); else out.push(...Object.values(keys ?? {}).map(String));
  } catch {
    out.push(raw);
  }
  return out.filter(Boolean);
}
const STRIPE_KEY = env("STRIPE_SECRET_KEY");
// the API version the code is written for (where Stripe puts the billing period, etc.)
const STRIPE_VERSION = "2025-02-24.acacia";
// overridable only so tests can point it at a stand-in
const STRIPE_API = (env("STRIPE_API_BASE") || "https://api.stripe.com") + "/v1";

// the site people use; Stripe sends them back here after paying
// (spaces dropped, https:// added if it was left off, no slash or full stop at the end:
// Stripe refuses a return address that isn't a full web address)
export const SITE_URL = ((u) => u && !/^https?:\/\//i.test(u) ? "https://" + u : u)(
  env("SITE_URL").replace(/\s+/g, "").replace(/[./]+$/, ""));
// the three prices, created in the Stripe dashboard
export type Plan = "per_user" | "agency_10" | "agency_20";
export const PRICES: Record<Plan, string> = {
  per_user: env("STRIPE_PRICE_ID"),          // $399 AUD per person per month
  agency_10: env("STRIPE_PRICE_AGENCY_10"),  // agency plans: not currently offered in the app
  agency_20: env("STRIPE_PRICE_AGENCY_20"),
};
export const PLAN_LIMIT: Record<Plan, number | null> = { per_user: null, agency_10: 10, agency_20: 20 };
export const isPlan = (p: unknown): p is Plan => p === "per_user" || p === "agency_10" || p === "agency_20";
export function planForPrice(priceId: string | undefined): Plan | null {
  for (const p of Object.keys(PRICES) as Plan[]) if (PRICES[p] && PRICES[p] === priceId) return p;
  return null;
}
// how many units to put on the subscription: one per person, or one flat agency plan
export const quantityFor = (plan: Plan, people: number) => plan === "per_user" ? Math.max(1, people) : 1;
// people the subscription covers
export const seatsFor = (plan: Plan, quantity: number) => PLAN_LIMIT[plan] ?? quantity;

// ─────────────── replies ───────────────
// Any site may call these functions: they act only for the signed-in user whose
// access token comes in the Authorization header (never a cookie), so the
// browser's origin check adds no protection.
export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// run a handler with CORS, method check and friendly errors
export function handle(name: string, fn: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      // Stripe's own wording says what to fix (a price, a key, an address)
      if (e instanceof StripeError) {
        console.error(name, "Stripe said:", e.status, e.code, e.message);
        return json({ error: "Stripe: " + e.message }, 502);
      }
      console.error(name, e);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  });
}

// ─────────────── Stripe ───────────────
export class StripeError extends Error {
  constructor(public status: number, public code: string | undefined, message: string) {
    super(message);
    this.name = "StripeError";
  }
}

// Stripe takes form fields: nested objects become a[b][c]=…, lists a[0]=…
function formEncode(params: Record<string, unknown>): string {
  const out: string[] = [];
  const add = (key: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => add(`${key}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) add(`${key}[${k}]`, x);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  return out.join("&");
}

// deno-lint-ignore no-explicit-any
export type StripeObject = Record<string, any>;

export async function stripeApi(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, unknown> = {}): Promise<StripeObject> {
  if (!STRIPE_KEY) throw new HttpError(500, "Payments are not set up yet.");
  const body = formEncode(params);
  const url = STRIPE_API + path + (method === "GET" && body ? "?" + body : "");
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: "Bearer " + STRIPE_KEY,
      "Stripe-Version": STRIPE_VERSION,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? body : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = j?.error ?? {};
    throw new StripeError(r.status, err.code, err.message ?? `Stripe request failed (${r.status})`);
  }
  return j;
}

// Stripe's webhook signature: an HMAC-SHA256 of "timestamp.body" with the
// endpoint's signing secret, sent as Stripe-Signature: t=…,v1=…
export async function verifyStripeSignature(body: string, header: string, secret: string, toleranceSec = 300): Promise<boolean> {
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  // compare without stopping at the first difference
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

// ─────────────── Supabase (database, sign-in, storage) ───────────────
// the server key bypasses row security; it is only ever used here, on the server
function serverHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { apikey: SERVICE_KEY, ...extra };
  // the legacy key is a JWT and goes in Authorization too; the newer sb_secret_
  // keys go in apikey only and Supabase works out the role from it
  if (SERVICE_KEY.startsWith("eyJ")) h.Authorization = "Bearer " + SERVICE_KEY;
  return h;
}

async function supa(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Response> {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new HttpError(500, "The server isn't set up yet.");
  const r = await fetch(SUPABASE_URL + path, {
    method,
    headers: serverHeaders(body === undefined ? extra : { "Content-Type": "application/json", ...extra }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    let m = t;
    try { const j = JSON.parse(t); m = j.message ?? j.msg ?? j.error_description ?? j.error ?? t; } catch { /* plain text */ }
    throw new HttpError(r.status >= 500 ? 500 : 409, String(m || `Request failed (${r.status})`));
  }
  return r;
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
export const db = {
  // e.g. db.select("teams", "id=eq.123", "*")
  async select(table: string, query: string, columns = "*"): Promise<Row[]> {
    const r = await supa("GET", `/rest/v1/${table}?select=${encodeURIComponent(columns)}${query ? "&" + query : ""}`);
    return await r.json();
  },
  async count(table: string, query: string): Promise<number> {
    const r = await supa("GET", `/rest/v1/${table}?select=*${query ? "&" + query : ""}`, undefined,
      { Prefer: "count=exact", "Range-Unit": "items", Range: "0-0" });
    await r.body?.cancel();
    const total = (r.headers.get("Content-Range") ?? "").split("/")[1];
    return Number(total) || 0;
  },
  async update(table: string, query: string, values: Row): Promise<void> {
    const r = await supa("PATCH", `/rest/v1/${table}?${query}`, values, { Prefer: "return=minimal" });
    await r.body?.cancel();
  },
  async rpc(fn: string, args: Row): Promise<unknown> {
    const r = await supa("POST", `/rest/v1/rpc/${fn}`, args);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  },
};

export type User = { id: string; email?: string };

// the signed-in user behind the request's access token
export async function userFrom(req: Request): Promise<User> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !SUPABASE_URL) throw new HttpError(401, "Please sign in again.");
  const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + token },
  });
  const u = await r.json().catch(() => null);
  if (!r.ok || !u?.id) throw new HttpError(401, "Please sign in again.");
  return { id: u.id, email: u.email };
}

export type Team = {
  id: string;
  name: string;
  trial_ends_at: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  seats: number;
  plan: Plan;
};

export const PAID = ["active", "trialing", "past_due"];

// the caller, who must own their team, plus the team and its member count
export async function ownerFrom(req: Request): Promise<{ user: User; team: Team; members: number; openInvites: number }> {
  const user = await userFrom(req);
  const [m] = await db.select("team_members", `user_id=eq.${user.id}`, "team_id,role");
  if (!m) throw new HttpError(409, "Please reload the page and try again.");
  if (m.role !== "owner") throw new HttpError(403, "Only the team owner can manage billing.");
  const [team] = await db.select("teams", `id=eq.${m.team_id}`) as Team[];
  if (!team) throw new HttpError(409, "Please reload the page and try again.");
  const members = await db.count("team_members", `team_id=eq.${team.id}`);
  const openInvites = await db.count("invites",
    `team_id=eq.${team.id}&accepted_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`);
  return { user, team, members: members || 1, openInvites };
}

// find or create the team's Stripe customer (the owner is the billing contact)
export async function customerFor(team: Team, user: User): Promise<string> {
  if (team.stripe_customer_id) return team.stripe_customer_id;
  const c = await stripeApi("POST", "/customers", {
    email: user.email,
    name: team.name,
    metadata: { team_id: team.id, owner_user_id: user.id },
  });
  await db.update("teams", `id=eq.${team.id}`, { stripe_customer_id: c.id });
  return c.id;
}

// delete every receipt in a person's folder of the receipts bucket
export async function removeReceipts(userId: string): Promise<number> {
  let removed = 0;
  for (;;) {
    const r = await supa("POST", "/storage/v1/object/list/receipts", { prefix: userId, limit: 1000, offset: 0 });
    const files = (await r.json()) as { name: string }[];
    if (!files?.length) return removed;
    const d = await supa("DELETE", "/storage/v1/object/receipts", { prefixes: files.map((f) => `${userId}/${f.name}`) });
    await d.body?.cancel();
    removed += files.length;
  }
}
