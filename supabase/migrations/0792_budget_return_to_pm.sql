-- 0792_budget_return_to_pm.sql — #1413: an approver returns a waiting Draft budget version to the PM.
-- A Draft is "waiting for approval" while returned_at is null. Return stamps returned_at/by/reason
-- (the Draft stays editable, all lines kept); resubmit clears them. Reversal: rollback/0792_budget_return_to_pm_down.sql.

alter table public.budget_versions
  add column returned_at timestamptz,
  add column returned_by uuid references public.profiles(id) on delete set null,
  add column return_reason text;
alter table public.budget_versions
  add constraint budget_versions_return_state_ck
  check ((returned_at is null) = (return_reason is null) and (returned_at is null or length(btrim(return_reason)) > 0));

-- Clients hold UPDATE(status) only (0178), so the columns are written solely by the definers below.
-- A returned Draft is not waiting for approval, so it cannot be activated until resubmitted.
create or replace function public.assert_budget_returned_not_activated() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'Active' and old.status = 'Draft' and old.returned_at is not null then
    raise exception 'this version was returned to its drafter; it must be resubmitted before it can be activated'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.assert_budget_returned_not_activated() from public, anon, authenticated;
create trigger budget_versions_returned_no_activate
  before update of status on public.budget_versions
  for each row execute function public.assert_budget_returned_not_activated();

create or replace function public.return_budget_version(version_id uuid, reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_status budget_status; v_drafter uuid; v_returned timestamptz;
  v_reason text := btrim(coalesce(reason, ''));
begin
  select org_id,status,created_by,returned_at into v_org,v_status,v_drafter,v_returned
    from public.budget_versions where id=version_id for update;
  if not found then raise exception 'budget version not found' using errcode='P0002'; end if;
  if v_org is distinct from auth_org_id() or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member() then raise exception 'not authorized' using errcode='42501'; end if;
  -- Same separation of duties as activation, minus the sole-operator exception: a lone operator has
  -- nobody to return a draft to.
  if exists (select 1 from public.budget_version_editors e where e.budget_version_id=version_id and e.user_id=auth.uid()) then
    raise exception 'separation of duties: You edited this version, so someone else must return it.' using errcode='42501';
  end if;
  if v_drafter is not null and v_drafter=auth.uid() then
    raise exception 'separation of duties: the person who drafted a budget version cannot return it' using errcode='42501';
  end if;
  if v_drafter is null and auth_role() not in ('Admin','Finance') then
    raise exception 'a budget version with no recorded drafter can be returned by Admin or Finance only' using errcode='42501';
  end if;
  if v_status <> 'Draft' then raise exception 'only a Draft version can be returned' using errcode='P0001'; end if;
  if v_returned is not null then raise exception 'this version has already been returned' using errcode='P0001'; end if;
  if v_reason = '' or length(v_reason) > 1000 then
    raise exception 'a return reason of 1 to 1000 characters is required' using errcode='22023';
  end if;
  update public.budget_versions set returned_at=now(), returned_by=auth.uid(), return_reason=v_reason
   where id=version_id and status='Draft';
  perform public.log_audit('budget_version.return', v_org, auth.uid(), version_id,
                           jsonb_build_object('reason', v_reason));
end $$;
revoke all on function public.return_budget_version(uuid,text) from public, anon;
grant execute on function public.return_budget_version(uuid,text) to authenticated;

create or replace function public.resubmit_budget_version(version_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_status budget_status; v_returned timestamptz;
begin
  select org_id,status,returned_at into v_org,v_status,v_returned
    from public.budget_versions where id=version_id for update;
  if not found then raise exception 'budget version not found' using errcode='P0002'; end if;
  if v_org is distinct from auth_org_id() or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member() then raise exception 'not authorized' using errcode='42501'; end if;
  if v_status <> 'Draft' or v_returned is null then
    raise exception 'only a returned Draft version can be resubmitted' using errcode='P0001';
  end if;
  update public.budget_versions set returned_at=null, returned_by=null, return_reason=null
   where id=version_id and status='Draft';
  perform public.log_audit('budget_version.resubmit', v_org, auth.uid(), version_id, '{}'::jsonb);
end $$;
revoke all on function public.resubmit_budget_version(uuid) from public, anon;
grant execute on function public.resubmit_budget_version(uuid) to authenticated;

-- change-history catalogue: classify the new columns (record_changes_catalog_gate).
update public.record_history_config
   set captured = captured || '{"returned_at":"timestamp","return_reason":"text"}'::jsonb,
       omit_cols = omit_cols || '{returned_by}'::text[]
 where entity_type = 'budget_version' and not (captured ? 'returned_at');
