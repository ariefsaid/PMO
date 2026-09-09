-- 0212_meetings_org_stamp.test.sql — #616. (1) The CLASS guard, read from the catalog: every
-- seed-default table that `authenticated` can INSERT into via a policy carries an org-stamping BEFORE
-- INSERT trigger. 0131 proved a fixed list from 0074 and could not see a table added later; this one
-- cannot miss one. (2) The meeting AC for a second-org user. (3) A mutation: with the trigger gone the
-- guard goes red and the insert fails — the suite bites.
begin;
select plan(6);

create temp view unstamped_seed_tables as
  select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id'
  join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r'
    and pg_get_expr(d.adbin, d.adrelid) like '%00000000-0000-0000-0000-000000000001%'
    and c.relname <> 'credits'   -- 0074 header: the operator RPC inserts cross-org on purpose
    and has_table_privilege('authenticated', c.oid, 'INSERT')
    and exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polcmd = 'a')
    and not exists (
      select 1 from pg_trigger t join pg_proc f on f.oid = t.tgfoid
      where t.tgrelid = c.oid and not t.tgisinternal
        and t.tgtype::int & 2 = 2 and t.tgtype::int & 4 = 4
        and f.proname in ('stamp_org_id','stamp_meeting_attendee_org','stamp_meeting_grant','stamp_agent_attachment_thread_scope'));

-- AC-ORGSTAMP-010: the class guard — no reachable seed-default table is missing an org stamp.
select is(
  (select coalesce(string_agg(relname, ', ' order by relname), '') from unstamped_seed_tables), '',
  'AC-ORGSTAMP-010: every seed-default table authenticated can INSERT into has an org-stamping BEFORE INSERT trigger');

-- Fixtures: one non-seed org + its Admin.
insert into organizations (id, name) values ('cccccccc-0000-0000-0000-00000000000c','Org C (non-seed)');
insert into auth.users (id, email) values ('c0000000-0000-0000-0000-0000000000c1','c@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('c0000000-0000-0000-0000-0000000000c1','cccccccc-0000-0000-0000-00000000000c','Admin C','c@example.com','Admin');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- AC-ORGSTAMP-011: a second-org user creates a meeting WITHOUT org_id (the DAL shape) and it lands in THEIR org.
select lives_ok(
  $$ insert into meetings (id, title) values ('c1111111-0000-0000-0000-00000000000a','Org C kickoff') $$,
  'AC-ORGSTAMP-011: second-org meeting insert without org_id lives');
select is(
  (select org_id from meetings where id = 'c1111111-0000-0000-0000-00000000000a'),
  'cccccccc-0000-0000-0000-00000000000c'::uuid,
  'AC-ORGSTAMP-011b: stamped with the caller''s org, not the seed default');

-- AC-ORGSTAMP-012: an explicit foreign org_id is still hard-rejected (the 0074 narrow contract).
select throws_ok(
  $$ insert into meetings (title, org_id) values ('spoof','dddddddd-0000-0000-0000-00000000000d') $$,
  '42501', null,
  'AC-ORGSTAMP-012: a genuinely foreign explicit org_id is preserved by the trigger and refused by RLS');

-- Mutation: remove the trigger — the guard names the table and the second-org insert dies. Proves the
-- oracle is live (the 0131 list stayed green with this table missing).
reset role;
savepoint mutate;
drop trigger meetings_stamp_org_id on public.meetings;
select is(
  (select string_agg(relname, ', ') from unstamped_seed_tables), 'meetings',
  'MUTATION: with the stamp dropped the catalog guard names meetings');
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok(
  $$ insert into meetings (title) values ('no stamp') $$,
  '42501', null,
  'MUTATION: without the stamp the second-org insert is refused — the bug this test guards');
rollback to savepoint mutate;

select * from finish();
rollback;
