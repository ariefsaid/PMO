-- 0460_equipment_costing_down.sql — reverse of 0460 (#1519 S2), reverse dependency order.
drop function if exists public.list_equipment_usage_totals(uuid, uuid, date, date);
drop function if exists public.list_equipment_allocations(uuid, date, date, uuid);
drop function if exists public.preview_equipment_costing(jsonb);
drop function if exists public.list_equipment_costing(boolean);
drop function if exists public.end_equipment_costing(uuid, date, int);
drop function if exists public.save_equipment_costing(jsonb);
drop function if exists public.equipment_costing_write(jsonb, text, boolean);
-- restore S1's transition core (no unit re-check) and its stub unit lock
create or replace function public.equipment_usage_transition_core(p_id uuid, p_to text, p_notes text) returns text
language plpgsql set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_role public.user_role := public.auth_role(); v_e public.equipment_usage_entries;
  v_legal jsonb := jsonb_build_object('Draft', jsonb_build_array('Submitted'), 'Submitted', jsonb_build_array('Approved','Rejected'),
                                      'Rejected', jsonb_build_array('Draft'), 'Approved', jsonb_build_array('Draft'));
  v_action text;
begin
  select * into v_e from public.equipment_usage_entries e where e.id = p_id for update;
  if not found then raise exception 'entry not found' using errcode = 'P0002'; end if;
  -- SECURITY: definer bypasses RLS; this org re-assertion MUST stay.
  if v_e.org_id is distinct from public.auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_e.archived_at is not null then raise exception 'an archived entry cannot move' using errcode = '22023'; end if;
  if p_to is null or not coalesce((v_legal -> v_e.status) ? p_to, false) then
    raise exception 'illegal transition % -> %', v_e.status, p_to using errcode = '22023';
  end if;
  if p_to = 'Submitted' or (v_e.status = 'Rejected' and p_to = 'Draft') then
    if v_uid is distinct from v_e.author_id then raise exception 'not authorized' using errcode = '42501'; end if;
    v_action := case when p_to = 'Submitted' then 'submitted' else 'redraft' end;
  elsif p_to in ('Approved','Rejected') then
    -- SoD FIRST, ALWAYS (FR-EQU-011, the 0180 transition_timesheet order). Do not reorder.
    if v_uid is not distinct from v_e.author_id then raise exception 'separation of duties: cannot decide own equipment usage' using errcode = '42501'; end if;
    if not public.equipment_can_approve(v_uid, v_role, v_e.org_id, v_e.project_id) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    v_action := lower(p_to);
  else  -- Approved -> Draft: Admin reopen (FR-EQU-012), never by the author
    if v_uid is not distinct from v_e.author_id then raise exception 'separation of duties: cannot reopen own equipment usage' using errcode = '42501'; end if;
    if v_role is distinct from 'Admin' then raise exception 'only an Admin reopens approved usage' using errcode = '42501'; end if;
    v_action := 'reopen';
  end if;
  update public.equipment_usage_entries
     set status = p_to,
         approver_id = case when p_to in ('Approved','Rejected') then v_uid when p_to = 'Draft' then null else approver_id end,
         approved_at = case when p_to = 'Approved' then now() else null end,
         decision_notes = case when p_to in ('Approved','Rejected') or v_action = 'reopen' then nullif(btrim(coalesce(p_notes,'')), '')
                               else decision_notes end,
         updated_at = now()
   where id = p_id;
  perform public.log_audit('equipment_usage.' || v_action, v_e.org_id, v_uid, p_id,
    jsonb_build_object('from', v_e.status, 'to', p_to, 'notes', p_notes));
  return p_to;
end $$;
-- restore S1's stub body before the helper it reads goes away
create or replace function public.equipment_entry_locked_unit(p_org uuid, p_asset uuid, p_date date) returns text
  language sql stable set search_path = public, pg_temp as $$ select null::text $$;
drop function if exists public.equipment_hire_charges(uuid, jsonb, uuid);
drop function if exists public.equipment_usage_by_project(uuid);
drop function if exists public.equipment_costing_assert_no_conflict(uuid, jsonb);
drop function if exists public.equipment_settings_effective(uuid, jsonb);
drop function if exists public.cost_attribution_matches_overlap(uuid, text, text, text, text, text, text, text, text, text, text);
drop function if exists public.equipment_costing_normalize(uuid, jsonb, boolean);
drop function if exists public.equipment_costing_content(uuid);
drop table if exists public.equipment_costing_settings;
