#!/bin/sh
# Packages each server function into one file (supabase/dashboard/<name>.ts),
# for deploying through the Supabase website (Edge Functions → Deploy a new
# function → Via editor) instead of the Supabase CLI. Run it after changing
# anything in supabase/functions:
#   sh tools/bundle_functions.sh
set -e
cd "$(dirname "$0")/.."
mkdir -p supabase/dashboard
for f in create-checkout change-plan set-seats billing-portal delete-account purge-receipts stripe-webhook; do
  npx --yes esbuild@0.24.0 "supabase/functions/$f/index.ts" --bundle --format=esm --platform=neutral \
    --target=es2022 --external:'npm:*' --log-level=warning \
    --banner:js="// MICRM function \"$f\", packaged as one file for pasting into Supabase → Edge Functions.
// Built from supabase/functions/$f by tools/bundle_functions.sh; edit the source there, not this file." \
    --outfile="supabase/dashboard/$f.ts"
done
echo "packaged into supabase/dashboard/"
