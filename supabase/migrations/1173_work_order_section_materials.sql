-- 1173_work_order_section_materials.sql — #2576: per-section material allocation, the request link and the section check.
-- Spec docs/specs/work-order-sections.spec.md (FR-WOS-009, 012, 013, 014, 015, 005); plan docs/plans/2026-11-20-work-order-sections.md.
-- Proven by supabase/tests/1173_work_order_section_materials.test.sql (AC-WOS-006, 008, 009, 010, 011 and the material
-- half of AC-WOS-002/003). THIS MIGRATION TOUCHES THE MATERIAL-REQUEST APPROVAL PATH (submit) AND SHIPS ALONE, AFTER 1095..1098: it
-- reuses the section master (1095), the archived-section trigger (1096) and the archive guard it extends (1097: tasks).
--
--   • work_order_section_material_plan: a planned quantity of one stock item on one section, an ALLOCATION of the work
--     order's planned quantity for that item. That quantity is the shipped `mrq_plan_quantity` (1001; the BoQ material
--     allowances prorated by the work order's lines) — never a second stored plan. The allocations of an item on a work
--     order never exceed it (refused on write, with the plan figure); if the work order's plan later falls below the sum,
--     `work_order_section_material_check` flags the item over-allocated and nothing is rewritten.
--   • material_requests.section_id (+ composite key (section_id, work_order_id), the archived-section trigger from 1096),
--     editable only while the request is a draft (a returned request is a draft again). Lines snapshot the section's plan
--     and prior quantity beside the work order's.
--   • mrq_submit restated: a line over its section's allocation needs the existing 1-to-500-character over-plan reason,
--     checked here beside the work-order check; the stricter applies; a section with no allocation for the item is
--     checked against the work order's plan only. mrq_save_draft restated: it takes `section_id` in the header.
--   • wos_archive_blockers restated: a section with a draft or pending request is not archived (and, as 1097, tasks).
--   • reads: mrq_section_plan_for (form figures) and work_order_section_material_check (plan, requested, remaining per
--     section and item, and for the unsectioned remainder).
--
-- Mutation checks (by hand, in the build report): the line tagged `-- mut:section_plan` in mrq_submit is the single
-- statement that enforces the section's allocation; `-- mut:alloc_cap` in guard_section_material_plan the plan cap;
-- `-- mut:section_locked` the draft-only rule.
--
-- ── REVERSE (also supabase/migrations/rollback/1173_work_order_section_materials_down.sql) ──────────────────

-- ── §1 allocations ─────────────────────────────────────────────────────────────────────────────────────────────
create table public.work_order_section_material_plan (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id),
  section_id    uuid not null,
  item_id       uuid not null references public.stock_items(id),
  quantity      numeric(14,3) not null check (quantity > 0 and quantity < 100000000000),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  constraint work_order_section_material_plan_section_wo_fk foreign key (section_id, work_order_id)
    references public.work_order_sections (id, work_order_id),
  constraint work_order_section_material_plan_one unique (section_id, item_id)
);
create index work_order_section_material_plan_wo_item_idx on public.work_order_section_material_plan (work_order_id, item_id);
create trigger work_order_section_material_plan_stamp_org_id before insert on public.work_order_section_material_plan
  for each row execute function public.stamp_org_id();
create trigger zz_work_order_section_material_plan_section before insert or update of section_id on public.work_order_section_material_plan
  for each row execute function public.wos_check_child_section();

-- Definer: it reads work_orders, work_order_sections and mrq_plan_quantity whatever the caller's RLS. Guards every writer.
create function public.guard_section_material_plan() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.work_order_section_material_plan := case when tg_op = 'DELETE' then old else new end;
  v_org uuid; v_status public.work_order_status; v_archived timestamptz;
  v_plan numeric; v_others numeric;
