-- 0250_progress_billing_claims.test.sql — #766 AC-PB-002 (recovery arithmetic) + AC-PB-004 (claim guards).
-- Migration under test: 0250_progress_billing.sql. Every denial asserts errcode AND message.
begin;
create extension if not exists pgtap;
select plan(40);

insert into organizations (id, name) values
  ('07660000-0000-0000-0000-000000000001', 'PB Org'),
  ('07660000-0000-0000-0000-000000000002', 'PB Other Org');
update organizations set down_payment_item = 'DP-ITEM' where id = '07660000-0000-0000-0000-000000000001';
insert into auth.users (id, email) values
  ('07660000-0000-0000-0000-0000000000a2', 'pb-fin@example.com'),
  ('07660000-0000-0000-0000-0000000000a4', 'pb-pm@example.com'),
  ('07660000-0000-0000-0000-0000000000a5', 'pb-eng@example.com'),
  ('07660000-0000-0000-0000-0000000000a6', 'pb-off@example.com'),
  ('07660000-0000-0000-0000-0000000000b1', 'pb-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07660000-0000-0000-0000-0000000000a2', '07660000-0000-0000-0000-000000000001', 'PB Fin', 'pb-fin@example.com', 'Finance', 'active'),
  ('07660000-0000-0000-0000-0000000000a4', '07660000-0000-0000-0000-000000000001', 'PB PM', 'pb-pm@example.com', 'Project Manager', 'active'),
  ('07660000-0000-0000-0000-0000000000a5', '07660000-0000-0000-0000-000000000001', 'PB Eng', 'pb-eng@example.com', 'Engineer', 'active'),
  ('07660000-0000-0000-0000-0000000000a6', '07660000-0000-0000-0000-000000000001', 'PB Off', 'pb-off@example.com', 'Finance', 'disabled'),
  ('07660000-0000-0000-0000-0000000000b1', '07660000-0000-0000-0000-000000000002', 'PB XOrg', 'pb-xorg@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('07660000-0000-0000-0000-0000000000f1', '07660000-0000-0000-0000-000000000001', 'PB Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-000000000001', 'PB Project', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1'),
  ('07660000-0000-0000-0000-0000000000c2', '07660000-0000-0000-0000-000000000001', 'PB Project Two', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1'),
  ('07660000-0000-0000-0000-0000000000c3', '07660000-0000-0000-0000-000000000001', 'PB Project Three', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('07660000-0000-0000-0000-0000000000d1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'PB WO issued', 'Issued', 500000, 'exclusive', 0),
  ('07660000-0000-0000-0000-0000000000d2', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'PB WO draft', 'Draft', 500000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, work_order_id, item_code, description, unit, quantity, rate) values
  ('07660000-0000-0000-0000-0000000000e1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', null, 'SURVEY', 'Route survey', 'km', 10, 50000),
  ('07660000-0000-0000-0000-0000000000e2', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-0000000000d1', 'STATION', 'Station build', 'unit', 5, 100000),
  ('07660000-0000-0000-0000-0000000000e3', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c2', null, 'CABLE', 'Cable pull', 'km', 10, 50000),
  ('07660000-0000-0000-0000-0000000000e4', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c3', null, 'POLE', 'Pole set', 'unit', 10, 10000);

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ do $d$ begin perform set_config('pb.dp', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'down_payment', p_down_payment_amount => 200000, p_recovery_pct => 20)::text, true); end $d$ $$,
  'AC-PB-002 Finance bills a 200,000 down payment recovered at 20% per claim');                                  -- 1
select is((select kind || '/' || gross_amount || '/' || recovery_pct || '/' || dp_item_code || '/' || currency || '/' || created_by
             from progress_claims where id = current_setting('pb.dp')::uuid),
  'down_payment/200000.00/20.000/DP-ITEM/USD/07660000-0000-0000-0000-0000000000a2',
  'AC-PB-002 the down payment claim stores its amount, percentage, the org item, the project currency and its creator'); -- 2
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 10) $$,
  'P0001', 'this project already has a down payment — withdraw it or cancel its invoice before billing another',
  'AC-PB-004 a second live down payment is refused');                                                            -- 3
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb) $$,
  'P0001', 'the down payment invoice has not been submitted yet: submit it (or withdraw the down payment) before claiming progress',
  'AC-PB-004 progress cannot be billed before the down payment invoice is submitted');                           -- 4
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('pb.dp')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', '2026-10-01', 200000, 'inclusive', 0, 'USD', 'Unpaid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ do $d$ begin perform set_config('pb.pc1', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":4}]'::jsonb)::text, true); end $d$ $$,
  'AC-PB-002 Finance bills 4 km');                                                                              -- 5
