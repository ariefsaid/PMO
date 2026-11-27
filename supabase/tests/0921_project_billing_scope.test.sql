-- 0921_project_billing_scope.test.sql — pgTAP regression test for project-scoped get_project_billing.
-- Verifies:
-- 1. Signature, invoker standing, privileges.
-- 2. Scoping to requested project: cross-project and cross-org fixtures do not bleed.
-- 3. Multi-BOQ allocations (multi-BOQ per WO and multi-WO per BOQ).
-- 4. Duplicate confirmed acceptances on a WO: picks latest confirmed BAST.
-- 5. Non-confirmed acceptances (Draft/Withdrawn) are ignored.
-- 6. Tenancy boundaries: unauthorized caller / cross-org returns NULL.
-- 7. #2223 scope: another project's acceptance never changes this project's result; the 0810 body (kept here
--    as pg_temp.old_billing) and the 0921 body agree on every project of every organisation.

begin;
create extension if not exists pgtap;
select plan(44);

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
  ('09210000-0000-0000-0000-000000000001', 'Scope Org A', 'UTC'),
  ('09210000-0000-0000-0000-000000000002', 'Scope Org B', 'UTC');

insert into auth.users (id, email) values
  ('09210000-0000-0000-0000-000000000011', 'pm-a@example.invalid'),
  ('09210000-0000-0000-0000-000000000012', 'fin-a@example.invalid'),
  ('09210000-0000-0000-0000-000000000013', 'pm-b@example.invalid');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('09210000-0000-0000-0000-000000000011', '09210000-0000-0000-0000-000000000001', 'PM A', 'pm-a@example.invalid', 'Project Manager', 'active'),
  ('09210000-0000-0000-0000-000000000012', '09210000-0000-0000-0000-000000000001', 'Fin A', 'fin-a@example.invalid', 'Finance', 'active'),
  ('09210000-0000-0000-0000-000000000013', '09210000-0000-0000-0000-000000000002', 'PM B', 'pm-b@example.invalid', 'Project Manager', 'active');

insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency) values
  ('09210000-0000-0000-0000-000000000021', '09210000-0000-0000-0000-000000000001', 'Target Project', 'Ongoing Project', 300000, 'exclusive', 0, 'USD'),
  ('09210000-0000-0000-0000-000000000022', '09210000-0000-0000-0000-000000000001', 'Cross-Project Same Org', 'Ongoing Project', 999000, 'exclusive', 0, 'USD'),
  ('09210000-0000-0000-0000-000000000023', '09210000-0000-0000-0000-000000000002', 'Cross-Org Project', 'Ongoing Project', 888000, 'exclusive', 0, 'USD');

