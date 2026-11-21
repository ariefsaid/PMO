-- 1180_third_party_inspection_rpcs.sql — #2580: the writers of the tracker. One RPC per step (FR-TPI-002); the table has no
-- client write grant (1130), and the state rules live in guard_tpi_transition, so these only gate WHO and stamp date + actor.
--   tpi_create · tpi_record_invitation · tpi_record_execution · tpi_record_report · tpi_waive · tpi_cancel
-- Each is audited through log_audit (FR-TPI-005) and by the record-history capture (1132). Proven by 1179_third_party_inspections.test.sql.
-- ── REVERSE (rollback/1180_third_party_inspection_rpcs_down.sql): drop the six functions and the helper.

-- loads the inspection of the caller's org FOR UPDATE; another org's id reads as absent (SECURITY: no existence oracle)
create function public.tpi_load_for_update(p_id uuid) returns public.third_party_inspections
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.third_party_inspections;
begin
  perform public.assert_is_active_member();
  select * into v from public.third_party_inspections i where i.id = p_id and i.org_id = public.auth_org_id() for update;
  if not found then raise exception 'inspection not found' using errcode = 'P0002'; end if;
  return v;
end $$;
revoke all on function public.tpi_load_for_update(uuid) from public, anon, authenticated;

create function public.tpi_create(p_work_order_id uuid, p_title text, p_test_kind text, p_planned_date date, p_vendor_id uuid,
    p_estimate numeric, p_estimate_currency text, p_note text, p_required_for text[], p_section_id uuid default null)
  returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_wo public.work_orders; v_id uuid := gen_random_uuid(); v_gates text[];
begin
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if public.auth_role() not in ('Admin','Project Manager','Finance','Engineer') then
    raise exception 'you cannot create an inspection' using errcode = '42501';
  end if;
  if p_section_id is not null then
    raise exception 'TPI_SECTION_UNAVAILABLE: work-order sections are not available yet' using errcode = '23514';
  end if;
  select * into v_wo from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org;
  if not found or v_wo.status = 'Cancelled' then
    raise exception 'TPI_WO_SCOPE: the work order is not available for an inspection' using errcode = '23514';
  end if;
  if p_vendor_id is not null and not exists (select 1 from public.companies c where c.id = p_vendor_id and c.org_id = v_org) then
    raise exception 'TPI_VENDOR_SCOPE: the vendor is not available' using errcode = '23514';
  end if;
  if p_planned_date is null then raise exception 'TPI_PLANNED_DATE: a planned date is required' using errcode = '23514'; end if;
  if (p_estimate is null) is distinct from (p_estimate_currency is null) then
    raise exception 'TPI_ESTIMATE: an estimate needs its currency' using errcode = '23514';
  end if;
  select coalesce(array_agg(distinct g order by g), '{}') into v_gates from unnest(coalesce(p_required_for, '{}')) g;
  insert into public.third_party_inspections
    (id, org_id, work_order_id, project_id, title, test_kind, planned_date, vendor_id, estimate, estimate_currency, note, required_for, created_by)
  values (v_id, v_org, v_wo.id, v_wo.project_id, btrim(p_title), nullif(btrim(p_test_kind), ''), p_planned_date, p_vendor_id,
          p_estimate, upper(p_estimate_currency), nullif(btrim(p_note), ''), v_gates, v_uid);
  perform public.log_audit('third_party_inspection.create', v_org, v_uid, v_id, jsonb_build_object('work_order_id', v_wo.id));
  return v_id;
end $$;

create function public.tpi_record_invitation(p_id uuid, p_invited_on date, p_invited_who text, p_invited_how text)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.third_party_inspections; v_uid uuid := auth.uid();
begin
  v := public.tpi_load_for_update(p_id);
  if public.auth_role() not in ('Admin','Project Manager','Finance','Engineer') then
    raise exception 'you cannot advance an inspection' using errcode = '42501';
  end if;
  update public.third_party_inspections set status = 'invited', invited_on = p_invited_on, invited_who = nullif(btrim(p_invited_who), ''),
         invited_how = nullif(btrim(p_invited_how), ''), invited_by = v_uid, updated_at = now() where id = p_id;
  perform public.log_audit('third_party_inspection.invite', v.org_id, v_uid, p_id, '{}'::jsonb);
