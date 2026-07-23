-- 0151_timesheet_uuid_identity.test.sql
-- AC-TSC-R4 (Luna code review BLOCK 3) — EQUIVALENT UUID SPELLINGS ARE ONE IDENTITY.
--
-- The money failure: `approved_timesheet_for_push(uuid)` accepts an UPPERCASE canonical UUID (Postgres
-- casts it), and the push guard used to hash + store the RAW `p_record_id` text it was handed. So a
-- push for 'ABCDEF…' took the advisory lock `ts-correct:ABCDEF…` and wrote an outbox row keyed by
-- UPPERCASE text, while a re-open of the SAME sheet took `ts-correct:abcdef…` and looked for a LOWERCASE
-- `pmo_record_id`. The two paths never serialised, and the re-open's "is a push in flight?" predicate
-- could not see the in-flight push at all: PMO returns the week to Draft while ERPNext is being handed
-- the original hours ⇒ the corrected week is posted as a SECOND Timesheet ⇒ the client's project cost
-- double-counts. The one-in-flight partial index is text-keyed too, so it did not catch it either.
--
-- What this proves, on the SHIPPED writers (no hand-seeded rows):
--   (a) the guard normalizes to the CANONICAL uuid text before it writes — one spelling in the outbox;
--   (b) ⚑ THE MONEY ORACLE: after an UPPERCASE-spelled push insert, the ordinary (lowercase) re-open
--       SEES that row and REFUSES `reopen-push-in-flight`, and the sheet stays Approved;
--   (c) the advisory lock taken by the UPPERCASE insert is the CANONICAL key — the same lock the
--       re-open takes — so the two paths genuinely serialise;
--   (d) a non-canonical (non-UUID) record id is rejected outright rather than silently keyed as text.
begin;
select plan(6);

insert into organizations (id, name) values
  ('01514000-0000-0000-0000-000000000001','TS UUID Identity Org');

insert into auth.users (id, email) values
  ('01514000-0000-0000-0000-0000000000a1','uuidid-owner@example.com'),
  ('01514000-0000-0000-0000-0000000000a2','uuidid-mgr@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01514000-0000-0000-0000-0000000000a1','01514000-0000-0000-0000-000000000001',
   'Owner U','uuidid-owner@example.com','Engineer','01514000-0000-0000-0000-0000000000a2'),
  ('01514000-0000-0000-0000-0000000000a2','01514000-0000-0000-0000-000000000001',
   'Manager M','uuidid-mgr@example.com','Engineer', null);

-- The sheet id contains hex letters, so its uppercase spelling is a DIFFERENT text value while being
-- the SAME uuid — exactly the case the served boundary accepts.
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01514000-0000-0000-0000-0000000000fa','01514000-0000-0000-0000-000000000001',
   '01514000-0000-0000-0000-0000000000a1','2026-06-01','Approved',
   '01514000-0000-0000-0000-0000000000a2', now());

-- ── (a) the SHIPPED push-side writer, handed the UPPERCASE spelling ────────
select lives_ok(
  $$ select public.insert_timesheet_outbox_pending(
       p_org:='01514000-0000-0000-0000-000000000001'::uuid,
       p_domain:='timesheets',
       p_record_id:='01514000-0000-0000-0000-0000000000FA',
       p_key:='ts-uuidid-a',
       p_tier:='erpnext',
       p_operation:='create',
       p_payload:=null, p_digest:=null, p_actor:=null) $$,
  'AC-TSC-R4(a): the push guard accepts an uppercase canonical uuid');
select is(
  (select pmo_record_id from public.external_command_outbox where idempotency_key = 'ts-uuidid-a'),
  '01514000-0000-0000-0000-0000000000fa',
  'AC-TSC-R4(a): the outbox row is keyed by the CANONICAL uuid text, never the raw spelling');

-- ── (c) the lock the uppercase insert took is the CANONICAL key ────────────
-- pg_advisory_xact_lock(bigint) splits the key into (classid = high 32 bits, objid = low 32 bits), and
-- the lock is held for the rest of this transaction — so it is still observable here.
select is(
  (select count(*)::int from pg_locks l
     where l.locktype = 'advisory'
       and l.pid = pg_backend_pid()
       and (l.classid::bigint << 32 | l.objid::bigint)
           = hashtextextended('ts-correct:01514000-0000-0000-0000-0000000000fa', 0)),
  1,
  'AC-TSC-R4(c): the uppercase-spelled insert holds the CANONICAL ts-correct advisory lock (the same one the re-open takes)');

-- ── (b) ⚑ THE MONEY ORACLE — the ordinary re-open SEES that push ───────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01514000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01514000-0000-0000-0000-0000000000fa','Draft') $$,
  'P0001', 'reopen-push-in-flight',
  'AC-TSC-R4(b): a push inserted under the UPPERCASE spelling is seen by the lowercase re-open — it REFUSES');
reset role;
select is(
  (select status from timesheets where id = '01514000-0000-0000-0000-0000000000fa'),
  'Approved'::timesheet_status,
  'AC-TSC-R4(b): the sheet with an in-flight push stays Approved (no Draft + ERP doc double-count)');

-- ── (d) a non-canonical record id is refused, never keyed as opaque text ───
select throws_ok(
  $$ select public.insert_timesheet_outbox_pending(
       p_org:='01514000-0000-0000-0000-000000000001'::uuid,
       p_domain:='timesheets',
       p_record_id:='not-a-uuid',
       p_key:='ts-uuidid-d',
       p_tier:='erpnext',
       p_operation:='create',
       p_payload:=null, p_digest:=null, p_actor:=null) $$,
  '22P02', 'invalid input syntax for type uuid: "not-a-uuid"',
  'AC-TSC-R4(d): a non-uuid record id is refused at the guard, never stored as an opaque text key');

select * from finish();
rollback;
