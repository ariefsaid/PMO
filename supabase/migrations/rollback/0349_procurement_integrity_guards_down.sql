-- Reverse 0349. Function bodies restored verbatim from 0348 (document guard), 0243 §9 (notification)
-- and 0180 (create_payment).

-- §8 document guard -> 0348
create or replace function public.guard_project_document_metadata_author() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if public.actor_bypasses_rls() then return new; end if;
  if (new.title is distinct from old.title
      or new.category is distinct from old.category
      or new.code is distinct from old.code
      or new.doc_date is distinct from old.doc_date
      or new.revision is distinct from old.revision
      or new.project_id is distinct from old.project_id)
     and old.author_id is distinct from auth.uid()
     and public.auth_role() is distinct from 'Admin' then
    raise exception 'Document metadata edit is not permitted.' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.guard_project_document_metadata_author() from public, anon, authenticated;
drop trigger if exists project_document_metadata_author_guard on public.project_documents;
create trigger project_document_metadata_author_guard
  before update of title, category, code, doc_date, revision, project_id on public.project_documents
  for each row execute function public.guard_project_document_metadata_author();

-- §7 file rows: restore the pre-0349 table-wide update grants and storage policy.
drop trigger if exists zz_payment_file_path_guard on public.payment_files;
drop trigger if exists zz_purchase_order_file_path_guard on public.purchase_order_files;
drop trigger if exists zz_rfq_file_path_guard on public.rfq_files;
drop trigger if exists zz_purchase_request_file_path_guard on public.purchase_request_files;
drop trigger if exists zz_procurement_invoice_file_path_guard on public.procurement_invoice_files;
drop trigger if exists zz_procurement_receipt_file_path_guard on public.procurement_receipt_files;
drop trigger if exists zz_procurement_quotation_file_path_guard on public.procurement_quotation_files;
drop function if exists public.guard_procurement_file_path();
do $$
declare t text;
begin
  foreach t in array array['procurement_quotation_files','procurement_receipt_files','procurement_invoice_files','purchase_request_files','rfq_files','purchase_order_files','payment_files'] loop
    execute format('revoke update (title, archived_at) on public.%I from authenticated', t);
    execute format('grant update on public.%I to authenticated, anon', t);
  end loop;
end $$;
drop policy if exists storage_objects_proc_file_insert on storage.objects;
drop policy if exists storage_objects_proc_file_delete on storage.objects;
create policy storage_objects_proc_file_write on storage.objects for all
using (
 bucket_id='procurement-files' and auth.uid() is not null
 and split_part(name,'/',1)=auth_org_id()::text and array_length(string_to_array(name,'/'),1)=5
 and auth_role() in ('Admin','Executive','Project Manager','Finance')
 and exists(select 1 from public.procurements p where p.id::text=split_part(name,'/',2) and p.org_id=auth_org_id())
)
with check (
 bucket_id='procurement-files' and auth.uid() is not null
 and split_part(name,'/',1)=auth_org_id()::text and array_length(string_to_array(name,'/'),1)=5
 and auth_role() in ('Admin','Executive','Project Manager','Finance')
 and exists(select 1 from public.procurements p where p.id::text=split_part(name,'/',2) and p.org_id=auth_org_id())
);

-- §6 create_payment -> 0180
create or replace function public.create_payment(
  p_procurement_id uuid, p_invoice_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns payments language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.payments;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Same-case invariant (0039, AC-PR-SEC-001 / FR-ENA-130d): invoice must belong to the same case.
  if p_invoice_id is not null and not exists (
    select 1 from public.procurement_invoices i
    where i.id = p_invoice_id and i.procurement_id = p_procurement_id
  ) then raise exception 'invoice not in this case' using errcode = '42501'; end if;
  -- Slice 6 addition (AC-ENA-072): a flipped org's payment writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — payments route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  -- ⚑ 0178: the origination-status gate. NULL is ACCEPTED on purpose (it is the permissive-capture
  -- default, sent by procurementRecords.ts and by four assertions in 0079) and the explicit
  -- `is not null` keeps the condition TOTAL — `p_status <> 'Scheduled'` alone is NULL for a NULL
  -- p_status and would fall through, which is 0176 §6's defect exactly.
  if p_status is not null and p_status <> 'Scheduled' then
    raise exception
      'payments.status "%" is not an origination status: a payment record is captured as Scheduled, and Paid is reached only by paying the case — the transition that is Finance-only and enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  insert into public.payments
    (procurement_id, invoice_id, pay_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_invoice_id, next_procurement_doc_number(v_org, 'PAY'),
            p_reference_number, coalesce(p_status, 'Scheduled'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;

-- §5 notification -> 0243 §9
create or replace function public.notify_procurement_transition() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
        v_route record;                                                                    -- 0243
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'Requested' and old.status = 'Draft' then
    select * into v_route                                                                  -- 0243
      from public.spend_approval_route(new.org_id, new.project_id, new.budget_category,   -- 0243
             public.procurement_request_amount(new.id), new.currency, new.requested_by_id); -- 0243
    -- Approver population = transition_procurement's Requested→Approved/Rejected arm (OD-PROC-1) minus the requester (SoD-a).
    -- ⚑ MIRRORS the role list in public.transition_procurement (0180 — Admin short-circuits its role check;
    -- Project Manager/Finance/Executive are its v_allowed_roles). A change there MUST change this list too.
    for r in select p.id from public.profiles p
              where p.org_id = new.org_id
                and p.id is distinct from new.requested_by_id
                and case coalesce(v_route.route, 'admin')                                  -- 0243
                      when 'flat'  then p.role in ('Admin','Project Manager','Finance','Executive') -- 0243
                      when 'admin' then p.role = 'Admin'                                   -- 0243
                      else p.id = any (v_route.approver_ids)                               -- 0243
                    end                                                                    -- 0243
    loop
      perform public.notify_workflow_user(new.org_id, r.id, 'Procurement awaiting your approval',
        new.title, 'info', 'procurement_case', new.id, new.title);
    end loop;
  elsif old.status = 'Requested' and new.status = 'Approved' then
    perform public.notify_workflow_user(new.org_id, new.requested_by_id, 'Your procurement was approved',
      coalesce(nullif(btrim(new.approval_notes), ''), new.title), 'info', 'procurement_case', new.id, new.title);
  elsif old.status = 'Requested' and new.status = 'Rejected' then
    perform public.notify_workflow_user(new.org_id, new.requested_by_id, 'Your procurement was rejected',
      coalesce(nullif(btrim(new.rejection_notes), ''), new.title), 'warning', 'procurement_case', new.id, new.title);
  end if;
  return new;
end; $$;

-- §4 / §3 / §2 / §1
drop function if exists public.approve_procurement_amount(uuid, numeric);
comment on function public.select_procurement_quote(uuid) is null;
drop trigger if exists procurements_quote_reroute_event on public.procurements;
drop function if exists public.log_procurement_quote_reroute();
drop trigger if exists procurements_approved_total_guard on public.procurements;
drop function if exists public.guard_procurement_approved_total();
drop function if exists public.procurement_payment_within_ceiling(uuid);
drop function if exists public.backfill_procurement_approved_total();
update public.record_history_config
   set omit_cols = array_remove(array_remove(omit_cols, 'approved_total_value'), 'amount_approved_by_id')
 where table_name = 'procurements';
alter table public.procurements drop column if exists amount_approved_by_id;
alter table public.procurements drop column if exists approved_total_value;
