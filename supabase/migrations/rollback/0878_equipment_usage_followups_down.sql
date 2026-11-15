-- 0878_equipment_usage_followups_down.sql — reverse of 0878 (#1649). The redefined functions return to their prior
-- bodies (0855 transition core, 0447 save and delete-audit fn).
drop trigger if exists equipment_assets_audit_change on public.equipment_assets;
drop function if exists public.audit_equipment_asset_change();
create or replace function public.audit_equipment_usage_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('equipment_usage.delete', old.org_id, auth.uid(), old.id, jsonb_build_object('before', to_jsonb(old)));
  return old;
end $$;

create or replace function public.equipment_usage_transition_core(p_id uuid, p_to text, p_notes text) returns text
language plpgsql set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_role public.user_role := public.auth_role(); v_e public.equipment_usage_entries;
  v_legal jsonb := jsonb_build_object('Draft', jsonb_build_array('Submitted'), 'Submitted', jsonb_build_array('Approved','Rejected'),
                                      'Rejected', jsonb_build_array('Draft'), 'Approved', jsonb_build_array('Draft'));
  v_action text; v_locked text; v_claim uuid;
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
  if v_e.status = 'Approved' and p_to = 'Draft' and public.tm_source_is_live('equipment_usage', p_id) then
    select s.claim_id into v_claim from public.tm_claim_sources s where s.source_kind = 'equipment_usage' and s.source_id = p_id and s.is_live limit 1;
    raise exception 'equipment usage belongs to live claim %', v_claim using errcode = '55000';
  end if;
  -- FR-EQU-032: a costing setting saved after the entry was logged (a day entry Rejected before an hours rate existed,
  -- or a race with the setting save) must not let the entry reach a charge in another unit. The author's resubmit and the
  -- approver's decision both re-check; bulk week approval runs this core, so it stops at such an entry with this message.
  if p_to in ('Submitted','Approved') then
    v_locked := public.equipment_entry_locked_unit(v_e.org_id, v_e.asset_id, v_e.work_date);
    if v_locked is not null and v_locked <> v_e.unit then
      raise exception 'this asset is costed per % on that date; this entry is in %', v_locked, v_e.unit using errcode = '22023';
    end if;
  end if;
  update public.equipment_usage_entries
     set status = p_to,
         approver_id = case when p_to in ('Approved','Rejected') then v_uid when p_to = 'Draft' then null else approver_id end,
         approved_at = case when p_to = 'Approved' then now() else null end,
         decision_notes = case when p_to = 'Submitted' and v_e.status = 'Draft' and (v_e.rejected_at is not null or v_e.rejected_by is not null) then null when p_to in ('Approved','Rejected') or v_action = 'reopen' then nullif(btrim(coalesce(p_notes,'')), '')
                               else decision_notes end,
         rejected_by = case when p_to = 'Rejected' then v_uid when p_to = 'Submitted' and v_e.status = 'Draft' then null else rejected_by end,
         rejected_at = case when p_to = 'Rejected' then now() when p_to = 'Submitted' and v_e.status = 'Draft' then null else rejected_at end,
         updated_at = now()
   where id = p_id;
  perform public.log_audit('equipment_usage.' || v_action, v_e.org_id, v_uid, p_id,
    jsonb_build_object('from', v_e.status, 'to', p_to, 'notes', p_notes));
  return p_to;
end $$;

create or replace function public.save_equipment_usage(p_entry jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_id uuid; v_asset uuid; v_project uuid; v_date date; v_qty numeric; v_fuel numeric; v_trips int;
  v_unit text; v_kind text; v_note text; v_cur public.equipment_usage_entries; v_after public.equipment_usage_entries;
  v_locked text; v_day numeric;
begin
  perform public.assert_is_active_member();
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    raise exception 'entry must be a JSON object' using errcode = '22023';
  end if;
  begin
    v_id := nullif(p_entry->>'id','')::uuid;            v_asset := (p_entry->>'asset_id')::uuid;
    v_project := (p_entry->>'project_id')::uuid;        v_date := (p_entry->>'work_date')::date;
    v_qty := (p_entry->>'quantity')::numeric;           v_fuel := nullif(p_entry->>'fuel_litres','')::numeric;
    v_trips := nullif(p_entry->>'trips','')::int;
  exception when others then
    raise exception 'asset_id, project_id, work_date, quantity, fuel_litres or trips is malformed' using errcode = '22023';
  end;
  v_unit := p_entry->>'unit'; v_kind := coalesce(nullif(p_entry->>'kind',''), 'work');
  v_note := nullif(btrim(coalesce(p_entry->>'note','')), '');
  if v_unit is null or v_unit not in ('hours','days') then raise exception 'unit must be hours or days' using errcode = '22023'; end if;
  if v_kind not in ('work','standby') then raise exception 'kind must be work or standby' using errcode = '22023'; end if;
  if v_qty is null or v_qty::text in ('NaN','Infinity','-Infinity') or v_qty < 0 or round(v_qty, 2) <> v_qty then
    raise exception 'quantity must be zero or more, with at most 2 decimals' using errcode = '22023';
  end if;
  if (v_unit = 'hours' and v_qty > 24) or (v_unit = 'days' and v_qty > 1) then
    raise exception 'one entry holds at most 24 hours or 1 day' using errcode = '22023';
  end if;
  if v_fuel is not null and (v_fuel::text in ('NaN','Infinity','-Infinity') or v_fuel < 0 or round(v_fuel, 2) <> v_fuel) then
    raise exception 'fuel litres must be zero or more' using errcode = '22023';
  end if;
  if v_trips is not null and v_trips < 0 then raise exception 'trips must be zero or more' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'the note is at most 500 characters' using errcode = '22023'; end if;
  if v_date is null or v_date > public.equipment_org_today(v_org) then
    raise exception 'the work date is in the future' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = v_project and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';   -- SECURITY: the org re-assertion MUST stay
  end if;
  if not exists (select 1 from public.equipment_assets a where a.id = v_asset and a.org_id = v_org and a.archived_at is null) then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;
  v_locked := public.equipment_entry_locked_unit(v_org, v_asset, v_date);
  if v_locked is not null and v_locked <> v_unit then
    raise exception 'this asset is costed per % on that date; log it in %', v_locked, v_locked using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind,
                                                fuel_litres, trips, note, status, author_id)
    values (v_org, v_asset, v_project, v_date, v_qty, v_unit, v_kind, v_fuel, v_trips, v_note, 'Draft', v_uid)
    returning * into v_after;                                   -- 23505 from equipment_usage_one_per_day
    perform public.log_audit('equipment_usage.create', v_org, v_uid, v_after.id, jsonb_build_object('to', 'Draft', 'after', to_jsonb(v_after)));
  else
    select * into v_cur from public.equipment_usage_entries e where e.id = v_id for update;
    if not found or v_cur.org_id is distinct from v_org then raise exception 'entry not found' using errcode = 'P0002'; end if;
    if v_cur.author_id is distinct from v_uid then raise exception 'only the author edits an entry' using errcode = '42501'; end if;  -- null-safe
    if v_cur.status not in ('Draft','Rejected') or v_cur.archived_at is not null then
      raise exception 'only a draft or rejected entry can be edited' using errcode = '22023';
    end if;
    update public.equipment_usage_entries set asset_id = v_asset, project_id = v_project, work_date = v_date, quantity = v_qty,
           unit = v_unit, kind = v_kind, fuel_litres = v_fuel, trips = v_trips, note = v_note, updated_at = now()
     where id = v_id returning * into v_after;
    perform public.log_audit('equipment_usage.update', v_org, v_uid, v_id, jsonb_build_object('before', to_jsonb(v_cur), 'after', to_jsonb(v_after)));
  end if;
  -- OQ-7 / PQ-12: warn, never block, when the asset's day exceeds 24 h across projects
  select coalesce(sum(case when e.unit = 'hours' then e.quantity else e.quantity * 24 end), 0) into v_day
    from public.equipment_usage_entries e
   where e.org_id = v_org and e.asset_id = v_asset and e.work_date = v_date and e.archived_at is null and e.status <> 'Rejected';
  return jsonb_build_object('id', v_after.id, 'status', v_after.status, 'day_total_hours', v_day, 'over_24h', v_day > 24);
end $$;