-- BOQ Items
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, earning_basis, line_no) values
  ('09210000-0000-0000-0000-000000000041', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000021', 'BOQ-1', 'Item One', 'm', 100, 500, 'unit_rate', 1),
  ('09210000-0000-0000-0000-000000000042', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000021', 'BOQ-2', 'Item Two', 'm', 200, 1000, 'unit_rate', 2),
  ('09210000-0000-0000-0000-000000000043', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000022', 'BOQ-X', 'Cross Project Item', 'm', 999, 999, 'unit_rate', 1),
  ('09210000-0000-0000-0000-000000000044', '09210000-0000-0000-0000-000000000002', '09210000-0000-0000-0000-000000000023', 'BOQ-Y', 'Cross Org Item', 'm', 888, 888, 'unit_rate', 1);

-- Work Orders
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('09210000-0000-0000-0000-000000000031', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000021', 'WO 1 Multi-BOQ', 'Issued', 40000, 'exclusive', 0),
  ('09210000-0000-0000-0000-000000000032', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000021', 'WO 2 Sharing BOQ-2', 'Issued', 40000, 'exclusive', 0),
  ('09210000-0000-0000-0000-000000000033', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000021', 'WO 3 Closed', 'Issued', 5000, 'exclusive', 0),
  ('09210000-0000-0000-0000-000000000034', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000022', 'WO Sibling Project', 'Issued', 500000, 'exclusive', 0),
  ('09210000-0000-0000-0000-000000000035', '09210000-0000-0000-0000-000000000002', '09210000-0000-0000-0000-000000000023', 'WO Other Org', 'Issued', 400000, 'exclusive', 0);

-- Allocations:
-- WO 1 allocates BOQ-1 (qty 20) and BOQ-2 (qty 30) -> multi-BOQ per WO
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000031', '09210000-0000-0000-0000-000000000041', 20),
  ('09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000031', '09210000-0000-0000-0000-000000000042', 30);

-- WO 2 allocates BOQ-2 (qty 40) -> multi-WO per BOQ item
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000032', '09210000-0000-0000-0000-000000000042', 40);

-- WO 3 allocates BOQ-1 (qty 10)
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000033', '09210000-0000-0000-0000-000000000041', 10);

-- Sibling & Cross-Org Allocations
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000034', '09210000-0000-0000-0000-000000000043', 500),
  ('09210000-0000-0000-0000-000000000002', '09210000-0000-0000-0000-000000000035', '09210000-0000-0000-0000-000000000044', 400);

-- Acceptances on WO 1:
-- Acceptance 1: earlier confirmed (qty 5 on BOQ-1, 10 on BOQ-2)
-- Acceptance 2: later confirmed (qty 12 on BOQ-1, 22 on BOQ-2) -> must supersede Acceptance 1!
-- Acceptance 3: draft (qty 18 on BOQ-1, 28 on BOQ-2) -> must not be picked!
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis) values
  ('09210000-0000-0000-0000-000000000051', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000021', '09210000-0000-0000-0000-000000000031', current_date, false, 'Confirmed', '09210000-0000-0000-0000-000000000011', '09210000-0000-0000-0000-000000000012', now() - interval '2 days', 'standard'),
  ('09210000-0000-0000-0000-000000000052', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000021', '09210000-0000-0000-0000-000000000031', current_date, false, 'Confirmed', '09210000-0000-0000-0000-000000000011', '09210000-0000-0000-0000-000000000012', now() - interval '1 day', 'standard'),
  ('09210000-0000-0000-0000-000000000053', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000021', '09210000-0000-0000-0000-000000000031', current_date, false, 'Draft', '09210000-0000-0000-0000-000000000011', null, null, null);

insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values
  ('09210000-0000-0000-0000-000000000051', '09210000-0000-0000-0000-000000000041', 5),
  ('09210000-0000-0000-0000-000000000051', '09210000-0000-0000-0000-000000000042', 10),
  ('09210000-0000-0000-0000-000000000052', '09210000-0000-0000-0000-000000000041', 12),
  ('09210000-0000-0000-0000-000000000052', '09210000-0000-0000-0000-000000000042', 22),
  ('09210000-0000-0000-0000-000000000053', '09210000-0000-0000-0000-000000000041', 18),
  ('09210000-0000-0000-0000-000000000053', '09210000-0000-0000-0000-000000000042', 28);

-- Acceptance on WO 3 (final and closed)
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis) values
  ('09210000-0000-0000-0000-000000000054', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000021', '09210000-0000-0000-0000-000000000033', current_date, true, 'Confirmed', '09210000-0000-0000-0000-000000000011', '09210000-0000-0000-0000-000000000012', now(), 'standard');
insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values
  ('09210000-0000-0000-0000-000000000054', '09210000-0000-0000-0000-000000000041', 10);

-- Close WO 3 with closing acceptance
set pmo.confirming_work_order_acceptance = 'on';
update work_orders set status = 'Closed', closing_acceptance_id = '09210000-0000-0000-0000-000000000054', closing_value = 5000
where id = '09210000-0000-0000-0000-000000000033';
reset pmo.confirming_work_order_acceptance;

-- Sibling & Cross-Org Confirmed Acceptances
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis) values
  ('09210000-0000-0000-0000-000000000055', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000022', '09210000-0000-0000-0000-000000000034', current_date, false, 'Confirmed', '09210000-0000-0000-0000-000000000011', '09210000-0000-0000-0000-000000000012', now(), 'standard'),
  ('09210000-0000-0000-0000-000000000056', '09210000-0000-0000-0000-000000000002', '09210000-0000-0000-0000-000000000023', '09210000-0000-0000-0000-000000000035', current_date, false, 'Confirmed', '09210000-0000-0000-0000-000000000013', '09210000-0000-0000-0000-000000000013', now(), 'standard');

insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values
  ('09210000-0000-0000-0000-000000000055', '09210000-0000-0000-0000-000000000043', 300),
  ('09210000-0000-0000-0000-000000000056', '09210000-0000-0000-0000-000000000044', 250);

-- Project for equal-confirmed_at tie break testing
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency) values
  ('09210000-0000-0000-0000-000000000024', '09210000-0000-0000-0000-000000000001', 'Tie-Break Project', 'Ongoing Project', 100000, 'exclusive', 0, 'USD');
-- Each org's Project Manager manages its projects: a Project Manager reads money for their own projects (DD-R1125-14).
update projects set project_manager_id = case org_id when '09210000-0000-0000-0000-000000000001' then '09210000-0000-0000-0000-000000000011'::uuid
                                                     else '09210000-0000-0000-0000-000000000013'::uuid end
 where id::text like '09210000-%';

insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, earning_basis, line_no) values
  ('09210000-0000-0000-0000-000000000045', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000024', 'BOQ-TIE', 'Tie Item', 'm', 100, 250, 'unit_rate', 1);

insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('09210000-0000-0000-0000-000000000036', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000024', 'WO Tie-Break', 'Issued', 25000, 'exclusive', 0);

insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000036', '09210000-0000-0000-0000-000000000045', 60);

-- Two acceptances on WO Tie-Break with identical confirmed_at timestamp:
-- Lower ID (...57): stage acceptance (is_final = false), quantity 15
-- Higher ID (...58): final acceptance (is_final = true), quantity 40
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis) values
  ('09210000-0000-0000-0000-000000000057', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000024', '09210000-0000-0000-0000-000000000036', current_date, false, 'Confirmed', '09210000-0000-0000-0000-000000000011', '09210000-0000-0000-0000-000000000012', timestamp '2026-11-03 14:00:00', 'standard'),
  ('09210000-0000-0000-0000-000000000058', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000024', '09210000-0000-0000-0000-000000000036', current_date, true, 'Confirmed', '09210000-0000-0000-0000-000000000011', '09210000-0000-0000-0000-000000000012', timestamp '2026-11-03 14:00:00', 'standard');

insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values
  ('09210000-0000-0000-0000-000000000057', '09210000-0000-0000-0000-000000000045', 15),
  ('09210000-0000-0000-0000-000000000058', '09210000-0000-0000-0000-000000000045', 40);

-- Close WO Tie-Break with closing acceptance ...58
set pmo.confirming_work_order_acceptance = 'on';
update work_orders set status = 'Closed', closing_acceptance_id = '09210000-0000-0000-0000-000000000058', closing_value = 10000
where id = '09210000-0000-0000-0000-000000000036';
reset pmo.confirming_work_order_acceptance;

-- The 0810 body, verbatim: the oracle the scoped function must equal.
create function pg_temp.old_billing(p_project_id uuid)
 returns jsonb language sql stable security invoker set search_path=public as $$
with p as (
 select pr.id,pr.org_id,pr.currency,case when pr.tax_treatment='inclusive' then pr.contract_value-coalesce(pr.tax_amount,0) else pr.contract_value end contract_net
 from public.projects pr where pr.id=p_project_id
), counted as (
 select w.is_down_payment,w.net,w.recovery from public.sales_invoice_work_billed w join p on p.id=w.project_id
 where w.status in ('Submitted','Unpaid','Paid') and w.net is not null and w.currency=p.currency
), claims as (
 select pc.id,pc.kind,pc.gross_amount,pc.dp_recovery_amount,pc.work_order_id,si.status
 from public.progress_claims pc left join public.sales_invoices si on si.id=pc.id and si.org_id=pc.org_id
 where pc.project_id=p_project_id and pc.withdrawn_at is null and si.status is distinct from 'Cancelled'
), claimed_line as (
 select l.boq_item_id,sum(l.quantity) claimed from public.progress_claim_lines l join claims c on c.id=l.claim_id group by l.boq_item_id
), claimed_alloc as (
 select l.boq_item_id,c.work_order_id,sum(l.quantity) claimed from public.progress_claim_lines l join claims c on c.id=l.claim_id
 where c.work_order_id is not null group by l.boq_item_id,c.work_order_id
), latest as (
 select e.id,e.month,e.pct_complete from public.project_progress_entries e where e.project_id=p_project_id
 and e.month<=public.org_current_month((select o.default_timezone from public.organizations o where o.id=public.auth_org_id()),now()) order by e.month desc limit 1
), assessed as (select q.boq_item_id,q.quantity_to_date from public.progress_assessment_quantities q join latest l on l.id=q.entry_id),
latest_bast as (
 select distinct on (a.work_order_id) a.work_order_id,a.id,a.is_final
 from public.work_order_acceptances a where a.status='Confirmed'
 order by a.work_order_id,a.confirmed_at desc,a.id desc
), allocation as (
 select wl.boq_item_id,wl.work_order_id,wl.quantity,wo.status,
   coalesce(ca.claimed,0) claimed,al.quantity accepted,coalesce(lb.is_final,false) final
 from public.work_order_lines wl join public.work_orders wo on wo.id=wl.work_order_id
 left join claimed_alloc ca on ca.boq_item_id=wl.boq_item_id and ca.work_order_id=wl.work_order_id
 left join latest_bast lb on lb.work_order_id=wl.work_order_id
 left join public.work_order_acceptance_lines al on al.acceptance_id=lb.id and al.boq_item_id=wl.boq_item_id
 where wl.org_id=public.auth_org_id() and wo.status<>'Cancelled'
), agg as (
 select b.id,b.earning_basis,b.line_no,b.created_at,b.quantity contract_quantity,b.rate,
  coalesce((select sum(a.quantity) from allocation a where a.boq_item_id=b.id and a.status in ('Issued','Closed')),0) ordered_quantity,
  coalesce((select sum(a.quantity) from allocation a where a.boq_item_id=b.id and a.status='Issued'),0) issued_ordered,
  coalesce((select sum(a.accepted) from allocation a where a.boq_item_id=b.id and a.final and a.status='Closed'),0) closed_final,
  coalesce((select sum(a.accepted) from allocation a where a.boq_item_id=b.id and a.accepted is not null),0) accepted_quantity,
  coalesce(cl.claimed,0) claimed_quantity,a.quantity_to_date assessed_quantity,
  coalesce((select jsonb_agg(jsonb_build_object('work_order_id',x.work_order_id,'boq_item_id',x.boq_item_id,'quantity',x.quantity,'claimed_quantity',x.claimed,'accepted_quantity',x.accepted,'final',x.final) order by x.work_order_id)
    from allocation x where x.boq_item_id=b.id),'[]'::jsonb) allocations
 from public.boq_items b left join claimed_line cl on cl.boq_item_id=b.id left join assessed a on a.boq_item_id=b.id where b.project_id=p_project_id
), earned as (select * from public.project_line_earned(p_project_id)), lines as (
 select a.*,coalesce(e.earned_quantity,0) earned_quantity,
  a.contract_quantity-a.issued_ordered-a.closed_final contract_balance
 from agg a left join earned e on e.boq_item_id=a.id
)
select jsonb_build_object(
 'currency',p.currency,'contract_net',p.contract_net,
 'work_billed',coalesce((select sum(net+recovery) from counted where not is_down_payment),0),
 'dp_billed',coalesce((select sum(net) from counted where is_down_payment),0),
 'dp_recovered',coalesce((select sum(recovery) from counted where not is_down_payment),0),
 'not_submitted',coalesce((select sum(gross_amount-dp_recovery_amount) from claims where status is null or status='Draft'),0),
 'assessment',(select jsonb_build_object('month',l.month,'pct_complete',l.pct_complete) from latest l),
 'earned_value',coalesce((select sum(earned_value) from earned),0),
 'boq',coalesce((select jsonb_agg(jsonb_build_object('boq_item_id',id,'claimed_quantity',claimed_quantity,'assessed_quantity',assessed_quantity,
   'earning_basis',earning_basis,'line_no',line_no,'ordered_quantity',ordered_quantity,'accepted_quantity',accepted_quantity,'closed_final',closed_final,
   'earned_quantity',earned_quantity,'contract_balance',contract_balance,'allocations',allocations) order by line_no nulls last,created_at,id)
   from lines),'[]'::jsonb)) from p
$$;

-- Set authenticated session for Org A user
set local role authenticated;
set local request.jwt.claims = '{"sub":"09210000-0000-0000-0000-000000000011","role":"authenticated"}';

-- Helper to inspect a single boq line from the result json
create or replace function pg_temp.get_line(p_json jsonb, p_boq_id uuid) returns jsonb language sql as $$
  select elem from jsonb_array_elements(p_json->'boq') elem where (elem->>'boq_item_id')::uuid = p_boq_id limit 1;
$$;

-- Evaluate target project billing
do $$
begin
  perform set_config('test.billing', public.get_project_billing('09210000-0000-0000-0000-000000000021')::text, true);
end $$;

-- ── 3. Assert Same-Project Billing Results ─────────────────────────────────────
select is((current_setting('test.billing')::jsonb->>'currency'), 'USD', 'project currency preserved');
select is((current_setting('test.billing')::jsonb->>'contract_net')::numeric, 300000::numeric, 'contract_net preserved');
select is(jsonb_array_length(current_setting('test.billing')::jsonb->'boq'), 2, 'boq array contains exactly 2 lines of target project');

-- Line 1 (BOQ-1):
-- WO 1 (issued, qty 20, latest accepted 12)
-- WO 3 (closed, final, qty 10, accepted 10)
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '09210000-0000-0000-0000-000000000041')->>'ordered_quantity')::numeric, 30::numeric,
  'BOQ-1 ordered_quantity = WO1 (20) + WO3 (10) = 30');
select is(((pg_temp.get_line(current_setting('test.billing')::jsonb, '09210000-0000-0000-0000-000000000041')->'allocations'->0)->>'quantity')::numeric, 20::numeric,
  'BOQ-1 allocation 1 (WO1) quantity = 20');
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '09210000-0000-0000-0000-000000000041')->>'accepted_quantity')::numeric, 22::numeric,
  'BOQ-1 accepted_quantity picks latest confirmed acceptance (12) + WO3 (10) = 22, not earlier (5)');
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '09210000-0000-0000-0000-000000000041')->>'closed_final')::numeric, 10::numeric,
  'BOQ-1 closed_final = WO3 (10)');
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '09210000-0000-0000-0000-000000000041')->>'contract_balance')::numeric, 70::numeric,
  'BOQ-1 contract_balance = 100 - 20 (issued) - 10 (closed_final) = 70');
