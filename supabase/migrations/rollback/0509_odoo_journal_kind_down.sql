-- Reverses 0509_odoo_journal_kind.sql: the kind list returns to the ten O1 kinds; the setter goes.
-- Journal rows already mirrored are removed first (the constraint could not be restored otherwise); the sweep refills them
-- if the migration is re-applied. A default journal stored in a binding's config stays (data), unused.
delete from public.external_master_records where kind = 'journal';
delete from public.external_sync_watermarks where domain = 'master:journal';
alter table public.external_master_records drop constraint external_master_records_kind_check;
alter table public.external_master_records add constraint external_master_records_kind_check
  check (kind in ('company','partner','product','uom','warehouse','location','account','tax','analytic_plan','analytic_account'));
create or replace function public.assert_odoo_master_kind(p_kind text) returns void
language plpgsql immutable set search_path = public as $$
begin
  if p_kind is null or p_kind not in ('company','partner','product','uom','warehouse','location',
                                      'account','tax','analytic_plan','analytic_account') then
    raise exception 'unknown Odoo kind' using errcode = '22023';
  end if;
end $$;
drop function if exists public.set_odoo_payment_journal_default(uuid,uuid,text);
