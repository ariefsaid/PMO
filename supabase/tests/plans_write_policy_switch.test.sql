-- AC-PLN-005 / FR-PLN-006: procurement table write policies retain their authorization predicates
-- and also follow the procurement entitlement, across INSERT, UPDATE and DELETE.
begin;
select plan(54);

insert into organizations (id, name) values
  ('17830000-0000-0000-0000-000000000001', 'Policy Switch Org A'),
  ('17830000-0000-0000-0000-000000000002', 'Policy Switch Org B');
insert into auth.users (id, email) values
  ('17830000-0000-0000-0000-0000000000a1', 'policy-switch-admin@example.invalid'),
  ('17830000-0000-0000-0000-0000000000a2', 'policy-switch-engineer@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17830000-0000-0000-0000-0000000000a1', '17830000-0000-0000-0000-000000000001', 'Policy Switch Admin', 'policy-switch-admin@example.invalid', 'Admin', 'active'),
  ('17830000-0000-0000-0000-0000000000a2', '17830000-0000-0000-0000-000000000001', 'Policy Switch Engineer', 'policy-switch-engineer@example.invalid', 'Engineer', 'active');
insert into procurements (id, org_id, title, status) values
  ('17830000-0000-0000-0000-000000000101', '17830000-0000-0000-0000-000000000001', 'Org A policy switch case', 'Draft'),
  ('17830000-0000-0000-0000-000000000102', '17830000-0000-0000-0000-000000000002', 'Org B policy switch case', 'Draft');
insert into org_features (org_id, feature_key, enabled) values
  ('17830000-0000-0000-0000-000000000001', 'procurement', true),
  ('17830000-0000-0000-0000-000000000002', 'procurement', true);

-- Granting only inside this rollback-only test isolates RLS policy behavior from table ACLs.
grant insert, update, delete on public.purchase_orders, public.procurement_receipts,
  public.procurement_invoices, public.payments to authenticated;

-- Seed update, delete, other-org, off-switch, and disallowed-role targets. The other-org rows
-- deliberately point at Org A's parent so the org_id predicate is what scopes the target row.
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('17830000-0000-0000-0000-000000000111', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'PO-1783-UPDATE', 'Issued', current_date, 'IDR'),
  ('17830000-0000-0000-0000-000000000121', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'PO-1783-DELETE', 'Issued', current_date, 'IDR'),
  ('17830000-0000-0000-0000-000000000131', '17830000-0000-0000-0000-000000000002', '17830000-0000-0000-0000-000000000101', 'PO-1783-OTHER-ORG', 'Issued', current_date, 'IDR'),
  ('17830000-0000-0000-0000-000000000141', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'PO-1783-OFF', 'Issued', current_date, 'IDR'),
  ('17830000-0000-0000-0000-000000000151', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'PO-1783-ROLE', 'Issued', current_date, 'IDR');
insert into procurement_receipts (id, org_id, procurement_id, gr_number, receipt_date, status) values
  ('17830000-0000-0000-0000-000000000112', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'GR-1783-UPDATE', current_date, 'Complete'),
  ('17830000-0000-0000-0000-000000000122', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'GR-1783-DELETE', current_date, 'Complete'),
  ('17830000-0000-0000-0000-000000000132', '17830000-0000-0000-0000-000000000002', '17830000-0000-0000-0000-000000000101', 'GR-1783-OTHER-ORG', current_date, 'Complete'),
  ('17830000-0000-0000-0000-000000000142', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'GR-1783-OFF', current_date, 'Complete'),
  ('17830000-0000-0000-0000-000000000152', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'GR-1783-ROLE', current_date, 'Complete');
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, currency, tax_treatment, tax_amount) values
  ('17830000-0000-0000-0000-000000000113', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'VI-1783-UPDATE', current_date, 'Received', 100, 'IDR', 'exclusive', 0),
  ('17830000-0000-0000-0000-000000000123', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'VI-1783-DELETE', current_date, 'Received', 100, 'IDR', 'exclusive', 0),
  ('17830000-0000-0000-0000-000000000133', '17830000-0000-0000-0000-000000000002', '17830000-0000-0000-0000-000000000101', 'VI-1783-OTHER-ORG', current_date, 'Received', 100, 'IDR', 'exclusive', 0),
  ('17830000-0000-0000-0000-000000000143', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'VI-1783-OFF', current_date, 'Received', 100, 'IDR', 'exclusive', 0),
  ('17830000-0000-0000-0000-000000000153', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'VI-1783-ROLE', current_date, 'Received', 100, 'IDR', 'exclusive', 0);
