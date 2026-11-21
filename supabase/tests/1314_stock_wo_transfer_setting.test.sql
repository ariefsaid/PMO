-- 1314_stock_wo_transfer_setting.test.sql — #2691. Migration under test: 1314. AC-WOT-019: the work-order transfers setting is off, Admin-only, audited.
-- Mutation check: mut:wot_setting_admin (drop the Admin check in set_stock_wo_transfers: the non-Admin case goes red).
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values ('26911000-0000-0000-0000-00000000000a', 'WOB Org', 'IDR', 'UTC'), ('26911000-0000-0000-0000-00000000000b', 'WOB Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values ('26911000-0000-0000-0000-0000000000a1', 'wob-admin@example.com'), ('26911000-0000-0000-0000-0000000000a2', 'wob-keeper@example.com'), ('26911000-0000-0000-0000-0000000000b1', 'wob-other@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26911000-0000-0000-0000-0000000000a1', '26911000-0000-0000-0000-00000000000a', 'WOB Admin', 'wob-admin@example.com', 'Admin', 'active'),
  ('26911000-0000-0000-0000-0000000000a2', '26911000-0000-0000-0000-00000000000a', 'WOB Keeper', 'wob-keeper@example.com', 'Engineer', 'active'),
  ('26911000-0000-0000-0000-0000000000b1', '26911000-0000-0000-0000-00000000000b', 'WOB Other Admin', 'wob-other@example.com', 'Admin', 'active');
create function public.wob_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function public.wob_audit() returns int language sql security definer as $$ select count(*)::int from public.audit_events where action = 'stock.wo_transfers' $$;
select is((select stock_wo_transfers from organizations where id = '26911000-0000-0000-0000-00000000000a'), false, 'AC-WOT-019 an existing organisation starts with the setting off');
select wob_as('26911000-0000-0000-0000-0000000000a2');
select throws_ok($$ select set_stock_wo_transfers(true) $$, '42501', 'STK_FORBIDDEN: only an Admin changes work-order transfers', 'AC-WOT-019 a non-Admin cannot turn it on');
select wob_as('26911000-0000-0000-0000-0000000000a1');
select is(set_stock_wo_transfers(true), true, 'AC-WOT-019 an Admin turns it on');
select is(wob_audit(), 1, 'AC-WOT-019 the change is audited');
select is(set_stock_wo_transfers(true), true, 'AC-WOT-019 setting it to the same value is a no-op');
select is(wob_audit(), 1, 'AC-WOT-019 and writes no second audit row');
select is(stock_wo_transfers_on('26911000-0000-0000-0000-00000000000a'), true, 'AC-WOT-019 the reader says on');
select wob_as('26911000-0000-0000-0000-0000000000b1');
select is(stock_wo_transfers_on('26911000-0000-0000-0000-00000000000b'), false, 'AC-WOT-019 another organisation is unaffected');
select wob_as('26911000-0000-0000-0000-0000000000a1');
select is(set_stock_wo_transfers(false), false, 'AC-WOT-019 an Admin turns it off');
select is(wob_audit(), 2, 'AC-WOT-019 the second change is audited');
select * from finish();
rollback;