select is(jsonb_array_length(pg_temp.get_line(current_setting('test.billing')::jsonb, '09210000-0000-0000-0000-000000000041')->'allocations'), 2,
  'BOQ-1 allocations array has 2 work orders');

-- Line 2 (BOQ-2):
-- WO 1 (issued, qty 30, latest accepted 22)
-- WO 2 (issued, qty 40, no acceptances)
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '09210000-0000-0000-0000-000000000042')->>'ordered_quantity')::numeric, 70::numeric,
  'BOQ-2 multi-WO ordered_quantity = WO1 (30) + WO2 (40) = 70');
select is(((pg_temp.get_line(current_setting('test.billing')::jsonb, '09210000-0000-0000-0000-000000000042')->'allocations'->1)->>'quantity')::numeric, 40::numeric,
  'BOQ-2 allocation 2 (WO2) quantity = 40');
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '09210000-0000-0000-0000-000000000042')->>'accepted_quantity')::numeric, 22::numeric,
  'BOQ-2 accepted_quantity = latest confirmed on WO1 (22)');
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '09210000-0000-0000-0000-000000000042')->>'contract_balance')::numeric, 130::numeric,
  'BOQ-2 contract_balance = 200 - 70 = 130');
select is(jsonb_array_length(pg_temp.get_line(current_setting('test.billing')::jsonb, '09210000-0000-0000-0000-000000000042')->'allocations'), 2,
  'BOQ-2 allocations array has 2 work orders');
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '09210000-0000-0000-0000-000000000041')->>'earned_quantity')::numeric, 10::numeric,
  'BOQ-1 earned_quantity = closed_final = 10');
