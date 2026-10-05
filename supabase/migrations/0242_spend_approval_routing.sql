-- 0242_spend_approval_routing.sql — #803 approval routing by budget.
-- Spec: docs/specs/approval-routing-by-budget.spec.md · ADR-0075 · Plan: docs/plans/2026-10-06-approval-routing-by-budget.md
-- Proven by supabase/tests/spend_approvers_config.test.sql, spend_approval_classify.test.sql,
--   spend_approval_enforce.test.sql, spend_approval_inputs_frozen.test.sql, spend_approval_line_lock.test.sql,
--   spend_approval_notify.test.sql.
--
-- Routing NARROWS OD-PROC-1; it never widens it. transition_procurement keeps 0180's active-member gate,
-- SoD-a, SoD-b and role matrix verbatim and gains ONE extra refusal (§7). With no spend_approvers rows the
-- behaviour is exactly 0180's.
--
-- §1 procurements.budget_category · §2 holds_spend_approval_authority · §3 spend_approvers (+RLS, stamp, audit)
-- §4 procurement_request_amount · §5 spend_approval_route (THE rule; #775/#788 reuse it)
-- §6 get_procurement_approval_routes (UI read) · §7 transition_procurement · §8 routing inputs frozen
-- §9 notify_procurement_transition (#788 recipients follow the route)
--
-- ── REVERSE (manual, in this order — not `db reset`; prod data may exist) ───────────────────────────
--   -- §9: re-create notify_procurement_transition from THIS file's §9 text minus every line marked `0242`,
--   --     restoring the plain `and p.role in ('Admin','Project Manager','Finance','Executive')` filter.
--   drop trigger if exists procurements_routing_inputs_frozen on public.procurements;
--   drop function if exists public.assert_procurement_routing_inputs_frozen();
--   -- §7: re-create transition_procurement from THIS file's §7 text minus every line marked `0242`
--   --     (the five extra declare vars, the widened select-into, the routing block). What remains is
--   --     0180's body. Reverse by editing this text, never by "re-applying migration NNN".
--   drop function if exists public.get_procurement_approval_routes(uuid[]);
--   drop function if exists public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid);
--   drop function if exists public.procurement_request_amount(uuid);
--   drop table if exists public.spend_approvers;   -- drops its policies and triggers
--   drop function if exists public.audit_spend_approver_change();
--   drop function if exists public.holds_spend_approval_authority(user_role);
--   revoke insert (budget_category), update (budget_category) on public.procurements from authenticated;
--   alter table public.procurements drop column if exists budget_category;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the routing input the schema lacked: which budget line a request spends against.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.procurements add column budget_category public.budget_category;
comment on column public.procurements.budget_category is
  '#803: the Active-budget category line this request spends against. Decides approval routing '
  '(spend_approval_route). NULL on a project request routes to the senior set (fit unknowable). '
  'Client-writable only while Draft/Rejected (§8).';
grant insert (budget_category) on public.procurements to authenticated;
grant update (budget_category) on public.procurements to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — approval rank as rank, not a role list (ADR-0070). ≥ Project Manager == today's OD-PROC-1 approver
-- population plus Admin, so a named approver always also passes the unchanged role matrix in §7.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.holds_spend_approval_authority(p_role user_role) returns boolean
  language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(public.role_rank(p_role) >= public.role_rank('Project Manager'), false)
$$;
revoke all on function public.holds_spend_approval_authority(user_role) from public, anon;
grant execute on function public.holds_spend_approval_authority(user_role) to authenticated;
-- The FE read path (§6) runs as the caller, so the caller must be able to execute role_rank: 0178 already
-- grants it to authenticated (with role_outranks / holds_won_value_authority), so no grant is repeated here.

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — spend_approvers: project row = that project's approver; null project = the org's senior set.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create table public.spend_approvers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  project_id  uuid references public.projects(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) default auth.uid(),
  constraint spend_approvers_unique unique nulls not distinct (org_id, project_id, profile_id)
);
create index spend_approvers_org_project_idx on public.spend_approvers (org_id, project_id);

-- 0074 idiom: the caller's real org overrides the seed-org default. No client sends org_id.
create trigger spend_approvers_stamp_org_id
  before insert on public.spend_approvers
  for each row execute function public.stamp_org_id();

alter table public.spend_approvers enable row level security;
alter table public.spend_approvers force  row level security;

create policy spend_approvers_select on public.spend_approvers for select
  using (org_id = auth_org_id() and public.is_active_member());

