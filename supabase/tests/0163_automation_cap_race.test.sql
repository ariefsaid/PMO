-- 0163_automation_cap_race.test.sql
-- FR-HRD-041 [pgTAP]: enforce_automation_owner_cap must not be a bare count-then-insert.
-- Evidence: 0059_agent_automation_bounds.sql:31 counts with no lock; two concurrent inserts can both
-- observe a count below the cap. 0059's own comment names the fix ("row-lock the owner's profile row
-- here if an exact cap ever matters"). The SHARE ROW EXCLUSIVE exemplar at 0065_admin_set_user_status.sql:69
-- shows the intended pattern -- note 0065:69 is the EXEMPLAR, not the defect.
--
-- HONESTY NOTE (read before trusting this test): assertions 1-2 prove the serializing lock is PRESENT
-- and that the function is security definer (so RLS cannot silently hide the row and skip the lock).
-- They do NOT prove the race is closed under true concurrency -- that needs two sessions (dblink /
-- pg_background), which this stack does not have enabled. Tracked as a follow-up in the plan's §8.
-- Assertion 3 is the no-regression check.
begin;
select plan(3);

select matches(
  pg_get_functiondef('public.enforce_automation_owner_cap()'::regprocedure),
  'for update',
  'FR-HRD-041 the cap trigger takes a row lock before counting (no bare count-then-insert)');

select is(
  (select prosecdef from pg_proc where oid = 'public.enforce_automation_owner_cap()'::regprocedure),
  true,
  'FR-HRD-041 the cap trigger is security definer (RLS cannot hide the owner row and skip the lock)');

-- No regression: the cap still fires.
insert into organizations (id, name) values
  ('01630000-0000-0000-0000-000000000001','FR-HRD-041 Org');
insert into auth.users (id, email) values
  ('01630000-0000-0000-0000-0000000000a1','cap-race@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01630000-0000-0000-0000-0000000000a1','01630000-0000-0000-0000-000000000001',
   'Cap Race','cap-race@example.com','Admin');

insert into public.agent_automations (org_id, owner_id, kind, prompt, schedule, timeout_s)
select '01630000-0000-0000-0000-000000000001',
       '01630000-0000-0000-0000-0000000000a1',
       'schedule', 'cap fill ' || g, '0 0 * * *', 120
  from generate_series(1,25) g;

select throws_ok(
  $$ insert into public.agent_automations (org_id, owner_id, kind, prompt, schedule, timeout_s)
     values ('01630000-0000-0000-0000-000000000001',
             '01630000-0000-0000-0000-0000000000a1','schedule','over cap','0 0 * * *',120) $$,
  'P0001', null,
  'FR-HRD-041 the 26th active automation for an owner is still rejected (no regression)');

select * from finish();
rollback;
