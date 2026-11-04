-- 0641_project_billing_scoped_scans.test.sql — pgTAP regression test for project-scoped get_project_billing.
-- Verifies:
-- 1. Signature, invoker standing, privileges.
-- 2. Scoping to requested project: cross-project and cross-org fixtures do not bleed.
-- 3. Multi-BOQ allocations (multi-BOQ per WO and multi-WO per BOQ).
-- 4. Duplicate confirmed acceptances on a WO: picks latest confirmed BAST.
-- 5. Non-confirmed acceptances (Draft/Withdrawn) are ignored.
-- 6. Tenancy boundaries: unauthorized caller / cross-org returns NULL.

begin;
create extension if not exists pgtap;
select plan(25);

-- ── 1. Privileges & Definition ───────────────────────────────────────────────
select has_function('public', 'get_project_billing', ARRAY['uuid'], 'get_project_billing(uuid) exists');
select is((select prosecdef from pg_proc where oid = 'public.get_project_billing(uuid)'::regprocedure), false,
  'get_project_billing is SECURITY INVOKER');
select is(has_function_privilege('anon', 'public.get_project_billing(uuid)', 'EXECUTE'), false,
  'anon cannot execute get_project_billing');
select is(has_function_privilege('authenticated', 'public.get_project_billing(uuid)', 'EXECUTE'), true,
  'authenticated can execute get_project_billing');

-- ── 2. Test Fixtures ─────────────────────────────────────────────────────────
insert into organizations (id, name, default_timezone) values
  ('64100000-0000-0000-0000-000000000001', 'Scope Org A', 'UTC'),
  ('64100000-0000-0000-0000-000000000002', 'Scope Org B', 'UTC');

insert into auth.users (id, email) values
  ('64100000-0000-0000-0000-000000000011', 'pm-a@example.invalid'),
  ('64100000-0000-0000-0000-000000000012', 'fin-a@example.invalid'),
  ('64100000-0000-0000-0000-000000000013', 'pm-b@example.invalid');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('64100000-0000-0000-0000-000000000011', '64100000-0000-0000-0000-000000000001', 'PM A', 'pm-a@example.invalid', 'Project Manager', 'active'),
  ('64100000-0000-0000-0000-000000000012', '64100000-0000-0000-0000-000000000001', 'Fin A', 'fin-a@example.invalid', 'Finance', 'active'),
  ('64100000-0000-0000-0000-000000000013', '64100000-0000-0000-0000-000000000002', 'PM B', 'pm-b@example.invalid', 'Project Manager', 'active');

insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency) values
  ('64100000-0000-0000-0000-000000000021', '64100000-0000-0000-0000-000000000001', 'Target Project', 'Ongoing Project', 300000, 'exclusive', 0, 'USD'),
  ('64100000-0000-0000-0000-000000000022', '64100000-0000-0000-0000-000000000001', 'Cross-Project Same Org', 'Ongoing Project', 999000, 'exclusive', 0, 'USD'),
  ('64100000-0000-0000-0000-000000000023', '64100000-0000-0000-0000-000000000002', 'Cross-Org Project', 'Ongoing Project', 888000, 'exclusive', 0, 'USD');

-- BOQ Items
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, earning_basis, line_no) values
  ('64100000-0000-0000-0000-000000000041', '64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000021', 'BOQ-1', 'Item One', 'm', 100, 500, 'unit_rate', 1),
  ('64100000-0000-0000-0000-000000000042', '64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000021', 'BOQ-2', 'Item Two', 'm', 200, 1000, 'unit_rate', 2),
  ('64100000-0000-0000-0000-000000000043', '64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000022', 'BOQ-X', 'Cross Project Item', 'm', 999, 999, 'unit_rate', 1),
  ('64100000-0000-0000-0000-000000000044', '64100000-0000-0000-0000-000000000002', '64100000-0000-0000-0000-000000000023', 'BOQ-Y', 'Cross Org Item', 'm', 888, 888, 'unit_rate', 1);

