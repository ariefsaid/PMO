-- external_command_outbox_rls.test.sql
-- AC-ENA-012 [pgTAP]: the money-idempotency outbox (ADR-0057). Mirrors the external_refs_rls.test.sql
-- idiom: unique 4-tuple duplicate-insert rejection, org-isolated SELECT, service-role-only write, the
-- 'committing' state, and — the review's critical case — the atomic commit claim is at-most-once, plus
-- the claim_generation fencing-token proof that a stale claimant's write-back is discarded (F4).
begin;
select plan(12);

insert into organizations (id, name) values
  ('00950000-0000-0000-0000-000000000001','AC-ENA Outbox A'),
  ('00950000-0000-0000-0000-000000000002','AC-ENA Outbox B');
insert into auth.users (id, email) values
  ('00950000-0000-0000-0000-0000000000a1','outbox-a@example.com'),
  ('00950000-0000-0000-0000-0000000000b1','outbox-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00950000-0000-0000-0000-0000000000a1','00950000-0000-0000-0000-000000000001','A','outbox-a@example.com','Admin','active'),
  ('00950000-0000-0000-0000-0000000000b1','00950000-0000-0000-0000-000000000002','B','outbox-b@example.com','Admin','active');

-- Seed as OWNER (the dispatch service-role path; bypasses RLS).
reset role;
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
values ('00950000-0000-0000-0000-0000000000c1','00950000-0000-0000-0000-000000000001','procurement','pmo-1','key-1','erpnext','create','pending');

-- Unique 4-tuple: a concurrent duplicate INSERT (same org, domain, pmo_record_id, idempotency_key) fails atomically.
select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
       values ('00950000-0000-0000-0000-000000000001','procurement','pmo-1','key-1','erpnext','create','pending') $$,
  '23505', null,
  'AC-ENA-012 the unique (org,domain,pmo_record_id,idempotency_key) 4-tuple rejects a concurrent duplicate insert');

-- Org-isolated SELECT.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from external_command_outbox), 1,
  'AC-ENA-012 org-A member reads own-org outbox row');
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from external_command_outbox), 0,
  'AC-ENA-012 org-B member reads nothing of org-A outbox rows (org isolation)');

-- Service-role-only write.
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
       values ('00950000-0000-0000-0000-000000000001','procurement','pmo-2','key-2','erpnext','create','pending') $$,
  '42501', null,
  'AC-ENA-012 user-JWT INSERT denied (machine-written only)');
select throws_ok(
  $$ update external_command_outbox set state='failed' $$,
  '42501', null,
  'AC-ENA-012 user-JWT UPDATE denied (machine-written only)');

-- The state CHECK includes the 'committing' claim state.
reset role;
update external_command_outbox set state = 'committing' where id = '00950000-0000-0000-0000-0000000000c1';
select is((select state from external_command_outbox where id = '00950000-0000-0000-0000-0000000000c1'), 'committing',
  'AC-ENA-012 the state CHECK accepts the committing claim state');
select throws_ok(
  $$ update external_command_outbox set state='bogus' where id = '00950000-0000-0000-0000-0000000000c1' $$,
  '23514', null,
  'AC-ENA-012 the state CHECK rejects an unlisted state');
update external_command_outbox set state = 'pending' where id = '00950000-0000-0000-0000-0000000000c1';

-- The atomic claim is at-most-once (the review's critical case): two successive claims on the same
-- pending row — the first wins (committing, claim_generation=1), the second returns NULL (already
-- committing, fresh updated_at) — proving two concurrent reconcilers cannot both win the POST section.
select is(
  (select claim_generation from public.claim_outbox_for_commit('00950000-0000-0000-0000-0000000000c1')),
  1,
  'AC-ENA-012 the first claim wins: state->committing, claim_generation bumps to 1');
select is(
  (select v is null from public.claim_outbox_for_commit('00950000-0000-0000-0000-0000000000c1') v),
  true,
  'AC-ENA-012 a second immediate claim on the same (fresh-committing) row returns NULL (no double-win)');

-- Fencing-token proof (F4): backdate past the lease, re-claim (generation bumps to 2, monotonic), then
-- prove a guarded write-back with the STALE token (1) affects 0 rows while the CURRENT token (2) affects 1.
update external_command_outbox set updated_at = now() - interval '61 seconds' where id = '00950000-0000-0000-0000-0000000000c1';
select is(
  (select claim_generation from public.claim_outbox_for_commit('00950000-0000-0000-0000-0000000000c1')),
  2,
  'AC-ENA-012 a stale (past-lease) committing row is reclaimable; claim_generation is monotonic (bumps to 2)');
-- A data-modifying WITH must be the top-level statement (Postgres restriction) — it cannot be nested
-- inside is()'s function-call argument. Capture each guarded write-back's affected row count into a
-- temp table as its own top-level statement, then assert on that.
create temporary table _stale_writeback as
  with x as (
    update external_command_outbox set state='committed'
      where id = '00950000-0000-0000-0000-0000000000c1' and claim_generation = 1
      returning 1
  ) select count(*)::int as n from x;
select is((select n from _stale_writeback), 0,
  'AC-ENA-012 a guarded write-back with the STALE claim_generation (1) affects 0 rows (discarded)');
drop table _stale_writeback;

create temporary table _current_writeback as
  with x as (
    update external_command_outbox set state='committed'
      where id = '00950000-0000-0000-0000-0000000000c1' and claim_generation = 2
      returning 1
  ) select count(*)::int as n from x;
select is((select n from _current_writeback), 1,
  'AC-ENA-012 the same guarded write-back with the CURRENT claim_generation (2) affects 1 row');
drop table _current_writeback;

select finish();
rollback;
