-- Reverses 2262 to the 2261 approval bodies and the 1155 plan writers.

create or replace function public.cus_capture_plan_author() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_wo uuid; v_actor uuid := auth.uid(); v_is_pcm boolean := false;
begin
  if tg_op = 'DELETE' then v_wo := old.work_order_id; else v_wo := new.work_order_id; end if;
  if v_actor is not null then v_is_pcm := public.actor_holds_job_role('project_control_manager'); end if;
  update public.work_orders
     set consumable_plan_author_id = v_actor,
         consumable_plan_author_is_pcm = v_is_pcm,
         consumable_plan_approved_by = null,
         consumable_plan_approved_at = null,
         consumable_plan_approved_fingerprint = null
   where id = v_wo;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.cus_capture_plan_author() from public, anon, authenticated, service_role;

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
revoke all on function public.cus_generate_plan(uuid) from public, anon;
grant execute on function public.cus_generate_plan(uuid) to authenticated;

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
revoke all on function public.cus_adjust_plan_line(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.cus_adjust_plan_line(uuid, uuid, numeric, text) to authenticated;

create or replace function public.cus_approve_plan(p_work_order_id uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_wo public.work_orders; v_project_manager uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into v_wo from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org for update;
  if not found then raise exception 'CUS_NOT_FOUND: the work order is not in your organisation' using errcode = 'P0001'; end if;
  if v_wo.status not in ('Draft', 'Issued') then
    raise exception 'CUS_WORK_ORDER: the work order is closed or cancelled; its consumable plan cannot change' using errcode = 'P0001'; end if;
  if v_wo.consumable_plan_author_id is null then
    raise exception 'CUS_PLAN_MISSING: generate or edit the plan before approval' using errcode = 'P0001'; end if;
  if exists (select 1 from public.work_order_consumable_plan_lines p
              where p.work_order_id = v_wo.id and p.generated_at is not null
                and p.input_fingerprint is distinct from public.cus_plan_fingerprint(v_wo.id)) then
    raise exception 'CUS_PLAN_STALE: regenerate the plan before approval' using errcode = 'P0001'; end if;
  if v_wo.consumable_plan_author_id = v_uid then                                             -- mut:plan_approve_author
    raise exception 'CUS_SOD: the plan author cannot approve it' using errcode = '42501'; end if;
  if v_wo.consumable_plan_author_is_pcm then
    select p.project_manager_id into v_project_manager from public.projects p
     where p.id = v_wo.project_id and p.org_id = v_org;
    if public.auth_role() <> 'Admin'
       and not (public.auth_role() = 'Project Manager' and v_project_manager = v_uid) then
      raise exception 'CUS_APPROVER: only an Admin or this project''s manager may approve a PCM-authored plan' using errcode = '42501';
    end if;
  elsif not public.actor_holds_job_role('project_control_manager') then
    raise exception 'CUS_APPROVER: a Project Control Manager must approve this plan' using errcode = '42501';
  end if;
  update public.work_orders
     set consumable_plan_approved_by = v_uid,
         consumable_plan_approved_at = now(),
         consumable_plan_approved_fingerprint = public.cus_plan_fingerprint(v_wo.id)
   where id = v_wo.id;
end $$;
revoke all on function public.cus_approve_plan(uuid) from public, anon;
grant execute on function public.cus_approve_plan(uuid) to authenticated;
