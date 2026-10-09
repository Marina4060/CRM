// Shared helpers for the Stripe functions.
import Stripe from "npm:stripe@17.7.0";
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.49.4";

export const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  httpClient: Stripe.createFetchHttpClient(),
});

// service role: bypasses row security, only ever used on the server
export const admin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

// the site people use; Stripe sends them back here after paying
export const SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
// the three prices, created in the Stripe dashboard
export type Plan = "per_user" | "agency_10" | "agency_20";
export const PRICES: Record<Plan, string> = {
  per_user: Deno.env.get("STRIPE_PRICE_ID") ?? "",          // $100 AUD per person per month
  agency_10: Deno.env.get("STRIPE_PRICE_AGENCY_10") ?? "",  // $500 AUD per month, up to 10 people
  agency_20: Deno.env.get("STRIPE_PRICE_AGENCY_20") ?? "",  // $1000 AUD per month, up to 20 people
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

export const cors = {
  "Access-Control-Allow-Origin": SITE_URL || "*",
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

// the signed-in user behind the request's access token
export async function userFrom(req: Request): Promise<User> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in again.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Please sign in again.");
  return data.user;
}

// the caller, who must own their team, plus the team and its member count
export async function ownerFrom(req: Request): Promise<{ user: User; team: Team; members: number; openInvites: number }> {
  const user = await userFrom(req);
  const { data: m, error } = await admin
    .from("team_members").select("team_id, role").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!m) throw new HttpError(409, "Please reload the page and try again.");
  if (m.role !== "owner") throw new HttpError(403, "Only the team owner can manage billing.");
  const { data: team, error: e2 } = await admin.from("teams").select("*").eq("id", m.team_id).single();
  if (e2) throw e2;
  const { count: members } = await admin
    .from("team_members").select("user_id", { count: "exact", head: true }).eq("team_id", team.id);
  const { count: openInvites } = await admin
    .from("invites").select("id", { count: "exact", head: true })
    .eq("team_id", team.id).is("accepted_at", null).gt("expires_at", new Date().toISOString());
  return { user, team, members: members ?? 1, openInvites: openInvites ?? 0 };
}

// find or create the team's Stripe customer (the owner is the billing contact)
export async function customerFor(team: Team, user: User): Promise<string> {
  if (team.stripe_customer_id) return team.stripe_customer_id;
  const c = await stripe.customers.create({
    email: user.email,
    name: team.name,
    metadata: { team_id: team.id, owner_user_id: user.id },
  });
  const { error } = await admin.from("teams").update({ stripe_customer_id: c.id }).eq("id", team.id);
  if (error) throw error;
  return c.id;
}

// delete every receipt in a person's folder of the receipts bucket
export async function removeReceipts(userId: string): Promise<number> {
  const bucket = admin.storage.from("receipts");
  let removed = 0;
  for (;;) {
    const { data, error } = await bucket.list(userId, { limit: 1000 });
    if (error) throw error;
    if (!data || !data.length) return removed;
    const { error: e2 } = await bucket.remove(data.map((f) => `${userId}/${f.name}`));
    if (e2) throw e2;
    removed += data.length;
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
      console.error(name, e);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  });
}
