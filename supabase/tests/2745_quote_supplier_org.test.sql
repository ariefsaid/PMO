begin;
create extension if not exists pgtap;
select plan(22);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27450000-0000-0000-0000-0000000000a0', 'QSO Org A', 'IDR', 'UTC'),
  ('27450000-0000-0000-0000-0000000000b0', 'QSO Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('27450000-0000-0000-0000-0000000000a1', 'qso-a1@example.com'),
  ('27450000-0000-0000-0000-0000000000b1', 'qso-b1@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27450000-0000-0000-0000-0000000000a1', '27450000-0000-0000-0000-0000000000a0', 'PM A', 'qso-a1@example.com', 'Project Manager', 'active'),
  ('27450000-0000-0000-0000-0000000000b1', '27450000-0000-0000-0000-0000000000b0', 'PM B', 'qso-b1@example.com', 'Project Manager', 'active');
insert into companies (id, org_id, name, type) values
  ('27450000-0000-0000-0000-0000000000c1', '27450000-0000-0000-0000-0000000000a0', 'QSO Own Supplier', 'Vendor'),
  ('27450000-0000-0000-0000-0000000000c2', '27450000-0000-0000-0000-0000000000b0', 'QSO Other Supplier', 'Vendor');
insert into procurements (id, org_id, title, status, currency, requested_by_id, total_value) values
  ('27450000-0000-0000-0000-0000000000d1', '27450000-0000-0000-0000-0000000000a0', 'QSO purchase A', 'Vendor Quoted', 'IDR', '27450000-0000-0000-0000-0000000000a1', 100),
  ('27450000-0000-0000-0000-0000000000d2', '27450000-0000-0000-0000-0000000000b0', 'QSO purchase B', 'Vendor Quoted', 'IDR', '27450000-0000-0000-0000-0000000000b1', 100);


-- Extra fixtures for the writers and the legacy-row cases.
insert into companies (id, org_id, name, type) values
  ('27450000-0000-0000-0000-0000000000c3', '27450000-0000-0000-0000-0000000000b0', 'QSO Other Supplier 2', 'Vendor');
insert into procurements (id, org_id, title, status, currency, requested_by_id, total_value) values
  ('27450000-0000-0000-0000-0000000000e1', '27450000-0000-0000-0000-0000000000a0', 'QSO approved, no supplier', 'Approved', 'IDR', '27450000-0000-0000-0000-0000000000a1', 100),
  ('27450000-0000-0000-0000-0000000000e2', '27450000-0000-0000-0000-0000000000a0', 'QSO quoting (own quote)', 'Vendor Quoted', 'IDR', '27450000-0000-0000-0000-0000000000a1', 100),
  ('27450000-0000-0000-0000-0000000000e3', '27450000-0000-0000-0000-0000000000a0', 'QSO draft', 'Draft', 'IDR', '27450000-0000-0000-0000-0000000000a1', 100);
-- Legacy rows that already hold another organisation's company: written with the rule off, as old data would be.
set local session_replication_role = replica;   -- the rule is off for this block
insert into procurements (id, org_id, title, status, currency, requested_by_id, total_value, vendor_id) values
  ('27450000-0000-0000-0000-0000000000f1', '27450000-0000-0000-0000-0000000000a0', 'QSO legacy draft', 'Draft', 'IDR', '27450000-0000-0000-0000-0000000000a1', 100, '27450000-0000-0000-0000-0000000000c2'),
  ('27450000-0000-0000-0000-0000000000f2', '27450000-0000-0000-0000-0000000000a0', 'QSO legacy quoting', 'Vendor Quoted', 'IDR', '27450000-0000-0000-0000-0000000000a1', 100, '27450000-0000-0000-0000-0000000000c2');
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount, vq_number, currency) values
  ('27450000-0000-0000-0000-0000000000a9', '27450000-0000-0000-0000-0000000000a0', '27450000-0000-0000-0000-0000000000f2', '27450000-0000-0000-0000-0000000000c2', 40, 'VQ-QSO-1', 'IDR');
set local session_replication_role = origin;

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"27450000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return 'ok';
exception when others then
  execute 'reset role';
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;

select is(pg_temp.err('a1', $$select create_procurement_quotation('27450000-0000-0000-0000-0000000000d1','27450000-0000-0000-0000-0000000000c2',50,current_date)$$),
  'P0002 supplier not found', 'AC-QSO-001 a quote naming another organisation''s company is refused as not found');
select is((select count(*) from procurement_quotations where procurement_id = '27450000-0000-0000-0000-0000000000d1'), 0::bigint, 'AC-QSO-001 no quote row was written');
select is(pg_temp.err('a1', $$select create_procurement_quotation('27450000-0000-0000-0000-0000000000d1','27450000-0000-0000-0000-0000000000ff',50,current_date)$$),
  'P0002 supplier not found', 'AC-QSO-001 an id that does not exist gives the identical refusal');
select is(pg_temp.err('a1', $$select create_procurement_quotation('27450000-0000-0000-0000-0000000000d1','27450000-0000-0000-0000-0000000000c1',50,current_date)$$),
  'ok', 'AC-QSO-002 a company of the caller''s own organisation is accepted');