-- Work Orders
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('64100000-0000-0000-0000-000000000031', '64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000021', 'WO 1 Multi-BOQ', 'Issued', 40000, 'exclusive', 0),
  ('64100000-0000-0000-0000-000000000032', '64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000021', 'WO 2 Sharing BOQ-2', 'Issued', 40000, 'exclusive', 0),
  ('64100000-0000-0000-0000-000000000033', '64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000021', 'WO 3 Closed', 'Issued', 5000, 'exclusive', 0),
  ('64100000-0000-0000-0000-000000000034', '64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000022', 'WO Sibling Project', 'Issued', 500000, 'exclusive', 0),
  ('64100000-0000-0000-0000-000000000035', '64100000-0000-0000-0000-000000000002', '64100000-0000-0000-0000-000000000023', 'WO Other Org', 'Issued', 400000, 'exclusive', 0);

-- Allocations:
-- WO 1 allocates BOQ-1 (qty 20) and BOQ-2 (qty 30) -> multi-BOQ per WO
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000031', '64100000-0000-0000-0000-000000000041', 20),
  ('64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000031', '64100000-0000-0000-0000-000000000042', 30);

-- WO 2 allocates BOQ-2 (qty 40) -> multi-WO per BOQ item
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000032', '64100000-0000-0000-0000-000000000042', 40);

-- WO 3 allocates BOQ-1 (qty 10)
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000033', '64100000-0000-0000-0000-000000000041', 10);

-- Sibling & Cross-Org Allocations
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000034', '64100000-0000-0000-0000-000000000043', 500),
  ('64100000-0000-0000-0000-000000000002', '64100000-0000-0000-0000-000000000035', '64100000-0000-0000-0000-000000000044', 400);

-- Acceptances on WO 1:
-- Acceptance 1: earlier confirmed (qty 5 on BOQ-1, 10 on BOQ-2)
-- Acceptance 2: later confirmed (qty 12 on BOQ-1, 22 on BOQ-2) -> must supersede Acceptance 1!
-- Acceptance 3: draft (qty 18 on BOQ-1, 28 on BOQ-2) -> must not be picked!
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis) values
  ('64100000-0000-0000-0000-000000000051', '64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000021', '64100000-0000-0000-0000-000000000031', current_date, false, 'Confirmed', '64100000-0000-0000-0000-000000000011', '64100000-0000-0000-0000-000000000012', now() - interval '2 days', 'standard'),
  ('64100000-0000-0000-0000-000000000052', '64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000021', '64100000-0000-0000-0000-000000000031', current_date, false, 'Confirmed', '64100000-0000-0000-0000-000000000011', '64100000-0000-0000-0000-000000000012', now() - interval '1 day', 'standard'),
  ('64100000-0000-0000-0000-000000000053', '64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000021', '64100000-0000-0000-0000-000000000031', current_date, false, 'Draft', '64100000-0000-0000-0000-000000000011', null, null, null);

insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values
  ('64100000-0000-0000-0000-000000000051', '64100000-0000-0000-0000-000000000041', 5),
  ('64100000-0000-0000-0000-000000000051', '64100000-0000-0000-0000-000000000042', 10),
  ('64100000-0000-0000-0000-000000000052', '64100000-0000-0000-0000-000000000041', 12),
  ('64100000-0000-0000-0000-000000000052', '64100000-0000-0000-0000-000000000042', 22),
  ('64100000-0000-0000-0000-000000000053', '64100000-0000-0000-0000-000000000041', 18),
  ('64100000-0000-0000-0000-000000000053', '64100000-0000-0000-0000-000000000042', 28);

-- Acceptance on WO 3 (final and closed)
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis) values
  ('64100000-0000-0000-0000-000000000054', '64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000021', '64100000-0000-0000-0000-000000000033', current_date, true, 'Confirmed', '64100000-0000-0000-0000-000000000011', '64100000-0000-0000-0000-000000000012', now(), 'standard');
insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values
  ('64100000-0000-0000-0000-000000000054', '64100000-0000-0000-0000-000000000041', 10);

-- Close WO 3 with closing acceptance
set pmo.confirming_work_order_acceptance = 'on';
update work_orders set status = 'Closed', closing_acceptance_id = '64100000-0000-0000-0000-000000000054', closing_value = 5000
where id = '64100000-0000-0000-0000-000000000033';
reset pmo.confirming_work_order_acceptance;

-- Sibling & Cross-Org Confirmed Acceptances
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis) values
  ('64100000-0000-0000-0000-000000000055', '64100000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000022', '64100000-0000-0000-0000-000000000034', current_date, false, 'Confirmed', '64100000-0000-0000-0000-000000000011', '64100000-0000-0000-0000-000000000012', now(), 'standard'),
  ('64100000-0000-0000-0000-000000000056', '64100000-0000-0000-0000-000000000002', '64100000-0000-0000-0000-000000000023', '64100000-0000-0000-0000-000000000035', current_date, false, 'Confirmed', '64100000-0000-0000-0000-000000000013', '64100000-0000-0000-0000-000000000013', now(), 'standard');

insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values
  ('64100000-0000-0000-0000-000000000055', '64100000-0000-0000-0000-000000000043', 300),
  ('64100000-0000-0000-0000-000000000056', '64100000-0000-0000-0000-000000000044', 250);

-- Set authenticated session for Org A user
set local role authenticated;
set local request.jwt.claims = '{"sub":"64100000-0000-0000-0000-000000000011","role":"authenticated"}';

-- Helper to inspect a single boq line from the result json
create or replace function pg_temp.get_line(p_json jsonb, p_boq_id uuid) returns jsonb language sql as $$
  select elem from jsonb_array_elements(p_json->'boq') elem where (elem->>'boq_item_id')::uuid = p_boq_id limit 1;
$$;

-- Evaluate target project billing
do $$
begin
  perform set_config('test.billing', public.get_project_billing('64100000-0000-0000-0000-000000000021')::text, true);
end $$;

-- ── 3. Assert Same-Project Billing Results ─────────────────────────────────────
select is((current_setting('test.billing')::jsonb->>'currency'), 'USD', 'project currency preserved');
select is((current_setting('test.billing')::jsonb->>'contract_net')::numeric, 300000::numeric, 'contract_net preserved');
select is(jsonb_array_length(current_setting('test.billing')::jsonb->'boq'), 2, 'boq array contains exactly 2 lines of target project');

-- Line 1 (BOQ-1):
-- WO 1 (issued, qty 20, latest accepted 12)
-- WO 3 (closed, final, qty 10, accepted 10)
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '64100000-0000-0000-0000-000000000041')->>'ordered_quantity')::numeric, 30::numeric,
  'BOQ-1 ordered_quantity = WO1 (20) + WO3 (10) = 30');
select is(((pg_temp.get_line(current_setting('test.billing')::jsonb, '64100000-0000-0000-0000-000000000041')->'allocations'->0)->>'quantity')::numeric, 20::numeric,
  'BOQ-1 allocation 1 (WO1) quantity = 20');
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '64100000-0000-0000-0000-000000000041')->>'accepted_quantity')::numeric, 22::numeric,
  'BOQ-1 accepted_quantity picks latest confirmed acceptance (12) + WO3 (10) = 22, not earlier (5)');
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '64100000-0000-0000-0000-000000000041')->>'closed_final')::numeric, 10::numeric,
  'BOQ-1 closed_final = WO3 (10)');
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '64100000-0000-0000-0000-000000000041')->>'contract_balance')::numeric, 70::numeric,
  'BOQ-1 contract_balance = 100 - 20 (issued) - 10 (closed_final) = 70');
