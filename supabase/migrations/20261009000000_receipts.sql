-- ══ Receipts: photos and PDFs attached to expenses ══
-- A private bucket. Each person's receipts sit in a folder named after their
-- user id (<user id>/<expense id>), and only they can see, add or remove them.
-- Adding needs access (a trial or a paid seat); after an account ends people
-- can still open their receipts to download them, as the privacy policy says.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'application/pdf'])
on conflict (id) do nothing;

create policy "own receipts: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own receipts: add" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text
              and public.has_access(auth.uid()));

create policy "own receipts: replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text
              and public.has_access(auth.uid()));

create policy "own receipts: remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

-- Whose receipts the daily clean-up removes: the same people purge_expired_data
-- clears (members of teams whose access ended more than `days` ago, and people
-- in no team whose trial and last change are that old). Storage files can only
-- be deleted through the Storage API, so the purge-receipts function asks this
-- and deletes their folders.
create function public.receipt_owners_to_purge(days int default 90) returns setof uuid
language sql stable security definer set search_path = public as $$
  with cutoff as (select now() - make_interval(days => days) as at)
  select m.user_id from public.team_members m join public.teams t on t.id = m.team_id, cutoff
  where not public.team_paid(t)
    and greatest(t.trial_ends_at, coalesce(t.current_period_end, t.trial_ends_at)) < cutoff.at
  union
  select pr.id from public.profiles pr, cutoff
  where not exists (select 1 from public.team_members m where m.user_id = pr.id)
    and greatest(pr.trial_ends_at,
                 coalesce((select max(s.updated_at) from public.crm_state s where s.user_id = pr.id), pr.trial_ends_at),
                 coalesce((select ms.updated_at from public.member_stats ms where ms.user_id = pr.id), pr.trial_ends_at)) < cutoff.at;
$$;
revoke execute on function public.receipt_owners_to_purge(int) from public, anon, authenticated;
grant execute on function public.receipt_owners_to_purge(int) to service_role;
