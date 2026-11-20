begin;
create extension if not exists pgtap;
-- #2588 opening balances at go-live (docs/specs/opening-balances.spec.md, AC-OPB-001..009).
select plan(67);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25880000-0000-0000-0000-000000000001', 'OPB Org',   'USD', 'UTC'),
  ('25880000-0000-0000-0000-000000000002', 'OPB Other', 'USD', 'UTC');
insert into auth.users (id, email) values
  ('25880000-0000-0000-0000-0000000000a1', 'opb-admin@example.invalid'),
  ('25880000-0000-0000-0000-0000000000a2', 'opb-fin@example.invalid'),
  ('25880000-0000-0000-0000-0000000000a3', 'opb-pm@example.invalid'),
  ('25880000-0000-0000-0000-0000000000a4', 'opb-eng@example.invalid'),
  ('25880000-0000-0000-0000-0000000000b1', 'opb-xadmin@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25880000-0000-0000-0000-0000000000a1', '25880000-0000-0000-0000-000000000001', 'OPB Admin', 'opb-admin@example.invalid', 'Admin', 'active'),
  ('25880000-0000-0000-0000-0000000000a2', '25880000-0000-0000-0000-000000000001', 'OPB Fin',   'opb-fin@example.invalid',   'Finance', 'active'),
  ('25880000-0000-0000-0000-0000000000a3', '25880000-0000-0000-0000-000000000001', 'OPB PM',    'opb-pm@example.invalid',    'Project Manager', 'active'),
  ('25880000-0000-0000-0000-0000000000a4', '25880000-0000-0000-0000-000000000001', 'OPB Eng',   'opb-eng@example.invalid',   'Engineer', 'active'),
  ('25880000-0000-0000-0000-0000000000b1', '25880000-0000-0000-0000-000000000002', 'OPB XAdm',  'opb-xadmin@example.invalid', 'Admin', 'active');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency, project_manager_id) values
  ('25880000-0000-0000-0000-0000000000c1', '25880000-0000-0000-0000-000000000001', 'OPB Project', 'Ongoing Project', 100000, 'exclusive', 0, 'USD', '25880000-0000-0000-0000-0000000000a3');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25880000-0000-0000-0000-0000000000e1', '25880000-0000-0000-0000-000000000001', '25880000-0000-0000-0000-0000000000c1', 'L1', 'Line one',   'm', 20, 1000),
  ('25880000-0000-0000-0000-0000000000e2', '25880000-0000-0000-0000-000000000001', '25880000-0000-0000-0000-0000000000c1', 'L2', 'Line two',   'm', 20, 500),
  ('25880000-0000-0000-0000-0000000000e3', '25880000-0000-0000-0000-000000000001', '25880000-0000-0000-0000-0000000000c1', 'L3', 'Line three', 'm', 20, 100),
  ('25880000-0000-0000-0000-0000000000e4', '25880000-0000-0000-0000-000000000001', '25880000-0000-0000-0000-0000000000c1', 'L4', 'Line four',  'm', 20, 100);
