-- 2261_consumable_plan_approval.sql — 24 Nov people lane, FR-PEO-003.
-- Plans remain editable by today's writers and the Project Control Manager. A material request uses a plan only after
-- a separate approver has approved the current inputs. Plan-line writes record the latest author and invalidate approval.
-- Reverse: supabase/migrations/rollback/2261_consumable_plan_approval_down.sql

alter table public.work_orders
  add column consumable_plan_author_id uuid,
  add column consumable_plan_author_is_pcm boolean not null default false,
  add column consumable_plan_approved_by uuid,
  add column consumable_plan_approved_at timestamptz,
  add column consumable_plan_approved_fingerprint text,
  add constraint work_orders_consumable_plan_approval_all_or_none check (
    (consumable_plan_approved_by is null and consumable_plan_approved_at is null and consumable_plan_approved_fingerprint is null)
    or (consumable_plan_approved_by is not null and consumable_plan_approved_at is not null and consumable_plan_approved_fingerprint is not null)
  );

-- drops: cus_assert_planner adds the Project Control Manager job role while retaining the project-writer and Engineer predicates.
-- 2046 is the latest planner gate. Keep its project writers and Engineer; add the PCM job role.
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
          or public.actor_holds_job_role('engineer')                                                    -- mut:rr_engineer_consumables
          or public.actor_holds_job_role('project_control_manager')) then                              -- mut:rr_pcm_consumables
    raise exception 'CUS_FORBIDDEN: you cannot plan consumables for this work order' using errcode = '42501'; end if;
  if p_open and wo.status not in ('Draft', 'Issued') then
    raise exception 'CUS_WORK_ORDER: the work order is closed or cancelled; its consumable plan cannot change' using errcode = 'P0001'; end if;
  return wo;
end $$;
revoke all on function public.cus_assert_planner(uuid, boolean) from public, anon, authenticated, service_role;

-- Internal approval authority is valid only for the fingerprint that was approved.
create function public.cus_plan_is_approved(p_work_order_id uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(w.consumable_plan_author_id is not null
      and w.consumable_plan_approved_by is not null
      and w.consumable_plan_approved_at is not null
      and w.consumable_plan_approved_fingerprint = public.cus_plan_fingerprint(w.id), false)
    from public.work_orders w where w.id = p_work_order_id
$$;
revoke all on function public.cus_plan_is_approved(uuid) from public, anon, authenticated, service_role;

-- The line table has no client write grant. Its RPCs are the only supported writers; this trigger records their actor
-- (including a generation with many line changes) and clears any prior decision on every plan edit.
create function public.cus_capture_plan_author() returns trigger
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
create trigger work_order_consumable_plan_capture_author
  after insert or update or delete on public.work_order_consumable_plan_lines
  for each row execute function public.cus_capture_plan_author();

-- The caller may read their organisation's approval state alongside cus_get_plan's plan lines.
create function public.cus_plan_approval_status(p_work_order_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_wo public.work_orders;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into v_wo from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org;
  if not found then raise exception 'CUS_NOT_FOUND: the work order is not in your organisation' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'author_id', v_wo.consumable_plan_author_id,
    'author_is_pcm', v_wo.consumable_plan_author_is_pcm,
    'approved', public.cus_plan_is_approved(v_wo.id),
    'approved_by', v_wo.consumable_plan_approved_by,
    'approved_at', v_wo.consumable_plan_approved_at
  );
end $$;
revoke all on function public.cus_plan_approval_status(uuid) from public, anon;
grant execute on function public.cus_plan_approval_status(uuid) to authenticated;

-- A PCM approves an Engineer/other-authored plan. If a PCM authored it, only an Admin or this project's PM may approve.
create function public.cus_approve_plan(p_work_order_id uuid) returns void
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

-- 1156 is the latest precedence function. An unapproved or stale plan falls through to the existing allowance/zero rules.
create or replace function public.mrq_plan_figure(p_work_order_id uuid, p_item_id uuid)
  returns table (plan_qty numeric, plan_source text)
  language sql stable security definer set search_path = public, pg_temp as $$
  select p.pq, p.src from (
    select coalesce(pl.adjusted_qty, pl.generated_qty) as pq,
           case when pl.adjusted_qty is not null then 'adjusted' else 'standard' end as src, 1 as ord
      from public.work_order_consumable_plan_lines pl
     where pl.work_order_id = p_work_order_id and pl.item_id = p_item_id
       and public.cus_plan_is_approved(p_work_order_id)                                               -- mut:approved_plan_first
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
