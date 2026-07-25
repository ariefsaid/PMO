-- outbox_rejection_is_terminal.test.sql
-- BLOCK 3 [pgTAP]: a CLASSIFIED REJECTION must be terminal for AUTOMATIC recovery.
--
-- `failed` was a reconcile candidate with no bound at all, so the sweep re-drove a user-REJECTED money
-- command forever — rebuilding it from the frozen payload and calling `dispatchMoneyWrite` DIRECTLY,
-- i.e. bypassing `checkErpnextCommandAuthorization`, `enforceSiSubmitSod`, `get_process_gates`,
-- `checkTransitionTargetBinding` and `checkCreateTargetUnmapped`. Days later, once whatever ERP-side
-- blocker cleared, the replay SUCCEEDED: an invoice the org decided to keep got cancelled, or a doc the
-- user was told was rejected got minted — with nobody clicking anything.
--
-- The rule (migration 0112): `outbox_reconcile_candidates` never offers
--   • a `transition` (submit/cancel/amend) rejection — it encodes a human decision AT A POINT IN TIME,
--     never a durable intent, so it is NEVER auto-reissued (a human retry via the sync path still can);
--   • a rejection past its attempt budget or its max row age.
-- Rows that involve NO new ERP write (`committed` → finalize-only) keep converging unbounded.
begin;
select plan(12);

insert into organizations (id, name) values
  ('00d10000-0000-0000-0000-000000000001','BLOCK 3 Outbox Terminal Org');

reset role;

-- id suffix ⇒ what it proves.
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, attempt_count, created_at, updated_at)
values
  -- 1: a rejected CANCEL (transition) — never auto-reissued, at any age/attempt count.
  ('00d10000-0000-0000-0000-0000000000f1','00d10000-0000-0000-0000-000000000001','revenue','si-1','k-f1','erpnext','transition','failed',1, now(), now()),
  -- 2: a rejected CREATE within budget + age — still auto-recoverable (the transport-class retry).
  ('00d10000-0000-0000-0000-0000000000f2','00d10000-0000-0000-0000-000000000001','revenue','si-2','k-f2','erpnext','create','failed',1, now(), now()),
  -- 3: a rejected CREATE past the attempt budget — abandoned to an operator.
  ('00d10000-0000-0000-0000-0000000000f3','00d10000-0000-0000-0000-000000000001','revenue','si-3','k-f3','erpnext','create','failed',9, now(), now()),
  -- 4: a rejected CREATE past the max row age — abandoned to an operator.
  ('00d10000-0000-0000-0000-0000000000f4','00d10000-0000-0000-0000-000000000001','revenue','si-4','k-f4','erpnext','create','failed',1, now() - interval '3 days', now() - interval '3 days'),
  -- 5: a stale PENDING create (never claimed, so no ERP doc) past the max age — likewise abandoned.
  ('00d10000-0000-0000-0000-0000000000f5','00d10000-0000-0000-0000-000000000001','revenue','si-5','k-f5','erpnext','create','pending',0, now() - interval '3 days', now() - interval '3 days'),
  -- 6: a fresh PENDING create — the normal crash-recovery candidate.
  ('00d10000-0000-0000-0000-0000000000f6','00d10000-0000-0000-0000-000000000001','revenue','si-6','k-f6','erpnext','create','pending',0, now(), now()),
  -- 7: an OLD `committed` row — finalize-only (mirror + confirm), NO new ERP write ⇒ still a candidate.
  ('00d10000-0000-0000-0000-0000000000f7','00d10000-0000-0000-0000-000000000001','revenue','si-7','k-f7','erpnext','create','committed',1, now() - interval '30 days', now() - interval '30 days'),
  -- 8: a stale `committing` row — must still be offered so the sweep can QUARANTINE it (F1 safety).
  ('00d10000-0000-0000-0000-0000000000f8','00d10000-0000-0000-0000-000000000001','revenue','si-8','k-f8','erpnext','create','committing',1, now() - interval '30 days', now() - interval '10 minutes'),
  -- 9: a `held` row — never a candidate (C-1, unchanged).
  ('00d10000-0000-0000-0000-0000000000f9','00d10000-0000-0000-0000-000000000001','revenue','si-9','k-f9','erpnext','create','held',1, now(), now());

create temporary view cands as
  select id from public.outbox_reconcile_candidates('00d10000-0000-0000-0000-000000000001');

select is((select count(*)::int from cands where id = '00d10000-0000-0000-0000-0000000000f1'), 0,
  'BLOCK 3 a REJECTED transition (submit/cancel/amend) is NEVER an automatic reconcile candidate');
select is((select count(*)::int from cands where id = '00d10000-0000-0000-0000-0000000000f2'), 1,
  'BLOCK 3 a rejected create within the attempt budget and age bound is still recovered');
select is((select count(*)::int from cands where id = '00d10000-0000-0000-0000-0000000000f3'), 0,
  'BLOCK 3 a rejected create past the attempt budget is abandoned to an operator');
select is((select count(*)::int from cands where id = '00d10000-0000-0000-0000-0000000000f4'), 0,
  'BLOCK 3 a rejected create past the max row age is abandoned to an operator');
select is((select count(*)::int from cands where id = '00d10000-0000-0000-0000-0000000000f5'), 0,
  'BLOCK 3 a stale pending create past the max row age is abandoned (never replayed days later)');
select is((select count(*)::int from cands where id = '00d10000-0000-0000-0000-0000000000f6'), 1,
  'BLOCK 3 a fresh pending create is still recovered (the crash-recovery path is intact)');
select is((select count(*)::int from cands where id = '00d10000-0000-0000-0000-0000000000f7'), 1,
  'BLOCK 3 an OLD committed row is still finalized (no new ERP write ⇒ no bound)');
select is((select count(*)::int from cands where id = '00d10000-0000-0000-0000-0000000000f8'), 1,
  'BLOCK 3 a stale committing row is still offered so it can be quarantined (F1 safety preserved)');
select is((select count(*)::int from cands where id = '00d10000-0000-0000-0000-0000000000f9'), 0,
  'BLOCK 3 a held row is still never a candidate (C-1)');

-- Tenancy (F11): the bounds must not leak another org's rows in or out.
insert into organizations (id, name) values ('00d10000-0000-0000-0000-000000000002','BLOCK 3 Other Org');
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
values ('00d10000-0000-0000-0000-0000000000e1','00d10000-0000-0000-0000-000000000002','revenue','si-x','k-e1','erpnext','create','pending');
select is((select count(*)::int from cands where id = '00d10000-0000-0000-0000-0000000000e1'), 0,
  'BLOCK 3 another org''s pending row is never in this org''s candidate set');

-- The SYNCHRONOUS human retry path is deliberately UNCHANGED: a person clicking "try again" may still
-- re-drive their own rejected command (they are making the decision now), so the claim RPC still claims
-- a `failed` row. Only the AUTOMATIC (sweep) path is bounded.
select isnt((select id from public.claim_outbox_for_commit('00d10000-0000-0000-0000-0000000000f1')), null,
  'BLOCK 3 a human retry can still claim a rejected transition (only the sweep is bounded)');
select is((select state from external_command_outbox where id = '00d10000-0000-0000-0000-0000000000f1'), 'committing',
  'BLOCK 3 the human-retry claim transitions the rejected row into the commit critical section');

select finish();
rollback;
