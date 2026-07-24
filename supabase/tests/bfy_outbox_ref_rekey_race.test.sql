-- bfy_outbox_ref_rekey_race.test.sql (BFY FU-2, BLOCKER 4) — OWNS the finalize-after-rekey race.
--
-- ⚑ THE RACE 0154's INSERT fence CANNOT see. The budget `BEFORE INSERT` trigger fences new outbox
-- INSERTs while the re-key runs, but FINALIZATION is not an insert into the outbox — it is a call to
-- `record_outbox_ref`, which inserts into `external_refs`. An OLD in-flight binary can:
--   1. insert a BARE budget outbox row (before the migration), commit it, and stay in flight;
--   2. the migration re-keys that outbox row to `<vid>:<encoded_fy>`;
--   3. the old binary completes its ERP call and calls `record_outbox_ref` with its STALE BARE
--      `p_pmo_record_id`.
-- If the RPC trusts the caller's `p_pmo_record_id`, it writes a BARE `external_refs` mapping AFTER the
-- re-key — orphaning the qualified mapping the new identity lookup/create-guard reason from, and leaving
-- a live ERP Budget unreachable by the year-qualified identity.
--
-- The fix (FR-BFY-035): `record_outbox_ref` DERIVES the ref's (domain, pmo_record_id) from the LOCKED
-- outbox row, never from the caller — so the finalized mapping always matches the (re-keyed) command.
--
-- MUTATION (run, not assumed): restore the caller-supplied `p_pmo_record_id`/`p_domain` in the insert
-- (values (v.org_id, p_domain, p_pmo_record_id, …)) → assertions 1 and 2 go red: a stale BARE mapping
-- reappears and the qualified mapping is absent.
begin;
select plan(3);

insert into organizations (id, name) values
  ('0bfc0000-0000-0000-0000-000000000001','BFY Ref-race Org');

insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bfc1111-0000-0000-0000-000000000001','0bfc0000-0000-0000-0000-000000000001','BFY Ref-race Project','Ongoing Project',date '2025-08-01',date '2026-03-31');

insert into budget_versions (id, org_id, project_id, version, name, status, activated_at) values
  ('0bfc2222-0000-0000-0000-000000000001','0bfc0000-0000-0000-0000-000000000001','0bfc1111-0000-0000-0000-000000000001',1,'Pre-issue push','Active',timestamptz '2026-01-16 03:04:05+00');

set local role postgres;

-- PMO's one held fact the year is recovered from (the shipped mirror writer's grain).
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, erp_budget_name, pushed_at) values
  ('0bfc0000-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000001','2025-2026','pushing','BUDGET-RACE-2025-2026-0009',now());

-- The OLD in-flight command: a BARE budget outbox row, already `committed` to ERP but NOT yet finalized
-- (no external_refs row exists yet — the old binary is between its ERP commit and record_outbox_ref).
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, external_record_id, claim_generation) values
  ('0bfc0000-0000-0000-0000-000000000001','budget','0bfc2222-0000-0000-0000-000000000001',
   'bud:0bfc2222-0000-0000-0000-000000000001:1768532645000','erpnext','create','committed','BUDGET-RACE-2025-2026-0009',0);

-- ── the migration re-keys the in-flight outbox row to the year-qualified identity ─────────────────
select public.bfy_migration_0154_rekey();

-- ── the old binary now finalizes with its STALE BARE p_pmo_record_id (the race) ───────────────────
select public.record_outbox_ref(
  (select id from external_command_outbox where domain='budget'),
  0,
  'budget',
  '0bfc2222-0000-0000-0000-000000000001',            -- the STALE bare identity the old binary still holds
  'erpnext',
  'BUDGET-RACE-2025-2026-0009');

-- ── the finalized mapping is QUALIFIED, never a stale bare orphan ─────────────────────────────────
select is(
  (select count(*)::int from external_refs
    where domain='budget' and pmo_record_id='0bfc2222-0000-0000-0000-000000000001'),
  0,
  'BLOCKER 4: a finalize after the re-key must leave NO stale BARE external_refs mapping');

select is(
  (select external_record_id from external_refs
    where domain='budget'
      and pmo_record_id = '0bfc2222-0000-0000-0000-000000000001:' || public.budget_fiscal_year_token('2025-2026')),
  'BUDGET-RACE-2025-2026-0009',
  'BLOCKER 4: the ref is filed under the re-keyed QUALIFIED identity derived from the locked outbox row');

select is(
  (select count(*)::int from external_refs where domain='budget'),
  1,
  'BLOCKER 4: exactly ONE budget mapping exists — the qualified one, never a bare/qualified pair');

select finish();
rollback;
