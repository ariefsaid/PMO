-- 1260_site_cash_work_order.test.sql — #2732 (docs/specs/site-cash-work-order.spec.md).
-- Migrations under test: 1260_expense_claim_cost_attribution.sql, 1261_set_cost_attribution_expense_claim.sql,
-- 1262_work_order_cost_lines_expense_claim.sql, 1263_work_order_cost_amounts_expense_claims.sql.
-- AC-SCWO-001 work order on the claim's project and org · 002 no project / cancelled / discipline rules · 003 a cash advance
-- is not a cost · 004 who may attribute, audited, another org reads as absent · 005 only the two columns change, no direct
-- client write · 006 a project move under a named work order is refused · 007 the cost-line seam · 008 PMO-mode amounts ·
-- 009 ledger-mode amounts, counted once · 012 float figures unchanged · 014 nothing attributed means nothing changes.
-- Every denial asserts the errcode AND the message.
begin;
create extension if not exists pgtap;
select plan(42);

insert into organizations (id, name, default_currency) values ('27320000-0000-0000-0000-00000000000a', 'SCWO Org', 'IDR'), ('27320000-0000-0000-0000-00000000000b', 'SCWO Other Org', 'IDR');
insert into auth.users (id, email) values
  ('27320000-0000-0000-0000-0000000000a1', 'scwo-admin@example.com'), ('27320000-0000-0000-0000-0000000000a2', 'scwo-fin@example.com'), ('27320000-0000-0000-0000-0000000000a3', 'scwo-pm@example.com'),
  ('27320000-0000-0000-0000-0000000000a4', 'scwo-eng@example.com'), ('27320000-0000-0000-0000-0000000000a5', 'scwo-eng2@example.com'), ('27320000-0000-0000-0000-0000000000b1', 'scwo-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27320000-0000-0000-0000-0000000000a1', '27320000-0000-0000-0000-00000000000a', 'SCWO Admin', 'scwo-admin@example.com', 'Admin', 'active'),
  ('27320000-0000-0000-0000-0000000000a2', '27320000-0000-0000-0000-00000000000a', 'SCWO Fin',   'scwo-fin@example.com',   'Finance', 'active'),
  ('27320000-0000-0000-0000-0000000000a3', '27320000-0000-0000-0000-00000000000a', 'SCWO PM',    'scwo-pm@example.com',    'Project Manager', 'active'),
  ('27320000-0000-0000-0000-0000000000a4', '27320000-0000-0000-0000-00000000000a', 'SCWO Eng',   'scwo-eng@example.com',   'Engineer', 'active'),
  ('27320000-0000-0000-0000-0000000000a5', '27320000-0000-0000-0000-00000000000a', 'SCWO Eng2',  'scwo-eng2@example.com',  'Engineer', 'active'),
  ('27320000-0000-0000-0000-0000000000b1', '27320000-0000-0000-0000-00000000000b', 'SCWO XOrg',  'scwo-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('27320000-0000-0000-0000-0000000000d1', '27320000-0000-0000-0000-00000000000a', 'SCWO Site',     'Ongoing Project', '27320000-0000-0000-0000-0000000000a3', 'IDR'),
  ('27320000-0000-0000-0000-0000000000d2', '27320000-0000-0000-0000-00000000000a', 'SCWO Site Two', 'Ongoing Project', '27320000-0000-0000-0000-0000000000a3', 'IDR'),
  ('27320000-0000-0000-0000-0000000000d9', '27320000-0000-0000-0000-00000000000b', 'SCWO Other',    'Ongoing Project', null, 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('27320000-0000-0000-0000-000000000401', '27320000-0000-0000-0000-00000000000a', '27320000-0000-0000-0000-0000000000d1', 'WO-A', 'SCWO WO A', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('27320000-0000-0000-0000-000000000402', '27320000-0000-0000-0000-00000000000a', '27320000-0000-0000-0000-0000000000d2', 'WO-C', 'SCWO WO two', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('27320000-0000-0000-0000-000000000409', '27320000-0000-0000-0000-00000000000b', '27320000-0000-0000-0000-0000000000d9', 'WO-X', 'SCWO WO other', 'Issued', 10000, 'exclusive', 0, 'IDR');
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, cancelled_at, currency) values
  ('27320000-0000-0000-0000-000000000403', '27320000-0000-0000-0000-00000000000a', '27320000-0000-0000-0000-0000000000d1', 'WO-Z', 'SCWO WO cancelled', 'Cancelled', 0, 'exclusive', 0, now(), 'IDR');
insert into cost_disciplines (id, org_id, code, name, archived_at) values
  ('27320000-0000-0000-0000-000000000501', '27320000-0000-0000-0000-00000000000a', 'CIV', 'Civil', null), ('27320000-0000-0000-0000-000000000502', '27320000-0000-0000-0000-00000000000a', 'OLD', 'Retired', now()),
  ('27320000-0000-0000-0000-000000000503', '27320000-0000-0000-0000-00000000000a', 'ELE', 'Electrical', null), ('27320000-0000-0000-0000-000000000509', '27320000-0000-0000-0000-00000000000b', 'MEC', 'Mechanical', null);
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('27320000-0000-0000-0000-000000000a01', '27320000-0000-0000-0000-00000000000a', '27320000-0000-0000-0000-0000000000d1', '27320000-0000-0000-0000-0000000000a3', 5000, 'IDR', '27320000-0000-0000-0000-0000000000a1');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number, approved_at, imprest_float_id, currency) values
  ('27320000-0000-0000-0000-000000000701', '27320000-0000-0000-0000-00000000000a', 'claim',   '27320000-0000-0000-0000-0000000000a4', '27320000-0000-0000-0000-0000000000d1', 'Materials', 'Paid claim',       400, 'Paid',      'EXP-S1', now(), null, 'IDR'),
  ('27320000-0000-0000-0000-000000000702', '27320000-0000-0000-0000-00000000000a', 'claim',   '27320000-0000-0000-0000-0000000000a4', '27320000-0000-0000-0000-0000000000d1', 'Materials', 'Approved claim',   100, 'Approved',  'EXP-S2', now(), null, 'IDR'),
  ('27320000-0000-0000-0000-000000000703', '27320000-0000-0000-0000-00000000000a', 'claim',   '27320000-0000-0000-0000-0000000000a4', '27320000-0000-0000-0000-0000000000d1', 'Materials', 'Submitted claim',   50, 'Submitted', 'EXP-S3', null, null, 'IDR'),
  ('27320000-0000-0000-0000-000000000704', '27320000-0000-0000-0000-00000000000a', 'claim',   '27320000-0000-0000-0000-0000000000a4', '27320000-0000-0000-0000-0000000000d1', 'Materials', 'Unattributed',      70, 'Approved',  'EXP-S4', now(), null, 'IDR'),
  ('27320000-0000-0000-0000-000000000705', '27320000-0000-0000-0000-00000000000a', 'advance', '27320000-0000-0000-0000-0000000000a4', '27320000-0000-0000-0000-0000000000d1', 'Materials', 'Cash advance',     300, 'Paid',      'EXP-S5', now(), null, 'IDR'),
  ('27320000-0000-0000-0000-000000000706', '27320000-0000-0000-0000-00000000000a', 'claim',   '27320000-0000-0000-0000-0000000000a4', null,        null,        'No project',         0, 'Draft',     null, null, null, 'IDR'),
  ('27320000-0000-0000-0000-000000000707', '27320000-0000-0000-0000-00000000000a', 'claim',   '27320000-0000-0000-0000-0000000000a4', '27320000-0000-0000-0000-0000000000d1', 'Materials', 'Own draft',          0, 'Draft',     null, null, null, 'IDR'),
  ('27320000-0000-0000-0000-000000000708', '27320000-0000-0000-0000-00000000000b', 'claim',   '27320000-0000-0000-0000-0000000000b1', '27320000-0000-0000-0000-0000000000d9', 'Materials', 'Other org claim',  900, 'Approved',  'EXP-S8', now(), null, 'IDR'),
  ('27320000-0000-0000-0000-000000000709', '27320000-0000-0000-0000-00000000000a', 'claim',   '27320000-0000-0000-0000-0000000000a5', '27320000-0000-0000-0000-0000000000d1', 'Materials', 'Eng2 float claim',  25, 'Approved',  'EXP-S9', now(), '27320000-0000-0000-0000-000000000a01', 'IDR');
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create temp table scwo_snap (label text primary key, v jsonb);
grant all on scwo_snap to authenticated;

select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'expense_claims'
            and column_name in ('work_order_id', 'discipline_id')), 2, 'AC-SCWO-001 expense_claims carries work_order_id and discipline_id');

