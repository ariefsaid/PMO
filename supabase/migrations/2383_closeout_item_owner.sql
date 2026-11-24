-- drops: lock_closeout_item resolves the owner role from the locked item before authorizing the action; its role, project, issued-state and completion checks are retained.
create or replace function public.lock_closeout_item(p_item uuid) returns public.work_order_closeout_items
  language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid      := public.auth_org_id();
  v_role   user_role := public.auth_role();
  v_wo     uuid;
  v_status public.work_order_status;
  v_pm     uuid;
  v_i      public.work_order_closeout_items;
  v_owner  text;
  v_owns   boolean;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select i.work_order_id into v_wo from public.work_order_closeout_items i where i.id = p_item and i.org_id = v_org;
  if v_wo is null then raise exception 'close-out item not found' using errcode = 'P0002'; end if;
  -- Same row lock as transition_work_order and confirm_work_order_acceptance.
  select w.status into v_status from public.work_orders w where w.id = v_wo and w.org_id = v_org for update;
  if v_status is distinct from 'Issued' then
    raise exception 'close-out items change only while the work order is issued' using errcode = '55000', detail = 'work-order-not-issued';
  end if;
  select * into v_i from public.work_order_closeout_items i where i.id = p_item for update;
  v_owner := v_i.owner_job_role;
  v_owns := v_owner is not null and coalesce(public.actor_holds_job_role(v_owner), false);  -- mut:rr_closeout_owner
  if not v_owns and (v_role is null or v_role not in ('Admin','Finance','Project Manager')) then
    raise exception 'only Finance, an Admin or the project''s manager can record close-out items' using errcode = '42501';
  end if;
  if v_role = 'Project Manager' and not v_owns then
    select p.project_manager_id into v_pm from public.work_orders w join public.projects p on p.id = w.project_id where w.id = v_wo;
    if v_pm is distinct from auth.uid() then
      raise exception 'only the project''s manager can record close-out items' using errcode = '42501';
    end if;
  end if;
  if v_i.done_on is not null then
    raise exception 'this close-out item is already done' using errcode = '55000', detail = 'item-already-done';
  end if;
  return v_i;
end; $$;

-- An Admin names the responsible job role on an open item of an issued checklist.
create function public.assign_closeout_item_owner(p_item uuid,p_role text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.work_order_closeout_items;
begin
 perform public.assert_not_light(); perform public.assert_is_active_member();
 if public.auth_role() is distinct from 'Admin' then raise exception 'only an Admin assigns a checklist owner' using errcode='42501'; end if; -- mut:closeout_owner_admin
 i:=public.lock_closeout_item(p_item);
 p_role:=nullif(btrim(p_role),'');
 if p_role is not null and not exists(select 1 from public.built_in_roles where key=p_role) then raise exception 'choose a job role' using errcode='23514'; end if;
 update public.work_order_closeout_items set owner_job_role=p_role where id=i.id;
 perform public.log_audit('closeout_item.owner.assign',i.org_id,auth.uid(),i.work_order_id,jsonb_build_object('item_id',i.id,'owner_job_role',p_role));
end $$;
revoke all on function public.assign_closeout_item_owner(uuid,text) from public,anon;
grant execute on function public.assign_closeout_item_owner(uuid,text) to authenticated,service_role;
