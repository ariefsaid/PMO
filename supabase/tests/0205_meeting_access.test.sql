-- 0205_meeting_access.test.sql — the meeting module's auth core (OD-MTG-1/2, DD-MTG-7, DD-TASK-1).
-- Migrations under test: 0205_meeting_module_core.sql + 0206_tasks_meeting_parent.sql.
--
-- ⚑ THE TWO FIXTURES THE RULINGS DEMAND, both present and both asymmetric:
--   · a NON-ATTENDEE SAME-ORG PEER (e2) — a fixture where every user attends every meeting cannot
--     tell an attendance check from an unconditional allow (the spec's own test note);
--   · the PROJECT'S OWN PM (f1), not an attendee — DD-MTG-7's consequence stated as an oracle: a PM
--     cannot read minutes on their own project unless invited or shared in.
-- Row-modifying assertions count rows via top-level CTEs (an RLS-denied UPDATE is a silent no-op).
-- ================================================================================================
begin;
select plan(33);

insert into organizations (id, name) values
  ('00d50000-0000-0000-0000-000000000001','MTG Org A'),
  ('00d50000-0000-0000-0000-000000000002','MTG Org B');
insert into auth.users (id, email) values
  ('00d50000-0000-0000-0000-0000000000e1','mtg-author@example.com'),
  ('00d50000-0000-0000-0000-0000000000e2','mtg-peer@example.com'),
  ('00d50000-0000-0000-0000-0000000000e3','mtg-attendee@example.com'),
  ('00d50000-0000-0000-0000-0000000000f1','mtg-pm@example.com'),
  ('00d50000-0000-0000-0000-0000000000a1','mtg-admin@example.com'),
  ('00d50000-0000-0000-0000-0000000000b1','mtg-orgb@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00d50000-0000-0000-0000-0000000000e1','00d50000-0000-0000-0000-000000000001','Author Eng','mtg-author@example.com','Engineer','active'),
  ('00d50000-0000-0000-0000-0000000000e2','00d50000-0000-0000-0000-000000000001','Peer Eng','mtg-peer@example.com','Engineer','active'),
  ('00d50000-0000-0000-0000-0000000000e3','00d50000-0000-0000-0000-000000000001','Attendee Eng','mtg-attendee@example.com','Engineer','active'),
  ('00d50000-0000-0000-0000-0000000000f1','00d50000-0000-0000-0000-000000000001','Project PM','mtg-pm@example.com','Project Manager','active'),
  ('00d50000-0000-0000-0000-0000000000a1','00d50000-0000-0000-0000-000000000001','Org Admin','mtg-admin@example.com','Admin','active'),
  ('00d50000-0000-0000-0000-0000000000b1','00d50000-0000-0000-0000-000000000002','Org B User','mtg-orgb@example.com','Admin','active');
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('00d50000-0000-0000-0000-000000000010','00d50000-0000-0000-0000-000000000001','MTG-P','Site Project','Ongoing Project','00d50000-0000-0000-0000-0000000000f1'),
  ('00d50000-0000-0000-0000-000000000011','00d50000-0000-0000-0000-000000000001','MTG-Q','Other Project','Ongoing Project',null);

-- ── §1 — an Engineer authors a minute (OD-MTG-1: write is ordinary RBAC) ───────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000e1","role":"authenticated"}';

select lives_ok($$
  insert into meetings (id, org_id, project_id, title, notes)
  values ('00d50000-0000-0000-0000-000000000101','00d50000-0000-0000-0000-000000000001',
          '00d50000-0000-0000-0000-000000000010','Site kickoff',
          '[{"type":"p","text":"agreed the crane schedule"}]'::jsonb)
$$, 'AC-MTG-101 an ENGINEER can create a meeting — no role list on insert (OD-MTG-1)');

select is((select created_by_id from meetings where id='00d50000-0000-0000-0000-000000000101'),
  '00d50000-0000-0000-0000-0000000000e1'::uuid,
  'AC-MTG-102 authorship is stamped from auth.uid(), the 0204 pattern');

select is((select notes_text from meetings where id='00d50000-0000-0000-0000-000000000101'),
  'agreed the crane schedule',
  'AC-MTG-103 notes_text is the trigger-maintained projection, not a client copy');

-- The author maintains the attendee list; e3 joins.
select lives_ok($$
  insert into meeting_attendees (meeting_id, profile_id)
  values ('00d50000-0000-0000-0000-000000000101','00d50000-0000-0000-0000-0000000000e3')
$$, 'AC-MTG-104 the author adds an attendee (list is part of the minute)');

select is((select org_id from meeting_attendees where profile_id='00d50000-0000-0000-0000-0000000000e3'),
  '00d50000-0000-0000-0000-000000000001'::uuid,
  'AC-MTG-105 the attendee row inherited org_id from the parent (0030 stamp idiom)');

-- ── §2 — READ IS ATTENDANCE (the heart of OD-MTG-1) ────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000e3","role":"authenticated"}';
select is((select count(*)::int from meetings where id='00d50000-0000-0000-0000-000000000101'), 1,
  'AC-MTG-106 an ATTENDEE reads the minute');

set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is((select count(*)::int from meetings), 0,
  'AC-MTG-107 ⛔ a NON-ATTENDEE same-org peer reads NOTHING — attendance, not role');

set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is((select count(*)::int from meetings), 0,
  'AC-MTG-108 ⛔ the project''s OWN PM reads nothing uninvited (DD-MTG-7 — no project-scope disjunct)');

set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from meetings where id='00d50000-0000-0000-0000-000000000101'), 1,
  'AC-MTG-109 Admin reads all (the one role disjunct the ruling grants)');

