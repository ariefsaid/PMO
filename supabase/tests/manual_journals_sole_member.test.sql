-- manual_journals_sole_member.test.sql — #895 owner ruling: every manual journal needs a second approver, except
-- when the organisation has exactly one active member; then that member may approve their own journal.
-- "Active" is the schema's definition, public.is_active_member(uuid) (status 'active' and not banned).
-- The check is live at approval time: a member who joins later restores the second-approver rule for any journal
-- not yet approved; a journal already approved stays approved.
begin;
select plan(9);

insert into organizations (id, name) values ('08951000-0000-0000-0000-000000000001','Solo Org');
insert into auth.users (id, email) values
  ('08951000-0000-0000-0000-0000000000a1','solo-fin@example.test'),
  ('08951000-0000-0000-0000-0000000000a2','gone@example.test'),
  ('08951000-0000-0000-0000-0000000000a3','joiner@example.test');
-- One active Finance member, and one disabled member who does not count.
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08951000-0000-0000-0000-0000000000a1','08951000-0000-0000-0000-000000000001','Solo','solo-fin@example.test','Finance','active'),
  ('08951000-0000-0000-0000-0000000000a2','08951000-0000-0000-0000-000000000001','Gone','gone@example.test','Finance','disabled');

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

-- The sole member drafts and submits three journals.
select pg_temp.act('08951000-0000-0000-0000-0000000000a1');
select save_journal_draft(null, 'fee', '2026-11-10', 'Solo one', pg_temp.lines());
select save_journal_draft(null, 'fee', '2026-11-10', 'Solo two', pg_temp.lines());
select save_journal_draft(null, 'fee', '2026-11-10', 'Solo three', pg_temp.lines());
select submit_journal(pg_temp.jid('Solo one'));
select submit_journal(pg_temp.jid('Solo two'));
select submit_journal(pg_temp.jid('Solo three'));

-- Pin 2: one active member — the author may approve (and return) their own journal.
select is(may_approve_journal(pg_temp.jid('Solo one'), '08951000-0000-0000-0000-0000000000a1'), true,
  'AC-ACD-002 the sole active member may approve their own journal');
select lives_ok($$ select approve_journal(pg_temp.jid('Solo one')) $$,
  'AC-ACD-002 the sole active member approves their own journal');
select lives_ok($$ select return_journal(pg_temp.jid('Solo three'), 'Fix the memo') $$,
  'AC-ACD-002 the sole active member returns their own journal');
select pg_temp.owner();
select results_eq($$ select status::text, approver_id from journal_entries where id = pg_temp.jid('Solo one') $$,
  $$ values ('approved'::text, '08951000-0000-0000-0000-0000000000a1'::uuid) $$,
  'AC-ACD-002 the sole member''s journal is approved by them');

-- A disabled member does not make a second member; a non-Finance sole member still may not approve.
select is(may_approve_journal(pg_temp.jid('Solo two'), '08951000-0000-0000-0000-0000000000a2'), false,
  'AC-ACD-002 a disabled member of the org may not approve');

-- Pin 3: a second member joins later.
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08951000-0000-0000-0000-0000000000a3','08951000-0000-0000-0000-000000000001','Joiner','joiner@example.test','Engineer','active');
select pg_temp.act('08951000-0000-0000-0000-0000000000a1');
select throws_ok($$ select approve_journal(pg_temp.jid('Solo two')) $$, '42501', null,
  'AC-ACD-002 once a second member joins, the author is refused as approver of a journal not yet approved');
select is(may_approve_journal(pg_temp.jid('Solo two'), '08951000-0000-0000-0000-0000000000a1'), false,
  'AC-ACD-002 once a second member joins, the author may not approve');
select pg_temp.owner();
select results_eq($$ select status::text, approver_id from journal_entries where id = pg_temp.jid('Solo one') $$,
  $$ values ('approved'::text, '08951000-0000-0000-0000-0000000000a1'::uuid) $$,
  'AC-ACD-002 a journal approved while the member was alone stays approved');

-- Pin 1 in this org: two active members, the author is refused (the 2+ member org pins live in manual_journals).
select is((select status::text from journal_entries where id = pg_temp.jid('Solo two')), 'submitted',
  'AC-ACD-002 the refused journal is still waiting for a second approver');

select * from finish();
rollback;