insert into payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('17830000-0000-0000-0000-000000000114', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'Scheduled', current_date, 100, 'IDR'),
  ('17830000-0000-0000-0000-000000000124', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'Scheduled', current_date, 100, 'IDR'),
  ('17830000-0000-0000-0000-000000000134', '17830000-0000-0000-0000-000000000002', '17830000-0000-0000-0000-000000000101', 'Scheduled', current_date, 100, 'IDR'),
  ('17830000-0000-0000-0000-000000000144', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'Scheduled', current_date, 100, 'IDR'),
  ('17830000-0000-0000-0000-000000000154', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000101', 'Scheduled', current_date, 100, 'IDR');

-- All twelve commands retain their current row-scope, active-member and role predicates, plus the
-- non-raising entitlement predicate; SELECT policies remain ungated.
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename in ('purchase_orders','procurement_receipts','procurement_invoices','payments')
              and cmd in ('INSERT','UPDATE','DELETE')), 12,
  'AC-PLN-005 all twelve procurement write policies remain individually scoped');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename in ('purchase_orders','procurement_receipts','procurement_invoices','payments')
              and cmd in ('INSERT','UPDATE','DELETE')
              and coalesce(qual,'') || coalesce(with_check,'') like '%org_feature_enabled%'
              and coalesce(qual,'') || coalesce(with_check,'') like '%procurement%'), 12,
  'AC-PLN-005 each procurement write policy carries the non-raising procurement entitlement predicate');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename in ('purchase_orders','procurement_receipts','procurement_invoices','payments')
              and cmd in ('INSERT','UPDATE','DELETE')
              and coalesce(qual,'') || coalesce(with_check,'') like '%org_id = auth_org_id()%'), 12,
  'AC-PLN-005 every procurement write policy retains its org predicate');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename in ('purchase_orders','procurement_receipts','procurement_invoices','payments')
              and cmd in ('INSERT','UPDATE','DELETE')
              and coalesce(qual,'') || coalesce(with_check,'') like '%is_active_member%'), 12,
  'AC-PLN-005 every procurement write policy retains its active-member predicate');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename in ('purchase_orders','procurement_receipts','procurement_invoices','payments')
              and cmd in ('INSERT','UPDATE','DELETE')
              and coalesce(qual,'') || coalesce(with_check,'') like '%auth_role%'
              and coalesce(qual,'') || coalesce(with_check,'') like '%Admin%'
              and coalesce(qual,'') || coalesce(with_check,'') like '%Executive%'
              and coalesce(qual,'') || coalesce(with_check,'') like '%Project Manager%'
              and coalesce(qual,'') || coalesce(with_check,'') like '%Finance%'), 12,
  'AC-PLN-005 every procurement write policy retains its four-role allowlist');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename in ('purchase_orders','procurement_receipts','procurement_invoices','payments')
              and cmd = 'SELECT' and coalesce(qual,'') || coalesce(with_check,'') like '%org_feature_enabled%'), 0,
  'AC-PLN-005 procurement reads remain ungated');

-- With the switch on, an allowed role can INSERT, UPDATE and DELETE each table.
set local role authenticated;
set local request.jwt.claims = '{"sub":"17830000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency)
  values ('17830000-0000-0000-0000-000000000161','17830000-0000-0000-0000-000000000001','17830000-0000-0000-0000-000000000101','PO-1783-ON','Issued',current_date,'IDR') $$,
  'AC-PLN-005 procurement on permits an allowed-role purchase_orders INSERT');
select lives_ok($$ insert into procurement_receipts (id, org_id, procurement_id, gr_number, receipt_date, status)
  values ('17830000-0000-0000-0000-000000000162','17830000-0000-0000-0000-000000000001','17830000-0000-0000-0000-000000000101','GR-1783-ON',current_date,'Complete') $$,
  'AC-PLN-005 procurement on permits an allowed-role procurement_receipts INSERT');
select lives_ok($$ insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, currency, tax_treatment, tax_amount)
  values ('17830000-0000-0000-0000-000000000163','17830000-0000-0000-0000-000000000001','17830000-0000-0000-0000-000000000101','VI-1783-ON',current_date,'Received',100,'IDR','exclusive',0) $$,
  'AC-PLN-005 procurement on permits an allowed-role procurement_invoices INSERT');