select is(pg_temp.get_line(current_setting('test.billing')::jsonb, '09210000-0000-0000-0000-000000000042')->'allocations'->1->>'accepted_quantity', null::text,
  'BOQ-2 allocation 2 (WO2) accepted_quantity is JSON null (unaccepted allocation)');
select is((pg_temp.get_line(current_setting('test.billing')::jsonb, '09210000-0000-0000-0000-000000000042')->>'earned_quantity')::numeric, 0::numeric,
  'BOQ-2 earned_quantity = 0');
select is((current_setting('test.billing')::jsonb->>'earned_value')::numeric, 5000::numeric,
  'target project earned_value = 5000 (BOQ-1 earned 10 * 500)');

-- ── 4. Cross-Project Isolation (Same Org) ────────────────────────────────────
-- Sibling project in Org A had 500 ordered and 300 accepted.
-- Target project numbers MUST NOT be contaminated.
select is(
  (select count(*) from jsonb_array_elements(current_setting('test.billing')::jsonb->'boq') elem
   where (elem->>'boq_item_id')::uuid = '09210000-0000-0000-0000-000000000043'),
  0::bigint,
  'Sibling project BOQ item is not present in target project boq array'
);

-- Sibling project billing query should only see its own line
select is(
  (pg_temp.get_line(public.get_project_billing('09210000-0000-0000-0000-000000000022'), '09210000-0000-0000-0000-000000000043')->>'ordered_quantity')::numeric,
  500::numeric,
  'Sibling project query correctly isolates its own 500 ordered quantity'
);
select is(
  (pg_temp.get_line(public.get_project_billing('09210000-0000-0000-0000-000000000022'), '09210000-0000-0000-0000-000000000043')->>'accepted_quantity')::numeric,
  300::numeric,
  'Sibling project query correctly isolates its own 300 accepted quantity'
);

