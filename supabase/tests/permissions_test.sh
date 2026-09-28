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
expect "invite waiting for an email is not accepted silently" '"role": "owner"' "$C" "select public.app_context()"
expect "…it is offered, with the team's name" "'s team" "$C" "select public.app_context()->'pending_invite'->>'team_name'"
CTOK=$(as "$C" "select public.app_context()->'pending_invite'->>'token'" | tail -1)
expect "joining by the offered invite" '"role": "admin"' "$C" "select public.app_context('$CTOK')"
expect "after joining, nothing is offered" "t" "$C" "select public.app_context()->'pending_invite' = 'null'::jsonb"
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

echo "agency plan: shared contact list"
E=$(user e-owner@test.au); F=$(user f-agent@test.au); G=$(user g-outsider@test.au)
as "$E" "select public.app_context()" >/dev/null; as "$G" "select public.app_context()" >/dev/null
ETEAM=$(as "$E" "select public.my_team_id()" | tail -1)
expect "per-user team can't use the shared list" "row-level security" "$E" "insert into public.team_contacts (team_id, ckey, record) values ('$ETEAM', 'a|1 st', '{}')"
expect "owner picks Agency 10 during the trial" "" "$E" "select public.set_trial_plan('agency_10')"
expect "context reports the shared list" '"shared": true' "$E" "select public.app_context()"
FTOK=$(as "$E" "select public.create_invite('f-agent@test.au', 'agent')->>'token'" | tail -1)
as "$F" "select public.app_context('$FTOK')" >/dev/null
expect "agent can't choose the plan" "Only the team owner" "$F" "select public.set_trial_plan('agency_20')"
expect "owner adds a shared contact" "" "$E" "insert into public.team_contacts (team_id, ckey, record) values ('$ETEAM', 'sam|4 ocean st', '{\"n\": \"Sam\", \"stage\": \"hot\"}')"
expect "agent sees the owner's contact" "Sam" "$F" "select record->>'n' from public.team_contacts where team_id = '$ETEAM'"
expect "agent updates it, and is recorded as the editor" "$F" "$F" "update public.team_contacts set record = record || '{\"stage\": \"warm\"}' where ckey = 'sam|4 ocean st' returning updated_by"
expect "who added it can't be rewritten" "$E" "$F" "update public.team_contacts set created_by = '$F' where ckey = 'sam|4 ocean st' returning created_by"
expect "outsider can't see the agency's contacts" "0" "$G" "select count(*) from public.team_contacts"
GTEAM=$(as "$G" "select public.my_team_id()" | tail -1)
expect "outsider can't add to the agency's list" "row-level security" "$G" "insert into public.team_contacts (team_id, ckey, record) values ('$ETEAM', 'x|y', '{}')"
TS=$(( $(date +%s) * 1000 ))
expect "agent logs a call on the shared contact" "" "$F" "update public.team_contacts set activity = '[{\"type\": \"📞 Called\", \"ts\": $TS, \"by\": \"$F\"}]' where ckey = 'sam|4 ocean st'"
expect "a call logged in a teammate's name is credited to whoever logged it" "$F" "$F" "update public.team_contacts set activity = activity || '[{\"type\": \"📞 Called\", \"ts\": 1, \"by\": \"$E\"}]' where ckey = 'sam|4 ocean st' returning activity->1->>'by'"
expect "…while earlier entries keep their author" "$F" "$E" "update public.team_contacts set record = record where ckey = 'sam|4 ocean st' returning activity->0->>'by'"
expect "a new contact's calls are credited to whoever added it" "$F" "$F" "insert into public.team_contacts (team_id, ckey, record, activity) values ('$ETEAM', 'new|2 rd', '{}', '[{\"type\": \"x\", \"by\": \"$E\"}]') returning activity->0->>'by'"
"${Q[@]}" -c "delete from public.team_contacts where ckey = 'new|2 rd'; update public.team_contacts set activity = activity - 1 where ckey = 'sam|4 ocean st'"
expect "dashboard counts the agent's calls from the shared list" '"calls7": 1' "$E" "select public.team_dashboard()->'shared'->'by_member'->'$F'"
expect "dashboard shows the agency pipeline" '"warm": 1' "$E" "select public.team_dashboard()->'shared'->'stages'"
for i in $(seq 1 8); do as "$E" "select public.create_invite('extra$i@test.au', 'agent')" >/dev/null; done
expect "Agency 10 stops at 10 people" "covers up to 10 people" "$E" "select public.create_invite('eleventh@test.au', 'agent')"
expect "can't try a plan smaller than the team" "" "$E" "select public.set_trial_plan('agency_20')"
"${Q[@]}" -c "update public.teams set trial_ends_at = now() - interval '1 day' where id = '$ETEAM'"
expect "trial over: shared list is read-only" "row-level security" "$F" "insert into public.team_contacts (team_id, ckey, record) values ('$ETEAM', 'new|1 rd', '{}')"
expect "trial over: shared list can still be read to export" "1" "$F" "select count(*) from public.team_contacts"
"${Q[@]}" -c "update public.teams set subscription_status = 'active', seats = 10, plan = 'agency_10' where id = '$ETEAM'"
expect "paid Agency 10 with 2 people: access" "t" "$F" "select public.has_access('$F')"
expect "paying team can't switch plan without Stripe" "Use Change plan" "$E" "select public.set_trial_plan('per_user')"
"${Q[@]}" -c "update public.teams set plan = 'per_user', seats = 2 where id = '$ETEAM'"
expect "back on per-user: shared list hidden (kept for later)" "0" "$F" "select count(*) from public.team_contacts"
expect "rows are still there" "1" "-" "reset role; select count(*) from public.team_contacts where team_id = '$ETEAM'"