-- WO A running (opening + later claim), WO B running (opening then reversed), WO C closed, WO D draft, WO E has real activity.
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('25880000-0000-0000-0000-000000000031', '25880000-0000-0000-0000-000000000001', '25880000-0000-0000-0000-0000000000c1', 'OPB WO A', 'Issued', 20000, 'exclusive', 0, 'USD'),
  ('25880000-0000-0000-0000-000000000032', '25880000-0000-0000-0000-000000000001', '25880000-0000-0000-0000-0000000000c1', 'OPB WO B', 'Issued', 10000, 'exclusive', 0, 'USD'),
  ('25880000-0000-0000-0000-000000000033', '25880000-0000-0000-0000-000000000001', '25880000-0000-0000-0000-0000000000c1', 'OPB WO C', 'Closed', 2000,  'exclusive', 0, 'USD'),
  ('25880000-0000-0000-0000-000000000034', '25880000-0000-0000-0000-000000000001', '25880000-0000-0000-0000-0000000000c1', 'OPB WO D', 'Draft',  2000,  'exclusive', 0, 'USD'),
  ('25880000-0000-0000-0000-000000000035', '25880000-0000-0000-0000-000000000001', '25880000-0000-0000-0000-0000000000c1', 'OPB WO E', 'Issued', 2000,  'exclusive', 0, 'USD');
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('25880000-0000-0000-0000-000000000001', '25880000-0000-0000-0000-000000000031', '25880000-0000-0000-0000-0000000000e1', 20),
  ('25880000-0000-0000-0000-000000000001', '25880000-0000-0000-0000-000000000031', '25880000-0000-0000-0000-0000000000e2', 20),
  ('25880000-0000-0000-0000-000000000001', '25880000-0000-0000-0000-000000000032', '25880000-0000-0000-0000-0000000000e3', 20),
  ('25880000-0000-0000-0000-000000000001', '25880000-0000-0000-0000-000000000035', '25880000-0000-0000-0000-0000000000e4', 20);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('25880000-0000-0000-0000-0000000000d1', '25880000-0000-0000-0000-000000000001', 'pc', 'Piece', true);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('25880000-0000-0000-0000-000000001001', '25880000-0000-0000-0000-000000000001', 'BOLT', 'Bolt', '25880000-0000-0000-0000-0000000000d1'),
  ('25880000-0000-0000-0000-000000001002', '25880000-0000-0000-0000-000000000001', 'NUT',  'Nut',  '25880000-0000-0000-0000-0000000000d1');
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('25880000-0000-0000-0000-000000002001', '25880000-0000-0000-0000-000000000001', 'CEN', 'Central', 'central'),
  ('25880000-0000-0000-0000-000000002002', '25880000-0000-0000-0000-000000000001', 'MOV', 'Moved',   'central'),
  ('25880000-0000-0000-0000-000000002003', '25880000-0000-0000-0000-000000000001', 'REV', 'Reverse', 'central');

create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
select set_config('opb.golive', (current_date - 3)::text, true);
select set_config('opb.wo_a_lines', '[{"boq_item_id":"25880000-0000-0000-0000-0000000000e1","certified_quantity":4,"claimed_quantity":3},
  {"boq_item_id":"25880000-0000-0000-0000-0000000000e2","certified_quantity":2,"claimed_quantity":0}]', true);

-- grants ------------------------------------------------------------------------------------------------------------
select is(has_function_privilege('anon', 'public.load_work_order_opening(uuid,date,jsonb,text)', 'EXECUTE'), false, 'AC-OPB-001 anon cannot load a work-order opening');
select is(has_function_privilege('anon', 'public.load_stock_opening(uuid,date,jsonb,text)', 'EXECUTE'), false, 'AC-OPB-001 anon cannot load a stock opening');
select is(has_function_privilege('anon', 'public.reverse_opening_balance(uuid)', 'EXECUTE'), false, 'AC-OPB-001 anon cannot reverse an opening');
select is(has_table_privilege('authenticated', 'public.opening_balances', 'INSERT'), false, 'AC-OPB-001 no client inserts opening rows');
select is(has_table_privilege('authenticated', 'public.opening_balance_lines', 'UPDATE'), false, 'AC-OPB-001 no client edits opening lines');

-- AC-OPB-001 / 002 refusals -----------------------------------------------------------------------------------------
select pg_temp.as_user('25880000-0000-0000-0000-0000000000a2');
select throws_ok($$select public.load_work_order_opening('25880000-0000-0000-0000-000000000031', current_setting('opb.golive')::date, current_setting('opb.wo_a_lines')::jsonb)$$,
  '42501', null, 'AC-OPB-001 Finance cannot load a work-order opening');
select throws_ok($$select public.load_stock_opening('25880000-0000-0000-0000-000000002001', current_setting('opb.golive')::date, '[{"item_id":"25880000-0000-0000-0000-000000001001","counted_quantity":1,"unit_cost":1}]')$$,
  '42501', null, 'AC-OPB-001 Finance cannot load a stock opening');
reset role;
select pg_temp.as_user('25880000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.load_work_order_opening('25880000-0000-0000-0000-000000000033', current_setting('opb.golive')::date, '[]')$$,
  'P0001', 'only a running (issued) work order carries an opening balance; a finished one carries none', 'AC-OPB-002 a closed work order carries no opening');
select throws_ok($$select public.load_work_order_opening('25880000-0000-0000-0000-000000000034', current_setting('opb.golive')::date, '[]')$$,
  'P0001', 'only a running (issued) work order carries an opening balance; a finished one carries none', 'AC-OPB-002 a draft work order carries no opening');
select throws_ok($$select public.load_work_order_opening('25880000-0000-0000-0000-000000000031', current_date + 1, current_setting('opb.wo_a_lines')::jsonb)$$,
  '23514', null, 'FR-OPB-002 a go-live date in the future is refused');
