-- 2600_work_order_shared_claim_evidence.sql — quality/acceptance documents filed once against a work order's billing steps
-- are automatically reused as evidence on claims of that work order (DD-R1124-17; docs/specs/wo-shared-claim-evidence.spec.md).
-- Rollback: supabase/migrations/rollback/2600_work_order_shared_claim_evidence_down.sql
-- No rights or money change.
-- Restated functions (verbatim from latest bodies at origin/dev + additions only, zero removed checks):
--   - create_progress_claim: from 0924_native_progress_claim_invoice.sql (+ assert_not_light from 1530) + copy_work_order_evidence_to_claim
--   - attach_work_order_step_document: from 1772_wo_billing_step_functions.sql + open-claim propagation on new attachment
-- drops: attach_work_order_step_document extends the document select with d.revision to snapshot onto progress_claim_evidence; all existing 1772 checks, locks and writes are retained verbatim.

-- ── §1 per-organisation setting (existing organisations off, new organisations on; Admin-only; audited) ────────────────────────────────────────
alter table public.organizations add column work_order_evidence_reuse_enabled boolean not null default false;
alter table public.organizations alter column work_order_evidence_reuse_enabled set default true;
comment on column public.organizations.work_order_evidence_reuse_enabled is
  'On (default): Issued/Approved documents filed on a work order''s billing steps are automatically linked as evidence on its claims without re-upload (2600). Written only through set_org_work_order_evidence_reuse (Admin).';

-- Restated from 2181_wo_checklist_edit_copy.sql (the latest migration that defines it), with the new column appended.
drop trigger zz_audit_org_setting_change on public.organizations;
create trigger zz_audit_org_setting_change after update on public.organizations for each row
  execute function public.audit_org_setting_change(
    'quantity_change_limit', 'built_in_roles_enabled', 'phone_check_in_supervisor_role', 'hide_prices_from_requesters',
    'clearance_checklist_enabled', 'leave_requests_enabled', 'leave_approver_role', 'crew_loans_enabled',
    'discipline_profit_enabled', 'performance_indices_enabled', 'performance_band_low', 'performance_band_high',
    'stock_transfer_mode', 'stock_proof_timing', 'stock_wo_transfers', 'stock_reservations', 'reservation_borrow_mode',
    'reservation_borrow_role', 'reservation_borrow_label', 'dsr_stock_issue', 'dsr_stock_issue_items',
    'purchase_line_planning', 'safety_records_enabled', 'equipment_availability_target_pct',
    'equipment_utilisation_target_pct', 'equipment_escalation_down_days', 'attendance_target_rate',
    'module_people_crews', 'module_site_day', 'module_stock', 'module_purchasing_extras', 'module_billing_extras',
    'work_order_checklist_enabled', 'work_order_evidence_reuse_enabled');

create function public.set_org_work_order_evidence_reuse(p_enabled boolean) returns boolean
  language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid      := public.auth_org_id();
  v_role user_role := public.auth_role();
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_role is distinct from 'Admin' then
    raise exception 'WBS_EVIDENCE_SETTING: only an Admin can switch work-order evidence reuse on or off' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'WBS_EVIDENCE_SETTING: work-order evidence reuse is on or off' using errcode = '22023';
  end if;
  update public.organizations o set work_order_evidence_reuse_enabled = p_enabled where o.id = v_org;
  if not found then raise exception 'WBS_ORDER_NOT_FOUND: organisation not found' using errcode = 'P0002'; end if;
  return p_enabled;
end; $$;
revoke all on function public.set_org_work_order_evidence_reuse(boolean) from public, anon;
grant execute on function public.set_org_work_order_evidence_reuse(boolean) to authenticated, service_role;