select lives_ok($$ insert into payments (id, org_id, procurement_id, status, date, amount, currency)
  values ('17830000-0000-0000-0000-000000000164','17830000-0000-0000-0000-000000000001','17830000-0000-0000-0000-000000000101','Scheduled',current_date,100,'IDR') $$,
  'AC-PLN-005 procurement on permits an allowed-role payments INSERT');
with changed as (update purchase_orders set reference_number = 'PO-1783-UPDATED' where id = '17830000-0000-0000-0000-000000000111' returning id)
select is((select count(*)::int from changed), 1, 'AC-PLN-005 procurement on permits purchase_orders UPDATE');
with changed as (update procurement_receipts set gr_number = 'GR-1783-UPDATED' where id = '17830000-0000-0000-0000-000000000112' returning id)
select is((select count(*)::int from changed), 1, 'AC-PLN-005 procurement on permits procurement_receipts UPDATE');
with changed as (update procurement_invoices set vi_number = 'VI-1783-UPDATED' where id = '17830000-0000-0000-0000-000000000113' returning id)
select is((select count(*)::int from changed), 1, 'AC-PLN-005 procurement on permits procurement_invoices UPDATE');
with changed as (update payments set reference_number = 'PAY-1783-UPDATED' where id = '17830000-0000-0000-0000-000000000114' returning id)
select is((select count(*)::int from changed), 1, 'AC-PLN-005 procurement on permits payments UPDATE');
with removed as (delete from purchase_orders where id = '17830000-0000-0000-0000-000000000121' returning id)
select is((select count(*)::int from removed), 1, 'AC-PLN-005 procurement on permits purchase_orders DELETE');
with removed as (delete from procurement_receipts where id = '17830000-0000-0000-0000-000000000122' returning id)
select is((select count(*)::int from removed), 1, 'AC-PLN-005 procurement on permits procurement_receipts DELETE');
with removed as (delete from procurement_invoices where id = '17830000-0000-0000-0000-000000000123' returning id)
select is((select count(*)::int from removed), 1, 'AC-PLN-005 procurement on permits procurement_invoices DELETE');
with removed as (delete from payments where id = '17830000-0000-0000-0000-000000000124' returning id)
select is((select count(*)::int from removed), 1, 'AC-PLN-005 procurement on permits payments DELETE');

-- A row stamped for another org is refused on each INSERT, and its existing row stays outside the
-- caller's UPDATE and DELETE target set.
select throws_ok($$ insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency)
  values ('17830000-0000-0000-0000-000000000191','17830000-0000-0000-0000-000000000002','17830000-0000-0000-0000-000000000101','PO-1783-OTHER-INSERT','Issued',current_date,'IDR') $$,
  '42501', null, 'AC-PLN-005 another org cannot INSERT a purchase_orders row');
select throws_ok($$ insert into procurement_receipts (id, org_id, procurement_id, gr_number, receipt_date, status)
  values ('17830000-0000-0000-0000-000000000192','17830000-0000-0000-0000-000000000002','17830000-0000-0000-0000-000000000101','GR-1783-OTHER-INSERT',current_date,'Complete') $$,
  '42501', null, 'AC-PLN-005 another org cannot INSERT a procurement_receipts row');
select throws_ok($$ insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, currency, tax_treatment, tax_amount)
  values ('17830000-0000-0000-0000-000000000193','17830000-0000-0000-0000-000000000002','17830000-0000-0000-0000-000000000101','VI-1783-OTHER-INSERT',current_date,'Received',100,'IDR','exclusive',0) $$,
  '42501', null, 'AC-PLN-005 another org cannot INSERT a procurement_invoices row');
select throws_ok($$ insert into payments (id, org_id, procurement_id, status, date, amount, currency)
  values ('17830000-0000-0000-0000-000000000194','17830000-0000-0000-0000-000000000002','17830000-0000-0000-0000-000000000101','Scheduled',current_date,100,'IDR') $$,
  '42501', null, 'AC-PLN-005 another org cannot INSERT a payments row');
