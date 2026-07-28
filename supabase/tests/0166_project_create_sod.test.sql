-- 0166_project_create_sod.test.sql
-- docs/specs/project-create-sod.spec.md — close the INSERT-side hole in the project money/status SoD.
--
-- The defect this proves closed: `authenticated` held a COLUMN-RESTRICTED UPDATE on public.projects
-- that withheld contract_value/status/decided_at/customer_contract_ref/contract_date (0008 A6, 0014),
-- but a BLANKET INSERT that handed all five over. A Project Manager could therefore
-- `POST /rest/v1/projects` with a won status, an arbitrary contract value and a forged decided_at —
-- bypassing the ADR-0019 SoD and the transition_project state machine — and, because log_audit was
-- wired to the RPCs and to AFTER DELETE only, leave NO audit row behind.
--
-- Owning layer per spec §8: AC-PCS-001..007 are pgTAP (here). AC-PCS-020 (the apply-time WARNING that
-- counts pre-existing violations) is owned by MIGRATION OUTPUT, not by this file — a fresh
-- `supabase db reset` applies 0173 against an empty table, so there is nothing for pgTAP to observe.
--
-- ── SCOPE OF THE TRIGGER (deliberate, and asserted below) ────────────────────────────────────────
-- The guard enforces on roles that are subject to RLS (authenticated, anon) and EXEMPTS roles that
-- already bypass it (postgres, service_role, supabase_admin — `pg_roles.rolbypassrls`). It sits at
-- exactly the RLS trust boundary: a BYPASSRLS role is a server-side authority holding a secret key,
-- not a client. Enforcing on those roles instead would break supabase/seed.sql, ~105 pgTAP fixtures,
-- the three ERPNext e2e seed helpers (service-role inserts at 'Ongoing Project') and
-- scripts/import-historical.mjs (which legitimately imports historical won projects). Assertion 19
-- pins the exemption so it stays a decision rather than an accident.
--
-- ⚑ SPEC CORRECTION (reported to the Director): AC-PCS-007 says transition_project "still writes its
-- audit row". It never wrote one — 0008 defines it with no log_audit call, and 0076 wired audit rows
-- to operator_grant_credits / set_project_contract_value / transition_document_status / the two
-- AFTER DELETE triggers only. Assertions 13-15 therefore prove the regression control that IS real
-- (the win path still succeeds and still captures the win artifacts); the missing transition audit is
-- a separate, pre-existing gap and is NOT asserted here, because asserting its absence would enshrine
-- it and asserting its presence would fail for a reason this slice does not own.
-- ⚑ RESOLVED by 0176 §3 (slice 4): transition_project now writes a `project.transition` audit row
-- carrying from/to, the actor, and the contract_value that rode into Won. It is asserted in
-- supabase/tests/0169_create_path_sod_residuals.test.sql §D (AC-RES-031), which owns it — this file's
-- assertions are deliberately left as they were, so 0166 keeps proving only what slice 1 owns.
begin;
select plan(19);

-- ── Fixtures: one org, a PM, an Admin, and a client company ─────────────────────────────────────
insert into organizations (id, name) values
  ('01660000-0000-0000-0000-000000000001','PCS Org');

insert into auth.users (id, email) values
  ('01660000-0000-0000-0000-0000000000a1','pcs-pm@example.com'),
  ('01660000-0000-0000-0000-0000000000a2','pcs-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('01660000-0000-0000-0000-0000000000a1','01660000-0000-0000-0000-000000000001',
   'PCS PM','pcs-pm@example.com','Project Manager','active'),
  ('01660000-0000-0000-0000-0000000000a2','01660000-0000-0000-0000-000000000001',
   'PCS Admin','pcs-admin@example.com','Admin','active');

insert into companies (id, org_id, name, type) values
  ('01660000-0000-0000-0000-0000000000c1','01660000-0000-0000-0000-000000000001','PCS Client','Client');

-- A pre-win pipeline project for the AC-PCS-007 regression control. Inserted as postgres (a
-- BYPASSRLS server-side authority) — 'Negotiation' is not an origination status, so this row also
-- exercises the exemption the header describes.
insert into projects (id, org_id, name, status, client_id, contract_value) values
  ('01660000-0000-0000-0000-0000000000b9','01660000-0000-0000-0000-000000000001',
   'PCS Pipeline Deal','Negotiation','01660000-0000-0000-0000-0000000000c1', 400000);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-PCS-006 (FR-PCS-004) — the GRANT layer: `authenticated` holds no INSERT privilege on the three
