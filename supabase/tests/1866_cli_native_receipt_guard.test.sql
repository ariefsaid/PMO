-- 1866 AC-RCV-013: a CLI token may call create_procurement_receipt (a PMO-owned org's goods receipt) for the same
-- roles the RPC lets receive for others (Admin, Project Manager); every other role, an inactive member and any other
-- RPC stay refused; the RPC's own org check still stops a token from another org.
begin;
select plan(10);

insert into organizations (id, name, default_currency) values
  ('18660000-0000-0000-0000-00000000000a','RCV A','IDR'), ('18660000-0000-0000-0000-00000000000b','RCV B','IDR');
insert into auth.users (id, email) values
  ('18660000-0000-0000-0000-0000000000a1','rcv-admin@example.com'), ('18660000-0000-0000-0000-0000000000a2','rcv-pm@example.com'),
  ('18660000-0000-0000-0000-0000000000a3','rcv-fin@example.com'), ('18660000-0000-0000-0000-0000000000a4','rcv-eng@example.com'),
  ('18660000-0000-0000-0000-0000000000a5','rcv-off@example.com'), ('18660000-0000-0000-0000-0000000000b1','rcv-pmb@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18660000-0000-0000-0000-0000000000a1','18660000-0000-0000-0000-00000000000a','Admin','rcv-admin@example.com','Admin','active'),
  ('18660000-0000-0000-0000-0000000000a2','18660000-0000-0000-0000-00000000000a','PM','rcv-pm@example.com','Project Manager','active'),
  ('18660000-0000-0000-0000-0000000000a3','18660000-0000-0000-0000-00000000000a','Fin','rcv-fin@example.com','Finance','active'),
  ('18660000-0000-0000-0000-0000000000a4','18660000-0000-0000-0000-00000000000a','Eng','rcv-eng@example.com','Engineer','active'),
  ('18660000-0000-0000-0000-0000000000a5','18660000-0000-0000-0000-00000000000a','Off','rcv-off@example.com','Project Manager','disabled'),
  ('18660000-0000-0000-0000-0000000000b1','18660000-0000-0000-0000-00000000000b','PMB','rcv-pmb@example.com','Project Manager','active');
insert into procurements (id, org_id, title, status, requested_by_id, total_value) values
  ('18660000-0000-0000-0000-0000000000d1','18660000-0000-0000-0000-00000000000a','RCV PR','Ordered','18660000-0000-0000-0000-0000000000a1', 50000);

create function pg_temp.req(p_sub text, p_path text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'client_id', 'pmo-cli')::text, true),
         set_config('request.method', 'POST', true), set_config('request.path', p_path, true), set_config('request.headers', '{}', true);
$$;

set local role authenticated;
select pg_temp.req('18660000-0000-0000-0000-0000000000a1', '/rpc/create_procurement_receipt');
select lives_ok('select public.api_client_request_guard()', 'AC-RCV-013 an Admin API client may record a goods receipt');
select pg_temp.req('18660000-0000-0000-0000-0000000000a2', '/rpc/create_procurement_receipt');
select lives_ok('select public.api_client_request_guard()', 'AC-RCV-013 a Project Manager API client may record a goods receipt');
select pg_temp.req('18660000-0000-0000-0000-0000000000a3', '/rpc/create_procurement_receipt');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-RCV-013 a Finance API client is refused (the app does not let Finance receive)');
select pg_temp.req('18660000-0000-0000-0000-0000000000a4', '/rpc/create_procurement_receipt');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-RCV-013 an Engineer API client is refused');
select pg_temp.req('18660000-0000-0000-0000-0000000000a5', '/rpc/create_procurement_receipt');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-RCV-013 an inactive Project Manager is refused');
select pg_temp.req('18660000-0000-0000-0000-0000000000a2', '/rpc/create_procurement_invoice');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-RCV-013 the sibling invoice writer is not exposed');
select pg_temp.req('18660000-0000-0000-0000-0000000000a2', '/procurement_receipts');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-RCV-013 the receipts table is not directly writable');

-- the RPC itself, as the CLI calls it: a token from the other org cannot receive; the allowed role can
select set_config('request.jwt.claims', json_build_object('sub','18660000-0000-0000-0000-0000000000b1','role','authenticated','client_id','pmo-cli')::text, true);
select throws_ok(
  $$ select create_procurement_receipt('18660000-0000-0000-0000-0000000000d1'::uuid, 'Complete'::procurement_receipt_status, current_date) $$,
  '42501', 'not authorized', 'AC-RCV-013 a Project Manager of another org cannot receive this purchase');
select set_config('request.jwt.claims', json_build_object('sub','18660000-0000-0000-0000-0000000000a2','role','authenticated','client_id','pmo-cli')::text, true);
select lives_ok(
  $$ select create_procurement_receipt('18660000-0000-0000-0000-0000000000d1'::uuid, 'Complete'::procurement_receipt_status, current_date,
       null, 'cli-receipt', '18660000-0000-0000-0000-0000000000e1'::uuid, now()) $$,
  'AC-RCV-013 the allowed role records the receipt with the intent as batch id');
select throws_ok(
  $$ select create_procurement_receipt('18660000-0000-0000-0000-0000000000d1'::uuid, 'Complete'::procurement_receipt_status, current_date,
       null, 'cli-receipt', '18660000-0000-0000-0000-0000000000e1'::uuid, now()) $$,
  '23505', null, 'AC-RCV-013 re-running with the same intent does not record a second receipt');

select * from finish();
rollback;
