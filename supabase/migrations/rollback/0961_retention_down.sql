-- 0961_retention_down.sql — reverses 0961. Refuses while retention exists: a claim holding retention or any release row (dropping
-- the columns would lose what the client still holds back).
do $$ begin
  if exists (select 1 from public.progress_claims where retention_amount > 0) or exists (select 1 from public.retention_releases) then
    raise exception 'retention is held on claims or releases are recorded; 0961 cannot be rolled back' using errcode = 'P0001';
  end if;
end $$;
drop view if exists public.claim_retention;
drop function if exists public.cancel_retention_release(uuid);
drop function if exists public.release_retention(uuid, date, text, uuid);
drop function if exists public.schedule_retention_release(uuid, numeric, date, text);
drop function if exists public.lock_retention_claim(uuid);
drop table if exists public.retention_releases;
drop function if exists public.guard_retention_release();
drop function if exists public.set_project_retention(uuid, numeric);
drop trigger if exists progress_claims_zz_stamp_retention on public.progress_claims;
drop function if exists public.stamp_progress_claim_retention();
-- Restore the 0960 billing-terms guard (deadline columns only).
drop trigger if exists projects_zz_guard_billing_terms on public.projects;
create or replace function public.guard_project_billing_terms() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.actor_bypasses_rls() then return new; end if;
  if (new.invoice_deadline_day, new.invoice_deadline_warn_days) is distinct from (old.invoice_deadline_day, old.invoice_deadline_warn_days)
     and coalesce(public.auth_role()::text, '') not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can change the invoice deadline' using errcode = '42501';
  end if;
  return new;
end; $$;
create trigger projects_zz_guard_billing_terms before update of invoice_deadline_day, invoice_deadline_warn_days on public.projects
  for each row execute function public.guard_project_billing_terms();
alter table public.progress_claims drop column if exists retention_amount, drop column if exists retention_pct;
alter table public.projects drop column if exists retention_pct;
