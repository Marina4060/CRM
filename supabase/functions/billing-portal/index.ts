// Opens Stripe's billing page: update card, download invoices, cancel.
import { handle, HttpError, json, ownerFrom, SITE_URL, stripeApi } from "../_shared/common.ts";

handle("billing-portal", async (req) => {
  const { team } = await ownerFrom(req);
  if (!team.stripe_customer_id) throw new HttpError(404, "Your team doesn't have a subscription yet.");
  const session = await stripeApi("POST", "/billing_portal/sessions", {
    customer: team.stripe_customer_id,
    return_url: `${SITE_URL}/app.html#billing`,
  });
  return json({ url: session.url });
});
