-- 0255_project_vat_flag_lock_case.sql — #858 item 4: the 0253 VAT-flag lock must not depend on how the project id is spelled
-- in the outbox payload; compare lower() on both sides (as the 0250 withdraw check does). Body otherwise identical to 0253.
-- Proven by supabase/tests/0255_project_vat_flag_lock_case.test.sql. Rollback: rollback/0255_project_vat_flag_lock_case_down.sql.
create or replace function public.guard_project_vat_flag_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.sales_invoices where project_id = new.id)
     or exists (select 1 from public.external_command_outbox o
                 where o.org_id = new.org_id and o.domain = 'revenue' and o.operation = 'create'
                   and o.payload->>'erp_doc_kind' = 'sales-invoice' and lower(o.payload->>'projectId') = lower(new.id::text)
                   and o.state not in ('confirmed','failed')) then
    raise exception 'whether this project is subject to VAT is locked once the project has an invoice'
      using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.guard_project_vat_flag_lock() from public, anon, authenticated;