select is((select gross_amount || '/' || dp_recovery_amount || '/' || dp_item_code from progress_claims where id = current_setting('pb.pc1')::uuid),
  '200000.00/40000.00/DP-ITEM', 'AC-PB-002 4 km at 50,000 bills 200,000 and recovers 20% = 40,000 on the DP item'); -- 6
select is((select item_code || '/' || description || '/' || unit || '/' || quantity || '/' || rate || '/' || amount
             from progress_claim_lines where claim_id = current_setting('pb.pc1')::uuid),
  'SURVEY/Route survey/km/4.000/50000.00/200000.00', 'AC-PB-002 the claim line copies the BoQ line at that moment'); -- 7
select lives_ok($$ do $d$ begin perform set_config('pb.pc2', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":6}]'::jsonb)::text, true); end $d$ $$,
  'AC-PB-002 Finance bills 6 km');                                                                              -- 8
select is((select dp_recovery_amount::text from progress_claims where id = current_setting('pb.pc2')::uuid), '60000.00',
  'AC-PB-002 300,000 recovers 60,000');                                                                          -- 9
select lives_ok($$ do $d$ begin perform set_config('pb.pc3', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":12}]'::jsonb)::text, true); end $d$ $$,
  'AC-PB-002 billing past the BoQ quantity (22 of 10 km) is accepted');                                          -- 10
select is((select dp_recovery_amount::text from progress_claims where id = current_setting('pb.pc3')::uuid), '100000.00',
  'AC-PB-002 600,000 would recover 120,000 but only 100,000 of the down payment remains');                       -- 11
select lives_ok($$ do $d$ begin perform set_config('pb.pc4', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb)::text, true); end $d$ $$,
  'AC-PB-002 Finance bills 1 km after the down payment is fully recovered');                                    -- 12
select is((select dp_recovery_amount || '/' || coalesce(dp_item_code, '') from progress_claims where id = current_setting('pb.pc4')::uuid),
  '0.00/', 'AC-PB-002 nothing is left to recover, so no recovery line is due');                                  -- 13
select lives_ok($$ do $d$ begin perform set_config('pb.dp2', public.create_progress_claim('07660000-0000-0000-0000-0000000000c2', 'down_payment', p_down_payment_amount => 100000, p_recovery_pct => 10)::text, true); end $d$ $$,
  'AC-PB-002 Finance bills a 100,000 down payment on the second project');                                     -- 14
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('pb.dp2')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c2',
        '07660000-0000-0000-0000-0000000000f1', '2026-10-01', 100000, 'inclusive', 0, 'USD', 'Paid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ do $d$ begin perform set_config('pb.c2a', public.create_progress_claim('07660000-0000-0000-0000-0000000000c2', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e3","quantity":1}]'::jsonb, p_recover_remaining => true)::text, true); end $d$ $$,
  'AC-PB-002 a claim may recover the rest of the down payment');                                                -- 15
select is((select dp_recovery_amount::text from progress_claims where id = current_setting('pb.c2a')::uuid), '50000.00',
  'AC-PB-002 recovering the rest is capped at the claim''s own gross (50,000 of 100,000)');                      -- 16
