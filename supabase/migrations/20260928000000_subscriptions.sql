-- Real Estate CRM: accounts, teams and roles, 14-day trial, Stripe
-- subscriptions, cloud copy of each agent's CRM, the agency-wide shared
-- contact list, team dashboard figures and support requests.
--
-- Plans:
--   per_user   $100 AUD per person per month; each agent's contacts are private
--   agency_10  $500 AUD per month, up to 10 people, one shared contact list
--   agency_20  $1000 AUD per month, up to 20 people, one shared contact list
--
-- Everyone belongs to exactly one team. A solo agent is a team of one.
-- Roles: owner (billing, seats, roles), admin (invites agents, sees the team
-- dashboard) and agent (their own CRM only).

-- ── people ──────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  -- the free trial belongs to the person, so leaving and re-joining teams never restarts it
  trial_ends_at timestamptz not null default (now() + interval '14 days')
);

-- ── teams (the thing that pays) ─────────────────────────────────────
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  trial_ends_at timestamptz not null,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  subscription_status text,          -- Stripe: trialing, active, past_due, canceled, ...
  plan text not null default 'per_user' check (plan in ('per_user', 'agency_10', 'agency_20')),
  seats int not null default 0,      -- people the subscription pays for (per_user: quantity; agency: 10 or 20)
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,  -- one team each
  role text not null check (role in ('owner', 'admin', 'agent')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create unique index one_owner_per_team on public.team_members (team_id) where role = 'owner';

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'agent')),
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz
);
create unique index one_open_invite_per_email on public.invites (team_id, lower(email)) where accepted_at is null;

-- ── each agent's CRM data: one row per browser-storage key ──────────
create table public.crm_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (key ~ '^crm_[a-z0-9_-]+$'),
  value text not null check (length(value) <= 8000000),   -- a browser holds about 5 MB per site
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ── figures for the team dashboard (no client details) ──────────────
create table public.member_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stats jsonb not null check (pg_column_size(stats) < 8192),
  updated_at timestamptz not null default now()
);

-- ── help requests from inside the app ───────────────────────────────
create table public.support_requests (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  email text not null,
  topic text not null check (topic in ('question', 'problem', 'billing', 'idea')),
  message text not null check (length(message) between 1 and 5000),
  page text,
  app_version text,
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'answered', 'closed'))
);

-- ── the agency's shared contact list (agency plans) ──────────────────
-- one row per contact, so agents working at the same time don't overwrite
-- each other; activity (calls, texts, notes) travels with the contact
create table public.team_contacts (
  team_id uuid not null references public.teams (id) on delete cascade,
  ckey text not null check (length(ckey) between 2 and 600),        -- "name|address", as the CRM keys contacts
  record jsonb not null check (jsonb_typeof(record) = 'object' and pg_column_size(record) < 65536),
  activity jsonb not null default '[]'::jsonb
    check (jsonb_typeof(activity) = 'array' and pg_column_size(activity) < 262144),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (team_id, ckey)
);
create index team_contacts_changes on public.team_contacts (team_id, updated_at);

-- ── helpers ─────────────────────────────────────────────────────────
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger teams_touch before update on public.teams for each row execute function public.touch_updated_at();
create trigger crm_state_touch before update on public.crm_state for each row execute function public.touch_updated_at();
create trigger member_stats_touch before update on public.member_stats for each row execute function public.touch_updated_at();

-- who added and who last changed a shared contact is recorded by the database, not the app
create function public.stamp_team_contact() returns trigger
language plpgsql as $$
declare
  before jsonb := '[]'::jsonb;
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.created_by := auth.uid();
    -- an upsert of a contact the team already has continues as an update: credit nothing here
    if exists (select 1 from public.team_contacts where team_id = new.team_id and ckey = new.ckey) then
      before := null;
    end if;
  else
    new.created_at := old.created_at; new.created_by := old.created_by; new.team_id := old.team_id;
    before := old.activity;
  end if;
  -- calls, texts and notes that are new in this change are credited to whoever sent it,
  -- so nobody can log activity in a teammate's name
  if before is not null and auth.uid() is not null and jsonb_typeof(new.activity) = 'array' then
    new.activity := coalesce((
      select jsonb_agg(case when jsonb_typeof(e) = 'object' and not (before @> jsonb_build_array(e))
                            then e || jsonb_build_object('by', auth.uid()) else e end order by i)
      from jsonb_array_elements(new.activity) with ordinality as x(e, i)), '[]'::jsonb);
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
create trigger team_contacts_stamp before insert or update on public.team_contacts
  for each row execute function public.stamp_team_contact();

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
    values (new.id, new.email, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.my_team_id() returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from public.team_members where user_id = auth.uid();
$$;

-- 'none' when signed out or not in a team, so permission checks fail closed
create function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.team_members where user_id = auth.uid()), 'none');
$$;

