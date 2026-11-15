-- manual_journals_sole_member.test.sql — #895 owner rule: every manual journal needs a second approver, except when
-- the organisation has exactly one member. "One member" counts every profile in the org, whatever its status
-- (active or disabled). It is checked inside approve_journal at approval time, and the approval's audit
-- entry records whether the approver was the sole member.
begin;
select plan(15);

insert into organizations (id, name) values
  ('08951000-0000-0000-0000-000000000001','Duo Org'),
  ('08951000-0000-0000-0000-000000000002','Solo Org'),
  ('08951000-0000-0000-0000-000000000003','Late Org');
insert into auth.users (id, email) values
  ('08951000-0000-0000-0000-0000000000a1','duo-admin@example.test'),
  ('08951000-0000-0000-0000-0000000000a2','duo-other@example.test'),
  ('08951000-0000-0000-0000-0000000000b1','solo-fin@example.test'),
  ('08951000-0000-0000-0000-0000000000c1','late-fin@example.test'),
  ('08951000-0000-0000-0000-0000000000c2','late-join@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08951000-0000-0000-0000-0000000000a1','08951000-0000-0000-0000-000000000001','DuoAdmin','duo-admin@example.test','Admin','active'),
  ('08951000-0000-0000-0000-0000000000a2','08951000-0000-0000-0000-000000000001','DuoOther','duo-other@example.test','Engineer','active'),
  ('08951000-0000-0000-0000-0000000000b1','08951000-0000-0000-0000-000000000002','Solo','solo-fin@example.test','Finance','active'),
  ('08951000-0000-0000-0000-0000000000c1','08951000-0000-0000-0000-000000000003','Late','late-fin@example.test','Finance','active');

create function pg_temp.act(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.owner() returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true); end $$;
create function pg_temp.lines() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('account','6100','debit','10','credit','0','label','Fee'),
    jsonb_build_object('account','1100','debit','0','credit','10','label','Fee'))
$$;
create function pg_temp.jid(p_memo text) returns uuid language sql security definer as $$
  select id from public.journal_entries where memo = p_memo
$$;
create function pg_temp.sole_marker(p_memo text) returns text language sql security definer as $$
  select detail->>'sole_member' from public.audit_events
   where action = 'journal.approve' and entity_id = (select id from public.journal_entries where memo = p_memo)
$$;

-- (a) An Admin disables every other member, then approves their own journal: refused.
select pg_temp.act('08951000-0000-0000-0000-0000000000a1');
select save_journal_draft(null, 'fee', '2026-11-10', 'Duo journal', pg_temp.lines());
select submit_journal(pg_temp.jid('Duo journal'));
select pg_temp.owner();
update profiles set status = 'disabled' where id = '08951000-0000-0000-0000-0000000000a2';
select pg_temp.act('08951000-0000-0000-0000-0000000000a1');
select is(may_approve_journal(pg_temp.jid('Duo journal')), false,
  'AC-MJE-002 an org whose other members are disabled still has two members: the author may not approve');
select throws_ok($$ select approve_journal(pg_temp.jid('Duo journal')) $$, '42501', null,
  'AC-MJE-002 an Admin who disabled every other member is refused as approver of their own journal');
select pg_temp.owner();
select is((select status::text from journal_entries where id = pg_temp.jid('Duo journal')), 'submitted',
  'AC-MJE-002 the refused journal is still waiting for a second approver');

-- (b) An org that has only ever had one member: allowed, and the audit entry carries the marker.
select pg_temp.act('08951000-0000-0000-0000-0000000000b1');
select save_journal_draft(null, 'fee', '2026-11-10', 'Solo journal', pg_temp.lines());
select submit_journal(pg_temp.jid('Solo journal'));
select is(may_approve_journal(pg_temp.jid('Solo journal')), true,
  'AC-MJE-002 the only member of the organisation may approve their own journal');
select lives_ok($$ select approve_journal(pg_temp.jid('Solo journal')) $$,
  'AC-MJE-002 the only member approves their own journal');
select pg_temp.owner();
select results_eq($$ select status::text, approver_id from journal_entries where id = pg_temp.jid('Solo journal') $$,
  $$ values ('approved'::text, '08951000-0000-0000-0000-0000000000b1'::uuid) $$,
  'AC-MJE-002 the only member''s journal is approved by them');
select is(pg_temp.sole_marker('Solo journal'), 'true',
  'AC-MJE-002 the approval audit entry records sole member');

-- (c) A second member is added between submit and approval: refused.
select pg_temp.act('08951000-0000-0000-0000-0000000000c1');
select save_journal_draft(null, 'fee', '2026-11-10', 'Late journal', pg_temp.lines());
select submit_journal(pg_temp.jid('Late journal'));
select pg_temp.owner();
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08951000-0000-0000-0000-0000000000c2','08951000-0000-0000-0000-000000000003','Joiner','late-join@example.test','Engineer','disabled');
select pg_temp.act('08951000-0000-0000-0000-0000000000c1');
select throws_ok($$ select approve_journal(pg_temp.jid('Late journal')) $$, '42501', null,
  'AC-MJE-002 a second member added after submit (even a disabled one) restores the second approver: the author is refused');
select pg_temp.owner();
select is((select status::text from journal_entries where id = pg_temp.jid('Late journal')), 'submitted',
  'AC-MJE-002 the journal stays submitted');

-- A two-member approval records that the approver was not the sole member.
select pg_temp.owner();
update profiles set role = 'Finance' where id = '08951000-0000-0000-0000-0000000000c2';
update profiles set status = 'active' where id = '08951000-0000-0000-0000-0000000000c2';
select pg_temp.act('08951000-0000-0000-0000-0000000000c2');
select lives_ok($$ select approve_journal(pg_temp.jid('Late journal')) $$,
  'AC-MJE-002 the second member approves the journal');
select pg_temp.owner();
select is(pg_temp.sole_marker('Late journal'), 'false', 'AC-MJE-002 a second-approver approval is not marked sole member');

-- The may-approve helper: signed-in users ask only about themselves; the two-argument form and the internals are not
-- executable by signed-in users (grant proof).
select has_function('public', 'may_approve_journal', array['uuid'], 'AC-MJE-002 may_approve_journal takes only the journal id');
select hasnt_function('public', 'may_approve_journal', array['uuid','uuid'], 'AC-MJE-002 no approver-id form of may_approve_journal exists');
select is((select count(*)::int from information_schema.role_routine_grants
            where routine_schema = 'public' and grantee in ('authenticated','anon','PUBLIC')
              and routine_name in ('journal_approver_allows','journal_org_sole_member')), 0,
  'AC-MJE-002 the approver predicate and the sole-member count are executable by no client role');
select is(has_function_privilege('authenticated', 'public.may_approve_journal(uuid)', 'execute'), true,
  'AC-MJE-002 signed-in users may call may_approve_journal(journal id)');

select * from finish();
rollback;