select lives_ok($$ do $d$ begin perform set_config('pb.c2b', public.create_progress_claim('07660000-0000-0000-0000-0000000000c2', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e3","quantity":2}]'::jsonb, p_recover_remaining => true)::text, true); end $d$ $$,
  'AC-PB-002 a second claim recovers the rest');                                                                -- 17
select is((select dp_recovery_amount::text from progress_claims where id = current_setting('pb.c2b')::uuid), '50000.00',
  'AC-PB-002 the rest is the 50,000 still unrecovered');                                                         -- 18
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e4","quantity":1}]'::jsonb, p_recover_remaining => true) $$,
  'P0001', 'there is no down payment to recover on this project', 'AC-PB-002 recovering the rest needs a down payment'); -- 19
select lives_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_work_order_id => '07660000-0000-0000-0000-0000000000d1', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e2","quantity":1}]'::jsonb) $$,
  'AC-PB-004 a claim scoped to an issued work order bills that work order''s lines');                            -- 20
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_work_order_id => '07660000-0000-0000-0000-0000000000d1', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb) $$,
  '23514', 'every line must be a bill of quantities line of this project and of the claim''s work order (or of no work order when the claim names none)',
  'AC-PB-004 a work-order claim cannot bill a contract-level line');                                           -- 21
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e3","quantity":1}]'::jsonb) $$,
  '23514', 'every line must be a bill of quantities line of this project and of the claim''s work order (or of no work order when the claim names none)',
  'AC-PB-004 a claim cannot bill another project''s line');                                                     -- 22
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_work_order_id => '07660000-0000-0000-0000-0000000000d2', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb) $$,
  'P0001', 'only an issued or closed work order can be billed — this one is Draft', 'AC-PB-004 a Draft work order cannot be billed'); -- 23
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1.2345}]'::jsonb) $$,
  '23514', 'each quantity must be a positive number with at most 3 decimals', 'AC-PB-004 a quantity has at most 3 decimals'); -- 24
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1},{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":2}]'::jsonb) $$,
  '23514', 'each bill of quantities line may appear once per claim', 'AC-PB-004 a line appears once per claim'); -- 25
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[]'::jsonb) $$,
  'P0001', 'a progress claim needs at least one quantity line', 'AC-PB-004 an empty claim is refused');         -- 26
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress',
    p_lines => (select jsonb_agg(jsonb_build_object('boq_item_id', '07660000-0000-0000-0000-0000000000e1', 'quantity', 1)) from generate_series(1, 501))) $$,
  '22023', 'a progress claim may have at most 500 lines', 'AC-PB-004 a claim has at most 500 lines');           -- 27
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'down_payment', p_down_payment_amount => -1, p_recovery_pct => 10) $$,
  '23514', 'the down payment amount must be a positive number with at most 2 decimals', 'AC-PB-004 a negative down payment is refused'); -- 28
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 0) $$,
  '23514', 'the recovery percentage must be above 0 and at most 100, with at most 3 decimals', 'AC-PB-004 a 0% recovery is refused'); -- 29
reset role;
update organizations set down_payment_item = null where id = '07660000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 10) $$,
  'P0001', 'set the down payment item in Administration → Accounting before billing a down payment',
  'AC-PB-004 a down payment needs the org''s down payment item');                                              -- 30
reset role;
update organizations set down_payment_item = 'DP-ITEM' where id = '07660000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 10) $$,
  '42501', 'only Admin or Finance may create a progress claim', 'AC-PB-004 a PM cannot create a billing claim'); -- 31
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 10) $$,
  '42501', 'only Admin or Finance may create a progress claim', 'AC-PB-004 an Engineer cannot create a claim'); -- 32
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 10) $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-PB-004 an offboarded Finance user cannot create a claim');                                               -- 33
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 10) $$,
  'P0002', 'project not found', 'AC-PB-004 another org cannot bill this org''s project');                         -- 34
reset role;
select is((select count(*)::int from information_schema.table_privileges
            where table_schema = 'public' and table_name in ('progress_claims', 'progress_claim_lines')
              and grantee in ('authenticated', 'anon') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0,
  'AC-PB-004 no client role may write the claim tables directly');                                              -- 35
select throws_ok($$ update progress_claims set gross_amount = 1 where id = current_setting('pb.pc1')::uuid $$,
  '42501', 'a progress claim cannot be edited: its invoice is built from it — withdraw it (if not yet raised) or cancel its invoice, then create a new claim',
  'AC-PB-004 a claim''s figures cannot change, even for the table owner');                                     -- 36
select throws_ok($$ update progress_claim_lines set quantity = 1 where claim_id = current_setting('pb.pc1')::uuid $$,
  '42501', 'progress claim lines cannot be changed', 'AC-PB-004 a claim''s lines cannot change');                -- 37
update boq_items set rate = 60000 where id = '07660000-0000-0000-0000-0000000000e1';
select is((select rate::text from progress_claim_lines where claim_id = current_setting('pb.pc1')::uuid), '50000.00',
  'AC-PB-004 re-pricing the BoQ line does not change a claim already made');                                   -- 38
select is((select count(*)::int from audit_events where action = 'progress_claim.create'
            and entity_id = current_setting('pb.pc1')::uuid and (detail ->> 'dp_recovery_amount')::numeric = 40000), 1,
  'AC-PB-004 each claim creation is audited with its recovery');                                                -- 39
select is(has_function_privilege('anon', 'public.create_progress_claim(uuid,text,uuid,jsonb,numeric,numeric,boolean)', 'EXECUTE'), false,
  'AC-PB-004 anon cannot create claims');                                                                       -- 40

select * from finish();
rollback;