with changed as (update purchase_orders set reference_number = 'cross-org' where id = '17830000-0000-0000-0000-000000000131' returning id)
select is((select count(*)::int from changed), 0, 'AC-PLN-005 another org cannot UPDATE a purchase_orders row');
with changed as (update procurement_receipts set gr_number = 'cross-org' where id = '17830000-0000-0000-0000-000000000132' returning id)
select is((select count(*)::int from changed), 0, 'AC-PLN-005 another org cannot UPDATE a procurement_receipts row');
with changed as (update procurement_invoices set vi_number = 'cross-org' where id = '17830000-0000-0000-0000-000000000133' returning id)
select is((select count(*)::int from changed), 0, 'AC-PLN-005 another org cannot UPDATE a procurement_invoices row');
with changed as (update payments set reference_number = 'cross-org' where id = '17830000-0000-0000-0000-000000000134' returning id)
select is((select count(*)::int from changed), 0, 'AC-PLN-005 another org cannot UPDATE a payments row');
with removed as (delete from purchase_orders where id = '17830000-0000-0000-0000-000000000131' returning id)
select is((select count(*)::int from removed), 0, 'AC-PLN-005 another org cannot DELETE a purchase_orders row');
with removed as (delete from procurement_receipts where id = '17830000-0000-0000-0000-000000000132' returning id)
select is((select count(*)::int from removed), 0, 'AC-PLN-005 another org cannot DELETE a procurement_receipts row');
with removed as (delete from procurement_invoices where id = '17830000-0000-0000-0000-000000000133' returning id)
select is((select count(*)::int from removed), 0, 'AC-PLN-005 another org cannot DELETE a procurement_invoices row');
with removed as (delete from payments where id = '17830000-0000-0000-0000-000000000134' returning id)
select is((select count(*)::int from removed), 0, 'AC-PLN-005 another org cannot DELETE a payments row');

-- An active Engineer does not gain write access from a switch that is on.
reset role;
set local request.jwt.claims = '{"sub":"17830000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency)
  values ('17830000-0000-0000-0000-000000000181','17830000-0000-0000-0000-000000000001','17830000-0000-0000-0000-000000000101','PO-1783-ROLE-INSERT','Issued',current_date,'IDR') $$,
  '42501', null, 'AC-PLN-005 a disallowed role cannot INSERT a purchase_orders row');
select throws_ok($$ insert into procurement_receipts (id, org_id, procurement_id, gr_number, receipt_date, status)
  values ('17830000-0000-0000-0000-000000000182','17830000-0000-0000-0000-000000000001','17830000-0000-0000-0000-000000000101','GR-1783-ROLE-INSERT',current_date,'Complete') $$,
  '42501', null, 'AC-PLN-005 a disallowed role cannot INSERT a procurement_receipts row');
select throws_ok($$ insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, currency, tax_treatment, tax_amount)
  values ('17830000-0000-0000-0000-000000000183','17830000-0000-0000-0000-000000000001','17830000-0000-0000-0000-000000000101','VI-1783-ROLE-INSERT',current_date,'Received',100,'IDR','exclusive',0) $$,
  '42501', null, 'AC-PLN-005 a disallowed role cannot INSERT a procurement_invoices row');
select throws_ok($$ insert into payments (id, org_id, procurement_id, status, date, amount, currency)
  values ('17830000-0000-0000-0000-000000000184','17830000-0000-0000-0000-000000000001','17830000-0000-0000-0000-000000000101','Scheduled',current_date,100,'IDR') $$,
  '42501', null, 'AC-PLN-005 a disallowed role cannot INSERT a payments row');
with changed as (update purchase_orders set reference_number = 'disallowed-role' where id = '17830000-0000-0000-0000-000000000151' returning id)
select is((select count(*)::int from changed), 0, 'AC-PLN-005 a disallowed role cannot UPDATE a purchase_orders row');
with changed as (update procurement_receipts set gr_number = 'disallowed-role' where id = '17830000-0000-0000-0000-000000000152' returning id)
select is((select count(*)::int from changed), 0, 'AC-PLN-005 a disallowed role cannot UPDATE a procurement_receipts row');
with changed as (update procurement_invoices set vi_number = 'disallowed-role' where id = '17830000-0000-0000-0000-000000000153' returning id)
select is((select count(*)::int from changed), 0, 'AC-PLN-005 a disallowed role cannot UPDATE a procurement_invoices row');
with changed as (update payments set reference_number = 'disallowed-role' where id = '17830000-0000-0000-0000-000000000154' returning id)
select is((select count(*)::int from changed), 0, 'AC-PLN-005 a disallowed role cannot UPDATE a payments row');
with removed as (delete from purchase_orders where id = '17830000-0000-0000-0000-000000000151' returning id)
select is((select count(*)::int from removed), 0, 'AC-PLN-005 a disallowed role cannot DELETE a purchase_orders row');
with removed as (delete from procurement_receipts where id = '17830000-0000-0000-0000-000000000152' returning id)
select is((select count(*)::int from removed), 0, 'AC-PLN-005 a disallowed role cannot DELETE a procurement_receipts row');
with removed as (delete from procurement_invoices where id = '17830000-0000-0000-0000-000000000153' returning id)
select is((select count(*)::int from removed), 0, 'AC-PLN-005 a disallowed role cannot DELETE a procurement_invoices row');
with removed as (delete from payments where id = '17830000-0000-0000-0000-000000000154' returning id)
select is((select count(*)::int from removed), 0, 'AC-PLN-005 a disallowed role cannot DELETE a payments row');