set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from meetings), 0,
  'AC-MTG-110 cross-org: an org-B Admin sees no org-A meeting (tenancy floor under the new model)');

-- ── §3 — the share (OD-MTG-2): grant → read; reader may re-share; revoke → gone; audited ───────
set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok($$
  insert into meeting_access_grants (meeting_id, user_id)
  values ('00d50000-0000-0000-0000-000000000101','00d50000-0000-0000-0000-0000000000e2')
$$, 'AC-MTG-111 the author shares the minute with the peer');

set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is((select count(*)::int from meetings where id='00d50000-0000-0000-0000-000000000101'), 1,
  'AC-MTG-112 the grant-holder now reads it');

-- "Anyone who can already read a minute can share it" — the grant-holder shares onward to the PM.
select lives_ok($$
  insert into meeting_access_grants (meeting_id, user_id)
  values ('00d50000-0000-0000-0000-000000000101','00d50000-0000-0000-0000-0000000000f1')
$$, 'AC-MTG-113 a reader (not the author) may share onward — OD-MTG-2 verbatim');

select is((select granted_by from meeting_access_grants where user_id='00d50000-0000-0000-0000-0000000000f1'),
  '00d50000-0000-0000-0000-0000000000e2'::uuid,
  'AC-MTG-114 granted_by is STAMPED with the real granter, never trusted from the client');

set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is((select count(*)::int from meetings where id='00d50000-0000-0000-0000-000000000101'), 1,
  'AC-MTG-115 …and the PM reads via the share — inclusion is a DECISION someone made (DD-MTG-7)');

-- A HARD 42501, not a silent 0-row no-op: the UPDATE *grant* itself is absent, so the denial fires
-- at the privilege layer before RLS is even consulted — the dead-proof pair working as designed.
select throws_ok($$
  update meeting_access_grants set granted_at = now()
   where user_id = '00d50000-0000-0000-0000-0000000000f1'
$$, '42501', null,
  'AC-MTG-116 a grant cannot be EDITED by anyone — no UPDATE grant and no UPDATE policy');

reset role;
select is((select count(*)::int from audit_events
            where action in ('meeting.grant.create')
              and entity_id = '00d50000-0000-0000-0000-000000000101'), 2,
  'AC-MTG-117 both grants were audit-logged — who opened a minute to whom has a trail');

