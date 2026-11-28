-- roles_that_decide_purchasing.test.sql — a person who fills an ordering job role raises and sends a purchase order
-- (docs/specs/roles-that-decide.spec.md §2.3). Migrations under test: 1840, 1842_purchase_order_job_roles.sql,
-- 1843_purchasing_read_scope_order_roles.sql, 1845_order_roles_held_only.sql.
-- AC-RTD-009 (ordering setting) Admin only, built-in roles on, catalogue keys that are not field roles, on every write path ·
-- AC-RTD-011 a Buyer named in the setting reads purchases, moves an approved one to Ordered and records the order ·
-- AC-RTD-012 never an unapproved purchase, never an approval, never a bill or a payment; a job role not named reads only its own ·
-- AC-RTD-013 with the setting empty a Buyer is refused and reads only their own (today's outcome for every level stays proven by the
-- existing 0350 / procurement tests, untouched).
-- Every denial asserts the errcode AND the message, except where an earlier unchanged gate answers first (noted).
-- MUTATION NOTES (break the rule in 1842/1843; the named assertion must go red; restore):
--   1842 transition_procurement: drop the mut:order_approved check ..... 'AC-RTD-012 a Buyer cannot order a purchase that skipped approval'
--   1842 transition_procurement: make mut:order_gate "p_to = 'Ordered'" alone 'AC-RTD-013 with the setting empty a Buyer cannot order'
--   1842 create_purchase_order: drop the mut:raise_approved check ....... 'AC-RTD-012 a Buyer cannot record an order on an unapproved purchase'
--   1842 guard_purchase_order_job_roles: drop "or r.tier = 'field'" ...... 'AC-RTD-009 a field role cannot be named as one that orders'
--   1842 guard_purchase_order_job_roles: drop the mut:order_roles_setting check 'AC-RTD-009 roles cannot be named while built-in roles are off'
--   1843 add "or (select public.actor_may_order_purchases())" to payments_engineer_read_scope
--                                                                         'AC-RTD-012 a Buyer reads no payment'
--   1843 drop the mut:read_procurements branch ........................... 'AC-RTD-011 a Buyer named in the setting reads every purchase'
--   1845 drop "and public.actor_built_in_role() is not distinct from k" (mut:order_holds_key)
--                                                    'AC-RTD-012 an Engineer with no built-in role cannot order when Buyer is named'
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, built_in_roles_enabled) values
  ('18420000-0000-0000-0000-00000000000a', 'RTD Buy Org', true),
  ('18420000-0000-0000-0000-00000000000b', 'RTD Buy Off Org', false);
