-- bfy_migration_preflight.test.sql (BFY T18) — OWNS AC-BFY-020 (FR-BFY-035b).
--
-- ⚑ WHAT THIS PROTECTS. 0154 re-keys the budget domain's identity from the bare `<budget_version_id>`
-- to `<budget_version_id>:<encoded_fiscal_year>`. Every re-keyed row is a POINTER TO A REAL ERP BUDGET
-- on a client's ledger. If the migration re-keys a row whose fiscal year it cannot recover UNAMBIGUOUSLY,
-- PMO either loses the pointer (and the next activation dispatches a `create` for a project-year ERPNext
-- already holds — a DUPLICATE budget on a real ledger) or silently orphans one year of a two-year push.
--
-- So the migration PREFLIGHTS, in the same transaction, BEFORE any rewrite, and FAILS CLOSED — naming
-- the offending row — on each of the four unrecoverable shapes (spec §4.5, FR-BFY-035b):
--   (a) a bare `pmo_record_id` whose version has >1 mirror fiscal_year  → which year? ambiguous.
--   (b) a bare `pmo_record_id` with NO mirror row                       → no year to recover at all.
--   (c) an ALREADY year-qualified `pmo_record_id`                       → a partial prior run.
--   (d) an outbox `idempotency_key` not parseable as `bud:<vid>:<epochMs>` → the epoch cannot be kept.
-- …plus a fifth, fail-closed rather than assumed: a `pmo_record_id` that is neither a bare UUID nor a
-- year-qualified identity (an unrecognised shape is never quietly skipped).
--
-- MUTATION: delete the preflight and case (a) picks ONE of the two mirror years, re-keys the single
-- `external_refs` row to it, and ORPHANS the other year's ERP Budget → assertions 1+2 go red.
--
-- Structurally unable to see: deploy-time quiescence (the release runbook owns it) and the live ERP
-- one-vs-two Budget count (AC-BFY-011/031 own that).
begin;
select plan(7);

-- ── the population ───────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('0bfa0000-0000-0000-0000-000000000001','BFY Preflight Org');

-- One project per case: `budget_versions_one_active_idx` allows exactly one Active version per
-- project, and every one of these versions is Active because a pushed budget IS the Active one.
insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bfa1111-0000-0000-0000-00000000000a','0bfa0000-0000-0000-0000-000000000001','BFY Preflight A','Ongoing Project',date '2025-08-01',date '2027-03-31'),
  ('0bfa1111-0000-0000-0000-00000000000b','0bfa0000-0000-0000-0000-000000000001','BFY Preflight B','Ongoing Project',date '2025-08-01',date '2026-03-31'),
  ('0bfa1111-0000-0000-0000-00000000000c','0bfa0000-0000-0000-0000-000000000001','BFY Preflight C','Ongoing Project',date '2025-08-01',date '2026-03-31'),
  ('0bfa1111-0000-0000-0000-00000000000d','0bfa0000-0000-0000-0000-000000000001','BFY Preflight D','Ongoing Project',date '2025-08-01',date '2026-03-31');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bfa2222-0000-0000-0000-00000000000a','0bfa0000-0000-0000-0000-000000000001','0bfa1111-0000-0000-0000-00000000000a',1,'A two mirror years','Active'),
  ('0bfa2222-0000-0000-0000-00000000000b','0bfa0000-0000-0000-0000-000000000001','0bfa1111-0000-0000-0000-00000000000b',1,'B no mirror row','Active'),
  ('0bfa2222-0000-0000-0000-00000000000c','0bfa0000-0000-0000-0000-000000000001','0bfa1111-0000-0000-0000-00000000000c',1,'C already re-keyed','Active'),
  ('0bfa2222-0000-0000-0000-00000000000d','0bfa0000-0000-0000-0000-000000000001','0bfa1111-0000-0000-0000-00000000000d',1,'D unparseable key','Active');

set local role postgres;

-- ── case (a): a bare mapping whose version has TWO mirror fiscal years ───────────────────────────
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, erp_budget_name) values
  ('0bfa0000-0000-0000-0000-000000000001','0bfa2222-0000-0000-0000-00000000000a','2026','pushed','BUDGET-A-2026'),
  ('0bfa0000-0000-0000-0000-000000000001','0bfa2222-0000-0000-0000-00000000000a','2027','pushed','BUDGET-A-2027');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('0bfa0000-0000-0000-0000-000000000001','budget','0bfa2222-0000-0000-0000-00000000000a','erpnext','BUDGET-A-2026');

