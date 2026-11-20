-- 1076_consumable_plan.sql — #2577 consumable needs from usage standards: the per-work-order consumable plan.
-- Spec docs/specs/consumable-usage-standards.spec.md (FR-CUS-005..010, 014..016) · plan docs/plans/2026-11-20-consumable-usage-standards.md.
-- Proven by supabase/tests/cus_plan.test.sql (AC-CUS-001, 004..007, 011, 012, 014). Standards are in 1075.
-- Reversible via supabase/migrations/rollback/1076_consumable_plan_down.sql.
--
-- The plan is a STORED SNAPSHOT (OD-CUS-6): generated from the work order's lines x the matching active standards,
-- regenerated only on request, flagged "out of date" from a fingerprint of its inputs. Quantities of stock items only;
-- it writes no cost plan (work_order_plan_lines, 0997, is a separate thing). Plan lines are written ONLY by the
-- security-definer functions below. The figure material requests read is changed in 1077, which ships alone.

-- §1 the table -------------------------------------------------------------------------------------------------
create table public.work_order_consumable_plan_lines (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  work_order_id     uuid not null references public.work_orders(id),
  item_id           uuid not null references public.stock_items(id),
  generated_qty     numeric(14,3) not null default 0 constraint cus_plan_generated_check check (generated_qty >= 0 and generated_qty < 'Infinity'::numeric),
  adjusted_qty      numeric(14,3) constraint cus_plan_adjusted_check check (adjusted_qty is null or (adjusted_qty >= 0 and adjusted_qty < 'Infinity'::numeric)),
  adjust_reason     text constraint cus_plan_reason_check check (adjust_reason is null or length(btrim(adjust_reason)) between 1 and 500),
  adjusted_by       uuid,                                   -- plain uuid: a second FK to profiles would make every embed of profiles ambiguous
  adjusted_at       timestamptz,
  basis             jsonb not null default '[]'::jsonb constraint cus_plan_basis_check check (jsonb_typeof(basis) = 'array'),
  input_fingerprint text,                                   -- null on a line added by hand and never generated
  generated_by      uuid,
  generated_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (work_order_id, item_id),
  -- FR-CUS-009: an adjustment always carries its reason and its actor and time.
  constraint cus_plan_adjustment_complete check ((adjusted_qty is null) = (adjust_reason is null)
                                                 and (adjusted_qty is null) = (adjusted_by is null)
                                                 and (adjusted_qty is null) = (adjusted_at is null))
);
create index work_order_consumable_plan_lines_wo_idx on public.work_order_consumable_plan_lines (work_order_id);   -- NFR-CUS-004
create index work_order_consumable_plan_lines_item_idx on public.work_order_consumable_plan_lines (item_id);
create trigger work_order_consumable_plan_lines_stamp_org_id before insert on public.work_order_consumable_plan_lines
  for each row execute function public.stamp_org_id();

alter table public.work_order_consumable_plan_lines enable row level security;
alter table public.work_order_consumable_plan_lines force row level security;
create policy work_order_consumable_plan_lines_select on public.work_order_consumable_plan_lines for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.work_order_consumable_plan_lines from authenticated, anon;
grant select on public.work_order_consumable_plan_lines to authenticated;   -- no direct writes: the functions below are the only writers (FR-CUS-016)

-- §2 internals (never client-callable) ------------------------------------------------------------------------
-- Which standard applies to which work-order line (FR-CUS matching): the standard's work unit equals the contract
-- line's unit (trimmed, case-blind) and, when a prefix is set, boq_items.item_code starts with it (case-blind).
-- Per (line, item) the longest prefix wins; same-key standards cannot coexist (1075 unique index), so no tie.
-- `result` keeps full precision; rounding happens once per item, at storage (NFR-CUS-002).
create or replace function public.cus_plan_matches(p_work_order_id uuid)
  returns table (boq_item_id uuid, boq_code text, unit text, work_qty numeric, standard_id uuid, item_id uuid,
                 qty_per_unit numeric, margin_pct numeric, result numeric)
  language sql stable security definer set search_path = public, pg_temp as $$
  select distinct on (wl.boq_item_id, s.item_id)
         wl.boq_item_id, b.item_code, b.unit, wl.quantity, s.id, s.item_id, s.qty_per_unit, s.margin_pct,
         wl.quantity * s.qty_per_unit * (1 + s.margin_pct / 100)
    from public.work_order_lines wl
    join public.boq_items b on b.id = wl.boq_item_id and b.org_id = wl.org_id
    join public.consumable_usage_standards s
      on s.org_id = wl.org_id and s.archived_at is null
     and lower(btrim(s.work_unit)) = lower(btrim(b.unit))
     and starts_with(lower(b.item_code), lower(btrim(coalesce(s.boq_code_prefix, ''))))
    join public.stock_items i on i.id = s.item_id and i.org_id = s.org_id and i.archived_at is null
   where wl.work_order_id = p_work_order_id
   order by wl.boq_item_id, s.item_id, length(btrim(coalesce(s.boq_code_prefix, ''))) desc, s.id
