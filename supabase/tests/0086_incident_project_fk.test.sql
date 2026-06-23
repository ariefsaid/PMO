-- 0086_incident_project_fk.test.sql
-- Migration under test: 0043_incident_project_fk.sql
--
-- Backlog gap #8: link an incident to its project (/projects/:id). Adds the nullable
-- incident_reports.project_id FK (ON DELETE SET NULL — deleting a project must not delete
-- incident history), an index, and a same-org integrity guard (mirroring the 0039 same-case
-- invariant pattern — a plain FK bypasses RLS, so a cross-org project_id would be accepted
-- and would point an incident at a project its org cannot read; 42501 uniform, no existence leak).
--
-- AC-IN-PROJ-001  incident_reports.project_id column exists, uuid, nullable
-- AC-IN-PROJ-002  project_id is a FK to projects(id) with ON DELETE SET NULL
-- AC-IN-PROJ-003  idx_incident_reports_project_id index exists on incident_reports(project_id)
-- AC-IN-PROJ-004  deleting a linked project SET NULLs the incident's project_id (history kept)
-- AC-IN-PROJ-005  same-org link (incident.org = project.org) → lives_ok
-- AC-IN-PROJ-006  cross-org project_id (insert) → 42501 (same-org guard, no existence leak)
-- AC-IN-PROJ-007  cross-org project_id (update) → 42501
-- AC-IN-PROJ-008  null project_id → lives_ok (incidents may be unlinked)
begin;
select plan(10);

-- ── Schema assertions ────────────────────────────────────────────────────────

-- AC-IN-PROJ-001: column exists, uuid, nullable
select has_column('public', 'incident_reports', 'project_id',
  'AC-IN-PROJ-001: incident_reports.project_id column exists');
select col_type_is('public', 'incident_reports', 'project_id', 'uuid',
  'AC-IN-PROJ-001: incident_reports.project_id is uuid');
select col_is_null('public', 'incident_reports', 'project_id',
  'AC-IN-PROJ-001: incident_reports.project_id is nullable');

-- AC-IN-PROJ-002: FK to projects(id) with ON DELETE SET NULL
select ok(
  exists(
    select 1
    from pg_constraint c
    join pg_class t   on t.oid = c.conrelid
    join pg_class rt  on rt.oid = c.confrelid
    where c.contype = 'f'
      and t.relname  = 'incident_reports'
      and rt.relname = 'projects'
      and c.confdeltype = 'n'  -- 'n' = ON DELETE SET NULL
      and (select attname from pg_attribute
           where attrelid = c.conrelid and attnum = c.conkey[1]) = 'project_id'
  ),
  'AC-IN-PROJ-002: project_id is a FK to projects(id) with ON DELETE SET NULL'
);

-- AC-IN-PROJ-003: index exists
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'incident_reports'
      and indexname  = 'idx_incident_reports_project_id'
  ),
  'AC-IN-PROJ-003: idx_incident_reports_project_id exists on incident_reports(project_id)'
);

-- ── Behavioural fixtures ─────────────────────────────────────────────────────
-- Two orgs; each with a project. Incidents in Org A.

insert into organizations (id, name) values
  ('00860000-0000-0000-0000-000000000001', 'Inc Org A'),
  ('00860000-0000-0000-0000-000000000002', 'Inc Org B');

insert into projects (id, org_id, name, status) values
  ('00860000-0000-0000-0000-0000000000a0','00860000-0000-0000-0000-000000000001',
   'Inc Project A','Ongoing Project'),
  ('00860000-0000-0000-0000-0000000000b0','00860000-0000-0000-0000-000000000002',
   'Inc Project B','Ongoing Project');

-- ── AC-IN-PROJ-004: deleting a linked project SET NULLs the incident's project_id ─
insert into incident_reports (id, org_id, incident_date, type, severity, project_id) values
  ('00860000-0000-0000-0000-0000000000c1','00860000-0000-0000-0000-000000000001',
   '2026-06-21','Near Miss','Low','00860000-0000-0000-0000-0000000000a0');

delete from projects where id = '00860000-0000-0000-0000-0000000000a0';

select is(
  (select project_id from incident_reports where id = '00860000-0000-0000-0000-0000000000c1'),
  null,
  'AC-IN-PROJ-004: deleting a linked project SET NULLs incident.project_id (history kept)'
);

-- Re-create Project A for the remaining same-org / cross-org tests.
insert into projects (id, org_id, name, status) values
  ('00860000-0000-0000-0000-0000000000a0','00860000-0000-0000-0000-000000000001',
   'Inc Project A','Ongoing Project');

-- ── AC-IN-PROJ-005: same-org link → lives_ok ─────────────────────────────────
select lives_ok(
  $$ insert into incident_reports (id, org_id, incident_date, type, severity, project_id) values
       ('00860000-0000-0000-0000-0000000000c2','00860000-0000-0000-0000-000000000001',
        '2026-06-21','Spill','Medium','00860000-0000-0000-0000-0000000000a0') $$,
  'AC-IN-PROJ-005: same-org incident→project link is accepted'
);

-- ── AC-IN-PROJ-006: cross-org project_id (insert) → 42501 ────────────────────
select throws_ok(
  $$ insert into incident_reports (id, org_id, incident_date, type, severity, project_id) values
       ('00860000-0000-0000-0000-0000000000c3','00860000-0000-0000-0000-000000000001',
        '2026-06-21','Spill','High','00860000-0000-0000-0000-0000000000b0') $$,
  '42501', null,
  'AC-IN-PROJ-006: cross-org project_id on insert → 42501 (no existence leak)'
);

-- ── AC-IN-PROJ-007: cross-org project_id (update) → 42501 ────────────────────
select throws_ok(
  $$ update incident_reports
       set project_id = '00860000-0000-0000-0000-0000000000b0'
       where id = '00860000-0000-0000-0000-0000000000c2' $$,
  '42501', null,
  'AC-IN-PROJ-007: cross-org project_id on update → 42501'
);

-- ── AC-IN-PROJ-008: null project_id → lives_ok ───────────────────────────────
select lives_ok(
  $$ insert into incident_reports (org_id, incident_date, type, severity) values
       ('00860000-0000-0000-0000-000000000001','2026-06-21','Other','Low') $$,
  'AC-IN-PROJ-008: null project_id (unlinked incident) is accepted'
);

select * from finish();
rollback;