create function public.team_paid(t public.teams) returns boolean
language sql immutable as $$
  select coalesce(t.subscription_status in ('active', 'trialing', 'past_due'), false);  -- never null: "not paid" must mean not paid
$$;

-- the most people an agency plan covers (null: per_user, one paid seat each)
create function public.plan_limit(plan text) returns int
language sql immutable as $$
  select case plan when 'agency_10' then 10 when 'agency_20' then 20 end;
$$;

-- agency plans share one contact list across the team
create function public.team_shared(t public.teams) returns boolean
language sql immutable as $$
  select t.plan in ('agency_10', 'agency_20');
$$;

-- may this person use the app right now?
--   * their team is paying and they are within the paid seats, or
--   * their team is still in its free trial
create function public.has_access(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.team_members m
    join public.teams t on t.id = m.team_id
    where m.user_id = uid
      and (t.trial_ends_at > now()
           or (public.team_paid(t)
               and (select count(*) from public.team_members m2 where m2.team_id = t.id) <= greatest(t.seats, 1)))
  );
$$;

-- ── row security ────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.invites enable row level security;
alter table public.crm_state enable row level security;
alter table public.member_stats enable row level security;
alter table public.support_requests enable row level security;
alter table public.team_contacts enable row level security;

-- everything that changes teams, roles, billing or invites goes through the
-- functions below or the Stripe webhook, never through direct writes
create policy "read own profile" on public.profiles for select to authenticated
  using (id = auth.uid() or id in (select user_id from public.team_members where team_id = public.my_team_id()));
create policy "update own name" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

create policy "read own team" on public.teams for select to authenticated
  using (id = public.my_team_id());
create policy "read team members" on public.team_members for select to authenticated
  using (team_id = public.my_team_id());
create policy "owners and admins see invites" on public.invites for select to authenticated
  using (team_id = public.my_team_id() and public.my_role() in ('owner', 'admin'));

-- own data: always readable (so it can be exported after a subscription ends);
-- saving changes needs access
create policy "read own data" on public.crm_state for select to authenticated
  using (user_id = auth.uid());
create policy "add own data" on public.crm_state for insert to authenticated
  with check (user_id = auth.uid() and public.has_access(auth.uid()));
create policy "change own data" on public.crm_state for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.has_access(auth.uid()));
create policy "delete own data" on public.crm_state for delete to authenticated
  using (user_id = auth.uid() and public.has_access(auth.uid()));

-- dashboard figures: you write your own; owners and admins read the team's
create policy "read stats" on public.member_stats for select to authenticated
  using (user_id = auth.uid()
         or (public.my_role() in ('owner', 'admin')
             and user_id in (select user_id from public.team_members where team_id = public.my_team_id())));
create policy "write own stats" on public.member_stats for insert to authenticated
  with check (user_id = auth.uid());
create policy "update own stats" on public.member_stats for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- shared contacts: everyone in an agency-plan team. Reading stays possible
-- after a subscription ends (to export); changes need access.
create function public.in_shared_team(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members m join public.teams t on t.id = m.team_id
                 where m.user_id = auth.uid() and t.id = tid and public.team_shared(t));
$$;
create policy "agency reads shared contacts" on public.team_contacts for select to authenticated
  using (public.in_shared_team(team_id));
create policy "agency adds shared contacts" on public.team_contacts for insert to authenticated
  with check (public.in_shared_team(team_id) and public.has_access(auth.uid()));
