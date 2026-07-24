-- bfy_migration_reversibility.test.sql (BFY T20) — OWNS AC-BFY-021 (NFR-BFY-REV-001).
--
-- ⚑ THE HONEST BOUNDARY. 0154's re-key is reversible for exactly the population that existed before
-- this feature was used: ONE year-qualified identity per budget version reverts 1:1 to the bare
-- `<budget_version_id>` it came from, epoch and ERP pointer intact.
--
-- It is NOT reversible once the feature has done the thing it exists for. After a multi-FY fan-out a
-- version owns TWO pointers — `<vid>:<fy1>` → BUDGET-…-2026 and `<vid>:<fy2>` → BUDGET-…-2027 — and the
-- bare identity is a UNIQUE key that can represent exactly ONE of them (0088 `unique (org_id, domain,
-- pmo_record_id)`). Collapsing them would silently DROP one year's pointer to a live ERP Budget with
-- its own overspend controls. So the rollback REFUSES, by name, and says so.
--
-- That refusal is the honest answer, not a limitation to be worked around: this is a NAMED, accepted
-- irreversibility (the feature's own capability), and it is stated in 0154's header and in
-- NFR-BFY-REV-001 rather than discovered during an incident.
--
-- MUTATION (run, not assumed): delete the fan-out refusal → assertion 4 goes red. The honest detail
-- the run surfaced: the rollback then dies on `external_refs_org_id_domain_pmo_record_id_key` instead,
-- so the pointer is not actually lost — the DB's own unique constraint is a second guard. What the
-- refusal adds is that the operator is TOLD which version and why, in a rollback that leaves the
-- database exactly as it found it, instead of reading an opaque duplicate-key error mid-incident.
--
-- Structurally unable to see: whether the ERP documents themselves survive a rollback — they do,
-- untouched, because nothing here talks to ERPNext; that is named irreversibility of the POINTER, and
-- AC-BFY-011/031 own the live-ERP state.
begin;
select plan(7);

insert into organizations (id, name) values
  ('0bfc0000-0000-0000-0000-000000000001','BFY Rollback Org');

insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bfc1111-0000-0000-0000-000000000001','0bfc0000-0000-0000-0000-000000000001','BFY Rollback Single','Ongoing Project',date '2025-08-01',date '2026-03-31'),
  ('0bfc1111-0000-0000-0000-000000000002','0bfc0000-0000-0000-0000-000000000001','BFY Rollback Fan-out','Ongoing Project',date '2025-08-01',date '2027-03-31');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bfc2222-0000-0000-0000-000000000001','0bfc0000-0000-0000-0000-000000000001','0bfc1111-0000-0000-0000-000000000001',1,'Single FY','Active'),
  ('0bfc2222-0000-0000-0000-000000000002','0bfc0000-0000-0000-0000-000000000001','0bfc1111-0000-0000-0000-000000000002',1,'Two FYs','Active');

set local role postgres;

-- ── (a) the pre-issue population, already re-keyed: ONE year-qualified identity ──────────────────
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, erp_budget_name) values
  ('0bfc0000-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000001','2025-2026','pushed','BUDGET-SINGLE-2026');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('0bfc0000-0000-0000-0000-000000000001','budget',
   '0bfc2222-0000-0000-0000-000000000001:' || public.budget_fiscal_year_token('2025-2026'),
   'erpnext','BUDGET-SINGLE-2026');
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
  ('0bfc0000-0000-0000-0000-000000000001','budget',
   '0bfc2222-0000-0000-0000-000000000001:' || public.budget_fiscal_year_token('2025-2026'),
   'bud:0bfc2222-0000-0000-0000-000000000001:' || public.budget_fiscal_year_token('2025-2026') || ':1768532645000',
   'erpnext','create','confirmed');

create temp table bfy_rev_before on commit drop as
  select id, external_record_id from external_refs where domain='budget';

select lives_ok(
  'select public.bfy_migration_0154_revert()',
  'AC-BFY-021 a SINGLE-FY population rolls back without complaint');

select is(
  (select count(*)::int from external_refs er join bfy_rev_before b on b.id = er.id
    where er.pmo_record_id = '0bfc2222-0000-0000-0000-000000000001'
      and er.external_record_id = b.external_record_id),
  1,
  'AC-BFY-021 (a) the year-qualified identity reverts 1:1 IN PLACE to the bare <budget_version_id>, same row, same ERP pointer');

select is(
  (select idempotency_key from external_command_outbox where domain='budget'),
  'bud:0bfc2222-0000-0000-0000-000000000001:1768532645000',
  'AC-BFY-021 (a) …and the outbox key returns to the exact pre-issue bud:<vid>:<epochMs> shape, epoch intact');

delete from external_command_outbox where domain='budget';
delete from external_refs where domain='budget';

-- ── (b) a MULTI-FY fan-out: two pointers, two live ERP Budgets, one bare key available ───────────
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, erp_budget_name) values
  ('0bfc0000-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000002','2026','pushed','BUDGET-FANOUT-2026'),
  ('0bfc0000-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000002','2027','pushed','BUDGET-FANOUT-2027');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('0bfc0000-0000-0000-0000-000000000001','budget',
   '0bfc2222-0000-0000-0000-000000000002:' || public.budget_fiscal_year_token('2026'),'erpnext','BUDGET-FANOUT-2026'),
  ('0bfc0000-0000-0000-0000-000000000001','budget',
   '0bfc2222-0000-0000-0000-000000000002:' || public.budget_fiscal_year_token('2027'),'erpnext','BUDGET-FANOUT-2027');

select throws_like(
  'select public.bfy_migration_0154_revert()',
  '%0bfc2222-0000-0000-0000-000000000002%',
  'AC-BFY-021 (b) a MULTI-FY fan-out FAILS CLOSED and NAMES the version — two ERP pointers cannot collapse into one bare key');

select is(
  (select count(*)::int from external_refs where domain='budget'),
  2,
  'AC-BFY-021 (b) both mappings survive the refused rollback — a rollback that collapsed them would read 1 (the mutation this assertion exists for)');

select results_eq(
  $$select external_record_id from external_refs where domain='budget' order by external_record_id$$,
  $$values ('BUDGET-FANOUT-2026'::text), ('BUDGET-FANOUT-2027'::text)$$,
  'AC-BFY-021 (b) …and NEITHER year''s ERP pointer is lost — the refusal is what protects the second Budget');

-- ── the down migration is STAGED, not run by `supabase db reset` ─────────────────────────────────
-- If the down file were being applied automatically, the re-key function and the fence trigger it
-- drops would be gone from this very database.
select is(
  (select count(*)::int from pg_proc where proname = 'bfy_migration_0154_rekey'),
  1,
  'AC-BFY-021 the rollback is STAGED — `supabase db reset` does not apply it (the re-key it would drop is still here)');

select finish();
rollback;