select is(pg_temp.err('b1', $$select create_procurement_quotation('27450000-0000-0000-0000-0000000000d2','27450000-0000-0000-0000-0000000000c2',60,current_date)$$),
  'ok', 'AC-QSO-003 the other organisation quotes with its own company, unaffected');
select is(pg_temp.err('b1', $$select create_procurement_quotation('27450000-0000-0000-0000-0000000000d2','27450000-0000-0000-0000-0000000000c1',60,current_date)$$),
  'P0002 supplier not found', 'AC-QSO-001 refused the other way round too');

-- The direct update of the purchase's supplier (the other path that sets it).
select is(pg_temp.err('a1', $$update procurements set vendor_id='27450000-0000-0000-0000-0000000000c2' where id='27450000-0000-0000-0000-0000000000d1'$$),
  'P0002 supplier not found', 'AC-QSO-001 a purchase cannot be given another organisation''s company');
select is(pg_temp.err('a1', $$update procurements set vendor_id='27450000-0000-0000-0000-0000000000c1' where id='27450000-0000-0000-0000-0000000000d1'$$),
  'ok', 'AC-QSO-002 a purchase accepts its own organisation''s company');
select is((select vendor_id from procurements where id='27450000-0000-0000-0000-0000000000d1'), '27450000-0000-0000-0000-0000000000c1'::uuid,
  'AC-QSO-002 the purchase kept its own supplier');

-- A legacy row that already violates the rule: an unrelated update still saves; only a real change of supplier is checked.
select is(pg_temp.err('a1', $$update procurements set title='renamed', vendor_id=vendor_id where id='27450000-0000-0000-0000-0000000000f1'$$),
  'ok', 'AC-QSO-004 an unrelated update of a row that already violates the rule passes');
select is(pg_temp.err('a1', $$update procurements set vendor_id='27450000-0000-0000-0000-0000000000c3' where id='27450000-0000-0000-0000-0000000000f1'$$),
  'P0002 supplier not found', 'AC-QSO-004 changing such a row''s supplier to another foreign company is refused');
select is(pg_temp.err('a1', $$update procurements set vendor_id='27450000-0000-0000-0000-0000000000c1' where id='27450000-0000-0000-0000-0000000000f1'$$),
  'ok', 'AC-QSO-004 changing such a row''s supplier to its own organisation''s company is accepted');

-- The real writers.
select is(pg_temp.err('a1', $$select set_procurement_supplier('27450000-0000-0000-0000-0000000000e1','27450000-0000-0000-0000-0000000000c2')$$),
  '23514 PRC_SUPPLIER_INVALID', 'AC-QSO-005 set_procurement_supplier refuses another organisation''s company');
select is(pg_temp.err('a1', $$select set_procurement_supplier('27450000-0000-0000-0000-0000000000e1','27450000-0000-0000-0000-0000000000c1')$$),
  'ok', 'AC-QSO-005 set_procurement_supplier accepts its own organisation''s company');
select is(pg_temp.err('a1', $$select create_procurement_quotation('27450000-0000-0000-0000-0000000000e2','27450000-0000-0000-0000-0000000000c1',70,current_date)$$),
  'ok', 'AC-QSO-006 setup: an own-organisation quote is added to the purchase');
select is(pg_temp.err('a1', $$select select_procurement_quote((select id from procurement_quotations where procurement_id='27450000-0000-0000-0000-0000000000e2'))$$),
  'ok', 'AC-QSO-006 select_procurement_quote copies an own-organisation supplier onto the purchase');
select is((select vendor_id from procurements where id='27450000-0000-0000-0000-0000000000e2'), '27450000-0000-0000-0000-0000000000c1'::uuid,
  'AC-QSO-006 the purchase holds the selected quote''s supplier');
select is(pg_temp.err('a1', $$select select_procurement_quote('27450000-0000-0000-0000-0000000000a9')$$),
  'ok', 'AC-QSO-006 selecting a legacy quote whose supplier the purchase already holds saves (supplier unchanged)');
select is(pg_temp.err('a1', $$select create_procurement_with_items('27450000-0000-0000-0000-0000000000a8', '{"title":"QSO new","vendor_id":"27450000-0000-0000-0000-0000000000c2"}'::jsonb, '[]'::jsonb)$$),
  '23503 Reference is not available', 'AC-QSO-007 create_procurement_with_items refuses another organisation''s company');
select is((select count(*) from procurements where id='27450000-0000-0000-0000-0000000000a8'), 0::bigint, 'AC-QSO-007 no purchase was written');
select is(pg_temp.err('a1', $$select create_procurement_with_items('27450000-0000-0000-0000-0000000000a7', '{"title":"QSO new own","vendor_id":"27450000-0000-0000-0000-0000000000c1"}'::jsonb, '[]'::jsonb)$$),
  'ok', 'AC-QSO-007 create_procurement_with_items accepts its own organisation''s company');

-- A service-role insert is held to the same rule (the trigger does not look at who writes).
set local role service_role;
select throws_ok($$insert into procurements (org_id, title, status, currency, requested_by_id, vendor_id) values ('27450000-0000-0000-0000-0000000000a0','QSO svc','Draft','IDR','27450000-0000-0000-0000-0000000000a1','27450000-0000-0000-0000-0000000000c2')$$,
  'P0002', 'supplier not found', 'AC-QSO-008 a service-role insert naming another organisation''s company is refused');
reset role;

select finish();
rollback;