end $$;

create function public.tpi_record_execution(p_id uuid, p_executed_on date)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.third_party_inspections; v_uid uuid := auth.uid();
begin
  v := public.tpi_load_for_update(p_id);
  if public.auth_role() not in ('Admin','Project Manager','Finance','Engineer') then
    raise exception 'you cannot advance an inspection' using errcode = '42501';
  end if;
  update public.third_party_inspections set status = 'executed', executed_on = p_executed_on, executed_by = v_uid, updated_at = now()
   where id = p_id;
  perform public.log_audit('third_party_inspection.execute', v.org_id, v_uid, p_id, '{}'::jsonb);
end $$;

create function public.tpi_record_report(p_id uuid, p_result text)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.third_party_inspections; v_uid uuid := auth.uid();
begin
  v := public.tpi_load_for_update(p_id);
  if public.auth_role() not in ('Admin','Project Manager','Finance','Engineer') then
    raise exception 'you cannot advance an inspection' using errcode = '42501';
  end if;
  update public.third_party_inspections set status = 'reported', result = coalesce(p_result, 'pending'),
         reported_at = now(), reported_by = v_uid, updated_at = now() where id = p_id;
  perform public.log_audit('third_party_inspection.report', v.org_id, v_uid, p_id, jsonb_build_object('result', p_result));
end $$;

create function public.tpi_waive(p_id uuid, p_reason text)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.third_party_inspections; v_uid uuid := auth.uid();
begin
  v := public.tpi_load_for_update(p_id);
  if public.auth_role() not in ('Admin','Project Manager','Finance') then
    raise exception 'you cannot waive an inspection' using errcode = '42501';
  end if;
  update public.third_party_inspections set waived_at = now(), waived_by = v_uid, waiver_reason = nullif(btrim(p_reason), ''), updated_at = now()
   where id = p_id;
  perform public.log_audit('third_party_inspection.waive', v.org_id, v_uid, p_id, jsonb_build_object('reason', btrim(p_reason)));
end $$;

-- cancel: tracked-only inspections (the trigger refuses a required one). The creator while `requested`; a manager role any time.
create function public.tpi_cancel(p_id uuid, p_reason text)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.third_party_inspections; v_uid uuid := auth.uid(); v_role public.user_role := public.auth_role();
begin
  v := public.tpi_load_for_update(p_id);
  if not (v_role in ('Admin','Project Manager','Finance')
          or (v.created_by = v_uid and v.status = 'requested' and v_role = 'Engineer')) then
    raise exception 'you cannot cancel this inspection' using errcode = '42501';
  end if;
  update public.third_party_inspections set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
         cancel_reason = nullif(btrim(p_reason), ''), updated_at = now() where id = p_id;
  perform public.log_audit('third_party_inspection.cancel', v.org_id, v_uid, p_id, jsonb_build_object('reason', btrim(p_reason)));
end $$;

revoke all on function public.tpi_create(uuid,text,text,date,uuid,numeric,text,text,text[],uuid) from public, anon;
revoke all on function public.tpi_record_invitation(uuid,date,text,text) from public, anon;
revoke all on function public.tpi_record_execution(uuid,date) from public, anon;
revoke all on function public.tpi_record_report(uuid,text) from public, anon;
revoke all on function public.tpi_waive(uuid,text) from public, anon;
revoke all on function public.tpi_cancel(uuid,text) from public, anon;
grant execute on function public.tpi_create(uuid,text,text,date,uuid,numeric,text,text,text[],uuid) to authenticated;
grant execute on function public.tpi_record_invitation(uuid,date,text,text) to authenticated;
grant execute on function public.tpi_record_execution(uuid,date) to authenticated;
grant execute on function public.tpi_record_report(uuid,text) to authenticated;
grant execute on function public.tpi_waive(uuid,text) to authenticated;
grant execute on function public.tpi_cancel(uuid,text) to authenticated;
