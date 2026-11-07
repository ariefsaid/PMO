-- 0730_budget_return_draft.sql — #1413: an approver returns a waiting Draft budget version to its
-- authors with a reason. Reversal: rollback/0730_budget_return_draft_down.sql.
--
-- A Draft is "waiting for approval" until it is returned. Return stamps returned_at/by + a required
-- reason; the version stays an editable Draft, approvers stop seeing it as waiting, and activation is
-- refused (trigger) until resubmit_budget_version clears the stamp. Same gate as activate_budget_version:
-- org, role, active member, and SoD (anyone who edited or drafted the version may not return it; no
-- sole-operator exception — a sole operator has nobody to return it to). Both RPCs are definers owned by
-- postgres, so the client-update guard on budget_versions does not bind them.
-- pgTAP: supabase/tests/budget_return_draft.test.sql.

alter table public.budget_versions
  add column returned_at timestamptz,
  add column returned_by uuid references public.profiles(id) on delete restrict,
  add column return_reason text check (return_reason is null or length(btrim(return_reason)) > 0);
alter table public.budget_versions
  add constraint budget_versions_returned_all_or_none
  check ((returned_at is null) = (returned_by is null) and (returned_at is null) = (return_reason is null));
revoke insert (returned_at, returned_by, return_reason), update (returned_at, returned_by, return_reason)
  on public.budget_versions from authenticated, anon;

create or replace function public.return_budget_version(version_id uuid, reason text)
  returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_status budget_status; v_drafter uuid; v_returned timestamptz;
begin
  select project_id, org_id, status, created_by, returned_at into v_project, v_org, v_status, v_drafter, v_returned
    from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member()
     or (select org_id from public.projects where id = v_project) is distinct from auth_org_id()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_drafter = auth.uid() or exists (select 1 from public.budget_version_editors e
       where e.budget_version_id = version_id and e.user_id = auth.uid()) then
    raise exception 'separation of duties: You edited this version, so someone else must return it.'
      using errcode = '42501';
  end if;
  if v_status <> 'Draft' then raise exception 'only a Draft version can be returned' using errcode = 'P0001'; end if;
  if v_returned is not null then raise exception 'this version has already been returned' using errcode = 'P0001'; end if;
  if reason is null or btrim(reason) = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  update budget_versions set returned_at = now(), returned_by = auth.uid(), return_reason = btrim(reason)
    where id = version_id;
end; $$;

create or replace function public.resubmit_budget_version(version_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_status budget_status; v_returned timestamptz;
begin
  select project_id, org_id, status, returned_at into v_project, v_org, v_status, v_returned
    from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member()
     or (select org_id from public.projects where id = v_project) is distinct from auth_org_id()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_status <> 'Draft' or v_returned is null then
    raise exception 'only a returned Draft version can be resubmitted' using errcode = 'P0001';
  end if;
  update budget_versions set returned_at = null, returned_by = null, return_reason = null where id = version_id;
end; $$;

revoke all on function public.return_budget_version(uuid, text) from public, anon;
grant execute on function public.return_budget_version(uuid, text) to authenticated;
revoke all on function public.resubmit_budget_version(uuid) from public, anon;
grant execute on function public.resubmit_budget_version(uuid) to authenticated;

-- Activation of a returned Draft is refused whatever the caller (definer RPCs included): resubmit first.
create or replace function public.assert_budget_version_not_returned() returns trigger
  language plpgsql set search_path = public as $$
begin
  if old.status = 'Draft' and new.status = 'Active' and old.returned_at is not null then
    raise exception 'this version was returned to its authors; it must be resubmitted before activation'
      using errcode = 'P0001';
  end if;
  return new;
end; $$;
revoke execute on function public.assert_budget_version_not_returned() from public, anon, authenticated;
create trigger budget_versions_not_returned
  before update on public.budget_versions
  for each row execute function public.assert_budget_version_not_returned();

-- change-history catalogue: classify the new columns (record_changes_catalog_gate).
update public.record_history_config
   set captured = captured || '{"returned_at":"timestamp","return_reason":"text"}'::jsonb,
       omit_cols = omit_cols || '{returned_by}'::text[]
 where entity_type = 'budget_version' and not (captured ? 'returned_at');
