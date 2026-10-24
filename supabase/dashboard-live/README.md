# What is live on Supabase

These are the server functions exactly as they were pasted into the Supabase
website (Edge Functions → Deploy a new function → Via editor) on 24 Oct 2026.
Each is one self-contained file with no imports, written by hand from the
source in `supabase/functions/`, because pasting the packaged files in
`supabase/dashboard/` did not deploy reliably.

`create-checkout` is not here: the live one is an earlier hand-simplified
version of `supabase/dashboard/create-checkout.ts`.

After deploying any of them, turn **Verify JWT** off for that function.
If you change a function's behaviour, change its source in
`supabase/functions/` too, so the two stay the same.
