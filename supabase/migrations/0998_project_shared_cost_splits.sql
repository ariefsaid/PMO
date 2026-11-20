-- 0998_project_shared_cost_splits.sql — #2519: a project's custom split of its shared cost over its work orders.
-- Spec docs/specs/work-order-plan-vs-actual.spec.md (FR-WPVA-022..024). Proven by
-- supabase/tests/0997_work_order_plan_vs_actual.test.sql.
--
-- Without a saved split the screens use the default (share of direct cost, else an equal split — computed, never
-- stored). A saved split is one percentage per live work order, 0..100 with up to 4 decimals, summing to exactly
-- 100 (as FR-CAT-005). It is read-side only: nothing is posted. Only Admin, Executive and Finance set or clear it,
-- through the two definer RPCs below (no direct table writes are granted); each change is audited.
-- A work order added or cancelled later makes the saved split "stale": the screens fall back to the default until
-- someone saves again (decided in the pure module, src/lib/workOrderPlanVsActual.ts).
--
-- ── REVERSE (also supabase/migrations/rollback/0998_project_shared_cost_splits_down.sql) ───────────────
--   drop function if exists public.clear_shared_cost_split(uuid);
--   drop function if exists public.set_shared_cost_split(uuid, jsonb);
--   drop table if exists public.project_shared_cost_splits;

create table public.project_shared_cost_splits (
  org_id        uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  project_id    uuid not null references public.projects(id),
  work_order_id uuid not null references public.work_orders(id),
  percent       numeric(7, 4) not null check (percent >= 0 and percent <= 100),
  saved_by      uuid references public.profiles(id) default auth.uid(),
  saved_at      timestamptz not null default now(),
  primary key (project_id, work_order_id)
);
create index project_shared_cost_splits_org_idx on public.project_shared_cost_splits (org_id, project_id);
create trigger project_shared_cost_splits_stamp_org_id before insert on public.project_shared_cost_splits
  for each row execute function public.stamp_org_id();

alter table public.project_shared_cost_splits enable row level security;
alter table public.project_shared_cost_splits force row level security;
create policy project_shared_cost_splits_select on public.project_shared_cost_splits for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin', 'Executive', 'Finance', 'Project Manager'));
revoke all on public.project_shared_cost_splits from public, anon, authenticated;
grant select on public.project_shared_cost_splits to authenticated;
grant all on public.project_shared_cost_splits to service_role;

-- p_split: [{"work_order_id": uuid, "percent": "33.3333"}, …] — every live (not Cancelled) work order of the project
-- exactly once; percents as text or number, 0..100, up to 4 decimals, summing to exactly 100.
create function public.set_shared_cost_split(p_project_id uuid, p_split jsonb) returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_before jsonb;
  v_n int;
  v_bad int;
  v_sum numeric;
  v_ids text[];
  v_pcts text[];
  v_wo uuid[];
  v_pct numeric[];
