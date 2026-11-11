alter table public.timesheets add column rejection_reason text, add column rejected_by uuid references public.profiles(id) on delete set null, add column rejected_at timestamptz;
alter table public.expense_claims add column rejected_by uuid references public.profiles(id) on delete set null, add column rejected_at timestamptz;
alter table public.imprest_replenishments add column rejected_by uuid references public.profiles(id) on delete set null, add column rejected_at timestamptz;
alter table public.equipment_usage_entries add column rejected_by uuid references public.profiles(id) on delete set null, add column rejected_at timestamptz;

create or replace function public.transition_timesheet(p_timesheet_id uuid, p_to timesheet_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from  timesheet_status;
  v_org   uuid;
  v_owner uuid;
  v_uid   uuid      := auth.uid();
  v_role  user_role := auth_role();
  v_mgr   uuid;
  v_tm_claim uuid;
  -- The transition map (OD-TS-2 config seam): legal (from → [allowed to]) superset, as data.
  -- Slice A (FR-TSC-001): `Approved` is no longer terminal — `Approved → Draft` is the one new edge.
  v_legal jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Submitted'),
    'Submitted', jsonb_build_array('Approved','Rejected'),
    'Rejected',  jsonb_build_array('Draft'),
    'Approved',  jsonb_build_array('Draft')
  );
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  -- FR-PLN-006 closure: rejecting a SUBMITTED sheet is a CLOSING decision on work already minted, so a
  -- switch-off must not strand the approval queue. Every other transition is gated.
  if p_to is null or p_to::text is distinct from 'Rejected' then
    perform public.assert_feature_on(public.auth_org_id(), 'timesheets');
  end if;
  -- Load + lock the row (serializes concurrent transitions on the SAME timesheet). P0002 if absent.
  select status, org_id, user_id
    into v_from, v_org, v_owner
    from public.timesheets where id = p_timesheet_id for update;
  if v_from is null then
    raise exception 'timesheet not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation (FR-TS-003): proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Transition-map legality (FR-TS-001): (from,to) must be in the data map, else P0001.
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- Authorization matrix + SoD (OD-TS-1/OD-TS-4, FR-TS-004/005/006). Resolve the owner's line manager.
  -- SECURITY: these re-assertions MUST stay (definer bypasses RLS).
  select manager_id into v_mgr from public.profiles where id = v_owner;

  if p_to = 'Submitted' then
    -- Submit: only the owner may submit their own Draft sheet (FR-TS-004).
    if v_uid is distinct from v_owner then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    -- SoD FIRST, ALWAYS — even an Admin can never approve/reject their own timesheet (OD-TS-4-D, FR-TS-005).
    -- This `actor = owner` check is intentionally ordered BEFORE the role/manager check so break-glass
    -- can never defeat separation of duties. Do not reorder.
    if v_uid = v_owner then
      raise exception 'separation of duties: cannot approve own timesheet' using errcode = '42501';
    end if;
    -- Then: the assigned line manager (exclusive when set); OR Admin/Exec fallback ONLY when manager is
    -- null; OR Admin break-glass (OD-TS-4-D).
    -- HIGH-TS-1: `v_uid is not distinct from v_mgr` is null-safe — it yields FALSE (not NULL) when
    -- v_mgr is null, so `not (false or ...)` no longer short-circuits to NULL and skips the raise.
    -- The Admin/Exec fallback is therefore gated STRICTLY to a null manager; a non-privileged
    -- bystander on a null-manager sheet now correctly hits 42501.
    if not (v_uid is not distinct from v_mgr
            or (v_mgr is null and v_role in ('Admin','Executive'))
            or v_role = 'Admin') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif p_to = 'Draft' and v_from = 'Approved' then
    -- Slice A (FR-TSC-020/021): re-open an Approved sheet. The AUTHORITY is the same approver
    -- population as the approve arm above — line manager, Admin/Exec-when-manager-null, or Admin
    -- break-glass — and the OWNER is excluded. SoD FIRST (mirrors the approve arm ordering): an
    -- owner can never re-open their own approved sheet, even if they are Admin.
    if v_uid = v_owner then
      raise exception 'separation of duties: cannot re-open own approved timesheet' using errcode = '42501';
    end if;
    if not (v_uid is not distinct from v_mgr
            or (v_mgr is null and v_role in ('Admin','Executive'))
            or v_role = 'Admin') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    -- #1514 T2 (FR-TM-017): hours that feed a live time-and-materials claim stay approved until the claim is withdrawn.
    if exists (select 1 from public.timesheet_entries e
                where e.timesheet_id = p_timesheet_id and public.tm_source_is_live('timesheet_entry', e.id)) then
      select s.claim_id into v_tm_claim
        from public.timesheet_entries e
        join public.tm_claim_sources s on s.source_kind = 'timesheet_entry' and s.source_id = e.id and s.is_live
       where e.timesheet_id = p_timesheet_id limit 1;
      raise exception 'timesheet hours are in time-and-materials claim %', v_tm_claim using errcode = '55000';
    end if;
    -- FENCE 2 (FR-TSC-008/010, scoped): serialize against a concurrent push insert. The SAME named
    -- per-timesheet advisory lock is acquired by insert_timesheet_outbox_pending (§B), so whichever
    -- side wins the lock the other sees its effect.
    perform pg_advisory_xact_lock(hashtextextended('ts-correct:' || p_timesheet_id::text, 0));
    -- Refuse if ERP may hold a LIVE document — a mirror row with ts_number set and not cancelled
    -- (Luna f1, mirror side). A pushed sheet is refused here; Slice B will fill the cancel-confirmed
    -- admit branch for it. Fail closed on any doubt.
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id
                   and m.ts_number is not null and m.erp_cancelled_at is null) then
      raise exception 'reopen-erp-document-held' using errcode = 'P0001';
    end if;
    -- ⚑ THE UNKNOWN ERP OUTCOME (Luna FU-1a round-8 BLOCK — THE money predicate). `post_submit_unknown_at`
    -- is set the moment PMO loses track of a submit's result and is cleared ONLY by learning a real
    -- `ts_number` or by an audited operator attestation (0157 §2/§5). It is deliberately INDEPENDENT of
    -- `push_state` and of the outbox: those answer "can the backstop retry this?", and a re-queue —
    -- including `release_outbox_hold`, which clears BOTH hold states in one transaction — establishes
    -- NOTHING about what ERPNext holds. Before this predicate, a release therefore opened the correction
    -- path over a live ERP document: re-open + re-approve minted a SECOND Timesheet for the week and the
    -- client's hours double-counted permanently (the original command can never be adopted afterwards,
    -- so it never learns the `ts_number` that would have fenced the second push).
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id
                   and m.post_submit_unknown_at is not null) then
      raise exception 'reopen-push-outcome-unknown' using errcode = 'P0001';
    end if;
    -- The mirror's own `held` state, kept as an INDEPENDENT predicate (0152 §B). It fences the pre-0157
    -- residue — a `held` row written before the witness column existed — and any future writer that
    -- parks `held` without stamping one. Same refusal, so the caller sees one story.
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id and m.push_state = 'held') then
      raise exception 'reopen-push-outcome-unknown' using errcode = 'P0001';
    end if;
    -- Refuse if ANY non-terminal outbox row exists for this sheet — the after-commit-before-mirror
    -- seam (a `committed` row whose mirror finalize has not run — Luna f1) AND a bare `pending` (a
    -- queued push still claimable/POSTable while this re-open commits — Luna f2).
    --
    -- ⚑ WHAT TERMINAL `failed` DOES AND DOES NOT PROVE (CORRECTED IN ROUND 8; the 0152 text this
    -- replaces was false). `failed` on the OUTBOX means only "no retry is queued". It does NOT mean
    -- "ERP holds no document":
    --   • an operator `release_outbox_hold` writes `failed` over a POST-SUBMIT UNKNOWN (0152 §A) —
    --     that is the round-8 BLOCK, and it is why the predicate above no longer reads push state at all;
    --   • `commitCreate` creates then submits (`erpnext/adapter.ts`), so a create that succeeded and a
    --     submit ERP rejected is terminal `failed` while ERPNext holds a DRAFT Timesheet PMO has no
    --     pointer to (no costing, so clutter rather than a double-count — but not "no document");
    --   • a row written by the PRE-0151 code carries no guarantee at all: a succeeded submit whose
    --     read-back failed was marked terminal `failed` with a `ts_number`-less mirror.
    -- So this arm no longer LEANS on `failed`; it admits `failed` only once the independent
    -- unknown-outcome witness above says the ERP question has actually been answered. THE PRE-0151
    -- DISPOSITION IS UNCHANGED AND STILL EXPLICIT: those rows carry no witness (the column did not
    -- exist), this arm will ADMIT them, and an OPERATOR must establish what ERP holds before trusting
    -- that admit. The census + the operator's action are named in
    -- `docs/plans/2026-07-23-timesheet-reopen-unpushed.md` §9 ("Pre-0151 residue"); an environment that
    -- never ran the P3b push before 0151 has an empty census and nothing to do.
    if exists (select 1 from public.external_command_outbox o
                 where o.org_id = v_org and o.domain = 'timesheets'
                   and o.pmo_record_id = p_timesheet_id::text
                   and o.state in ('pending','committing','committed','quarantined','held')) then
      raise exception 'reopen-push-in-flight' using errcode = 'P0001';
    end if;
    -- ⛔ SLICE B SEAM: the cancel-confirmed ADMIT branch (FR-TSC-008 full) lands HERE — when a
    -- generation-specific correction intent is consumed + its cancel outbox confirmed + mirror
    -- tombstoned, a PUSHED sheet may flip. Slice A admits ONLY the un-pushed case (no live doc, no
    -- unknown outcome, no non-terminal outbox row); a pushed sheet is refused above (Slice B's entry
    -- point). Do NOT widen without the intent table + cancel machinery.
  elsif p_to = 'Draft' and v_from = 'Rejected' then
    -- Rework: only the owner reworks a Rejected sheet back to Draft (FR-TS-006). Byte-for-byte with
    -- 0007 (the arm is narrowed by `v_from`, not widened in authority).
    if v_uid is distinct from v_owner then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;

  -- Atomic single update: status + the relevant stamp(s) in the SAME statement ⇒ no observable partial
  -- state (NFR-TS-ATOM-001). Approved→Draft leaves submitted_at/approved_by/approved_at as-is (OD-TS-4-A:
  -- audit trail of the last cycle; overwritten on the next submit/approve). Unchanged from 0007.
  update public.timesheets set
    status       = p_to,
    submitted_at = case when p_to = 'Submitted'            then now()  else submitted_at end,
    approved_by  = case when p_to in ('Approved','Rejected') then v_uid else approved_by  end,
    approved_at  = case when p_to in ('Approved','Rejected') then now() else approved_at  end,
    rejection_reason = case when p_to = 'Rejected' then nullif(btrim(p_notes), '') when p_to = 'Submitted' and v_from = 'Draft' then null else rejection_reason end,
    rejected_by = case when p_to = 'Rejected' then v_uid when p_to = 'Submitted' and v_from = 'Draft' then null else rejected_by end,
    rejected_at = case when p_to = 'Rejected' then now() when p_to = 'Submitted' and v_from = 'Draft' then null else rejected_at end
  where id = p_timesheet_id;
