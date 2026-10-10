// The daily clean-up's other half: deletes the receipts of accounts whose data
// purge_expired_data clears (access ended more than 90 days ago, by default).
// Storage files can only be deleted through the Storage API, so this runs as
// a function. It is called on a schedule with the service role key (see
// DEPLOY.md step 7); nobody else can call it.
import { admin, handle, HttpError, json, removeReceipts } from "../_shared/common.ts";

handle("purge-receipts", async (req) => {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!key || (req.headers.get("Authorization") ?? "") !== `Bearer ${key}`) throw new HttpError(401, "Not allowed.");
  const body = await req.json().catch(() => ({}));
  const days = Number.isInteger(body.days) && body.days >= 30 ? body.days : 90;
  const { data, error } = await admin.rpc("receipt_owners_to_purge", { days });
  if (error) throw error;
  let people = 0, files = 0;
  for (const uid of (data ?? []) as string[]) {
    const n = await removeReceipts(uid);
    if (n) { people++; files += n; }
  }
  return json({ people, files });
});