begin
  select w.org_id, w.status into v_org, v_status from public.work_orders w where w.id = v_row.work_order_id;
  if v_org is null or v_org is distinct from v_row.org_id then
    raise exception 'WOS_WO: the work order is not in your organisation' using errcode = '23514'; end if;
  if v_status = 'Cancelled' then
    raise exception 'WOS_CANCELLED: a cancelled work order''s plan is frozen' using errcode = '23514'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and (new.work_order_id is distinct from old.work_order_id or new.section_id is distinct from old.section_id
                           or new.item_id is distinct from old.item_id or new.org_id is distinct from old.org_id) then
    raise exception 'WOS_KEY: an allocation keeps its work order, section and item' using errcode = '23514'; end if;
  if v_status not in ('Draft', 'Issued') then
    raise exception 'WOS_STATUS: a closed work order takes no allocation changes' using errcode = '23514'; end if;
  select s.archived_at into v_archived from public.work_order_sections s where s.id = new.section_id;
  if v_archived is not null then
    raise exception 'WOS_SECTION_ARCHIVED: an archived section takes no allocation' using errcode = '23514'; end if;
  if not exists (select 1 from public.stock_items i where i.id = new.item_id and i.org_id = new.org_id
                  and (i.archived_at is null or tg_op = 'UPDATE')) then
    raise exception 'WOS_ITEM: the item is not a live stock item of this organisation' using errcode = '23514'; end if;
  -- Serialize allocations of one item on one work order before summing, so two writers cannot both fit.
  perform pg_advisory_xact_lock(hashtextextended('wos-alloc:' || new.work_order_id::text || ':' || new.item_id::text, 0));
  v_plan := public.mrq_plan_quantity(new.work_order_id, new.item_id);
  select coalesce(sum(a.quantity), 0) into v_others from public.work_order_section_material_plan a
   where a.work_order_id = new.work_order_id and a.item_id = new.item_id and a.id is distinct from new.id;
  if v_others + new.quantity > v_plan then                                                               -- mut:alloc_cap
    raise exception 'WOS_ALLOCATION_CAP: the allocations would be % against a work-order plan of %', v_others + new.quantity, v_plan
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now(); end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
revoke all on function public.guard_section_material_plan() from public, anon, authenticated;
create trigger zz_work_order_section_material_plan_guard before insert or update or delete on public.work_order_section_material_plan
  for each row execute function public.guard_section_material_plan();

create function public.audit_section_material_plan() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.work_order_section_material_plan := case when tg_op = 'DELETE' then old else new end;
begin
  if tg_op = 'UPDATE' and new.quantity = old.quantity then return null; end if;
  perform public.log_audit('work_order_section_material_plan.' || lower(tg_op), v_row.org_id, auth.uid(), v_row.section_id,
    jsonb_build_object('work_order_id', v_row.work_order_id, 'item_id', v_row.item_id,
                       'before', case when tg_op <> 'INSERT' then old.quantity end,
                       'after', case when tg_op <> 'DELETE' then new.quantity end));
  return null;
end $$;
revoke all on function public.audit_section_material_plan() from public, anon, authenticated;
create trigger zz_work_order_section_material_plan_audit after insert or update or delete on public.work_order_section_material_plan
  for each row execute function public.audit_section_material_plan();

alter table public.work_order_section_material_plan enable row level security;
alter table public.work_order_section_material_plan force row level security;
create policy work_order_section_material_plan_select on public.work_order_section_material_plan for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy work_order_section_material_plan_insert on public.work_order_section_material_plan for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and (select public.auth_role()) in ('Admin', 'Executive', 'Finance', 'Project Manager'));
create policy work_order_section_material_plan_update on public.work_order_section_material_plan for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin', 'Executive', 'Finance', 'Project Manager'))
  with check (org_id = (select public.auth_org_id()));
create policy work_order_section_material_plan_delete on public.work_order_section_material_plan for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin', 'Executive', 'Finance', 'Project Manager'));
revoke all on public.work_order_section_material_plan from public, anon, authenticated;
grant select, delete on public.work_order_section_material_plan to authenticated;
grant insert (work_order_id, section_id, item_id, quantity) on public.work_order_section_material_plan to authenticated;
grant update (quantity) on public.work_order_section_material_plan to authenticated;
grant all on public.work_order_section_material_plan to service_role;