-- ── §2 internal helper: snapshot current Issued/Approved WO step documents onto a new claim ──────────────────────────────────
create or replace function public.copy_work_order_evidence_to_claim(p_claim_id uuid, p_work_order_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid;
  v_project uuid;
  v_doc     record;
  v_rows    int;
begin
  if p_claim_id is null or p_work_order_id is null then return; end if;
  select pc.org_id, pc.project_id into v_org, v_project
    from public.progress_claims pc where pc.id = p_claim_id;
  if not found then return; end if;
  if not coalesce((select o.work_order_evidence_reuse_enabled from public.organizations o where o.id = v_org), true) then -- mut:wqe_reuse_gate
    return;
  end if;
  for v_doc in
    select distinct on (d.id)
           d.id as document_id, d.status as document_status, d.revision as document_revision,
           coalesce(sd.attached_by, auth.uid()) as attached_by
      from public.work_order_billing_step_documents sd
      join public.project_documents d on d.id = sd.document_id
     where sd.org_id = v_org
       and sd.work_order_id = p_work_order_id
       and sd.document_id is not null
       and d.org_id = v_org
       and d.project_id = v_project
       and d.status in ('Issued', 'Approved')                                                                            -- mut:wqe_skip_superseded
       and d.file_path is not null
       and btrim(d.file_path) <> ''
     order by d.id, sd.attached_at desc nulls last
  loop
    insert into public.progress_claim_evidence (org_id, claim_id, document_id, document_status, document_revision, attached_by)
    values (v_org, p_claim_id, v_doc.document_id, v_doc.document_status, v_doc.document_revision, v_doc.attached_by)
    on conflict (claim_id, document_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      perform public.log_audit('progress_claim.evidence.attach', v_org, v_doc.attached_by, p_claim_id,
        jsonb_build_object('document_id', v_doc.document_id, 'document_status', v_doc.document_status,
                           'document_revision', v_doc.document_revision, 'source', 'work_order_step'));
    end if;
  end loop;
end; $$;
revoke all on function public.copy_work_order_evidence_to_claim(uuid, uuid) from public, anon, authenticated;

-- ── §3 create_progress_claim: restated from 0924 (+ 1530 light guard) with shared WO evidence copy ───────────────────────────
create or replace function public.create_progress_claim(
  p_project_id          uuid,
  p_kind                text,
  p_work_order_id       uuid    default null,
  p_lines               jsonb   default null,
  p_down_payment_amount numeric default null,
  p_recovery_pct        numeric default null,
  p_recover_remaining   boolean default false)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_project_org uuid;
  v_currency    text;
  v_wo_project  uuid;
  v_wo_status   public.work_order_status;
  v_id          uuid := gen_random_uuid();
  v_item        text;
  v_gross       numeric := 0;
  v_recovery    numeric := 0;
  v_dp_amount   numeric;
  v_dp_pct      numeric;
  v_dp_item     text;
  v_dp_status   text;
  v_dp_found    boolean;
  v_balance     numeric;
  v_locked_count integer;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Admin or Finance may create a progress claim' using errcode = '42501';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'sales_invoices');
  -- ⚑ 0924: a down payment (and a progress claim that recovers one) asks who owns revenue (below), so the organisation row lock comes BEFORE the work-order and
  --   project locks, the order create_native_sales_invoice and create_native_progress_claim_invoice take.
  if p_kind in ('down_payment', 'progress') then
    perform 1 from public.organizations o where o.id = v_org for share;
  end if;
  -- ⚑ 0262 (OD-BILL-1, DD-BWO-5): the work order's billing lock BEFORE the project row lock — the order every billing
  --   writer uses, so a claim and a native invoice on one work order cannot deadlock.
  if p_work_order_id is not null then
    perform public.lock_work_order_billing(p_work_order_id);
  end if;
  select p.org_id, p.currency into v_project_org, v_currency
    from public.projects p where p.id = p_project_id for update;
  if not found or v_project_org is distinct from v_org then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if p_work_order_id is not null then
    select wo.project_id, wo.status into v_wo_project, v_wo_status
      from public.work_orders wo where wo.id = p_work_order_id;
    if v_wo_project is distinct from p_project_id then
      raise exception 'the work order must be on the same project as the claim' using errcode = '23514';
    end if;
    if v_wo_status not in ('Issued','Closed') then
      raise exception 'only an issued or closed work order can be billed — this one is %', v_wo_status
        using errcode = 'P0001';
    end if;
  end if;

  if p_kind = 'down_payment' then
    if p_lines is not null or coalesce(p_recover_remaining, false) then
      raise exception 'a down payment claim has no quantity lines and recovers nothing' using errcode = 'P0001';
    end if;
    if not coalesce(p_down_payment_amount > 0 and p_down_payment_amount < 'Infinity'::numeric
                    and p_down_payment_amount = round(p_down_payment_amount, 2), false) then
      raise exception 'the down payment amount must be a positive number with at most 2 decimals' using errcode = '23514';
    end if;
    if not coalesce(p_recovery_pct > 0 and p_recovery_pct <= 100 and p_recovery_pct = round(p_recovery_pct, 3), false) then
      raise exception 'the recovery percentage must be above 0 and at most 100, with at most 3 decimals' using errcode = '23514';
    end if;
    select o.down_payment_item into v_item from public.organizations o where o.id = v_org;
    -- ⚑ 0924: with no ERP owning revenue there is no ERP item list to choose from, so the claim names the one fixed item PMO
    --   uses (native_down_payment_item). An ERP-owned organisation with no item still gets the refusal below, unchanged.
    if v_item is null and not public.domain_externally_owned(v_org, 'revenue') then
      v_item := public.native_down_payment_item();
    end if;
    if v_item is null then
      raise exception 'set the down payment item in Administration → Accounting before billing a down payment'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.progress_claims pc
                 left join public.sales_invoices si on si.id = pc.id
                where pc.project_id = p_project_id and pc.kind = 'down_payment'
                  and pc.withdrawn_at is null and si.status is distinct from 'Cancelled') then
      raise exception 'this project already has a down payment — withdraw it or cancel its invoice before billing another'
        using errcode = 'P0001';
    end if;
    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        down_payment_amount, recovery_pct, dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'down_payment', v_currency, p_down_payment_amount,
            p_down_payment_amount, p_recovery_pct, 0, v_item, auth.uid());
    v_gross := p_down_payment_amount;

  elsif p_kind = 'progress' then
    if p_down_payment_amount is not null or p_recovery_pct is not null then
      raise exception 'a progress claim states quantities, not a down payment' using errcode = 'P0001';
    end if;
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      raise exception 'a progress claim needs at least one quantity line' using errcode = 'P0001';
    end if;
    if jsonb_array_length(p_lines) > 500 then
      raise exception 'a progress claim may have at most 500 lines' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                where not coalesce(x.quantity > 0 and x.quantity < 'Infinity'::numeric
                                   and x.quantity = round(x.quantity, 3), false)) then
      raise exception 'each quantity must be a positive number with at most 3 decimals' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                 left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
                where b.id is null or (p_work_order_id is not null and not exists(select 1 from public.work_order_lines wl where wl.boq_item_id=b.id and wl.work_order_id=p_work_order_id)) or (p_work_order_id is null and exists(select 1 from public.work_order_lines wl where wl.boq_item_id=b.id))) then
      raise exception 'every line must be allocated to the selected work order, or have no allocation for a project-level claim'
        using errcode = '23514';
    end if;
    if (select count(*) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric))
       <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)) then
      raise exception 'each bill of quantities line may appear once per claim' using errcode = '23514';
    end if;

    -- Hold every referenced rate stable through cap validation and line insertion.
    perform b.id
      from public.boq_items b
      join jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric) on x.boq_item_id = b.id
     order by b.id
     for share of b;
    get diagnostics v_locked_count = row_count;
    if v_locked_count <> jsonb_array_length(p_lines) then
      raise exception 'every progress claim line must lock a BoQ row' using errcode = '23514';
    end if;

    select coalesce(sum(round(x.quantity * b.rate, 2)), 0) into v_gross
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;

    select pc.down_payment_amount, pc.recovery_pct, pc.dp_item_code, si.status
      into v_dp_amount, v_dp_pct, v_dp_item, v_dp_status
      from public.progress_claims pc
      left join public.sales_invoices si on si.id = pc.id
     where pc.project_id = p_project_id and pc.kind = 'down_payment'
       and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
    v_dp_found := found;

    if v_dp_found then
      if v_dp_status is null or v_dp_status not in ('Submitted','Unpaid','Paid') then
        raise exception 'the down payment invoice has not been submitted yet: submit it (or withdraw the down payment) before claiming progress'
          using errcode = 'P0001';
      end if;
      select v_dp_amount - coalesce(sum(pc.dp_recovery_amount), 0) into v_balance
        from public.progress_claims pc
        left join public.sales_invoices si on si.id = pc.id
       where pc.project_id = p_project_id and pc.kind = 'progress'
         and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
      v_balance := greatest(v_balance, 0);
      if coalesce(p_recover_remaining, false) then
        v_recovery := least(v_balance, v_gross);
      else
        v_recovery := least(round(v_gross * v_dp_pct / 100, 2), v_balance);
      end if;
    elsif coalesce(p_recover_remaining, false) then
      raise exception 'there is no down payment to recover on this project' using errcode = 'P0001';
    end if;

    -- ⚑ 0924 (#2465): a down payment invoiced in PMO names PMO's own item. Once an ERP owns revenue the recovery must name the
    --   organisation's ERP item instead (the ERP fence refuses PMO's), or the advance could never be recovered.
    if v_recovery > 0 and v_dp_item = public.native_down_payment_item() and public.domain_externally_owned(v_org, 'revenue') then
      select o.down_payment_item into v_dp_item from public.organizations o where o.id = v_org;
      if v_dp_item is null then
        raise exception 'set the down payment item in Administration → Accounting before recovering the down payment'
          using errcode = 'P0001';
      end if;
    end if;

    -- ⚑ 0262 (OD-BILL-1, DD-BWO-4): a claim reserves its gross against its work order when it is created.
    if p_work_order_id is not null then
      perform public.assert_work_order_invoiceable(v_org, p_work_order_id, p_project_id, v_id::text, v_gross, v_currency);
    end if;

    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'progress', v_currency, v_gross,
            v_recovery, case when v_recovery > 0 then v_dp_item end, auth.uid());
    insert into public.progress_claim_lines (org_id, claim_id, boq_item_id, item_code, description, unit,
                                             quantity, rate, amount)
    select v_org, v_id, b.id, b.item_code, b.description, b.unit, x.quantity, b.rate, round(x.quantity * b.rate, 2)
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;
    if v_gross is distinct from (select coalesce(sum(l.amount),0) from public.progress_claim_lines l where l.claim_id=v_id) then
      raise exception 'the progress claim header must equal the sum of its priced lines' using errcode = '23514';
    end if;
  else
    raise exception 'a claim is either a down_payment or a progress claim, not %', coalesce(p_kind, 'null')
      using errcode = '22023';
  end if;

  -- ⚑ 2600 (DD-R1124-17): snapshot current work-order billing-step documents onto the new claim when reuse is enabled.
  if p_work_order_id is not null then
    perform public.copy_work_order_evidence_to_claim(v_id, p_work_order_id);
  end if;

  perform public.log_audit('progress_claim.create', v_org, auth.uid(), v_id,
    jsonb_build_object('project_id', p_project_id, 'kind', p_kind, 'work_order_id', p_work_order_id,
                       'gross_amount', v_gross, 'dp_recovery_amount', v_recovery));
  return v_id;
