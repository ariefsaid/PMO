-- journal_amount_decimals.test.sql — migration 0922: save_journal_draft refuses an amount with more decimals than the
-- organisation's currency holds (create and edit); two decimals are accepted; a zero-decimal currency refuses any.
begin;
select plan(8);

insert into organizations (id, name, default_currency) values
  ('09220000-0000-0000-0000-000000000001','Dec Org USD','USD'),
  ('09220000-0000-0000-0000-000000000002','Dec Org JPY','JPY');
insert into auth.users (id, email) values
  ('09220000-0000-0000-0000-0000000000a1','dec-a@example.test'),
  ('09220000-0000-0000-0000-0000000000a2','dec-b@example.test');
insert into profiles (id, org_id, full_name, email, role) values
  ('09220000-0000-0000-0000-0000000000a1','09220000-0000-0000-0000-000000000001','Dec A','dec-a@example.test','Finance'),
  ('09220000-0000-0000-0000-0000000000a2','09220000-0000-0000-0000-000000000002','Dec B','dec-b@example.test','Finance');

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.as_user(uuid) to public;

select pg_temp.as_user('09220000-0000-0000-0000-0000000000a1');

select throws_ok($$ select save_journal_draft(null,'fee','2026-11-15','three',
  '[{"account":"6100","debit":"1.005","credit":"0"},{"account":"1100","debit":"0","credit":"1.005"}]'::jsonb) $$,
  'PJ422', null, 'AC-MJE-DEC-1 a three-decimal amount is refused on create');
select is((select count(*)::int from journal_entries where memo = 'three'), 0, 'AC-MJE-DEC-1 nothing written for the refused create');
select lives_ok($$ select save_journal_draft(null,'fee','2026-11-15','two',
  '[{"account":"6100","debit":"1.50","credit":"0"},{"account":"1100","debit":"0","credit":"1.5"}]'::jsonb) $$,
  'AC-MJE-DEC-2 a two-decimal amount is accepted');
select lives_ok($$ select save_journal_draft(null,'fee','2026-11-15','trailing',
  '[{"account":"6100","debit":"2.500","credit":"0"},{"account":"1100","debit":"0","credit":"2.5"}]'::jsonb) $$,
  'AC-MJE-DEC-2 trailing zeros beyond two places are not extra decimals');
select throws_ok($$ select save_journal_draft((select id from journal_entries where memo='two'),'fee','2026-11-15','two',
  '[{"account":"6100","debit":"1.234","credit":"0"},{"account":"1100","debit":"0","credit":"1.234"}]'::jsonb) $$,
  'PJ422', null, 'AC-MJE-DEC-1 a three-decimal amount is refused on edit');
select is((select debit from journal_entry_lines where journal_id=(select id from journal_entries where memo='two') and line_no=1),
  1.50::numeric, 'AC-MJE-DEC-1 the draft keeps its earlier lines after the refused edit');

select pg_temp.as_user('09220000-0000-0000-0000-0000000000a2');
select throws_ok($$ select save_journal_draft(null,'fee','2026-11-15','yen',
  '[{"account":"6100","debit":"100.5","credit":"0"},{"account":"1100","debit":"0","credit":"100.5"}]'::jsonb) $$,
  'PJ422', null, 'AC-MJE-DEC-3 a zero-decimal currency refuses decimals');
select lives_ok($$ select save_journal_draft(null,'fee','2026-11-15','yen whole',
  '[{"account":"6100","debit":"100","credit":"0"},{"account":"1100","debit":"0","credit":"100.0"}]'::jsonb) $$,
  'AC-MJE-DEC-3 a zero-decimal currency accepts whole amounts');

select * from finish();
rollback;
