-- 1209 (#2710): explicit light-account refusal at the top of the READ-SIDE security-definer RPCs.
-- Rollback: supabase/migrations/rollback/1209_light_accounts_definer_guards_down.sql
-- Restrictive policies (1206) bind security-INVOKER reads (dashboard, pipeline, delivery, budget projection, finance review,
-- win rate, milestones are all invoker: a light account reads zero rows there). A security-DEFINER function bypasses RLS, so each
-- definer that returns project, budget, price, billing or list data to `authenticated` refuses a light account itself.
-- Body rewrite is mechanical and keeps signature, language, volatility, search_path and grants (CREATE OR REPLACE):
--   plpgsql -> `perform public.assert_not_light();` as the first statement of the outer block;
--   sql     -> body wrapped as `select q.* from (<body>) q where public.assert_not_light()`.
-- A name that cannot be rewritten raises a WARNING (never a silent skip) and 2710's pgTAP goes red for it.
-- For anyone who is not a light account assert_not_light() returns true: behaviour is unchanged.
do $$
declare
  r record; v_def text; v_new text; v_body text;
begin
  for r in
    select p.oid, p.proname, l.lanname, p.prosrc
      from pg_proc p join pg_language l on l.oid = p.prolang
     where p.pronamespace = 'public'::regnamespace and p.prosecdef
       and p.proname in ('get_budget_archive_targets', 'list_account_reconciliation', 'list_tm_claim_source_details',
                         'equipment_rental_check', 'approved_timesheet_for_push', 'org_usage_summary',
                         'org_agent_run_stats', 'org_credit_balance', 'preview_task_reminders')
  loop
    if coalesce(btrim(r.prosrc), '') = '' then
      raise warning '2710: % has no source body, not guarded', r.proname;
      continue;
    end if;
    v_def := pg_get_functiondef(r.oid);
    if r.lanname = 'plpgsql' then
      v_body := regexp_replace(r.prosrc, '(^|\n)(\s*begin\s*)(\n|$)', E'\\1\\2\\3  perform public.assert_not_light();\n', 'i');
    elsif r.lanname = 'sql' then
      v_body := E'\n  select q.* from (' || regexp_replace(btrim(r.prosrc, E' \n\t\r;'), ';\s*$', '') ||
                E') q where public.assert_not_light()\n';
    else
      raise warning '2710: % is language %, not guarded', r.proname, r.lanname;
      continue;
    end if;
    if v_body = r.prosrc or position(r.prosrc in v_def) = 0 then
      raise warning '2710: % could not be rewritten, not guarded', r.proname;
      continue;
    end if;
    v_new := overlay(v_def placing v_body from position(r.prosrc in v_def) for length(r.prosrc));
    execute v_new;
  end loop;
end $$;

create index if not exists tasks_assignee_idx on public.tasks (assignee_id) where assignee_id is not null;
create index if not exists incident_reports_reported_by_idx on public.incident_reports (reported_by) where reported_by is not null;