-- win artifacts, and still holds it on every column a legitimate origination create supplies.
-- These two run FIRST, before assertion 16-18's deliberate in-transaction re-grant.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'projects'
       and grantee = 'authenticated' and privilege_type = 'INSERT'
       and column_name in ('decided_at','customer_contract_ref','contract_date')),
  0,
  'AC-PCS-006 authenticated holds NO INSERT privilege on decided_at / customer_contract_ref / contract_date');

-- No-over-revoke control: the seven columns createProject() and the bulk importer actually send must
-- all still be insertable. A blanket `revoke insert on projects from authenticated` passes the
-- assertion above and fails this one.
select is(
  (select count(*)::int from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'projects'
       and grantee = 'authenticated' and privilege_type = 'INSERT'
       and column_name in ('name','status','contract_value','client_id',
                           'project_manager_id','start_date','end_date')),
  7,
  'AC-PCS-006 authenticated still holds INSERT on the seven origination columns (no over-revoke)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-PCS-001 (FR-PCS-001) — the demonstrated exploit (spec §1.1), now rejected.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01660000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into public.projects (org_id, name, status, contract_value, client_id)
       values ('01660000-0000-0000-0000-000000000001','EXPLOIT — forged win',
               'Won, Pending KoM', 99999999.00, '01660000-0000-0000-0000-0000000000c1') $$,
  'P0001',
  'projects.status "Won, Pending KoM" is not an origination status: a project can only be created as a Lead or an Internal Project, and a won project is reached only by winning the deal',
  'AC-PCS-001 a PM creating a project directly at a won status is rejected, naming the origination rule');

reset role;
select is(
  (select count(*)::int from public.projects where name = 'EXPLOIT — forged win'),
  0,
  'AC-PCS-001 no forged-win row landed');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-PCS-005 — the rule is STRUCTURAL, not a role gate: an Admin is rejected identically.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01660000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ insert into public.projects (org_id, name, status, contract_value)
       values ('01660000-0000-0000-0000-000000000001','EXPLOIT — admin forged win',
               'Won, Pending KoM', 12345.00) $$,
  'P0001',
  'projects.status "Won, Pending KoM" is not an origination status: a project can only be created as a Lead or an Internal Project, and a won project is reached only by winning the deal',
  'AC-PCS-005 an Admin is rejected too — the win path is the state machine for everyone');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-PCS-002 (grant layer) — what a real attacker actually hits when they name a win artifact in the
-- INSERT column list: the column privilege check, which fires before any trigger.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims =
  '{"sub":"01660000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into public.projects (org_id, name, status, decided_at)
       values ('01660000-0000-0000-0000-000000000001','EXPLOIT — forged decision date',
               'Leads', '2020-01-01') $$,
  '42501',
  'permission denied for table projects',
  'AC-PCS-002 naming decided_at in the INSERT column list is denied at the privilege check (grant layer)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-PCS-003 — NO OVER-BLOCKING: a legitimate origination create, WITH a contract value, still
-- succeeds. contract_value at INSERT is the opportunity value, and every legitimate create sends it.
-- ⚑ CORRECTION (0176): the original wording here — "the SoD is about the WON value, which
-- transition_project + set_project_contract_value own" — was FALSE. transition_project never reads
-- contract_value, so the origination value rides into Won unre-approved. That residual is STILL OPEN
-- and is pinned by 0169 AC-RES-032; this assertion is unchanged, because "a legitimate create with a
-- value still succeeds" is true either way and a reject-everything guard must still fail here.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select lives_ok(
  $$ insert into public.projects (id, org_id, name, status, contract_value, client_id, project_manager_id)
       values ('01660000-0000-0000-0000-0000000000b1','01660000-0000-0000-0000-000000000001',
               'PCS Legitimate Lead','Leads', 250000.00,
               '01660000-0000-0000-0000-0000000000c1','01660000-0000-0000-0000-0000000000a1') $$,
  'AC-PCS-003 a legitimate Leads create WITH a contract_value still succeeds');

reset role;
select is(
  (select contract_value from public.projects where id = '01660000-0000-0000-0000-0000000000b1'),
  250000.00::numeric,
  'AC-PCS-003 the origination contract_value was stored verbatim');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-PCS-004 (FR-PCS-003) — the create is now on the audit trail. Read as postgres (BYPASSRLS), so
