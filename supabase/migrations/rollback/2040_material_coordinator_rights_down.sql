-- Reverses 2040_material_coordinator_rights.sql: restores the six bodies from their earlier migrations and drops the owner job role columns.
create or replace function public.stock_assert_writeoff_approver(p_doc public.stock_documents, p_uid uuid) returns void
  language plpgsql stable security definer set search_path = public as $$
declare v_self_ok boolean; v_rank_ok boolean;
begin
  v_self_ok := p_doc.created_by is distinct from p_uid;                                                   -- mut:selfapprove
  if not v_self_ok then raise exception 'STK_SELF_APPROVE: a write-off must be posted by someone other than its author' using errcode = 'P0001'; end if;
  v_rank_ok := coalesce(public.role_rank(public.auth_role()) >= 20, false);                               -- mut:writeoff_rank
  if not v_rank_ok then raise exception 'STK_RANK: only a Project Manager or above posts a write-off' using errcode = 'P0001'; end if;
end $$;

create or replace function public.csr_assert_recorder() returns void
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not coalesce(public.role_rank(public.auth_role()) >= 20, false) then
    raise exception 'CSR_FORBIDDEN: only a Project Manager or above records a reservation or release' using errcode = '42501'; end if;
end $$;

create or replace function public.get_stock_at_risk()
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
  v_cost boolean;
  v_rows jsonb;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_cost := public.stock_can_see_cost();                                                                -- mut:atrisk_cost
  with held as (
    select b.warehouse_id, sum(b.value_on_hand) as value_held
      from public.stock_balances b
     where b.org_id = v_org and b.qty_on_hand > 0
     group by b.warehouse_id)
  select coalesce(jsonb_agg(
           jsonb_build_object('warehouse_id', w.id, 'warehouse_code', w.code, 'warehouse_name', w.name,
                              'warehouse_kind', w.kind, 'project_id', w.project_id, 'project_name', p.name)
           || case when v_cost then jsonb_build_object(
                    'stock_value', h.value_held::text,
                    'cover_value', w.cover_value::text,
                    'at_risk', (case when w.cover_value is null then h.value_held
                                     else greatest(h.value_held - w.cover_value, 0::numeric) end)::text)
                  else '{}'::jsonb end
           order by (case when v_cost then
                       case when w.cover_value is null then h.value_held
                            else greatest(h.value_held - w.cover_value, 0::numeric) end end) desc nulls last,
                    w.code, w.id), '[]'::jsonb)
    into v_rows
    from held h
    join public.stock_warehouses w on w.id = h.warehouse_id and w.org_id = v_org
    left join public.projects p on p.id = w.project_id;
  return v_rows;
end $$;

create or replace function public.set_closeout_checklist(p_items jsonb) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid      := public.auth_org_id();
  v_role user_role := public.auth_role();
  v_item jsonb;
  v_pos  int := 0;
  v_days text;
begin
  perform public.assert_not_light();
  -- SECURITY: membership, role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role <> 'Admin' then
    raise exception 'only an Admin can set the organisation''s close-out checklist' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 20 then
    raise exception 'the close-out checklist is a list of at most 20 items' using errcode = '22023', detail = 'items-shape';
  end if;
  -- One list per organisation: serialise concurrent replacements on the organisation row.
  perform 1 from public.organizations o where o.id = v_org for update;
  delete from public.closeout_checklist_templates t where t.org_id = v_org;
  for v_item in select x from jsonb_array_elements(p_items) x loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_item) <> 'object' or coalesce(btrim(v_item ->> 'name'), '') = '' or length(btrim(v_item ->> 'name')) > 120 then
      raise exception 'every close-out item needs a name of 1 to 120 characters' using errcode = '23514', detail = 'item-name-invalid';
    end if;
    v_days := nullif(btrim(v_item ->> 'target_days'), '');
    if v_days is not null and (v_days !~ '^[0-9]{1,3}$' or v_days::int not between 1 and 365) then
      raise exception 'COT_TARGET_DAYS: a target is a whole number of days from 1 to 365' using errcode = '23514', detail = 'item-target-invalid';
    end if;
    insert into public.closeout_checklist_templates (org_id, position, name, required, target_days)
    values (v_org, v_pos, btrim(v_item ->> 'name'), coalesce((v_item ->> 'required')::boolean, true), v_days::smallint);
  end loop;
  perform public.log_audit('closeout_checklist.set', v_org, auth.uid(), v_org, jsonb_build_object('items', v_pos));
  return v_pos;
end; $$;

create or replace function public.instantiate_work_order_closeout_items() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.work_order_closeout_items (org_id, work_order_id, project_id, position, name, required, started_on, target_days, due_on)
  select new.org_id, new.id, new.project_id, t.position, t.name, t.required,
         public.native_org_today(new.org_id),   -- every item is current from the issue day; a done required item restarts the next required one
         t.target_days,
         public.native_org_today(new.org_id) + t.target_days   -- calendar days from the issue day; null target gives null
    from public.closeout_checklist_templates t
   where t.org_id = new.org_id;
  return new;
end; $$;

create or replace function public.lock_closeout_item(p_item uuid) returns public.work_order_closeout_items
  language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid      := public.auth_org_id();
  v_role   user_role := public.auth_role();
  v_wo     uuid;
  v_status public.work_order_status;
  v_pm     uuid;
  v_i      public.work_order_closeout_items;
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance','Project Manager') then
    raise exception 'only Finance, an Admin or the project''s manager can record close-out items' using errcode = '42501';
  end if;
  select i.work_order_id into v_wo from public.work_order_closeout_items i where i.id = p_item and i.org_id = v_org;
  if not found then raise exception 'close-out item not found' using errcode = 'P0002'; end if;
  -- Same row lock as transition_work_order and confirm_work_order_acceptance.
  select w.status into v_status from public.work_orders w where w.id = v_wo and w.org_id = v_org for update;
  if v_status is distinct from 'Issued' then
    raise exception 'close-out items change only while the work order is issued' using errcode = '55000', detail = 'work-order-not-issued';
  end if;
  if v_role = 'Project Manager' then
    select p.project_manager_id into v_pm from public.work_orders w join public.projects p on p.id = w.project_id where w.id = v_wo;
    if v_pm is distinct from auth.uid() then
      raise exception 'only the project''s manager can record close-out items' using errcode = '42501';
    end if;
  end if;
  select * into v_i from public.work_order_closeout_items i where i.id = p_item for update;
  if v_i.done_on is not null then
    raise exception 'this close-out item is already done' using errcode = '55000', detail = 'item-already-done';
  end if;
  return v_i;
end; $$;

alter table public.work_order_closeout_items drop column owner_job_role;
alter table public.closeout_checklist_templates drop column owner_job_role;
drop function public.actor_holds_job_role(text);