-- ── §2 the request link ───────────────────────────────────────────────────────────────────────────────────────
alter table public.material_requests add column section_id uuid;
alter table public.material_requests
  add constraint material_requests_section_wo_fk foreign key (section_id, work_order_id)
  references public.work_order_sections (id, work_order_id);
create index material_requests_section_status_idx on public.material_requests (work_order_id, section_id, status);
create trigger zz_material_requests_section before insert or update of section_id on public.material_requests
  for each row execute function public.wos_check_child_section();
alter table public.material_request_lines
  add column section_plan_qty numeric(14,3),       -- the section's allocation at submission, null when it has none (FR-WOS-009)
  add column section_prior_qty numeric(14,3);

-- AC-WOS-011: the section is editable only while the request is a draft (a returned request is a draft again).
-- Definer-proof: it binds every writer, including the owner's own definers.
create function public.guard_material_request_section() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.section_id is distinct from old.section_id and old.status <> 'draft' then   -- mut:section_locked
    raise exception 'MRQ_SECTION_LOCKED: the section of a request can change only while it is a draft' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.guard_material_request_section() from public, anon, authenticated;
create trigger zz_material_requests_section_locked before update of section_id on public.material_requests
  for each row execute function public.guard_material_request_section();

-- ── §3 internals ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.mrq_section_plan_quantity(p_section_id uuid, p_item_id uuid) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select a.quantity from public.work_order_section_material_plan a where a.section_id = p_section_id and a.item_id = p_item_id
$$;

-- Quantity of an item already requested on a SECTION by OTHER live requests (pending, approved, fulfilled): the same
-- rule as mrq_prior_quantity, one section wide.
create or replace function public.mrq_section_prior_quantity(p_section_id uuid, p_item_id uuid, p_exclude_request uuid) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(l.quantity), 0)
    from public.material_request_lines l
    join public.material_requests r on r.id = l.request_id
   where r.section_id = p_section_id and l.item_id = p_item_id and r.id <> p_exclude_request
     and r.status in ('pending','approved','fulfilled')
$$;

-- What the form shows per line before submit for a section: its allocation and what is already requested on it.
create or replace function public.mrq_section_plan_for(p_work_order_id uuid, p_section_id uuid, p_item_ids uuid[], p_exclude_request uuid default null)
  returns table (item_id uuid, section_plan_qty numeric, section_prior_qty numeric)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or not public.is_active_member() then return; end if;
  if not exists (select 1 from public.work_order_sections s where s.id = p_section_id and s.work_order_id = p_work_order_id and s.org_id = v_org) then return; end if;
  if coalesce(array_length(p_item_ids, 1), 0) > 200 then
    raise exception 'MRQ_INVALID: 200 items at most' using errcode = 'P0001'; end if;
  return query
  select i.id, public.mrq_section_plan_quantity(p_section_id, i.id),
         public.mrq_section_prior_quantity(p_section_id, i.id, coalesce(p_exclude_request, '00000000-0000-0000-0000-000000000000'::uuid))
    from public.stock_items i where i.id = any(p_item_ids) and i.org_id = v_org;
end $$;

