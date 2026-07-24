-- 0157_held_recorder_fails_closed.test.sql
-- AC-OBX-067 (Luna FU-1a round-8, SHOULD-FIX S2 + S3) — on the MIRROR fence, `failed` is the PERMISSIVE
-- state, so "fails closed to `failed`" was fail-OPEN. Both holes are in `record_timesheet_command_held`.
--
-- ⚑ S2 — AN UNLOCATABLE OUTBOX ROW IS NOT AN OUTCOME. The round-7 CAS records `failed` on every miss,
-- including when it cannot find the row AT ALL (a lost marker ⇒ `p_outbox_id is null`, or a deleted
-- row). A miss on a row that EXISTS is a real, audited event (a release or a reclaim bumped the
-- generation) and `failed` is the honest record of it. A miss on a row that does not exist is a BUG in
-- the marker threading — and it must not downgrade the fence: the outcome being recorded is still a
-- `command-held`, i.e. ERPNext may hold a document. So it records the RESTRICTIVE state (`held`) plus
-- the durable unknown witness, and says in `push_error` that the identity was lost.
--
-- ⚑ S3 — THE NULL-WITNESS ESCAPE ADMITTED A PROVEN-STALE WRITER. The conflict guard let ANY writer
-- overwrite a row whose `approved_at_pushed` is NULL — and the sweep's park creates exactly those rows
-- (`parkTimesheetMirrorRow`'s absent-branch insert names no witness). So on precisely the rows the
-- sweep writes, "a stale writer's `failed` is a no-op against a newer generation" was false: a released
-- writer could downgrade the sweep's `held` park to `failed` and re-open the correction path.
-- With an unknown existing generation, only a writer whose CAS actually MATCHED may overwrite.
begin;
select plan(6);

insert into organizations (id, name) values
  ('01572000-0000-0000-0000-00000000000a','Fail Closed Org');
insert into auth.users (id, email) values
  ('01572000-0000-0000-0000-0000000000a1','fc-owner@example.com'),
  ('01572000-0000-0000-0000-0000000000a3','fc-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01572000-0000-0000-0000-0000000000a1','01572000-0000-0000-0000-00000000000a',
   'Owner F','fc-owner@example.com','Engineer', null),
  ('01572000-0000-0000-0000-0000000000a3','01572000-0000-0000-0000-00000000000a',
   'Admin F','fc-admin@example.com','Admin', null);
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01572000-0000-0000-0000-000000000010','01572000-0000-0000-0000-00000000000a',
   '01572000-0000-0000-0000-0000000000a1','2026-06-01','Approved','01572000-0000-0000-0000-0000000000a3','2026-06-08 09:00:00+00'),
  ('01572000-0000-0000-0000-000000000020','01572000-0000-0000-0000-00000000000a',
   '01572000-0000-0000-0000-0000000000a1','2026-06-08','Approved','01572000-0000-0000-0000-0000000000a3','2026-06-15 09:00:00+00');

-- ══ S2 — a held outcome with NO locatable outbox row records `held`, not `failed` ═════════════════
select is(
  (select record_timesheet_command_held(
     '01572000-0000-0000-0000-00000000000a','01572000-0000-0000-0000-000000000010',
     '2026-06-08 09:00:00+00',
     'command-held: the recovery probe failed deterministically',
     null, null)),
  'held',
  'AC-OBX-067-S2: a held outcome whose outbox identity was LOST records `held` — the restrictive state — never the permissive `failed`');

select isnt(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '01572000-0000-0000-0000-000000000010'),
  null,
  'AC-OBX-067-S2: and it stamps the unknown witness — a lost marker never loses the fact that ERP may hold a document');

select ok(
  (select push_error from timesheet_erp_mirror where timesheet_id = '01572000-0000-0000-0000-000000000010')
    like '%could not be located%',
  'AC-OBX-067-S2: the recorded reason names the lost identity — an unattributable hold is a BUG to fix, not a silent outcome');

-- ══ S3 — a NULL-witness row (the shape the SWEEP writes) is not overwritable by a stale writer ════
-- The sweep's attempts-exhausted park, byte-for-byte: no `approved_at_pushed`, so the row's generation
-- is UNKNOWN.
insert into timesheet_erp_mirror (org_id, timesheet_id, push_state, push_error) values
  ('01572000-0000-0000-0000-00000000000a','01572000-0000-0000-0000-000000000020','held','timesheet-push-attempts-exhausted');

-- A PROVEN-STALE writer: its outbox row is terminal `failed` at a superseded generation, so the CAS
-- misses and its verdict is `failed`. Against an unknown existing generation that verdict may NOT win.
insert into external_command_outbox
  (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, claim_generation)
values ('01572000-0000-0000-0000-0000000000c1','01572000-0000-0000-0000-00000000000a','timesheets',
        '01572000-0000-0000-0000-000000000020','ts:stale-generation','erpnext','create','failed', 9);

select is(
  (select record_timesheet_command_held(
     '01572000-0000-0000-0000-00000000000a','01572000-0000-0000-0000-000000000020',
     '2026-06-15 09:00:00+00',
     'command-held: the recovery probe failed deterministically',
     '01572000-0000-0000-0000-0000000000c1', 3)),
  'failed',
  'AC-OBX-067-S3: the stale writer''s CAS misses (its generation was superseded) so its verdict is `failed`');

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01572000-0000-0000-0000-000000000020'),
  'held',
  'AC-OBX-067-S3: but it does NOT overwrite the sweep''s witness-less `held` park — an unknown existing generation admits only a CAS-MATCHING writer');

-- The control: a writer whose CAS genuinely matches DOES take the row (the guard tightens the stale
-- case only; it must not wedge the legitimate current-generation write).
insert into external_command_outbox
  (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, claim_generation)
values ('01572000-0000-0000-0000-0000000000c2','01572000-0000-0000-0000-00000000000a','timesheets',
        '01572000-0000-0000-0000-000000000020','ts:live-generation','erpnext','create','held', 4);

select record_timesheet_command_held(
  '01572000-0000-0000-0000-00000000000a','01572000-0000-0000-0000-000000000020',
  '2026-06-15 09:00:00+00',
  'command-held: a different deterministic probe failure',
  '01572000-0000-0000-0000-0000000000c2', 4);

select is(
  (select approved_at_pushed from timesheet_erp_mirror where timesheet_id = '01572000-0000-0000-0000-000000000020'),
  '2026-06-15 09:00:00+00'::timestamptz,
  'AC-OBX-067-S3 control: a CAS-MATCHING writer still TAKES a witness-less row (its generation witness lands) — the guard suppresses stale writers, it does not wedge live ones');

select * from finish();
rollback;
