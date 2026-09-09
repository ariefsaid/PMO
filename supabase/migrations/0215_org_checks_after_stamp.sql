-- 0215_org_checks_after_stamp.sql — #632 (map #618): three BEFORE INSERT checks read NEW.org_id
-- BEFORE the org stamp had run. Postgres fires same-event triggers in name order;
-- `tasks_check_meeting_same_project`, `tasks_check_parent_same_project` and
-- `incident_reports_check_project_org` all sort before `<table>_stamp_org_id`, so in any org other
-- than the seed org they compared the parent's org against the still-default seed literal and raised
-- 42501. Who broke: a second-org user publishing an /action task from a meeting, creating a sub-task,
-- or filing an incident report on a project. Invisible in the seed org (found by the second-org e2e
-- run, #621).
--
-- Fix: rename the three so they sort AFTER the stamp (`zz_` slot, the 0187 `*_zz_stamp_currency`
-- convention). Bodies unchanged. §2 asserts the class from the catalog on the migrated DB; the pgTAP
-- twin (0215 test) is the standing guard.
--
-- Reversibility: rename each back.

alter trigger tasks_check_meeting_same_project    on public.tasks            rename to tasks_zz_check_meeting_same_project;
alter trigger tasks_check_parent_same_project     on public.tasks            rename to tasks_zz_check_parent_same_project;
alter trigger incident_reports_check_project_org  on public.incident_reports rename to incident_reports_zz_check_project_org;

-- §2 — no BEFORE INSERT trigger that reads NEW.org_id and can raise may sort before its table's stamp.
do $$
declare v_bad text;
begin
  with st as (
    select t.tgrelid, t.tgname
    from pg_trigger t join pg_proc f on f.oid = t.tgfoid
    where not t.tgisinternal and f.proname = 'stamp_org_id')
  select string_agg(t.tgrelid::regclass || '.' || t.tgname, ', ') into v_bad
  from pg_trigger t join pg_proc f on f.oid = t.tgfoid join st on st.tgrelid = t.tgrelid
  where not t.tgisinternal and t.tgname <> st.tgname
    and t.tgtype::int & 2 = 2 and t.tgtype::int & 4 = 4      -- BEFORE ... INSERT
    and t.tgname < st.tgname
    and f.prosrc ~* 'new\.org_id' and f.prosrc ~* 'raise';
  if v_bad is not null then
    raise exception '0215: org checks fire before the org stamp: %', v_bad;
  end if;
end $$;
