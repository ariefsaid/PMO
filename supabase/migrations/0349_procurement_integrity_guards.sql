-- Preserve the server-approved spend ceiling, protect procurement evidence writes, and bind file rows to storage keys.

alter table public.procurements add column approved_total_value numeric(14,2);
update public.procurements p
   set approved_total_value = coalesce((
     select (a.detail->>'request_amount')::numeric
       from public.audit_events a
      where a.action = 'procurement.approval_route' and a.entity_id = p.id
      order by a.created_at desc limit 1
   ), public.procurement_request_amount(p.id))
 where p.status in ('Approved','Vendor Quoted','Quote Selected','Ordered','Received','Vendor Invoiced','Paid')
   and p.approved_by_id is not null;
update public.record_history_config
   set omit_cols = array_append(omit_cols, 'approved_total_value')
 where table_name = 'procurements' and not ('approved_total_value' = any (omit_cols));
comment on column public.procurements.approved_total_value is
  'Server-stamped amount used for the latest approval decision; clients cannot write this value.';

create or replace function public.procurement_payment_within_ceiling(p_procurement_id uuid)
returns table(ok boolean, reason text, billed_net numeric)
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_currency text; v_ceiling numeric; v_net numeric; v_count integer;
begin
  select p.currency, p.approved_total_value into v_currency, v_ceiling
    from public.procurements p where p.id = p_procurement_id;
  if not found then return query select false, 'procurement not found', 0::numeric; return; end if;
  if v_ceiling is null then return query select false, 'approved amount is missing', 0::numeric; return; end if;
  if exists (select 1 from public.procurement_invoices i where i.procurement_id = p_procurement_id
      and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
      and i.currency is not null and i.currency <> v_currency) then
    return query select false, 'bill currency differs from procurement currency', 0::numeric; return;
  end if;
  select coalesce(sum(case when i.tax_treatment = 'exclusive' then i.amount
                           when i.tax_treatment = 'inclusive' then i.amount - i.tax_amount
                           else i.amount end), 0), count(*)
    into v_net, v_count from public.procurement_invoices i
   where i.procurement_id = p_procurement_id
     and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
     and not exists (select 1 from public.procurement_invoices replacement
                      where replacement.erp_amended_from = i.external_ref
                        and coalesce(replacement.erp_docstatus, 1) <> 2
                        and replacement.erp_cancelled_at is null);
  if v_count = 0 then v_net := (select total_value from public.procurements where id=p_procurement_id); end if;
  return query select v_net <= v_ceiling, case when v_net <= v_ceiling then null else 'vendor bill exceeds approved amount' end, v_net;
end; $$;
revoke all on function public.procurement_payment_within_ceiling(uuid) from public, anon, authenticated;
grant execute on function public.procurement_payment_within_ceiling(uuid) to service_role;

create or replace function public.guard_procurement_approved_total() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_op = 'UPDATE' and not public.actor_bypasses_rls()
     and new.approved_total_value is distinct from old.approved_total_value then
    raise exception 'Approved amount is server managed.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status = 'Requested' and new.status = 'Approved' then
    if exists (
      select 1 from public.procurement_status_events e
       where e.procurement_id = old.id and e.from_status = 'Vendor Quoted'::procurement_status
         and e.to_status = 'Requested'::procurement_status and e.actor_id = auth.uid()
    ) then
      raise exception 'separation of duties: quote selector cannot approve the revised amount' using errcode = '42501';
    end if;
    new.approved_total_value := public.procurement_request_amount(new.id);
  elsif tg_op = 'UPDATE' and old.status = 'Vendor Quoted' and new.status = 'Quote Selected'
        and new.total_value > old.approved_total_value then
    -- The selected quote is retained, but the old decision is invalid. The normal
    -- Requested -> Approved transition re-runs spend_approval_route on this amount.
    new.status := 'Requested';
    new.approved_by_id := null;
    new.approved_total_value := null;
  elsif tg_op = 'UPDATE' and new.status = 'Paid'
        and old.approved_total_value is null and old.approved_by_id is not null then
    raise exception 'Cannot pay without a recorded approved amount.' using errcode = '23514';
  elsif tg_op = 'UPDATE' and new.status = 'Paid' and old.approved_total_value is not null then
    if not (select ok from public.procurement_payment_within_ceiling(old.id)) then
      raise exception 'Vendor bill exceeds the approved amount or its currency differs; obtain approval or correct the bill before payment.' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.guard_procurement_approved_total() from public, anon, authenticated;
create trigger procurements_approved_total_guard
before update of status, approved_total_value, total_value on public.procurements
for each row execute function public.guard_procurement_approved_total();

create or replace function public.log_procurement_quote_reroute() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if old.status = 'Vendor Quoted' and new.status = 'Requested' then
    insert into public.procurement_status_events
      (procurement_id, org_id, from_status, to_status, actor_id, notes)
    values (new.id, new.org_id, old.status, new.status, auth.uid(), 'Selected quote exceeded the approved amount; approval required again.');
  end if;
  return new;
