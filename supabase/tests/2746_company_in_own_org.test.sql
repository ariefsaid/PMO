begin;
create extension if not exists pgtap;
select plan(33);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27460000-0000-0000-0000-0000000000a0', 'CIO Org A', 'IDR', 'UTC'),
  ('27460000-0000-0000-0000-0000000000b0', 'CIO Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('27460000-0000-0000-0000-0000000000a1', 'cio-a1@example.com'),
  ('27460000-0000-0000-0000-0000000000a2', 'cio-a2@example.com'),
  ('27460000-0000-0000-0000-0000000000b1', 'cio-b1@example.com'),
  ('27460000-0000-0000-0000-0000000000b2', 'cio-b2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27460000-0000-0000-0000-0000000000a1', '27460000-0000-0000-0000-0000000000a0', 'PM A', 'cio-a1@example.com', 'Project Manager', 'active'),
  ('27460000-0000-0000-0000-0000000000a2', '27460000-0000-0000-0000-0000000000a0', 'Fin A', 'cio-a2@example.com', 'Finance', 'active'),
  ('27460000-0000-0000-0000-0000000000b1', '27460000-0000-0000-0000-0000000000b0', 'PM B', 'cio-b1@example.com', 'Project Manager', 'active'),
  ('27460000-0000-0000-0000-0000000000b2', '27460000-0000-0000-0000-0000000000b0', 'Fin B', 'cio-b2@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('27460000-0000-0000-0000-0000000000c1', '27460000-0000-0000-0000-0000000000a0', 'CIO Own Client', 'Client'),
  ('27460000-0000-0000-0000-0000000000c2', '27460000-0000-0000-0000-0000000000b0', 'CIO Other Client', 'Client');
insert into contacts (id, org_id, company_id, full_name) values
  ('27460000-0000-0000-0000-0000000000e1', '27460000-0000-0000-0000-0000000000a0', '27460000-0000-0000-0000-0000000000c1', 'CIO Contact A'),
  ('27460000-0000-0000-0000-0000000000e2', '27460000-0000-0000-0000-0000000000b0', '27460000-0000-0000-0000-0000000000c2', 'CIO Contact B');
insert into projects (id, org_id, name) values
  ('27460000-0000-0000-0000-0000000000d1', '27460000-0000-0000-0000-0000000000a0', 'CIO Project A'),
  ('27460000-0000-0000-0000-0000000000d2', '27460000-0000-0000-0000-0000000000b0', 'CIO Project B');

-- Legacy rows that already violate (written before the rule): made so with triggers off.
insert into projects (id, org_id, name, client_id) values
  ('27460000-0000-0000-0000-0000000000d3', '27460000-0000-0000-0000-0000000000a0', 'CIO Legacy project', '27460000-0000-0000-0000-0000000000c1');
insert into sales_invoices (id, org_id, project_id, customer_id, reference_number, amount, currency, tax_treatment, tax_amount, invoice_date) values
  ('27460000-0000-0000-0000-0000000000f3', '27460000-0000-0000-0000-0000000000a0', '27460000-0000-0000-0000-0000000000d1', '27460000-0000-0000-0000-0000000000c1', 'CIO-LEG', 1, 'IDR', 'exclusive', 0, current_date);
insert into incoming_payments (id, org_id, customer_id, date, amount, currency) values
  ('27460000-0000-0000-0000-0000000000a3', '27460000-0000-0000-0000-0000000000a0', '27460000-0000-0000-0000-0000000000c1', current_date, 1, 'IDR');
insert into crm_activities (id, org_id, contact_id, company_id, kind, subject, occurred_at, logged_by_id) values
  ('27460000-0000-0000-0000-0000000000b3', '27460000-0000-0000-0000-0000000000a0', '27460000-0000-0000-0000-0000000000e1', '27460000-0000-0000-0000-0000000000c1', 'Note', 'legacy', now(), '27460000-0000-0000-0000-0000000000a1');
set local session_replication_role = replica;
update projects set client_id = '27460000-0000-0000-0000-0000000000c2' where id = '27460000-0000-0000-0000-0000000000d3';
update sales_invoices set customer_id = '27460000-0000-0000-0000-0000000000c2' where id = '27460000-0000-0000-0000-0000000000f3';
update incoming_payments set customer_id = '27460000-0000-0000-0000-0000000000c2' where id = '27460000-0000-0000-0000-0000000000a3';
update crm_activities set company_id = '27460000-0000-0000-0000-0000000000c2' where id = '27460000-0000-0000-0000-0000000000b3';
set local session_replication_role = origin;

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"27460000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return 'ok';
exception when others then
  execute 'reset role';
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;

-- projects.client_id (Project Manager)
select is(pg_temp.err('a1', $$insert into projects (org_id, name, client_id) values ('27460000-0000-0000-0000-0000000000a0','p','27460000-0000-0000-0000-0000000000c2')$$),
  '42501 project_number_client_org_mismatch', 'AC-CIO-001 a project cannot be created with another organisation''s client (already closed by the numbering trigger, 0231)');
select is(pg_temp.err('a1', $$insert into projects (org_id, name, client_id) values ('27460000-0000-0000-0000-0000000000a0','p','27460000-0000-0000-0000-0000000000ff')$$),
  '42501 project_number_client_org_mismatch', 'AC-CIO-001 a nonexistent client id gets the same answer on create');
select is(pg_temp.err('a1', $$insert into projects (org_id, name, client_id) values ('27460000-0000-0000-0000-0000000000a0','p','27460000-0000-0000-0000-0000000000c1')$$),
  'ok', 'AC-CIO-002 own organisation''s client accepted on create');
select is(pg_temp.err('a1', $$update projects set client_id='27460000-0000-0000-0000-0000000000c2' where id='27460000-0000-0000-0000-0000000000d1'$$),
  'P0002 company not found', 'AC-CIO-001 a project cannot be moved to another organisation''s client');
select is(pg_temp.err('a1', $$update projects set client_id='27460000-0000-0000-0000-0000000000c1' where id='27460000-0000-0000-0000-0000000000d1'$$),
  'ok', 'AC-CIO-002 a project can be moved to its own organisation''s client');
select is(pg_temp.err('a1', $$update projects set name='renamed' where id='27460000-0000-0000-0000-0000000000d3'$$),
  'ok', 'AC-CIO-004 an unrelated edit of a legacy violating project passes');
select is(pg_temp.err('b1', $$insert into projects (org_id, name, client_id) values ('27460000-0000-0000-0000-0000000000b0','p','27460000-0000-0000-0000-0000000000c2')$$),
  'ok', 'AC-CIO-003 the other organisation uses its own client, unaffected');
select is(pg_temp.err('a1', $$update projects set client_id=null where id='27460000-0000-0000-0000-0000000000d1'$$),
  'ok', 'AC-CIO-005 clearing the client stays allowed');

-- sales_invoices.customer_id (Finance, direct write)
select is(pg_temp.err('a2', $$insert into sales_invoices (org_id, project_id, customer_id, reference_number, amount, currency, tax_treatment, tax_amount, invoice_date) values ('27460000-0000-0000-0000-0000000000a0','27460000-0000-0000-0000-0000000000d1','27460000-0000-0000-0000-0000000000c2','CIO-1',1,'IDR','exclusive',0,current_date)$$),
  'P0002 company not found', 'AC-CIO-001 an invoice cannot name another organisation''s customer');
select is(pg_temp.err('a2', $$insert into sales_invoices (org_id, project_id, customer_id, reference_number, amount, currency, tax_treatment, tax_amount, invoice_date) values ('27460000-0000-0000-0000-0000000000a0','27460000-0000-0000-0000-0000000000d1','27460000-0000-0000-0000-0000000000ff','CIO-2',1,'IDR','exclusive',0,current_date)$$),
  'P0002 company not found', 'AC-CIO-001 a nonexistent customer id gives the identical answer');
select is(pg_temp.err('a2', $$insert into sales_invoices (org_id, project_id, customer_id, reference_number, amount, currency, tax_treatment, tax_amount, invoice_date) values ('27460000-0000-0000-0000-0000000000a0','27460000-0000-0000-0000-0000000000d1','27460000-0000-0000-0000-0000000000c1','CIO-3',1,'IDR','exclusive',0,current_date)$$),
  'ok', 'AC-CIO-002 own customer accepted');
select is(pg_temp.err('b2', $$insert into sales_invoices (org_id, project_id, customer_id, reference_number, amount, currency, tax_treatment, tax_amount, invoice_date) values ('27460000-0000-0000-0000-0000000000b0','27460000-0000-0000-0000-0000000000d2','27460000-0000-0000-0000-0000000000c2','CIO-4',1,'IDR','exclusive',0,current_date)$$),
  'ok', 'AC-CIO-003 the other organisation invoices its own customer, unaffected');
-- through the real writer (RPC)
select is(pg_temp.err('a2', $$select create_native_sales_invoice('27460000-0000-0000-0000-0000000000d1','27460000-0000-0000-0000-0000000000c2','[{"item_code":"SVC","description":"x","qty":1,"rate":10}]'::jsonb)$$),
  'P0002 customer not found', 'AC-CIO-001 the invoice function refuses a foreign customer as not found');

-- incoming_payments.customer_id (Finance, direct write)
select is(pg_temp.err('a2', $$insert into incoming_payments (org_id, customer_id, date, amount, currency) values ('27460000-0000-0000-0000-0000000000a0','27460000-0000-0000-0000-0000000000c2',current_date,5,'IDR')$$),
  'P0002 company not found', 'AC-CIO-001 a receipt cannot name another organisation''s customer');
select is(pg_temp.err('a2', $$insert into incoming_payments (org_id, customer_id, date, amount, currency) values ('27460000-0000-0000-0000-0000000000a0','27460000-0000-0000-0000-0000000000ff',current_date,5,'IDR')$$),
  'P0002 company not found', 'AC-CIO-001 a nonexistent customer id gives the identical answer');
select is(pg_temp.err('a2', $$insert into incoming_payments (org_id, customer_id, date, amount, currency) values ('27460000-0000-0000-0000-0000000000a0','27460000-0000-0000-0000-0000000000c1',current_date,5,'IDR')$$),
  'ok', 'AC-CIO-002 own customer accepted');
select is(pg_temp.err('b2', $$insert into incoming_payments (org_id, customer_id, date, amount, currency) values ('27460000-0000-0000-0000-0000000000b0','27460000-0000-0000-0000-0000000000c2',current_date,5,'IDR')$$),
  'ok', 'AC-CIO-003 the other organisation records a receipt for its own customer, unaffected');
select is(pg_temp.err('a2', $$select record_native_on_account_receipt('27460000-0000-0000-0000-0000000000c2', 5)$$),
  'P0002 customer not found', 'AC-CIO-001 the receipt function refuses a foreign customer as not found');

-- crm_activities.company_id (Project Manager)
select is(pg_temp.err('a1', $$insert into crm_activities (org_id, contact_id, company_id, kind, subject, occurred_at, logged_by_id) values ('27460000-0000-0000-0000-0000000000a0','27460000-0000-0000-0000-0000000000e1','27460000-0000-0000-0000-0000000000c2','Note','x',now(),'27460000-0000-0000-0000-0000000000a1')$$),
  'P0002 company not found', 'AC-CIO-001 an activity cannot name another organisation''s company');
select is(pg_temp.err('a1', $$insert into crm_activities (org_id, contact_id, company_id, kind, subject, occurred_at, logged_by_id) values ('27460000-0000-0000-0000-0000000000a0','27460000-0000-0000-0000-0000000000e1','27460000-0000-0000-0000-0000000000ff','Note','x',now(),'27460000-0000-0000-0000-0000000000a1')$$),
  'P0002 company not found', 'AC-CIO-001 a nonexistent company id gives the identical answer');
select is(pg_temp.err('a1', $$insert into crm_activities (org_id, contact_id, company_id, kind, subject, occurred_at, logged_by_id) values ('27460000-0000-0000-0000-0000000000a0','27460000-0000-0000-0000-0000000000e1','27460000-0000-0000-0000-0000000000c1','Note','x',now(),'27460000-0000-0000-0000-0000000000a1')$$),
  'ok', 'AC-CIO-002 own company accepted');
select is(pg_temp.err('a1', $$update crm_activities set company_id='27460000-0000-0000-0000-0000000000c2' where id='27460000-0000-0000-0000-0000000000b3'$$),
  'ok', 'AC-CIO-004 re-saving the same foreign company on a legacy activity is not a change');
select is(pg_temp.err('a1', $$update crm_activities set subject='edited' where id='27460000-0000-0000-0000-0000000000b3'$$),
  'ok', 'AC-CIO-004 an unrelated edit of a legacy violating activity passes');
select is(pg_temp.err('b1', $$insert into crm_activities (org_id, contact_id, company_id, kind, subject, occurred_at, logged_by_id) values ('27460000-0000-0000-0000-0000000000b0','27460000-0000-0000-0000-0000000000e2','27460000-0000-0000-0000-0000000000c2','Note','x',now(),'27460000-0000-0000-0000-0000000000b1')$$),
  'ok', 'AC-CIO-003 the other organisation logs against its own company, unaffected');

-- Changed-company UPDATE refusals.
-- crm_activities: the Project Manager holds the UPDATE grant on company_id, so the real role is used.
select is(pg_temp.err('a1', $$update crm_activities set company_id='27460000-0000-0000-0000-0000000000c2' where subject='x' and company_id='27460000-0000-0000-0000-0000000000c1'$$),
  'P0002 company not found', 'AC-CIO-001 an activity cannot be moved to another organisation''s company');
-- sales_invoices / incoming_payments: no user role holds UPDATE on customer_id, so the update trigger is dormant for users.
-- It is exercised as the table owner (the role a definer function or a future grant would write as).
create function pg_temp.err_owner(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;
select is(pg_temp.err_owner($$update sales_invoices set customer_id='27460000-0000-0000-0000-0000000000c2' where reference_number='CIO-3'$$),
  'P0002 company not found', 'AC-CIO-001 an invoice''s customer cannot be changed to another organisation''s company');
select is(pg_temp.err_owner($$update incoming_payments set customer_id='27460000-0000-0000-0000-0000000000c2' where org_id='27460000-0000-0000-0000-0000000000a0' and customer_id='27460000-0000-0000-0000-0000000000c1'$$),
  'P0002 company not found', 'AC-CIO-001 a receipt''s customer cannot be changed to another organisation''s company');

-- the untouched ones: no user-role write path on these (grants at head), so nothing to guard
select is((select count(*) from information_schema.column_privileges where grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE') and table_schema='public'
  and ((table_name='equipment_vendor_responses' and column_name='vendor_id') or (table_name='revenue_erp_mirror' and column_name='customer_company_id') or (table_name='third_party_inspections' and column_name='vendor_id'))), 0::bigint,
  'AC-CIO-006 no user role can write the vendor or customer column of the vendor responses, the revenue mirror or the inspections');

-- the function itself, called directly, is not open to the client roles
select is(has_function_privilege('authenticated', 'public.guard_company_in_own_organisation()', 'execute'), false, 'AC-CIO-007 the guard is not callable by users');
select is((select count(*) from pg_trigger where tgfoid = 'public.guard_company_in_own_organisation()'::regprocedure), 8::bigint, 'AC-CIO-007 four tables, an insert and an update trigger each');
select is((select count(*) from pg_trigger where tgfoid = 'public.guard_company_in_own_organisation()'::regprocedure and pg_get_triggerdef(oid) like '%WHEN%'), 8::bigint, 'AC-CIO-007 every trigger carries its WHEN clause');
select is((select count(*) from pg_trigger where tgfoid = 'public.guard_company_in_own_organisation()'::regprocedure and tgtype & 16 = 16 and pg_get_triggerdef(oid) like '%UPDATE OF%'), 4::bigint, 'AC-CIO-007 update triggers fire only on the column');
select is(pg_temp.err('a1', $$update projects set client_id='27460000-0000-0000-0000-0000000000c1' where id='27460000-0000-0000-0000-0000000000d1'$$),
  'ok', 'AC-CIO-002 own client re-save after the rules ran');

select finish();
rollback;