select throws_ok($$select public.load_work_order_opening('25880000-0000-0000-0000-000000000031', current_setting('opb.golive')::date,
  '[{"boq_item_id":"25880000-0000-0000-0000-0000000000e3","certified_quantity":1,"claimed_quantity":0}]')$$,
  '23514', null, 'FR-OPB-003 a line not allocated to the work order is refused');
select throws_ok($$select public.load_work_order_opening('25880000-0000-0000-0000-000000000031', current_setting('opb.golive')::date,
  '[{"boq_item_id":"25880000-0000-0000-0000-0000000000e1","certified_quantity":21,"claimed_quantity":0}]')$$,
  '23514', null, 'FR-OPB-003 a quantity above the allocation is refused');

-- AC-OPB-003 load -----------------------------------------------------------------------------------------------------
select lives_ok($$select set_config('opb.a', public.load_work_order_opening('25880000-0000-0000-0000-000000000031', current_setting('opb.golive')::date,
  current_setting('opb.wo_a_lines')::jsonb, 'source sheet row 12')::text, true)$$, 'AC-OPB-003 an Admin loads a running work order''s progress to date');
select is((select a.status || '/' || a.confirm_basis || '/' || a.acceptance_date::text || '/' || a.is_final::text
             from work_order_acceptances a join opening_balances o on o.acceptance_id = a.id where o.id = current_setting('opb.a')::uuid),
  'Confirmed/opening/' || current_setting('opb.golive') || '/false', 'AC-OPB-003 the certified part is a confirmed opening acceptance at go-live');
select is((select string_agg(l.boq_item_id::text || '=' || trim_scale(l.quantity)::text, ',' order by l.boq_item_id)
             from work_order_acceptance_lines l join opening_balances o on o.acceptance_id = l.acceptance_id where o.id = current_setting('opb.a')::uuid),
  '25880000-0000-0000-0000-0000000000e1=4,25880000-0000-0000-0000-0000000000e2=2', 'AC-OPB-003 the opening acceptance carries the certified quantities');
select is((select claimed_amount from opening_balances where id = current_setting('opb.a')::uuid), 3000.00::numeric, 'AC-OPB-003 the claimed value is the claimed quantity at the line rate');
select is((select count(*)::int from audit_events where action = 'opening_balance.load' and entity_id = current_setting('opb.a')::uuid), 1, 'AC-OPB-003 the load is audited');

-- AC-OPB-004 counts once ---------------------------------------------------------------------------------------------
select is((select invoiced::text || '/' || pending::text || '/' || remaining::text from work_order_billing where work_order_id = '25880000-0000-0000-0000-000000000031'),
  '3000.00/0/17000.00', 'AC-OPB-004 the claimed value counts once as invoiced and reduces what is left to invoice');
select is((select (e->>'claimed_quantity')::numeric from jsonb_array_elements(public.get_project_billing('25880000-0000-0000-0000-0000000000c1')->'boq') e
             where e->>'boq_item_id' = '25880000-0000-0000-0000-0000000000e1'), 3::numeric, 'AC-OPB-004 project billing counts the claimed quantity once');
select is((select trim_scale((a->>'claimed_quantity')::numeric) || '/' || trim_scale((a->>'accepted_quantity')::numeric)
             from jsonb_array_elements(public.get_project_billing('25880000-0000-0000-0000-0000000000c1')->'boq') e, jsonb_array_elements(e->'allocations') a
            where e->>'boq_item_id' = '25880000-0000-0000-0000-0000000000e1'), '3/4', 'AC-OPB-004 the allocation shows claimed 3 and certified 4');
select is((public.get_project_billing('25880000-0000-0000-0000-0000000000c1')->>'work_billed')::numeric, 3000::numeric, 'AC-OPB-004 project work billed includes the opening claim once');
select is((select trim_scale(measured_qty) || '/' || trim_scale(billed_qty) || '/' || trim_scale(billed_amount) from public.billing_reconciliation('25880000-0000-0000-0000-0000000000c1', '25880000-0000-0000-0000-000000000031')
            where boq_item_id = '25880000-0000-0000-0000-0000000000e1'), '3/3/3000', 'AC-OPB-004 billing reconciliation counts the opening claim once');

-- AC-OPB-005 refusals after or beside an opening -------------------------------------------------------------------
select throws_ok($$select public.load_work_order_opening('25880000-0000-0000-0000-000000000031', current_setting('opb.golive')::date, current_setting('opb.wo_a_lines')::jsonb)$$,
  'P0001', null, 'AC-OPB-005 a second opening on one work order is refused');