-- Turning off procurement blocks each table's INSERT and leaves UPDATE/DELETE unable to reach rows.
reset role;
update org_features set enabled = false
 where org_id = '17830000-0000-0000-0000-000000000001' and feature_key = 'procurement';
set local request.jwt.claims = '{"sub":"17830000-0000-0000-0000-0000000000a1","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency)
  values ('17830000-0000-0000-0000-000000000171','17830000-0000-0000-0000-000000000001','17830000-0000-0000-0000-000000000101','PO-1783-OFF-INSERT','Issued',current_date,'IDR') $$,
  '42501', null, 'AC-PLN-005 procurement off refuses purchase_orders INSERT');
select throws_ok($$ insert into procurement_receipts (id, org_id, procurement_id, gr_number, receipt_date, status)
  values ('17830000-0000-0000-0000-000000000172','17830000-0000-0000-0000-000000000001','17830000-0000-0000-0000-000000000101','GR-1783-OFF-INSERT',current_date,'Complete') $$,
  '42501', null, 'AC-PLN-005 procurement off refuses procurement_receipts INSERT');
select throws_ok($$ insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, currency, tax_treatment, tax_amount)
  values ('17830000-0000-0000-0000-000000000173','17830000-0000-0000-0000-000000000001','17830000-0000-0000-0000-000000000101','VI-1783-OFF-INSERT',current_date,'Received',100,'IDR','exclusive',0) $$,
  '42501', null, 'AC-PLN-005 procurement off refuses procurement_invoices INSERT');
select throws_ok($$ insert into payments (id, org_id, procurement_id, status, date, amount, currency)
  values ('17830000-0000-0000-0000-000000000174','17830000-0000-0000-0000-000000000001','17830000-0000-0000-0000-000000000101','Scheduled',current_date,100,'IDR') $$,
  '42501', null, 'AC-PLN-005 procurement off refuses payments INSERT');
with changed as (update purchase_orders set reference_number = 'switch-off' where id = '17830000-0000-0000-0000-000000000141' returning id)
select is((select count(*)::int from changed), 0, 'AC-PLN-005 procurement off refuses purchase_orders UPDATE');
with changed as (update procurement_receipts set gr_number = 'switch-off' where id = '17830000-0000-0000-0000-000000000142' returning id)
select is((select count(*)::int from changed), 0, 'AC-PLN-005 procurement off refuses procurement_receipts UPDATE');
with changed as (update procurement_invoices set vi_number = 'switch-off' where id = '17830000-0000-0000-0000-000000000143' returning id)
select is((select count(*)::int from changed), 0, 'AC-PLN-005 procurement off refuses procurement_invoices UPDATE');
with changed as (update payments set reference_number = 'switch-off' where id = '17830000-0000-0000-0000-000000000144' returning id)
select is((select count(*)::int from changed), 0, 'AC-PLN-005 procurement off refuses payments UPDATE');
with removed as (delete from purchase_orders where id = '17830000-0000-0000-0000-000000000141' returning id)
select is((select count(*)::int from removed), 0, 'AC-PLN-005 procurement off refuses purchase_orders DELETE');
with removed as (delete from procurement_receipts where id = '17830000-0000-0000-0000-000000000142' returning id)
select is((select count(*)::int from removed), 0, 'AC-PLN-005 procurement off refuses procurement_receipts DELETE');
with removed as (delete from procurement_invoices where id = '17830000-0000-0000-0000-000000000143' returning id)
select is((select count(*)::int from removed), 0, 'AC-PLN-005 procurement off refuses procurement_invoices DELETE');
with removed as (delete from payments where id = '17830000-0000-0000-0000-000000000144' returning id)
select is((select count(*)::int from removed), 0, 'AC-PLN-005 procurement off refuses payments DELETE');

reset role;
select * from finish();
rollback;