-- revoke: the author removes the PM's grant; the read dies with it
set local role authenticated;
set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000e1","role":"authenticated"}';
with d as (
  delete from meeting_access_grants where user_id='00d50000-0000-0000-0000-0000000000f1' returning 1)
select is((select count(*)::int from d), 1, 'AC-MTG-118 the author revokes the share');

set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is((select count(*)::int from meetings), 0,
  'AC-MTG-119 revocation ends the read — the row was the access');

-- ── §4 — the minute's edit rights + the CHECK ──────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000e3","role":"authenticated"}';
with u as (
  update meetings set title='hijacked' where id='00d50000-0000-0000-0000-000000000101' returning 1)
select is((select count(*)::int from u), 0,
  'AC-MTG-120 an ATTENDEE cannot rewrite the minute — grants and attendance are VIEW-only');

set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$
  insert into meeting_attendees (meeting_id, profile_id, display_name)
  values ('00d50000-0000-0000-0000-000000000101','00d50000-0000-0000-0000-0000000000e2','Someone Typed')
$$, '23514', null,
  'AC-MTG-121 exactly ONE identity per attendee row — the CHECK holds (FR-MTG-015)');

-- ── §5 — the /action seam (0206): the minuting Engineer creates the action item ────────────────
select lives_ok($$
  insert into tasks (id, org_id, project_id, name, status, meeting_id)
  values ('00d50000-0000-0000-0000-000000000201','00d50000-0000-0000-0000-000000000001',
          '00d50000-0000-0000-0000-000000000010','Order the crane','To Do',
          '00d50000-0000-0000-0000-000000000101')
$$, 'AC-MTG-122 the minuting ENGINEER creates the /action task — #551''s collision closed end-to-end');

select throws_ok($$
  insert into tasks (org_id, project_id, name, status, meeting_id)
  values ('00d50000-0000-0000-0000-000000000001','00d50000-0000-0000-0000-000000000011',
          'Wrong project','To Do','00d50000-0000-0000-0000-000000000101')
$$, '42501', 'task meeting must be in the same org and project',
  'AC-MTG-123 a task and its meeting cannot name different projects (DD-TASK-1)');

-- FR-MTG-005: the schema version is server-written; a client-supplied value never sticks.
update meetings set notes_schema_version = 7 where id='00d50000-0000-0000-0000-000000000101';
select is((select notes_schema_version from meetings where id='00d50000-0000-0000-0000-000000000101'),
  1::smallint,
  'AC-MTG-126 notes_schema_version is server-pinned — a raw client PATCH cannot move it (FR-MTG-005)');

-- FR-MTG-011/012: search is proven AT THE DATABASE — the trigger, the config pairing and the GIN
-- index regressing returns zero rows SILENTLY, and no mocked unit test can see that (spec-review I4).
update meetings
   set notes = '[{"type":"p","text":"agreed the crane schedule"},{"type":"p","text":"pipeline pressure test moved to Friday"}]'::jsonb
 where id='00d50000-0000-0000-0000-000000000101';
select is(
  (select count(*)::int from meetings
    where notes_search @@ websearch_to_tsquery('simple','pipeline')),
  1,
  'AC-MTG-127 a term from a LATER block is findable via notes_search — the projection walks all blocks');
select is(
  (select count(*)::int from meetings
    where notes_search @@ websearch_to_tsquery('simple','zeppelin')),
  0,
  'AC-MTG-128 …and an absent term finds nothing (the positive above is not a match-anything artifact)');

-- AC-MTG-016: an EXPLICITLY foreign org_id on an attendee row is REJECTED, never silently rewritten.
select throws_ok($$
  insert into meeting_attendees (org_id, meeting_id, profile_id)
  values ('00d50000-0000-0000-0000-000000000002','00d50000-0000-0000-0000-000000000101',
          '00d50000-0000-0000-0000-0000000000e2')
$$, '42501', null,
  'AC-MTG-129 a spoofed foreign org_id on an attendee dies at WITH CHECK — the stamp only fills blanks');

