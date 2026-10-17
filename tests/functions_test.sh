#!/bin/sh
# Runs the packaged server functions (supabase/dashboard/*.ts) under Deno
# against a stand-in for Supabase and Stripe (tests/fake_backend.js), and
# checks what they answer and what they send.
#   DENO=/path/to/deno sh tests/functions_test.sh
set -e
cd "$(dirname "$0")/.."
DENO=${DENO:-deno}
node tests/fake_backend.js 9911 > /tmp/fake_backend.log 2>&1 & FAKE=$!
trap 'kill $FAKE $FN 2>/dev/null' EXIT
sleep 1
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 (got: $2, want: $3)"; fi; }
run() {
  if [ -n "$FN" ]; then kill $FN 2>/dev/null; wait $FN 2>/dev/null || true; fi
  for i in $(seq 1 20); do curl -s -o /dev/null -m 1 localhost:8000 || break; sleep 0.3; done
  SUPABASE_URL=http://127.0.0.1:9911 SUPABASE_SERVICE_ROLE_KEY=eyJservice STRIPE_SECRET_KEY=sk_test_x \
  STRIPE_API_BASE=http://127.0.0.1:9911/stripe SITE_URL=' site.example./
' STRIPE_PRICE_ID=price_user STRIPE_PRICE_AGENCY_10=price_a10 STRIPE_PRICE_AGENCY_20=price_a20 \
  STRIPE_WEBHOOK_SECRET=whsec_test \
    $DENO run --allow-net --allow-env "supabase/dashboard/$1.ts" > /tmp/fn.log 2>&1 & FN=$!
  for i in $(seq 1 30); do curl -s -o /dev/null -m 1 -X OPTIONS localhost:8000 && return; sleep 0.3; done
}
post() { curl -s -m 10 -X POST localhost:8000 -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$2"; }

echo create-checkout
run create-checkout
check "preflight answers at once, any site" "$(curl -s -m 3 -o /dev/null -w '%{http_code} ' -X OPTIONS localhost:8000 -H 'Origin: https://other.example'; curl -s -m 3 -D - -o /dev/null -X OPTIONS localhost:8000 | tr -d '\r' | grep -i '^access-control-allow-origin' )" "200 access-control-allow-origin: *"
check "not signed in: 401" "$(post bad '{}')" '{"error":"Please sign in again."}'
check "owner gets a Stripe checkout page" "$(post good '{"plan":"per_user"}')" '{"url":"https://checkout.example/cs_1"}'
check "…creating the customer and saving it on the team" "$(curl -s localhost:9911/__log | grep -c 'PATCH /rest/v1/teams?id=eq.t1 {"stripe_customer_id":"cus_1"}')" "1"
check "…with the price, quantity (owner + open invite), trial and return address" "$(curl -s localhost:9911/__log | grep 'POST /stripe/v1/checkout/sessions ' | grep -c 'line_items%5B0%5D%5Bprice%5D=price_user.*line_items%5B0%5D%5Bquantity%5D=2.*subscription_data%5Bmetadata%5D%5Bteam_id%5D=t1.*subscription_data%5Btrial_end%5D=.*success_url=https%3A%2F%2Fsite.example%2Fapp.html')" "1"

echo billing-portal
run billing-portal
check "portal link" "$(post good '{}')" '{"url":"https://portal.example/bps_1"}'

echo stripe-webhook
run stripe-webhook
BODY='{"type":"customer.subscription.updated","data":{"object":{"id":"sub_1"}}}'
T=$(date +%s)
SIG=$(printf '%s' "$T.$BODY" | openssl dgst -sha256 -hmac whsec_test -hex | sed 's/^.* //')
check "bad signature refused" "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST localhost:8000 -H "Stripe-Signature: t=$T,v1=00" -d "$BODY")" "400"
check "signed event accepted" "$(curl -s -m 5 -X POST localhost:8000 -H "Stripe-Signature: t=$T,v1=$SIG" -d "$BODY")" '{"received":true}'
check "…and the team's subscription saved" "$(curl -s localhost:9911/__log | grep -c 'PATCH /rest/v1/teams?id=eq.t1 {"stripe_customer_id":"cus_1","stripe_subscription_id":"sub_1","subscription_status":"active","plan":"per_user","seats":3')" "1"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
