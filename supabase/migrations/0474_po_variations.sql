-- 0474_po_variations.sql — #1513 S4: quantity variations on a subcontract PO ride the shipped spend approval; an approved
-- variation becomes a numbered PO revision; a cost variation can be linked to an existing client work order.
-- Spec docs/specs/subcontract-acceptance.spec.md (signed 2026-11-01) · Plan docs/plans/2026-11-01-subcontract-acceptance.md S4.
-- Proven by supabase/tests/po_variations.test.sql, subcontract_tenancy.test.sql and the 0178 allow-list.
-- ── REVERSE (also rollback/0474_po_variations_down.sql; refused while rows exist, NFR-SCA-007) ──
--   do $$ begin if exists (select 1 from public.po_variations) or exists (select 1 from public.po_variation_lines)
--     then raise exception 'rollback refused: PO variations exist — export and remove them first'; end if; end $$;
--   drop function if exists public.project_subcontract_exposure(uuid);
--   drop function if exists public.subcontract_po_position(uuid);   re-create it from 0472_subcontract_bill_caps.sql §5 (no `disputed`);
--   drop function if exists public.work_order_cost_variations(uuid);
--   drop function if exists public.link_po_variation(uuid, uuid, text);
--   drop function if exists public.issue_po_revision(uuid);
--   drop function if exists public.decide_po_variation(uuid, boolean, text);
--   drop function if exists public.po_variation_route(uuid);
--   drop function if exists public.request_po_variation(uuid, text, jsonb, text);
--   alter table public.purchase_order_revisions drop constraint if exists purchase_order_revisions_variation_fk;
--   drop table if exists public.po_variation_lines;   drop table if exists public.po_variations;   (drop their triggers)
--   drop function if exists public.guard_po_variation_line();   drop function if exists public.guard_po_variation();
--   (procurements.amount_approved_by_id is a shipped column; nothing to undo. Approved variations already raised
--   procurements.total_value / approved_total_value: that spend approval stands and is not reversed here.)

-- §1 Tables. Written only by the four definers below, under the pmo.po_variation_write flag; org_id is stamped from the PO (D6).
create table public.po_variations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  po_id uuid not null references public.purchase_orders(id),
  procurement_id uuid not null references public.procurements(id),
  project_id uuid not null references public.projects(id),
  number text not null,
  origin text not null check (origin in ('pre_work','post_work')),
  status text not null default 'Requested' check (status in ('Requested','Approved','Revised','Rejected','Disputed')),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  amount numeric(14,2) not null check (amount >= 0),
  requested_by uuid not null references public.profiles(id),
  requested_at timestamptz not null default clock_timestamp(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decided_notes text check (decided_notes is null or length(decided_notes) <= 1000),
  revision integer,
  work_order_id uuid references public.work_orders(id),
  not_passed_reason text check (not_passed_reason is null or length(btrim(not_passed_reason)) between 1 and 500),
  linked_by uuid references public.profiles(id),
  linked_at timestamptz,
  constraint po_variations_link_one check (work_order_id is null or not_passed_reason is null),
  constraint po_variations_approved_pair check ((status in ('Approved','Revised')) = (approved_by is not null and approved_at is not null)),
  constraint po_variations_rejected_origin check (status <> 'Disputed' or origin = 'post_work'),
  constraint po_variations_rejected_pre check (status <> 'Rejected' or origin = 'pre_work'),
  unique (org_id, number)
);
create index po_variations_po_idx on public.po_variations (po_id, status);
create index po_variations_project_idx on public.po_variations (org_id, project_id, status);
create index po_variations_work_order_idx on public.po_variations (work_order_id);
create table public.po_variation_lines (
  org_id uuid not null references public.organizations(id),                -- stamped from the variation, never the client (D6)
  variation_id uuid not null references public.po_variations(id),
  boq_item_id uuid not null references public.boq_items(id),
  additional_quantity numeric(14,3) not null check (additional_quantity > 0 and additional_quantity < 'Infinity'::numeric),
  rate numeric(14,2) not null check (rate >= 0 and rate < 'Infinity'::numeric),
  amount numeric(14,2) generated always as (round(additional_quantity * rate, 2)) stored,
  primary key (variation_id, boq_item_id)
);
create index po_variation_lines_boq_idx on public.po_variation_lines (boq_item_id);
alter table public.purchase_order_revisions add constraint purchase_order_revisions_variation_fk
  foreign key (variation_id) references public.po_variations(id);