select throws_ok($$select public.load_work_order_opening('25880000-0000-0000-0000-000000000032', current_date - 4,
  '[{"boq_item_id":"25880000-0000-0000-0000-0000000000e3","certified_quantity":1,"claimed_quantity":1}]')$$,
  '23514', null, 'AC-OPB-005 an opening at another go-live date is refused');
reset role;
select pg_temp.as_user('25880000-0000-0000-0000-0000000000a2');
select lives_ok($$select public.create_progress_claim('25880000-0000-0000-0000-0000000000c1', 'progress', p_work_order_id => '25880000-0000-0000-0000-000000000035',
  p_lines => '[{"boq_item_id":"25880000-0000-0000-0000-0000000000e4","quantity":1}]'::jsonb)$$, 'fixture: a real claim on work order E');
reset role;
select pg_temp.as_user('25880000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.load_work_order_opening('25880000-0000-0000-0000-000000000035', current_setting('opb.golive')::date,
  '[{"boq_item_id":"25880000-0000-0000-0000-0000000000e4","certified_quantity":1,"claimed_quantity":0}]')$$,
  'P0001', 'an opening balance is loaded before the work order''s first real transaction', 'AC-OPB-005 a work order with real activity takes no opening');

-- AC-OPB-007 reversal before activity (WO B) -------------------------------------------------------------------------
select lives_ok($$select set_config('opb.b', public.load_work_order_opening('25880000-0000-0000-0000-000000000032', current_setting('opb.golive')::date,
  '[{"boq_item_id":"25880000-0000-0000-0000-0000000000e3","certified_quantity":5,"claimed_quantity":5}]')::text, true)$$, 'fixture: an opening on work order B');