$$;

-- FR-CUS-008: a hash of the plan's inputs (every line id and quantity, and the standards that match) — not a clock.
create or replace function public.cus_plan_fingerprint(p_work_order_id uuid) returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select md5(
    coalesce((select string_agg(wl.boq_item_id::text || '|' || wl.quantity::text, ';' order by wl.boq_item_id)
                from public.work_order_lines wl where wl.work_order_id = p_work_order_id), '')
    || '#' ||
    coalesce((select string_agg(m.boq_item_id::text || '|' || m.standard_id::text || '|' || m.item_id::text || '|'
                                || m.qty_per_unit::text || '|' || m.margin_pct::text, ';' order by m.boq_item_id, m.item_id)
                from public.cus_plan_matches(p_work_order_id) m), ''))
$$;

-- The caller may plan this work order: an active member, the work order is theirs, and the project rule of BoQ
-- allowances (0417): Admin/Executive/Finance on any project, a Project Manager only on their own (0245).
create or replace function public.cus_assert_planner(p_work_order_id uuid, p_open boolean default true) returns public.work_orders
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid; wo public.work_orders;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into wo from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org;
  if not found then
    raise exception 'CUS_NOT_FOUND: the work order is not in your organisation' using errcode = 'P0001'; end if;
  if not public.may_record_project_progress(wo.project_id) then                                         -- mut:plan_writer
    raise exception 'CUS_FORBIDDEN: you cannot plan consumables for this work order' using errcode = '42501'; end if;
  if p_open and wo.status not in ('Draft', 'Issued') then
    raise exception 'CUS_WORK_ORDER: the work order is closed or cancelled; its consumable plan cannot change' using errcode = 'P0001'; end if;
  return wo;
end $$;

-- §3 generate (FR-CUS-005..007) --------------------------------------------------------------------------------
-- One statement, set-based. A regeneration recomputes generated_qty and basis for every item and keeps each
-- adjustment and its reason; an item whose standard no longer matches keeps its row only if adjusted (generated 0).
create or replace function public.cus_generate_plan(p_work_order_id uuid) returns integer
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare wo public.work_orders; v_fp text; v_n integer;
begin
  perform public.assert_is_active_member();
  wo := public.cus_assert_planner(p_work_order_id);
  perform pg_advisory_xact_lock(hashtextextended('cus-plan:' || p_work_order_id::text, 0));
  v_fp := public.cus_plan_fingerprint(p_work_order_id);
  with m as materialized (select * from public.cus_plan_matches(p_work_order_id)),
  agg as (
    select m.item_id, round(sum(m.result), 3) as gen,
           jsonb_agg(jsonb_build_object('boq_item_id', m.boq_item_id, 'boq_code', m.boq_code, 'unit', m.unit,
                                        'work_qty', m.work_qty::text, 'standard_id', m.standard_id,
                                        'qty_per_unit', m.qty_per_unit::text, 'margin_pct', m.margin_pct::text, 'result', m.result::text)
                     order by m.boq_code, m.boq_item_id) as basis
      from m group by m.item_id),
  del as (delete from public.work_order_consumable_plan_lines p
           where p.work_order_id = p_work_order_id and p.adjusted_qty is null
             and p.item_id not in (select a.item_id from agg a) returning 1),
  zer as (update public.work_order_consumable_plan_lines p
             set generated_qty = 0, basis = '[]'::jsonb, input_fingerprint = v_fp,
                 generated_by = auth.uid(), generated_at = now(), updated_at = now()
           where p.work_order_id = p_work_order_id and p.adjusted_qty is not null
             and p.item_id not in (select a.item_id from agg a) returning 1),
  ups as (insert into public.work_order_consumable_plan_lines
            (org_id, work_order_id, item_id, generated_qty, basis, input_fingerprint, generated_by, generated_at)
          select wo.org_id, p_work_order_id, a.item_id, a.gen, a.basis, v_fp, auth.uid(), now() from agg a
          on conflict (work_order_id, item_id) do update
            set generated_qty = excluded.generated_qty, basis = excluded.basis, input_fingerprint = excluded.input_fingerprint,
                generated_by = excluded.generated_by, generated_at = excluded.generated_at, updated_at = now()
          returning 1)
  select (select count(*) from ups) + (select count(*) from zer) into v_n;
  return v_n;
