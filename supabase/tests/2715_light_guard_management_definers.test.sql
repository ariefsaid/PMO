-- 2715_light_guard_management_definers.test.sql — #2711. The field-account guard is declared per function.
-- Migration under test: 1530 (the body guard on every office definer the sweep 2711 used to allowlist by reason).
-- AC-LA-015: a field account who keeps a stock location cannot archive a stock-document file, a full Engineer keeper
-- still can, five sampled office functions refuse a field account with the guard code before any role check, and the
-- field paths (home, check-in, delivery confirmation) still run for it.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   create or replace archive_stock_document_file without `perform public.assert_not_light();`
--                                                  .. 'AC-LA-015 a field account who keeps the location cannot archive ...'
--   same for create_payment ........................ 'AC-LA-015 office function create_payment refuses ...'
--   let assert_not_light pass for a light actor .... every AC-LA-015 refusal below
begin;
create extension if not exists pgtap;
select plan(11);

insert into organizations (id, name, default_currency, built_in_roles_enabled)
  values ('27150000-0000-0000-0000-00000000000a', 'LGM Org', 'IDR', true);
insert into auth.users (id, email) values
  ('27150000-0000-0000-0000-0000000000a1', 'lgm-admin@example.com'),
  ('27150000-0000-0000-0000-0000000000a4', 'lgm-eng@example.com'),
  ('27150000-0000-0000-0000-0000000000a6', 'lgm-field@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27150000-0000-0000-0000-0000000000a1', '27150000-0000-0000-0000-00000000000a', 'LGM Admin', 'lgm-admin@example.com', 'Admin', 'active', null),
  ('27150000-0000-0000-0000-0000000000a4', '27150000-0000-0000-0000-00000000000a', 'LGM Eng', 'lgm-eng@example.com', 'Engineer', 'active', null),
  ('27150000-0000-0000-0000-0000000000a6', '27150000-0000-0000-0000-00000000000a', 'LGM Field', 'lgm-field@example.com', 'Engineer', 'active', 'field_user');
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('27150000-0000-0000-0000-000000002001', '27150000-0000-0000-0000-00000000000a', 'LGMS', 'Site store', 'central');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('27150000-0000-0000-0000-00000000000a', '27150000-0000-0000-0000-000000002001', '27150000-0000-0000-0000-0000000000a6'),
  ('27150000-0000-0000-0000-00000000000a', '27150000-0000-0000-0000-000000002001', '27150000-0000-0000-0000-0000000000a4');
insert into stock_documents (id, org_id, number, kind, status, warehouse_id, occurred_on, created_by) values
  ('27150000-0000-0000-0000-000000003001', '27150000-0000-0000-0000-00000000000a', 'LGM-1', 'receive', 'Draft',
   '27150000-0000-0000-0000-000000002001', current_date, '27150000-0000-0000-0000-0000000000a1');
insert into storage.objects (bucket_id, name) values
  ('stock-documents', '27150000-0000-0000-0000-00000000000a/27150000-0000-0000-0000-000000003001/27150000-0000-0000-0000-000000004001/note.pdf'),
  ('stock-documents', '27150000-0000-0000-0000-00000000000a/27150000-0000-0000-0000-000000003001/27150000-0000-0000-0000-000000004002/photo.jpg');
insert into stock_document_files (id, org_id, document_id, file_path, uploaded_by) values
  ('27150000-0000-0000-0000-000000004001', '27150000-0000-0000-0000-00000000000a', '27150000-0000-0000-0000-000000003001',
   '27150000-0000-0000-0000-00000000000a/27150000-0000-0000-0000-000000003001/27150000-0000-0000-0000-000000004001/note.pdf', '27150000-0000-0000-0000-0000000000a1'),
  ('27150000-0000-0000-0000-000000004002', '27150000-0000-0000-0000-00000000000a', '27150000-0000-0000-0000-000000003001',
   '27150000-0000-0000-0000-00000000000a/27150000-0000-0000-0000-000000003001/27150000-0000-0000-0000-000000004002/photo.jpg', '27150000-0000-0000-0000-0000000000a1');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- calls every overload of a public function with NULL for each argument; returns the first error as 'state message'
create or replace function pg_temp.refusal(p_name text) returns text language plpgsql as $$
declare r record; v_args text;
begin
  for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = p_name loop
    select coalesce(string_agg('null::' || format_type(t, null), ', ' order by o), '') into v_args
      from unnest((select proargtypes::oid[] from pg_proc where oid = r.oid)) with ordinality as u(t, o);
    begin
      execute format('select public.%I(%s)', p_name, v_args);
    exception when others then
      return sqlstate || ' ' || sqlerrm;
    end;
  end loop;
  return 'no error';
end $$;
grant execute on function pg_temp.act_as(uuid) to authenticated;
grant execute on function pg_temp.refusal(text) to authenticated;
set local role authenticated;

select pg_temp.act_as('27150000-0000-0000-0000-0000000000a6');
select throws_ilike($$ select public.archive_stock_document_file('27150000-0000-0000-0000-000000004001', 'wrong page') $$,
  'LIGHT_ACCOUNT%', 'AC-LA-015 a field account who keeps the location cannot archive a stock-document file');
reset role;
select is((select archived_at is null from stock_document_files where id = '27150000-0000-0000-0000-000000004001'), true,
  'AC-LA-015 the refused archive left the file in place');
set local role authenticated;

select is(pg_temp.refusal('archive_stock_document_file') like '42501 LIGHT_ACCOUNT%', true,
  'AC-LA-015 office function archive_stock_document_file refuses a field account with the guard code');
select is(pg_temp.refusal('create_payment') like '42501 LIGHT_ACCOUNT%', true,
  'AC-LA-015 office function create_payment refuses a field account with the guard code');
select diag(pg_temp.refusal('approve_journal'));
select is(pg_temp.refusal('approve_journal') like '42501 LIGHT_ACCOUNT%', true,
  'AC-LA-015 office function approve_journal refuses a field account with the guard code');
select is(pg_temp.refusal('create_purchase_order') like '42501 LIGHT_ACCOUNT%', true,
  'AC-LA-015 office function create_purchase_order refuses a field account with the guard code');
select is(pg_temp.refusal('admin_set_user_status') like '42501 LIGHT_ACCOUNT%', true,
  'AC-LA-015 office function admin_set_user_status refuses a field account with the guard code');

-- the field paths still run for the same account
select lives_ok($$ select public.my_home() $$, 'AC-LA-015 the field home still runs for a field account');
select is(pg_temp.refusal('phone_check_in') not like '%LIGHT_ACCOUNT%', true,
  'AC-LA-015 the phone check-in is not refused by the field-account guard');
select is(pg_temp.refusal('receive_stock_transfer') not like '%LIGHT_ACCOUNT%', true,
  'AC-LA-015 the delivery confirmation is not refused by the field-account guard');

-- a full Engineer keeper is unaffected
select pg_temp.act_as('27150000-0000-0000-0000-0000000000a4');
select lives_ok($$ select public.archive_stock_document_file('27150000-0000-0000-0000-000000004002', 'wrong photo') $$,
  'AC-LA-015 a full Engineer keeper of the location still archives a stock-document file');

select * from finish();
rollback;