reset role;
select pg_temp.as_user('25880000-0000-0000-0000-0000000000a2');
select throws_ok($$select public.reverse_opening_balance(current_setting('opb.b')::uuid)$$, '42501', null, 'AC-OPB-001 Finance cannot reverse an opening');
reset role;
select pg_temp.as_user('25880000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.reverse_opening_balance(current_setting('opb.b')::uuid)$$, 'AC-OPB-007 an Admin reverses an opening with nothing since');
select is((select count(*)::int from work_order_acceptances where work_order_id = '25880000-0000-0000-0000-000000000032'), 0, 'AC-OPB-007 the opening acceptance is gone');
select is((select invoiced::text || '/' || remaining::text from work_order_billing where work_order_id = '25880000-0000-0000-0000-000000000032'), '0/10000.00', 'AC-OPB-007 the reversed claim no longer counts');
select ok((select reversed_at is not null and reversed_by = '25880000-0000-0000-0000-0000000000a1' from opening_balances where id = current_setting('opb.b')::uuid), 'AC-OPB-007 the opening row records who reversed it');
select is((select count(*)::int from audit_events where action = 'opening_balance.reverse' and entity_id = current_setting('opb.b')::uuid), 1, 'AC-OPB-007 the reversal is audited');
select throws_ok($$select public.reverse_opening_balance(current_setting('opb.b')::uuid)$$, 'P0001', null, 'AC-OPB-007 a reversed opening cannot be reversed again');

-- AC-OPB-004 / 007 after the first real transaction on WO A ----------------------------------------------------------
reset role;
select pg_temp.as_user('25880000-0000-0000-0000-0000000000a2');
select throws_ok($$select public.create_progress_claim('25880000-0000-0000-0000-0000000000c1', 'progress', p_work_order_id => '25880000-0000-0000-0000-000000000031',
  p_lines => '[{"boq_item_id":"25880000-0000-0000-0000-0000000000e1","quantity":18}]'::jsonb)$$, 'BW001', null, 'AC-OPB-004 a claim that would bill the opening twice is refused');
select lives_ok($$select public.create_progress_claim('25880000-0000-0000-0000-0000000000c1', 'progress', p_work_order_id => '25880000-0000-0000-0000-000000000031',
  p_lines => '[{"boq_item_id":"25880000-0000-0000-0000-0000000000e1","quantity":17}]'::jsonb)$$, 'AC-OPB-004 a claim up to what is left is accepted');
select is((select measured_qty from public.billing_reconciliation('25880000-0000-0000-0000-0000000000c1', '25880000-0000-0000-0000-000000000031')
            where boq_item_id = '25880000-0000-0000-0000-0000000000e1'), 20::numeric, 'AC-OPB-004 opening and later claim add up once');
reset role;
select pg_temp.as_user('25880000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.reverse_opening_balance(current_setting('opb.a')::uuid)$$,
  'P0001', 'an opening balance can be reversed only before the first real transaction', 'AC-OPB-007 an opening with a real claim since cannot be reversed');

-- AC-OPB-006 stock -----------------------------------------------------------------------------------------------------
select throws_ok($$select public.load_stock_opening('25880000-0000-0000-0000-000000002001', current_setting('opb.golive')::date,
  '[{"item_id":"25880000-0000-0000-0000-000000001001","counted_quantity":10}]')$$, 'P0001', null, 'AC-OPB-006 a counted quantity without a unit cost is refused');
select throws_ok($$select public.load_stock_opening('25880000-0000-0000-0000-000000002001', current_setting('opb.golive')::date,
  '[{"item_id":"25880000-0000-0000-0000-000000001001","counted_quantity":10,"unit_cost":5},{"item_id":"25880000-0000-0000-0000-000000001001","counted_quantity":1,"unit_cost":5}]')$$,
  'P0001', null, 'AC-OPB-006 an item appears once per location');
select lives_ok($$select set_config('opb.s', public.load_stock_opening('25880000-0000-0000-0000-000000002001', current_setting('opb.golive')::date,
  '[{"item_id":"25880000-0000-0000-0000-000000001001","counted_quantity":10,"unit_cost":5},{"item_id":"25880000-0000-0000-0000-000000001002","counted_quantity":0}]')::text, true)$$,
  'AC-OPB-006 an Admin loads a location''s counted stock');
reset role;
select is((select qty_on_hand::text || '/' || value_on_hand::text from stock_balances where warehouse_id = '25880000-0000-0000-0000-000000002001' and item_id = '25880000-0000-0000-0000-000000001001'),
  '10.000/50.00', 'AC-OPB-006 on hand equals the count once');
select is((select coalesce(sum(qty_on_hand), 0) from stock_balances where warehouse_id = '25880000-0000-0000-0000-000000002001'), 10.000::numeric, 'AC-OPB-006 a zero count adds nothing');
select is((select string_agg(distinct l.kind || '@' || l.occurred_on::text, ',') from stock_ledger l join opening_balances o on o.stock_document_id = l.document_id where o.id = current_setting('opb.s')::uuid),
  'opening@' || current_setting('opb.golive'), 'AC-OPB-006 ledger rows are marked opening and dated at go-live');
select is((select d.kind || '/' || d.status from stock_documents d join opening_balances o on o.stock_document_id = d.id where o.id = current_setting('opb.s')::uuid),
  'opening/Posted', 'AC-OPB-006 the stock document is a posted opening');
select pg_temp.as_user('25880000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.load_stock_opening('25880000-0000-0000-0000-000000002001', current_setting('opb.golive')::date,
  '[{"item_id":"25880000-0000-0000-0000-000000001002","counted_quantity":1,"unit_cost":1}]')$$, 'P0001', null, 'AC-OPB-006 a second opening for one location is refused');
select lives_ok($$select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','25880000-0000-0000-0000-000000002002'),
  '[{"item_id":"25880000-0000-0000-0000-000000001001","quantity":1,"unit_cost":1}]'::jsonb, true)$$, 'fixture: a real receipt at location MOV');
select throws_ok($$select public.load_stock_opening('25880000-0000-0000-0000-000000002002', current_setting('opb.golive')::date,
  '[{"item_id":"25880000-0000-0000-0000-000000001001","counted_quantity":3,"unit_cost":1}]')$$,
  'P0001', 'an opening balance is loaded before the location''s first stock movement', 'AC-OPB-006 a location with a movement takes no opening');

-- AC-OPB-007 stock reversal ------------------------------------------------------------------------------------------
select lives_ok($$select set_config('opb.r', public.load_stock_opening('25880000-0000-0000-0000-000000002003', current_setting('opb.golive')::date,
  '[{"item_id":"25880000-0000-0000-0000-000000001002","counted_quantity":7,"unit_cost":3}]')::text, true)$$, 'fixture: an opening at location REV');