end $$;

-- §4 adjust, add, revert (FR-CUS-009) --------------------------------------------------------------------------
-- p_adjusted_qty null reverts to the generated figure (and removes a line with nothing generated, i.e. one added by hand).
-- Upsert, so it also adds an item no standard covers: its generated qty is 0. Never touches the standards.
create or replace function public.cus_adjust_plan_line(p_work_order_id uuid, p_item_id uuid, p_adjusted_qty numeric, p_reason text)
  returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare wo public.work_orders; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.assert_is_active_member();
  wo := public.cus_assert_planner(p_work_order_id);
  perform pg_advisory_xact_lock(hashtextextended('cus-plan:' || p_work_order_id::text, 0));
  if p_adjusted_qty is null then
    update public.work_order_consumable_plan_lines p
       set adjusted_qty = null, adjust_reason = null, adjusted_by = null, adjusted_at = null, updated_at = now()
     where p.work_order_id = p_work_order_id and p.item_id = p_item_id;
    delete from public.work_order_consumable_plan_lines p
     where p.work_order_id = p_work_order_id and p.item_id = p_item_id and p.basis = '[]'::jsonb;   -- nothing generated for it
    return;
  end if;
  if p_adjusted_qty < 0 or p_adjusted_qty >= 100000000000 then
    raise exception 'CUS_INVALID: the adjusted quantity must be zero or more' using errcode = '23514'; end if;
  if v_reason is null or length(v_reason) > 500 then                                                    -- mut:adjust_reason
    raise exception 'CUS_REASON: an adjustment needs a reason (1 to 500 characters)' using errcode = '23514'; end if;
  if not exists (select 1 from public.stock_items i where i.id = p_item_id and i.org_id = wo.org_id and i.archived_at is null) then
    raise exception 'CUS_ITEM: the item is archived or not in your organisation' using errcode = 'P0001'; end if;
  insert into public.work_order_consumable_plan_lines
    (org_id, work_order_id, item_id, generated_qty, adjusted_qty, adjust_reason, adjusted_by, adjusted_at)
  values (wo.org_id, p_work_order_id, p_item_id, 0, round(p_adjusted_qty, 3), v_reason, auth.uid(), now())
  on conflict (work_order_id, item_id) do update
    set adjusted_qty = excluded.adjusted_qty, adjust_reason = excluded.adjust_reason,
        adjusted_by = excluded.adjusted_by, adjusted_at = excluded.adjusted_at, updated_at = now();
end $$;

-- §5 read (FR-CUS-008, 010, 014): the plan, its out-of-date flag, the contract lines no standard covers, and the
-- items already requested that the plan does not cover. Any active member of the organisation may read.
create or replace function public.cus_get_plan(p_work_order_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); wo public.work_orders; v_fp text; v_lines jsonb; v_nostd jsonb; v_unplanned jsonb;
        v_gen timestamptz; v_stale boolean;