-- The authorship pin, attacked AS ADMIN on purpose: the author's own attempt dies at WITH CHECK
-- with or without the pin (an abort, which points at the wrong layer), but Admin passes the policy
-- with ANY value — so Admin is the one actor for whom the pin alone stands, and a mutation that
-- drops the trigger flips exactly this assertion, cleanly.
set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000a1","role":"authenticated"}';
-- ⚑ The UPDATE is a SEPARATE statement, never a CTE beside the assert: a data-modifying CTE's outer
-- SELECT reads the PRE-update snapshot, so the combined form passes with the pin dropped — a dead
-- oracle by construction, caught here by its own mutation run.
update meetings set created_by_id = '00d50000-0000-0000-0000-0000000000e2', location = 'site office'
 where id='00d50000-0000-0000-0000-000000000101';
select is((select created_by_id from meetings where id='00d50000-0000-0000-0000-000000000101'),
  '00d50000-0000-0000-0000-0000000000e1'::uuid,
  'AC-MTG-125 created_by_id cannot be moved even by Admin — pinned, it is an authorization input');

select throws_ok($$
  delete from meetings where id = '00d50000-0000-0000-0000-000000000101'
$$, '23503', null,
  'AC-MTG-124 a meeting hard-delete FK-BLOCKS while an action task references it (FR-MTG-016)');

-- ── §7 — THE INBOUND GUARD (security review High, 2026-08-24) ──────────────────────────────────
-- A non-reader must not be able to LINK a task to a minute they cannot read — that injects an
-- action item the real attendees see, with no way for a non-manager author to remove it. ⚑ f1 (the
-- PM) is the right fixture: a same-org member whose grant was REVOKED at AC-MTG-118, so f1 genuinely
-- cannot read by now — e2 still holds a live grant from AC-MTG-111 and legitimately can (that shaped
-- the first draft of this oracle wrong, caught by the mutation run itself).
set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok($$
  insert into tasks (org_id, project_id, name, status, meeting_id)
  values ('00d50000-0000-0000-0000-000000000001','00d50000-0000-0000-0000-000000000010',
          'INJECTED action item','To Do','00d50000-0000-0000-0000-000000000101')
$$, '42501', 'task meeting must be one you can read',
  'AC-MTG-130 a NON-READER cannot link a task to a meeting they cannot read (inbound guard)');

select throws_ok($$
  insert into tasks (org_id, name, status, meeting_id)
  values ('00d50000-0000-0000-0000-000000000001','INJECTED nullproject','To Do',
          '00d50000-0000-0000-0000-000000000101')
$$, '42501', 'task meeting must be one you can read',
  'AC-MTG-131 …the project_id-null inbound path is guarded too');

-- The attendee (e3) — who CAN read — links fine: the guard admits the legitimate /action.
set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000e3","role":"authenticated"}';
select lives_ok($$
  insert into tasks (org_id, project_id, name, status, meeting_id)
  values ('00d50000-0000-0000-0000-000000000001','00d50000-0000-0000-0000-000000000010',
          'Legit action','To Do','00d50000-0000-0000-0000-000000000101')
$$, 'AC-MTG-132 an ATTENDEE (can read) links their /action task normally — the guard admits it');

-- ── §8 — LOW-5: a foreign-org seated identity is rejected ──────────────────────────────────────
set local request.jwt.claims = '{"sub":"00d50000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$
  insert into meeting_attendees (meeting_id, profile_id)
  values ('00d50000-0000-0000-0000-000000000101','00d50000-0000-0000-0000-0000000000b1')
$$, '42501', null,
  'AC-MTG-133 an author cannot seat a FOREIGN-org profile as an attendee (LOW-5, B2B seam)');

select * from finish();
rollback;
