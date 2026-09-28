#!/usr/bin/env bash
# Checks the team, role, trial and seat rules against a real Postgres.
# Uses the usual PGHOST / PGPORT / PGUSER settings, e.g.
#   PGHOST=localhost PGUSER=postgres supabase/tests/permissions_test.sh
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
PSQL=(psql -d postgres -X -q -At -v ON_ERROR_STOP=1)
DB=crm_test
"${PSQL[@]}" -c "drop database if exists $DB" -c "create database $DB" >/dev/null
Q=(psql -d "$DB" -X -q -At -v ON_ERROR_STOP=1)
"${Q[@]}" -f "$DIR/stub_supabase.sql" >/dev/null || { echo "setup failed"; exit 1; }
for f in "$DIR"/../migrations/*.sql; do
  "${Q[@]}" -f "$f" >/dev/null || { echo "migration $f failed"; exit 1; }
done

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }

# run SQL as a signed-in user (uid) or as anon (uid = -)
as() {
  local uid="$1"; shift
  local pre="set local role authenticated; set local request.jwt.claim.sub = '$uid';"
  [ "$uid" = "-" ] && pre="set local role anon;"
  "${Q[@]}" -c "begin; $pre $*; commit;" 2>&1
}
expect() {   # expect NAME EXPECTED UID SQL   (empty EXPECTED = must not error)
  local name="$1" want="$2" uid="$3"; shift 3
  local all; all="$(as "$uid" "$@")"
  if [ -z "$want" ]; then
    if [[ "$all" == *ERROR* ]]; then bad "$name" "$all"; else ok "$name"; fi
  elif [[ "$all" == *"$want"* ]]; then ok "$name"; else bad "$name" "wanted '$want', got '$all'"; fi
}
user() { "${Q[@]}" -c "insert into auth.users (email) values ('$1') returning id"; }

A=$(user owner@test.au); B=$(user agent@test.au); C=$(user admin@test.au); D=$(user other@test.au)

echo "sign-up and trial"
expect "new user gets a team of their own" '"role": "owner"' "$A" "select public.app_context()"
expect "trial gives access" "t" "$A" "select public.has_access('$A')"
expect "signed-out people can't call anything" "permission denied" "-" "select public.app_context()"
expect "can't extend own trial" "permission denied" "$A" "update public.profiles set trial_ends_at = now() + interval '1 year' where id = '$A'"
expect "can change own name" "Alex Owner" "$A" "update public.profiles set full_name = 'Alex Owner' where id = '$A' returning full_name"
expect "can't give own team a subscription" "0" "$A" "with u as (update public.teams set subscription_status = 'active' returning 1) select count(*) from u"

echo "invites and roles"
TOK=$(as "$A" "select public.create_invite('agent@test.au', 'agent')->>'token'" | tail -1)
[ ${#TOK} -ge 32 ] && ok "owner creates invite" || bad "owner creates invite" "$TOK"
expect "invite for someone else's email is refused" "Sign in with that email" "$D" "select public.app_context('$TOK')"
expect "invited person joins as agent" '"role": "agent"' "$B" "select public.app_context('$TOK')"
expect "used invite can't be reused" "expired or was already used" "$D" "select public.app_context('$TOK')"
as "$A" "select public.create_invite('admin@test.au', 'admin')" >/dev/null
expect "invite waiting for an email is picked up at sign-in" '"role": "admin"' "$C" "select public.app_context()"
expect "agent can't invite" "Only owners and admins" "$B" "select public.create_invite('x@test.au', 'agent')"
expect "admin can't invite admins" "Only the owner can invite admins" "$C" "select public.create_invite('x@test.au', 'admin')"
expect "admin can invite agents" "x@test.au" "$C" "select public.create_invite('x@test.au', 'agent')->>'email'"
expect "agent can't see invites" "0" "$B" "select count(*) from public.invites"
expect "agent can't change roles" "Only the team owner" "$B" "select public.set_member_role('$C', 'agent')"
expect "admin can't remove the owner" "owner cannot be removed" "$C" "select public.remove_member('$A')"
expect "owner can't leave" "cannot leave" "$A" "select public.leave_team()"

echo "data privacy"
as "$A" "insert into public.crm_state (user_id, key, value) values ('$A', 'crm_data_v4', '[1,2,3]')" >/dev/null
as "$B" "insert into public.crm_state (user_id, key, value) values ('$B', 'crm_data_v4', '[9]')" >/dev/null
expect "owner can't read an agent's contacts" "0" "$A" "select count(*) from public.crm_state where user_id = '$B'"
expect "agent reads own contacts" "[9]" "$B" "select value from public.crm_state where user_id = '$B'"
expect "can't save data as someone else" "row-level security" "$B" "insert into public.crm_state (user_id, key, value) values ('$A', 'crm_x', 'hack')"
expect "only crm_ keys are stored" "violates check" "$B" "insert into public.crm_state (user_id, key, value) values ('$B', 'other', 'x')"
expect "someone outside the team sees nothing" "0" "$D" "select public.app_context(); select count(*) from public.crm_state where user_id in ('$A','$B')"

echo "dashboard"
as "$B" "insert into public.member_stats (user_id, stats) values ('$B', '{\"total\": 42}')" >/dev/null
expect "owner sees agent's figures" "42" "$A" "select public.team_dashboard()->'members'->1->'stats'->>'total'"
expect "admin sees the dashboard" '"members"' "$C" "select public.team_dashboard()"
expect "agent can't see the dashboard" "Only owners and admins" "$B" "select public.team_dashboard()"
expect "outsider can't read the team's figures" "0" "$D" "select count(*) from public.member_stats where user_id = '$B'"

echo "trial ending, seats and payment"
TEAM=$(as "$A" "select public.my_team_id()" | tail -1)
"${Q[@]}" -c "update public.teams set trial_ends_at = now() - interval '1 day' where id = '$TEAM'"
expect "trial over: no access" "f" "$B" "select public.has_access('$B')"
expect "trial over: can't save" "row-level security" "$B" "insert into public.crm_state (user_id, key, value) values ('$B', 'crm_new', 'x')"
expect "trial over: can still read own data to export it" "[9]" "$B" "select value from public.crm_state where user_id = '$B'"
"${Q[@]}" -c "update public.teams set subscription_status = 'active', seats = 2 where id = '$TEAM'"
expect "paid but more members (3) than seats (2): no access" "f" "$A" "select public.has_access('$A')"
expect "all seats used: invite refused" "paid seats are in use" "$A" "select public.create_invite('y@test.au', 'agent')"
"${Q[@]}" -c "update public.teams set seats = 3 where id = '$TEAM'; delete from public.invites where team_id = '$TEAM'"
expect "paid with enough seats: access" "t" "$B" "select public.has_access('$B')"
"${Q[@]}" -c "update public.teams set subscription_status = 'canceled' where id = '$TEAM'"
expect "cancelled: no access" "f" "$A" "select public.has_access('$A')"
"${Q[@]}" -c "update public.teams set subscription_status = 'past_due' where id = '$TEAM'"
expect "card failing (past_due): access while Stripe retries" "t" "$A" "select public.has_access('$A')"

echo "leaving and moving teams"
expect "admin removes agent" "" "$C" "select public.remove_member('$B')"
"${Q[@]}" -c "update public.profiles set trial_ends_at = now() - interval '1 day' where id = '$B'"
expect "removed agent gets their own team, trial not restarted" "false" "$B" "select public.app_context()->>'access'"
expect "their new team is theirs" '"role": "owner"' "$B" "select public.app_context()"
expect "owner hands over ownership" "" "$A" "select public.transfer_ownership('$C')"
expect "new owner" '"role": "owner"' "$C" "select public.app_context()"

echo "app download"
"${Q[@]}" -c "insert into storage.objects (bucket_id, name) values ('app', 'crm.html')"
expect "member with access can download the app" "1" "$C" "select count(*) from storage.objects where bucket_id = 'app'"
expect "no access: can't download the app" "0" "$B" "select count(*) from storage.objects where bucket_id = 'app'"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
