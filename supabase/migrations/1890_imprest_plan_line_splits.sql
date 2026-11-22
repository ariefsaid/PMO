-- 1890_imprest_plan_line_splits.sql — cash-advance-estimate: an optional split of a site cash plan line over work orders.
-- Spec docs/specs/cash-advance-estimate.spec.md (FR-CAE-001..003, 011); plan docs/plans/2026-11-22-cash-advance-estimate.md.
-- Proven by supabase/tests/1890_imprest_plan_line_splits.test.sql (header: mutation check).
-- A split is a BREAKDOWN of an existing plan line: the line, the plan total and the approval route are untouched, and no
-- existing money function is restated. Reverse: rollback/1890_imprest_plan_line_splits_down.sql.
--   §1 table (select-only for signed-in users; service_role writes revoked: only the two RPCs below write it)
--   §2 org stamped from the line by trigger, never from the client
--   §3 a trigger on imprest_plan_lines refusing a lower amount than the splits already assigned
--   §4 save_imprest_plan_line_split / delete_imprest_plan_line_split (definer): author-only, Draft/Rejected plan only,
--      same-project open work order, splits never exceed the line

create table public.imprest_plan_line_splits (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id),
  line_id       uuid not null references public.imprest_plan_lines(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id),
  amount        numeric(14,2) not null,
  created_at    timestamptz not null default now(),
  constraint imprest_plan_line_splits_amount_range check (amount > 0 and amount < 'Infinity'::numeric),
  constraint imprest_plan_line_splits_one_per_work_order unique (line_id, work_order_id)
);
create index imprest_plan_line_splits_wo_idx on public.imprest_plan_line_splits (work_order_id);

alter table public.imprest_plan_line_splits enable row level security;
alter table public.imprest_plan_line_splits force  row level security;
-- Same population as the plan line (the policy joins the line, which joins the plan and the float: approval rank only, so a
-- light account reads nothing). Every caller-context helper is wrapped so it runs once per query.
create policy imprest_plan_line_splits_select on public.imprest_plan_line_splits for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and exists (select 1 from public.imprest_plan_lines l where l.id = imprest_plan_line_splits.line_id));
revoke all on public.imprest_plan_line_splits from public, anon, authenticated;
grant select on public.imprest_plan_line_splits to authenticated;
revoke insert, update, delete, truncate, trigger, references on public.imprest_plan_line_splits from service_role;

-- §2 org_id comes from the line (runs as the owner so a hidden parent cannot leave it null).
create or replace function public.stamp_imprest_split_org() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select l.org_id into new.org_id from public.imprest_plan_lines l where l.id = new.line_id;
  return new;
end; $$;
revoke all on function public.stamp_imprest_split_org() from public, anon, authenticated;
create trigger imprest_plan_line_splits_stamp_org before insert on public.imprest_plan_line_splits
  for each row execute function public.stamp_imprest_split_org();

-- §3 a line cannot drop below what is already split off it (FR-CAE-003).
create or replace function public.refuse_line_below_splits() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sum numeric;
begin
  select coalesce(sum(s.amount), 0) into v_sum from public.imprest_plan_line_splits s where s.line_id = new.id;
  if new.planned_amount < v_sum then
    raise exception 'ICE_SPLIT_OVER_LINE: the line would be % but % is already assigned to work orders', new.planned_amount, v_sum
      using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.refuse_line_below_splits() from public, anon, authenticated;
create trigger imprest_plan_lines_below_splits before update of planned_amount on public.imprest_plan_lines
  for each row execute function public.refuse_line_below_splits();

-- §4 the only writers. Authority: the plan's author while the plan is Draft or Rejected (as the line itself).
create or replace function public.save_imprest_plan_line_split(p_line uuid, p_work_order uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_l   public.imprest_plan_lines%rowtype;
  v_p   public.imprest_plans%rowtype;
  v_f   public.imprest_floats%rowtype;
  v_wo  public.work_orders%rowtype;
  v_other numeric;
  v_id  uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into v_l from public.imprest_plan_lines where id = p_line for update;
  if not found or v_l.org_id is distinct from public.auth_org_id() then
    raise exception 'plan line not found' using errcode = 'P0002';
  end if;
  perform public.assert_feature_on(v_l.org_id, 'imprest');
  select * into v_p from public.imprest_plans where id = v_l.plan_id;
  if v_p.author_id is distinct from auth.uid() then
    raise exception 'only the author of the plan changes its lines' using errcode = '42501';
  end if;
  if v_p.status not in ('Draft', 'Rejected') then
    raise exception 'this plan is % and its lines can no longer be changed (FR-IMP-012)', v_p.status using errcode = '42501';
  end if;
  if p_amount is null or not (p_amount > 0 and p_amount < 'Infinity'::numeric) then
    raise exception 'a split amount must be greater than zero' using errcode = 'P0001';
  end if;
  select * into v_f from public.imprest_floats where id = v_p.float_id;
  select * into v_wo from public.work_orders where id = p_work_order;
  if not found or v_wo.org_id is distinct from v_l.org_id or v_wo.project_id is distinct from v_f.project_id then
    raise exception 'ICE_WO_PROJECT: the work order belongs to another project than this site cash' using errcode = '23514';
  end if;
  if v_wo.status = 'Cancelled' and not exists (select 1 from public.imprest_plan_line_splits s
                                                where s.line_id = p_line and s.work_order_id = p_work_order) then
    raise exception 'ICE_WO_CANCELLED: the work order is cancelled' using errcode = '23514';
  end if;
  select coalesce(sum(s.amount), 0) into v_other from public.imprest_plan_line_splits s
   where s.line_id = p_line and s.work_order_id <> p_work_order;
  if v_other + round(p_amount, 2) > v_l.planned_amount then
    raise exception 'ICE_SPLIT_OVER_LINE: the splits would add up to % against a line of %', v_other + round(p_amount, 2), v_l.planned_amount
      using errcode = '23514';
  end if;
  insert into public.imprest_plan_line_splits (org_id, line_id, work_order_id, amount)
  values (v_l.org_id, p_line, p_work_order, round(p_amount, 2))
  on conflict (line_id, work_order_id) do update set amount = excluded.amount
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.save_imprest_plan_line_split(uuid, uuid, numeric) from public, anon;
grant execute on function public.save_imprest_plan_line_split(uuid, uuid, numeric) to authenticated;

create or replace function public.delete_imprest_plan_line_split(p_split uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s public.imprest_plan_line_splits%rowtype; v_p public.imprest_plans%rowtype;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into v_s from public.imprest_plan_line_splits where id = p_split;
  if not found or v_s.org_id is distinct from public.auth_org_id() then
    raise exception 'split not found' using errcode = 'P0002';
  end if;
  perform public.assert_feature_on(v_s.org_id, 'imprest');
  select p.* into v_p from public.imprest_plans p join public.imprest_plan_lines l on l.plan_id = p.id where l.id = v_s.line_id for update of p;
  if v_p.author_id is distinct from auth.uid() then
    raise exception 'only the author of the plan changes its lines' using errcode = '42501';
  end if;
  if v_p.status not in ('Draft', 'Rejected') then
    raise exception 'this plan is % and its lines can no longer be changed (FR-IMP-012)', v_p.status using errcode = '42501';
  end if;
  delete from public.imprest_plan_line_splits where id = p_split;
end; $$;
revoke all on function public.delete_imprest_plan_line_split(uuid) from public, anon;
grant execute on function public.delete_imprest_plan_line_split(uuid) to authenticated;