create policy "agency changes shared contacts" on public.team_contacts for update to authenticated
  using (public.in_shared_team(team_id))
  with check (public.in_shared_team(team_id) and public.has_access(auth.uid()));
create policy "agency removes shared contacts" on public.team_contacts for delete to authenticated
  using (public.in_shared_team(team_id) and public.has_access(auth.uid()));

create policy "send support request" on public.support_requests for insert to authenticated
  with check (user_id = auth.uid());
create policy "read own support requests" on public.support_requests for select to authenticated
  using (user_id = auth.uid());

-- ── actions (called from the app) ───────────────────────────────────

-- make sure the signed-in person is in a team; returns everything the app
-- needs to know about them. An invite token joins that team.
create function public.app_context(invite_token text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  p public.profiles;
  inv public.invites;
  cur public.team_members;
  t public.teams;
  n int;
  offer jsonb;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into p from public.profiles where id = uid;
  if not found then
    insert into public.profiles (id, email)
      select id, email from auth.users where id = uid
      returning * into p;
  end if;
  select * into cur from public.team_members where user_id = uid;

  -- an invite is accepted only by its token (the link, or "Join" in the app);
  -- one waiting for this email address is offered below, never accepted silently
  if invite_token is not null then
    select * into inv from public.invites
      where token = invite_token and accepted_at is null and expires_at > now();
    if not found then raise exception 'This invite link has expired or was already used.'; end if;
    if lower(inv.email) <> lower(p.email) then
      raise exception 'This invite was sent to %. Sign in with that email address to accept it.', inv.email;
    end if;
  end if;

  if inv.id is not null and (cur.user_id is null or cur.team_id <> inv.team_id) then
    -- the team must still have room (the plan or seats may have changed since the invite)
    select * into t from public.teams where id = inv.team_id;
    select count(*) into n from public.team_members where team_id = inv.team_id;
    if public.plan_limit(t.plan) is not null and n >= public.plan_limit(t.plan) then
      raise exception '% is full: its plan covers up to % people. Ask the owner to make room.', t.name, public.plan_limit(t.plan);
    elsif t.plan = 'per_user' and public.team_paid(t) and n >= greatest(t.seats, 1) then
      raise exception '% has no free paid seat. Ask the owner to add a seat under Billing.', t.name;
    elsif not public.team_paid(t) and n >= 20 then
      raise exception '% is full: during the free trial a team can have up to 20 people.', t.name;
    end if;
    if cur.user_id is not null then
      -- leaving a team of one: fine unless it is paying
      select * into t from public.teams where id = cur.team_id;
      select count(*) into n from public.team_members where team_id = cur.team_id;
      if cur.role = 'owner' and n > 1 then
        raise exception 'You own a team with other members. Hand it over or remove them before joining another team.';
      end if;
      if cur.role = 'owner' and public.team_paid(t) then
        raise exception 'Your own subscription is still active. Cancel it under Billing before joining another team.';
      end if;
      delete from public.team_members where user_id = uid;
      if n = 1 then delete from public.teams where id = cur.team_id; end if;
    end if;
    insert into public.team_members (team_id, user_id, role) values (inv.team_id, uid, inv.role);
    update public.invites set accepted_at = now() where id = inv.id;
  elsif cur.user_id is null then
    -- a new solo team, on this person's own trial
    insert into public.teams (name, trial_ends_at)
      values (coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)) || '''s team', p.trial_ends_at)
      returning * into t;
    insert into public.team_members (team_id, user_id, role) values (t.id, uid, 'owner');
  end if;

  select * into cur from public.team_members where user_id = uid;
  select * into t from public.teams where id = cur.team_id;
  select count(*) into n from public.team_members where team_id = t.id;
  -- an invite to another team waiting for this email: the app asks before joining
  select jsonb_build_object('token', i.token, 'team_name', tt.name, 'role', i.role,
                            'invited_by', coalesce(nullif(ip.full_name, ''), ip.email))
    into offer
    from public.invites i
    join public.teams tt on tt.id = i.team_id
    left join public.profiles ip on ip.id = i.invited_by
    where lower(i.email) = lower(p.email) and i.accepted_at is null and i.expires_at > now() and i.team_id <> t.id
    order by i.created_at desc limit 1;
  return jsonb_build_object(
    'pending_invite', offer,
    'user', jsonb_build_object('id', uid, 'email', p.email, 'full_name', p.full_name),
    'role', cur.role,
    'team', jsonb_build_object(
      'id', t.id, 'name', t.name, 'trial_ends_at', t.trial_ends_at,
      'subscription_status', t.subscription_status, 'seats', t.seats, 'members', n,
      'plan', t.plan, 'plan_limit', public.plan_limit(t.plan), 'shared', public.team_shared(t),
      'current_period_end', t.current_period_end, 'cancel_at_period_end', t.cancel_at_period_end,
      'has_billing', t.stripe_customer_id is not null),
    'access', public.has_access(uid),
    'now', now());
end $$;

create function public.rename_team(new_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'owner' then raise exception 'Only the team owner can rename the team.'; end if;
  if length(trim(new_name)) not between 1 and 80 then raise exception 'Please enter a team name.'; end if;
  update public.teams set name = trim(new_name) where id = public.my_team_id();
end $$;

create function public.create_invite(invite_email text, invite_role text default 'agent') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.my_role();
  tid uuid := public.my_team_id();
  t public.teams;
  used int;
  inv public.invites;
begin
  if me not in ('owner', 'admin') then raise exception 'Only owners and admins can invite people.'; end if;
  if invite_role not in ('admin', 'agent') then raise exception 'Unknown role.'; end if;
  if invite_role = 'admin' and me <> 'owner' then raise exception 'Only the owner can invite admins.'; end if;
  if invite_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please enter a valid email address.'; end if;
  if exists (select 1 from public.team_members m join public.profiles p on p.id = m.user_id
             where m.team_id = tid and lower(p.email) = lower(invite_email)) then
    raise exception '% is already in your team.', invite_email;
  end if;
  select * into t from public.teams where id = tid;
  select (select count(*) from public.team_members where team_id = tid)
       + (select count(*) from public.invites where team_id = tid and accepted_at is null and expires_at > now())
    into used;
  if public.plan_limit(t.plan) is not null and used >= public.plan_limit(t.plan) then
    raise exception 'Your plan covers up to % people.%', public.plan_limit(t.plan),
      case when t.plan = 'agency_10' then ' The owner can switch to Agency 20 under Billing.' else ' Contact support for larger agencies.' end;
  elsif t.plan = 'per_user' and public.team_paid(t) and used >= t.seats then
    raise exception 'All % paid seats are in use. The owner can add a seat under Billing.', t.seats;
  elsif not public.team_paid(t) and used >= 20 then
    raise exception 'During the free trial a team can have up to 20 people.';
  end if;
  delete from public.invites where team_id = tid and lower(email) = lower(invite_email) and accepted_at is null;
  insert into public.invites (team_id, email, role, invited_by)
    values (tid, lower(trim(invite_email)), invite_role, auth.uid())
    returning * into inv;
  return jsonb_build_object('id', inv.id, 'token', inv.token, 'email', inv.email, 'role', inv.role, 'expires_at', inv.expires_at);
end $$;

-- during the free trial the owner picks which plan to try (e.g. the shared contact list);
-- once paying, plans change through Stripe (change-plan function)
create function public.set_trial_plan(new_plan text) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.teams;
  n int;
begin
  if public.my_role() <> 'owner' then raise exception 'Only the team owner can choose the plan.'; end if;
  if new_plan not in ('per_user', 'agency_10', 'agency_20') then raise exception 'Unknown plan.'; end if;
  select * into t from public.teams where id = public.my_team_id();
  if public.team_paid(t) then raise exception 'Your team is subscribed. Use Change plan under Billing.'; end if;
  select count(*) into n from public.team_members where team_id = t.id;
  if public.plan_limit(new_plan) is not null and n > public.plan_limit(new_plan) then
    raise exception 'Your team has % people; that plan covers up to %.', n, public.plan_limit(new_plan);
  end if;
  update public.teams set plan = new_plan where id = t.id;
end $$;

create function public.revoke_invite(invite_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() not in ('owner', 'admin') then raise exception 'Only owners and admins can cancel invites.'; end if;
  delete from public.invites where id = invite_id and team_id = public.my_team_id() and accepted_at is null;
end $$;

create function public.set_member_role(member uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'owner' then raise exception 'Only the team owner can change roles.'; end if;
  if new_role not in ('admin', 'agent') then raise exception 'Unknown role.'; end if;
  if member = auth.uid() then raise exception 'You are the owner. Use "Make owner" on someone else to hand over.'; end if;
  update public.team_members set role = new_role where user_id = member and team_id = public.my_team_id();
  if not found then raise exception 'That person is not in your team.'; end if;
end $$;

-- hand the team (and its billing) to another member
create function public.transfer_ownership(member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tid uuid := public.my_team_id();
begin
  if public.my_role() <> 'owner' then raise exception 'Only the team owner can do this.'; end if;
  if not exists (select 1 from public.team_members where user_id = member and team_id = tid) then
    raise exception 'That person is not in your team.';
  end if;
  update public.team_members set role = 'admin' where user_id = auth.uid();
  update public.team_members set role = 'owner' where user_id = member and team_id = tid;
end $$;

-- remove someone; their CRM data stays with their own account
create function public.remove_member(member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me text := public.my_role();
  them text;
begin
  select role into them from public.team_members where user_id = member and team_id = public.my_team_id();
  if them is null then raise exception 'That person is not in your team.'; end if;
  if member = auth.uid() then raise exception 'Use "Leave team" to remove yourself.'; end if;
  if them = 'owner' then raise exception 'The owner cannot be removed.'; end if;
  if me = 'admin' and them <> 'agent' then raise exception 'Admins can only remove agents.'; end if;
  if me not in ('owner', 'admin') then raise exception 'Only owners and admins can remove people.'; end if;
  delete from public.team_members where user_id = member;
end $$;

create function public.leave_team() returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() = 'owner' then
    raise exception 'The owner cannot leave. Make someone else owner first.';
  end if;
  delete from public.team_members where user_id = auth.uid();
  -- next sign-in puts them in a new team of their own (their trial does not restart)
end $$;

-- team dashboard: each member with their latest figures
create function public.team_dashboard() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tid uuid := public.my_team_id();
  t public.teams;
  shared jsonb := null;
  week_ms bigint := (extract(epoch from now() - interval '7 days') * 1000)::bigint;
begin
  if public.my_role() not in ('owner', 'admin') then raise exception 'Only owners and admins can see the team dashboard.'; end if;
  select * into t from public.teams where id = tid;
  if public.team_shared(t) then
    -- figures from the shared list: whole-agency pipeline, and what each person added and did this week
    shared := jsonb_build_object(
      'total', (select count(*) from public.team_contacts where team_id = tid and coalesce(record ->> 'stage', '') <> 'removed'),
      'stages', (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from (
                   select record ->> 'stage' as stage, count(*) as n from public.team_contacts
                   where team_id = tid and record ->> 'stage' is not null group by 1) x),
      'by_member', (select coalesce(jsonb_object_agg(m.user_id::text, jsonb_build_object(
                      'added', (select count(*) from public.team_contacts c where c.team_id = tid and c.created_by = m.user_id),
                      'calls7', coalesce(a.calls7, 0), 'sms7', coalesce(a.sms7, 0), 'emails7', coalesce(a.emails7, 0),
                      'touches7', coalesce(a.touches7, 0), 'contacted7', coalesce(a.contacted7, 0))), '{}'::jsonb)
                    from public.team_members m
                    left join (
                      select e ->> 'by' as uid,
                             count(*) filter (where e ->> 'type' ~* 'call') as calls7,
                             count(*) filter (where e ->> 'type' !~* 'call' and e ->> 'type' ~* 'sms|text') as sms7,
                             count(*) filter (where e ->> 'type' !~* 'call|sms|text' and e ->> 'type' ~* 'email') as emails7,
                             count(*) as touches7, count(distinct c.ckey) as contacted7
                      from public.team_contacts c, jsonb_array_elements(c.activity) e
                      where c.team_id = tid and e ->> 'ts' ~ '^[0-9]{1,15}$' and (e ->> 'ts')::bigint >= week_ms
                      group by 1) a on a.uid = m.user_id::text
                    where m.team_id = tid));
  end if;
  return jsonb_build_object(
    'shared', shared,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', m.user_id, 'email', p.email, 'full_name', p.full_name, 'role', m.role,
               'joined_at', m.joined_at, 'stats', s.stats, 'stats_updated_at', s.updated_at)
             order by m.role = 'owner' desc, m.joined_at)
      from public.team_members m
      join public.profiles p on p.id = m.user_id
      left join public.member_stats s on s.user_id = m.user_id
      where m.team_id = tid), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role,
               'token', i.token, 'expires_at', i.expires_at) order by i.created_at)
      from public.invites i
      where i.team_id = tid and i.accepted_at is null and i.expires_at > now()), '[]'::jsonb));
end $$;

-- only signed-in people can call anything; the Stripe functions use the service role
revoke execute on all functions in schema public from public, anon;
grant execute on function public.has_access(uuid), public.my_team_id(), public.my_role(),
  public.team_paid(public.teams), public.plan_limit(text), public.team_shared(public.teams),
  public.in_shared_team(uuid) to authenticated, service_role;
grant execute on function public.set_trial_plan(text) to authenticated;
grant execute on function public.app_context(text), public.rename_team(text), public.create_invite(text, text),
  public.revoke_invite(uuid), public.set_member_role(uuid, text), public.transfer_ownership(uuid),
  public.remove_member(uuid), public.leave_team(), public.team_dashboard() to authenticated;

-- ── deleting data after an account ends (the privacy policy promises this) ──
-- Removes the CRM data of teams that have had no trial or subscription for
-- more than `days` days. Accounts themselves stay, so people can sign in and
-- subscribe again (with an empty CRM). Run it daily, e.g. with pg_cron:
--   select cron.schedule('purge-expired-crm-data', '30 3 * * *', 'select public.purge_expired_data(90)');
create function public.purge_expired_data(days int default 90) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cutoff timestamptz := now() - make_interval(days => days);
  teams_done int; people int; contacts int; n int;
begin
  create temp table expired on commit drop as
    select t.id from public.teams t
    where not public.team_paid(t)
      and greatest(t.trial_ends_at, coalesce(t.current_period_end, t.trial_ends_at)) < cutoff;
  select count(*) into teams_done from expired;
  delete from public.team_contacts where team_id in (select id from expired);
  get diagnostics contacts = row_count;
  delete from public.crm_state where user_id in (select user_id from public.team_members where team_id in (select id from expired));
  get diagnostics people = row_count;
  delete from public.member_stats where user_id in (select user_id from public.team_members where team_id in (select id from expired));
  -- people no longer in any team (removed or left, and never came back): their own copy goes
  -- once their trial and their last change are both older than the retention period
  create temp table teamless on commit drop as
    select pr.id from public.profiles pr
    where not exists (select 1 from public.team_members m where m.user_id = pr.id)
      and greatest(pr.trial_ends_at,
                   coalesce((select max(s.updated_at) from public.crm_state s where s.user_id = pr.id), pr.trial_ends_at),
                   coalesce((select ms.updated_at from public.member_stats ms where ms.user_id = pr.id), pr.trial_ends_at)) < cutoff;
  delete from public.crm_state where user_id in (select id from teamless);
  get diagnostics n = row_count;
  people := people + n;
  delete from public.member_stats where user_id in (select id from teamless);
  return jsonb_build_object('teams', teams_done, 'crm_rows', people, 'shared_contacts', contacts);
end $$;
revoke execute on function public.purge_expired_data(int) from public, anon, authenticated;

-- ── the app itself lives in a private bucket ────────────────────────
insert into storage.buckets (id, name, public) values ('app', 'app', false)
  on conflict (id) do nothing;

create policy "members with access download the app" on storage.objects
  for select to authenticated
  using (bucket_id = 'app' and public.has_access(auth.uid()));
