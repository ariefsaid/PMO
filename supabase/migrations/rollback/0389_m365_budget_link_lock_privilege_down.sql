-- Restore the original invoker trigger body and default public EXECUTE grant.
create or replace function public.stamp_guard_budget_m365_link() returns trigger
language plpgsql set search_path=public as $$
declare
  v_parent uuid;
  v_parent_org uuid;
  v_parent_status public.budget_status;
begin
  if tg_op='UPDATE' and new.budget_version_id is distinct from old.budget_version_id then
    raise exception 'A budget reference cannot change its parent.' using errcode='23514';
  end if;
  if tg_op='DELETE' then v_parent:=old.budget_version_id; else v_parent:=new.budget_version_id; end if;
  if auth.uid() is not null and (not public.is_active_member()
     or public.auth_role() not in ('Admin','Executive','Project Manager','Finance')) then
    raise exception 'Cannot change evidence on this budget version.' using errcode='42501';
  end if;
  select v.org_id,v.status into v_parent_org,v_parent_status
    from public.budget_versions v where v.id=v_parent for update;
  if not found then
    if tg_op='DELETE' then return old; end if;
    raise exception 'Budget version is unavailable.' using errcode='23503';
  end if;
  if auth.uid() is not null then
    if v_parent_org is distinct from public.auth_org_id() then
      raise exception 'Cannot change evidence on this budget version.' using errcode='42501';
    end if;
    if v_parent_status is distinct from 'Draft'::public.budget_status then
      raise exception 'Cannot change evidence on this budget version.' using errcode='42501';
    end if;
    if tg_op='INSERT' then
      new.org_id:=public.auth_org_id();
      new.ms_linked_by:=auth.uid();
      new.ms_linked_at:=now();
    end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;
grant execute on function public.stamp_guard_budget_m365_link() to public;