select is(jsonb_array_length(pg_temp.get_line(current_setting('test.billing')::jsonb, '64100000-0000-0000-0000-000000000041')->'allocations'), 2,
  'BOQ-1 allocations array has 2 work orders');

-- Line 2 (BOQ-2):
-- WO 1 (issued, qty 30, latest accepted 22)
-- WO 2 (issued, qty 40, no acceptances)
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '64100000-0000-0000-0000-000000000042')->>'ordered_quantity')::numeric, 70::numeric,
  'BOQ-2 multi-WO ordered_quantity = WO1 (30) + WO2 (40) = 70');
select is(((pg_temp.get_line(current_setting('test.billing')::jsonb, '64100000-0000-0000-0000-000000000042')->'allocations'->1)->>'quantity')::numeric, 40::numeric,
  'BOQ-2 allocation 2 (WO2) quantity = 40');
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '64100000-0000-0000-0000-000000000042')->>'accepted_quantity')::numeric, 22::numeric,
  'BOQ-2 accepted_quantity = latest confirmed on WO1 (22)');
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '64100000-0000-0000-0000-000000000042')->>'contract_balance')::numeric, 130::numeric,
  'BOQ-2 contract_balance = 200 - 70 = 130');
select is(jsonb_array_length(pg_temp.get_line(current_setting('test.billing')::jsonb, '64100000-0000-0000-0000-000000000042')->'allocations'), 2,
  'BOQ-2 allocations array has 2 work orders');

-- ── 4. Cross-Project Isolation (Same Org) ────────────────────────────────────
-- Sibling project in Org A had 500 ordered and 300 accepted.
-- Target project numbers MUST NOT be contaminated.
select is(
  (select count(*) from jsonb_array_elements(current_setting('test.billing')::jsonb->'boq') elem
   where (elem->>'boq_item_id')::uuid = '64100000-0000-0000-0000-000000000043'),
  0::bigint,
  'Sibling project BOQ item is not present in target project boq array'
);

-- Sibling project billing query should only see its own line
select is(
  (pg_temp.get_line(public.get_project_billing('64100000-0000-0000-0000-000000000022'), '64100000-0000-0000-0000-000000000043')->>'ordered_quantity')::numeric,
  500::numeric,
  'Sibling project query correctly isolates its own 500 ordered quantity'
);
select is(
  (pg_temp.get_line(public.get_project_billing('64100000-0000-0000-0000-000000000022'), '64100000-0000-0000-0000-000000000043')->>'accepted_quantity')::numeric,
  300::numeric,
  'Sibling project query correctly isolates its own 300 accepted quantity'
);

-- ── 5. Cross-Org Isolation & Tenancy ─────────────────────────────────────────
-- Org B project query by Org A user must return NULL (RLS boundary enforced)
select is(
  public.get_project_billing('64100000-0000-0000-0000-000000000023'),
  null::jsonb,
  'Calling get_project_billing on cross-org project returns NULL under RLS'
);

-- Non-existent project returns NULL
select is(
  public.get_project_billing('64100000-0000-0000-0000-000000000099'),
  null::jsonb,
  'Calling get_project_billing on non-existent project returns NULL'
);

-- Switch to Org B user and verify Org B project isolation
set local request.jwt.claims = '{"sub":"64100000-0000-0000-0000-000000000013","role":"authenticated"}';
select is(
  (pg_temp.get_line(public.get_project_billing('64100000-0000-0000-0000-000000000023'), '64100000-0000-0000-0000-000000000044')->>'ordered_quantity')::numeric,
  400::numeric,
  'Org B user isolates Org B project 400 ordered quantity without contamination from Org A'
);
select is(
  public.get_project_billing('64100000-0000-0000-0000-000000000021'),
  null::jsonb,
  'Org B user cannot read Org A project (returns NULL)'
);

select * from finish();
rollback;
