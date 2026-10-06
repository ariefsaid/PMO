-- 0250_progress_billing_withdraw.test.sql — #766 AC-PB-005 (withdraw + outbox fence) + AC-PB-012 (author set).
-- Claims that get an outbox row are given evidence first (the fence requires it, AC-PB-018).
begin;
create extension if not exists pgtap;
select plan(21);

insert into organizations (id, name) values
  ('07660000-0000-0000-0000-000000000001', 'PB Org'),
  ('07660000-0000-0000-0000-000000000002', 'PB Other Org');
update organizations set down_payment_item = 'DP-ITEM' where id = '07660000-0000-0000-0000-000000000001';
insert into auth.users (id, email) values
  ('07660000-0000-0000-0000-0000000000a2', 'pb-fin@example.com'),
  ('07660000-0000-0000-0000-0000000000a4', 'pb-pm@example.com'),
  ('07660000-0000-0000-0000-0000000000b1', 'pb-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07660000-0000-0000-0000-0000000000a2', '07660000-0000-0000-0000-000000000001', 'PB Fin', 'pb-fin@example.com', 'Finance', 'active'),
  ('07660000-0000-0000-0000-0000000000a4', '07660000-0000-0000-0000-000000000001', 'PB PM', 'pb-pm@example.com', 'Project Manager', 'active'),
  ('07660000-0000-0000-0000-0000000000b1', '07660000-0000-0000-0000-000000000002', 'PB XOrg', 'pb-xorg@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('07660000-0000-0000-0000-0000000000f1', '07660000-0000-0000-0000-000000000001', 'PB Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-000000000001', 'PB Project', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('07660000-0000-0000-0000-0000000000e1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'SURVEY', 'Route survey', 'km', 10, 50000);
insert into project_documents (id, org_id, project_id, category, title, status, revision, file_path) values
  ('07660000-0000-0000-0000-00000000d0c1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'Report', 'Progress report', 'Issued', 'A', 'docs/pb/report.pdf');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('pb.dp', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'down_payment', p_down_payment_amount => 200000, p_recovery_pct => 20)::text, true); end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('pb.dp')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', '2026-10-01', 200000, 'inclusive', 0, 'USD', 'Unpaid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ do $d$ begin perform set_config('pb.a', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":10}]'::jsonb, p_recover_remaining => true)::text, true); end $d$ $$,
  'AC-PB-005 an unraised claim recovers the whole down payment');                                              -- 1
select lives_ok($$ select public.withdraw_progress_claim(current_setting('pb.a')::uuid) $$,
  'AC-PB-005 Finance withdraws the unraised claim');                                                            -- 2
select is((select (withdrawn_at is not null)::text || '/' || withdrawn_by from progress_claims where id = current_setting('pb.a')::uuid),
  'true/07660000-0000-0000-0000-0000000000a2', 'AC-PB-005 the withdrawal is stamped with who and when');           -- 3
select lives_ok($$ do $d$ begin perform set_config('pb.b', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":4}]'::jsonb)::text, true); end $d$ $$,
  'AC-PB-005 a new claim after the withdrawal');                                                                -- 4
select is((select dp_recovery_amount::text from progress_claims where id = current_setting('pb.b')::uuid), '40000.00',
  'AC-PB-005 the withdrawn claim no longer consumes the down payment');                                         -- 5
select throws_ok($$ select public.withdraw_progress_claim(current_setting('pb.a')::uuid) $$,
  'P0001', 'this progress claim is already withdrawn', 'AC-PB-005 a claim is withdrawn once');                  -- 6
do $$ begin perform public.attach_claim_evidence(current_setting('pb.b')::uuid, '07660000-0000-0000-0000-00000000d0c1'); end $$;
reset role;
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
values ('07660000-0000-0000-0000-000000000001', 'revenue', current_setting('pb.b'), 'pb-key-b', 'erpnext', 'create', 'pending');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.withdraw_progress_claim(current_setting('pb.b')::uuid) $$,
  'P0001', 'an invoice for this claim is being raised in the ERP — wait for it to finish, then cancel the invoice if it is wrong',
  'AC-PB-005 a claim with a live ERP attempt cannot be withdrawn');                                             -- 7
reset role;
update external_command_outbox set state = 'failed' where pmo_record_id = current_setting('pb.b');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select public.withdraw_progress_claim(current_setting('pb.b')::uuid) $$,
  'AC-PB-005 a claim whose only attempt failed (nothing minted) can be withdrawn');                              -- 8