select throws_like(
  'select public.bfy_migration_0154_rekey()',
  '%0bfa2222-0000-0000-0000-00000000000a%',
  'AC-BFY-020 (a) a bare mapping whose version records TWO mirror fiscal years FAILS CLOSED, naming the version — the year is ambiguous and a guess would orphan an ERP Budget');

select is(
  (select pmo_record_id from external_refs where domain='budget' and external_record_id='BUDGET-A-2026'),
  '0bfa2222-0000-0000-0000-00000000000a',
  'AC-BFY-020 …and the DB is left UNCHANGED — the preflight raises BEFORE any rewrite (one transaction)');

delete from external_refs where domain='budget' and pmo_record_id='0bfa2222-0000-0000-0000-00000000000a';
delete from budget_version_erp_mirror where budget_version_id='0bfa2222-0000-0000-0000-00000000000a';

-- ── case (b): a bare mapping with NO mirror row at all ───────────────────────────────────────────
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('0bfa0000-0000-0000-0000-000000000001','budget','0bfa2222-0000-0000-0000-00000000000b','erpnext','BUDGET-B-2026');

select throws_like(
  'select public.bfy_migration_0154_rekey()',
  '%0bfa2222-0000-0000-0000-00000000000b%',
  'AC-BFY-020 (b) a bare mapping with NO mirror row FAILS CLOSED, naming the version — there is no PMO-held fact from which to recover the year');

delete from external_refs where domain='budget' and pmo_record_id='0bfa2222-0000-0000-0000-00000000000b';

-- ── case (c): an ALREADY year-qualified row (a partial prior run) ────────────────────────────────
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, erp_budget_name) values
  ('0bfa0000-0000-0000-0000-000000000001','0bfa2222-0000-0000-0000-00000000000c','2026','pushed','BUDGET-C-2026');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('0bfa0000-0000-0000-0000-000000000001','budget',
   '0bfa2222-0000-0000-0000-00000000000c:' || public.budget_fiscal_year_token('2026'),
   'erpnext','BUDGET-C-2026');

select throws_like(
  'select public.bfy_migration_0154_rekey()',
  '%0bfa2222-0000-0000-0000-00000000000c%',
  'AC-BFY-020 (c) an ALREADY year-qualified row FAILS CLOSED, naming it — a partial prior run is a state the operator must resolve, never something to re-run over');

delete from external_refs where domain='budget' and pmo_record_id like '0bfa2222-0000-0000-0000-00000000000c%';
delete from budget_version_erp_mirror where budget_version_id='0bfa2222-0000-0000-0000-00000000000c';

-- ── case (d): an outbox row whose idempotency_key is not the old `bud:<vid>:<epochMs>` shape ─────
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, erp_budget_name) values
  ('0bfa0000-0000-0000-0000-000000000001','0bfa2222-0000-0000-0000-00000000000d','2026','pushed','BUDGET-D-2026');
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
  ('0bfa0000-0000-0000-0000-000000000001','budget','0bfa2222-0000-0000-0000-00000000000d','not-a-budget-key','erpnext','create','confirmed');

select throws_like(
  'select public.bfy_migration_0154_rekey()',
  '%not-a-budget-key%',
  'AC-BFY-020 (d) an outbox idempotency_key that is not `bud:<vid>:<epochMs>` FAILS CLOSED, naming the key — its epoch cannot be carried into the year-qualified key');

delete from external_command_outbox where domain='budget' and idempotency_key='not-a-budget-key';

-- ── the fifth shape: a pmo_record_id that is neither a bare UUID nor year-qualified ──────────────
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('0bfa0000-0000-0000-0000-000000000001','budget','definitely-not-a-uuid','erpnext','BUDGET-JUNK');

select throws_like(
  'select public.bfy_migration_0154_rekey()',
  '%definitely-not-a-uuid%',
  'AC-BFY-020 an UNRECOGNISED pmo_record_id shape FAILS CLOSED, naming it — never silently skipped');

delete from external_refs where domain='budget' and pmo_record_id='definitely-not-a-uuid';

-- ── and the preflight is not a blanket refusal: a recoverable population passes ──────────────────
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('0bfa0000-0000-0000-0000-000000000001','budget','0bfa2222-0000-0000-0000-00000000000d','erpnext','BUDGET-D-2026');

select lives_ok(
  'select public.bfy_migration_0154_rekey()',
  'AC-BFY-020 a RECOVERABLE population (one bare mapping, exactly one mirror year) passes the preflight — the fence refuses ambiguity, not work');

select finish();
rollback;
