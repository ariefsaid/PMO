-- 0280_budget_version_editors.sql — DD-BUDGET-7: every version editor is excluded from activation.
-- Reversal: rollback/0280_budget_version_editors_down.sql.

create table public.budget_version_editors (
  org_id uuid not null references public.organizations(id) on delete cascade,
  budget_version_id uuid not null references public.budget_versions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  first_edited_at timestamptz not null default now(),
  primary key (budget_version_id, user_id)
);
create index budget_version_editors_org_user_idx on public.budget_version_editors (org_id, user_id);

alter table public.budget_version_editors enable row level security;
alter table public.budget_version_editors force row level security;
create policy budget_version_editors_select on public.budget_version_editors
  for select using (
    org_id = public.auth_org_id() and public.is_active_member()
    and exists (select 1 from public.budget_versions bv
      where bv.id = budget_version_editors.budget_version_id and bv.org_id = public.auth_org_id())
  );
revoke all on public.budget_version_editors from public, anon, authenticated;
grant select on public.budget_version_editors to authenticated;

-- Internal writers run as the table owner, but only stamp the current JWT actor; a service-role
-- seed/job has no auth.uid() and therefore does not invent a human editor.
create or replace function public.capture_budget_version_insert_editor() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.created_by is not null then
    insert into public.budget_version_editors (org_id, budget_version_id, user_id)
    values (new.org_id, new.id, new.created_by)
    on conflict (budget_version_id, user_id) do nothing;
  end if;
  return new;
end; $$;
revoke execute on function public.capture_budget_version_insert_editor() from public, anon, authenticated;
create trigger budget_versions_capture_editor
  after insert on public.budget_versions
  for each row execute function public.capture_budget_version_insert_editor();

create or replace function public.capture_budget_line_item_editor() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_version_id uuid; v_org_id uuid;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then
    v_version_id := old.budget_version_id;
    v_org_id := old.org_id;
    -- Cascaded line deletion during hard deletion of the Draft must not recreate an editor row
    -- for a parent already being removed.
    if not exists (select 1 from public.budget_versions where id = v_version_id) then return old; end if;
  else
    v_version_id := new.budget_version_id;
    v_org_id := new.org_id;
  end if;
  insert into public.budget_version_editors (org_id, budget_version_id, user_id)
  values (v_org_id, v_version_id, auth.uid())
  on conflict (budget_version_id, user_id) do nothing;
  -- A move (if a future schema permits one) edits both versions.
  if tg_op = 'UPDATE' and old.budget_version_id is distinct from new.budget_version_id then
    insert into public.budget_version_editors (org_id, budget_version_id, user_id)
    values (old.org_id, old.budget_version_id, auth.uid())
    on conflict (budget_version_id, user_id) do nothing;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end; $$;
revoke execute on function public.capture_budget_line_item_editor() from public, anon, authenticated;
create trigger budget_line_items_capture_editor
  after insert or update or delete on public.budget_line_items
  for each row execute function public.capture_budget_line_item_editor();

-- Existing authors are part of the editor set. Deliberately no line-item backfill: prior edits are
-- not attributable and cannot safely be reconstructed.
insert into public.budget_version_editors (org_id, budget_version_id, user_id)
select org_id, id, created_by from public.budget_versions where created_by is not null
on conflict (budget_version_id, user_id) do nothing;

-- 0271 body retained verbatim apart from the editor-set refusal, placed BEFORE the drafter refusal:
-- the drafter is themselves in the editor set (creation is recorded), so they read the editor message.
create or replace function public.activate_budget_version(version_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_status budget_status; v_drafter uuid;
begin
  select project_id, org_id, status, created_by into v_project, v_org, v_status, v_drafter
    from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if (select org_id from public.projects where id = v_project) is distinct from auth_org_id()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if exists (select 1 from public.budget_version_editors e
             where e.budget_version_id = version_id and e.user_id = auth.uid()) then
    raise exception 'separation of duties: You edited this version, so someone else must activate it.'
      using errcode = '42501';
  end if;
  if v_drafter is not null and v_drafter = auth.uid() then
    raise exception 'separation of duties: the person who drafted a budget version cannot activate it'
      using errcode = '42501';
  end if;
  if v_drafter is null and auth_role() not in ('Admin','Finance') then
    raise exception 'a budget version with no recorded drafter can be activated by Admin or Finance only'
      using errcode = '42501';
  end if;
  if v_status <> 'Draft' then raise exception 'only a Draft version can be activated' using errcode = 'P0001'; end if;
  update budget_versions set status = 'Archived'
    where project_id = v_project and status = 'Active';
  update budget_versions set status = 'Active', activated_at = now() where id = version_id;
end; $$;
