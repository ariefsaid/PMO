-- 2043_report_validation_checkpoints_expiry.sql — three reading and deciding rules.
-- (1) Validating a daily site report reads the daily_report_validate capability: a job role the catalogue gives it validates, returns
--     and corrects reports, besides today's Admin, Finance and the project's own manager. No job role holds it by default (who should
--     is a setting still to be answered), so nobody validates who could not before. The author never validates their own report
--     (dsr_validate, unchanged).
-- (2) The Project Control Manager job role reads crews' checkpoint days and the missed-checkpoint view on every work order.
-- (3) A medical document type's expiry warning also reaches the person's direct manager, as a plain notice (person, document type,
--     expiry date) with no link to the document; reading the document stays behind the medical right (expiry_documents RLS, 1535).
-- Restated from the live definitions: dsr_may_validate (1041), site_checkpoint_may_read (1385), run_document_expiry_warnings (1931).
-- drops: the two seeded holders of daily_report_validate (no reader before; the gate keeps today's default holders), and the medical
-- recipient line of run_document_expiry_warnings (now the direct manager too) and its single notice call (now plain for that manager).
-- Proven by supabase/tests/2043_report_validation_checkpoints_expiry.test.sql, document_expiry.test.sql and
-- document_expiry_manager.test.sql. Rollback: rollback/2043_report_validation_checkpoints_expiry_down.sql

-- ── §1 report validation ─────────────────────────────────────────────────────────────────────────────────────────────────────────
delete from public.built_in_role_capabilities where capability = 'daily_report_validate';

CREATE OR REPLACE FUNCTION public.dsr_may_validate(p_project uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(public.is_active_member() and exists (
    select 1 from public.projects p
     where p.id = p_project and p.org_id = public.auth_org_id()
       and (public.auth_role() in ('Admin','Finance')
            or (public.auth_role() = 'Project Manager' and p.project_manager_id = auth.uid())
            or public.actor_has_role_capability('daily_report_validate'))), false)                       -- mut:rr_dsr_capability
$function$
;


-- ── §2 checkpoint days for the Project Control Manager ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.site_checkpoint_may_read(p_work_order uuid, p_crew uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(public.is_active_member() and exists (
    select 1 from public.work_orders w join public.projects p on p.id = w.project_id
     where w.id = p_work_order and w.org_id = public.auth_org_id()
       and (public.auth_role() in ('Admin', 'Executive', 'Engineer')
            or (public.auth_role() = 'Project Manager' and p.project_manager_id = auth.uid())
            or public.actor_holds_job_role('project_control_manager')                                       -- mut:rr_pcm_checkpoint
            or exists (select 1 from public.crews c
                        where c.id = p_crew and c.org_id = w.org_id and c.field_controller_id = auth.uid()))), false)
$function$
;


-- ── §3 medical expiry: the direct manager gets a plain notice ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.run_document_expiry_warnings(p_today date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d record; r record; v_sent integer := 0; v_thr integer; v_left integer; v_today date;
  v_subject text; v_inserted integer; v_plain boolean;
begin
  for d in
    select x.*, t.name as type_name, t.notify_roles, t.notify_person, t.is_medical as t_medical, o.document_warning_days as days,
           o.default_timezone as tz, pe.name as person_name, pe.manager_id, pe.profile_id as person_profile_id, a.name as asset_name
      from public.expiry_documents x
      join public.document_types t on t.id = x.type_id
      join public.organizations o on o.id = x.org_id
      left join public.people pe on pe.id = x.person_id
      left join public.equipment_assets a on a.id = x.asset_id
     where x.archived_at is null and (pe.id is null or pe.archived_at is null) and (a.id is null or a.archived_at is null)
  loop
    v_today := coalesce(p_today, (now() at time zone coalesce(d.tz, 'UTC'))::date);
    v_left := d.expires_on - v_today;
    continue when v_left < 0;
    select min(z) into v_thr from unnest(d.days) z where z >= v_left;
    continue when v_thr is null;
    v_subject := coalesce(d.person_name, d.asset_name);
    for r in
      select distinct p.id from public.profiles p
       where p.org_id = d.org_id and public.is_active_member(p.id)
         and (p.id = d.manager_id or p.role::text = any (d.notify_roles) or (d.notify_person and p.id = d.person_profile_id))
         -- A medical document's notice goes to the person, the direct manager and those who may see medical documents (1535's one rule).
         and (not d.t_medical or p.id = d.person_profile_id or p.id = d.manager_id                         -- mut:rr_medical_manager
              or public.may_see_medical_documents(p.id))                                                    -- mut:medical
    loop
      insert into public.document_expiry_notices (document_id, expires_on, threshold, recipient_id, org_id)
        values (d.id, d.expires_on, v_thr, r.id, d.org_id) on conflict do nothing;
      get diagnostics v_inserted = row_count;
      continue when v_inserted = 0;
      -- A manager without the medical right is told who, which type and when, and nothing that opens the document.
      v_plain := d.t_medical and r.id is distinct from d.person_profile_id and not public.may_see_medical_documents(r.id);
      perform public.notify_workflow_user(d.org_id, r.id,
        d.type_name || ' expires in ' || v_left || (case when v_left = 1 then ' day' else ' days' end),
        v_subject || ' — ' || d.type_name || ' expires ' || to_char(d.expires_on, 'FMDD Mon YYYY') || '.',
        case when v_thr <= 7 then 'critical' when v_thr <= 14 then 'warning' else 'info' end,
        case when v_plain then null else 'expiry_document' end, case when v_plain then null else d.id end,  -- mut:rr_medical_plain
        v_subject || ' — ' || d.type_name, 'document_expiry');
      v_sent := v_sent + 1;
    end loop;
  end loop;
  insert into public.ops_job_heartbeats (job_name, last_run_at, last_detail)
    values ('document-expiry-warnings', now(), jsonb_build_object('sent', v_sent))
    on conflict (job_name) do update set last_run_at = excluded.last_run_at, last_detail = excluded.last_detail;
  return v_sent;
end $function$
;
