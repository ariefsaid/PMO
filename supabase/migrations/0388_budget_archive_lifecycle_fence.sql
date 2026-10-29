-- #1422: an archived activation remains stable until its external cancellations settle.
create or replace function public.fence_budget_archive_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'Archived'
     and (new.status is distinct from old.status
          or new.activated_at is distinct from old.activated_at)
     and exists (
       select 1 from public.budget_archive_cancel_intents i
        where i.org_id = old.org_id and i.budget_version_id = old.id
          and i.state <> 'complete'
     ) then
    raise exception 'budget archive cancellation is unresolved; complete cancellation before reactivating'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.fence_budget_archive_lifecycle() from public, anon, authenticated;
create trigger budget_archive_lifecycle_fence
before update of status, activated_at on public.budget_versions
for each row execute function public.fence_budget_archive_lifecycle();