end; $$;

create or replace function public.transition_expense_claim(
  p_id                uuid,
  p_to                public.expense_claim_status,
  p_notes             text default null,
  p_payment_reference text default null
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_row      public.expense_claims%rowtype;
  v_uid      uuid      := auth.uid();
  v_role     user_role := auth_role();
  v_is_admin boolean;
  v_route    record;
  v_lines    int;
  v_adv      public.expense_claims%rowtype;
  v_applied  numeric   := 0;
  v_today    date;
  v_float    public.imprest_floats%rowtype;                                               -- 0423
  v_limit    numeric;                                                                      -- 0423
  v_tz       text;                                                                         -- 0423
  v_remain   numeric;                                                                      -- 0423
  v_exc      boolean   := false;                                                           -- 0423
  v_plan_by  uuid;                                                                         -- 0423
  v_out      numeric;                                                                      -- 0423
  v_legal    jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Submitted','Cancelled'),
    'Submitted', jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',  jsonb_build_array('Paid','Cancelled'),
    'Rejected',  jsonb_build_array('Draft'),
    'Paid',      jsonb_build_array(),
    'Cancelled', jsonb_build_array()
  );
begin
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');

  select * into v_row from public.expense_claims where id = p_id for update;
  if not found then
    raise exception 'expense claim not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (v_legal -> v_row.status::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_row.status, p_to using errcode = 'P0001';
  end if;
  if p_payment_reference is not null and p_to is distinct from 'Paid' then
    raise exception 'a payment reference belongs only to the payment step' using errcode = 'P0001';
  end if;
  if v_row.imprest_float_id is not null then                                               -- 0423
    select * into v_float from public.imprest_floats where id = v_row.imprest_float_id;    -- 0423
    if v_float.archived_at is not null and p_to in ('Approved','Paid') then                -- 0423
      raise exception 'this site float is archived: its records can no longer be approved or paid'  -- 0423
        using errcode = 'P0001';                                                           -- 0423
    end if;                                                                                -- 0423
    v_tz := coalesce((select o.default_timezone from public.organizations o                -- 0423
                       where o.id = v_row.org_id), 'UTC');                                 -- 0423
  end if;                                                                                  -- 0423

  -- SoD (DD-EXP-3), for every actor including an Admin (the OD-PROC-8 shape).
  if v_row.status = 'Submitted' and p_to in ('Approved','Rejected') and v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot approve or reject their own expense claim' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot pay their own expense claim' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_row.approved_by_id then
    raise exception 'separation of duties: the approver cannot also pay this expense claim' using errcode = '42501';
  end if;
  -- 0423 DD-IMP-7.1: only the custodian pays a float record, so the custodian never decides one.
  if v_row.imprest_float_id is not null and v_row.status = 'Submitted'                      -- 0423
     and p_to in ('Approved','Rejected') and v_uid = v_float.custodian_id then               -- 0423
    raise exception 'separation of duties: the float''s custodian pays this record and cannot also decide it'  -- 0423
      using errcode = '42501';                                                               -- 0423
  end if;                                                                                  -- 0423

  if p_to = 'Submitted' then
    if v_uid is distinct from v_row.claimant_id then
      raise exception 'only the claimant can submit this expense claim' using errcode = '42501';
    end if;
    if v_row.kind = 'claim' then
      select count(*) into v_lines from public.expense_claim_lines l where l.claim_id = p_id;
      if v_lines = 0 then
        raise exception 'an expense claim needs at least one line before it can be submitted' using errcode = 'P0001';
      end if;
    end if;
    if not (v_row.amount > 0) then
      raise exception 'the amount must be greater than zero before submitting' using errcode = 'P0001';
    end if;
    if v_row.imprest_float_id is not null then                                             -- 0423
      select s.procurement_limit into v_limit from public.org_imprest_settings s           -- 0423
       where s.org_id = v_row.org_id;                                                      -- 0423
      if v_limit is null or v_row.amount > v_limit then                                    -- 0423 DD-IMP-5, fail closed
        raise exception 'this is above the procurement limit of % for site cash: raise it as a procurement request instead',  -- 0423
          coalesce(v_limit::text, '(unset)') using errcode = 'P0001';                      -- 0423
      end if;                                                                              -- 0423
      if v_row.kind = 'claim' and not exists (select 1 from public.expense_claim_files f   -- 0423 OQ-IMP-4
                    where f.claim_id = p_id and f.archived_at is null) then                -- 0423
        raise exception 'a claim paid from site cash needs at least one receipt attached' using errcode = 'P0001';  -- 0423
      end if;                                                                              -- 0423
    end if;                                                                                -- 0423
  elsif v_row.status = 'Rejected' and p_to = 'Draft' then
    if v_uid is distinct from v_row.claimant_id then
      raise exception 'only the claimant can send a rejected expense claim back to Draft' using errcode = '42501';
    end if;
  elsif p_to = 'Cancelled' then
    if not ((v_row.status in ('Draft','Submitted') and v_uid = v_row.claimant_id) or v_is_admin or v_role = 'Finance') then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    -- #803 routing, called — never copied (ADR-0075 §3). Same lock key as transition_procurement (0243 §7) so a
    -- claim and a purchase request on one line serialize (FR-EXP-022). Classification runs AFTER the lock is held.
    if v_row.project_id is not null and v_row.budget_category is not null then
      perform pg_advisory_xact_lock(
        hashtextextended('spend-line:' || v_row.project_id::text || ':' || v_row.budget_category::text, 0));
    end if;
    select * into v_route
      from public.spend_approval_route(v_row.org_id, v_row.project_id, v_row.budget_category, v_row.amount,
                                       v_row.currency, v_row.claimant_id, v_uid, v_row.submitted_at);
    -- 0423 FR-IMP-024: under the float lock (after the line lock, plan delta 5), an item that does not fit the month's
    -- remaining is an exception routed to the senior set only; the plan's own approver is excluded.  -- 0423
    if v_row.imprest_float_id is not null then                                             -- 0423
      perform public.imprest_lock_float(v_row.imprest_float_id);                           -- 0423
      v_remain := public.imprest_remaining(v_row.imprest_float_id, v_row.imprest_month,    -- 0423
                                           v_row.budget_category);                         -- 0423
      v_exc := v_row.amount > v_remain;                                                    -- 0423
      if v_exc then                                                                        -- 0423
        select p.approved_by into v_plan_by from public.imprest_plans p                    -- 0423
         where p.float_id = v_row.imprest_float_id and p.month = v_row.imprest_month       -- 0423
           and p.status = 'Approved';                                                      -- 0423
        if v_uid = v_plan_by then                                                          -- 0423
          raise exception 'separation of duties: the approver of this month''s plan cannot decide an out-of-plan item'  -- 0423
            using errcode = '42501';                                                       -- 0423
        end if;                                                                            -- 0423
        select r.route, r.approver_ids, v_route.reason, v_route.line_budget, v_route.line_used  -- 0423
          into v_route                                                                     -- 0423
          from public.imprest_senior_route(v_row.org_id, v_row.claimant_id) r;             -- 0423
      end if;                                                                              -- 0423
    end if;                                                                                -- 0423
    -- coalesce: a NULL route must refuse, never pass (DD-APR-5).
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
       and not coalesce(v_uid = any (v_route.approver_ids), false) then
      if v_route.route = 'admin' then
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason
          using errcode = '42501';
      end if;
      raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown')
        using errcode = '42501';
    end if;
    -- The flat floor still applies to everyone but an Admin (named approvers hold this rank by construction).
    if not v_is_admin and not public.holds_spend_approval_authority(v_role) then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
    perform public.log_audit('expense_claim.approval_route', v_row.org_id, v_uid, p_id,
      jsonb_build_object('to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,
        'request_amount', v_row.amount, 'line_budget', v_route.line_budget, 'line_used', v_route.line_used,
        'budget_category', v_row.budget_category::text,
        'plan_exception', v_exc,                                                           -- 0423
        'plan_shortfall', case when v_exc then v_row.amount - v_remain end,                -- 0423
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));
  elsif p_to = 'Paid' then
    if v_row.imprest_float_id is null                                                      -- 0423 off-float: FR-EXP-024 unchanged
       and not (v_is_admin or v_role = 'Finance') then                                   -- 0423 (edited: was `if not (...)`)
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
    -- 0423 DD-IMP-7: a float record is paid by its custodian alone, still eligible, whatever their role.
    if v_row.imprest_float_id is not null and (v_uid is distinct from v_float.custodian_id   -- 0423
       or not public.imprest_custodian_eligible(v_row.org_id, v_float.project_id, v_uid)) then  -- 0423
      raise exception 'only this site float''s custodian pays a record charged to it' using errcode = '42501';  -- 0423
    end if;                                                                                -- 0423
    v_today := (now() at time zone coalesce(
                 (select o.default_timezone from public.organizations o where o.id = v_row.org_id), 'UTC'))::date;
    if v_row.advance_id is not null then
      -- Lock order is always claim → advance; record_expense_advance_return locks only the advance.
      select * into v_adv from public.expense_claims where id = v_row.advance_id for update;
      if v_adv.status is distinct from 'Paid' or v_adv.claimant_id is distinct from v_row.claimant_id then
        raise exception 'the linked advance is not a paid advance of this claimant' using errcode = 'P0001';
      end if;
      v_applied := least(v_row.amount, greatest(public.expense_advance_outstanding(v_row.advance_id), 0));
    end if;
    if v_row.imprest_float_id is not null then                                             -- 0423 DD-IMP-3
      perform public.imprest_lock_float(v_row.imprest_float_id);                           -- 0423 (claim → advance → float)
      v_out := case v_row.kind when 'advance' then v_row.amount else v_row.amount - v_applied end;  -- 0423
      if public.imprest_cash_book(v_row.imprest_float_id) - v_out < 0 then                 -- 0423
        raise exception 'paying % would overdraw the site float (cash on hand %): request a replenishment first',  -- 0423
          v_out, public.imprest_cash_book(v_row.imprest_float_id) using errcode = 'P0001'; -- 0423
      end if;                                                                              -- 0423
    end if;                                                                                -- 0423
  end if;

  update public.expense_claims set
    status            = p_to,
    claim_number      = case when p_to = 'Submitted'
                             then coalesce(claim_number, public.next_procurement_doc_number(org_id,
                                    case kind when 'advance' then 'ADV' else 'EXP' end))
                             else claim_number end,
    submitted_at      = case when p_to = 'Submitted' then now() else submitted_at end,
    imprest_month     = case when p_to = 'Submitted' and imprest_float_id is not null         -- 0423 OQ-IMP-8
                             then date_trunc('month', now() at time zone v_tz)::date          -- 0423
                             when p_to = 'Draft' then null else imprest_month end,            -- 0423
    is_plan_exception = case when p_to = 'Approved' then v_exc                                -- 0423
                             when p_to = 'Draft' then false else is_plan_exception end,       -- 0423
    approved_by_id    = case when p_to = 'Approved' then v_uid when p_to = 'Draft' then null else approved_by_id end,
    approved_at       = case when p_to = 'Approved' then now() when p_to = 'Draft' then null else approved_at end,
    approval_notes    = case when p_to = 'Approved' then p_notes else approval_notes end,
    rejection_notes   = case when p_to = 'Rejected' then nullif(btrim(p_notes), '') when p_to = 'Submitted' and v_row.status = 'Draft' then null else rejection_notes end,
    rejected_by = case when p_to = 'Rejected' then v_uid when p_to = 'Submitted' and v_row.status = 'Draft' then null else rejected_by end,
    rejected_at = case when p_to = 'Rejected' then now() when p_to = 'Submitted' and v_row.status = 'Draft' then null else rejected_at end,
    paid_by_id        = case when p_to = 'Paid' then v_uid else paid_by_id end,
    paid_at           = case when p_to = 'Paid' then now() else paid_at end,
    paid_on           = case when p_to = 'Paid' then v_today else paid_on end,
    payment_reference = case when p_to = 'Paid' then nullif(btrim(p_payment_reference), '') else payment_reference end,
    advance_applied   = case when p_to = 'Paid' then v_applied else advance_applied end,
    cancelled_at      = case when p_to = 'Cancelled' then now() else cancelled_at end
  where id = p_id;

  perform public.log_audit('expense_claim.transition', v_row.org_id, v_uid, p_id,
    jsonb_build_object('from', v_row.status::text, 'to', p_to::text, 'notes', p_notes, 'advance_applied', v_applied));