for i in $(seq 1 20); do as "$G" "select public.create_invite('trialcap$i@test.au', 'agent')" >/dev/null; done
expect "a trial team stops at 20 people" "up to 20 people" "$G" "select public.create_invite('trialcap21@test.au', 'agent')"

echo "joining needs room in the team"
J=$(user j-owner@test.au); K=$(user k-agent@test.au)
as "$J" "select public.app_context()" >/dev/null
JTEAM=$(as "$J" "select public.my_team_id()" | tail -1)
KTOK=$(as "$J" "select public.create_invite('k-agent@test.au', 'agent')->>'token'" | tail -1)
"${Q[@]}" -c "update public.teams set subscription_status = 'active', seats = 1 where id = '$JTEAM'"
expect "invite from the trial can't overfill the paid seats" "no free paid seat" "$K" "select public.app_context('$KTOK')"
expect "…and the owner keeps access" "t" "$J" "select public.has_access('$J')"
"${Q[@]}" -c "update public.teams set seats = 2 where id = '$JTEAM'"
expect "with a seat added the invite works" '"role": "agent"' "$K" "select public.app_context('$KTOK')"

echo "deleting data after an account ends"
expect "people can't run the clean-up themselves" "permission denied" "$A" "select public.purge_expired_data(0)"
"${Q[@]}" -c "update public.teams set subscription_status = null, current_period_end = null, trial_ends_at = now() - interval '91 days' where id = '$ETEAM'"
BEFORE=$("${Q[@]}" -c "select count(*) from public.team_contacts where team_id = '$ETEAM'")
OUT=$("${Q[@]}" -c "select public.purge_expired_data(90)")
AFTER=$("${Q[@]}" -c "select count(*) from public.team_contacts where team_id = '$ETEAM'")
[ "$BEFORE" = 1 ] && [ "$AFTER" = 0 ] && ok "data of a team lapsed over 90 days is deleted" || bad "data of a team lapsed over 90 days is deleted" "before=$BEFORE after=$AFTER $OUT"
LEFT=$("${Q[@]}" -c "select count(*) from public.crm_state where user_id = '$B'")
[ "$LEFT" -ge 1 ] && ok "data of teams still in their 90 days is kept" || bad "data of teams still in their 90 days is kept" "rows=$LEFT"
H=$(user h-gone@test.au); I=$(user i-recent@test.au)
"${Q[@]}" -c "update public.profiles set trial_ends_at = now() - interval '200 days' where id in ('$H', '$I');
  insert into public.crm_state (user_id, key, value, updated_at) values ('$H', 'crm_data_v4', '[1]', now() - interval '120 days'), ('$I', 'crm_data_v4', '[2]', now() - interval '5 days')"
"${Q[@]}" -c "select public.purge_expired_data(90)" >/dev/null
[ "$("${Q[@]}" -c "select count(*) from public.crm_state where user_id = '$H'")" = 0 ] && ok "someone in no team, untouched for 90 days: deleted" || bad "someone in no team, untouched for 90 days: deleted" "still there"
[ "$("${Q[@]}" -c "select count(*) from public.crm_state where user_id = '$I'")" = 1 ] && ok "someone in no team who changed data recently: kept" || bad "someone in no team who changed data recently: kept" "gone"

echo "app download"
"${Q[@]}" -c "insert into storage.objects (bucket_id, name) values ('app', 'crm.html')"
expect "member with access can download the app" "1" "$C" "select count(*) from storage.objects where bucket_id = 'app'"
expect "no access: can't download the app" "0" "$B" "select count(*) from storage.objects where bucket_id = 'app'"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