-- AC-SCWO-014 / 012 (before): the amounts read and the float's figures before anything is named.
set local role authenticated;
select pg_temp.act_as('27320000-0000-0000-0000-0000000000a2');
insert into scwo_snap select 'amounts_before', coalesce(jsonb_agg(to_jsonb(r) - 'record_id' order by r.source, r.reference), '[]')
  from public.work_order_cost_amounts('27320000-0000-0000-0000-0000000000d1') r;
insert into scwo_snap select 'position_before', to_jsonb(p) from public.get_imprest_position('27320000-0000-0000-0000-000000000a01') p;

-- AC-SCWO-001 / 004: Finance names a work order and discipline.
select is(public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000701']::uuid[], '27320000-0000-0000-0000-000000000401', '27320000-0000-0000-0000-000000000501'), 1,
  'AC-SCWO-001 Finance sets the work order and discipline on a Paid claim');
select is(public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000702']::uuid[], '27320000-0000-0000-0000-000000000401', '27320000-0000-0000-0000-000000000503'), 1,
  'AC-SCWO-001 Finance sets them on an Approved claim');
select is(public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000703']::uuid[], '27320000-0000-0000-0000-000000000401', null), 1,
  'AC-SCWO-001 Finance sets a work order on a Submitted claim');
select is(public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000709']::uuid[], '27320000-0000-0000-0000-000000000401', '27320000-0000-0000-0000-000000000501'), 1,
  'AC-SCWO-001 a claim paid from a site float takes a work order');