create policy spend_approvers_insert on public.spend_approvers for insert
  with check (
    org_id = auth_org_id() and public.is_active_member() and auth_role() = 'Admin'
    and exists (select 1 from public.profiles pf
                 where pf.id = spend_approvers.profile_id and pf.org_id = auth_org_id()
                   and pf.status = 'active' and public.holds_spend_approval_authority(pf.role))
    and (spend_approvers.project_id is null
         or exists (select 1 from public.projects p
                     where p.id = spend_approvers.project_id and p.org_id = auth_org_id()))
  );

create policy spend_approvers_delete on public.spend_approvers for delete
  using (org_id = auth_org_id() and public.is_active_member() and auth_role() = 'Admin');

revoke all on public.spend_approvers from anon, authenticated;
grant select on public.spend_approvers to authenticated;
grant insert (project_id, profile_id) on public.spend_approvers to authenticated;
grant delete on public.spend_approvers to authenticated;

create or replace function public.audit_spend_approver_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('spend_approver.add', new.org_id, auth.uid(), new.id,
      jsonb_build_object('project_id', new.project_id, 'profile_id', new.profile_id));
    return new;
  end if;
  perform public.log_audit('spend_approver.remove', old.org_id, auth.uid(), old.id,
    jsonb_build_object('project_id', old.project_id, 'profile_id', old.profile_id));
  return old;
end; $$;
revoke all on function public.audit_spend_approver_change() from public, anon, authenticated;

create trigger spend_approvers_audit
  after insert or delete on public.spend_approvers
  for each row execute function public.audit_spend_approver_change();

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — request amount = greater of header total and Σ line items (DD-APR-2). App-raised requests keep
-- total_value = 0 until a quote is selected, so header-only would route a large request as "within".
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.procurement_request_amount(p_procurement_id uuid) returns numeric
  language sql stable security invoker set search_path = public, pg_temp as $$
  select greatest(p.total_value,
                  coalesce((select sum(i.amount) from public.procurement_items i where i.procurement_id = p.id), 0))
    from public.procurements p
   where p.id = p_procurement_id
$$;
revoke all on function public.procurement_request_amount(uuid) from public, anon;
grant execute on function public.procurement_request_amount(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — THE rule (FR-APR-010…015). Record-agnostic so #775 (claims) calls it unchanged and #788 reads its
-- approver_ids as notification recipients. SECURITY INVOKER: under the UI it runs as the caller (RLS
-- scopes every read); under transition_procurement (definer) it runs as the owner, which is why every
-- read below filters org_id = p_org_id explicitly.
-- Eligibility = active profile (status — the caller path cannot read auth.users; the transition's own
-- assert_is_active_member() still refuses an out-of-band ban) + approval rank + not the requester.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.spend_approval_route(
  p_org_id       uuid,
  p_project_id   uuid,
  p_category     public.budget_category,
  p_amount       numeric,
  p_currency     text,
  p_requester_id uuid
) returns table (route text, reason text, approver_ids uuid[], line_budget numeric, line_used numeric)
  language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_reason   text;
  v_budget   numeric;
  v_used     numeric;
  v_currency text;
  v_foreign  boolean;
  v_rows     int;
  v_eligible uuid[];
begin
  -- 1. Classify (DD-APR-2).
  if p_project_id is null then
    v_reason := 'no_project';
  elsif p_category is null then
    v_reason := 'no_category';
  else
    select v.currency into v_currency
      from public.budget_versions v
     where v.org_id = p_org_id and v.project_id = p_project_id and v.status = 'Active';
    if not found then
      v_reason := 'no_active_budget';
    else
      select coalesce(sum(li.budgeted_amount), 0) into v_budget
        from public.budget_line_items li
        join public.budget_versions v on v.id = li.budget_version_id
       where v.org_id = p_org_id and v.project_id = p_project_id and v.status = 'Active'
         and li.category = p_category;
      -- Reserved (ADR-0034) ∪ Committed (OD-BUDGET-2) on this line. The request being decided is
      -- 'Requested', so it is never in its own sum.
      select coalesce(sum(public.procurement_request_amount(pr.id)), 0),
             coalesce(bool_or(pr.currency is distinct from v_currency), false)
        into v_used, v_foreign
        from public.procurements pr
       where pr.org_id = p_org_id and pr.project_id = p_project_id and pr.budget_category = p_category
         and pr.status in ('Approved','Vendor Quoted','Quote Selected','Ordered','Received','Vendor Invoiced','Paid');
      if p_currency is distinct from v_currency or v_foreign then
        v_reason := 'currency_mismatch';
      elsif v_used + p_amount > v_budget then
        v_reason := 'exceeds_line';
      else
        v_reason := 'within_budget';
      end if;
    end if;
  end if;

  -- 2. Within budget → the project's approvers (FR-APR-012/013/014).
  if v_reason = 'within_budget' then
    select count(*),
           coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
             where sa.profile_id is distinct from p_requester_id
               and pf.status = 'active'
               and pf.org_id = p_org_id
               and public.holds_spend_approval_authority(pf.role)), '{}')
      into v_rows, v_eligible
      from public.spend_approvers sa
      join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = p_org_id and sa.project_id = p_project_id;
    if v_rows = 0 then
      return query select 'flat'::text, v_reason, null::uuid[], v_budget, v_used;  -- unconfigured
      return;
    elsif cardinality(v_eligible) > 0 then
      return query select 'project'::text, v_reason, v_eligible, v_budget, v_used;
      return;
    end if;
    -- configured, nobody eligible → escalate to the senior set (FR-APR-014)
  end if;

  -- 3. The senior set (FR-APR-012/015).
  select coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
           where sa.profile_id is distinct from p_requester_id
             and pf.status = 'active'
             and pf.org_id = p_org_id
             and public.holds_spend_approval_authority(pf.role)), '{}')
    into v_eligible
    from public.spend_approvers sa
    join public.profiles pf on pf.id = sa.profile_id
   where sa.org_id = p_org_id and sa.project_id is null;
  if cardinality(v_eligible) > 0 then
    return query select 'org'::text, v_reason, v_eligible, v_budget, v_used;
    return;
  end if;
  return query select 'flat'::text, v_reason, null::uuid[], v_budget, v_used;