select lives_ok($$select public.reverse_opening_balance(current_setting('opb.r')::uuid)$$, 'AC-OPB-007 an Admin reverses a stock opening with no movement since');
reset role;
select is((select qty_on_hand::text || '/' || value_on_hand::text from stock_balances where warehouse_id = '25880000-0000-0000-0000-000000002003'), '0.000/0.00', 'AC-OPB-007 the reversal returns the balance to zero');
select is((select count(*)::int from stock_ledger l join opening_balances o on o.stock_document_id = l.document_id where o.id = current_setting('opb.r')::uuid and l.kind = 'opening_reversal'), 1,
  'AC-OPB-007 the reversal is ledger rows marked opening_reversal');
select pg_temp.as_user('25880000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id','25880000-0000-0000-0000-000000002001','to_warehouse_id','25880000-0000-0000-0000-000000002003'),
  '[{"item_id":"25880000-0000-0000-0000-000000001001","quantity":1}]'::jsonb, true)$$, 'fixture: a real transfer out of location CEN');
select throws_ok($$select public.reverse_opening_balance(current_setting('opb.s')::uuid)$$,
  'P0001', 'an opening balance can be reversed only before the first real transaction', 'AC-OPB-007 a stock opening with a movement since cannot be reversed');

-- AC-OPB-009 report ----------------------------------------------------------------------------------------------------
select is((select certified_value::text || '/' || claimed_value::text from public.opening_balance_report() where id = current_setting('opb.a')::uuid),
  '5000.00/3000.00', 'AC-OPB-009 the report gives certified and claimed value per work order');
select is((select stock_quantity::text || '/' || stock_value::text from public.opening_balance_report() where id = current_setting('opb.s')::uuid),
  '10.000/50.00', 'AC-OPB-009 the report gives counted quantity and value per location');
select is((select count(*)::int from public.opening_balance_report()), 2, 'AC-OPB-009 the report lists only live openings');
reset role;
select pg_temp.as_user('25880000-0000-0000-0000-0000000000a2');
select throws_ok($$select * from public.opening_balance_report()$$, '42501', null, 'AC-OPB-009 the report is for an Admin');
reset role;

-- AC-OPB-008 tenancy and reads -----------------------------------------------------------------------------------------
select pg_temp.as_user('25880000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.load_work_order_opening('25880000-0000-0000-0000-000000000032', current_setting('opb.golive')::date,
  '[{"boq_item_id":"25880000-0000-0000-0000-0000000000e3","certified_quantity":1,"claimed_quantity":0}]')$$, 'P0002', null, 'AC-OPB-008 another organisation''s Admin cannot load onto this work order');
select is((select count(*)::int from opening_balances), 0, 'AC-OPB-008 another organisation reads none of these openings');
reset role;
select pg_temp.as_user('25880000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from opening_balances), 0, 'AC-OPB-008 an Engineer reads no opening money');
reset role;

-- 1047: the CLI's active-Admin rpc tier admits the four opening RPCs (POST only, Admin only) -------------------------
create function pg_temp.req(p_sub text, p_method text, p_path text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'client_id', 'pmo-cli')::text, true),
         set_config('request.method', p_method, true), set_config('request.path', p_path, true), set_config('request.headers', '{}', true) $$;
set local role authenticated;
select pg_temp.req('25880000-0000-0000-0000-0000000000a1', 'POST', '/rpc/load_work_order_opening');
select lives_ok('select public.api_client_request_guard()', 'AC-OPB-001 the CLI admits an active Admin to load_work_order_opening');
select pg_temp.req('25880000-0000-0000-0000-0000000000a1', 'POST', '/rpc/load_stock_opening');
select lives_ok('select public.api_client_request_guard()', 'AC-OPB-001 the CLI admits an active Admin to load_stock_opening');
select pg_temp.req('25880000-0000-0000-0000-0000000000a1', 'POST', '/rpc/reverse_opening_balance');
select lives_ok('select public.api_client_request_guard()', 'AC-OPB-001 the CLI admits an active Admin to reverse_opening_balance');
select pg_temp.req('25880000-0000-0000-0000-0000000000a1', 'POST', '/rpc/opening_balance_report');
select lives_ok('select public.api_client_request_guard()', 'AC-OPB-009 the CLI admits an active Admin to opening_balance_report');
select pg_temp.req('25880000-0000-0000-0000-0000000000a2', 'POST', '/rpc/load_work_order_opening');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-OPB-001 the CLI refuses Finance');
select pg_temp.req('25880000-0000-0000-0000-0000000000a1', 'GET', '/rpc/load_work_order_opening');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-OPB-001 the CLI refuses GET');
reset role;

select * from finish();
rollback;