begin
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.auth_role() is null or public.auth_role() not in ('Admin', 'Executive', 'Finance') then
    raise exception 'WPVA_SPLIT_ROLE: only Admin, Executive or Finance set a shared-cost split' using errcode = '42501';
  end if;
  perform 1 from public.projects p where p.id = p_project_id and p.org_id = v_org for update;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';   -- SECURITY: another org's project reads as absent
  end if;
  if p_split is null or jsonb_typeof(p_split) <> 'array' or jsonb_array_length(p_split) = 0 then
    raise exception 'WPVA_SPLIT_SHAPE: name each work order with its percentage' using errcode = '22023';
  end if;

  select array_agg(btrim(e->>'work_order_id')), array_agg(btrim(e->>'percent'))
    into v_ids, v_pcts from jsonb_array_elements(p_split) e;
  if exists (select 1 from unnest(v_ids) i where i is null or i !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'WPVA_SPLIT_SHAPE: name each work order once' using errcode = '22023';
  end if;
  select count(*) filter (where pct is null or pct !~ '^\d{1,3}(\.\d{1,4})?$' or pct::numeric > 100)
    into v_bad from unnest(v_pcts) pct;
  if v_bad > 0 then
    raise exception 'WPVA_SPLIT_PERCENT: each percentage is 0 to 100 with up to 4 decimals' using errcode = '22023';
  end if;
  if (select count(*) <> count(distinct i) from unnest(v_ids) i) then
    raise exception 'WPVA_SPLIT_SHAPE: name each work order once' using errcode = '22023';
  end if;
  v_wo := v_ids::uuid[];
  v_pct := v_pcts::numeric[];
  -- Exactly the project's live work orders: none missing, none foreign, none cancelled.
  if exists (select 1 from unnest(v_wo, v_pct) as s(work_order_id, percent)
              where not exists (select 1 from public.work_orders w
                                 where w.id = s.work_order_id and w.org_id = v_org and w.project_id = p_project_id
                                   and w.status <> 'Cancelled'))
     or exists (select 1 from public.work_orders w
                 where w.org_id = v_org and w.project_id = p_project_id and w.status <> 'Cancelled'
                   and not exists (select 1 from unnest(v_wo, v_pct) as s(work_order_id, percent) where s.work_order_id = w.id)) then
    raise exception 'WPVA_SPLIT_WORK_ORDERS: the split names every live work order of this project, and only those' using errcode = '23514';
  end if;
  select sum(x) into v_sum from unnest(v_pct) x;
  if v_sum <> 100 then
    raise exception 'WPVA_SPLIT_SUM: the percentages add up to %, not 100', v_sum using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('work_order_id', work_order_id, 'percent', percent) order by work_order_id), '[]')
    into v_before from public.project_shared_cost_splits where project_id = p_project_id and org_id = v_org;
  delete from public.project_shared_cost_splits where project_id = p_project_id and org_id = v_org;
  insert into public.project_shared_cost_splits (org_id, project_id, work_order_id, percent, saved_by)
    select v_org, p_project_id, s.work_order_id, s.percent, v_uid from unnest(v_wo, v_pct) as s(work_order_id, percent);
  get diagnostics v_n = row_count;
  perform public.log_audit('shared_cost_split.set', v_org, v_uid, p_project_id,
    jsonb_build_object('before', v_before,
      'after', (select jsonb_agg(jsonb_build_object('work_order_id', work_order_id, 'percent', percent) order by work_order_id)
                  from unnest(v_wo, v_pct) as x(work_order_id, percent))));
  return v_n;
end $$;
revoke all on function public.set_shared_cost_split(uuid, jsonb) from public, anon;
grant execute on function public.set_shared_cost_split(uuid, jsonb) to authenticated;

-- Clearing returns the project to the default split.
create function public.clear_shared_cost_split(p_project_id uuid) returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_before jsonb;
  v_n int;
begin
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.auth_role() is null or public.auth_role() not in ('Admin', 'Executive', 'Finance') then
    raise exception 'WPVA_SPLIT_ROLE: only Admin, Executive or Finance set a shared-cost split' using errcode = '42501';
  end if;
  perform 1 from public.projects p where p.id = p_project_id and p.org_id = v_org for update;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  select jsonb_agg(jsonb_build_object('work_order_id', work_order_id, 'percent', percent) order by work_order_id)
    into v_before from public.project_shared_cost_splits where project_id = p_project_id and org_id = v_org;
  delete from public.project_shared_cost_splits where project_id = p_project_id and org_id = v_org;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public.log_audit('shared_cost_split.clear', v_org, v_uid, p_project_id, jsonb_build_object('before', v_before, 'after', null));
  end if;
  return v_n;
end $$;
revoke all on function public.clear_shared_cost_split(uuid) from public, anon;
grant execute on function public.clear_shared_cost_split(uuid) to authenticated;