-- ── 5. Cross-Org Isolation & Tenancy ─────────────────────────────────────────
-- Org B project query by Org A user must return NULL (RLS boundary enforced)
select is(
  public.get_project_billing('09210000-0000-0000-0000-000000000023'),
  null::jsonb,
  'Calling get_project_billing on cross-org project returns NULL under RLS'
);

-- Non-existent project returns NULL
select is(
  public.get_project_billing('09210000-0000-0000-0000-000000000099'),
  null::jsonb,
  'Calling get_project_billing on non-existent project returns NULL'
);

-- Switch to Org B user and verify Org B project isolation
set local request.jwt.claims = '{"sub":"09210000-0000-0000-0000-000000000013","role":"authenticated"}';
select is(
  (pg_temp.get_line(public.get_project_billing('09210000-0000-0000-0000-000000000023'), '09210000-0000-0000-0000-000000000044')->>'ordered_quantity')::numeric,
  400::numeric,
  'Org B user isolates Org B project 400 ordered quantity without contamination from Org A'
);
select is(
  public.get_project_billing('09210000-0000-0000-0000-000000000021'),
  null::jsonb,
  'Org B user cannot read Org A project (returns NULL)'
);

-- ── 6. Equal confirmed_at Acceptance Tie-Break (DESC id) ──────────────────
-- Switch back to Org A user
set local request.jwt.claims = '{"sub":"09210000-0000-0000-0000-000000000011","role":"authenticated"}';

