-- 0997_work_order_plan_lines.sql — #2519: planned figures per work order (and optionally per discipline).
-- Spec docs/specs/work-order-plan-vs-actual.spec.md (FR-WPVA-001..004); plan docs/plans/2026-11-20-work-order-plan-vs-actual.md.
-- Proven by supabase/tests/0997_work_order_plan_vs_actual.test.sql.
--
-- Four kinds of plan figure: direct budget and indirect budget (money, in the work order's own currency — there is no
-- currency column, so a plan figure cannot be in another currency), equipment hours and crew hours. One figure per
-- work order × discipline (or none) × kind. A plan figure never changes an actual, a project total or a budget
-- version (FR-WPVA-004): nothing reads this table except the plan-vs-actual screens.
--
-- ── REVERSE (also supabase/migrations/rollback/0997_work_order_plan_lines_down.sql) ────────────────────
--   drop table if exists public.work_order_plan_lines;   -- drops its policies and triggers
--   drop function if exists public.check_work_order_plan_line();
--   drop function if exists public.audit_work_order_plan_line();

create table public.work_order_plan_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  project_id    uuid not null references public.projects(id),
  work_order_id uuid not null references public.work_orders(id),
  discipline_id uuid references public.cost_disciplines(id),
  kind          text not null check (kind in ('direct_budget', 'indirect_budget', 'equipment_hours', 'crew_hours')),
  -- FR-WPVA-002: non-negative, finite, at most two decimals (cents for money, hundredths for hours).
  value         numeric not null check (value >= 0 and value < 1e15 and value = round(value, 2)),
  note          text check (note is null or char_length(note) <= 500),
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) default auth.uid(),
  updated_at    timestamptz not null default now()
);
create unique index work_order_plan_lines_one_per_kind on public.work_order_plan_lines
  (work_order_id, coalesce(discipline_id, '00000000-0000-0000-0000-000000000000'::uuid), kind);
create index work_order_plan_lines_project_idx on public.work_order_plan_lines (org_id, project_id);
create trigger work_order_plan_lines_stamp_org_id before insert on public.work_order_plan_lines
  for each row execute function public.stamp_org_id();

-- FR-WPVA-002/003: the work order is on the row's own org and project; a Cancelled work order's plan is frozen;
-- the discipline is on the org's live list. Definer: it reads work_orders / cost_disciplines whatever the caller's
-- RLS. It guards every writer. Never client-callable.
create function public.check_work_order_plan_line() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.work_order_plan_lines := case when tg_op = 'DELETE' then old else new end;
  v_org uuid; v_project uuid; v_status public.work_order_status;
begin
  select w.org_id, w.project_id, w.status into v_org, v_project, v_status
    from public.work_orders w where w.id = v_row.work_order_id;
  if tg_op = 'UPDATE' and (new.work_order_id is distinct from old.work_order_id or new.project_id is distinct from old.project_id
                           or new.org_id is distinct from old.org_id or new.kind is distinct from old.kind
                           or new.discipline_id is distinct from old.discipline_id) then
    raise exception 'WPVA_PLAN_KEY: a plan figure keeps its work order, discipline and kind' using errcode = '23514';
  end if;
  if v_org is distinct from v_row.org_id or v_project is distinct from v_row.project_id then
    raise exception 'WPVA_PLAN_WO: the work order belongs to another project' using errcode = '23514';
  end if;
  if v_status = 'Cancelled' then
    raise exception 'WPVA_PLAN_CANCELLED: a cancelled work order''s plan is frozen' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.discipline_id is not null and not exists (
       select 1 from public.cost_disciplines d
        where d.id = new.discipline_id and d.org_id = new.org_id and d.archived_at is null) then
    raise exception 'WPVA_PLAN_DISCIPLINE: the discipline is not on this organisation''s list' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.check_work_order_plan_line() from public, anon, authenticated;
create trigger zz_work_order_plan_lines_check before insert or update or delete on public.work_order_plan_lines
  for each row execute function public.check_work_order_plan_line();

-- FR-WPVA-003: every edit leaves one audit row with before and after.
create function public.audit_work_order_plan_line() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.work_order_plan_lines := case when tg_op = 'DELETE' then old else new end;
  pick constant text[] := array['discipline_id', 'kind', 'value', 'note'];
  v_before jsonb; v_after jsonb;
begin
  if tg_op <> 'INSERT' then
    select jsonb_object_agg(k, to_jsonb(old) -> k) into v_before from unnest(pick) k;
  end if;
  if tg_op <> 'DELETE' then
    select jsonb_object_agg(k, to_jsonb(new) -> k) into v_after from unnest(pick) k;
    if tg_op = 'UPDATE' and v_after = v_before then return new; end if;
  end if;
  perform public.log_audit('work_order_plan.' || lower(tg_op), v_row.org_id, auth.uid(), v_row.work_order_id,
    jsonb_build_object('plan_line_id', v_row.id, 'before', v_before, 'after', v_after));
  return null;
end $$;
revoke all on function public.audit_work_order_plan_line() from public, anon, authenticated;
create trigger zz_work_order_plan_lines_audit after insert or update or delete on public.work_order_plan_lines
  for each row execute function public.audit_work_order_plan_line();

alter table public.work_order_plan_lines enable row level security;
alter table public.work_order_plan_lines force row level security;

-- Plan figures are money: read and written by the roles that read a project's margin (FR-WPVA-003, OQ-8).
create policy work_order_plan_lines_select on public.work_order_plan_lines for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin', 'Executive', 'Finance', 'Project Manager'));
create policy work_order_plan_lines_insert on public.work_order_plan_lines for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and (select public.auth_role()) in ('Admin', 'Executive', 'Finance', 'Project Manager'));
create policy work_order_plan_lines_update on public.work_order_plan_lines for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin', 'Executive', 'Finance', 'Project Manager'))
  with check (org_id = (select public.auth_org_id()));
create policy work_order_plan_lines_delete on public.work_order_plan_lines for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin', 'Executive', 'Finance', 'Project Manager'));

revoke all on public.work_order_plan_lines from public, anon, authenticated;
grant select, delete on public.work_order_plan_lines to authenticated;
grant insert (project_id, work_order_id, discipline_id, kind, value, note) on public.work_order_plan_lines to authenticated;
grant update (value, note) on public.work_order_plan_lines to authenticated;
grant all on public.work_order_plan_lines to service_role;
