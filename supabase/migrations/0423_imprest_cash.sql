-- 0423_imprest_cash.sql — #1515 site imprest S2: float records on expense claims, the float-aware
-- transition_expense_claim (custodian pays from their own float, DD-IMP-7), advance returns into a float, the
-- derived cash book, replenishment and funding. Spec §5-§7 · Plan S2. Depends on 0247, 0270, 0422.
-- Proven by imprest_routing, imprest_line_lock, imprest_cash, imprest_replenishment pgTAP and the 0178 allow-list.
-- ⚑ transition_expense_claim below is 0247 §7 VERBATIM plus the lines marked `-- 0423`. record_expense_advance_return
--   is 0270 §1 VERBATIM plus the lines marked `-- 0423`. Reverse = re-create each from this text minus the marked lines.
-- ── REVERSE (manual, in this order; also rollback/0423_imprest_cash_down.sql) ───────────────────────────────────────
--   re-create public.record_expense_advance_return from 0270 §1 (this file's text minus `-- 0423` lines)
--   re-create public.enqueue_expense_return_posting + enqueue_expense_claim_postings from 0270 §4 (this file's text minus `-- 0423` lines)
--   re-create public.transition_expense_claim from 0247 §7 (this file's text minus `-- 0423` lines)
--   drop function if exists public.transition_imprest_replenishment(uuid, text, text, text);
--   drop function if exists public.request_imprest_replenishment(uuid, text);
--   drop function if exists public.imprest_remaining(uuid, date, public.budget_category);
--   drop function if exists public.imprest_drawn(uuid, date, public.budget_category);
--   drop function if exists public.imprest_receipts_waiting(uuid);
--   drop function if exists public.imprest_advances_out(uuid);
--   drop function if exists public.imprest_cash_book(uuid);
--   drop trigger if exists expense_claims_zz_zcheck_float on public.expense_claims;
--   drop function if exists public.check_expense_claim_float();
--   alter table public.expense_claims drop column if exists is_plan_exception, drop column if exists imprest_replenishment_id,
--     drop column if exists imprest_month, drop column if exists imprest_float_id;

-- §1 float records on expense_claims (spec §6 + plan delta 1). All four frozen after submission by 0247 §2.
alter table public.expense_claims
  add column imprest_float_id         uuid references public.imprest_floats(id),
  add column imprest_month            date,
  add column imprest_replenishment_id uuid references public.imprest_replenishments(id),
  add column is_plan_exception        boolean not null default false,
  add constraint expense_claims_imprest_month_first check (imprest_month is null or imprest_month = date_trunc('month', imprest_month)::date),
  add constraint expense_claims_replenishment_on_float check (imprest_replenishment_id is null or imprest_float_id is not null);
create index expense_claims_imprest_month_idx on public.expense_claims (imprest_float_id, imprest_month, budget_category)
  where imprest_float_id is not null;
create index expense_claims_imprest_rep_idx on public.expense_claims (imprest_replenishment_id)
  where imprest_replenishment_id is not null;
grant insert (imprest_float_id) on public.expense_claims to authenticated;
grant update (imprest_float_id) on public.expense_claims to authenticated;
comment on column public.expense_claims.imprest_float_id is
  '#1515 — the site float this record is paid from (DD-IMP-1). Only the float''s custodian pays it (DD-IMP-7).';

-- FR-IMP-020/028, PQ-7. DEFINER: a claimant (Engineer) cannot read imprest_floats. Name sorts after
-- expense_claims_zz_zcheck_advance_link (0247 §2: BEFORE triggers fire in name order; both need org stamped).
create or replace function public.check_expense_claim_float() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f public.imprest_floats%rowtype; v_adv_float uuid;
begin
  if new.advance_id is not null then
    select a.imprest_float_id into v_adv_float from public.expense_claims a where a.id = new.advance_id;
    if v_adv_float is distinct from new.imprest_float_id then
      raise exception 'a claim and the advance it settles must be charged to the same site float (or both to none)'
        using errcode = '23514';
    end if;
  end if;
  if new.imprest_float_id is null then
    return new;
  end if;
  select * into v_f from public.imprest_floats where id = new.imprest_float_id;
  if not found or v_f.org_id is distinct from new.org_id or v_f.archived_at is not null then
    raise exception 'site float not found' using errcode = '23514';
  end if;
  if new.project_id is distinct from v_f.project_id then
    raise exception 'a record charged to a site float must be on that float''s project' using errcode = '23514';
  end if;
  if new.budget_category is null then
    raise exception 'a record charged to a site float needs a budget category' using errcode = '23514';
  end if;
  if new.claimant_id = v_f.custodian_id then
    raise exception 'separation of duties: a custodian cannot charge their own advance or claim to their own float'
      using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.check_expense_claim_float() from public, anon, authenticated;
create trigger expense_claims_zz_zcheck_float
  before insert or update of imprest_float_id, project_id, budget_category, advance_id on public.expense_claims
  for each row execute function public.check_expense_claim_float();

-- §2 the float's figures, derived never stored (D1). SECURITY INVOKER: under the position RPC they see what the caller
-- sees (approval rank sees every claim); under the definers below they see everything.
create or replace function public.imprest_cash_book(p_float uuid) returns numeric
  language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce((select sum(r.amount) from public.imprest_replenishments r
                    where r.float_id = p_float and r.status = 'Paid'), 0)
       - coalesce((select sum(case c.kind when 'advance' then c.amount else c.amount - c.advance_applied end)
                     from public.expense_claims c where c.imprest_float_id = p_float and c.status = 'Paid'), 0)
       + coalesce((select sum(x.amount) from public.expense_advance_returns x
                     join public.expense_claims a on a.id = x.advance_id where a.imprest_float_id = p_float), 0)
$$;
create or replace function public.imprest_advances_out(p_float uuid) returns numeric
  language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(sum(public.expense_advance_outstanding(a.id)), 0) from public.expense_claims a
   where a.imprest_float_id = p_float and a.kind = 'advance' and a.status = 'Paid'
$$;
create or replace function public.imprest_receipts_waiting(p_float uuid) returns numeric
  language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(sum(c.amount), 0) from public.expense_claims c
   where c.imprest_float_id = p_float and c.kind = 'claim' and c.status = 'Paid'
     and not exists (select 1 from public.imprest_replenishments r where r.id = c.imprest_replenishment_id and r.status = 'Paid')
$$;
-- FR-IMP-022: approved/paid claims at full amount + approved/paid advances at outstanding; settling moves the applied
-- part from the advance to the claim, so nothing counts twice.
create or replace function public.imprest_drawn(p_float uuid, p_month date, p_category public.budget_category)
returns numeric language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(sum(case c.kind when 'claim' then c.amount else public.expense_advance_outstanding(c.id) end), 0)
    from public.expense_claims c
   where c.imprest_float_id = p_float and c.imprest_month = p_month and c.budget_category = p_category
     and c.status in ('Approved','Paid')
$$;
-- FR-IMP-023: 0 with no approved plan or no line; never negative.
create or replace function public.imprest_remaining(p_float uuid, p_month date, p_category public.budget_category)
returns numeric language sql stable security invoker set search_path = public, pg_temp as $$
  select greatest(coalesce((select l.planned_amount from public.imprest_plans p
                              join public.imprest_plan_lines l on l.plan_id = p.id
                             where p.float_id = p_float and p.month = p_month and p.status = 'Approved'
                               and l.budget_category = p_category), 0)
                  - public.imprest_drawn(p_float, p_month, p_category), 0)
$$;
revoke all on function public.imprest_cash_book(uuid), public.imprest_advances_out(uuid), public.imprest_receipts_waiting(uuid),
  public.imprest_drawn(uuid, date, public.budget_category), public.imprest_remaining(uuid, date, public.budget_category)
  from public, anon;
grant execute on function public.imprest_cash_book(uuid), public.imprest_advances_out(uuid), public.imprest_receipts_waiting(uuid),
  public.imprest_drawn(uuid, date, public.budget_category), public.imprest_remaining(uuid, date, public.budget_category)
  to authenticated;

-- §3 transition_expense_claim: 0247 §7 VERBATIM plus the lines marked `-- 0423` (FR-IMP-021/024/026, DD-IMP-3/5/7).
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
    rejection_notes   = case when p_to = 'Rejected' then p_notes else rejection_notes end,
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
revoke all on function public.transition_expense_claim(uuid, public.expense_claim_status, text, text) from public, anon;
grant execute on function public.transition_expense_claim(uuid, public.expense_claim_status, text, text) to authenticated;

-- §4 record_expense_advance_return: 0270 §1 VERBATIM plus the lines marked `-- 0423` (FR-IMP-027). Off-float the
-- refusal keeps 0270's text (expense_advances pgTAP asserts it); a float advance names the custodian.
create or replace function public.record_expense_advance_return(p_id uuid, p_amount numeric, p_reference text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row  public.expense_claims%rowtype;
  v_out  numeric;
  v_uid  uuid      := auth.uid();
  v_role user_role := auth_role();
  v_float public.imprest_floats%rowtype;                                                   -- 0423
begin
  perform public.assert_is_active_member();
  select * into v_row from public.expense_claims where id = p_id for update;
  if not found then
    raise exception 'expense advance not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_row.kind is distinct from 'advance' or v_row.status is distinct from 'Paid' then
    raise exception 'only a paid advance can have cash returned against it' using errcode = 'P0001';
  end if;
  if v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot record a return of their own advance' using errcode = '42501';
  end if;
  if v_row.imprest_float_id is not null then                                               -- 0423
    select * into v_float from public.imprest_floats where id = v_row.imprest_float_id;    -- 0423
    perform public.imprest_lock_float(v_row.imprest_float_id);                             -- 0423 (advance → float)
  end if;                                                                                  -- 0423
  if v_role is distinct from 'Finance' and v_role is distinct from 'Admin'                 -- 0423 (edited: `then` moved down)
     and not (v_row.imprest_float_id is not null and v_uid = v_float.custodian_id          -- 0423 FR-IMP-027
              and public.imprest_custodian_eligible(v_row.org_id, v_float.project_id, v_uid)) then  -- 0423
    if v_row.imprest_float_id is not null then                                             -- 0423
      raise exception 'only Finance, an Admin or the float''s custodian records an advance return' using errcode = '42501';  -- 0423
    end if;                                                                                -- 0423
    raise exception 'only Finance or an Admin records an advance return' using errcode = '42501';
  end if;
  if p_amount is null or not (p_amount > 0 and p_amount < 'Infinity'::numeric) then
    raise exception 'a return amount must be greater than zero' using errcode = 'P0001';
  end if;
  v_out := public.expense_advance_outstanding(p_id);
  if p_amount > v_out then
    raise exception 'a return of % exceeds the % still outstanding on this advance', round(p_amount, 2), round(v_out, 2)
      using errcode = 'P0001';
  end if;
  update public.expense_claims set returned_amount = returned_amount + p_amount where id = p_id;
  -- 0270 (DD-EXP-17): the return as its own row — the subject of its advance-return posting.
  insert into public.expense_advance_returns (org_id, advance_id, amount, reference, recorded_by, returned_on)
  values (v_row.org_id, p_id, p_amount, nullif(btrim(p_reference), ''), v_uid,
          (now() at time zone coalesce((select o.default_timezone from public.organizations o where o.id = v_row.org_id),
                                       'UTC'))::date);
  perform public.log_audit('expense_advance.return', v_row.org_id, v_uid, p_id,
    jsonb_build_object('amount', p_amount, 'reference', nullif(btrim(p_reference), ''), 'outstanding_after', v_out - p_amount));
end; $$;
revoke all on function public.record_expense_advance_return(uuid, numeric, text) from public, anon;
grant execute on function public.record_expense_advance_return(uuid, numeric, text) to authenticated;

-- §5 replenishment and funding. The client sends the float (and the kind) only, never an amount or claims (FR-IMP-050).
create or replace function public.request_imprest_replenishment(p_float uuid, p_kind text default 'replenishment')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f public.imprest_floats%rowtype; v_uid uuid := auth.uid(); v_id uuid; v_amount numeric; v_gap numeric;
begin
  perform public.assert_is_active_member();
  select * into v_f from public.imprest_floats where id = p_float;
  if not found or v_f.org_id is distinct from public.auth_org_id() or v_f.archived_at is not null then
    raise exception 'site float not found' using errcode = 'P0002';
  end if;
  if v_uid is distinct from v_f.custodian_id or not public.imprest_custodian_eligible(v_f.org_id, v_f.project_id, v_uid) then
    raise exception 'only this site float''s custodian requests its cash' using errcode = '42501';
  end if;
  if p_kind not in ('replenishment','funding') then
    raise exception 'unknown request kind %', p_kind using errcode = 'P0001';
  end if;
  perform public.imprest_lock_float(p_float);
  if p_kind = 'funding' then
    if exists (select 1 from public.imprest_replenishments r where r.float_id = p_float and r.kind = 'funding'
                 and r.status in ('Requested','Approved')) then
      raise exception 'a funding request for this float is already open' using errcode = 'P0001';
    end if;
    v_gap := v_f.float_amount - (public.imprest_cash_book(p_float) + public.imprest_advances_out(p_float)
                                 + public.imprest_receipts_waiting(p_float));
    if not (v_gap > 0) then
      raise exception 'this float is fully funded' using errcode = 'P0001';
    end if;
    v_amount := v_gap;
  else
    select coalesce(sum(c.amount), 0) into v_amount from public.expense_claims c
     where c.imprest_float_id = p_float and c.kind = 'claim' and c.status = 'Paid' and c.imprest_replenishment_id is null;
    if not (v_amount > 0) then
      raise exception 'there are no settled receipts waiting to be replenished' using errcode = 'P0001';
    end if;
  end if;
  insert into public.imprest_replenishments (org_id, float_id, kind, number, amount, requested_by)
  values (v_f.org_id, p_float, p_kind, public.next_procurement_doc_number(v_f.org_id, 'REP'), v_amount, v_uid)
  returning id into v_id;
  if p_kind = 'replenishment' then
    update public.expense_claims set imprest_replenishment_id = v_id
     where imprest_float_id = p_float and kind = 'claim' and status = 'Paid' and imprest_replenishment_id is null;
  end if;
  perform public.log_audit('imprest_replenishment.requested', v_f.org_id, v_uid, v_id,
    jsonb_build_object('float_id', p_float, 'kind', p_kind, 'amount', v_amount));
  return v_id;
end; $$;
revoke all on function public.request_imprest_replenishment(uuid, text) from public, anon;
grant execute on function public.request_imprest_replenishment(uuid, text) to authenticated;

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
revoke all on function public.transition_imprest_replenishment(uuid, text, text, text) from public, anon;
grant execute on function public.transition_imprest_replenishment(uuid, text, text, text) to authenticated;

-- §6 PQ-11 (moved forward from S6 so this slice ships alone): a float record whose float has no ERP cash account posts
-- nothing — no approval, payment, settlement or return. Off-float records keep phase B. 0270 §4 VERBATIM plus the lines
-- marked `-- 0423`; rollback/0423 restores the 0270 text.
create or replace function public.enqueue_expense_claim_postings() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.org_employs_expense_postings(new.org_id) then
    return new;
  end if;
  if new.imprest_float_id is not null and not exists (select 1 from public.imprest_floats f      -- 0423 PQ-11
       where f.id = new.imprest_float_id and f.erp_cash_account_ref is not null) then           -- 0423
    return new;                                                                                 -- 0423
  end if;                                                                                       -- 0423
  if new.kind = 'claim' and new.status = 'Approved' then
    perform public.enqueue_expense_posting(new.org_id, new.id, null, 'approval', new.approved_at, new.approved_by_id);
  elsif new.kind = 'claim' and new.status = 'Paid' then
    if new.amount - new.advance_applied > 0 then
      perform public.enqueue_expense_posting(new.org_id, new.id, null, 'claim-payment', new.paid_at, new.paid_by_id);
    end if;
    if new.advance_applied > 0 then
      perform public.enqueue_expense_posting(new.org_id, new.id, null, 'settlement', new.paid_at, new.paid_by_id);
    end if;
  elsif new.kind = 'advance' and new.status = 'Paid' then
    perform public.enqueue_expense_posting(new.org_id, new.id, null, 'advance-payment', new.paid_at, new.paid_by_id);
  elsif new.kind = 'claim' and old.status = 'Approved' and new.status = 'Cancelled'
        and exists (select 1 from public.expense_posting_erp_mirror m
                     where m.org_id = new.org_id and m.posting_identity = new.id::text || ':approval') then
    perform public.enqueue_expense_posting(new.org_id, new.id, null, 'approval-cancel', new.cancelled_at, auth.uid());
  end if;
  return new;
end; $$;
revoke all on function public.enqueue_expense_claim_postings() from public, anon, authenticated, service_role;

create or replace function public.enqueue_expense_return_posting() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.org_employs_expense_postings(new.org_id)
     and not exists (select 1 from public.expense_claims a join public.imprest_floats f on f.id = a.imprest_float_id  -- 0423 PQ-11
                      where a.id = new.advance_id and f.erp_cash_account_ref is null) then                           -- 0423 (edited: `then` moved down)
    perform public.enqueue_expense_posting(new.org_id, new.advance_id, new.id, 'advance-return', new.recorded_at,
                                           new.recorded_by);
  end if;
  return new;
end; $$;
revoke all on function public.enqueue_expense_return_posting() from public, anon, authenticated, service_role;

-- §7 closing self-assertion (0422 §8 style): fail the migration if the ACL shape is wrong.
do $$
declare v text;
begin
  foreach v in array array['public.request_imprest_replenishment(uuid, text)',
    'public.transition_imprest_replenishment(uuid, text, text, text)',
    'public.transition_expense_claim(uuid, public.expense_claim_status, text, text)',
    'public.record_expense_advance_return(uuid, numeric, text)',
    'public.imprest_cash_book(uuid)', 'public.imprest_advances_out(uuid)', 'public.imprest_receipts_waiting(uuid)',
    'public.imprest_drawn(uuid, date, public.budget_category)',
    'public.imprest_remaining(uuid, date, public.budget_category)'] loop
    if has_function_privilege('anon', v, 'EXECUTE') or not has_function_privilege('authenticated', v, 'EXECUTE') then
      raise exception '0423: % ACL is not the intended shape', v;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.check_expense_claim_float()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.check_expense_claim_float()', 'EXECUTE') then
    raise exception '0423: internal check_expense_claim_float() is client-executable';
  end if;
  if has_column_privilege('authenticated', 'public.expense_claims', 'imprest_replenishment_id', 'INSERT,UPDATE')
     or has_column_privilege('authenticated', 'public.expense_claims', 'imprest_month', 'INSERT,UPDATE')
     or has_column_privilege('authenticated', 'public.expense_claims', 'is_plan_exception', 'INSERT,UPDATE') then
    raise exception '0423: a server-written float column is client-writable';
  end if;
end $$;
