-- external_command_outbox_rls.test.sql
-- AC-ENA-012 [pgTAP]: the money-idempotency outbox (ADR-0058). Mirrors the external_refs_rls.test.sql
-- idiom: unique 4-tuple duplicate-insert rejection, org-isolated SELECT, service-role-only write, the
-- 'committing'/'quarantined' states, and — the review's critical case — the atomic commit claim is
-- at-most-once, the F1 quarantine of a stale committing row (never a blind re-POST) resolved only after
-- its reconcile_after window, the claim_generation fencing-token proof that a stale claimant's write-back
-- is discarded (F4), and the function-privilege proof that the outbox RPCs are service_role-only.
-- AC-SAR-012 extension: the unique 4-tuple constraint also covers the 'revenue' domain.
begin;
select plan(44);

insert into organizations (id, name) values
  ('00950000-0000-0000-0000-000000000001','AC-ENA Outbox A'),
  ('00950000-0000-0000-0000-000000000002','AC-ENA Outbox B'),
  ('005c0000-0000-0000-0000-000000000001','AC-SAR Outbox Revenue');
insert into auth.users (id, email) values
  ('00950000-0000-0000-0000-0000000000a1','outbox-a@example.com'),
  ('00950000-0000-0000-0000-0000000000b1','outbox-b@example.com'),
  ('005c0000-0000-0000-0000-0000000000a1','sar-outbox@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00950000-0000-0000-0000-0000000000a1','00950000-0000-0000-0000-000000000001','A','outbox-a@example.com','Admin','active'),
  ('00950000-0000-0000-0000-0000000000b1','00950000-0000-0000-0000-000000000002','B','outbox-b@example.com','Admin','active'),
  ('005c0000-0000-0000-0000-0000000000a1','005c0000-0000-0000-0000-000000000001','SAR Outbox','sar-outbox@example.com','Admin','active');

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

-- AC-SAR-012: same unique 4-tuple constraint also covers the 'revenue' domain.
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
values ('005c0000-0000-0000-0000-0000000000c1','005c0000-0000-0000-0000-000000000001','revenue','pmo-rev-1','key-rev-1','erpnext','create','pending');
select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
       values ('005c0000-0000-0000-0000-000000000001','revenue','pmo-rev-1','key-rev-1','erpnext','create','pending') $$,
  '23505', null,
  'AC-SAR-012 the unique (org,domain,pmo_record_id,idempotency_key) 4-tuple rejects duplicate insert for revenue domain');
-- A re-command under a different idempotency_key is admitted only once the previous row reaches a
-- TERMINAL state (0116/B3: at most one NON-TERMINAL row per record — two in-flight rows for one record
-- are the duplicate-money race, proven in outbox_serialization.test.sql). Confirm the first, then
-- re-command.
update external_command_outbox set state='confirmed' where id='005c0000-0000-0000-0000-0000000000c1';
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
values ('005c0000-0000-0000-0000-0000000000c2','005c0000-0000-0000-0000-000000000001','revenue','pmo-rev-1','key-rev-2','erpnext','create','pending');
select is((select count(*)::int from external_command_outbox where pmo_record_id='pmo-rev-1' and org_id='005c0000-0000-0000-0000-000000000001'), 2,
  'AC-SAR-012 a different idempotency_key for the same pmo_record_id succeeds once the previous row is terminal (re-command allowed)');

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

