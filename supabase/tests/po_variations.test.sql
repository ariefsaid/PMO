-- #1513 S4: PO variations, revisions and the client work-order link
-- (AC-SCA-002/003/005/010, FR-SCA-030..036, 040..041, NFR-SCA-006, PQ-5/6/11/12).
-- Fixture F1 + F2 + F3 of docs/plans/2026-11-01-subcontract-acceptance.md, plus S4 extras.
begin;
create extension if not exists pgtap;
select plan(86);

-- F1: org A (multi-member), org B (other tenant), org S (sole member). Inserted as superuser, before `set local role`.
insert into organizations (id, name, default_currency) values
  ('15130000-0000-0000-0000-00000000000a', 'SCA Org',       'IDR'),
  ('15130000-0000-0000-0000-00000000000b', 'SCA Other Org', 'IDR'),
  ('15130000-0000-0000-0000-00000000000c', 'SCA Solo Org',  'IDR');
insert into auth.users (id, email) values
  ('15130000-0000-0000-0000-0000000000a1', 'sca-admin@example.com'),
  ('15130000-0000-0000-0000-0000000000a2', 'sca-fin1@example.com'),
  ('15130000-0000-0000-0000-0000000000a3', 'sca-fin2@example.com'),
  ('15130000-0000-0000-0000-0000000000a4', 'sca-pm@example.com'),
  ('15130000-0000-0000-0000-0000000000a5', 'sca-eng@example.com'),
  ('15130000-0000-0000-0000-0000000000a6', 'sca-exec@example.com'),
  ('15130000-0000-0000-0000-0000000000a7', 'sca-pm-off@example.com'),
  ('15130000-0000-0000-0000-0000000000a8', 'sca-fin-off@example.com'),
  ('15130000-0000-0000-0000-0000000000b1', 'sca-xorg@example.com'),
  ('15130000-0000-0000-0000-0000000000c1', 'sca-solo@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15130000-0000-0000-0000-0000000000a1', '15130000-0000-0000-0000-00000000000a', 'SCA Admin', 'sca-admin@example.com', 'Admin', 'active'),
  ('15130000-0000-0000-0000-0000000000a2', '15130000-0000-0000-0000-00000000000a', 'SCA Fin1',  'sca-fin1@example.com',  'Finance', 'active'),
  ('15130000-0000-0000-0000-0000000000a3', '15130000-0000-0000-0000-00000000000a', 'SCA Fin2',  'sca-fin2@example.com',  'Finance', 'active'),
  ('15130000-0000-0000-0000-0000000000a4', '15130000-0000-0000-0000-00000000000a', 'SCA PM',    'sca-pm@example.com',    'Project Manager', 'active'),
  ('15130000-0000-0000-0000-0000000000a5', '15130000-0000-0000-0000-00000000000a', 'SCA Eng',   'sca-eng@example.com',   'Engineer', 'active'),
  ('15130000-0000-0000-0000-0000000000a6', '15130000-0000-0000-0000-00000000000a', 'SCA Exec',  'sca-exec@example.com',  'Executive', 'active'),
  ('15130000-0000-0000-0000-0000000000a7', '15130000-0000-0000-0000-00000000000a', 'SCA PM Off', 'sca-pm-off@example.com', 'Project Manager', 'disabled'),
  ('15130000-0000-0000-0000-0000000000a8', '15130000-0000-0000-0000-00000000000a', 'SCA Fin Off', 'sca-fin-off@example.com', 'Finance', 'disabled'),
  ('15130000-0000-0000-0000-0000000000b1', '15130000-0000-0000-0000-00000000000b', 'SCA XOrg',  'sca-xorg@example.com',  'Admin', 'active'),
  ('15130000-0000-0000-0000-0000000000c1', '15130000-0000-0000-0000-00000000000c', 'SCA Solo',  'sca-solo@example.com',  'Finance', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-00000000000a', 'SCA Site',  'Ongoing Project', '15130000-0000-0000-0000-0000000000a4'),
  ('15130000-0000-0000-0000-0000000000d2', '15130000-0000-0000-0000-00000000000a', 'SCA Site Two', 'Ongoing Project', '15130000-0000-0000-0000-0000000000a4'),
  ('15130000-0000-0000-0000-0000000000d9', '15130000-0000-0000-0000-00000000000c', 'SCA Solo Site', 'Ongoing Project', null);
-- Client BoQ items: L1 (100 m3), L2 (50 m) on project d1; L9 on the solo project.
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15130000-0000-0000-0000-0000000000e1', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'L1', 'Excavation', 'm3', 100, 150000),
  ('15130000-0000-0000-0000-0000000000e2', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'L2', 'Piping',     'm',  50,  90000),
  ('15130000-0000-0000-0000-0000000000e3', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'L3', 'Not on PO', 'ls', 5,   10000),
  ('15130000-0000-0000-0000-0000000000e9', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000d9', 'L9', 'Solo work',  'ls', 10,  10000);
-- Subcontract purchase SP (Ordered, approved 12,000,000, Subcontractors line) and its PO.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('15130000-0000-0000-0000-0000000000f1', '15130000-0000-0000-0000-00000000000a', 'SCA earthworks subcontract',
   '15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-0000000000a4', 'Ordered', 12000000, 12000000,
   '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true),
  ('15130000-0000-0000-0000-0000000000f9', '15130000-0000-0000-0000-00000000000c', 'SCA solo subcontract',
   '15130000-0000-0000-0000-0000000000d9', '15130000-0000-0000-0000-0000000000c1', 'Ordered', 100000, null,
   null, 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('15130000-0000-0000-0000-000000000101', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1', 'PO-SCA-1', 'Issued', current_date, 'IDR'),
  ('15130000-0000-0000-0000-000000000109', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000f9', 'PO-SCA-9', 'Issued', current_date, 'IDR');
-- Signed Berita Acara documents (Issued, with a file) on each project.
insert into project_documents (id, org_id, project_id, category, title, status, file_path) values
  ('15130000-0000-0000-0000-000000000201', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'Acceptance', 'BA period 1', 'Issued',
   '15130000-0000-0000-0000-00000000000a/15130000-0000-0000-0000-0000000000d1/15130000-0000-0000-0000-000000000201/ba1.pdf'),
  ('15130000-0000-0000-0000-000000000202', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d2', 'Acceptance', 'BA other project', 'Issued',
   '15130000-0000-0000-0000-00000000000a/15130000-0000-0000-0000-0000000000d2/15130000-0000-0000-0000-000000000202/ba2.pdf'),
  ('15130000-0000-0000-0000-000000000209', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000d9', 'Acceptance', 'BA solo', 'Issued',
   '15130000-0000-0000-0000-00000000000c/15130000-0000-0000-0000-0000000000d9/15130000-0000-0000-0000-000000000209/ba9.pdf');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- F2: revision 1 of PO …101 (L1 100 m3 @ 100,000 + L2 50 m @ 40,000 = 12,000,000) and of PO …109 (L9 10 ls @ 10,000).
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('15130000-0000-0000-0000-000000000101', 1, '15130000-0000-0000-0000-0000000000e1', 100, 100000, 'm3'),
  ('15130000-0000-0000-0000-000000000101', 1, '15130000-0000-0000-0000-0000000000e2',  50,  40000, 'm'),
  ('15130000-0000-0000-0000-000000000109', 1, '15130000-0000-0000-0000-0000000000e9',  10,  10000, 'ls');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('15130000-0000-0000-0000-000000000101', '15130000-0000-0000-0000-0000000000f1', 1, 'Issued', 12000000, '15130000-0000-0000-0000-0000000000a4', 'standard'),
  ('15130000-0000-0000-0000-000000000109', '15130000-0000-0000-0000-0000000000f9', 1, 'Issued',   100000, '15130000-0000-0000-0000-0000000000c1', 'standard');

-- F3: append a Confirmed acceptance as superuser (immutability triggers fire on UPDATE/DELETE only).
create or replace function pg_temp.confirmed_acceptance(p_po uuid, p_l1 numeric, p_l2 numeric) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into subcontract_acceptances (id, org_id, project_id, po_id, acceptance_date, status, prepared_by, confirmed_by,
                                       confirmed_at, confirm_basis, document_id)
  values (v, '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', p_po, current_date, 'Confirmed',
          '15130000-0000-0000-0000-0000000000a4', '15130000-0000-0000-0000-0000000000a2', clock_timestamp(), 'standard',
          '15130000-0000-0000-0000-000000000201');
  insert into subcontract_acceptance_lines values (v, '15130000-0000-0000-0000-0000000000e1', p_l1);
  if p_l2 is not null then insert into subcontract_acceptance_lines values (v, '15130000-0000-0000-0000-0000000000e2', p_l2); end if;
  return v;
end $$;

-- Bills in tests are captured through the RPC with tax exclusive, zero tax.
create or replace function pg_temp.bill(p_l1 numeric, p_l2 numeric default null) returns uuid language sql as $$
  select (capture_subcontract_vendor_invoice(
    p_procurement_id => '15130000-0000-0000-0000-0000000000f1', p_status => 'Received', p_invoice_date => current_date,
    p_amount => round(coalesce(p_l1,0) * 100000, 2) + round(coalesce(p_l2,0) * 40000, 2),
    p_tax_treatment => 'exclusive', p_tax_amount => 0,
    p_lines => (select jsonb_agg(x) from (
      select jsonb_build_object('boq_item_id','15130000-0000-0000-0000-0000000000e1','quantity',p_l1,'rate',100000) x where p_l1 is not null
      union all
      select jsonb_build_object('boq_item_id','15130000-0000-0000-0000-0000000000e2','quantity',p_l2,'rate',40000) where p_l2 is not null) s))).id
$$;

-- S4 extras (superuser): an Active budget on d1 with a Subcontractors line of 13,000,000 (the purchase already commits
-- 12,000,000, so 1,000,000 of headroom remains) and the senior set = Executive + Fin2 (Fin2 is there so the issuer ≠ approver
-- refusal is reached by a user who holds the issuing role).
insert into budget_versions (id, org_id, project_id, name, version, status, created_by) values
  ('15130000-0000-0000-0000-000000000301', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'v1', 1, 'Draft', null);
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-000000000301', 'Subcontractors', 13000000);
update budget_versions set status = 'Active' where id = '15130000-0000-0000-0000-000000000301';
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15130000-0000-0000-0000-00000000000a', null, '15130000-0000-0000-0000-0000000000a6'),
  ('15130000-0000-0000-0000-00000000000a', null, '15130000-0000-0000-0000-0000000000a3');
-- Client work orders: 401 on project d1, 402 on project d2.
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('15130000-0000-0000-0000-000000000401', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'SCA WO one', 'Issued', 10000, 'exclusive', 0),
  ('15130000-0000-0000-0000-000000000402', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d2', 'SCA WO two', 'Issued', 10000, 'exclusive', 0);
-- A Cancelled subcontract purchase with an issued revision (PQ-12).
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('15130000-0000-0000-0000-0000000000fb', '15130000-0000-0000-0000-00000000000a', 'SCA cancelled sub', '15130000-0000-0000-0000-0000000000d1',
   '15130000-0000-0000-0000-0000000000a4', 'Ordered', 1000, 1000, '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('15130000-0000-0000-0000-00000000010b', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000fb', 'PO-SCA-11', 'Issued', current_date, 'IDR');
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('15130000-0000-0000-0000-00000000010b', 1, '15130000-0000-0000-0000-0000000000e1', 1, 1000, 'm3');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('15130000-0000-0000-0000-00000000010b', '15130000-0000-0000-0000-0000000000fb', 1, 'Issued', 1000, '15130000-0000-0000-0000-0000000000a4', 'standard');
update procurements set status = 'Cancelled' where id = '15130000-0000-0000-0000-0000000000fb';

-- Helpers. vid(reason): the variation raised with that reason. attempt(sql): "<sqlstate>|<detail>" of the refusal, or 'ok'.
create or replace function pg_temp.vid(p_reason text) returns uuid language sql as $$
  select id from po_variations where reason = p_reason
$$;
create or replace function pg_temp.vstatus(p_reason text) returns text language sql as $$
  select status from po_variations where reason = p_reason
$$;
create or replace function pg_temp.attempt(p_sql text) returns text language plpgsql as $$
declare d text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return sqlstate || '|' || coalesce(d, '');
end $$;

select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 120, null);   -- verified 120 > PO 100

-- ── Grants, RLS, direct writes ──────────────────────────────────────────────────────────────────────────────
select is(has_table_privilege('authenticated', 'public.po_variations', 'INSERT') or has_table_privilege('authenticated', 'public.po_variations', 'UPDATE')
       or has_table_privilege('authenticated', 'public.po_variations', 'DELETE')
       or has_table_privilege('authenticated', 'public.po_variation_lines', 'INSERT') or has_table_privilege('authenticated', 'public.po_variation_lines', 'UPDATE')
       or has_table_privilege('authenticated', 'public.po_variation_lines', 'DELETE'), false,
  'NFR-SCA-003 clients hold no insert, update or delete on variations or their lines');
select is((select bool_and(relforcerowsecurity) from pg_class where oid in ('public.po_variations'::regclass, 'public.po_variation_lines'::regclass)), true,
  'NFR-SCA-003 variations and their lines are FORCE RLS');
select is(has_function_privilege('authenticated', 'public.guard_po_variation()', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.guard_po_variation_line()', 'EXECUTE'), false,
  'NFR-SCA-004 the variation guards are not client-executable');
select is(has_function_privilege('anon', 'public.request_po_variation(uuid,text,jsonb,text)', 'EXECUTE')
       or has_function_privilege('anon', 'public.decide_po_variation(uuid,boolean,text)', 'EXECUTE')
       or has_function_privilege('anon', 'public.issue_po_revision(uuid)', 'EXECUTE')
       or has_function_privilege('anon', 'public.link_po_variation(uuid,uuid,text)', 'EXECUTE')
       or has_function_privilege('anon', 'public.po_variation_route(uuid)', 'EXECUTE')
       or has_function_privilege('anon', 'public.work_order_cost_variations(uuid)', 'EXECUTE')
       or has_function_privilege('anon', 'public.project_subcontract_exposure(uuid)', 'EXECUTE')
       or has_function_privilege('anon', 'public.subcontract_po_position(uuid)', 'EXECUTE'), false,
  'NFR-SCA-004 no variation function is anon-executable');

set local role authenticated;

-- ── AC-SCA-002: post-work variation for the 20, rejected → Disputed; a bill for 101 is refused ──────────────────
savepoint s2;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select lives_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'post_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":20}]', 'Extra excavation found on site') $$,
  'FR-SCA-034 the PM opens a variation from the verified, not on PO 20');
select is((select amount from po_variations where po_id = '15130000-0000-0000-0000-000000000101'), 2000000::numeric,
  'FR-SCA-030 the variation amount is the lines at the PO rate (20 × 100,000)');
select throws_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'post_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":1}]', 'A second claim on the same 20') $$,
  '23514', null, 'FR-SCA-034 a second post-work request cannot claim quantity already on an open variation (20 of 20 taken)');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a6');
select lives_ok($$ select decide_po_variation(pg_temp.vid('Extra excavation found on site'), false, 'Not agreed') $$,
  'AC-SCA-002 the approver rejects it');
select is(pg_temp.vstatus('Extra excavation found on site'), 'Disputed', 'AC-SCA-002 a rejected post-work variation is Disputed');
select is((select disputed from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  20::numeric, 'AC-SCA-002 the 20 shows Disputed');
select is((select total_value from procurements where id = '15130000-0000-0000-0000-0000000000f1'), 12000000::numeric,
  'PQ-5 a rejected variation leaves the purchase value alone');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select pg_temp.bill(101) $$, 'SC001', null, 'AC-SCA-002 a bill for 101 is refused');
select is((select verified_not_on_po_value || '/' || disputed_value || '/' || currency
             from project_subcontract_exposure('15130000-0000-0000-0000-0000000000d1')), '2000000.00/2000000.00/IDR',
  'FR-SCA-035 the project exposure shows verified-not-on-PO and Disputed value per currency');
select ok((select oldest_unresolved_at is not null from project_subcontract_exposure('15130000-0000-0000-0000-0000000000d1')),
  'FR-SCA-035 and the age of the oldest unresolved excess');
-- PQ-6: Disputed is terminal for that record; a new post-work variation over the same unresolved 20 is allowed,
-- and once approved and revised the Disputed figure shrinks by what is now on the PO.
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select lives_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'post_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":20}]', 'Extra excavation, agreed this time') $$,
  'PQ-6 a new post-work variation can be raised over the same unresolved quantity');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select decide_po_variation(pg_temp.vid('Extra excavation, agreed this time'), true, 'Agreed');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select issue_po_revision(pg_temp.vid('Extra excavation, agreed this time'));
select is((select disputed from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  0::numeric, 'PQ-6 the Disputed figure shrinks by what is now on the PO');
select is((select verified_not_on_po from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  0::numeric, 'PQ-6 and so does verified-not-on-PO');
rollback to savepoint s2;

-- ── AC-SCA-005: pre-work variation above the budget line headroom → senior set; the requester cannot approve ───────
savepoint s5;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');   -- Fin1 requests 20 × 100,000 = 2,000,000 > 1,000,000 headroom
select lives_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":20}]', 'Design change') $$,
  'FR-SCA-030 a variation request is raised');
select is((select route || '/' || reason from po_variation_route(pg_temp.vid('Design change'))),
  'org/exceeds_line', 'AC-SCA-005 a variation that exceeds the budget line routes to the senior set (shipped rule: route org, reason exceeds_line)');
select throws_like($$ select decide_po_variation(pg_temp.vid('Design change'), true, null) $$,
  '%separation of duties%', 'AC-SCA-005 the requester cannot approve it');
select throws_like($$ select decide_po_variation(pg_temp.vid('Design change'), false, null) $$,
  '%separation of duties%', 'AC-SCA-005 nor reject it');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select throws_like($$ select decide_po_variation(pg_temp.vid('Design change'), true, null) $$,
  '%requires a named approver%', 'AC-SCA-005 a PM outside the senior set cannot approve it');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select throws_like($$ select decide_po_variation(pg_temp.vid('Design change'), true, null) $$,
  '%not authorized to decide%', 'FR-SCA-036 an Engineer holds no variation-deciding role');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select is(pg_temp.vstatus('Design change'), 'Requested', 'AC-SCA-005 every refusal left the variation Requested');
rollback to savepoint s5;

-- ── AC-SCA-003: approved variation to 120, revision 2 issued; the bill for the remaining 20 is accepted ───────────
savepoint s3;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select pg_temp.bill(100);
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select request_po_variation('15130000-0000-0000-0000-000000000101', 'post_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":20}]', 'Extra excavation');
select throws_like($$ select decide_po_variation(pg_temp.vid('Extra excavation'), true, null) $$,
  '%separation of duties%', 'AC-SCA-003 requester ≠ approver is refused');
select is(pg_temp.attempt($$ select issue_po_revision(pg_temp.vid('Extra excavation')) $$), '42501|',
  'FR-SCA-032 a revision on a Requested variation is refused (42501)');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');   -- Fin2, in the senior set
select lives_ok($$ select decide_po_variation(pg_temp.vid('Extra excavation'), true, 'Agreed') $$,
  'AC-SCA-003 the senior approver approves');
select throws_ok($$ select decide_po_variation(pg_temp.vid('Extra excavation'), true, 'Again') $$, '42501', null,
  'FR-SCA-032 a decided variation cannot be decided again');
select is((select total_value || '/' || approved_total_value || '/' || (amount_approved_by_id = '15130000-0000-0000-0000-0000000000a3')::text
             from procurements where id = '15130000-0000-0000-0000-0000000000f1'), '14000000.00/14000000.00/true',
  'PQ-5 approval raises the purchase value and approved value and stamps the variation''s approver');
select is((select line_used from spend_approval_route('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1',
             'Subcontractors', 1, 'IDR', null, null, null)), 14000000::numeric,
  'PQ-5 the budget line now counts the approved variation');
select throws_like($$ select issue_po_revision(pg_temp.vid('Extra excavation')) $$,
  '%separation of duties%', 'AC-SCA-003 issuer ≠ approver is refused');
select throws_like($$ select transition_procurement('15130000-0000-0000-0000-0000000000f1', 'Paid') $$,
  '%approver cannot pay%', 'AC-SCA-003 the variation''s approver cannot pay the purchase (SoD-b, PQ-5)');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a6');
select throws_like($$ select issue_po_revision(pg_temp.vid('Extra excavation')) $$,
  '%may issue%', 'FR-SCA-036 an Executive holds no revision-issuing role');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select throws_like($$ select issue_po_revision(pg_temp.vid('Extra excavation')) $$,
  '%may issue%', 'FR-SCA-036 an Engineer holds no revision-issuing role');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');   -- Fin1, not the approver
select is(issue_po_revision(pg_temp.vid('Extra excavation')), 2, 'AC-SCA-003 Fin1 issues revision 2');
select is((select status || '/' || revision from po_variations where reason = 'Extra excavation'), 'Revised/2',
  'FR-SCA-032 the variation is Revised at revision 2');
select is((select po_qty from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  120::numeric, 'FR-SCA-033 the cap uses the new PO quantity immediately');
select is((select quantity from purchase_order_lines where po_id = '15130000-0000-0000-0000-000000000101' and revision = 1
             and boq_item_id = '15130000-0000-0000-0000-0000000000e1'), 100::numeric, 'FR-SCA-032 revision 1 stays readable');
select is((select quantity from purchase_order_lines where po_id = '15130000-0000-0000-0000-000000000101' and revision = 2
             and boq_item_id = '15130000-0000-0000-0000-0000000000e2'), 50::numeric, 'FR-SCA-032 untouched lines carry over to revision 2');
select throws_ok($$ select issue_po_revision(pg_temp.vid('Extra excavation')) $$, '42501', null,
  'FR-SCA-032 a revised variation cannot be revised again');
select lives_ok($$ select pg_temp.bill(20) $$, 'AC-SCA-003 a bill for the remaining 20 is accepted');
select is((select amount from purchase_orders where id = '15130000-0000-0000-0000-000000000101'), 14000000::numeric,
  'FR-SCA-032 the PO amount follows revision 2');
select is((select total_value from procurements where id = '15130000-0000-0000-0000-0000000000f1'), 14000000::numeric,
  'PQ-5 the totals survive a later bill insert (no refresh rewrites them)');
rollback to savepoint s3;

-- FR-SCA-031: a variation that fits the headroom routes flat (no project approvers configured).
savepoint s31;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":5}]', 'Small change');
select is((select route || '/' || reason from po_variation_route(pg_temp.vid('Small change'))), 'flat/within_budget',
  'FR-SCA-031 a 500,000 variation fits the budget line and routes flat');
rollback to savepoint s31;

-- FR-SCA-032: a revision never exceeds the approved amount.
savepoint s32;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":20}]', 'Over-revised');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select decide_po_variation(pg_temp.vid('Over-revised'), true, null);
reset role;
select set_config('pmo.po_variation_write', 'on', true);
update po_variations set amount = 1000000 where reason = 'Over-revised';
select set_config('pmo.po_variation_write', '', true);
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select issue_po_revision(pg_temp.vid('Over-revised')) $$, '23514', null,
  'FR-SCA-032 a revision that would raise the PO above the approved amount is refused');
rollback to savepoint s32;

-- FR-SCA-034: a post-work variation above verified-not-on-PO (21) is refused; a line off the PO is refused.
savepoint s34;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select throws_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'post_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":21}]', 'Too much') $$,
  '23514', null, 'FR-SCA-034 a post-work variation above verified-not-on-PO (21 of 20) is refused');