select pg_temp.act_as('27320000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.audit_events where action = 'cost_attribution.set' and entity_id = '27320000-0000-0000-0000-000000000701'), 1,
  'AC-SCWO-004 the change is audited once for the record');
select is((select (detail->'before'->>'work_order_id') from public.audit_events where action = 'cost_attribution.set' and entity_id = '27320000-0000-0000-0000-000000000701'),
  null, 'AC-SCWO-004 the audit row carries the value it replaced');
select pg_temp.act_as('27320000-0000-0000-0000-0000000000a2');
select is((select row(amount, title, status, project_id, budget_category, claimant_id)::text from public.expense_claims where id = '27320000-0000-0000-0000-000000000701'),
  '(400.00,"Paid claim",Paid,27320000-0000-0000-0000-0000000000d1,Materials,27320000-0000-0000-0000-0000000000a4)', 'AC-SCWO-005 only the two attribution columns changed on a Paid claim');

-- AC-SCWO-001 / 002 refusals.
select throws_ok($$ select public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000704']::uuid[], '27320000-0000-0000-0000-000000000402', null) $$,
  '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-SCWO-001 a work order of another project is refused');
select throws_ok($$ select public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000704']::uuid[], '27320000-0000-0000-0000-000000000409', null) $$,
  '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-SCWO-001 a work order of another org is refused');
