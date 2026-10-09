// A person deletes their own account from inside the app (Apple requires this
// for apps with sign-up). The owner of a paying team of one has the
// subscription cancelled first, so nobody is billed for a deleted account.
// Their receipts are deleted from storage.
// Stripe keeps the invoices, which tax law requires.
import { admin, handle, HttpError, json, removeReceipts, stripe, userFrom } from "../_shared/common.ts";

handle("delete-account", async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "DELETE") throw new HttpError(400, "Type DELETE to confirm.");
  const user = await userFrom(req);
  // checks only: refuses an owner who still has people in their team
  const { data: check, error } = await admin.rpc("delete_account", { uid: user.id, dry_run: true });
  if (error) throw new HttpError(409, error.message);
  const sub = (check as { cancel_subscription?: string | null })?.cancel_subscription;
  if (sub) {
    try {
      await stripe.subscriptions.cancel(sub);
    } catch (e) {
      // already gone in Stripe is fine; anything else stops here, before any data is deleted
      if ((e as { code?: string }).code !== "resource_missing") throw e;
    }
  }
  // their receipt photos and files go too (storage files can only be deleted through the Storage API)
  await removeReceipts(user.id);
  const { error: e2 } = await admin.rpc("delete_account", { uid: user.id, dry_run: false });
  if (e2) throw new HttpError(409, e2.message);
  return json({ deleted: true });
});