-- Write guards. Every write needs the flag only the definers set (binds the table owner too); lines are immutable once written.
create or replace function public.guard_po_variation() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if coalesce(current_setting('pmo.po_variation_write', true), '') <> 'on' then
    raise exception 'variations are written by the variation functions only' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'variations are never deleted' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    select po.org_id, po.procurement_id, p.project_id into new.org_id, new.procurement_id, new.project_id
      from public.purchase_orders po join public.procurements p on p.id = po.procurement_id where po.id = new.po_id;
    if new.org_id is null then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
    return new;
  end if;
  if new.org_id is distinct from old.org_id or new.po_id is distinct from old.po_id or new.procurement_id is distinct from old.procurement_id
     or new.project_id is distinct from old.project_id or new.number is distinct from old.number
     or new.origin is distinct from old.origin or new.requested_by is distinct from old.requested_by then
    raise exception 'a variation''s identity is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_po_variation() from public, anon, authenticated;
create trigger po_variations_guard before insert or update or delete on public.po_variations
  for each row execute function public.guard_po_variation();

create or replace function public.guard_po_variation_line() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'variation lines are immutable' using errcode = '42501';
  end if;
  if coalesce(current_setting('pmo.po_variation_write', true), '') <> 'on' then
    raise exception 'variation lines are written by the request function only' using errcode = '42501';
  end if;
  new.org_id := (select v.org_id from public.po_variations v where v.id = new.variation_id);
  if new.org_id is null then raise exception 'variation not found' using errcode = 'P0002'; end if;
  return new;
end $$;
revoke all on function public.guard_po_variation_line() from public, anon, authenticated;
create trigger po_variation_lines_guard before insert or update or delete on public.po_variation_lines
  for each row execute function public.guard_po_variation_line();

-- RLS (D6): select only; org + active member and the parent visible under the caller's own RLS, so the 0350 Engineer
-- purchasing scope is inherited through purchase_orders, not restated.
alter table public.po_variations enable row level security;
alter table public.po_variations force row level security;
alter table public.po_variation_lines enable row level security;
alter table public.po_variation_lines force row level security;
create policy po_variations_read on public.po_variations for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.purchase_orders po where po.id = po_id));
create policy po_variation_lines_read on public.po_variation_lines for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.po_variations v where v.id = variation_id));
revoke all on public.po_variations, public.po_variation_lines from public, anon, authenticated;
grant select on public.po_variations, public.po_variation_lines to authenticated;

-- §2 request_po_variation. Order (D5): procurements row FOR UPDATE, then the PO lock. The caller's authority is checked
-- BEFORE any lock, and a purchase the caller may not read answers exactly like a missing PO (RLS does not apply inside a
-- definer, so the 0350 purchase-visibility predicate is stated here).
create or replace function public.request_po_variation(p_po_id uuid, p_origin text, p_lines jsonb, p_reason text)
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_po public.purchase_orders; v_proc public.procurements; v_rev integer;
        v_id uuid := gen_random_uuid(); v_amount numeric;