end; $$;
revoke all on function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid) from public, anon;
grant execute on function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — the UI read (FR-APR-021): one call for every listed Requested request. SECURITY INVOKER — RLS on
-- procurements is the org boundary; an id the caller cannot see yields no row.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.get_procurement_approval_routes(p_ids uuid[])
returns table (procurement_id uuid, route text, reason text, approvers jsonb,
               request_amount numeric, line_budget numeric, line_used numeric)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select p.id, r.route, r.reason,
         coalesce((select jsonb_agg(jsonb_build_object('id', pf.id, 'full_name', pf.full_name) order by pf.full_name)
                     from public.profiles pf where pf.id = any (r.approver_ids)), '[]'::jsonb),
         a.amount, r.line_budget, r.line_used
    from public.procurements p
    cross join lateral (select public.procurement_request_amount(p.id) as amount) a
    cross join lateral public.spend_approval_route(p.org_id, p.project_id, p.budget_category,
                                                   a.amount, p.currency, p.requested_by_id) r
   where p.id = any (p_ids) and p.status = 'Requested'
$$;
revoke all on function public.get_procurement_approval_routes(uuid[]) from public, anon;
grant execute on function public.get_procurement_approval_routes(uuid[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — transition_procurement: 0180's body VERBATIM plus the lines marked `0242`. Order is load-bearing:
-- active-member gate → org → legality → SoD-a → SoD-b → ROUTING (new) → role matrix. Routing sits AFTER
-- SoD-a so the requester is refused by SoD whoever is named, and BEFORE the matrix so it only narrows.
-- create-or-replace keeps the existing ACL (0185 revoked anon; authenticated EXECUTE unchanged).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from        procurement_status;
  v_org         uuid;
  v_requester   uuid;
  v_approver    uuid;
  v_project     uuid;                    -- 0242
  v_category    public.budget_category;  -- 0242
  v_currency    text;                    -- 0242
  v_amount      numeric;                 -- 0242
  v_route       record;                  -- 0242
  v_role        user_role := auth_role();
  v_uid         uuid      := auth.uid();
  v_is_admin    boolean;
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled'),
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled'),
    'Vendor Quoted',   jsonb_build_array('Quote Selected','Cancelled'),
    'Quote Selected',  jsonb_build_array('Ordered','Cancelled'),
    'Ordered',         jsonb_build_array('Received','Cancelled'),
    'Received',        jsonb_build_array('Vendor Invoiced','Cancelled'),
    'Vendor Invoiced', jsonb_build_array('Paid','Cancelled'),
    'Rejected',        jsonb_build_array('Draft'),
    'Paid',            jsonb_build_array(),
    'Cancelled',       jsonb_build_array()
  );
  v_allowed_roles text[];
begin
  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller. public.capture_vendor_invoice also calls this, but it
  -- is itself a definer invoked under the caller's JWT, so auth.uid() flows through unchanged.
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');

  select status, org_id, requested_by_id, approved_by_id,
         project_id, budget_category, currency                       -- 0242
    into v_from, v_org, v_requester, v_approver,
         v_project, v_category, v_currency                           -- 0242
    from public.procurements where id = p_id for update;
  if v_from is null then
    raise exception 'procurement not found' using errcode = 'P0002';
  end if;

  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- SoD-a (requester ≠ approver): the requester may not Approve/Reject their own procurement.
  -- SECURITY: this check MUST run OUTSIDE the Admin-skip — Admin cannot self-approve (OD-PROC-8).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
    raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
  end if;

  -- SoD-b (approver ≠ payer): the approver may not mark their own approved procurement Paid.
  -- SECURITY: this check MUST run OUTSIDE the Admin-skip — Admin cannot self-pay (OD-PROC-8).
  if v_from = 'Vendor Invoiced' and p_to = 'Paid' and v_uid = v_approver then
    raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
  end if;

  -- 0242 (#803, FR-APR-010…019): approval routing by budget. Narrows who may decide; never widens.
  -- The line lock serializes concurrent approvals on one (project, category) so two cannot both spend
  -- the same headroom (FR-APR-018). The classify statement below runs AFTER the lock is held, so its
  -- snapshot sees any approval that committed while we waited (READ COMMITTED, volatile caller).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') then                         -- 0242
    if v_project is not null and v_category is not null then                               -- 0242
      perform pg_advisory_xact_lock(                                                       -- 0242
        hashtextextended('spend-line:' || v_project::text || ':' || v_category::text, 0)); -- 0242
    end if;                                                                                -- 0242
    v_amount := public.procurement_request_amount(p_id);                                   -- 0242
    select * into v_route                                                                  -- 0242
      from public.spend_approval_route(v_org, v_project, v_category, v_amount, v_currency, v_requester); -- 0242
    -- coalesce: a NULL here must refuse, never pass (an `if` on NULL does not fire).      -- 0242
    if v_route.route <> 'flat' and not v_is_admin                                          -- 0242
       and not coalesce(v_uid = any (v_route.approver_ids), false) then                    -- 0242
      raise exception 'approval routing: % requires a named approver', v_route.reason     -- 0242
        using errcode = '42501';                                                           -- 0242
    end if;                                                                                -- 0242
    perform public.log_audit('procurement.approval_route', v_org, v_uid, p_id,             -- 0242
      jsonb_build_object(                                                                  -- 0242
        'to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,                -- 0242
        'request_amount', v_amount, 'line_budget', v_route.line_budget,                    -- 0242
        'line_used', v_route.line_used, 'budget_category', v_category::text,               -- 0242
        'break_glass', (v_route.route <> 'flat' and v_is_admin                             -- 0242
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));    -- 0242
  end if;                                                                                  -- 0242

  if not v_is_admin then
    declare v_is_requester boolean := (v_uid is not null and v_uid = v_requester);
    begin
      if p_to = 'Cancelled' then
        if v_from in ('Draft','Requested') and v_is_requester then
          v_allowed_roles := array['Executive','Project Manager','Finance','Engineer'];
        else
          v_allowed_roles := array['Project Manager','Finance','Executive'];
        end if;
      else
        v_allowed_roles := case
          when v_from = 'Draft'           and p_to = 'Requested'       then array['Executive','Project Manager','Finance','Engineer']
          when v_from = 'Requested'       and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'        and p_to = 'Draft'           then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'        and p_to = 'Vendor Quoted'   then array['Project Manager','Finance']
          when v_from = 'Approved'        and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Vendor Quoted'   and p_to = 'Quote Selected'  then array['Project Manager','Finance']
          when v_from = 'Quote Selected'  and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Ordered'         and p_to = 'Received'        then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end
          when v_from = 'Received'        and p_to = 'Vendor Invoiced' then array['Finance']
          when v_from = 'Vendor Invoiced' and p_to = 'Paid'            then array['Finance']
          else array[]::text[]
        end;
      end if;

      if not (v_role::text = any (v_allowed_roles)) then
        raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
      end if;
    end;
  end if;

  -- Atomic single update: + FR-FIN-DEBT-002 vendor_invoiced_at stamp (fires ONLY on →'Vendor Invoiced',
  -- coalesce so a re-entry can't blank it; mirrors the approved_by_id/pr_number conditional stamps).
  update public.procurements set
    status             = p_to,
    pr_number          = case when p_to = 'Requested' then coalesce(pr_number, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number          = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id     = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes     = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes    = case when p_to = 'Rejected' then p_notes else rejection_notes end,
    vendor_invoiced_at = case when p_to = 'Vendor Invoiced' then now() else vendor_invoiced_at end,
    updated_at         = now()
  where id = p_id;

  -- FR-PR-016 / OQ-3: write the just-minted number onto the owning RECORD row (idempotent per [PD-3]).
  if p_to = 'Requested' then
    insert into public.purchase_requests (procurement_id, pr_number, status, date)
    select p_id, p.pr_number, 'Submitted', current_date
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.purchase_requests pr
                        where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date)
    select p_id, p.po_number, 'Issued', current_date
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.purchase_orders po
                        where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    insert into public.payments (procurement_id, pay_number, status, date, amount)
    select p_id, next_procurement_doc_number(v_org, 'PAY'), 'Paid', current_date, p.total_value
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.payments pay where pay.procurement_id = p_id);
  end if;

  -- [PD-7 / FR-PR-025] append this transition to the status-event log (append-only; actor = caller).
  -- v_from = current status captured BEFORE the status update above (same value SoD/map validation read).
  -- v_org = the RPC's existing org local.
  insert into public.procurement_status_events
    (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_id, v_org, v_from, p_to, auth.uid(), p_notes);
end; $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — FR-APR-020: once submitted, the routing inputs are fixed for every RLS-subject caller. Server
-- paths (SECURITY DEFINER owned by a BYPASSRLS role — select_procurement_quote, the importer, the ERP
-- read-model writers) are exempt through actor_bypasses_rls(), the 0174 idiom. Rejected is editable
-- because the requester reworks it back to Draft.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.assert_procurement_routing_inputs_frozen() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if public.actor_bypasses_rls() or old.status in ('Draft','Rejected') then
    return new;
  end if;
  if new.project_id is distinct from old.project_id then
    raise exception 'procurements.project_id cannot change after the request is submitted: approval routing was decided on it'
      using errcode = '42501';
  end if;
  if new.budget_category is distinct from old.budget_category then
    raise exception 'procurements.budget_category cannot change after the request is submitted: approval routing was decided on it'
      using errcode = '42501';
  end if;
  if new.total_value is distinct from old.total_value then
    raise exception 'procurements.total_value cannot change after the request is submitted: approval routing was decided on it'
      using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.assert_procurement_routing_inputs_frozen() from public, anon, authenticated;

create trigger procurements_routing_inputs_frozen
  before update on public.procurements
  for each row execute function public.assert_procurement_routing_inputs_frozen();

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §9 — FR-APR-040 (#788 seam): "awaits approval" goes to the people the route lets decide. 0237's body
-- VERBATIM except the Draft→Requested recipient set (lines marked `0242`): when spend_approval_route names
-- approvers, they are the recipients; on route `flat` (nothing configured, or nobody eligible) 0237's
-- OD-PROC-1 role list still applies. Same function, same inputs as §7 — the rule has one copy. The route
-- is read at submit time; §7 re-reads it at decision time, so a line that filled up in between escalates
-- the decision (the senior set may then decide a request whose notice went to the project approver).
-- create-or-replace keeps 0237's trigger and its revoked ACL.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.notify_procurement_transition() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
        v_route record;                                                                    -- 0242
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'Requested' and old.status = 'Draft' then
    select * into v_route                                                                  -- 0242
      from public.spend_approval_route(new.org_id, new.project_id, new.budget_category,   -- 0242
             public.procurement_request_amount(new.id), new.currency, new.requested_by_id); -- 0242
    -- Approver population = transition_procurement's Requested→Approved/Rejected arm (OD-PROC-1) minus the requester (SoD-a).
    -- ⚑ MIRRORS the role list in public.transition_procurement (0180 — Admin short-circuits its role check;
    -- Project Manager/Finance/Executive are its v_allowed_roles). A change there MUST change this list too.
    for r in select p.id from public.profiles p
              where p.org_id = new.org_id
                and p.id is distinct from new.requested_by_id
                and case when v_route.route is distinct from 'flat'                       -- 0242
                         then p.id = any (v_route.approver_ids)                           -- 0242
                         else p.role in ('Admin','Project Manager','Finance','Executive') -- 0242
                    end                                                                    -- 0242
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