-- FR-WOS-014: per section and item — the section's plan (its allocation; null = none), what is requested on it (pending,
-- approved, fulfilled), what remains — and the same three for the unsectioned remainder, whose plan is what the work order
-- planned and no section took. `over_allocated` flags an item whose allocations exceed the work order's plan now.
-- No row at all for a work order with no section. Definer for mrq_plan_quantity; reads follow work-order read.
create or replace function public.work_order_section_material_check(p_work_order_id uuid)
  returns table (section_id uuid, item_id uuid, plan_qty numeric, requested_qty numeric, remaining_qty numeric,
                 work_order_plan_qty numeric, over_allocated boolean)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or not public.is_active_member() then return; end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then return; end if;
  if not exists (select 1 from public.work_order_sections s where s.work_order_id = p_work_order_id) then return; end if;
  return query
  with items as (
    select a.item_id from public.work_order_section_material_plan a where a.work_order_id = p_work_order_id
    union
    select l.item_id from public.material_request_lines l join public.material_requests r on r.id = l.request_id
     where r.work_order_id = p_work_order_id and r.section_id is not null
  ), wo as (
    select i.item_id, public.mrq_plan_quantity(p_work_order_id, i.item_id) as plan,
           coalesce((select sum(a.quantity) from public.work_order_section_material_plan a
                      where a.work_order_id = p_work_order_id and a.item_id = i.item_id), 0) as allocated
      from items i
  ), req as (
    select r.section_id as sid, l.item_id, sum(l.quantity) as q
      from public.material_request_lines l join public.material_requests r on r.id = l.request_id
     where r.work_order_id = p_work_order_id and r.status in ('pending', 'approved', 'fulfilled')
     group by r.section_id, l.item_id
  ), keys as (
    select s.id as sid, wo.item_id from public.work_order_sections s cross join wo where s.work_order_id = p_work_order_id
       and (exists (select 1 from public.work_order_section_material_plan a where a.section_id = s.id and a.item_id = wo.item_id)
            or exists (select 1 from req where req.sid = s.id and req.item_id = wo.item_id))
    union all
    select null::uuid, wo.item_id from wo
  )
  select k.sid, k.item_id,
         case when k.sid is null then wo.plan - wo.allocated
              else (select a.quantity from public.work_order_section_material_plan a where a.section_id = k.sid and a.item_id = k.item_id) end,
         coalesce((select req.q from req where req.sid is not distinct from k.sid and req.item_id = k.item_id), 0),
         case when k.sid is null then wo.plan - wo.allocated - coalesce((select req.q from req where req.sid is null and req.item_id = k.item_id), 0)
              else (select a.quantity from public.work_order_section_material_plan a where a.section_id = k.sid and a.item_id = k.item_id)
                   - coalesce((select req.q from req where req.sid = k.sid and req.item_id = k.item_id), 0) end,
         wo.plan, wo.allocated > wo.plan
    from keys k join wo on wo.item_id = k.item_id
   order by (k.sid is null), k.sid, k.item_id;
end $$;

-- ── §4 the archive guard, restated: tasks (1097) and now draft or pending requests ─────────────────────────────
create or replace function public.wos_archive_blockers(p_section_id uuid) returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select nullif(concat_ws('; ',
    case when t > 0 then t::text || ' task(s) of this section are not done' end,
    case when m > 0 then m::text || ' material request(s) of this section are still draft or pending' end), '')
    from (select (select count(*) from public.tasks x where x.section_id = p_section_id and x.status <> 'Done') as t,
                 (select count(*) from public.material_requests r where r.section_id = p_section_id and r.status in ('draft', 'pending')) as m) c
$$;