-- Evaluates Tie-Break Project where WO 36 has two confirmed acceptances with identical confirmed_at.
-- Acceptance ...58 (higher ID, final, qty 40) must supersede Acceptance ...57 (lower ID, stage, qty 15).
do $$
begin
  perform set_config('test.billing_tie', public.get_project_billing('09210000-0000-0000-0000-000000000024')::text, true);
end $$;

select is(
  ((pg_temp.get_line(current_setting('test.billing_tie')::jsonb, '09210000-0000-0000-0000-000000000045')->'allocations'->0)->>'accepted_quantity')::numeric,
  40::numeric,
  'Tie-break selects higher ID acceptance allocation accepted_quantity (40 not 15)'
);
select is(
  ((pg_temp.get_line(current_setting('test.billing_tie')::jsonb, '09210000-0000-0000-0000-000000000045')->'allocations'->0)->>'final')::boolean,
  true,
  'Tie-break selects higher ID acceptance allocation final flag (true)'
);
select is(
  (pg_temp.get_line(current_setting('test.billing_tie')::jsonb, '09210000-0000-0000-0000-000000000045')->>'accepted_quantity')::numeric,
  40::numeric,
  'Tie-break selects higher ID acceptance BOQ accepted_quantity total (40 not 15)'
);
select is(
  (pg_temp.get_line(current_setting('test.billing_tie')::jsonb, '09210000-0000-0000-0000-000000000045')->>'closed_final')::numeric,
  40::numeric,
  'Tie-break selects higher ID acceptance BOQ closed_final total (40 not 0)'
);
select is(
  (pg_temp.get_line(current_setting('test.billing_tie')::jsonb, '09210000-0000-0000-0000-000000000045')->>'earned_quantity')::numeric,
  40::numeric,
  'Tie-break selects higher ID acceptance BOQ earned_quantity (40 not 0)'
);
select is(
  (current_setting('test.billing_tie')::jsonb->>'earned_value')::numeric,
  10000::numeric,
  'Tie-break selects higher ID acceptance project earned_value (40 * 250 = 10000, not 0)'
);


