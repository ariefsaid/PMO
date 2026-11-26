-- 2746: a record's client or customer is a company of the same organisation.
-- One trigger function, column name passed as the trigger argument. Insert: checked when the id is set.
-- Update: checked only when the id changes, so a legacy row that already violates still takes unrelated edits.
-- The row's own org_id decides. A foreign id is refused with the same answer as a nonexistent one (P0002).
-- Covers projects.client_id, sales_invoices.customer_id, incoming_payments.customer_id, crm_activities.company_id.
-- drops: nothing; no function body is restated. Proof: supabase/tests/2746_company_in_own_org.test.sql
-- Rollback: rollback/2746_company_in_own_organisation_down.sql

create function public.guard_company_in_own_organisation() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if not exists (select 1 from public.companies c where c.id = v_id and c.org_id = new.org_id) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  return new;
end $$;
revoke all on function public.guard_company_in_own_organisation() from public, anon, authenticated;

create trigger zzzzz_company_in_own_org_ins before insert on public.projects
  for each row when (new.client_id is not null) execute function public.guard_company_in_own_organisation('client_id');
create trigger zzzzz_company_in_own_org_upd before update of client_id on public.projects
  for each row when (new.client_id is not null and new.client_id is distinct from old.client_id)
  execute function public.guard_company_in_own_organisation('client_id');

create trigger zzzzz_company_in_own_org_ins before insert on public.sales_invoices
  for each row when (new.customer_id is not null) execute function public.guard_company_in_own_organisation('customer_id');
create trigger zzzzz_company_in_own_org_upd before update of customer_id on public.sales_invoices
  for each row when (new.customer_id is not null and new.customer_id is distinct from old.customer_id)
  execute function public.guard_company_in_own_organisation('customer_id');

create trigger zzzzz_company_in_own_org_ins before insert on public.incoming_payments
  for each row when (new.customer_id is not null) execute function public.guard_company_in_own_organisation('customer_id');
create trigger zzzzz_company_in_own_org_upd before update of customer_id on public.incoming_payments
  for each row when (new.customer_id is not null and new.customer_id is distinct from old.customer_id)
  execute function public.guard_company_in_own_organisation('customer_id');

create trigger zzzzz_company_in_own_org_ins before insert on public.crm_activities
  for each row when (new.company_id is not null) execute function public.guard_company_in_own_organisation('company_id');
create trigger zzzzz_company_in_own_org_upd before update of company_id on public.crm_activities
  for each row when (new.company_id is not null and new.company_id is distinct from old.company_id)
  execute function public.guard_company_in_own_organisation('company_id');
