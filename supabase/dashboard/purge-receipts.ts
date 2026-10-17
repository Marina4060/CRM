// MICRM function "purge-receipts", packaged as one file for pasting into Supabase → Edge Functions.
// Built from supabase/functions/purge-receipts by tools/bundle_functions.sh; edit the source there, not this file.

// supabase/functions/_shared/common.ts
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
var stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  httpClient: Stripe.createFetchHttpClient()
});
function secretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
  try {
    const keys = JSON.parse(raw);
    if (typeof keys === "string") return keys;
    return String(keys?.default ?? Object.values(keys ?? {})[0] ?? "");
  } catch {
    return raw;
  }
}
var SERVICE_KEY = secretKey();
var admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  SERVICE_KEY,
  { auth: { persistSession: false } }
);
var SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
var PRICES = {
  per_user: Deno.env.get("STRIPE_PRICE_ID") ?? "",
  // $100 AUD per person per month
  agency_10: Deno.env.get("STRIPE_PRICE_AGENCY_10") ?? "",
  // $500 AUD per month, up to 10 people
  agency_20: Deno.env.get("STRIPE_PRICE_AGENCY_20") ?? ""
  // $1000 AUD per month, up to 20 people
};
var cors = {
  "Access-Control-Allow-Origin": SITE_URL || "*",
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
async function removeReceipts(userId) {
  const bucket = admin.storage.from("receipts");
  let removed = 0;
  for (; ; ) {
    const { data, error } = await bucket.list(userId, { limit: 1e3 });
    if (error) throw error;
    if (!data || !data.length) return removed;
    const { error: e2 } = await bucket.remove(data.map((f) => `${userId}/${f.name}`));
    if (e2) throw e2;
    removed += data.length;
  }
}
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

// supabase/functions/purge-receipts/index.ts
handle("purge-receipts", async (req) => {
  const key = SERVICE_KEY;
  if (!key || (req.headers.get("Authorization") ?? "") !== `Bearer ${key}`) throw new HttpError(401, "Not allowed.");
  const body = await req.json().catch(() => ({}));
  const days = Number.isInteger(body.days) && body.days >= 30 ? body.days : 90;
  const { data, error } = await admin.rpc("receipt_owners_to_purge", { days });
  if (error) throw error;
  let people = 0, files = 0;
  for (const uid of data ?? []) {
    const n = await removeReceipts(uid);
    if (n) {
      people++;
      files += n;
    }
  }
  return json({ people, files });
});