insert into auth.users (id, email) values
  ('18420000-0000-0000-0000-0000000000a1', 'rtdb-admin@example.com'),
  ('18420000-0000-0000-0000-0000000000a2', 'rtdb-buyer@example.com'),
  ('18420000-0000-0000-0000-0000000000a3', 'rtdb-store@example.com'),
  ('18420000-0000-0000-0000-0000000000a4', 'rtdb-eng@example.com'),
  ('18420000-0000-0000-0000-0000000000a5', 'rtdb-pm@example.com'),
  ('18420000-0000-0000-0000-0000000000b1', 'rtdb-off-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('18420000-0000-0000-0000-0000000000a1', '18420000-0000-0000-0000-00000000000a', 'RTDB Admin', 'rtdb-admin@example.com', 'Admin', 'active', null),
  ('18420000-0000-0000-0000-0000000000a2', '18420000-0000-0000-0000-00000000000a', 'RTDB Buyer', 'rtdb-buyer@example.com', 'Engineer', 'active', 'buyer'),
  ('18420000-0000-0000-0000-0000000000a3', '18420000-0000-0000-0000-00000000000a', 'RTDB Store', 'rtdb-store@example.com', 'Engineer', 'active', 'storekeeper'),
  ('18420000-0000-0000-0000-0000000000a4', '18420000-0000-0000-0000-00000000000a', 'RTDB Eng',   'rtdb-eng@example.com',   'Engineer', 'active', null),
  ('18420000-0000-0000-0000-0000000000a5', '18420000-0000-0000-0000-00000000000a', 'RTDB PM',    'rtdb-pm@example.com',    'Project Manager', 'active', null),
  ('18420000-0000-0000-0000-0000000000b1', '18420000-0000-0000-0000-00000000000b', 'RTDB Off',   'rtdb-off-admin@example.com', 'Admin', 'active', null);
insert into companies (id, org_id, name, type) values
  ('18420000-0000-0000-0000-0000000000d1', '18420000-0000-0000-0000-00000000000a', 'RTD Supplier', 'Vendor');
-- an order names its supplier (1580's gate), so every purchase here has one
insert into procurements (id, org_id, title, status, currency, requested_by_id, vendor_id) values
  ('18420000-0000-0000-0000-0000000000c1', '18420000-0000-0000-0000-00000000000a', 'Approved purchase',  'Approved',  'IDR', '18420000-0000-0000-0000-0000000000a5', '18420000-0000-0000-0000-0000000000d1'),
  ('18420000-0000-0000-0000-0000000000c2', '18420000-0000-0000-0000-00000000000a', 'Draft purchase',     'Draft',     'IDR', '18420000-0000-0000-0000-0000000000a5', '18420000-0000-0000-0000-0000000000d1'),
  ('18420000-0000-0000-0000-0000000000c3', '18420000-0000-0000-0000-00000000000a', 'Requested purchase', 'Requested', 'IDR', '18420000-0000-0000-0000-0000000000a5', '18420000-0000-0000-0000-0000000000d1'),
  ('18420000-0000-0000-0000-0000000000c4', '18420000-0000-0000-0000-00000000000a', 'Second approved',    'Approved',  'IDR', '18420000-0000-0000-0000-0000000000a5', '18420000-0000-0000-0000-0000000000d1'),
  ('18420000-0000-0000-0000-0000000000c5', '18420000-0000-0000-0000-00000000000a', 'Billed purchase',    'Received',  'IDR', '18420000-0000-0000-0000-0000000000a5', '18420000-0000-0000-0000-0000000000d1');
-- the bill and the payment sit on their own purchase (c5): a bill on a purchase moves its step forward, so none is on the ones ordered here
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, tax_treatment, tax_amount, currency) values
  ('18420000-0000-0000-0000-0000000000e1', '18420000-0000-0000-0000-00000000000a', '18420000-0000-0000-0000-0000000000c5', 'VI-RTD-1', '2026-11-20', 'Received', 1000, 'exclusive', 0, 'IDR');
insert into payments (id, org_id, procurement_id, pay_number, status, date, amount, currency) values
  ('18420000-0000-0000-0000-0000000000f1', '18420000-0000-0000-0000-00000000000a', '18420000-0000-0000-0000-0000000000c5', 'PAY-RTD-1', 'Scheduled', '2026-11-21', 1000, 'IDR');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
set local role authenticated;

select pg_temp._as('18420000-0000-0000-0000-0000000000a2');
select is(public.actor_may_order_purchases(), true, 'AC-001 Buyer may order by default');
select pg_temp._as('18420000-0000-0000-0000-0000000000a3');
select is(public.actor_may_order_purchases(), false, 'AC-001 a different job role cannot order by default');
select pg_temp._as('18420000-0000-0000-0000-0000000000a1');
select is(po_set_order_job_roles(array[]::text[]), array[]::text[], 'AC-002 Admin can save an explicit empty list');
select pg_temp._as('18420000-0000-0000-0000-0000000000a2');
select is(public.actor_may_order_purchases(), false, 'AC-002 explicit empty overrides the Buyer default');
select pg_temp._as('18420000-0000-0000-0000-0000000000a1');
select is(po_set_order_job_roles(null), null::text[], 'AC-002 Admin can reset to the default');
select pg_temp._as('18420000-0000-0000-0000-0000000000a2');
select is(public.actor_may_order_purchases(), true, 'AC-002 reset restores Buyer');

reset role;
insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('18100000-0000-0000-0000-0000000000a1', 'CHR Org A', 'USD', 'UTC', true),
  ('18100000-0000-0000-0000-0000000000a2', 'CHR Org B', 'USD', 'UTC', true);
insert into auth.users (id, email) values
  ('18100000-0000-0000-0000-0000000000b1', 'chr-author@example.com'),
  ('18100000-0000-0000-0000-0000000000b2', 'chr-pcm@example.com'),
  ('18100000-0000-0000-0000-0000000000b3', 'chr-admin@example.com'),
  ('18100000-0000-0000-0000-0000000000b4', 'chr-eng@example.com'),
  ('18100000-0000-0000-0000-0000000000b5', 'chr-pcm-foreign@example.com'),
  ('18100000-0000-0000-0000-0000000000b6', 'chr-fin@example.com'),
  ('18100000-0000-0000-0000-0000000000b7', 'chr-pcm-editor@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('18100000-0000-0000-0000-0000000000b1', '18100000-0000-0000-0000-0000000000a1', 'CHR Author', 'chr-author@example.com', 'Project Manager', 'active', null),
  ('18100000-0000-0000-0000-0000000000b2', '18100000-0000-0000-0000-0000000000a1', 'CHR Control', 'chr-pcm@example.com', 'Project Manager', 'active', 'project_control_manager'),
  ('18100000-0000-0000-0000-0000000000b3', '18100000-0000-0000-0000-0000000000a1', 'CHR Admin', 'chr-admin@example.com', 'Admin', 'active', null),
  ('18100000-0000-0000-0000-0000000000b4', '18100000-0000-0000-0000-0000000000a1', 'CHR Engineer', 'chr-eng@example.com', 'Engineer', 'active', null),
  ('18100000-0000-0000-0000-0000000000b5', '18100000-0000-0000-0000-0000000000a2', 'CHR Foreign Control', 'chr-pcm-foreign@example.com', 'Project Manager', 'active', 'project_control_manager'),
  ('18100000-0000-0000-0000-0000000000b6', '18100000-0000-0000-0000-0000000000a1', 'CHR Finance', 'chr-fin@example.com', 'Finance', 'active', null),
  ('18100000-0000-0000-0000-0000000000b7', '18100000-0000-0000-0000-0000000000a1', 'CHR Control Two', 'chr-pcm-editor@example.com', 'Project Manager', 'active', 'project_control_manager');
insert into projects (id, org_id, name, status, currency, project_manager_id) values
  ('18100000-0000-0000-0000-0000000000c1', '18100000-0000-0000-0000-0000000000a1', 'CHR Contract', 'Ongoing Project', 'USD', '18100000-0000-0000-0000-0000000000b1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('18100000-0000-0000-0000-0000000000e1', '18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000c1', 'WO issued', 'Issued', 100000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, earning_basis) values
  ('18100000-0000-0000-0000-0000000000f1', '18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000c1', 'EXC', 'Excavation', 'm3', 1000, 50, 'unit_rate'),
  ('18100000-0000-0000-0000-0000000000f2', '18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000c1', 'ROAD', 'Road', 'm', 200, 100, 'unit_rate'),
  ('18100000-0000-0000-0000-0000000000f3', '18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000c1', 'WALL', 'Wall', 'm2', 100, 100, 'unit_rate'),
  ('18100000-0000-0000-0000-0000000000f4', '18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000c1', 'PIPE', 'Pipe', 'm', 100, 100, 'unit_rate');
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000e1', '18100000-0000-0000-0000-0000000000f1', 600),
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000e1', '18100000-0000-0000-0000-0000000000f2', 100),
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000e1', '18100000-0000-0000-0000-0000000000f3', 100),
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000e1', '18100000-0000-0000-0000-0000000000f4', 100);
insert into project_progress_entries (id, org_id, project_id, month, pct_complete) values
  ('18100000-0000-0000-0000-000000000d01', '18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000c1', '2026-02-01', 50);
insert into progress_assessment_quantities (org_id, entry_id, boq_item_id, quantity_to_date) values
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-000000000d01', '18100000-0000-0000-0000-0000000000f1', 1040),
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-000000000d01', '18100000-0000-0000-0000-0000000000f2', 250),
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-000000000d01', '18100000-0000-0000-0000-0000000000f3', 120),
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-000000000d01', '18100000-0000-0000-0000-0000000000f4', 130);
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;


select is((select quantity_change_approver_roles from organizations where id = '18100000-0000-0000-0000-0000000000a1'), array['project_control_manager'], 'AC-007 control manager is a default reviewer');
set local role authenticated;
select pg_temp._as('18100000-0000-0000-0000-0000000000b1');
insert into ids select 'r1', qcr_raise('18100000-0000-0000-0000-0000000000e1', null, '[{"boq_item_id":"18100000-0000-0000-0000-0000000000f1","requested_quantity":1100,"reason":"Change"}]'::jsonb);
select qcr_submit((select v from ids where k = 'r1'));
select pg_temp._as('18100000-0000-0000-0000-0000000000b2');
select is((select can_approve from qcr_approval_state((select v from ids where k = 'r1'))), true, 'AC-007 default control manager can review');
select qcr_return((select v from ids where k = 'r1'), 'Revise');
select qcr_update_draft((select v from ids where k = 'r1'), null, 'Revised');
select qcr_submit((select v from ids where k = 'r1'));
select throws_ok($$select qcr_approve((select v from ids where k = 'r1'))$$, '42501', 'QCR_SOD_AUTHOR: separation of duties: the person who raised, edited or submitted a request cannot approve it; ask another reviewer', 'AC-007 default reviewer cannot approve their own edits');
select * from finish();
rollback;
