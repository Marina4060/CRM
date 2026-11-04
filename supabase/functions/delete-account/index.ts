// A person deletes their own account from inside the app (Apple requires this
// for apps with sign-up). The owner of a paying team of one has the
// subscription cancelled first, so nobody is billed for a deleted account.
// Their receipts are deleted from storage.
// Stripe keeps the invoices, which tax law requires.
import { db, handle, HttpError, json, removeReceipts, stripeApi, StripeError, userFrom } from "../_shared/common.ts";

handle("delete-account", async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "DELETE") throw new HttpError(400, "Type DELETE to confirm.");
  const user = await userFrom(req);
  // checks only: refuses an owner who still has people in their team
  const check = await db.rpc("delete_account", { uid: user.id, dry_run: true });
  const sub = (check as { cancel_subscription?: string | null })?.cancel_subscription;
  if (sub) {
    try {
      await stripeApi("DELETE", `/subscriptions/${sub}`);
    } catch (e) {
      // already gone in Stripe is fine; anything else stops here, before any data is deleted
      if (!(e instanceof StripeError) || e.code !== "resource_missing") throw e;
    }
  }
  // their receipt photos and files go too (storage files can only be deleted through the Storage API)
  await removeReceipts(user.id);
  await db.rpc("delete_account", { uid: user.id, dry_run: false });
  return json({ deleted: true });
});
