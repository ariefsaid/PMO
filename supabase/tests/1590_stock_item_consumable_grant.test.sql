-- 1590_stock_item_consumable_grant.test.sql — who may set stock_items.consumable (migration 1590).
-- AC-SKD-011. Mutation check: drop either grant in 1590 (insert or update) and the matching "may set" case goes red;
-- loosen the row policy and the Engineer cases go red.
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values ('15900000-0000-0000-0000-00000000000a', 'CON Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15900000-0000-0000-0000-0000000000a1', 'con-pm@example.com'),
  ('15900000-0000-0000-0000-0000000000a2', 'con-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15900000-0000-0000-0000-0000000000a1', '15900000-0000-0000-0000-00000000000a', 'CON PM', 'con-pm@example.com', 'Project Manager', 'active'),
  ('15900000-0000-0000-0000-0000000000a2', '15900000-0000-0000-0000-00000000000a', 'CON Engineer', 'con-eng@example.com', 'Engineer', 'active');
insert into stock_units (id, org_id, code, name, whole_only) values ('15900000-0000-0000-0000-0000000000d1', '15900000-0000-0000-0000-00000000000a', 'pc', 'Piece', false);
insert into stock_items (id, org_id, code, name, unit_id) values ('15900000-0000-0000-0000-000000001001', '15900000-0000-0000-0000-00000000000a', 'ROD', 'Welding rod', '15900000-0000-0000-0000-0000000000d1');

select ok(has_column_privilege('authenticated', 'public.stock_items', 'consumable', 'INSERT'), 'AC-SKD-011 the signed-in role may insert the consumable column');
select ok(has_column_privilege('authenticated', 'public.stock_items', 'consumable', 'UPDATE'), 'AC-SKD-011 the signed-in role may update the consumable column');
select ok(not has_column_privilege('anon', 'public.stock_items', 'consumable', 'INSERT') and not has_column_privilege('anon', 'public.stock_items', 'consumable', 'UPDATE'), 'AC-SKD-011 an anonymous caller may not write it');

create function public.con_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select con_as('15900000-0000-0000-0000-0000000000a1');
select lives_ok($$ insert into stock_items (id, code, name, unit_id, consumable) values ('15900000-0000-0000-0000-000000001002', 'NAIL', 'Nails', '15900000-0000-0000-0000-0000000000d1', true) $$, 'AC-SKD-011 a Project Manager creates an item as a consumable');
select lives_ok($$ update stock_items set consumable = true where id = '15900000-0000-0000-0000-000000001001' $$, 'AC-SKD-011 a Project Manager marks an existing item as a consumable');
select lives_ok($$ update stock_items set name = 'Welding rod 3mm' where id = '15900000-0000-0000-0000-000000001001' $$, 'AC-SKD-011 an ordinary item edit still saves');
reset role;
select is((select consumable from stock_items where id = '15900000-0000-0000-0000-000000001001'), true, 'AC-SKD-011 the flag is stored');
select is((select consumable from stock_items where id = '15900000-0000-0000-0000-000000001002'), true, 'AC-SKD-011 the flag set at creation is stored');

select con_as('15900000-0000-0000-0000-0000000000a2');
select throws_ok($$ insert into stock_items (id, code, name, unit_id, consumable) values ('15900000-0000-0000-0000-000000001003', 'BOLT', 'Bolts', '15900000-0000-0000-0000-0000000000d1', true) $$, '42501', null, 'AC-SKD-011 an Engineer cannot create an item');
select is((select count(*)::int from (update stock_items set consumable = false where id = '15900000-0000-0000-0000-000000001001' returning id) u), 0, 'AC-SKD-011 an Engineer cannot change the flag');
reset role;
select is((select consumable from stock_items where id = '15900000-0000-0000-0000-000000001001'), true, 'AC-SKD-011 the flag is unchanged after the refused edit');

select * from finish();
rollback;
