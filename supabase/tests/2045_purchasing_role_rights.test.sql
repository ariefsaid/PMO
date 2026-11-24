-- 2045_purchasing_role_rights.test.sql — the Buyer's quotes and supplier, the Procurement Manager's supply risk and the Quality
-- Inspector's inspection purchase (migration 2045). Each right: the named job role is allowed; a person at the same access level with
-- another job role is refused; a person with no job role is judged by access level as before; a field account is refused.
-- MUTATION NOTES (remove the condition tagged in 2045; the named assertion must go red; restore):
--   mut:rr_buyer_quote_fn ... 'RR-PU-01 the Buyer adds a supplier quote'
--   mut:rr_buyer_select ..... 'RR-PU-03 the Buyer selects a quote before approval'
--   mut:rr_buyer_supplier ... 'RR-PU-05 the Buyer names the supplier of an approved purchase that has none'
--   mut:rr_pm_risk .......... 'RR-PU-08 the Procurement Manager sets a vendor''s supply risk'
--   mut:rr_qi_raise ......... 'RR-PU-10 the Quality Inspector raises an inspection''s purchase request'
begin;
create extension if not exists pgtap;
select plan(24);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('20450000-0000-0000-0000-00000000000a', 'RR PU Org', 'IDR', 'UTC', true);
insert into auth.users (id, email)
select ('20450000-0000-0000-0000-0000000000' || k)::uuid, 'rrpu-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('20450000-0000-0000-0000-0000000000a1', '20450000-0000-0000-0000-00000000000a', 'Admin',     'rrpu-a1@example.com', 'Admin', 'active', null),
  ('20450000-0000-0000-0000-0000000000a2', '20450000-0000-0000-0000-00000000000a', 'Buyer',     'rrpu-a2@example.com', 'Engineer', 'active', 'buyer'),
  ('20450000-0000-0000-0000-0000000000a3', '20450000-0000-0000-0000-00000000000a', 'Store',     'rrpu-a3@example.com', 'Engineer', 'active', 'storekeeper'),
  ('20450000-0000-0000-0000-0000000000a4', '20450000-0000-0000-0000-00000000000a', 'Engineer',  'rrpu-a4@example.com', 'Engineer', 'active', null),
  ('20450000-0000-0000-0000-0000000000a5', '20450000-0000-0000-0000-00000000000a', 'Field',     'rrpu-a5@example.com', 'Engineer', 'active', 'field_user'),
  ('20450000-0000-0000-0000-0000000000a6', '20450000-0000-0000-0000-00000000000a', 'PM',        'rrpu-a6@example.com', 'Project Manager', 'active', null),
  ('20450000-0000-0000-0000-0000000000a7', '20450000-0000-0000-0000-00000000000a', 'Proc mgr',  'rrpu-a7@example.com', 'Project Manager', 'active', 'procurement_manager'),
  ('20450000-0000-0000-0000-0000000000a8', '20450000-0000-0000-0000-00000000000a', 'Qual mgr',  'rrpu-a8@example.com', 'Project Manager', 'active', 'quality_manager'),
  ('20450000-0000-0000-0000-0000000000a9', '20450000-0000-0000-0000-00000000000a', 'Inspector', 'rrpu-a9@example.com', 'Engineer', 'active', 'quality_inspector'),
  ('20450000-0000-0000-0000-0000000000b1', '20450000-0000-0000-0000-00000000000a', 'Safety',    'rrpu-b1@example.com', 'Engineer', 'active', 'safety_officer');