select throws_ok($$ select public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000706']::uuid[], '27320000-0000-0000-0000-000000000401', null) $$,
  '23514', 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order', 'AC-SCWO-002 a claim with no project cannot name a work order');
select throws_ok($$ select public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000704']::uuid[], '27320000-0000-0000-0000-000000000403', null) $$,
  '23514', 'COST_WO_CANCELLED: the work order is cancelled', 'AC-SCWO-002 a cancelled work order takes no new cost');
select throws_ok($$ select public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000704']::uuid[], null, '27320000-0000-0000-0000-000000000502') $$,
  '23514', 'COST_DISCIPLINE: the discipline is not on this organisation''s list', 'AC-SCWO-002 an archived discipline is refused');
select throws_ok($$ select public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000704']::uuid[], null, '27320000-0000-0000-0000-000000000509') $$,
  '23514', 'COST_DISCIPLINE: the discipline is not on this organisation''s list', 'AC-SCWO-002 another org''s discipline is refused');
select is(public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000706']::uuid[], null, '27320000-0000-0000-0000-000000000501'), 1,
  'AC-SCWO-002 a project-less claim may name a discipline alone');
-- AC-SCWO-003 a cash advance is not a cost.
select throws_ok($$ select public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000705']::uuid[], '27320000-0000-0000-0000-000000000401', null) $$,
  '23514', 'COST_ADVANCE: a cash advance is not a cost; name the work order on the claim that settles it', 'AC-SCWO-003 a cash advance refuses a work order');
select throws_ok($$ select public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000705']::uuid[], null, '27320000-0000-0000-0000-000000000501') $$,
  '23514', 'COST_ADVANCE: a cash advance is not a cost; name the work order on the claim that settles it', 'AC-SCWO-003 a cash advance refuses a discipline');
-- AC-SCWO-006 project move under a named work order.
reset role;
select throws_ok($$ update public.expense_claims set project_id = '27320000-0000-0000-0000-0000000000d2' where id = '27320000-0000-0000-0000-000000000702' $$,
  '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-SCWO-006 a claim cannot move project while it names a work order of the old one');
select throws_ok($$ insert into public.expense_claims (org_id, kind, claimant_id, project_id, title, work_order_id)
  values ('27320000-0000-0000-0000-00000000000a', 'claim', '27320000-0000-0000-0000-0000000000a4', '27320000-0000-0000-0000-0000000000d1', 'Direct insert', '27320000-0000-0000-0000-000000000402') $$,
  '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-SCWO-001 the rule guards a direct insert too (every writer)');

-- AC-SCWO-004 who may.
set local role authenticated;
select pg_temp.act_as('27320000-0000-0000-0000-0000000000a4');
select is(public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000707']::uuid[], '27320000-0000-0000-0000-000000000401', null), 1,
  'AC-SCWO-004 the claimant sets the work order on their own Draft claim');
select throws_ok($$ select public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000702']::uuid[], null, null) $$,
  '42501', 'you cannot change the work order or discipline of this record', 'AC-SCWO-004 the claimant cannot change an Approved claim');
select throws_ok($$ select public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000709']::uuid[], null, null) $$,
  '42501', 'you cannot change the work order or discipline of this record', 'AC-SCWO-004 an Engineer cannot change another person''s claim');
select throws_ok($$ update public.expense_claims set work_order_id = '27320000-0000-0000-0000-000000000401' where id = '27320000-0000-0000-0000-000000000707' $$,
  '42501', 'permission denied for table expense_claims', 'AC-SCWO-005 a client has no direct write to the attribution columns');
select pg_temp.act_as('27320000-0000-0000-0000-0000000000a5');
select throws_ok($$ select public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000707']::uuid[], null, null) $$,
  '42501', 'you cannot change the work order or discipline of this record', 'AC-SCWO-004 another Engineer cannot change a claim they do not own');
select pg_temp.act_as('27320000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000702']::uuid[], null, null) $$,
  'P0002', 'record not found', 'AC-SCWO-004 another org''s claim reads as absent');