-- audit_events' FORCE-RLS single SELECT policy does not hide the row from the assertion.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from public.audit_events
     where action = 'project.create'
       and entity_id = '01660000-0000-0000-0000-0000000000b1'),
  1,
  'AC-PCS-004 exactly one audit_events row was written for the create');

select is(
  (select actor_id from public.audit_events
     where action = 'project.create' and entity_id = '01660000-0000-0000-0000-0000000000b1'),
  '01660000-0000-0000-0000-0000000000a1'::uuid,
  'AC-PCS-004 the audit row names the acting PM');

select is(
  (select detail ->> 'status' from public.audit_events
     where action = 'project.create' and entity_id = '01660000-0000-0000-0000-0000000000b1'),
  'Leads',
  'AC-PCS-004 the audit row records the origination status');

select is(
  (select (detail ->> 'contract_value')::numeric from public.audit_events
     where action = 'project.create' and entity_id = '01660000-0000-0000-0000-0000000000b1'),
  250000.00::numeric,
  'AC-PCS-004 the audit row records the origination contract_value');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-PCS-007 — REGRESSION CONTROL: the legitimate win path still works end to end. See the header
-- for why the spec's "and still writes its audit row" clause is not asserted (it never did).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01660000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select transition_project('01660000-0000-0000-0000-0000000000b9'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-PCS-1', '2026-03-01'::date) $$,
  'AC-PCS-007 transition_project still wins a pipeline deal (the sanctioned win path)');

reset role;
select is(
  (select status::text from public.projects where id = '01660000-0000-0000-0000-0000000000b9'),
  'Won, Pending KoM',
  'AC-PCS-007 the won status was applied by the state machine');

select is(
  (select customer_contract_ref || '|' || decided_at::date::text
     from public.projects where id = '01660000-0000-0000-0000-0000000000b9'),
  'CPO-PCS-1|2026-03-01',
  'AC-PCS-007 the win artifacts (customer_contract_ref, decided_at) were captured by the RPC');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-PCS-002 (TRIGGER layer, isolated) — defence in depth: even WITH the INSERT grant restored, the
-- trigger stops each win artifact and names it. The grant below is DDL inside this test transaction
-- and is undone by the closing rollback; it exists so the trigger can be proven independently of the
-- privilege check that would otherwise mask it (assertion 6).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
grant insert (decided_at, customer_contract_ref, contract_date) on public.projects to authenticated;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01660000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into public.projects (org_id, name, status, decided_at)
       values ('01660000-0000-0000-0000-000000000001','PCS forged decided_at','Leads','2020-01-01') $$,
  'P0001',
  'projects.decided_at cannot be set when a project is created: the win artifacts (decided_at, customer_contract_ref, contract_date) are recorded only by winning the deal',
  'AC-PCS-002 the trigger rejects a non-NULL decided_at at INSERT, naming decided_at');

select throws_ok(
  $$ insert into public.projects (org_id, name, status, customer_contract_ref)
       values ('01660000-0000-0000-0000-000000000001','PCS forged ref','Leads','FORGED-REF-001') $$,
  'P0001',
  'projects.customer_contract_ref cannot be set when a project is created: the win artifacts (decided_at, customer_contract_ref, contract_date) are recorded only by winning the deal',
  'AC-PCS-002 the trigger rejects a non-NULL customer_contract_ref at INSERT, naming customer_contract_ref');

select throws_ok(
  $$ insert into public.projects (org_id, name, status, contract_date)
       values ('01660000-0000-0000-0000-000000000001','PCS forged contract date','Leads','2020-01-01') $$,
  'P0001',
  'projects.contract_date cannot be set when a project is created: the win artifacts (decided_at, customer_contract_ref, contract_date) are recorded only by winning the deal',
  'AC-PCS-002 the trigger rejects a non-NULL contract_date at INSERT, naming contract_date');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Scoping control (see header): a BYPASSRLS server-side authority is EXEMPT. service_role is how the
-- ERPNext e2e seed helpers, the historical importer and every edge function write, and they
-- legitimately create rows at a non-origination status.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
reset role;
set local role service_role;
select lives_ok(
  $$ insert into public.projects (org_id, name, status)
       values ('01660000-0000-0000-0000-000000000001','PCS service-role backfill','Ongoing Project') $$,
  'service_role (a BYPASSRLS server-side authority) may still create a non-origination project');

reset role;
select * from finish();
rollback;
