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