begin
  perform public.assert_is_active_member();
  select * into v_po from public.purchase_orders where id = p_po_id and org_id = v_org;
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v_po.procurement_id and org_id = v_org;
  if not (public.auth_role() in ('Admin','Executive','Project Manager','Finance') or v_proc.requested_by_id = auth.uid()) then
    raise exception 'purchase order not found' using errcode = 'P0002';
  end if;
  select * into v_proc from public.procurements where id = v_po.procurement_id for update;          -- D5 row first
  perform public.subcontract_po_lock(p_po_id);                                                     -- D5 then the PO
  if v_proc.status::text in ('Cancelled','Rejected') then                                          -- PQ-12
    raise exception 'this purchase is closed' using errcode = '42501'; end if;
  v_rev := public.po_effective_revision(p_po_id);
  if v_rev is null then raise exception 'the PO has no issued BoQ lines' using errcode = '42501'; end if;
  if p_origin is null or p_origin not in ('pre_work','post_work') or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'an origin (pre_work or post_work) and a reason of 1 to 1000 characters are required' using errcode = '23514'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'at least one variation line is required' using errcode = '23502'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, additional_quantity numeric)
              where not coalesce(x.boq_item_id is not null and x.additional_quantity > 0 and x.additional_quantity < 'Infinity'::numeric
                                 and x.additional_quantity = round(x.additional_quantity, 3), false))
     or exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid) group by x.boq_item_id having count(*) > 1) then
    raise exception 'each line needs a distinct BoQ item and a quantity above zero with at most 3 decimals' using errcode = '23514'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid)
              left join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = v_rev and pl.boq_item_id = x.boq_item_id
              where pl.boq_item_id is null) then
    raise exception 'every variation line must be on the PO''s effective BoQ lines' using errcode = '23514'; end if;
  if p_origin = 'post_work' and exists (                                                           -- FR-SCA-034: only the unclaimed excess
    select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, additional_quantity numeric)
      join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = v_rev and pl.boq_item_id = x.boq_item_id
      left join public.subcontract_verified(p_po_id) v on v.boq_item_id = x.boq_item_id
     where x.additional_quantity > greatest(coalesce(v.quantity, 0) - pl.quantity, 0) - coalesce((
             select sum(vl.additional_quantity) from public.po_variations o join public.po_variation_lines vl on vl.variation_id = o.id
              where o.po_id = p_po_id and o.origin = 'post_work' and o.status in ('Requested','Approved')
                and vl.boq_item_id = x.boq_item_id), 0)) then
    raise exception 'a post-work variation cannot exceed the verified quantity that is not yet on the PO' using errcode = '23514'; end if;
  select sum(round(x.additional_quantity * pl.rate, 2)) into v_amount
    from jsonb_to_recordset(p_lines) x(boq_item_id uuid, additional_quantity numeric)
    join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = v_rev and pl.boq_item_id = x.boq_item_id;
  perform set_config('pmo.po_variation_write', 'on', true);
  insert into public.po_variations (id, po_id, number, origin, reason, amount, requested_by)
  values (v_id, p_po_id, public.next_procurement_doc_number(v_org, 'VAR'), p_origin, btrim(p_reason), v_amount, auth.uid());
  insert into public.po_variation_lines (variation_id, boq_item_id, additional_quantity, rate)
  select v_id, x.boq_item_id, x.additional_quantity, pl.rate
    from jsonb_to_recordset(p_lines) x(boq_item_id uuid, additional_quantity numeric)
    join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = v_rev and pl.boq_item_id = x.boq_item_id;
  perform set_config('pmo.po_variation_write', '', true);
  perform public.log_audit('po_variation.request', v_org, auth.uid(), v_id,
    jsonb_build_object('po_id', p_po_id, 'origin', p_origin, 'amount', v_amount, 'revision', v_rev));
  return v_id;
end $$;
revoke all on function public.request_po_variation(uuid, text, jsonb, text) from public, anon;
grant execute on function public.request_po_variation(uuid, text, jsonb, text) to authenticated;

