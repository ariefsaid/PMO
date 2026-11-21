-- 1182_third_party_inspection_purchase.test.sql — #2580 MONEY PATH (docs/specs/third-party-inspections.spec.md).
-- Migration under test: 1182_third_party_inspection_purchase.sql (tpi_raise_purchase, the a1_tpi_stamp_cost_attribution triggers).
-- AC-TPI-002 raising a purchase creates exactly one Draft case and nothing else · AC-TPI-003 link refusals ·
-- AC-TPI-018 the attribution trigger (a)-(c) · AC-TPI-012 advancing/reporting/waiving never touches a bill ·
-- AC-TPI-014 project totals do not change because an inspection exists. (d) 0950_work_order_cost_attribution stays green unchanged.
-- Every denial asserts the errcode AND the message. Fixtures are written as the table owner.
begin;
create extension if not exists pgtap;
select plan(38);

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into organizations (id, name, default_currency) values ('25800000-0000-0000-0000-00000000000a', 'TPI Org', 'USD'), ('25800000-0000-0000-0000-00000000000b', 'TPI Other', 'USD');
insert into auth.users (id, email) values
  ('25800000-0000-0000-0000-0000000000a1', 'tpp-admin@example.com'), ('25800000-0000-0000-0000-0000000000a2', 'tpp-pm2@example.com'), ('25800000-0000-0000-0000-0000000000a3', 'tpp-pm@example.com'),
  ('25800000-0000-0000-0000-0000000000a4', 'tpp-eng@example.com'), ('25800000-0000-0000-0000-0000000000a6', 'tpp-fin@example.com'), ('25800000-0000-0000-0000-0000000000b1', 'tpp-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25800000-0000-0000-0000-0000000000a1', '25800000-0000-0000-0000-00000000000a', 'TPP Admin', 'tpp-admin@example.com', 'Admin', 'active'),
  ('25800000-0000-0000-0000-0000000000a2', '25800000-0000-0000-0000-00000000000a', 'TPP PM Two', 'tpp-pm2@example.com', 'Project Manager', 'active'),
  ('25800000-0000-0000-0000-0000000000a3', '25800000-0000-0000-0000-00000000000a', 'TPP PM', 'tpp-pm@example.com', 'Project Manager', 'active'),
  ('25800000-0000-0000-0000-0000000000a4', '25800000-0000-0000-0000-00000000000a', 'TPP Eng', 'tpp-eng@example.com', 'Engineer', 'active'),
  ('25800000-0000-0000-0000-0000000000a6', '25800000-0000-0000-0000-00000000000a', 'TPP Fin', 'tpp-fin@example.com', 'Finance', 'active'),
  ('25800000-0000-0000-0000-0000000000b1', '25800000-0000-0000-0000-00000000000b', 'TPP XOrg', 'tpp-xorg@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-00000000000a', 'TPP Site', 'Ongoing Project', '25800000-0000-0000-0000-0000000000a3'),
  ('25800000-0000-0000-0000-0000000000d2', '25800000-0000-0000-0000-00000000000a', 'TPP Site Two', 'Ongoing Project', '25800000-0000-0000-0000-0000000000a3'),
  ('25800000-0000-0000-0000-0000000000d9', '25800000-0000-0000-0000-00000000000b', 'TPP Other Site', 'Ongoing Project', null);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-0000000000d1', 'WO one', 'Issued', 10000, 'exclusive', 0),
  ('25800000-0000-0000-0000-000000000402', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-0000000000d1', 'WO cancelled', 'Cancelled', 10000, 'exclusive', 0),
  ('25800000-0000-0000-0000-000000000403', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-0000000000d2', 'WO other project', 'Issued', 10000, 'exclusive', 0),
  ('25800000-0000-0000-0000-000000000404', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-0000000000d1', 'WO two', 'Issued', 10000, 'exclusive', 0),
  ('25800000-0000-0000-0000-000000000409', '25800000-0000-0000-0000-00000000000b', '25800000-0000-0000-0000-0000000000d9', 'WO foreign', 'Issued', 10000, 'exclusive', 0);
insert into companies (id, org_id, name, type) values ('25800000-0000-0000-0000-0000000000c1', '25800000-0000-0000-0000-00000000000a', 'TPP Lab', 'Vendor');
insert into cost_disciplines (id, org_id, code, name) values ('25800000-0000-0000-0000-000000000501', '25800000-0000-0000-0000-00000000000a', 'CIV', 'Civil');
insert into procurements (id, org_id, title, project_id, requested_by_id, status) values
  ('25800000-0000-0000-0000-000000000601', '25800000-0000-0000-0000-00000000000a', 'link me',        '25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-0000000000a3', 'Draft'),
  ('25800000-0000-0000-0000-000000000602', '25800000-0000-0000-0000-00000000000a', 'other project',  '25800000-0000-0000-0000-0000000000d2', '25800000-0000-0000-0000-0000000000a3', 'Draft'),
  ('25800000-0000-0000-0000-000000000603', '25800000-0000-0000-0000-00000000000a', 'names WO two',   '25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-0000000000a3', 'Draft'),
  ('25800000-0000-0000-0000-000000000604', '25800000-0000-0000-0000-00000000000a', 'held',           '25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-0000000000a3', 'Draft'),
  ('25800000-0000-0000-0000-000000000605', '25800000-0000-0000-0000-00000000000a', 'cancel case',    '25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-0000000000a3', 'Draft'),
  ('25800000-0000-0000-0000-000000000606', '25800000-0000-0000-0000-00000000000a', 'cancelled WO',   '25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-0000000000a3', 'Draft'),
  ('25800000-0000-0000-0000-000000000607', '25800000-0000-0000-0000-00000000000a', 'match case',     '25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-0000000000a3', 'Draft'),
  ('25800000-0000-0000-0000-000000000609', '25800000-0000-0000-0000-00000000000b', 'foreign case',   '25800000-0000-0000-0000-0000000000d9', '25800000-0000-0000-0000-0000000000b1', 'Draft');
insert into purchase_requests (id, org_id, procurement_id, pr_number, status, date, currency) values
  ('25800000-0000-0000-0000-000000000611', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000601', 'PR-1', 'Approved', '2026-11-16', 'USD');
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency, discipline_id) values
  ('25800000-0000-0000-0000-000000000612', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000601', 'PO-1', 'Issued', '2026-11-16', 1000, 'USD', '25800000-0000-0000-0000-000000000501'),
  ('25800000-0000-0000-0000-000000000622', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000603', 'PO-2', 'Issued', '2026-11-16', 200, 'USD', null);
update purchase_orders set work_order_id = '25800000-0000-0000-0000-000000000404' where id = '25800000-0000-0000-0000-000000000622';
insert into procurement_receipts (id, org_id, procurement_id, gr_number, receipt_date, status) values
  ('25800000-0000-0000-0000-000000000613', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000601', 'GR-1', '2026-11-16', 'Partial');
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, tax_treatment, tax_amount, currency, amount) values
  ('25800000-0000-0000-0000-000000000614', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000601', 'VI-1', '2026-11-16', 'Received', 'exclusive', 0, 'USD', 1000),
  ('25800000-0000-0000-0000-000000000615', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000601', 'VI-2', '2026-11-16', 'Received', 'exclusive', 0, 'USD', 50),
  ('25800000-0000-0000-0000-000000000616', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000607', 'VI-3', '2026-11-16', 'Received', 'exclusive', 0, 'USD', 400);
set local pmo.bill_void = 'on';
update procurement_invoices set voided_at = '2026-11-18 00:00', erp_cancelled_at = '2026-11-18 00:00', void_reason = 'fixture', voided_by = '25800000-0000-0000-0000-0000000000a3' where id = '25800000-0000-0000-0000-000000000615';
set local pmo.bill_void = 'off';

insert into third_party_inspections (id, org_id, work_order_id, project_id, title, planned_date, vendor_id, estimate, estimate_currency, required_for, status, created_by, procurement_id) values
  ('25800000-0000-0000-0000-000000000a01', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'New case',     '2026-12-01', '25800000-0000-0000-0000-0000000000c1', 1500, 'USD', '{billing}', 'requested', '25800000-0000-0000-0000-0000000000a3', null),
  ('25800000-0000-0000-0000-000000000a02', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'Refusals',     '2026-12-01', null, null, null, '{billing}', 'requested', '25800000-0000-0000-0000-0000000000a3', null),
  ('25800000-0000-0000-0000-000000000a03', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'Link existing','2026-12-01', null, null, null, '{billing}', 'requested', '25800000-0000-0000-0000-0000000000a3', null),
  ('25800000-0000-0000-0000-000000000a04', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'Tracked cancel','2026-12-01', null, null, null, '{}', 'requested', '25800000-0000-0000-0000-0000000000a3', null),
  ('25800000-0000-0000-0000-000000000a06', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'Match chain',  '2026-12-01', null, null, null, '{billing}', 'requested', '25800000-0000-0000-0000-0000000000a3', null);
insert into third_party_inspections (id, org_id, work_order_id, project_id, title, planned_date, required_for, status, created_by, procurement_id, purchase_raised_at, purchase_raised_by) values
  ('25800000-0000-0000-0000-000000000a09', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'Holds case 604', '2026-12-01', '{}', 'purchase_raised', '25800000-0000-0000-0000-0000000000a3', '25800000-0000-0000-0000-000000000604', now(), '25800000-0000-0000-0000-0000000000a3'),
  ('25800000-0000-0000-0000-000000000a05', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000402', '25800000-0000-0000-0000-0000000000d1', 'On a cancelled WO', '2026-12-01', '{}', 'purchase_raised', '25800000-0000-0000-0000-0000000000a3', '25800000-0000-0000-0000-000000000606', now(), '25800000-0000-0000-0000-0000000000a3');

-- AC-TPI-014 (before): project totals as Finance sees them
create temp table tpp_snap (label text primary key, v jsonb);
grant all on tpp_snap to authenticated;
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a6');
insert into tpp_snap select 'committed', coalesce(jsonb_agg(to_jsonb(c) order by c.currency), '[]') from public.project_committed_spend('25800000-0000-0000-0000-0000000000d1') c;
insert into tpp_snap select 'actuals', coalesce(jsonb_agg(to_jsonb(a) order by a.category), '[]') from public.project_finance_actuals('25800000-0000-0000-0000-0000000000d1') a;

-- ── AC-TPI-002 raising the purchase (a new case) ─────────────────────────────────────────────────────
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a4');
select throws_ok($$ select tpi_raise_purchase('25800000-0000-0000-0000-000000000a01') $$, '42501', 'you cannot raise the purchase of an inspection',
  'AC-TPI-013: an Engineer cannot raise a purchase');
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a3');
select lives_ok($$ select tpi_raise_purchase('25800000-0000-0000-0000-000000000a01') $$, 'AC-TPI-002: a Project Manager raises the purchase of a requested inspection');
reset role;
select is((select status from third_party_inspections where id = '25800000-0000-0000-0000-000000000a01'), 'purchase_raised', 'AC-TPI-002: the inspection is purchase_raised');
select is((select count(*) from procurements p where p.id = (select procurement_id from third_party_inspections where id = '25800000-0000-0000-0000-000000000a01')
            and p.status = 'Draft' and p.project_id = '25800000-0000-0000-0000-0000000000d1' and p.vendor_id = '25800000-0000-0000-0000-0000000000c1'
            and p.requested_by_id = '25800000-0000-0000-0000-0000000000a3' and p.total_value = 0), 1::bigint,
  'AC-TPI-002: exactly one Draft case on the inspection''s project, vendor in its header, the caller as requester, nothing copied from the estimate');
select is((select count(*) from procurement_create_intents where procurement_id = (select procurement_id from third_party_inspections where id = '25800000-0000-0000-0000-000000000a01')),
  1::bigint, 'AC-TPI-002: the case came through create_procurement_with_items (its create-intent row exists)');
select is((select (select count(*) from purchase_requests where procurement_id = x.p) + (select count(*) from purchase_orders where procurement_id = x.p)
                 + (select count(*) from procurement_receipts where procurement_id = x.p) + (select count(*) from procurement_invoices where procurement_id = x.p)
                 + (select count(*) from procurement_items where procurement_id = x.p)
            from (select procurement_id p from third_party_inspections where id = '25800000-0000-0000-0000-000000000a01') x),
  0::bigint, 'AC-TPI-002: no request, order, receipt, bill or line exists on the new case');
select is((select count(*) from procurements where project_id = '25800000-0000-0000-0000-0000000000d1' and title like 'Inspection:%'), 1::bigint, 'AC-TPI-002: exactly one new procurements row');
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a3');
select throws_ok($$ select tpi_raise_purchase('25800000-0000-0000-0000-000000000a01') $$, '23514', 'TPI_STEP: the purchase can be raised only while the inspection is requested',
  'FR-TPI-006: a second raise is refused');

-- ── AC-TPI-003 link refusals ─────────────────────────────────────────────────────────────────────────
select throws_ok($$ select tpi_raise_purchase('25800000-0000-0000-0000-000000000a02', '25800000-0000-0000-0000-000000000602') $$, '23514',
  'TPI_LINK_SCOPE: the purchase is not on this inspection''s project', 'AC-TPI-003: a case of another project is refused');
select throws_ok($$ select tpi_raise_purchase('25800000-0000-0000-0000-000000000a02', '25800000-0000-0000-0000-000000000609') $$, '23514',
  'TPI_LINK_SCOPE: the purchase is not on this inspection''s project', 'AC-TPI-003: a case of another organisation is refused (reads as absent)');
select throws_ok($$ select tpi_raise_purchase('25800000-0000-0000-0000-000000000a02', '25800000-0000-0000-0000-000000000604') $$, '23514',
  'TPI_LINK_HELD: another inspection already holds this purchase', 'AC-TPI-003: a case already held by another inspection is refused');
select throws_ok($$ select tpi_raise_purchase('25800000-0000-0000-0000-000000000a02', '25800000-0000-0000-0000-000000000603') $$, '23514',
  'TPI_LINK_WO: records of this purchase name another work order', 'AC-TPI-003: a case whose records name another work order is refused');
select is((select status from third_party_inspections where id = '25800000-0000-0000-0000-000000000a02'), 'requested', 'AC-TPI-003: every refusal left the inspection requested');

-- ── link an existing case: its records take the inspection's work order ──────────────────────────────
select lives_ok($$ select tpi_raise_purchase('25800000-0000-0000-0000-000000000a03', '25800000-0000-0000-0000-000000000601') $$, 'FR-TPI-006: an existing unlinked case of the project is linked');
reset role;
select is((select count(*) from (select work_order_id from purchase_requests where id = '25800000-0000-0000-0000-000000000611'
            union all select work_order_id from purchase_orders where id = '25800000-0000-0000-0000-000000000612'
            union all select work_order_id from procurement_receipts where id = '25800000-0000-0000-0000-000000000613'
            union all select work_order_id from procurement_invoices where id = '25800000-0000-0000-0000-000000000614') x
           where x.work_order_id = '25800000-0000-0000-0000-000000000401'), 4::bigint, 'FR-TPI-006: the case''s request, order, receipt and bill name the work order');
select is((select discipline_id from purchase_orders where id = '25800000-0000-0000-0000-000000000612'), '25800000-0000-0000-0000-000000000501'::uuid, 'FR-TPI-006: each record keeps its own discipline');
select is((select work_order_id from procurement_invoices where id = '25800000-0000-0000-0000-000000000615'), null, 'FR-TPI-006: a voided bill is not attributed');
select is((select count(*) from audit_events where action = 'cost_attribution.set' and entity_id = '25800000-0000-0000-0000-000000000612'), 1::bigint,
  'FR-TPI-006: the attribution went through set_cost_attribution (its audit row exists)');

-- ── AC-TPI-014 project totals (taken before any later purchase record is inserted: a record raises committed by itself) ────────────────────────────────────────────────────────────────────────
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a6');
select is((select coalesce(jsonb_agg(to_jsonb(c) order by c.currency), '[]') from public.project_committed_spend('25800000-0000-0000-0000-0000000000d1') c),
          (select v from tpp_snap where label = 'committed'), 'AC-TPI-014: committed spend is unchanged by creating, purchasing and advancing inspections');
select is((select coalesce(jsonb_agg(to_jsonb(a) order by a.category), '[]') from public.project_finance_actuals('25800000-0000-0000-0000-0000000000d1') a),
          (select v from tpp_snap where label = 'actuals'), 'AC-TPI-014: actuals are unchanged by the inspection rows');

reset role;

-- ── AC-TPI-018 the trigger ───────────────────────────────────────────────────────────────────────────
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency) values
  ('25800000-0000-0000-0000-000000000631', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000601', 'PO-NEW', 'Draft', '2026-11-17', 300, 'USD');
select is((select work_order_id from purchase_orders where id = '25800000-0000-0000-0000-000000000631'), '25800000-0000-0000-0000-000000000401'::uuid,
  'AC-TPI-018 (a): a purchase order created later on the linked case carries the inspection''s work order');
select is((select count(*) from work_order_cost_lines where source = 'purchase_order' and record_id = '25800000-0000-0000-0000-000000000631' and work_order_id = '25800000-0000-0000-0000-000000000401'), 1::bigint,
  'AC-TPI-018 (a): and it appears in work_order_cost_lines');
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, tax_treatment, tax_amount, currency, amount) values
  ('25800000-0000-0000-0000-000000000632', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000601', 'VI-NEW', '2026-11-17', 'Received', 'exclusive', 0, 'USD', 90);
select is((select work_order_id from procurement_invoices where id = '25800000-0000-0000-0000-000000000632'), '25800000-0000-0000-0000-000000000401'::uuid, 'AC-TPI-018 (a): a later vendor bill is stamped too');
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency) values
  ('25800000-0000-0000-0000-000000000633', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000605', 'PO-NOLINK', 'Draft', '2026-11-17', 10, 'USD');
select is((select work_order_id from purchase_orders where id = '25800000-0000-0000-0000-000000000633'), null, 'AC-TPI-018 (b): a case no inspection holds gets no work order');
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a3');
select lives_ok($$ select tpi_raise_purchase('25800000-0000-0000-0000-000000000a04', '25800000-0000-0000-0000-000000000605') $$, 'AC-TPI-018 (b): a tracked-only inspection takes a case');
select lives_ok($$ select tpi_cancel('25800000-0000-0000-0000-000000000a04', 'test dropped') $$, 'AC-TPI-018 (b): and is cancelled');
reset role;
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency) values
  ('25800000-0000-0000-0000-000000000634', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000605', 'PO-CANCELLED', 'Draft', '2026-11-17', 10, 'USD');
select is((select work_order_id from purchase_orders where id = '25800000-0000-0000-0000-000000000634'), null, 'AC-TPI-018 (b): a case held only by a cancelled inspection gets no work order');
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency) values
  ('25800000-0000-0000-0000-000000000635', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000606', 'PO-WOCANC', 'Draft', '2026-11-17', 10, 'USD');
select is((select work_order_id from purchase_orders where id = '25800000-0000-0000-0000-000000000635'), null,
  'AC-TPI-018 (b): a case whose work order was cancelled is not stamped (and procurement is not broken)');
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency, work_order_id) values
  ('25800000-0000-0000-0000-000000000636', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000601', 'PO-WO2', 'Draft', '2026-11-17', 10, 'USD', '25800000-0000-0000-0000-000000000404');
select is((select work_order_id from purchase_orders where id = '25800000-0000-0000-0000-000000000636'), '25800000-0000-0000-0000-000000000404'::uuid,
  'AC-TPI-018 (c): a different work order of the same project is kept, never replaced');
select throws_ok($$ insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency, work_order_id) values
  ('25800000-0000-0000-0000-000000000637', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000601', 'PO-WO3', 'Draft', '2026-11-17', 10, 'USD', '25800000-0000-0000-0000-000000000403') $$,
  '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-TPI-018 (c): a work order of another project is refused by the shipped rule');

-- ── AC-TPI-012 a bill's match state is procurement's alone ───────────────────────────────────────────
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a3');
select lives_ok($$ select tpi_raise_purchase('25800000-0000-0000-0000-000000000a06', '25800000-0000-0000-0000-000000000607') $$, 'AC-TPI-012: fixture, the match case is linked');
reset role;
insert into tpp_snap select 'bill_before', to_jsonb(i) || jsonb_build_object('match', public.bill_match_evaluate(i.id)) from procurement_invoices i where i.id = '25800000-0000-0000-0000-000000000616';
insert into storage.objects (bucket_id, name) values ('inspection-reports', '25800000-0000-0000-0000-00000000000a/25800000-0000-0000-0000-000000000a06/25800000-0000-0000-0000-000000000f01/r.pdf');
select pg_temp.as_user('25800000-0000-0000-0000-0000000000a4');
select lives_ok($$ select tpi_record_invitation('25800000-0000-0000-0000-000000000a06', '2026-11-19', 'Lab', 'email') $$, 'AC-TPI-012: invited');
select lives_ok($$ select tpi_record_execution('25800000-0000-0000-0000-000000000a06', '2026-11-19') $$, 'AC-TPI-012: executed');
select lives_ok($$ insert into third_party_inspection_files (id, inspection_id, file_path) values
  ('25800000-0000-0000-0000-000000000f01', '25800000-0000-0000-0000-000000000a06', '25800000-0000-0000-0000-00000000000a/25800000-0000-0000-0000-000000000a06/25800000-0000-0000-0000-000000000f01/r.pdf') $$, 'AC-TPI-012: report attached');
select lives_ok($$ select tpi_record_report('25800000-0000-0000-0000-000000000a06', 'fail') $$, 'AC-TPI-012: reported');
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a2');
select lives_ok($$ select tpi_waive('25800000-0000-0000-0000-000000000a06', 'client waived the failed test') $$, 'AC-TPI-012: waived');
reset role;
select is((select to_jsonb(i) || jsonb_build_object('match', public.bill_match_evaluate(i.id)) from procurement_invoices i where i.id = '25800000-0000-0000-0000-000000000616'),
  (select v from tpp_snap where label = 'bill_before'), 'AC-TPI-012: advancing, reporting and waiving left the bill and its match state unchanged');

-- AC-TPI-014 (second half): the same read DOES move once purchase records exist on the linked case.
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a6');
select isnt((select coalesce(jsonb_agg(to_jsonb(c) order by c.currency), '[]') from public.project_committed_spend('25800000-0000-0000-0000-0000000000d1') c),
            (select v from tpp_snap where label = 'committed'), 'AC-TPI-014: committed spend changes only when purchase records are added to the case');
reset role;

select * from finish();
rollback;
