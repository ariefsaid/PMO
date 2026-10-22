-- Preserve the server-approved spend ceiling, protect procurement evidence writes, and bind file rows to storage keys.
-- Rollback: supabase/migrations/rollback/0349_procurement_integrity_guards_down.sql

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the approved amount and who approved a later, higher amount (both server-stamped).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.procurements
  add column approved_total_value numeric(14,2),
  add column amount_approved_by_id uuid references public.profiles(id);
update public.record_history_config
   set omit_cols = array_append(omit_cols, 'approved_total_value')
 where table_name = 'procurements' and not ('approved_total_value' = any (omit_cols));
update public.record_history_config
   set omit_cols = array_append(omit_cols, 'amount_approved_by_id')
 where table_name = 'procurements' and not ('amount_approved_by_id' = any (omit_cols));
comment on column public.procurements.approved_total_value is
  'Server-stamped pre-tax amount of the latest approval decision; clients cannot write this value.';
comment on column public.procurements.amount_approved_by_id is
  'Server-stamped approver of an amount raised after billing (approve_procurement_amount); may not pay the procurement.';

-- The approved amount of an already-approved request is the amount its approval was routed on (the
-- audited request_amount of its latest approval), not the current total, which may have moved since.
-- Only rows without such an audit fall back to the current request amount. Re-runnable; the seed calls it.
create or replace function public.backfill_procurement_approved_total() returns void
  language sql security invoker set search_path = public, pg_catalog as $$
  update public.procurements p
     set approved_total_value = coalesce((
       select (a.detail->>'request_amount')::numeric
         from public.audit_events a
        where a.action = 'procurement.approval_route' and a.entity_id = p.id
          and a.detail->>'to' = 'Approved' and a.detail->>'request_amount' is not null
        order by a.created_at desc, a.id desc limit 1
     ), public.procurement_request_amount(p.id))
   where p.status in ('Approved','Vendor Quoted','Quote Selected','Ordered','Received','Vendor Invoiced','Paid')
     and p.approved_by_id is not null
     and p.approved_total_value is null;