-- The route a viewer would see: the shipped resolver CALLED, never copied (ADR-0075 §3, D1). The decider is the viewer unless
-- the viewer is the requester, exactly as get_procurement_approval_routes (0243). Invoker: RLS decides what exists.
create or replace function public.po_variation_route(p_id uuid)
  returns table (route text, reason text, approver_ids uuid[], line_budget numeric, line_used numeric)
  language sql stable security invoker set search_path = public as $$
  select r.route, r.reason, r.approver_ids, r.line_budget, r.line_used
    from public.po_variations v
    join public.procurements p on p.id = v.procurement_id
   cross join lateral public.spend_approval_route(v.org_id, p.project_id, p.budget_category, v.amount, p.currency,
                                                  v.requested_by, nullif(auth.uid(), v.requested_by), v.requested_at) r
   where v.id = p_id
$$;
revoke all on function public.po_variation_route(uuid) from public, anon;
grant execute on function public.po_variation_route(uuid) to authenticated;

-- §3 decide_po_variation. Order (D5): procurements row, spend-line lock, PO lock, variation row. Refusals mirror
-- transition_procurement (0362 :207-237): requester ≠ approver has no sole-operator exception; the route is the shipped one.
-- The role gate comes first so a caller outside the deciding roles learns nothing about whether a variation exists.
create or replace function public.decide_po_variation(p_id uuid, p_approve boolean, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare v public.po_variations; v_proc public.procurements; v_route record; v_uid uuid := auth.uid();
        v_role user_role := public.auth_role(); v_is_admin boolean := (public.auth_role() = 'Admin');
begin
  perform public.assert_is_active_member();
  if not v_is_admin and v_role::text not in ('Project Manager','Finance','Executive') then
    raise exception 'not authorized to decide a variation' using errcode = '42501';
  end if;
  select * into v from public.po_variations where id = p_id and org_id = public.auth_org_id();
  if not found then raise exception 'variation not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v.procurement_id for update;                  -- D5 1
  if v_proc.project_id is not null and v_proc.budget_category is not null then                           -- D5 2 (0362 :226)
    perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_proc.project_id::text || ':' || v_proc.budget_category::text, 0));
  end if;
  perform public.subcontract_po_lock(v.po_id);                                                           -- D5 3
  select * into v from public.po_variations where id = p_id for update;
  if v_proc.status::text in ('Cancelled','Rejected') then                                                -- PQ-12
    raise exception 'this purchase is closed' using errcode = '42501'; end if;
  if v.status <> 'Requested' then raise exception 'only a Requested variation can be decided' using errcode = '42501'; end if;
  if v_uid = v.requested_by then                                                                         -- outside the Admin skip (OD-PROC-8)
    raise exception 'separation of duties: the requester cannot approve or reject their own variation' using errcode = '42501';
  end if;
  select * into v_route from public.spend_approval_route(v.org_id, v_proc.project_id, v_proc.budget_category, v.amount,
           v_proc.currency, v.requested_by, v_uid, v.requested_at);
  if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin and not coalesce(v_uid = any (v_route.approver_ids), false) then
    if v_route.route = 'admin' then
      raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason using errcode = '42501';
    end if;
    raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown') using errcode = '42501';
  end if;
  perform set_config('pmo.po_variation_write', 'on', true);
  if p_approve then
    update public.po_variations set status = 'Approved', approved_by = v_uid, approved_at = clock_timestamp(),
           decided_by = v_uid, decided_at = clock_timestamp(), decided_notes = nullif(btrim(p_notes), '') where id = p_id;
    update public.procurements set total_value = coalesce(total_value, 0) + v.amount,                    -- PQ-5: counts against the budget line now
           approved_total_value = case when approved_total_value is null then null else approved_total_value + v.amount end,
           amount_approved_by_id = v_uid,                                  -- PQ-5: approver ≠ payer now covers the variation's approver
           updated_at = now() where id = v.procurement_id;
  else
    update public.po_variations set status = case when v.origin = 'post_work' then 'Disputed' else 'Rejected' end,
           decided_by = v_uid, decided_at = clock_timestamp(), decided_notes = nullif(btrim(p_notes), '') where id = p_id;
  end if;
  perform set_config('pmo.po_variation_write', '', true);
  perform public.log_audit(case when p_approve then 'po_variation.approve' else 'po_variation.reject' end, v.org_id, v_uid, p_id,
    jsonb_build_object('route', v_route.route, 'reason', v_route.reason, 'amount', v.amount, 'line_budget', v_route.line_budget,
      'line_used', v_route.line_used, 'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
        and not coalesce(v_uid = any (v_route.approver_ids), false))));