insert into companies (id, org_id, name, type) values
  ('20450000-0000-0000-0000-0000000000d1', '20450000-0000-0000-0000-00000000000a', 'RRPU Supplier', 'Vendor'),
  ('20450000-0000-0000-0000-0000000000d2', '20450000-0000-0000-0000-00000000000a', 'RRPU Lab', 'Vendor');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('20450000-0000-0000-0000-0000000000c1', '20450000-0000-0000-0000-00000000000a', 'RRPU project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, '20450000-0000-0000-0000-0000000000a6');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('20450000-0000-0000-0000-000000000031', '20450000-0000-0000-0000-00000000000a', '20450000-0000-0000-0000-0000000000c1', 'RRPU WO', 'Issued', 1000, 'exclusive', 0);
insert into procurements (id, org_id, title, status, currency, requested_by_id, vendor_id) values
  ('20450000-0000-0000-0000-000000000041', '20450000-0000-0000-0000-00000000000a', 'Quoting',        'Vendor Quoted', 'IDR', '20450000-0000-0000-0000-0000000000a6', null),
  ('20450000-0000-0000-0000-000000000042', '20450000-0000-0000-0000-00000000000a', 'Approved bare',  'Approved',      'IDR', '20450000-0000-0000-0000-0000000000a6', null),
  ('20450000-0000-0000-0000-000000000043', '20450000-0000-0000-0000-00000000000a', 'Approved named', 'Approved',      'IDR', '20450000-0000-0000-0000-0000000000a6', '20450000-0000-0000-0000-0000000000d1'),
  ('20450000-0000-0000-0000-000000000044', '20450000-0000-0000-0000-00000000000a', 'Requested',      'Requested',     'IDR', '20450000-0000-0000-0000-0000000000a6', '20450000-0000-0000-0000-0000000000d1');
insert into third_party_inspections (id, org_id, work_order_id, project_id, title, planned_date, vendor_id, status, created_by) values
  ('20450000-0000-0000-0000-000000000051', '20450000-0000-0000-0000-00000000000a', '20450000-0000-0000-0000-000000000031', '20450000-0000-0000-0000-0000000000c1',
   'Hydrotest', current_date + 7, '20450000-0000-0000-0000-0000000000d2', 'requested', '20450000-0000-0000-0000-0000000000a9'),
  ('20450000-0000-0000-0000-000000000052', '20450000-0000-0000-0000-00000000000a', '20450000-0000-0000-0000-000000000031', '20450000-0000-0000-0000-0000000000c1',
   'NDT', current_date + 7, '20450000-0000-0000-0000-0000000000d2', 'requested', '20450000-0000-0000-0000-0000000000a9');

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"20450000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return 'ok';
exception when others then
  execute 'reset role';
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;
create function pg_temp.quote(p_amount int) returns text language sql as $$
  select format('select create_procurement_quotation(%L, %L, %s, current_date)',
                '20450000-0000-0000-0000-000000000041', '20450000-0000-0000-0000-0000000000d1', p_amount) $$;
create function pg_temp.supplier(p_proc text) returns text language sql as $$
  select format('select set_procurement_supplier(%L, %L)', '20450000-0000-0000-0000-0000000000' || p_proc, '20450000-0000-0000-0000-0000000000d1') $$;
create function pg_temp.risk() returns text language sql as $$
  select $r$select set_vendor_supply_status('20450000-0000-0000-0000-0000000000d1', 'at_risk', 'late deliveries')$r$ $$;

select pg_temp.err('a1', $$select po_set_order_job_roles(array['buyer'])$$);

-- ── quotes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a2', pg_temp.quote(1000)), 'ok', 'RR-PU-01 the Buyer adds a supplier quote');
select is(pg_temp.err('a2', pg_temp.quote(1200)), 'ok', 'RR-PU-02 the Buyer adds a second quote');
select is(pg_temp.err('a3', pg_temp.quote(900)), '42501 not authorized', 'RR-PU-04 a Storekeeper at the same access level cannot add a quote');
select is(pg_temp.err('a4', pg_temp.quote(900)), '42501 not authorized', 'RR-PU-04 an Engineer with no job role still cannot');
select is(pg_temp.err('a5', pg_temp.quote(900)), '42501 LIGHT_ACCOUNT', 'RR-PU-04 a field account cannot');
select is(pg_temp.err('a2', $$select select_procurement_quote((select id from procurement_quotations where total_amount = 1000))$$), 'ok',
  'RR-PU-03 the Buyer selects a quote before approval');
select is((select status::text || '/' || total_value from procurements where id = '20450000-0000-0000-0000-000000000041'), 'Quote Selected/1000.00',
  'RR-PU-03 the selected quote sets the purchase''s price before it is approved');
select set_config('rr.q1', (select id::text from procurement_quotations where total_amount = 1000), true);
select is(pg_temp.err('a3', $$select select_procurement_quote(current_setting('rr.q1')::uuid)$$),
  '42501 not authorized to select a quote', 'RR-PU-04 a Storekeeper cannot select a quote');

-- ── the supplier of an approved purchase ────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a3', pg_temp.supplier('42')), '42501 PRC_SUPPLIER_FORBIDDEN', 'RR-PU-06 a Storekeeper cannot name the supplier');
select is(pg_temp.err('a4', pg_temp.supplier('42')), '42501 PRC_SUPPLIER_FORBIDDEN', 'RR-PU-06 an Engineer with no job role cannot');
select is(pg_temp.err('a5', pg_temp.supplier('42')), '42501 LIGHT_ACCOUNT', 'RR-PU-06 a field account cannot');
select is(pg_temp.err('a2', pg_temp.supplier('41')), '23514 PRC_SUPPLIER_STEP', 'RR-PU-07 the Buyer names a supplier only on an approved purchase');
select is(pg_temp.err('a2', pg_temp.supplier('43')), '23514 PRC_SUPPLIER_SET', 'RR-PU-07 and never replaces one already named');
select is(pg_temp.err('a2', pg_temp.supplier('42')), 'ok', 'RR-PU-05 the Buyer names the supplier of an approved purchase that has none');
select is((select status::text || '/' || coalesce(vendor_id::text, 'none') || '/' || coalesce(total_value::text, 'null') from procurements where id = '20450000-0000-0000-0000-000000000042'),
  'Approved/20450000-0000-0000-0000-0000000000d1/0.00', 'RR-PU-05 only the supplier changed: still approved, no amount moved');
select is(pg_temp.err('a2', $$select transition_procurement('20450000-0000-0000-0000-000000000044', 'Approved', null)$$) like '42501%', true,
  'RR-PU-07 the Buyer still approves nothing');

-- ── supply risk ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a8', pg_temp.risk()), '42501 Only Admin, Finance or the Procurement Manager can set a supplier''s supply-risk status',
  'RR-PU-09 a Quality Manager at the same access level cannot set supply risk');
