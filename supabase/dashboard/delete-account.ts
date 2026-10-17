// MICRM function "delete-account", packaged as one file for pasting into Supabase → Edge Functions.
// Built from supabase/functions/delete-account by tools/bundle_functions.sh; edit the source there, not this file.

// supabase/functions/_shared/common.ts
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
var stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  httpClient: Stripe.createFetchHttpClient()
});
var admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
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
async function userFrom(req) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in again.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Please sign in again.");
  return data.user;
}
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

// supabase/functions/delete-account/index.ts
handle("delete-account", async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "DELETE") throw new HttpError(400, "Type DELETE to confirm.");
  const user = await userFrom(req);
  const { data: check, error } = await admin.rpc("delete_account", { uid: user.id, dry_run: true });
  if (error) throw new HttpError(409, error.message);
  const sub = check?.cancel_subscription;
  if (sub) {
    try {
      await stripe.subscriptions.cancel(sub);
    } catch (e) {
      if (e.code !== "resource_missing") throw e;
    }
  }
  await removeReceipts(user.id);
  const { error: e2 } = await admin.rpc("delete_account", { uid: user.id, dry_run: false });
  if (e2) throw new HttpError(409, e2.message);
  return json({ deleted: true });
});
