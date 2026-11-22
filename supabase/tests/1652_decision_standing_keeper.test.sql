-- 1652_decision_standing_keeper.test.sql — standing is a fact about the person: a warehouse keeper has it with nothing waiting; an Engineer with none of the facts does not.
-- Migration under test: 1652_decision_standing_keeper.sql.
begin;
create extension if not exists pgtap;
select plan(3);

insert into organizations (id, name, default_currency, default_timezone) values ('16520000-0000-0000-0000-00000000000a', 'Keeper Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('16520000-0000-0000-0000-0000000000a1', 'k-keeper@example.com'), ('16520000-0000-0000-0000-0000000000a2', 'k-plain@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16520000-0000-0000-0000-0000000000a1', '16520000-0000-0000-0000-00000000000a', 'K Keeper', 'k-keeper@example.com', 'Engineer', 'active'),
  ('16520000-0000-0000-0000-0000000000a2', '16520000-0000-0000-0000-00000000000a', 'K Plain',  'k-plain@example.com',  'Engineer', 'active');
insert into stock_warehouses (id, org_id, code, name, kind) values ('16520000-0000-0000-0000-0000000000c1', '16520000-0000-0000-0000-00000000000a', 'KW', 'Keeper store', 'central');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp._as('16520000-0000-0000-0000-0000000000a1');
select is(public.my_decision_standing(), false, 'AC-WAIT-020 an Engineer who keeps no warehouse has no standing');
reset role;
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values ('16520000-0000-0000-0000-00000000000a', '16520000-0000-0000-0000-0000000000c1', '16520000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp._as('16520000-0000-0000-0000-0000000000a1');
select is(public.my_decision_standing(), true, 'AC-WAIT-021 a warehouse keeper has standing with nothing waiting');
select pg_temp._as('16520000-0000-0000-0000-0000000000a2');
select is(public.my_decision_standing(), false, 'AC-WAIT-022 another Engineer in the same organisation still has none');

select * from finish();
rollback;