select throws_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e3","additional_quantity":1}]', 'Not on PO') $$,
  '23514', null, 'FR-SCA-030 a variation line must be on the effective revision');
select throws_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":1},{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":2}]', 'Twice') $$,
  '23514', null, 'FR-SCA-030 a line named twice is refused');
select throws_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":0}]', 'Zero') $$,
  '23514', null, 'FR-SCA-030 a zero quantity is refused');
select throws_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":1.2345}]', 'Four decimals') $$,
  '23514', null, 'FR-SCA-030 more than three decimals is refused');
select throws_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'sideways',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":1}]', 'Bad origin') $$,
  '23514', null, 'FR-SCA-030 an unknown origin is refused');
select throws_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":1}]', '   ') $$,
  '23514', null, 'FR-SCA-030 a blank reason is refused');
rollback to savepoint s34;

-- FR-SCA-030: "any project member" is the org member who can read the purchase (explicit predicate; RLS does not apply in a definer).
savepoint s30;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select throws_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":1}]', 'Engineer not on the purchase') $$,
  'P0002', null, 'FR-SCA-030 an Engineer who did not raise the purchase gets the same answer as a missing PO');
reset role;
update procurements set requested_by_id = '15130000-0000-0000-0000-0000000000a5' where id = '15130000-0000-0000-0000-0000000000f1';
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select lives_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":1}]', 'Engineer on own purchase') $$,
  'FR-SCA-030 an Engineer who raised the purchase can raise a variation on it');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a7');   -- a disabled PM