select is(pg_temp.err('a6', pg_temp.risk()), '42501 Only Admin, Finance or the Procurement Manager can set a supplier''s supply-risk status',
  'RR-PU-09 a Project Manager with no job role still cannot');
select is(pg_temp.err('a7', pg_temp.risk()), 'ok', 'RR-PU-08 the Procurement Manager sets a vendor''s supply risk');

-- ── an inspection's purchase request ────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('b1', $$select tpi_raise_purchase('20450000-0000-0000-0000-000000000051')$$), '42501 you cannot raise the purchase of an inspection',
  'RR-PU-11 a Safety Officer at the same access level cannot raise it');
select is(pg_temp.err('a4', $$select tpi_raise_purchase('20450000-0000-0000-0000-000000000051')$$), '42501 you cannot raise the purchase of an inspection',
  'RR-PU-11 an Engineer with no job role still cannot');
select is(pg_temp.err('a9', $$select tpi_raise_purchase('20450000-0000-0000-0000-000000000052', '20450000-0000-0000-0000-000000000042')$$),
  '42501 you cannot raise the purchase of an inspection', 'RR-PU-11 the Quality Inspector cannot link an existing purchase');
select is(pg_temp.err('a9', $$select tpi_raise_purchase('20450000-0000-0000-0000-000000000051')$$), 'ok', 'RR-PU-10 the Quality Inspector raises an inspection''s purchase request');
select is((select p.status::text || '/' || (p.requested_by_id = '20450000-0000-0000-0000-0000000000a9')::text
             from third_party_inspections i join procurements p on p.id = i.procurement_id where i.id = '20450000-0000-0000-0000-000000000051'),
  'Draft/true', 'RR-PU-10 the request is a Draft whose requester is the inspector, so its approval chain is unchanged');

select * from finish();
rollback;