end; $$;
revoke all on function public.log_procurement_quote_reroute() from public, anon, authenticated;
create trigger procurements_quote_reroute_event
 after update of status on public.procurements
 for each row execute function public.log_procurement_quote_reroute();

-- File metadata has a narrow client edit surface; storage keys remain immutable after insert.
do $$
declare t text;
begin
  foreach t in array array['procurement_quotation_files','procurement_receipt_files','procurement_invoice_files','purchase_request_files','rfq_files','purchase_order_files','payment_files'] loop
    execute format('revoke update on public.%I from authenticated, anon', t);
    execute format('grant update (title, archived_at) on public.%I to authenticated', t);
  end loop;
end $$;

-- The upload path remains unique per upload; all storage mutations by ordinary writers are inserts only.
drop policy if exists storage_objects_proc_file_write on storage.objects;
create policy storage_objects_proc_file_insert on storage.objects for insert
with check (
  bucket_id = 'procurement-files' and auth.uid() is not null
  and split_part(name, '/', 1) = auth_org_id()::text
  and array_length(string_to_array(name, '/'), 1) = 5
  and auth_role() in ('Admin','Executive','Project Manager','Finance')
  and exists (select 1 from public.procurements p
    where p.id::text = split_part(name, '/', 2) and p.org_id = auth_org_id())
);
create policy storage_objects_proc_file_delete on storage.objects for delete
using (
  bucket_id = 'procurement-files' and auth.uid() is not null
  and split_part(name, '/', 1) = auth_org_id()::text
  and auth_role() = 'Admin'
  and not exists (
    select 1 from public.procurement_quotation_files f where f.file_path = name
    union all select 1 from public.procurement_receipt_files f where f.file_path = name
    union all select 1 from public.procurement_invoice_files f where f.file_path = name
    union all select 1 from public.purchase_request_files f where f.file_path = name
    union all select 1 from public.rfq_files f where f.file_path = name
    union all select 1 from public.purchase_order_files f where f.file_path = name
    union all select 1 from public.payment_files f where f.file_path = name
  )
);

create or replace function public.guard_procurement_file_path() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
declare
  v_parent uuid;
  v_org uuid;
  v_proc uuid;
begin
  v_parent := (to_jsonb(new)->>tg_argv[0])::uuid;
  execute format('select org_id, procurement_id from public.%I where id = $1', tg_argv[1])
    into v_org, v_proc using v_parent;
  -- Keep the established RLS denial authoritative for unauthorized callers.
  if not public.actor_bypasses_rls() and (
       v_org is distinct from public.auth_org_id()
       or new.org_id is distinct from public.auth_org_id()
       or coalesce(public.auth_role() not in ('Admin','Executive','Project Manager','Finance'), true)
     ) then return new; end if;
  if tg_op = 'UPDATE' and new.file_path is distinct from old.file_path and not public.actor_bypasses_rls() then
    raise exception 'Procurement file storage key cannot be changed.' using errcode = '42501';
  end if;
  if new.file_path is null then return new; end if;
  if v_org is null or new.org_id is distinct from v_org
     or split_part(new.file_path, '/', 1) is distinct from v_org::text
     or split_part(new.file_path, '/', 2) is distinct from v_proc::text
     or split_part(new.file_path, '/', 3) is distinct from tg_argv[2]
     or array_length(string_to_array(new.file_path, '/'), 1) <> 5 then
    raise exception 'Procurement file storage key does not match its record.' using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.guard_procurement_file_path() from public, anon, authenticated;
create trigger zz_procurement_quotation_file_path_guard before insert or update of file_path, quotation_id, org_id on public.procurement_quotation_files for each row execute function public.guard_procurement_file_path('quotation_id','procurement_quotations','quotation');
create trigger zz_procurement_receipt_file_path_guard before insert or update of file_path, receipt_id, org_id on public.procurement_receipt_files for each row execute function public.guard_procurement_file_path('receipt_id','procurement_receipts','receipt');
create trigger zz_procurement_invoice_file_path_guard before insert or update of file_path, invoice_id, org_id on public.procurement_invoice_files for each row execute function public.guard_procurement_file_path('invoice_id','procurement_invoices','invoice');
create trigger zz_purchase_request_file_path_guard before insert or update of file_path, purchase_request_id, org_id on public.purchase_request_files for each row execute function public.guard_procurement_file_path('purchase_request_id','purchase_requests','purchase_request');
create trigger zz_rfq_file_path_guard before insert or update of file_path, rfq_id, org_id on public.rfq_files for each row execute function public.guard_procurement_file_path('rfq_id','rfqs','rfq');
create trigger zz_purchase_order_file_path_guard before insert or update of file_path, purchase_order_id, org_id on public.purchase_order_files for each row execute function public.guard_procurement_file_path('purchase_order_id','purchase_orders','purchase_order');
create trigger zz_payment_file_path_guard before insert or update of file_path, payment_id, org_id on public.payment_files for each row execute function public.guard_procurement_file_path('payment_id','payments','payment');