end; $$;

create or replace function public.transition_imprest_replenishment(p_id uuid, p_to text, p_notes text default null,
                                                                   p_payment_reference text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_r   public.imprest_replenishments%rowtype;
  v_f   public.imprest_floats%rowtype;
  v_uid uuid := auth.uid();
  v_fin boolean := public.auth_role() in ('Finance','Admin');
  v_tz  text;
  v_legal jsonb := jsonb_build_object('Requested', jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved', jsonb_build_array('Paid','Cancelled'), 'Paid', jsonb_build_array(), 'Rejected', jsonb_build_array(),
    'Cancelled', jsonb_build_array());
begin
  perform public.assert_is_active_member();
  select * into v_r from public.imprest_replenishments where id = p_id for update;
  if not found or v_r.org_id is distinct from public.auth_org_id() then
    raise exception 'replenishment not found' using errcode = 'P0002';
  end if;
  -- FR-PLN-006 closure: deciding or paying an EXISTING request is a CLOSING transition — a switch-off
  -- must not strand a request minted while the module was on. Only minting a new decision path forward
  -- (Approved) is gated.
  if coalesce(p_to, '') not in ('Rejected','Paid','Cancelled') then
    perform public.assert_feature_on(public.auth_org_id(), 'imprest');
  end if;
  if not (v_legal -> v_r.status) ? p_to then
    raise exception 'illegal transition % -> %', v_r.status, p_to using errcode = 'P0001';
  end if;
  if p_payment_reference is not null and p_to is distinct from 'Paid' then
    raise exception 'a payment reference belongs only to the payment step' using errcode = 'P0001';
  end if;
  select * into v_f from public.imprest_floats where id = v_r.float_id;
  if v_f.archived_at is not null and p_to in ('Approved','Paid') then  -- an archived float's requests may still be closed
    raise exception 'this site float is archived: its requests can no longer be approved or paid' using errcode = 'P0001';
  end if;
  perform public.imprest_lock_float(v_r.float_id);
  -- SoD (FR-IMP-052/053), for every caller including an Admin: site finance never tops up its own float.
  if p_to in ('Approved','Rejected','Paid') and (v_uid = v_f.custodian_id or v_uid = v_r.requested_by) then
    raise exception 'separation of duties: the custodian or requester cannot % this request', lower(p_to) using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_r.approved_by then
    raise exception 'separation of duties: the approver cannot also pay this request' using errcode = '42501';
  end if;
  if p_to in ('Approved','Rejected','Paid') and not v_fin then
    raise exception 'only Finance or an Admin decides or pays a replenishment' using errcode = '42501';
  end if;
  if p_to = 'Cancelled' and not (v_fin or (v_r.status = 'Requested' and v_uid = v_r.requested_by)) then
    raise exception 'not authorized to cancel this request' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_r.kind = 'funding'                                                -- FR-IMP-054 (plan delta 3)
     and public.imprest_cash_book(v_r.float_id) + public.imprest_advances_out(v_r.float_id)
         + public.imprest_receipts_waiting(v_r.float_id) + v_r.amount > v_f.float_amount then
    raise exception 'paying this funding would take the float above its fixed amount' using errcode = 'P0001';
  end if;
  v_tz := coalesce((select o.default_timezone from public.organizations o where o.id = v_r.org_id), 'UTC');
  update public.imprest_replenishments set
    status            = p_to,
    rejected_by = case when p_to = 'Rejected' then v_uid else rejected_by end,
    rejected_at = case when p_to = 'Rejected' then now() else rejected_at end,
    approved_by       = case when p_to = 'Approved' then v_uid else approved_by end,
    approved_at       = case when p_to = 'Approved' then now() else approved_at end,
    decided_notes     = case when p_to in ('Approved','Rejected') then nullif(btrim(p_notes), '') else decided_notes end,
    paid_by           = case when p_to = 'Paid' then v_uid else paid_by end,
    paid_at           = case when p_to = 'Paid' then now() else paid_at end,
    paid_on           = case when p_to = 'Paid' then (now() at time zone v_tz)::date else paid_on end,
    payment_reference = case when p_to = 'Paid' then nullif(btrim(p_payment_reference), '') else payment_reference end,
    cancelled_at      = case when p_to = 'Cancelled' then now() else cancelled_at end
  where id = p_id;
  if p_to in ('Rejected','Cancelled') then                                                 -- FR-IMP-051: release
    update public.expense_claims set imprest_replenishment_id = null where imprest_replenishment_id = p_id;
  end if;
  perform public.log_audit('imprest_replenishment.transition', v_r.org_id, v_uid, p_id,
    jsonb_build_object('from', v_r.status, 'to', p_to, 'kind', v_r.kind, 'amount', v_r.amount, 'notes', p_notes));
end; $$;

create or replace function public.equipment_usage_transition_core(p_id uuid, p_to text, p_notes text) returns text
language plpgsql set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_role public.user_role := public.auth_role(); v_e public.equipment_usage_entries;
  v_legal jsonb := jsonb_build_object('Draft', jsonb_build_array('Submitted'), 'Submitted', jsonb_build_array('Approved','Rejected'),
                                      'Rejected', jsonb_build_array('Draft'), 'Approved', jsonb_build_array('Draft'));
  v_action text; v_locked text; v_claim uuid;
begin
  select * into v_e from public.equipment_usage_entries e where e.id = p_id for update;
  if not found then raise exception 'entry not found' using errcode = 'P0002'; end if;
  -- SECURITY: definer bypasses RLS; this org re-assertion MUST stay.
  if v_e.org_id is distinct from public.auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_e.archived_at is not null then raise exception 'an archived entry cannot move' using errcode = '22023'; end if;
  if p_to is null or not coalesce((v_legal -> v_e.status) ? p_to, false) then
    raise exception 'illegal transition % -> %', v_e.status, p_to using errcode = '22023';
  end if;
  if p_to = 'Submitted' or (v_e.status = 'Rejected' and p_to = 'Draft') then
    if v_uid is distinct from v_e.author_id then raise exception 'not authorized' using errcode = '42501'; end if;
    v_action := case when p_to = 'Submitted' then 'submitted' else 'redraft' end;
  elsif p_to in ('Approved','Rejected') then
    -- SoD FIRST, ALWAYS (FR-EQU-011, the 0180 transition_timesheet order). Do not reorder.
    if v_uid is not distinct from v_e.author_id then raise exception 'separation of duties: cannot decide own equipment usage' using errcode = '42501'; end if;
    if not public.equipment_can_approve(v_uid, v_role, v_e.org_id, v_e.project_id) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    v_action := lower(p_to);
  else  -- Approved -> Draft: Admin reopen (FR-EQU-012), never by the author
    if v_uid is not distinct from v_e.author_id then raise exception 'separation of duties: cannot reopen own equipment usage' using errcode = '42501'; end if;
    if v_role is distinct from 'Admin' then raise exception 'only an Admin reopens approved usage' using errcode = '42501'; end if;
    v_action := 'reopen';
  end if;
  if v_e.status = 'Approved' and p_to = 'Draft' and public.tm_source_is_live('equipment_usage', p_id) then
    select s.claim_id into v_claim from public.tm_claim_sources s where s.source_kind = 'equipment_usage' and s.source_id = p_id and s.is_live limit 1;
    raise exception 'equipment usage belongs to live claim %', v_claim using errcode = '55000';
  end if;
  -- FR-EQU-032: a costing setting saved after the entry was logged (a day entry Rejected before an hours rate existed,
  -- or a race with the setting save) must not let the entry reach a charge in another unit. The author's resubmit and the
  -- approver's decision both re-check; bulk week approval runs this core, so it stops at such an entry with this message.
  if p_to in ('Submitted','Approved') then
    v_locked := public.equipment_entry_locked_unit(v_e.org_id, v_e.asset_id, v_e.work_date);
    if v_locked is not null and v_locked <> v_e.unit then
      raise exception 'this asset is costed per % on that date; this entry is in %', v_locked, v_e.unit using errcode = '22023';
    end if;
  end if;
  update public.equipment_usage_entries
     set status = p_to,
         approver_id = case when p_to in ('Approved','Rejected') then v_uid when p_to = 'Draft' then null else approver_id end,
         approved_at = case when p_to = 'Approved' then now() else null end,
         decision_notes = case when p_to = 'Submitted' and v_e.status = 'Draft' and (v_e.rejected_at is not null or v_e.rejected_by is not null) then null when p_to in ('Approved','Rejected') or v_action = 'reopen' then nullif(btrim(coalesce(p_notes,'')), '')
                               else decision_notes end,
         rejected_by = case when p_to = 'Rejected' then v_uid when p_to = 'Submitted' and v_e.status = 'Draft' then null else rejected_by end,
         rejected_at = case when p_to = 'Rejected' then now() when p_to = 'Submitted' and v_e.status = 'Draft' then null else rejected_at end,
         updated_at = now()
   where id = p_id;
  perform public.log_audit('equipment_usage.' || v_action, v_e.org_id, v_uid, p_id,
    jsonb_build_object('from', v_e.status, 'to', p_to, 'notes', p_notes));
  return p_to;
end $$;
