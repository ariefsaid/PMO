-- 0132_auto_expose_lockdown.test.sql — audit finding #4 (defense-in-depth): proves
-- `auto_expose_new_tables = false` (config.toml) + 0075_explicit_api_grants.sql together deliver
-- BOTH halves of the safe activation:
--   (a) EXISTING tables keep exactly the DML access they had before (RLS still applies underneath —
--       the explicit grants only restore table/column-level privilege, never widen what RLS allows);
--   (b) a brand-new table created with no migration-authored GRANT is NO LONGER reachable by
--       `authenticated`/`anon` at all — the actual security win this migration exists to prove.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. This file makes no schema changes
-- outside its own transaction (the throwaway table in Part 2 is created and left inside `begin`/
-- `rollback` via the pgTAP wrapper, so `db reset`/re-run is unaffected either way).
begin;
select plan(9);

-- ── Fixtures: one org (seed org, already exists), one Project Manager profile, one project ─────────
insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-0000000000e1','lockdown-pm@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('e0000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000001',
   'Lockdown PM','lockdown-pm@example.com','Project Manager');

insert into projects (id, org_id, name, status) values
  ('e1111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
   'Lockdown Project','Ongoing Project');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Part 1 (AC-EXPOSE-001..006) — EXISTING tables: `authenticated` keeps exactly the same DML access
-- as before the flag flip (0075 mirrors current grants 1:1; RLS is unchanged and still the real gate).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- AC-EXPOSE-001: authenticated can still SELECT profiles (own-org row visible).
select is(
  (select count(*)::int from profiles where id = 'e0000000-0000-0000-0000-0000000000e1'), 1,
  'AC-EXPOSE-001: authenticated can still SELECT profiles post-lockdown');

-- AC-EXPOSE-002: authenticated can still SELECT projects (own-org row visible).
select is(
  (select count(*)::int from projects where id = 'e1111111-0000-0000-0000-000000000001'), 1,
  'AC-EXPOSE-002: authenticated can still SELECT projects post-lockdown');

-- AC-EXPOSE-003: authenticated (PM, own org) can still INSERT a procurement — proves the table-level
-- INSERT grant survived the lockdown for a table that was NEVER narrowed by a prior migration.
select lives_ok(
  $$ insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value)
     values ('e2222222-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',
             'Lockdown Procurement','e1111111-0000-0000-0000-000000000001',
             'e0000000-0000-0000-0000-0000000000e1','Draft', 100) $$,
  'AC-EXPOSE-003: authenticated can still INSERT procurements post-lockdown (RLS still applies)');

-- AC-EXPOSE-004: authenticated (PM) can still UPDATE that procurement's title.
select lives_ok(
  $$ update procurements set title = 'Lockdown Procurement (updated)'
     where id = 'e2222222-0000-0000-0000-000000000002' $$,
  'AC-EXPOSE-004: authenticated can still UPDATE procurements post-lockdown (RLS still applies)');

-- AC-EXPOSE-005: the column-narrowed UPDATE contract on `projects` (0008/0014 — contract_value is
-- RPC-only) is UNCHANGED by the lockdown: authenticated still CANNOT update contract_value directly.
select throws_ok(
  $$ update projects set contract_value = 999999 where id = 'e1111111-0000-0000-0000-000000000001' $$,
  '42501', null,
  'AC-EXPOSE-005: projects.contract_value stays RPC-only post-lockdown (column-grant mirror preserved)');

-- AC-EXPOSE-006: the RPC-only record tables (0058 — purchase_requests et al.) still CANNOT be
-- INSERTed directly by authenticated post-lockdown (their revoke was preserved, not accidentally
-- un-done by the explicit-grants mirror).
select throws_ok(
  $$ insert into purchase_requests (id, org_id, procurement_id, status)
     values ('e3333333-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001',
             'e2222222-0000-0000-0000-000000000002','Draft') $$,
  '42501', null,
  'AC-EXPOSE-006: purchase_requests stays RPC-only (INSERT still revoked) post-lockdown');

reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Part 2 (AC-EXPOSE-007..009) — NEW table created with NO explicit grant: `authenticated`/`anon` have
-- ZERO privileges on it. This is the actual security win `auto_expose_new_tables = false` buys.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create table lockdown_probe_table (id uuid primary key default gen_random_uuid(), note text);

-- AC-EXPOSE-007: authenticated has no SELECT on a table nobody explicitly granted.
select is(
  has_table_privilege('authenticated', 'lockdown_probe_table', 'SELECT'), false,
  'AC-EXPOSE-007: a brand-new ungranted table is NOT auto-exposed to authenticated (SELECT)');

-- AC-EXPOSE-008: authenticated has no INSERT either.
select is(
  has_table_privilege('authenticated', 'lockdown_probe_table', 'INSERT'), false,
  'AC-EXPOSE-008: a brand-new ungranted table is NOT auto-exposed to authenticated (INSERT)');

-- AC-EXPOSE-009: anon has no SELECT either (both Data API roles are locked out by default now).
select is(
  has_table_privilege('anon', 'lockdown_probe_table', 'SELECT'), false,
  'AC-EXPOSE-009: a brand-new ungranted table is NOT auto-exposed to anon (SELECT)');

drop table lockdown_probe_table;

select * from finish();
rollback;