select pg_temp.act_as('27320000-0000-0000-0000-0000000000a3');
select is(public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000704']::uuid[], '27320000-0000-0000-0000-000000000401', null), 1, 'fixture: PM names WO-A on the 70 claim');
select is(public.set_cost_attribution('expense_claim', array['27320000-0000-0000-0000-000000000704']::uuid[], null, null), 1,
  'AC-SCWO-004 a Project Manager may correct and clear the attribution of any claim');
-- AC-SCWO-007 the cost-line seam.
select pg_temp.act_as('27320000-0000-0000-0000-0000000000a2');
select is((select jsonb_object_agg(source, n) from (select source, count(*) n from public.work_order_cost_lines
            where work_order_id = '27320000-0000-0000-0000-000000000401' group by source) s), '{"expense_claim":5}'::jsonb,
  'AC-SCWO-007 the seam lists the claims naming WO-A (701, 702, 703, 707, 709)');
select is((select count(*)::int from public.work_order_cost_lines where source = 'expense_claim' and record_id = '27320000-0000-0000-0000-000000000705'), 0,
  'AC-SCWO-007 a cash advance is not a cost line');
select pg_temp.act_as('27320000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from public.work_order_cost_lines where source = 'expense_claim' and record_id = '27320000-0000-0000-0000-000000000709'), 0,
  'AC-SCWO-007 an Engineer sees only their own claims in the seam');
select pg_temp.act_as('27320000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.work_order_cost_lines where source = 'expense_claim' and org_id = '27320000-0000-0000-0000-00000000000a'), 0,
  'AC-SCWO-007 another org sees none');

-- AC-SCWO-008 PMO-mode amounts. 701 400 Paid CIV, 702 100 Approved ELE, 709 25 Approved CIV, 703 Submitted, 707 Draft.
select pg_temp.act_as('27320000-0000-0000-0000-0000000000a2');
create temp table scwo_rows on commit drop as select * from public.work_order_cost_amounts('27320000-0000-0000-0000-0000000000d1');
grant all on scwo_rows to authenticated;
select is((select sum(amount::numeric) from scwo_rows where source = 'expense_claim' and reason = 'counted' and work_order_id = '27320000-0000-0000-0000-000000000401'),
  525.00::numeric, 'AC-SCWO-008 Paid 400 + Approved 100 + Approved 25 count on WO-A');
select is((select jsonb_object_agg(discipline_id::text, a) from (select discipline_id, sum(amount::numeric) a from scwo_rows
            where source = 'expense_claim' and reason = 'counted' group by discipline_id) s),
  '{"27320000-0000-0000-0000-000000000501":425.00,"27320000-0000-0000-0000-000000000503":100.00}'::jsonb, 'AC-SCWO-008 by discipline: Civil 425, Electrical 100');
select is((select count(*)::int from scwo_rows where source = 'expense_claim' and reason = 'not-posted' and amount is null), 2,
  'AC-SCWO-008 the Submitted and the Draft claim are listed not-posted with no amount');
select is((select count(*)::int from scwo_rows where source = 'expense_claim' and record_id in ('27320000-0000-0000-0000-000000000704', '27320000-0000-0000-0000-000000000705')), 0,
  'AC-SCWO-008 an unattributed claim and a cash advance add no line');
select is((select coalesce(sum(amount::numeric), 0) from scwo_rows where reason in ('counted', 'unassigned', 'split-when-custom') and source <> 'expense_claim'),
  (select coalesce((public.get_project_finances('27320000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric, 0)),
  'AC-SCWO-008 the project actual is unchanged: claims are added on top of it, never inside it');

-- AC-SCWO-014 / 012 (after the claims were named).
select is((select jsonb_agg(to_jsonb(r) - 'record_id' order by r.source, r.reference) from public.work_order_cost_amounts('27320000-0000-0000-0000-0000000000d2') r), null,
  'AC-SCWO-014 a project whose claims name no work order reads no claim line');
select is((select to_jsonb(p) from public.get_imprest_position('27320000-0000-0000-0000-000000000a01') p), (select v from scwo_snap where label = 'position_before'),
  'AC-SCWO-012 the float''s position is identical after a float claim names a work order');

-- AC-SCWO-009 ledger mode: the same data once the org reads the ERP ledger; only 701's approval posting is pushed.
reset role;
set local session_replication_role = replica;
insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
values ('27320000-0000-0000-0000-00000000000a', 'erpnext', 'https://erp.example.test', 'test-ref', 'active', '27320000-0000-0000-0000-0000000000a1', now());
insert into public.budget_category_account_map (org_id, category, erp_account, is_push_target) values ('27320000-0000-0000-0000-00000000000a', 'Materials', 'SCWO-MATERIALS', true);
insert into public.erp_actuals_snapshot (org_id, project_id, account, fiscal_year, net, as_of, snapshot_id, created_at)
values ('27320000-0000-0000-0000-00000000000a', '27320000-0000-0000-0000-0000000000d1', 'SCWO-MATERIALS', 'FY-2026', 1000, now(), '27320000-0000-0000-0000-000000000e01', now());
insert into public.expense_posting_erp_mirror (org_id, claim_id, posting, posting_identity, state_stamp, push_state)
select '27320000-0000-0000-0000-00000000000a', c.id, 'approval', c.id::text || ':approval', now(), case when c.id = '27320000-0000-0000-0000-000000000701' then 'pushed' else 'pending' end
  from public.expense_claims c where c.id in ('27320000-0000-0000-0000-000000000701', '27320000-0000-0000-0000-000000000702');
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('27320000-0000-0000-0000-0000000000a2');
create temp table scwo_erp on commit drop as select * from public.work_order_cost_amounts('27320000-0000-0000-0000-0000000000d1');
grant all on scwo_erp to authenticated;
select is((select sum(amount::numeric) from scwo_erp where source = 'expense_claim' and reason = 'counted'), 400.00::numeric,
  'AC-SCWO-009 only the claim whose approval posting is pushed counts (400)');
select is((select count(*)::int from scwo_erp where source = 'expense_claim' and reason = 'not-posted' and amount is null), 4,
  'AC-SCWO-009 the unposted claims (702, 703, 707, 709) are listed not-posted with no amount');
select is((select sum(amount::numeric) from scwo_erp where reason in ('counted', 'unassigned', 'split-when-custom')),
  (select (public.get_project_finances('27320000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric),
  'AC-SCWO-009 the ledger total is unchanged: the pushed 400 moved out of Not assigned, nothing counted twice');
select is((select amount::numeric from scwo_erp where source = 'project_actuals'), 600.00::numeric,
  'AC-SCWO-009 Not assigned is the ledger 1000 less the 400 now on WO-A');

select * from finish();
rollback;