begin
  perform public.assert_is_active_member();
  select * into wo from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org;
  if not found then
    raise exception 'CUS_NOT_FOUND: the work order is not in your organisation' using errcode = 'P0001'; end if;
  v_fp := public.cus_plan_fingerprint(p_work_order_id);
  select max(p.generated_at), coalesce(bool_or(p.generated_at is not null and p.input_fingerprint is distinct from v_fp), false)
    into v_gen, v_stale
    from public.work_order_consumable_plan_lines p where p.work_order_id = p_work_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', p.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
           'generated_qty', p.generated_qty::text, 'adjusted_qty', p.adjusted_qty::text, 'adjust_reason', p.adjust_reason,
           'adjusted_by', p.adjusted_by, 'adjusted_at', p.adjusted_at,
           'planned_qty', coalesce(p.adjusted_qty, p.generated_qty)::text,
           'prior_qty', round(public.mrq_prior_quantity(p_work_order_id, p.item_id, '00000000-0000-0000-0000-000000000000'::uuid), 3)::text,
           'source', case when p.adjusted_qty is not null then 'adjusted' else 'standard' end,
           'basis', p.basis) order by i.code), '[]'::jsonb)
    into v_lines
    from public.work_order_consumable_plan_lines p
    join public.stock_items i on i.id = p.item_id
    join public.stock_units u on u.id = i.unit_id
   where p.work_order_id = p_work_order_id;

  select coalesce(jsonb_agg(jsonb_build_object('boq_item_id', b.id, 'item_code', b.item_code, 'description', b.description,
                                               'unit', b.unit, 'quantity', wl.quantity::text) order by b.item_code), '[]'::jsonb)
    into v_nostd
    from public.work_order_lines wl join public.boq_items b on b.id = wl.boq_item_id
   where wl.work_order_id = p_work_order_id
     and not exists (select 1 from public.cus_plan_matches(p_work_order_id) m where m.boq_item_id = wl.boq_item_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', x.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
           'planned_qty', round(public.mrq_plan_quantity(p_work_order_id, x.item_id), 3)::text, 'prior_qty', round(x.prior, 3)::text,
           'source', case when exists (select 1 from public.work_order_lines wl
                                         join public.boq_material_allowances a on a.boq_item_id = wl.boq_item_id and a.item_id = x.item_id
                                        where wl.work_order_id = p_work_order_id) then 'allowance' else 'none' end)
           order by i.code), '[]'::jsonb)
    into v_unplanned
    from (select l.item_id, sum(l.quantity) as prior
            from public.material_request_lines l join public.material_requests r on r.id = l.request_id
           where r.work_order_id = p_work_order_id and r.status in ('pending', 'approved', 'fulfilled')
             and not exists (select 1 from public.work_order_consumable_plan_lines p
                              where p.work_order_id = p_work_order_id and p.item_id = l.item_id)
           group by l.item_id) x
    join public.stock_items i on i.id = x.item_id
    join public.stock_units u on u.id = i.unit_id;

  return jsonb_build_object('work_order_id', p_work_order_id, 'work_order_status', wo.status, 'generated_at', v_gen,
                            'out_of_date', v_stale, 'lines', v_lines, 'no_standard', v_nostd, 'unplanned', v_unplanned);
end $$;

-- §6 how many work-order lines in live (Draft or Issued) work orders each active standard's rule matches (FR-CUS-004).
-- Invoker + RLS: the caller sees only their organisation's rows. A standard "matches" a line by its own rule (work unit,
-- prefix); a longer-prefix standard for the same item may still win that line at generation. Zero is the symptom of a
-- work unit typed differently from the contract lines' unit (OQ-CUS-1).
create or replace function public.cus_standard_match_counts() returns table (standard_id uuid, match_lines integer)
  language sql stable set search_path = public as $$
  select s.id, count(m.line_id)::integer
    from public.consumable_usage_standards s
    left join (select wl.id as line_id, b.unit, b.item_code
                 from public.work_order_lines wl
                 join public.work_orders w on w.id = wl.work_order_id and w.status in ('Draft', 'Issued')
                 join public.boq_items b on b.id = wl.boq_item_id) m
      on lower(btrim(m.unit)) = lower(btrim(s.work_unit))
     and starts_with(lower(m.item_code), lower(btrim(coalesce(s.boq_code_prefix, ''))))
   where s.archived_at is null
   group by s.id
$$;
revoke all on function public.cus_standard_match_counts() from public, anon;
grant execute on function public.cus_standard_match_counts() to authenticated;

-- §7 ACL: internals nobody; client RPCs authenticated only (hosted default-grant lesson) ------------------------
revoke all on function public.cus_plan_matches(uuid), public.cus_plan_fingerprint(uuid), public.cus_assert_planner(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.cus_generate_plan(uuid), public.cus_adjust_plan_line(uuid, uuid, numeric, text), public.cus_get_plan(uuid)
  from public, anon;
grant execute on function public.cus_generate_plan(uuid), public.cus_adjust_plan_line(uuid, uuid, numeric, text), public.cus_get_plan(uuid)
  to authenticated;