select throws_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":1}]', 'Disabled member') $$,
  '42501', null, 'FR-SCA-030 a disabled member cannot raise a variation');
rollback to savepoint s30;

-- PQ-12: a Cancelled purchase accepts no new variation and no revision.
savepoint s12;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select throws_ok($$ select request_po_variation('15130000-0000-0000-0000-00000000010b', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":1}]', 'On a cancelled purchase') $$,
  '42501', null, 'PQ-12 a Cancelled purchase accepts no variation');
select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":5}]', 'Closed after request');
reset role;
update procurements set status = 'Cancelled' where id = '15130000-0000-0000-0000-0000000000f1';
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select throws_ok($$ select decide_po_variation(pg_temp.vid('Closed after request'), true, null) $$, '42501', null,
  'PQ-12 a Cancelled purchase''s variation cannot be decided');
rollback to savepoint s12;
savepoint s12b;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":5}]', 'Closed after approval');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select decide_po_variation(pg_temp.vid('Closed after approval'), true, null);
reset role;
update procurements set status = 'Cancelled' where id = '15130000-0000-0000-0000-0000000000f1';
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_like($$ select issue_po_revision(pg_temp.vid('Closed after approval')) $$, '%closed%',
  'PQ-12 a Cancelled purchase accepts no revision');
rollback to savepoint s12b;

-- PQ-11: a connected org cannot issue a PO revision before the ERP revise exists.
savepoint s11;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":5}]', 'Connected');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select decide_po_variation(pg_temp.vid('Connected'), true, null);
reset role;
insert into external_domain_ownership (org_id, external_tier, domain) values ('15130000-0000-0000-0000-00000000000a', 'erpnext', 'procurement');
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select is(pg_temp.attempt($$ select issue_po_revision(pg_temp.vid('Connected')) $$), '42501|erp_revise_pending',
  'PQ-11 a connected org cannot issue a PO revision before the ERP revise exists');
rollback to savepoint s11;

-- ── Write paths: direct DML and the write flag ───────────────────────────────────────────────────────────────
savepoint sw;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":5}]', 'Guarded');
select throws_ok($$ update po_variations set amount = 1 where reason = 'Guarded' $$, '42501', null,
  'NFR-SCA-004 a client cannot update a variation directly');
select throws_ok($$ delete from po_variation_lines $$, '42501', null, 'NFR-SCA-004 a client cannot delete variation lines');
reset role;
select throws_ok($$ update po_variations set amount = 1 where reason = 'Guarded' $$, '42501', null,
  'NFR-SCA-004 even the table owner cannot update a variation outside the definers');
select throws_ok($$ delete from po_variations where reason = 'Guarded' $$, '42501', null,
  'NFR-SCA-004 or delete one');
select throws_ok($$ update po_variation_lines set additional_quantity = 99 $$, '42501', null,
  'NFR-SCA-004 variation lines are immutable');
select throws_ok($$ insert into po_variation_lines (variation_id, boq_item_id, additional_quantity, rate)
  select id, '15130000-0000-0000-0000-0000000000e2', 1, 1 from po_variations where reason = 'Guarded' $$, '42501', null,
  'NFR-SCA-004 variation lines are written by the request definer only');
rollback to savepoint sw;

-- ── AC-SCA-010: client link ───────────────────────────────────────────────────────────────────────────────
savepoint s10;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","additional_quantity":5}]', 'Client asked for more piping');
select throws_ok($$ select link_po_variation(pg_temp.vid('Client asked for more piping'),
  '15130000-0000-0000-0000-000000000402', null) $$, '23514', null, 'AC-SCA-010 a work order on another project is refused');
select lives_ok($$ select link_po_variation(pg_temp.vid('Client asked for more piping'),
  '15130000-0000-0000-0000-000000000401', null) $$, 'AC-SCA-010 a same-project work order is accepted');
select is((select work_order_id from po_variations where reason = 'Client asked for more piping'),
  '15130000-0000-0000-0000-000000000401'::uuid, 'AC-SCA-010 shown on the variation');
select is((select count(*)::int from work_order_cost_variations('15130000-0000-0000-0000-000000000401')), 1,
  'AC-SCA-010 and shown on the work order');
select throws_ok($$ select link_po_variation(pg_temp.vid('Client asked for more piping'), null, '  ') $$,
  '23514', null, 'AC-SCA-010 "not passed on" requires a reason');
select throws_ok($$ select link_po_variation(pg_temp.vid('Client asked for more piping'),
  '15130000-0000-0000-0000-000000000401', 'both') $$, '23514', null, 'AC-SCA-010 a link and a "not passed on" reason together are refused');
select lives_ok($$ select link_po_variation(pg_temp.vid('Client asked for more piping'), null, 'Absorbed as our risk') $$,
  'AC-SCA-010 "not passed on" with a reason is accepted and replaces the link');
select is((select coalesce(work_order_id::text, 'none') || '/' || not_passed_reason from po_variations where reason = 'Client asked for more piping'),
  'none/Absorbed as our risk', 'AC-SCA-010 the earlier link is replaced');
select is((select count(*)::int from work_order_cost_variations('15130000-0000-0000-0000-000000000401')), 0,
  'AC-SCA-010 and the work order no longer shows it');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select throws_ok($$ select link_po_variation(pg_temp.vid('Client asked for more piping'),
  '15130000-0000-0000-0000-000000000401', null) $$, '42501', null, 'FR-SCA-040 an Engineer cannot link');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a6');
select throws_ok($$ select link_po_variation(pg_temp.vid('Client asked for more piping'),
  '15130000-0000-0000-0000-000000000401', null) $$, '42501', null, 'FR-SCA-040 an Executive cannot link');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a1');
select lives_ok($$ select link_po_variation(pg_temp.vid('Client asked for more piping'),
  '15130000-0000-0000-0000-000000000401', null) $$, 'PQ-7 an Admin can link');
select is((select status::text from work_orders where id = '15130000-0000-0000-0000-000000000401'), 'Issued',
  'FR-SCA-041 linking never changes the work order');
rollback to savepoint s10;

-- ── FR-SCA-036: sole operator (org S) ───────────────────────────────────────────────────────────────────────
savepoint s36;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000c1');
select lives_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000109', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e9","additional_quantity":1}]', 'Solo first') $$,
  'FR-SCA-036 the sole member requests a variation');
