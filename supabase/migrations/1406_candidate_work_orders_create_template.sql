-- 1406_candidate_work_orders_create_template.sql — #2595: create a candidate (copying the organisation's checklist) and
-- save the organisation's checklist template. Spec FR-CWO-001, 002, 004 (insert policy in 1405), 007, 008.
-- Rollback: supabase/migrations/rollback/1406_candidate_work_orders_create_template_down.sql.

-- Admin saves the WHOLE ordered list in one call. Items named by id are renamed / re-ordered / re-flagged (and restored if
-- archived); items not named are archived (they stay on candidates that already copied them, FR-CWO-007); new entries
-- without an id are added. No item text is supplied by the system: an empty list is valid (OD-SCOPE-2).
-- p_items: [{id?, label, required?}] in the order to show. Returns the number of live items.
create function public.set_work_order_candidate_template(p_items jsonb) returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_el jsonb; v_pos integer := 0; v_id uuid; v_label text; v_req boolean;
  v_keep uuid[] := '{}';
begin
  if v_org is null or auth.uid() is null or not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'only an administrator can edit the assessment checklist' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'CWO_TEMPLATE: the checklist is a list of at most 50 items' using errcode = '22023';
  end if;
  -- validate the whole list before writing anything
  for v_el in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_el) <> 'object' or jsonb_typeof(v_el -> 'label') is distinct from 'string'
       or char_length(btrim(v_el ->> 'label')) not between 1 and 200
       or (v_el ? 'required' and jsonb_typeof(v_el -> 'required') <> 'boolean')
       or (v_el ? 'id' and v_el -> 'id' <> 'null'::jsonb and (jsonb_typeof(v_el -> 'id') <> 'string'
            or (v_el ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
      raise exception 'CWO_TEMPLATE: every item needs a label of 1 to 200 characters' using errcode = '22023';
    end if;
    if v_el ? 'id' and v_el -> 'id' <> 'null'::jsonb then
      v_id := (v_el ->> 'id')::uuid;
      if v_id = any (v_keep) or not exists (select 1 from public.work_order_checklist_items t where t.id = v_id and t.org_id = v_org) then
        raise exception 'CWO_TEMPLATE: an item is repeated or not on this organisation''s checklist' using errcode = '22023';
      end if;
      v_keep := v_keep || v_id;
    end if;
  end loop;
  v_keep := '{}';
  for v_el in select * from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    v_label := btrim(v_el ->> 'label');
    v_req := coalesce((v_el ->> 'required')::boolean, true);
    if v_el ? 'id' and v_el -> 'id' <> 'null'::jsonb then
      v_id := (v_el ->> 'id')::uuid;
      update public.work_order_checklist_items set label = v_label, position = v_pos, required = v_req, archived_at = null
       where id = v_id and org_id = v_org;
    else
      insert into public.work_order_checklist_items (org_id, label, position, required) values (v_org, v_label, v_pos, v_req) returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  update public.work_order_checklist_items set archived_at = now()
   where org_id = v_org and archived_at is null and id <> all (v_keep);
  return v_pos;
end $$;
revoke all on function public.set_work_order_candidate_template(jsonb) from public, anon;
grant execute on function public.set_work_order_candidate_template(jsonb) to authenticated;

-- Create a candidate under a project and copy the organisation's live checklist onto it, in one transaction.
-- Callers: Admin, Engineer, or the project's Project Manager. p_replaces_id names an earlier REJECTED candidate of the
-- same project (FR-CWO-015). offered_on defaults to today in the organisation's timezone (NFR-CWO-002).
create function public.create_work_order_candidate(
  p_project_id uuid, p_title text, p_description text default null, p_client_reference text default null,
  p_offered_on date default null, p_replaces_id uuid default null) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_pm uuid; v_id uuid; v_today date; v_prior public.work_order_candidates;
begin
  if v_org is null or v_uid is null or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select p.project_manager_id into v_pm from public.projects p where p.id = p_project_id and p.org_id = v_org;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not (public.auth_role() in ('Admin', 'Engineer') or v_pm = v_uid) then
    raise exception 'only an administrator, an engineer or the project''s project manager can open a candidate' using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 then
    raise exception 'CWO_TITLE: a candidate needs a title of 1 to 200 characters' using errcode = '23514';
  end if;
  if p_replaces_id is not null then
    select * into v_prior from public.work_order_candidates c where c.id = p_replaces_id and c.org_id = v_org;
    if not found or v_prior.project_id <> p_project_id or v_prior.status <> 'rejected' then
      raise exception 'CWO_REPLACES: a candidate can replace only a rejected candidate of the same project' using errcode = '23514';
    end if;
  end if;
  select (now() at time zone coalesce(o.default_timezone, 'UTC'))::date into v_today from public.organizations o where o.id = v_org;
  insert into public.work_order_candidates (org_id, project_id, title, description, client_reference, offered_on, replaces_id, created_by)
    values (v_org, p_project_id, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
            nullif(btrim(coalesce(p_client_reference, '')), ''), coalesce(p_offered_on, v_today), p_replaces_id, v_uid)
    returning id into v_id;
  insert into public.work_order_candidate_items (org_id, candidate_id, template_item_id, label, position, required)
    select v_org, v_id, t.id, t.label, t.position, t.required
      from public.work_order_checklist_items t where t.org_id = v_org and t.archived_at is null order by t.position, t.created_at;
  return v_id;
end $$;
revoke all on function public.create_work_order_candidate(uuid, text, text, text, date, uuid) from public, anon;
grant execute on function public.create_work_order_candidate(uuid, text, text, text, date, uuid) to authenticated;