end $$;
revoke all on function public.decide_po_variation(uuid, boolean, text) from public, anon;
grant execute on function public.decide_po_variation(uuid, boolean, text) to authenticated;

-- §4 issue_po_revision. The issuer is never the variation's approver unless the sole active member (0337 predicate, verbatim).
-- A connected org cannot revise a PO until the ERP revise exists (PQ-11, lifted by #1505).
create or replace function public.issue_po_revision(p_variation_id uuid) returns integer
  language plpgsql security definer set search_path = public as $$
declare v public.po_variations; v_proc public.procurements; v_org uuid := public.auth_org_id(); v_new integer;
        v_basis text := 'standard'; v_sole boolean := false; v_prev numeric; v_total numeric; v_nlines integer;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Finance','Project Manager') then
    raise exception 'only a Project Manager, Finance or an Admin may issue a PO revision' using errcode = '42501'; end if;
  select * into v from public.po_variations where id = p_variation_id and org_id = v_org;
  if not found then raise exception 'variation not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v.procurement_id for update;                  -- D5 row first
  perform public.subcontract_po_lock(v.po_id);                                                           -- D5 then the PO
  if v_proc.status::text in ('Cancelled','Rejected') then                                                -- PQ-12
    raise exception 'this purchase is closed' using errcode = '42501'; end if;
  if public.domain_externally_owned(v.org_id, 'procurement') then                                        -- PQ-11
    raise exception 'the ERP purchase order cannot be revised from here yet' using errcode = '42501', detail = 'erp_revise_pending'; end if;
  select * into v from public.po_variations where id = p_variation_id for update;
  if v.status <> 'Approved' then raise exception 'only an Approved variation can be revised into the PO' using errcode = '42501'; end if;
  if auth.uid() = v.approved_by then
    select count(*) = 1 and bool_or(p.id = auth.uid()) into v_sole from public.profiles p where p.org_id = v_org and public.is_active_member(p.id);
    if not coalesce(v_sole, false) then
      raise exception 'separation of duties: the variation''s approver cannot issue its PO revision' using errcode = '42501'; end if;
    v_basis := 'sole_operator';
  end if;
  v_new := public.po_effective_revision(v.po_id) + 1;
  select count(*) into v_nlines from public.po_variation_lines where variation_id = p_variation_id;
  insert into public.purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit)
  select l.po_id, v_new, l.boq_item_id, l.quantity + coalesce(vl.additional_quantity, 0), l.rate, l.unit
    from public.purchase_order_lines l
    left join public.po_variation_lines vl on vl.variation_id = p_variation_id and vl.boq_item_id = l.boq_item_id
   where l.po_id = v.po_id and l.revision = v_new - 1;
  select (select sum(amount) from public.purchase_order_lines where po_id = v.po_id and revision = v_new),
         (select sum(amount) from public.purchase_order_lines where po_id = v.po_id and revision = v_new - 1) into v_total, v_prev;
  -- Never above the approved amount (FR-SCA-032). Each line rounds on its own, so allow one cent per variation line.
  if (select count(*) from public.po_variation_lines vl join public.purchase_order_lines l
        on l.po_id = v.po_id and l.revision = v_new - 1 and l.boq_item_id = vl.boq_item_id where vl.variation_id = p_variation_id) <> v_nlines
     or v_total - v_prev > v.amount + 0.01 * v_nlines then
    raise exception 'the revision would raise the PO beyond the approved variation' using errcode = '23514'; end if;
  insert into public.purchase_order_revisions (org_id, po_id, procurement_id, revision, total, variation_id, issued_by, issue_basis)
  values (v_org, v.po_id, v.procurement_id, v_new, v_total, p_variation_id, auth.uid(), v_basis);
  update public.purchase_orders set amount = v_total where id = v.po_id;      -- the revision row above makes the amount guard agree
  perform set_config('pmo.po_variation_write', 'on', true);
  update public.po_variations set status = 'Revised', revision = v_new where id = p_variation_id;
  perform set_config('pmo.po_variation_write', '', true);
  perform public.log_audit('purchase_order_revision.issue', v_org, auth.uid(), v.po_id,
    jsonb_build_object('revision', v_new, 'total', v_total, 'variation_id', p_variation_id, 'basis', v_basis));
  return v_new;
