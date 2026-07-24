-- bfy_external_refs_rekey.test.sql (BFY T19) — OWNS AC-BFY-018 (FR-BFY-035, FR-BFY-037).
--
-- ⚑ THE RISKIEST REWRITE IN THE ISSUE. Before this release a budget's outbox/`external_refs` identity
-- was the bare `<budget_version_id>`; from this release it is `<budget_version_id>:<encoded_fiscal_year>`.
-- Each of those rows is PMO's ONLY POINTER to a real `Budget` document on a client's ERP ledger.
--
-- Two ways to get it wrong, both expensive:
--   • LOSE the pointer (re-key to the wrong value, or leave the row bare while the code looks for the
--     year-qualified one) → `checkCreateTargetUnmapped` sees no mapping and lets a `create` through for
--     a project-year ERPNext ALREADY HOLDS → a DUPLICATE budget, with its own overspend controls, on a
--     client's ledger.
--   • RE-CREATE instead of re-keying (insert the new row, leave the old one) → the orphaned bare row
--     still claims the ERP document, and the new row's provenance is manufactured rather than migrated.
-- So the rewrite is IN PLACE (same row, same id, same external_record_id, same epoch), DETERMINISTIC
-- (the year comes from PMO's OWN `budget_version_erp_mirror` row — data PMO already holds, never
-- invented), and it NEVER deletes, replaces or re-creates an ERP object or pointer (FR-BFY-037).
--
-- MUTATION (run, not assumed): SKIP the `external_refs` re-key (leave the row bare) → assertions 1, 2,
-- 3 and 7 go red — and 7 is the money one: the guard oracle resolves NULL, i.e. a duplicate `create`
-- would be ADMITTED for a project-year ERPNext already holds.
-- ⚑ The plan's other suggested mutant — "re-key as a NEW INSERT, leaving the orphan" — turns out to be
-- UNREACHABLE, and that is a finding worth recording rather than a gap: `external_refs` carries a
-- unique (org_id, domain, external_record_id) constraint, so a second mapping to the same ERP document
-- cannot exist at all; the mutant aborts with a duplicate-key error instead of producing the duplicate.
-- Assertion 4 stays as the guard for the residual shape that constraint does NOT forbid (a stale bare
-- row left beside a year-qualified row pointing at a DIFFERENT document).
--
-- Structurally unable to see: the LIVE ERP one-vs-two `Budget` count (AC-BFY-011/031 own that) and the
-- served `checkCreateTargetUnmapped` code path (its own served tests own that — assertion 6 asserts the
-- exact DB predicate that guard reads).
begin;
select plan(12);

insert into organizations (id, name) values
  ('0bfb0000-0000-0000-0000-000000000001','BFY Re-key Org');

insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bfb1111-0000-0000-0000-000000000001','0bfb0000-0000-0000-0000-000000000001','BFY Re-key Project','Ongoing Project',date '2025-08-01',date '2026-03-31');

insert into budget_versions (id, org_id, project_id, version, name, status, activated_at) values
  ('0bfb2222-0000-0000-0000-000000000001','0bfb0000-0000-0000-0000-000000000001','0bfb1111-0000-0000-0000-000000000001',1,'Pre-issue push','Active',timestamptz '2026-01-16 03:04:05+00');

set local role postgres;

-- The pre-release world: a push that SUCCEEDED, recorded by the shipped mirror writer at its
-- (org, budget_version_id, fiscal_year) grain — the ONE PMO-held fact the year is recovered from.
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, erp_budget_name, pushed_at) values
  ('0bfb0000-0000-0000-0000-000000000001','0bfb2222-0000-0000-0000-000000000001','2025-2026','pushed','BUDGET-PSC-2025-2026-0007',now());

-- …its `external_refs` pointer and its finalised outbox command, both keyed on the BARE version id
-- (0088/0096 as they were written before this release; the key is budgetPushKey.ts's 3-segment form).
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('0bfb0000-0000-0000-0000-000000000001','budget','0bfb2222-0000-0000-0000-000000000001','erpnext','BUDGET-PSC-2025-2026-0007');
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, external_record_id) values
  ('0bfb0000-0000-0000-0000-000000000001','budget','0bfb2222-0000-0000-0000-000000000001',
   'bud:0bfb2222-0000-0000-0000-000000000001:1768532645000','erpnext','create','confirmed','BUDGET-PSC-2025-2026-0007');

-- A NON-budget mapping whose pmo_record_id is also a bare uuid — the blast-radius control. Nothing
-- outside the budget domain may be touched by this migration.
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('0bfb0000-0000-0000-0000-000000000001','procurement','0bfb3333-0000-0000-0000-000000000001','erpnext','PUR-ORD-0042');

-- Row identity BEFORE the rewrite, so "in place" is proven by the row's own primary key surviving —
-- not merely by the value looking right afterwards.
create temp table bfy_refs_before on commit drop as
  select id, created_at, external_record_id from external_refs
   where domain='budget' and pmo_record_id='0bfb2222-0000-0000-0000-000000000001';

-- ── the re-key, under the fence ──────────────────────────────────────────────────────────────────
select public.bfy_migration_0154_rekey();

-- ── the pointer is now year-qualified, and it is the SAME ROW ────────────────────────────────────
select is(
  (select count(*)::int from external_refs er join bfy_refs_before b on b.id = er.id
    where er.pmo_record_id = '0bfb2222-0000-0000-0000-000000000001:' || public.budget_fiscal_year_token('2025-2026')
      and er.external_record_id = b.external_record_id
      and er.created_at = b.created_at),
  1,
  'AC-BFY-018 the mapping is re-keyed IN PLACE — same row (same id, same created_at) now carrying <vid>:<encoded-fy>, still pointing at the SAME ERP Budget');