end; $$;

-- ── §4 attach_work_order_step_document: restated from 1772 with open-claim propagation on new attachment ─────────────────────
create or replace function public.attach_work_order_step_document(p_step uuid, p_slot uuid, p_document uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_s      public.work_order_billing_steps;
  v_d_org  uuid; v_d_proj uuid; v_status public.doc_status; v_file text; v_title text; v_cat uuid;
  v_slot   uuid;
  v_rev    text;
  v_prev_doc uuid;
  v_claim  uuid;
  v_rows   int;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if p_step is null then raise exception 'WBS_NOT_FOUND: billing step not found' using errcode = 'P0002'; end if;
  v_s := public.lock_wo_billing_step(p_step);
  if v_s.done_on is not null or v_s.skipped_on is not null then
    raise exception 'WBS_CLOSED: this billing step is already finished' using errcode = '55000';
  end if;
  select d.org_id, d.project_id, d.status, d.file_path, d.title, d.category_id, d.revision
    into v_d_org, v_d_proj, v_status, v_file, v_title, v_cat, v_rev
    from public.project_documents d where d.id = p_document;
  -- ONE refusal for "no such document", "another project's", "a category you may not see", "not issued or approved" and "no file":
  -- the refusal never says which, so it cannot be used to probe documents.
  if not found or v_d_org is distinct from v_s.org_id or v_d_proj is distinct from v_s.project_id
     or not coalesce(public.document_category_visible(v_cat, v_d_org), false)
     or not coalesce(v_status in ('Issued','Approved'), false) or coalesce(btrim(v_file), '') = '' then
    raise exception 'WBS_DOC_INVALID: choose an issued or approved document with a file from this work order''s project that you may see' using errcode = '23514';
  end if;
  if p_slot is null then
    insert into public.work_order_billing_step_documents (org_id, step_id, work_order_id, position, name, required, document_id, attached_by, attached_at)
    select v_s.org_id, v_s.id, v_s.work_order_id, coalesce(max(x.position), 0) + 1, left(btrim(coalesce(v_title, 'Attachment')), 200), false,
           p_document, auth.uid(), now()
      from public.work_order_billing_step_documents x where x.step_id = v_s.id
    returning id into v_slot;
  else
    select x.document_id into v_prev_doc
      from public.work_order_billing_step_documents x where x.id = p_slot and x.step_id = v_s.id;
    update public.work_order_billing_step_documents x
       set document_id = p_document, attached_by = auth.uid(), attached_at = now()
     where x.id = p_slot and x.step_id = v_s.id returning x.id into v_slot;
    if v_slot is null then raise exception 'WBS_SLOT: that attachment slot is not on this billing step' using errcode = 'P0002'; end if;
  end if;
  perform public.log_audit('wo_billing_step.document.attach', v_s.org_id, auth.uid(), v_s.work_order_id,
    jsonb_build_object('step_id', v_s.id, 'position', v_s.position, 'slot_id', v_slot, 'document_id', p_document, 'document_status', v_status));

  -- ⚑ 2600 (DD-R1124-17): link a newly attached work-order document onto open claims of this work order.
  -- Replacing an existing slot document (v_prev_doc is not null) leaves earlier claims untouched; later claims inherit the replacement.
  if (p_slot is null or v_prev_doc is null)                                                                              -- mut:wqe_no_replace_overwrite
     and coalesce((select o.work_order_evidence_reuse_enabled from public.organizations o where o.id = v_s.org_id), true) then
    for v_claim in
      select pc.id
        from public.progress_claims pc
       where pc.org_id = v_s.org_id
         and pc.work_order_id = v_s.work_order_id
         and pc.withdrawn_at is null
         and not exists (select 1 from public.sales_invoices si where si.id = pc.id)                                     -- mut:wqe_skip_invoiced
         and not exists (
           select 1 from public.external_command_outbox o
            where o.org_id = v_s.org_id and o.domain = 'revenue'
              and lower(o.pmo_record_id) = pc.id::text and o.state <> 'failed')
    loop
      insert into public.progress_claim_evidence (org_id, claim_id, document_id, document_status, document_revision, attached_by)
      values (v_s.org_id, v_claim, p_document, v_status, v_rev, auth.uid())
      on conflict (claim_id, document_id) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        perform public.log_audit('progress_claim.evidence.attach', v_s.org_id, auth.uid(), v_claim,
          jsonb_build_object('document_id', p_document, 'document_status', v_status, 'document_revision', v_rev, 'source', 'work_order_step'));
      end if;
    end loop;
  end if;
end; $$;