end $$;
revoke all on function public.issue_po_revision(uuid) from public, anon;
grant execute on function public.issue_po_revision(uuid) to authenticated;

-- §5 link_po_variation. Never touches work_orders, claims or invoices (FR-SCA-041).
create or replace function public.link_po_variation(p_variation_id uuid, p_work_order_id uuid, p_not_passed_reason text)
  returns void language plpgsql security definer set search_path = public as $$
declare v public.po_variations; v_org uuid := public.auth_org_id(); v_reason text := nullif(btrim(p_not_passed_reason), '');
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Finance','Project Manager') then                                -- PQ-7
    raise exception 'only a Project Manager, Finance or an Admin may link a variation' using errcode = '42501'; end if;
  select * into v from public.po_variations where id = p_variation_id and org_id = v_org for update;
  if not found then raise exception 'variation not found' using errcode = 'P0002'; end if;
  if (p_work_order_id is null) = (v_reason is null) then
    raise exception 'link exactly one work order, or state why it is not passed on' using errcode = '23514'; end if;
  if p_work_order_id is not null and not exists (select 1 from public.work_orders w
        where w.id = p_work_order_id and w.org_id = v.org_id and w.project_id = v.project_id) then
    raise exception 'the work order must be on this variation''s project' using errcode = '23514'; end if;
  perform set_config('pmo.po_variation_write', 'on', true);
  update public.po_variations set work_order_id = p_work_order_id, not_passed_reason = v_reason,
         linked_by = auth.uid(), linked_at = clock_timestamp() where id = p_variation_id;
  perform set_config('pmo.po_variation_write', '', true);
  perform public.log_audit('po_variation.link', v_org, auth.uid(), p_variation_id,
    jsonb_build_object('work_order_id', p_work_order_id, 'not_passed', v_reason is not null));
end $$;
revoke all on function public.link_po_variation(uuid, uuid, text) from public, anon;
grant execute on function public.link_po_variation(uuid, uuid, text) to authenticated;

-- The "shown on the work order" read. Invoker: RLS on the variations decides what the caller sees.
create or replace function public.work_order_cost_variations(p_work_order_id uuid)
  returns table (id uuid, number text, status text, amount numeric, po_id uuid)
  language sql stable security invoker set search_path = public as $$
  select v.id, v.number, v.status, v.amount, v.po_id from public.po_variations v
   where v.work_order_id = p_work_order_id order by v.requested_at, v.id
$$;
revoke all on function public.work_order_cost_variations(uuid) from public, anon;
grant execute on function public.work_order_cost_variations(uuid) to authenticated;