-- CONCURRENCY NOTE (mirrors 0134_reserve_credits.test.sql's documented approach): claim_outbox_for_commit
-- is a conditional UPDATE under Postgres' row lock. Two TRULY concurrent claims on the same id serialize
-- on that lock — the loser blocks until the winner's txn commits, then re-evaluates its WHERE against the
-- winner's committed row (now state='committing') and matches 0 rows → NULL. So concurrent reduces to the
-- SAME worst case these SEQUENTIAL assertions prove. A live two-connection test would assert the same
-- outcome; pgTAP cannot open a second connection (its whole run is one rolled-back txn, and dblink for the
-- non-superuser `postgres` role is password-gated in this env — 0134 §CONCURRENCY NOTE), so the sequential
-- proof + the row-lock's design is the owner (identical to how 0134 owns the reserve-credits race).

-- The atomic claim is at-most-once: two successive claims on the same pending row — the first wins
-- (committing, claim_generation=1), the second returns NULL (already committing, fresh updated_at) —
-- proving two concurrent reconcilers cannot both win the POST critical section (the review's critical case).
select is(
  (select claim_generation from public.claim_outbox_for_commit('00950000-0000-0000-0000-0000000000c1')),
  1,
  'AC-ENA-012 the first claim wins: state->committing, claim_generation bumps to 1');
select is(
  (select v is null from public.claim_outbox_for_commit('00950000-0000-0000-0000-0000000000c1') v),
  true,
  'AC-ENA-012 a second immediate claim on the same (fresh-committing) row returns NULL (no double-win)');

-- F1 quarantine (the in-flight-POST-overlap fix): a STALE (past-lease) committing row is NOT claimable
-- via claim_outbox_for_commit — a blind reclaim+re-POST could duplicate a money doc whose ERP write is
-- still in flight. It must be QUARANTINED first, then resolved only after the reconcile_after window.
update external_command_outbox set updated_at = now() - interval '61 seconds' where id = '00950000-0000-0000-0000-0000000000c1';
select is(
  (select v is null from public.claim_outbox_for_commit('00950000-0000-0000-0000-0000000000c1') v),
  true,
  'AC-ENA-012 F1: a stale (past-lease) committing row is NOT reclaimable via claim_outbox_for_commit (returns NULL — never a blind re-POST)');
-- quarantine_committing transitions the stale committing row → quarantined, bumps the fencing token to 2,
-- and sets the visibility window.
select is(
  (select state from public.quarantine_committing('00950000-0000-0000-0000-0000000000c1')),
  'quarantined',
  'AC-ENA-012 F1: quarantine_committing transitions a stale committing row -> quarantined');
select is(
  (select claim_generation from external_command_outbox where id = '00950000-0000-0000-0000-0000000000c1'),
  2,
  'AC-ENA-012 F1: quarantine bumps claim_generation to 2 (fences the stale claimant)');
-- Within its window a quarantined row is NOT claimable (the in-flight POST may still land).
select is(
  (select v is null from public.claim_outbox_for_commit('00950000-0000-0000-0000-0000000000c1') v),
  true,
  'AC-ENA-012 F1: a quarantined row WITHIN its reconcile_after window is NOT claimable (returns NULL)');
-- After the window elapses the reconciliation path may claim it (probe -> adopt-or-reissue); gen -> 3.
update external_command_outbox set reconcile_after = now() - interval '1 second' where id = '00950000-0000-0000-0000-0000000000c1';
select is(
  (select claim_generation from public.claim_outbox_for_commit('00950000-0000-0000-0000-0000000000c1')),
  3,
  'AC-ENA-012 F1: after the window elapses the quarantined row IS claimable; claim_generation is monotonic (bumps to 3)');

-- Fencing-token proof (F4): a guarded write-back with the STALE token (1) affects 0 rows while the CURRENT
-- token (3) affects 1. A data-modifying WITH must be the top-level statement (Postgres restriction) — it
-- cannot be nested inside is()'s function-call argument; capture each affected row count into a temp table.
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
      where id = '00950000-0000-0000-0000-0000000000c1' and claim_generation = 3
      returning 1
  ) select count(*)::int as n from x;
select is((select n from _current_writeback), 1,
  'AC-ENA-012 the same guarded write-back with the CURRENT claim_generation (3) affects 1 row');
drop table _current_writeback;

-- Function-privilege proof (F4 review): the three outbox RPCs are SECURITY DEFINER over a policy-less
-- table — they MUST be executable by service_role only, never by an ordinary user-JWT role (who could
-- otherwise claim/quarantine/enumerate another org's outbox row, since the bodies trust p_id/p_org_id).
reset role;
select ok(not has_function_privilege('authenticated', 'public.claim_outbox_for_commit(uuid, interval)', 'execute'),
  'AC-ENA-012 authenticated CANNOT execute claim_outbox_for_commit (service_role-only)');
select ok(not has_function_privilege('authenticated', 'public.quarantine_committing(uuid, interval, interval)', 'execute'),
  'AC-ENA-012 authenticated CANNOT execute quarantine_committing (service_role-only)');
select ok(not has_function_privilege('authenticated', 'public.outbox_reconcile_candidates(uuid)', 'execute'),
  'AC-ENA-012 authenticated CANNOT execute outbox_reconcile_candidates (service_role-only)');
select ok(not has_function_privilege('anon', 'public.claim_outbox_for_commit(uuid, interval)', 'execute'),
  'AC-ENA-012 anon CANNOT execute claim_outbox_for_commit (service_role-only)');
-- ...and a live authenticated call is denied at runtime (42501), not merely absent from the grant table.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select public.claim_outbox_for_commit('00950000-0000-0000-0000-0000000000c1') $$,
  '42501', null,
  'AC-ENA-012 an authenticated user-JWT call to claim_outbox_for_commit is denied (42501)');
select throws_ok(
  $$ select public.quarantine_committing('00950000-0000-0000-0000-0000000000c1') $$,
  '42501', null,
  'AC-ENA-012 an authenticated user-JWT call to quarantine_committing is denied (42501)');
select throws_ok(
  $$ select * from public.outbox_reconcile_candidates('00950000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'AC-ENA-012 an authenticated user-JWT call to outbox_reconcile_candidates is denied (42501)');
reset role;

-- ── H-1 (finalization TOCTOU fix): record_outbox_ref (fenced ref upsert, state stays committed) →
-- mirror (caller) → confirm_outbox (fenced committed→confirmed). A superseded claimant's ref+confirm
-- are BOTH 0-row no-ops (the ENTIRE finalization no-ops); only the current claim_generation on a
-- still-`committed` row may write. Keeping confirm separate/last is what lets a crash-before-mirror
-- leave the row `committed` so the retry re-mirrors (finalize-only, AC-ENA-010).
reset role;
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, external_record_id, claim_generation)
values ('00950000-0000-0000-0000-0000000000c2','00950000-0000-0000-0000-000000000001','procurement','pmo-fin','key-fin','erpnext','create','committed','PI-9',5);

-- Superseded generation (4 ≠ current 5): the ref write returns 0 and persists nothing; the confirm too.
select is((select public.record_outbox_ref('00950000-0000-0000-0000-0000000000c2', 4, 'procurement','pmo-fin','erpnext','PI-9')), 0,
  'H-1 record_outbox_ref with a SUPERSEDED claim_generation returns 0 (fenced)');
select is((select count(*)::int from external_refs where org_id='00950000-0000-0000-0000-000000000001' and pmo_record_id='pmo-fin'), 0,
  'H-1 a superseded ref write wrote NO external_refs row (ref write is fenced)');
select is((select public.confirm_outbox('00950000-0000-0000-0000-0000000000c2', 4)), 0,
  'H-1 confirm_outbox with a SUPERSEDED claim_generation returns 0 (fenced)');
select is((select state from external_command_outbox where id='00950000-0000-0000-0000-0000000000c2'), 'committed',
  'H-1 a superseded finalization left the row committed (not confirmed)');

-- Current generation on a committed row: ref written (state STAYS committed), then confirm promotes it.
select is((select public.record_outbox_ref('00950000-0000-0000-0000-0000000000c2', 5, 'procurement','pmo-fin','erpnext','PI-9')), 1,
  'H-1 record_outbox_ref with the CURRENT claim_generation returns 1');
select is((select external_record_id from external_refs where org_id='00950000-0000-0000-0000-000000000001' and domain='procurement' and pmo_record_id='pmo-fin'), 'PI-9',
  'H-1 record_outbox_ref upserted the external_refs mapping (fenced, moved in-RPC)');
select is((select state from external_command_outbox where id='00950000-0000-0000-0000-0000000000c2'), 'committed',
  'H-1 the ref write leaves the row committed (the mirror write sits before the separate confirm)');
select is((select public.confirm_outbox('00950000-0000-0000-0000-0000000000c2', 5)), 1,
  'H-1 confirm_outbox promotes committed→confirmed for the current token');
select is((select state from external_command_outbox where id='00950000-0000-0000-0000-0000000000c2'), 'confirmed',
  'H-1 the outbox row is confirmed after confirm_outbox');
-- Idempotent replay: confirming an already-confirmed row is a 0-row no-op (state check excludes confirmed).
select is((select public.confirm_outbox('00950000-0000-0000-0000-0000000000c2', 5)), 0,
  'H-1 re-confirming an already-confirmed row returns 0 (committed→confirmed is one-shot)');

-- ── C-1 (PE mutable anchor): the 'held' recovery-inconclusive terminal + its fenced transition.
reset role;
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, claim_generation)
values ('00950000-0000-0000-0000-0000000000c3','00950000-0000-0000-0000-000000000001','procurement','pmo-held','key-held','erpnext','create','committing',7);
-- The state CHECK accepts 'held' (a direct set succeeds).
update external_command_outbox set state='held' where id='00950000-0000-0000-0000-0000000000c3';
select is((select state from external_command_outbox where id='00950000-0000-0000-0000-0000000000c3'), 'held',
  'C-1 the state CHECK accepts the held recovery-inconclusive terminal');
update external_command_outbox set state='committing' where id='00950000-0000-0000-0000-0000000000c3';
-- mark_outbox_held fences on claim_generation: a stale token no-ops.
select is((select public.mark_outbox_held('00950000-0000-0000-0000-0000000000c3', 6, 'pe-inconclusive-absence')), 0,
  'C-1 mark_outbox_held with a STALE claim_generation returns 0 (fenced)');
select is((select state from external_command_outbox where id='00950000-0000-0000-0000-0000000000c3'), 'committing',
  'C-1 a fenced-out mark_outbox_held left the row committing');
-- The current token holds it (records the reason for ops visibility).
select is((select public.mark_outbox_held('00950000-0000-0000-0000-0000000000c3', 7, 'pe-inconclusive-absence')), 1,
  'C-1 mark_outbox_held with the CURRENT claim_generation on a committing row returns 1');
select is((select state || '|' || last_error from external_command_outbox where id='00950000-0000-0000-0000-0000000000c3'), 'held|pe-inconclusive-absence',
  'C-1 mark_outbox_held transitions committing→held and records the reason (ops-queryable)');
-- A held row is NEVER an auto-reconcile candidate (an operator resolves it — never auto-reissued).
select is((select count(*)::int from public.outbox_reconcile_candidates('00950000-0000-0000-0000-000000000001') where id='00950000-0000-0000-0000-0000000000c3'), 0,
  'C-1 a held row is excluded from outbox_reconcile_candidates (never auto-reissued)');

-- Function-privilege: the new RPCs are service_role-only (SECURITY DEFINER over the policy-less outbox).
reset role;
select ok(not has_function_privilege('authenticated', 'public.record_outbox_ref(uuid, int, text, text, text, text)', 'execute'),
  'H-1 authenticated CANNOT execute record_outbox_ref (service_role-only)');
select ok(not has_function_privilege('authenticated', 'public.confirm_outbox(uuid, int)', 'execute'),
  'H-1 authenticated CANNOT execute confirm_outbox (service_role-only)');
select ok(not has_function_privilege('authenticated', 'public.mark_outbox_held(uuid, int, text)', 'execute'),
  'C-1 authenticated CANNOT execute mark_outbox_held (service_role-only)');

select finish();
rollback;