-- ── 7. Project scope (#2223) ────────────────────────────────────────────────
do $$ begin perform set_config('t.before', public.get_project_billing('09210000-0000-0000-0000-000000000021')::text, true); end $$;
reset role;
-- A confirmed acceptance on the sibling project's own work order, later than everything on the target project.
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis) values
  ('09210000-0000-0000-0000-000000000059', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000022', '09210000-0000-0000-0000-000000000034', current_date, false, 'Confirmed', '09210000-0000-0000-0000-000000000011', '09210000-0000-0000-0000-000000000012', now() + interval '1 hour', 'standard');
insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values ('09210000-0000-0000-0000-000000000059', '09210000-0000-0000-0000-000000000043', 450);
set local role authenticated;
set local request.jwt.claims = '{"sub":"09210000-0000-0000-0000-000000000011","role":"authenticated"}';
select is(public.get_project_billing('09210000-0000-0000-0000-000000000021')::text, current_setting('t.before'),
  'AC-2223 a second project''s new acceptance does not change this project''s billing');
select is((pg_temp.get_line(public.get_project_billing('09210000-0000-0000-0000-000000000022'), '09210000-0000-0000-0000-000000000043')->>'accepted_quantity')::numeric, 450::numeric,
  'AC-2223 the second project''s own billing does move with its acceptance');

-- Old and new bodies agree on every project of every organisation (seed included), read as that organisation's user.
reset role;
do $$ declare r record; p uuid; bad int := 0; n int := 0; begin
  for r in select distinct on (org_id) org_id, id from public.profiles where status = 'active' order by org_id, id loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    for p in select id from public.projects where org_id = r.org_id loop
      n := n + 1;
      if public.get_project_billing(p)::text is distinct from pg_temp.old_billing(p)::text then bad := bad + 1; end if;
    end loop;
    reset role;
  end loop;
  perform set_config('t.bad', bad::text, true); perform set_config('t.n', n::text, true);
end $$;
select is(current_setting('t.bad')::int, 0, 'AC-2223 get_project_billing is byte-identical to the 0810 body for every project');
select cmp_ok(current_setting('t.n')::int, '>=', 4, 'AC-2223 the comparison covered the fixture projects and more');

-- An acceptance stamped to another project on this project's work order is not read (it is not this project's).
-- The stamp is always the work order's project in practice, so this only holds when the read filters on the project.
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis) values
  ('09210000-0000-0000-0000-00000000005a', '09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000022', '09210000-0000-0000-0000-000000000031', current_date, false, 'Confirmed', '09210000-0000-0000-0000-000000000011', '09210000-0000-0000-0000-000000000012', now() + interval '2 hours', 'standard');
insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values
  ('09210000-0000-0000-0000-00000000005a', '09210000-0000-0000-0000-000000000041', 19), ('09210000-0000-0000-0000-00000000005a', '09210000-0000-0000-0000-000000000042', 29);
set local role authenticated;
set local request.jwt.claims = '{"sub":"09210000-0000-0000-0000-000000000011","role":"authenticated"}';
select is(public.get_project_billing('09210000-0000-0000-0000-000000000021')::text, current_setting('t.before'),
  'AC-2223 an acceptance stamped to another project is not read into this project''s billing');
select ok(pg_get_functiondef('public.get_project_billing(uuid)'::regprocedure) like '%wo.project_id=p_project_id%',
  'AC-2223 the allocation read is filtered on the project');
select ok(pg_get_functiondef('public.get_project_billing(uuid)'::regprocedure) like '%a.project_id=p_project_id and a.status=''Confirmed''%',
  'AC-2223 the latest-acceptance read is filtered on the project');
select is(has_function_privilege('anon', 'public.get_project_billing(uuid)', 'EXECUTE'), false, 'AC-2223 anon still cannot execute get_project_billing');
select is(has_function_privilege('authenticated', 'public.get_project_billing(uuid)', 'EXECUTE'), true, 'AC-2223 authenticated still can');

select * from finish();
rollback;
