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
// the $100 AUD per user per month price, created in the Stripe dashboard
export const PRICE_ID = Deno.env.get("STRIPE_PRICE_ID") ?? "";

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
};

export const PAID = ["active", "trialing", "past_due"];

// the signed-in user behind the request's access token
async function userFrom(req: Request): Promise<User> {
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