select throws_like($$ select decide_po_variation(pg_temp.vid('Solo first'), true, null) $$, '%separation of duties%',
  'FR-SCA-036 and cannot approve it (requester ≠ approver has no sole-operator exception)');
reset role;
insert into auth.users (id, email) values ('15130000-0000-0000-0000-0000000000c2', 'sca-solo2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15130000-0000-0000-0000-0000000000c2', '15130000-0000-0000-0000-00000000000c', 'SCA Solo 2', 'sca-solo2@example.com', 'Finance', 'active');
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000c2');
select request_po_variation('15130000-0000-0000-0000-000000000109', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e9","additional_quantity":1}]', 'Solo second');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000c1');
select lives_ok($$ select decide_po_variation(pg_temp.vid('Solo second'), true, null) $$, 'FR-SCA-036 the other member''s request is approved by the original member');
select throws_like($$ select issue_po_revision(pg_temp.vid('Solo second')) $$, '%separation of duties%',
  'FR-SCA-036 with another active member the approver cannot issue the revision');
reset role;
update profiles set status = 'disabled' where id = '15130000-0000-0000-0000-0000000000c2';
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000c1');
select lives_ok($$ select issue_po_revision(pg_temp.vid('Solo second')) $$,
  'FR-SCA-036 the approver who is also the sole active member issues the revision');
select is((select issue_basis from purchase_order_revisions where po_id = '15130000-0000-0000-0000-000000000109' and revision = 2),
  'sole_operator', 'FR-SCA-036 and the revision records the sole_operator basis');
rollback to savepoint s36;

-- ── NFR-SCA-006: every state change wrote an audit row ──────────────────────────────────────────────────────
savepoint sa;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","additional_quantity":1}]', 'Audited');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select decide_po_variation(pg_temp.vid('Audited'), true, null);
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select issue_po_revision(pg_temp.vid('Audited'));
select link_po_variation(pg_temp.vid('Audited'), null, 'Audit trail');
reset role;
select is((select array_agg(action order by action) from audit_events where entity_id = (select id from po_variations where reason = 'Audited')
             or entity_id = '15130000-0000-0000-0000-000000000101' and action = 'purchase_order_revision.issue'),
  array['po_variation.approve','po_variation.link','po_variation.request','purchase_order_revision.issue'],
  'NFR-SCA-006 request, approve, link and revision issue each wrote an audit event');
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","additional_quantity":1}]', 'Audited reject');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select decide_po_variation(pg_temp.vid('Audited reject'), false, 'No');
reset role;
select is((select count(*)::int from audit_events where action = 'po_variation.reject'
             and entity_id = (select id from po_variations where reason = 'Audited reject')), 1,
  'NFR-SCA-006 a rejection wrote an audit event');
rollback to savepoint sa;

select * from finish();
rollback;
