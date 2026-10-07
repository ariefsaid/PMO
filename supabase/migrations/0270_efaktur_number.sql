-- #893 / DD-EFK-1: e-Faktur references are PMO-owned facts. They are not ERP ledger fields and
-- mirror writers must leave them untouched. Client writes go only through the two role/org-guarded RPCs.
-- Reversal: supabase/migrations/rollback/0270_efaktur_number_down.sql.
--
-- DD-EFK-2: both or neither. A number without its date falls out of the monthly VAT register, so the pair
-- is held together by the table (any writer) and refused with a stable DETAIL by the setters (UI copy).
--
-- "Date not in the future" is checked in the RPCs against the org-local today, not as a table CHECK:
-- a CHECK on the date would be a time-dependent schema constraint.
alter table public.sales_invoices
  add column efaktur_number text,
  add column efaktur_date date,
  add constraint sales_invoices_efaktur_number_check check (
    efaktur_number is null or (
      efaktur_number = btrim(efaktur_number)
      and char_length(efaktur_number) between 1 and 32
      and efaktur_number ~ '^[0-9.-]+$'
    )
  );

alter table public.procurement_invoices
  add column efaktur_number text,
  add column efaktur_date date,
  add constraint procurement_invoices_efaktur_number_check check (
    efaktur_number is null or (
      efaktur_number = btrim(efaktur_number)
      and char_length(efaktur_number) between 1 and 32
      and efaktur_number ~ '^[0-9.-]+$'
    )
  );

alter table public.sales_invoices
  add constraint sales_invoices_efaktur_complete_check
    check ((efaktur_number is null) = (efaktur_date is null));
alter table public.procurement_invoices
  add constraint procurement_invoices_efaktur_complete_check
    check ((efaktur_number is null) = (efaktur_date is null));

comment on column public.sales_invoices.efaktur_number is 'PMO-owned e-Faktur reference; never synchronized to ERPNext (DD-EFK-1).';
comment on column public.sales_invoices.efaktur_date is 'PMO-owned e-Faktur date; never synchronized to ERPNext (DD-EFK-1).';
comment on column public.procurement_invoices.efaktur_number is 'PMO-owned supplier e-Faktur reference; never synchronized to ERPNext (DD-EFK-1).';
comment on column public.procurement_invoices.efaktur_date is 'PMO-owned supplier e-Faktur date; never synchronized to ERPNext (DD-EFK-1).';

-- Direct writes: `authenticated`/`anon` hold NO UPDATE grant on either table (0175, 0176), so the two
-- setters below are the only client write path. The service-role ERP mirror writers never name these
-- columns (readModelWriters.ts / erpnextFeedDeps.ts), so a mirror refresh leaves them untouched.

create or replace function public.set_sales_invoice_efaktur(
  p_si_id uuid,
  p_efaktur_number text,
  p_efaktur_date date
)
returns public.sales_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sales_invoices;
  v_number text := nullif(btrim(p_efaktur_number), '');
begin
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin', 'Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_row.status = 'Cancelled' then
    raise exception 'cannot record e-Faktur facts on a cancelled sales invoice'
      using errcode = '23514', detail = 'efaktur-cancelled';
  end if;
  if (v_number is null) <> (p_efaktur_date is null) then
    raise exception 'an e-Faktur number and its date must be recorded together'
      using errcode = '23514', detail = 'efaktur-incomplete';
  end if;
  if v_number is not null and (char_length(v_number) > 32 or v_number !~ '^[0-9.-]+$') then
    raise exception 'invalid e-Faktur number' using errcode = '23514';
  end if;
  -- "Future" on the ORG's calendar (the 0247 pattern), not the session's: current_date would refuse
  -- an Asia/Jakarta morning's own date until 07:00 local.
  if p_efaktur_date is not null and p_efaktur_date > (now() at time zone coalesce(
       (select o.default_timezone from public.organizations o where o.id = v_row.org_id), 'UTC'))::date then
    raise exception 'e-Faktur date cannot be in the future'
      using errcode = '23514', detail = 'efaktur-future-date';
  end if;
  update public.sales_invoices
     set efaktur_number = v_number, efaktur_date = p_efaktur_date
   where id = p_si_id
   returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.set_procurement_invoice_efaktur(
  p_invoice_id uuid,
  p_efaktur_number text,
  p_efaktur_date date
)
returns public.procurement_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.procurement_invoices;
  v_number text := nullif(btrim(p_efaktur_number), '');
begin
  select * into v_row from public.procurement_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'vendor bill not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin', 'Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_row.erp_docstatus = 2 or v_row.erp_cancelled_at is not null then
    raise exception 'cannot record e-Faktur facts on a cancelled vendor bill'
      using errcode = '23514', detail = 'efaktur-cancelled';
  end if;
  if (v_number is null) <> (p_efaktur_date is null) then
    raise exception 'an e-Faktur number and its date must be recorded together'
      using errcode = '23514', detail = 'efaktur-incomplete';
  end if;
  if v_number is not null and (char_length(v_number) > 32 or v_number !~ '^[0-9.-]+$') then
    raise exception 'invalid e-Faktur number' using errcode = '23514';
  end if;
  -- "Future" on the ORG's calendar (the 0247 pattern), not the session's: current_date would refuse
  -- an Asia/Jakarta morning's own date until 07:00 local.
  if p_efaktur_date is not null and p_efaktur_date > (now() at time zone coalesce(
       (select o.default_timezone from public.organizations o where o.id = v_row.org_id), 'UTC'))::date then
    raise exception 'e-Faktur date cannot be in the future'
      using errcode = '23514', detail = 'efaktur-future-date';
  end if;
  update public.procurement_invoices
     set efaktur_number = v_number, efaktur_date = p_efaktur_date
   where id = p_invoice_id
   returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_sales_invoice_efaktur(uuid, text, date) from public, anon;
revoke all on function public.set_procurement_invoice_efaktur(uuid, text, date) from public, anon;
grant execute on function public.set_sales_invoice_efaktur(uuid, text, date) to authenticated;
grant execute on function public.set_procurement_invoice_efaktur(uuid, text, date) to authenticated;

comment on function public.set_sales_invoice_efaktur(uuid, text, date) is
  'DD-EFK-1/2: Admin/Finance records PMO-owned e-Faktur facts (number and date together) for any non-cancelled sales invoice.';
comment on function public.set_procurement_invoice_efaktur(uuid, text, date) is
  'DD-EFK-1/2: Admin/Finance records PMO-owned supplier e-Faktur facts (number and date together) for any non-cancelled vendor bill.';

-- ACL invariant: neither PUBLIC nor anon may execute any new function from this migration.
do $$
declare
  v_forbidden text;
begin
  select p.proname into v_forbidden
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where n.nspname = 'public'
     and p.proname in (
       'set_sales_invoice_efaktur',
       'set_procurement_invoice_efaktur'
     )
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole)
   limit 1;
  if v_forbidden is not null then
    raise exception 'forbidden EXECUTE grant remains on %', v_forbidden;
  end if;
end;
$$;