select lives_ok($$ do $d$ begin perform set_config('pb.c', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb)::text, true); end $d$ $$,
  'AC-PB-005 another claim');                                                                                   -- 9
do $$ begin perform public.attach_claim_evidence(current_setting('pb.c')::uuid, '07660000-0000-0000-0000-00000000d0c1'); end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('pb.c')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', 40000, 'inclusive', 0, 'USD', 'Draft');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.withdraw_progress_claim(current_setting('pb.c')::uuid) $$,
  'P0001', 'this claim already has an invoice — cancel the invoice instead', 'AC-PB-005 a raised claim cannot be withdrawn'); -- 10
reset role;
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('07660000-0000-0000-0000-000000000001', 'revenue', current_setting('pb.a'), 'pb-key-a', 'erpnext', 'create', 'pending') $$,
  '55000', 'this progress claim was withdrawn, so no invoice can be raised for it',
  'AC-PB-005 the database refuses any attempt to raise a withdrawn claim');                                     -- 11
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('07660000-0000-0000-0000-000000000001', 'revenue', current_setting('pb.c'), 'pb-key-c', 'erpnext', 'create', 'pending') $$,
  'AC-PB-005 CONTROL the fence refuses only withdrawn claims and claims without evidence');                      -- 12
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('07660000-0000-0000-0000-000000000001', 'revenue', '07660000-0000-0000-0000-00000000aa01', 'pb-key-x', 'erpnext', 'create', 'pending') $$,
  'AC-PB-005 CONTROL an invoice that is not a claim is untouched by the fence');                                -- 13
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.withdraw_progress_claim(current_setting('pb.c')::uuid) $$,
  '42501', 'only Admin or Finance may withdraw a progress claim', 'AC-PB-005 a PM cannot withdraw a claim');     -- 14
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select public.withdraw_progress_claim(current_setting('pb.c')::uuid) $$,
  'P0002', 'progress claim not found', 'AC-PB-005 another org cannot withdraw this org''s claim');               -- 15
reset role;
select is((select count(*)::int from audit_events where action = 'progress_claim.withdraw'
            and entity_id = current_setting('pb.a')::uuid), 1, 'AC-PB-005 the withdrawal is audited');          -- 16
select is((select count(*)::int from sales_invoice_authors where sales_invoice_id = current_setting('pb.c')::uuid
            and user_id = '07660000-0000-0000-0000-0000000000a2'), 1,
  'AC-PB-012 the claim''s creator joins its invoice''s author set, so they cannot submit it');                   -- 17
insert into sales_invoices (id, org_id, project_id, customer_id, amount, tax_treatment, tax_amount, currency, status)
values ('07660000-0000-0000-0000-00000000aa02', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', 1000, 'inclusive', 0, 'USD', 'Draft');
select is((select count(*)::int from sales_invoice_authors where sales_invoice_id = '07660000-0000-0000-0000-00000000aa02'), 0,
  'AC-PB-012 CONTROL an invoice that is not a claim gets no author from this rule');                             -- 18

-- DD-PBL-7: ids travel as TEXT through the outbox, so an upper-cased claim id must still block the withdrawal.
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ do $d$ begin perform set_config('pb.d', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb)::text, true); end $d$ $$,
  'AC-PB-007 a claim to raise under a case-variant id');                                                        -- 19
do $$ begin perform public.attach_claim_evidence(current_setting('pb.d')::uuid, '07660000-0000-0000-0000-00000000d0c1'); end $$;
reset role;
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
values ('07660000-0000-0000-0000-000000000001', 'revenue', upper(current_setting('pb.d')), 'pb-key-d', 'erpnext', 'create', 'pending');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.withdraw_progress_claim(current_setting('pb.d')::uuid) $$,
  'P0001', 'an invoice for this claim is being raised in the ERP — wait for it to finish, then cancel the invoice if it is wrong',
  'AC-PB-007 an in-flight attempt under an upper-cased claim id still blocks the withdrawal');                 -- 20
reset role;
-- The outbox fence fails CLOSED: this org's claim id under another org is refused, not waved through.
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('07660000-0000-0000-0000-000000000002', 'revenue', current_setting('pb.c'), 'pb-key-xorg', 'erpnext', 'create', 'pending') $$,
  '42501', 'this progress claim belongs to another organisation',
  'AC-PB-005 the fence refuses a claim id raised under another org');                                         -- 21

select * from finish();
rollback;