-- §6 The position read gains `disputed` (FR-SCA-035): 0472 §5 verbatim, plus the lines marked `-- 0474`.
drop function public.subcontract_po_position(uuid);
create or replace function public.subcontract_po_position(p_po_id uuid)
  returns table (boq_item_id uuid, item_code text, description text, unit text, rate numeric, revision integer,
                 po_qty numeric, verified numeric, billed numeric, payable numeric, verified_not_on_po numeric,
                 disputed numeric,                                                                          -- 0474
                 verified_at timestamptz)
  language sql stable security invoker set search_path = public as $$
  with rev as (select public.po_effective_revision(p_po_id) as r),
  bl as (select l.boq_item_id, sum(l.quantity) q from public.procurement_invoice_lines l
           join public.procurement_invoices i on i.id = l.invoice_id
          where i.po_id = p_po_id and public.subcontract_bill_is_live(i.erp_docstatus, i.erp_cancelled_at)
          group by l.boq_item_id),
  dsp as (select l.boq_item_id, sum(l.additional_quantity) q                                                -- 0474
            from public.po_variations v join public.po_variation_lines l on l.variation_id = v.id           -- 0474
           where v.po_id = p_po_id and v.status = 'Disputed'                                                -- 0474
           group by l.boq_item_id),                                                                         -- 0474
  money as (select public.auth_role() in ('Admin','Executive','Project Manager','Finance') as ok)  -- D6 / 0350 ruling
  select pl.boq_item_id, b.item_code, b.description, pl.unit, pl.rate, pl.revision, pl.quantity,
         coalesce(v.quantity, 0),
         case when money.ok then coalesce(bl.q, 0) end,
         case when money.ok then greatest(least(coalesce(v.quantity, 0), pl.quantity) - coalesce(bl.q, 0), 0) end,
         greatest(coalesce(v.quantity, 0) - pl.quantity, 0),
         least(greatest(coalesce(v.quantity, 0) - pl.quantity, 0), coalesce(dsp.q, 0)),                     -- 0474
         v.confirmed_at
    from rev cross join money join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = rev.r
    join public.boq_items b on b.id = pl.boq_item_id
    left join public.subcontract_verified(p_po_id) v on v.boq_item_id = pl.boq_item_id
    left join bl on bl.boq_item_id = pl.boq_item_id
    left join dsp on dsp.boq_item_id = pl.boq_item_id                                                       -- 0474
   order by b.line_no nulls last, b.item_code
$$;
revoke all on function public.subcontract_po_position(uuid) from public, anon;
grant execute on function public.subcontract_po_position(uuid) to authenticated;

-- Project exposure (FR-SCA-035): per currency, never summed across currencies (as project_committed_spend, 0373).
-- Bounded by the number of subcontract POs on one project.
create or replace function public.project_subcontract_exposure(p_project_id uuid)
  returns table (currency text, verified_not_on_po_value numeric, disputed_value numeric, oldest_unresolved_at timestamptz)
  language sql stable security invoker set search_path = public as $$
  select p.currency,
         sum(round(x.verified_not_on_po * x.rate, 2)),
         sum(round(x.disputed * x.rate, 2)),
         min(x.verified_at) filter (where x.verified_not_on_po > 0)
    from public.procurements p
    join public.purchase_order_revisions r on r.procurement_id = p.id and r.revision = 1
    cross join lateral public.subcontract_po_position(r.po_id) x
   where p.project_id = p_project_id and p.is_subcontract
   group by p.currency
$$;
revoke all on function public.project_subcontract_exposure(uuid) from public, anon;
grant execute on function public.project_subcontract_exposure(uuid) to authenticated;

-- Closing self-assertion: FORCE RLS, no client DML, internals not client-executable, no anon execute.
do $$
declare t text;
begin
  foreach t in array array['po_variations','po_variation_lines'] loop
    if not (select c.relforcerowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then
      raise exception '0474: % lacks FORCE RLS', t;
    end if;
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception '0474: % holds a client DML grant', t;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.guard_po_variation()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_po_variation_line()', 'EXECUTE') then
    raise exception '0474: an internal function is client-executable';
  end if;
  if has_function_privilege('anon', 'public.request_po_variation(uuid,text,jsonb,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.decide_po_variation(uuid,boolean,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.issue_po_revision(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.link_po_variation(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.po_variation_route(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.work_order_cost_variations(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.subcontract_po_position(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.project_subcontract_exposure(uuid)', 'EXECUTE') then
    raise exception '0474: a variation function is anon-executable';
  end if;
end $$;