select is(
  (select external_record_id from external_refs
    where domain='budget' and pmo_record_id='0bfb2222-0000-0000-0000-000000000001'),
  null,
  'AC-BFY-018 the BARE identity resolves nothing afterwards — the old key is gone, not duplicated');

select is(
  (select external_record_id from external_refs
    where domain='budget'
      and pmo_record_id = '0bfb2222-0000-0000-0000-000000000001:' || public.budget_fiscal_year_token('2025-2026')),
  'BUDGET-PSC-2025-2026-0007',
  'AC-BFY-018 …and the year-qualified identity resolves the SAME external_record_id — the ERP pointer is migrated, never re-created');

select is(
  (select count(*)::int from external_refs where domain='budget'),
  1,
  'AC-BFY-018 exactly ONE budget mapping exists — a re-key that INSERTED a new row and left the orphan would read 2 (the mutation this assertion exists for)');

-- ── the outbox row carries the year and KEEPS its epoch ──────────────────────────────────────────
select is(
  (select pmo_record_id from external_command_outbox where domain='budget'),
  '0bfb2222-0000-0000-0000-000000000001:' || public.budget_fiscal_year_token('2025-2026'),
  'AC-BFY-018 the outbox row is re-keyed to the same year-qualified identity, so one-in-flight/uniqueness now scope PER YEAR');

select is(
  (select idempotency_key from external_command_outbox where domain='budget'),
  'bud:0bfb2222-0000-0000-0000-000000000001:' || public.budget_fiscal_year_token('2025-2026') || ':1768532645000',
  'AC-BFY-018 the idempotency key gains the year component and KEEPS its original epoch — a fresh epoch would be a different command, not this one migrated');

-- ── the guard predicate: a subsequent `create` for <vid>:<fy> is BLOCKED ─────────────────────────
-- This is the exact lookup `transitionTargetGuard.checkCreateTargetUnmapped` performs before admitting
-- a `create`: a non-NULL mapping for (org, domain='budget', the year-qualified pmo_record_id) means the
-- record is already mapped and the create is refused. Non-NULL here == duplicate refused there.
select isnt(
  (select external_record_id from external_refs
    where org_id='0bfb0000-0000-0000-0000-000000000001' and domain='budget'
      and pmo_record_id = '0bfb2222-0000-0000-0000-000000000001:' || public.budget_fiscal_year_token('2025-2026')),
  null,
  'AC-BFY-018 a re-activation resolves the RETAINED mapping under the new identity, so the create-guard blocks a duplicate Budget for a project-year ERPNext already holds (FR-BFY-037)');

-- ── what the migration must NOT touch ────────────────────────────────────────────────────────────
select is(
  (select pmo_record_id from external_refs where domain='procurement'),
  '0bfb3333-0000-0000-0000-000000000001',
  'AC-BFY-018 a NON-budget mapping with a bare-uuid pmo_record_id is untouched — the re-key is domain-scoped');

select is(
  (select budget_version_id::text from budget_version_erp_mirror where budget_version_id='0bfb2222-0000-0000-0000-000000000001'),
  '0bfb2222-0000-0000-0000-000000000001',
  'AC-BFY-018 the mirror FK stays the BARE uuid — only the outbox/external_refs identity is year-qualified (FENCE 5)');

select is(
  (select fiscal_year from budget_version_erp_mirror where budget_version_id='0bfb2222-0000-0000-0000-000000000001'),
  '2025-2026',
  'AC-BFY-018 the mirror row and its recorded fiscal year are RETAINED — the migration reads them, it never rewrites or replaces them (FR-BFY-037)');

-- ── the fence (FR-BFY-035a) ─────────────────────────────────────────────────────────────────────
-- ⚑ WHAT THIS PROVES AND WHAT IT HONESTLY CANNOT. The fence is: the re-key holds the EXCLUSIVE half
-- of an advisory lock for its whole transaction, and every budget outbox INSERT must first obtain the
-- SHARED half — so while the re-key runs, no other session can land a bare `pmo_record_id` after the
-- rewrite. The two halves are asserted here. The cross-session REFUSAL itself cannot be observed from
-- pgTAP: advisory locks are per-session, a test runs in ONE session (where the two halves do not
-- conflict), and `dblink` cannot open a second one (the local `postgres` role is not a superuser and
-- loopback auth is `trust`, which dblink refuses). It follows from Postgres' documented advisory-lock
-- semantics given the two facts asserted below — and deploy-time quiescence, not this lock, remains
-- the PRIMARY mechanism (the release runbook owns that).
select is(
  (select count(*)::int from pg_locks
    where locktype = 'advisory' and mode = 'ExclusiveLock' and pid = pg_backend_pid()
      and classid = ((hashtext('pmo_budget_identity_rekey')::bigint >> 32) & 4294967295)::oid
      and objid   = ((hashtext('pmo_budget_identity_rekey')::bigint) & 4294967295)::oid),
  1,
  'AC-BFY-018 the re-key holds the EXCLUSIVE pmo_budget_identity_rekey advisory lock for its whole transaction');

select is(
  (select count(*)::int from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_proc p on p.oid = t.tgfoid
    where c.relname = 'external_command_outbox'
      and t.tgname = 'enforce_budget_identity_rekey_fence'
      and not t.tgisinternal
      and p.prosrc like '%pg_try_advisory_xact_lock_shared(hashtext(''pmo_budget_identity_rekey''))%'),
  1,
  'AC-BFY-018 …and every budget outbox INSERT must first take the SHARED half of that same lock — the fence old and new code alike must pass through');

select finish();
rollback;