$$;
revoke all on function public.backfill_procurement_approved_total() from public, anon, authenticated;
select public.backfill_procurement_approved_total();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — the ONE payment ceiling. Used by the Paid transition guard, the ERP payment dispatch gate and
-- the procurement screen. Compares like with like: the pre-tax billed amount of LIVE bills against the
-- pre-tax approved amount.
--   • Bill net: 'exclusive' rows store the pre-tax amount; 'inclusive' rows (every ERP-mirrored bill,
--     whose amount is the gross bill) store the gross with VAT in tax_amount, so net = amount − tax_amount.
--   • Live: not cancelled (erp_docstatus 2 / erp_cancelled_at) and not superseded by an amendment
--     (another live bill whose erp_amended_from names this bill's ERP document, vi_number).
--   • Currency: a bill in another currency is refused; amounts are never converted.
--   • No approved amount recorded: refused (a guard that cannot evaluate must refuse).
-- Client callers see only their own organization's procurements (no row otherwise).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.procurement_payment_within_ceiling(p_procurement_id uuid)
returns table(ok boolean, reason text, billed_net numeric, approved_amount numeric)
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid; v_currency text; v_ceiling numeric; v_total numeric; v_net numeric; v_count integer;
begin
  select p.org_id, p.currency, p.approved_total_value, p.total_value
    into v_org, v_currency, v_ceiling, v_total
    from public.procurements p where p.id = p_procurement_id;
  if not found then return; end if;
  if auth.uid() is not null
     and (v_org is distinct from public.auth_org_id() or not public.is_active_member()) then
    return;
  end if;
  if exists (select 1 from public.procurement_invoices i
              where i.procurement_id = p_procurement_id
                and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
                and i.currency is distinct from v_currency) then
    return query select false, 'bill currency differs from procurement currency', null::numeric, v_ceiling;
    return;
  end if;
  select coalesce(sum(case when i.tax_treatment = 'inclusive' then i.amount - i.tax_amount else i.amount end), 0),
         count(*)
    into v_net, v_count
    from public.procurement_invoices i
   where i.procurement_id = p_procurement_id
     and i.amount is not null
     and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
     and not (i.vi_number is not null and exists (
       select 1 from public.procurement_invoices successor
        where successor.procurement_id = i.procurement_id
          and successor.erp_amended_from = i.vi_number
          and coalesce(successor.erp_docstatus, 1) <> 2 and successor.erp_cancelled_at is null));
  if v_count = 0 then v_net := v_total; end if;
  if v_ceiling is null then
    return query select false, 'approved amount is missing', v_net, null::numeric;
    return;
  end if;
  return query select v_net <= v_ceiling,
                      case when v_net <= v_ceiling then null else 'vendor bill exceeds approved amount' end,
                      v_net, v_ceiling;
end; $$;
revoke all on function public.procurement_payment_within_ceiling(uuid) from public, anon;
grant execute on function public.procurement_payment_within_ceiling(uuid) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — the procurement guard: client writes refused, approval stamps, quote re-route, payment ceiling.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.guard_procurement_approved_total() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_op = 'UPDATE' and not public.actor_bypasses_rls()
     and (new.approved_total_value is distinct from old.approved_total_value
          or new.amount_approved_by_id is distinct from old.amount_approved_by_id) then
    raise exception 'Approved amount is server managed.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status = 'Requested' and new.status = 'Approved' then
    -- The actor whose quote selection returned the request for approval may not approve it.
    -- Enforced here (not in an RPC branch) so no path and no role, Admin included, skips it.
    if auth.uid() is not null and auth.uid() = (
      select e.actor_id from public.procurement_status_events e
       where e.procurement_id = old.id and e.from_status = 'Vendor Quoted'::procurement_status
         and e.to_status = 'Requested'::procurement_status
       order by e.created_at desc, e.id desc limit 1
    ) then
      raise exception 'separation of duties: quote selector cannot approve the revised amount' using errcode = '42501';
    end if;
    new.approved_total_value := public.procurement_request_amount(new.id);
    new.amount_approved_by_id := null;
  elsif tg_op = 'UPDATE' and old.status = 'Vendor Quoted' and new.status = 'Quote Selected'
        and new.total_value > old.approved_total_value then
    -- The selected quote is retained, but the old decision is invalid. The normal
    -- Requested -> Approved transition re-runs spend_approval_route on this amount.
    new.status := 'Requested';
    new.approved_by_id := null;
    new.approved_total_value := null;
    new.amount_approved_by_id := null;
  elsif tg_op = 'UPDATE' and new.status = 'Paid' and old.status is distinct from 'Paid' then
    if old.approved_total_value is null then
      raise exception 'Cannot pay without a recorded approved amount.' using errcode = '23514';
    end if;
    -- Whoever approved a raised amount may not also pay it (the approver-is-not-payer rule).
    if auth.uid() is not null and auth.uid() = old.amount_approved_by_id then
      raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
    end if;
    if not coalesce((select c.ok from public.procurement_payment_within_ceiling(old.id) c), false) then
      raise exception 'Vendor bill exceeds the approved amount or its currency differs; obtain approval or correct the bill before payment.' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.guard_procurement_approved_total() from public, anon, authenticated;
create trigger procurements_approved_total_guard
before update of status, approved_total_value, amount_approved_by_id, total_value on public.procurements
for each row execute function public.guard_procurement_approved_total();

-- The quote re-route is recorded as a Vendor Quoted -> Requested status event whose actor is the selector.
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

comment on function public.select_procurement_quote(uuid) is
  'Runs with owner rights (SECURITY DEFINER, RLS-bypassing owner), so its header update passes the '
  'routing-input freeze; when the selected quote exceeds the approved amount, '
  'guard_procurement_approved_total returns the request to Requested for a fresh routed approval.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — approving a higher billed amount. Eligibility is the existing Requested -> Approved rule: the
-- same role set and the same spend_approval_route decision (Admin break-glass audited). The routed
-- amount is the increase over what this request already counts on its budget line, because the line's
-- used figure already includes this request (at Requested -> Approved it is excluded by status).
-- Separation of duties (no Admin exemption): not the requester, not the actor of the latest quote
-- re-route, not anyone who recorded a bill on it or moved it to Vendor Invoiced.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.approve_procurement_amount(p_procurement_id uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_uid      uuid := auth.uid();
  v_role     public.user_role := public.auth_role();
  v_is_admin boolean;
  v_row      public.procurements%rowtype;
  v_ceiling  record;
  v_routed   numeric;
  v_route    record;
begin
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');
  select * into v_row from public.procurements where id = p_procurement_id for update;
  if not found then
    raise exception 'procurement not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_row.status is distinct from 'Vendor Invoiced' then
    raise exception 'a higher amount can be approved only while the procurement awaits payment' using errcode = 'P0001';
  end if;

  if v_uid = v_row.requested_by_id then
    raise exception 'separation of duties: requester cannot approve the procurement amount' using errcode = '42501';
  end if;
  if v_uid = (select e.actor_id from public.procurement_status_events e
               where e.procurement_id = p_procurement_id and e.from_status = 'Vendor Quoted'::procurement_status
                 and e.to_status = 'Requested'::procurement_status
               order by e.created_at desc, e.id desc limit 1) then
    raise exception 'separation of duties: quote selector cannot approve the revised amount' using errcode = '42501';
  end if;
  if exists (select 1 from public.record_changes rc
               join public.procurement_invoices i on i.id = rc.entity_id
              where rc.org_id = v_row.org_id and rc.entity_type = 'procurement_invoice' and rc.op = 'insert'
                and i.procurement_id = p_procurement_id and rc.actor_id = v_uid)
     or exists (select 1 from public.procurement_status_events e
                 where e.procurement_id = p_procurement_id
                   and e.to_status = 'Vendor Invoiced'::procurement_status and e.actor_id = v_uid) then
    raise exception 'separation of duties: the bill recorder cannot approve the billed amount' using errcode = '42501';
  end if;
  if not v_is_admin and not (v_role::text = any (array['Project Manager','Finance','Executive'])) then
    raise exception 'not authorized to approve a procurement amount' using errcode = '42501';
  end if;

  select * into v_ceiling from public.procurement_payment_within_ceiling(p_procurement_id);
  if v_ceiling.reason = 'bill currency differs from procurement currency' then
    raise exception 'bill currency differs from procurement currency' using errcode = '23514';
  end if;
  if p_amount is null or not (p_amount < 'Infinity'::numeric) or p_amount < coalesce(v_ceiling.billed_net, 0) then
    raise exception 'the approved amount cannot be below the billed amount' using errcode = '23514';
  end if;
  if v_row.approved_total_value is not null and p_amount <= v_row.approved_total_value then
    raise exception 'the amount is already approved' using errcode = 'P0001';
  end if;

  if v_row.project_id is not null and v_row.budget_category is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('spend-line:' || v_row.project_id::text || ':' || v_row.budget_category::text, 0));
  end if;
  v_routed := greatest(p_amount - coalesce(public.procurement_request_amount(p_procurement_id), 0), 0);
  select * into v_route
    from public.spend_approval_route(v_row.org_id, v_row.project_id, v_row.budget_category, v_routed,
           v_row.currency, v_row.requested_by_id, v_uid, public.procurement_submitted_at(p_procurement_id));
  if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
     and not coalesce(v_uid = any (v_route.approver_ids), false) then
    if v_route.route = 'admin' then
      raise exception 'approval routing: % requires an Admin (no senior approver is eligible)',
        v_route.reason using errcode = '42501';
    end if;
    raise exception 'approval routing: % requires a named approver',
      coalesce(v_route.reason, 'unknown') using errcode = '42501';
  end if;

  update public.procurements
     set approved_total_value = p_amount, amount_approved_by_id = v_uid, updated_at = now()
   where id = p_procurement_id;
  perform public.log_audit('procurement.amount_approved', v_row.org_id, v_uid, p_procurement_id,
    jsonb_build_object(
      'from', v_row.approved_total_value, 'to', p_amount, 'billed_net', v_ceiling.billed_net,
      'routed_amount', v_routed, 'route', v_route.route, 'reason', v_route.reason,
      'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                      and not coalesce(v_uid = any (v_route.approver_ids), false))));
end; $$;
revoke all on function public.approve_procurement_amount(uuid, numeric) from public, anon;
grant execute on function public.approve_procurement_amount(uuid, numeric) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — a quote that returns a request for approval notifies its approvers like a fresh submission.
-- 0243 §9's body (its `0243` line markers dropped) except the `0349` line.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.notify_procurement_transition() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
        v_route record;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'Requested' and old.status in ('Draft','Vendor Quoted') then              -- 0349
    select * into v_route
      from public.spend_approval_route(new.org_id, new.project_id, new.budget_category,
             public.procurement_request_amount(new.id), new.currency, new.requested_by_id);
    -- Approver population = transition_procurement's Requested→Approved/Rejected arm (OD-PROC-1) minus the requester (SoD-a).
    -- ⚑ MIRRORS the role list in public.transition_procurement (0180 — Admin short-circuits its role check;
    -- Project Manager/Finance/Executive are its v_allowed_roles). A change there MUST change this list too.
    for r in select p.id from public.profiles p
              where p.org_id = new.org_id
                and p.id is distinct from new.requested_by_id
                and case coalesce(v_route.route, 'admin')
                      when 'flat'  then p.role in ('Admin','Project Manager','Finance','Executive')
                      when 'admin' then p.role = 'Admin'
                      else p.id = any (v_route.approver_ids)
                    end
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — create_payment: 0180 verbatim plus the `0349` block. Once a live bill with an amount exists,
-- recorded payments (not cancelled) may not exceed the gross of live bills (amount, plus VAT where the
-- amount excludes it). Without a bill the amount stays unchecked here; payment then falls to the Paid
-- transition's ceiling.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.create_payment(
  p_procurement_id uuid, p_invoice_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns payments language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.payments;
        v_bill_gross numeric;                                                                -- 0349
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
  if p_amount is not null then                                                               -- 0349
    perform 1 from public.procurements where id = p_procurement_id for update;               -- 0349
    select sum(i.amount + case when i.tax_treatment = 'exclusive' then i.tax_amount else 0 end) -- 0349
      into v_bill_gross from public.procurement_invoices i                                   -- 0349
     where i.procurement_id = p_procurement_id and i.amount is not null                      -- 0349
       and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null;                 -- 0349
    if v_bill_gross is not null and p_amount + coalesce((                                    -- 0349
         select sum(pay.amount) from public.payments pay                                     -- 0349
          where pay.procurement_id = p_procurement_id                                        -- 0349
            and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null), 0)    -- 0349
         > v_bill_gross then                                                                 -- 0349
      raise exception 'scheduled payments cannot exceed the billed gross amount'             -- 0349
        using errcode = '23514';                                                             -- 0349
    end if;                                                                                  -- 0349
  end if;                                                                                    -- 0349
  insert into public.payments
    (procurement_id, invoice_id, pay_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_invoice_id, next_procurement_doc_number(v_org, 'PAY'),
            p_reference_number, coalesce(p_status, 'Scheduled'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — procurement evidence files. Clients edit only the title and archive stamp; the storage key is
-- fixed at insert and must match its owning record.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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
  -- A client never re-points an existing file row, whatever its role or the new key.
  if tg_op = 'UPDATE' and new.file_path is distinct from old.file_path and not public.actor_bypasses_rls() then
    raise exception 'Procurement file storage key cannot be changed.' using errcode = '42501';
  end if;
  v_parent := (to_jsonb(new)->>tg_argv[0])::uuid;
  execute format('select org_id, procurement_id from public.%I where id = $1', tg_argv[1])
    into v_org, v_proc using v_parent;
  -- Keep the established RLS denial authoritative for unauthorized callers.
  if not public.actor_bypasses_rls() and (
       v_org is distinct from public.auth_org_id()
       or new.org_id is distinct from public.auth_org_id()
       or coalesce(public.auth_role() not in ('Admin','Executive','Project Manager','Finance'), true)
     ) then return new; end if;
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — project documents: the storage key and Microsoft link columns follow the same author-or-Admin
-- rule as the other metadata (0348 body plus the `0349` lines). Server writers (the M365 functions use
-- the service role) bypass it; the author's own upload confirmation and link remain allowed.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.guard_project_document_metadata_author() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if public.actor_bypasses_rls() then return new; end if;
  if (new.title is distinct from old.title
      or new.category is distinct from old.category
      or new.code is distinct from old.code
      or new.doc_date is distinct from old.doc_date
      or new.revision is distinct from old.revision
      or new.project_id is distinct from old.project_id
      or new.file_path is distinct from old.file_path                                         -- 0349
      or new.source is distinct from old.source                                               -- 0349
      or new.ms_drive_id is distinct from old.ms_drive_id                                     -- 0349
      or new.ms_item_id is distinct from old.ms_item_id                                       -- 0349
      or new.ms_web_url is distinct from old.ms_web_url                                       -- 0349
      or new.ms_item_name is distinct from old.ms_item_name                                   -- 0349
      or new.ms_item_kind is distinct from old.ms_item_kind)                                  -- 0349
     and old.author_id is distinct from auth.uid()
     and public.auth_role() is distinct from 'Admin' then
    raise exception 'Document metadata edit is not permitted.' using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists project_document_metadata_author_guard on public.project_documents;
create trigger project_document_metadata_author_guard
  before update of title, category, code, doc_date, revision, project_id,
    file_path, source, ms_drive_id, ms_item_id, ms_web_url, ms_item_name, ms_item_kind
  on public.project_documents
  for each row execute function public.guard_project_document_metadata_author();
