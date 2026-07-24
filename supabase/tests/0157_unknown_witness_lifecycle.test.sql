-- 0157_unknown_witness_lifecycle.test.sql
-- AC-OBX-066 (Luna FU-1a round-8 BLOCK, the durability half) — `post_submit_unknown_at` is a WITNESS,
-- not a status field: once PMO has lost track of what ERPNext holds for a week, only a FACT can clear it.
--
-- ⚑ WHY A TRIGGER AND NOT WRITER DISCIPLINE. The whole BLOCK was one writer (`release_outbox_hold`)
-- clearing a fence as a side effect of answering a different question. Four independent writers touch
-- this mirror (the dispatch success path, the failure/held recorder, the sweep's park, the ERP feed) and
-- a fifth is one symmetry away; "every writer remembers not to clear it" is exactly the narrative
-- guarantee this round is about. So the rule is enforced in the database, and this file is its oracle:
--   (1) a plain UPDATE that nulls the witness is a NO-OP — the witness is sticky;
--   (2) learning a REAL `ts_number` clears it — the question ("does ERP hold a document?") is answered;
--   (3) a later unknown does NOT move the timestamp — it records when PMO FIRST lost track;
--   (4) the audited Admin attestation clears it, and refuses when there is nothing to attest.
begin;
select plan(8);

insert into organizations (id, name) values
  ('01571000-0000-0000-0000-00000000000a','Witness Lifecycle Org');
insert into auth.users (id, email) values
  ('01571000-0000-0000-0000-0000000000a1','wl-owner@example.com'),
  ('01571000-0000-0000-0000-0000000000a3','wl-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01571000-0000-0000-0000-0000000000a1','01571000-0000-0000-0000-00000000000a',
   'Owner W','wl-owner@example.com','Engineer', null),
  ('01571000-0000-0000-0000-0000000000a3','01571000-0000-0000-0000-00000000000a',
   'Admin W','wl-admin@example.com','Admin', null);
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01571000-0000-0000-0000-000000000010','01571000-0000-0000-0000-00000000000a',
   '01571000-0000-0000-0000-0000000000a1','2026-06-01','Approved','01571000-0000-0000-0000-0000000000a3', now()),
  ('01571000-0000-0000-0000-000000000020','01571000-0000-0000-0000-00000000000a',
   '01571000-0000-0000-0000-0000000000a1','2026-06-08','Approved','01571000-0000-0000-0000-0000000000a3', now()),
  ('01571000-0000-0000-0000-000000000030','01571000-0000-0000-0000-00000000000a',
   '01571000-0000-0000-0000-0000000000a1','2026-06-15','Approved','01571000-0000-0000-0000-0000000000a3', now());

insert into timesheet_erp_mirror (org_id, timesheet_id, push_state, push_error, post_submit_unknown_at) values
  ('01571000-0000-0000-0000-00000000000a','01571000-0000-0000-0000-000000000010','failed',
   'command-held: the recovery probe failed deterministically','2026-06-02 10:00:00+00'),
  ('01571000-0000-0000-0000-00000000000a','01571000-0000-0000-0000-000000000020','failed',
   'command-held: the recovery probe failed deterministically','2026-06-09 10:00:00+00'),
  ('01571000-0000-0000-0000-00000000000a','01571000-0000-0000-0000-000000000030','failed',
   'command-held: the recovery probe failed deterministically','2026-06-16 10:00:00+00');

-- ── (1) STICKY: a plain UPDATE cannot silently clear the witness ─────────────────────────────────
-- This runs as the table OWNER (the strongest writer there is; the service-role edge functions are
-- weaker). If the fence can be cleared by a writer that answered a different question, it is not a fence.
update timesheet_erp_mirror
   set push_state = 'failed', push_error = 'released by operator', post_submit_unknown_at = null
 where timesheet_id = '01571000-0000-0000-0000-000000000010';
select is(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '01571000-0000-0000-0000-000000000010'),
  '2026-06-02 10:00:00+00'::timestamptz,
  'AC-OBX-066(1): a plain UPDATE nulling the witness is a NO-OP — only a learned document or an audited attestation clears it');

-- ── (3) FIRST-OBSERVED WINS: a later unknown does not restamp ────────────────────────────────────
update timesheet_erp_mirror
   set post_submit_unknown_at = '2026-07-01 10:00:00+00'
 where timesheet_id = '01571000-0000-0000-0000-000000000010';
select is(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '01571000-0000-0000-0000-000000000010'),
  '2026-06-02 10:00:00+00'::timestamptz,
  'AC-OBX-066(3): the witness records when PMO FIRST lost track — a later unknown does not move it');

-- ── (2) A LEARNED DOCUMENT ANSWERS THE QUESTION ──────────────────────────────────────────────────
update timesheet_erp_mirror
   set push_state = 'pushed', ts_number = 'TS-2026-00042', pushed_at = now()
 where timesheet_id = '01571000-0000-0000-0000-000000000020';
select is(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '01571000-0000-0000-0000-000000000020'),
  null,
  'AC-OBX-066(2): learning a REAL ts_number clears the witness — PMO now knows exactly what ERPNext holds');

-- And an EMPTY-sheet success (`pushed` with NO ts_number, FR-TSP-056) does NOT: it proves a later
-- generation had nothing to send, not that the earlier unknown document is absent.
update timesheet_erp_mirror
   set push_state = 'pushed', pushed_at = now()
 where timesheet_id = '01571000-0000-0000-0000-000000000030';
select isnt(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '01571000-0000-0000-0000-000000000030'),
  null,
  'AC-OBX-066(2): a `pushed` with NO document number does NOT clear it — that outcome learned nothing about ERPNext either');

-- ── (4) THE AUDITED ATTESTATION ──────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01571000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ select attest_timesheet_no_erp_document('01571000-0000-0000-0000-000000000020','nothing there') $$,
  'P0001', 'timesheet has no unknown ERP outcome to attest',
  'AC-OBX-066(4): attesting a sheet with NO unknown outcome is refused — an attestation is evidence, not a no-op');
select lives_ok(
  $$ select attest_timesheet_no_erp_document('01571000-0000-0000-0000-000000000010',
       'ERPNext Timesheet list for this employee/week is empty') $$,
  'AC-OBX-066(4): the Admin attests');

-- Read the audit row while STILL the Admin: `audit_events` is FORCE-RLS + Admin-scoped (0076), so the
-- owner role reads zero rows there by design.
select is(
  (select count(*)::int from audit_events
    where action = 'attest_timesheet_no_erp_document'
      and entity_id = '01571000-0000-0000-0000-000000000010'),
  1,
  'AC-OBX-066(4): and it is AUDITED — a human asserted a fact about the external system, and the row says who and why');
reset role;

select is(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '01571000-0000-0000-0000-000000000010'),
  null,
  'AC-OBX-066(4): the attestation clears the witness');

select * from finish();
rollback;
