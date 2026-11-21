-- 1369_billing_steps_needs_you.sql — the viewer's waiting billing steps, and overdue steps per claim for the claim list (#2680).
-- FR-CBS-040/042; proven by supabase/tests/1365_claim_billing_steps.test.sql (AC-CBS-011). Both are READS derived from the claim's
-- own step rows: no pointer row exists, so none can go stale; a step that completes, is skipped or is removed simply stops matching.
-- Scope: the stage tables are not readable by an Engineer (1021), so an Engineer gets no pointer; a Project Manager sees only steps of
-- projects they manage; Admin, Executive and Finance see their role's steps across the organisation.
-- ── REVERSE: rollback/1369_billing_steps_needs_you_down.sql ──────────────────────────────────────────────────────────

create function public.my_waiting_billing_steps()
  returns table (stage_id uuid, claim_id uuid, project_id uuid, project_name text, step_name text, due_on date, days_over integer)
  language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_role user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then return; end if;
  return query
    select s.id, s.claim_id, s.project_id, p.name, s.name, d.due, case when d.due is not null and t.today > d.due then t.today - d.due else 0 end
      from public.claim_billing_stages s
      join public.progress_claims pc on pc.id = s.claim_id and pc.withdrawn_at is null
      join public.projects p on p.id = s.project_id and p.org_id = v_org
      cross join lateral (select public.native_org_today(v_org) as today) t
      cross join lateral (select public.billing_stage_due_on(s) as due) d
     where s.org_id = v_org and s.owner_role = v_role
       and s.completed_on is null and s.skipped_on is null and s.started_on is not null
       and (v_role <> 'Project Manager' or p.project_manager_id = auth.uid())
     order by (case when d.due is not null and t.today > d.due then 0 else 1 end), d.due nulls last, s.started_on
     limit 200;
end; $$;
revoke all on function public.my_waiting_billing_steps() from public, anon;
grant execute on function public.my_waiting_billing_steps() to authenticated, service_role;

create function public.overdue_billing_steps_by_claim(p_project uuid)
  returns table (claim_id uuid, step_name text, days_over integer)
  language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_role user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then return; end if;
  return query
    select distinct on (s.claim_id) s.claim_id, s.name, (t.today - d.due)::integer
      from public.claim_billing_stages s
      join public.progress_claims pc on pc.id = s.claim_id and pc.withdrawn_at is null
      cross join lateral (select public.native_org_today(v_org) as today) t
      cross join lateral (select public.billing_stage_due_on(s) as due) d
     where s.org_id = v_org and s.project_id = p_project
       and s.completed_on is null and s.skipped_on is null and s.started_on is not null
       and d.due is not null and t.today > d.due
     order by s.claim_id, s.position
     limit 200;
end; $$;
revoke all on function public.overdue_billing_steps_by_claim(uuid) from public, anon;
grant execute on function public.overdue_billing_steps_by_claim(uuid) to authenticated, service_role;