-- ── §5 the two request RPCs, restated whole (never edited in place; both keep their grants) ───────────────────────
create or replace function public.mrq_save_draft(p_request_id uuid, p_header jsonb, p_lines jsonb, p_client_request_id uuid default null)
  returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); r public.material_requests; v_wo record; v_to uuid; v_needed date; v_id uuid;
  v_section uuid;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  if p_request_id is null and p_client_request_id is not null then
    select x.id into v_id from public.material_requests x
     where x.org_id = v_org and x.created_by = v_uid and x.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if p_request_id is not null then
    select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
    if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
    if r.created_by <> v_uid then
      raise exception 'MRQ_NOT_AUTHOR: only the person who raised the request can change or submit it' using errcode = '42501'; end if;
    if r.status <> 'draft' then
      raise exception 'MRQ_NOT_DRAFT: only a draft request can be changed or submitted' using errcode = 'P0001'; end if;
  end if;
  select w.id, w.project_id, w.status into v_wo from public.work_orders w
   where w.id = nullif(p_header->>'work_order_id', '')::uuid and w.org_id = v_org;
  if v_wo.id is null then raise exception 'MRQ_WORK_ORDER: the work order is not in your organisation' using errcode = 'P0001'; end if;
  if v_wo.status not in ('Draft','Issued') then
    raise exception 'MRQ_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;
  v_needed := nullif(p_header->>'needed_by', '')::date;
  if v_needed is null then raise exception 'MRQ_INVALID: a request needs a needed-by date' using errcode = 'P0001'; end if;
  v_to := nullif(p_header->>'to_warehouse_id', '')::uuid;
  if v_to is not null and not exists (select 1 from public.stock_warehouses w
        where w.id = v_to and w.org_id = v_org and w.kind = 'site' and w.project_id = v_wo.project_id and w.archived_at is null) then
    raise exception 'MRQ_DESTINATION: the destination must be a site warehouse of the work order''s project' using errcode = 'P0001'; end if;
  if p_header->>'note' is not null and length(p_header->>'note') > 1000 then
    raise exception 'MRQ_INVALID: a note is 1000 characters at most' using errcode = 'P0001'; end if;
  -- #2576 FR-WOS-009: an optional section of THIS work order. A live one for a new or changed choice; a draft that
  -- keeps the section it already has may keep it even after the section was archived (records keep it).
  v_section := nullif(p_header->>'section_id', '')::uuid;
  if v_section is not null and (p_request_id is null or r.section_id is distinct from v_section) then
    if not exists (select 1 from public.work_order_sections s
                    where s.id = v_section and s.work_order_id = v_wo.id and s.org_id = v_org and s.archived_at is null) then
      raise exception 'MRQ_SECTION: the section is not a live section of this work order' using errcode = 'P0001'; end if;
  end if;
  perform public.mrq_validate_lines(v_org, p_lines);

  if p_request_id is null then
    insert into public.material_requests (org_id, number, work_order_id, project_id, section_id, to_warehouse_id, needed_by, note,
                                          client_request_id, created_by)
    values (v_org, public.next_procurement_doc_number(v_org, 'MRQ'), v_wo.id, v_wo.project_id, v_section, v_to, v_needed,
            nullif(btrim(p_header->>'note'), ''), p_client_request_id, v_uid)
    on conflict (org_id, created_by, client_request_id) where client_request_id is not null do nothing
    returning * into r;
    if r.id is null then                                                   -- lost a race to a concurrent replay
      select x.id into v_id from public.material_requests x
       where x.org_id = v_org and x.created_by = v_uid and x.client_request_id = p_client_request_id;
      return v_id;
    end if;
    perform public.mrq_log(r, 'created', null, 'draft', null, v_uid, null, null);
  else
    update public.material_requests
       set work_order_id = v_wo.id, project_id = v_wo.project_id, section_id = v_section, to_warehouse_id = v_to, needed_by = v_needed,
           note = nullif(btrim(p_header->>'note'), ''), updated_at = now()
     where id = r.id
    returning * into r;
    delete from public.material_request_lines where request_id = r.id;
  end if;
  insert into public.material_request_lines (org_id, request_id, line_no, item_id, quantity, over_plan_reason)
  select v_org, r.id, t.n::int, (t.e->>'item_id')::uuid, (t.e->>'quantity')::numeric, nullif(btrim(t.e->>'over_plan_reason'), '')
    from jsonb_array_elements(p_lines) with ordinality as t(e, n);
  return r.id;
end $$;

