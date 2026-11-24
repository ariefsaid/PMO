-- Reverses 2261_consumable_plan_approval.sql.
drop trigger if exists work_order_consumable_plan_capture_author on public.work_order_consumable_plan_lines;
drop function if exists public.cus_capture_plan_author();
drop function if exists public.cus_plan_approval_status(uuid);
drop function if exists public.cus_approve_plan(uuid);
drop function if exists public.cus_plan_is_approved(uuid);

create or replace function public.cus_assert_planner(p_work_order_id uuid, p_open boolean default true) returns public.work_orders
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid; wo public.work_orders;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into wo from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org;
  if not found then
    raise exception 'CUS_NOT_FOUND: the work order is not in your organisation' using errcode = 'P0001'; end if;
  if not (public.may_record_project_progress(wo.project_id)                                            -- mut:plan_writer
          or public.actor_holds_job_role('engineer')) then                                             -- mut:rr_engineer_consumables
    raise exception 'CUS_FORBIDDEN: you cannot plan consumables for this work order' using errcode = '42501'; end if;
  if p_open and wo.status not in ('Draft', 'Issued') then
    raise exception 'CUS_WORK_ORDER: the work order is closed or cancelled; its consumable plan cannot change' using errcode = 'P0001'; end if;
  return wo;
end $$;
revoke all on function public.cus_assert_planner(uuid, boolean) from public, anon, authenticated, service_role;

create or replace function public.mrq_plan_figure(p_work_order_id uuid, p_item_id uuid)
  returns table (plan_qty numeric, plan_source text)
  language sql stable security definer set search_path = public, pg_temp as $$
  select p.pq, p.src from (
    select coalesce(pl.adjusted_qty, pl.generated_qty) as pq,
           case when pl.adjusted_qty is not null then 'adjusted' else 'standard' end as src, 1 as ord
      from public.work_order_consumable_plan_lines pl
     where pl.work_order_id = p_work_order_id and pl.item_id = p_item_id                                 -- mut:plan_first
    union all
    select a.q, 'allowance', 2
      from (select round(sum(al.planned_quantity
                             * case when b.quantity > 0 then least(wl.quantity / b.quantity, 1) else 1 end), 3) as q
              from public.work_order_lines wl
              join public.boq_items b on b.id = wl.boq_item_id and b.org_id = wl.org_id
              join public.boq_material_allowances al on al.boq_item_id = b.id and al.item_id = p_item_id and al.org_id = wl.org_id
             where wl.work_order_id = p_work_order_id
            having count(al.id) > 0) a
    union all
    select 0.000::numeric, 'none', 3
  ) p order by p.ord limit 1
$$;
revoke all on function public.mrq_plan_figure(uuid, uuid) from public, anon, authenticated, service_role;

alter table public.work_orders
  drop constraint if exists work_orders_consumable_plan_approval_all_or_none,
  drop column if exists consumable_plan_author_id,
  drop column if exists consumable_plan_author_is_pcm,
  drop column if exists consumable_plan_approved_by,
  drop column if exists consumable_plan_approved_at,
  drop column if exists consumable_plan_approved_fingerprint;