create or replace function public.mrq_submit(p_request_id uuid, p_client_request_id uuid default null) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); r public.material_requests; v_wo_status public.work_order_status;
  v_cutoff time; v_tz text; v_earliest date; l record; v_plan numeric; v_prior numeric; v_over boolean := false;
  v_splan numeric; v_sprior numeric;
  v_round integer; v_steps integer;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
  if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
  if r.created_by <> v_uid then
    raise exception 'MRQ_NOT_AUTHOR: only the person who raised the request can change or submit it' using errcode = '42501'; end if;
  if p_client_request_id is not null and exists (
    select 1 from public.material_request_events e where e.request_id = r.id and e.action = 'submitted'
      and e.client_request_id = p_client_request_id
  ) then
    return;                                                                 -- FR-MRQ-004 replay, including earlier rounds
  end if;
  if r.status <> 'draft' then
    raise exception 'MRQ_NOT_DRAFT: only a draft request can be changed or submitted' using errcode = 'P0001'; end if;
  select w.status into v_wo_status from public.work_orders w where w.id = r.work_order_id;
  if v_wo_status not in ('Draft','Issued') then
    raise exception 'MRQ_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;

  select s.cutoff_time into v_cutoff from public.material_request_settings s where s.org_id = v_org;
  select o.default_timezone into v_tz from public.organizations o where o.id = v_org;
  v_earliest := public.mrq_cutoff_earliest(v_cutoff, v_tz, r.needed_by, now());
  if v_earliest is not null then
    raise exception 'MRQ_CUTOFF: requests for tomorrow close at %; the earliest date you can request is %',
      to_char(v_cutoff, 'HH24:MI'), v_earliest using errcode = 'P0001';
  end if;

  -- Serialize submissions sharing a work order before reading prior quantities.
  perform pg_advisory_xact_lock(hashtextextended('mrq-plan:' || r.work_order_id::text, 0));
  for l in select * from public.material_request_lines x where x.request_id = r.id order by x.line_no for update loop
    v_plan  := public.mrq_plan_quantity(r.work_order_id, l.item_id);
    v_prior := public.mrq_prior_quantity(r.work_order_id, l.item_id, r.id);
    if v_prior + l.quantity > v_plan then
      v_over := true;
      if l.over_plan_reason is null then                                                               -- mut:over_plan
        raise exception 'MRQ_OVER_PLAN_REASON: line % is over plan and needs a reason (1 to 500 characters)', l.line_no
          using errcode = '23514';
      end if;
    end if;
    -- #2576 FR-WOS-015: the section's own allocation, when one is set, is a second check beside the work order's;
    -- the stricter applies, and both ask for the one existing over-plan reason. A section with no allocation for the
    -- item is checked against the work order's plan only.
    v_splan := null; v_sprior := null;
    if r.section_id is not null then
      v_splan := public.mrq_section_plan_quantity(r.section_id, l.item_id);
      if v_splan is not null then
        v_sprior := public.mrq_section_prior_quantity(r.section_id, l.item_id, r.id);
        if v_sprior + l.quantity > v_splan then                                                          -- mut:section_plan
          v_over := true;
          if l.over_plan_reason is null then
            raise exception 'MRQ_OVER_PLAN_REASON: line % is over its section''s plan and needs a reason (1 to 500 characters)', l.line_no
              using errcode = '23514';
          end if;
        end if;
      end if;
    end if;
    update public.material_request_lines set plan_qty = v_plan, prior_qty = v_prior,
           section_plan_qty = v_splan, section_prior_qty = v_sprior where id = l.id;
  end loop;

  v_round := r.round + 1;
  insert into public.material_request_steps (org_id, request_id, round, position, role, label, status)
  select v_org, r.id, v_round, row_number() over (order by c.position), c.role, c.label, 'waiting'
    from public.approval_chain_steps c
   where c.org_id = v_org and (not c.only_over_plan or v_over);
  get diagnostics v_steps = row_count;
  if v_steps = 0 then
    raise exception 'MRQ_NO_CHAIN: no approval chain is set up for material requests; ask an Admin' using errcode = 'P0001'; end if;
  update public.material_request_steps set status = 'open' where request_id = r.id and round = v_round and position = 1;
  update public.material_requests
     set status = 'pending', round = v_round, submitted_at = now(), submit_request_id = p_client_request_id,
         decided_at = null, updated_at = now()
   where id = r.id;
  insert into public.material_request_events (org_id, request_id, action, from_status, to_status, actor_id, client_request_id)
  values (v_org, r.id, 'submitted', 'draft', 'pending', v_uid, p_client_request_id);
end $$;

-- ── §6 ACL: internals nobody; client reads authenticated only ─────────────────────────────────────────────────
revoke all on function
  public.mrq_section_plan_quantity(uuid, uuid), public.mrq_section_prior_quantity(uuid, uuid, uuid),
  public.guard_material_request_section(), public.wos_archive_blockers(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.mrq_section_plan_for(uuid, uuid, uuid[], uuid), public.work_order_section_material_check(uuid) from public, anon;
grant execute on function public.mrq_section_plan_for(uuid, uuid, uuid[], uuid), public.work_order_section_material_check(uuid) to authenticated;
