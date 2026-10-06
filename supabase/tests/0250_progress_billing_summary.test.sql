-- 0250_progress_billing_summary.test.sql — #766 AC-PB-007 (get_project_billing + the shared billed-work view).
begin;
create extension if not exists pgtap;
select plan(12);

insert into organizations (id, name) values
  ('07660000-0000-0000-0000-000000000001', 'PB Org'),
  ('07660000-0000-0000-0000-000000000002', 'PB Other Org');
update organizations set down_payment_item = 'DP-ITEM' where id = '07660000-0000-0000-0000-000000000001';
insert into auth.users (id, email) values
  ('07660000-0000-0000-0000-0000000000a2', 'pb-fin@example.com'),
  ('07660000-0000-0000-0000-0000000000b1', 'pb-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07660000-0000-0000-0000-0000000000a2', '07660000-0000-0000-0000-000000000001', 'PB Fin', 'pb-fin@example.com', 'Finance', 'active'),
  ('07660000-0000-0000-0000-0000000000b1', '07660000-0000-0000-0000-000000000002', 'PB XOrg', 'pb-xorg@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('07660000-0000-0000-0000-0000000000f1', '07660000-0000-0000-0000-000000000001', 'PB Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-000000000001', 'PB Project', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1'),
  ('07660000-0000-0000-0000-0000000000c2', '07660000-0000-0000-0000-000000000001', 'PB Inclusive', 'Ongoing Project', 1110000, 'inclusive', 110000, '07660000-0000-0000-0000-0000000000f1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('07660000-0000-0000-0000-0000000000e1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'SURVEY', 'Route survey', 'km', 10, 50000);
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values ('07660000-0000-0000-0000-00000000aa05', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', '2026-08-01', 55500, 'inclusive', 5500, 'USD', 'Paid');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('pb.dp', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'down_payment', p_down_payment_amount => 200000, p_recovery_pct => 20)::text, true); end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('pb.dp')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', '2026-09-01', 222000, 'inclusive', 22000, 'USD', 'Paid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('pb.pc1', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":4}]'::jsonb)::text, true); end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('pb.pc1')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', '2026-10-01', 177600, 'inclusive', 17600, 'USD', 'Unpaid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('pb.pc2', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":2}]'::jsonb)::text, true); end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('pb.pc2')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', '2026-10-02', 88800, 'inclusive', 8800, 'USD', 'Cancelled');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('pb.pc3', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb)::text, true); end $$;
do $$ begin perform public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', public.org_current_month('UTC', now()),
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":6}]'::jsonb); end $$;
do $$ begin perform set_config('pb.s', public.get_project_billing('07660000-0000-0000-0000-0000000000c1')::text, true); end $$;
do $$ begin perform set_config('pb.s2', public.get_project_billing('07660000-0000-0000-0000-0000000000c2')::text, true); end $$;

select is((current_setting('pb.s')::jsonb ->> 'work_billed')::numeric, 250000::numeric,
  'AC-PB-007 billed to date = the plain invoice''s net 50,000 + the claim''s net 160,000 + its 40,000 recovery; DP, cancelled and unraised excluded'); -- 1
select is((current_setting('pb.s')::jsonb ->> 'dp_billed')::numeric, 200000::numeric,
  'AC-PB-007 the down payment invoiced is its invoice net of tax');                                            -- 2
select is((current_setting('pb.s')::jsonb ->> 'dp_recovered')::numeric, 40000::numeric,
  'AC-PB-007 recovered counts only submitted claims');                                                         -- 3
select is((current_setting('pb.s')::jsonb ->> 'not_submitted')::numeric, 40000::numeric,
  'AC-PB-007 the unraised 1 km claim (50,000 less 10,000 recovery) is raised-not-submitted');                   -- 4
select is((current_setting('pb.s')::jsonb ->> 'contract_net')::numeric, 1000000::numeric,
  'AC-PB-007 an exclusive contract reads at its value');                                                       -- 5
select is((current_setting('pb.s2')::jsonb ->> 'contract_net')::numeric, 1000000::numeric,
  'AC-PB-007 an inclusive contract reads net of its tax');                                                     -- 6
select is((select (x ->> 'claimed_quantity')::numeric || '/' || (x ->> 'assessed_quantity')::numeric
             from jsonb_array_elements(current_setting('pb.s')::jsonb -> 'boq') x
            where x ->> 'boq_item_id' = '07660000-0000-0000-0000-0000000000e1'), '5.000/6.000',
  'AC-PB-007 the line shows 5 claimed on live claims (4 + 1; the cancelled 2 is out) and 6 assessed');         -- 7
select is((current_setting('pb.s')::jsonb -> 'assessment' ->> 'pct_complete')::numeric || '/' || (current_setting('pb.s')::jsonb -> 'assessment' ->> 'month'),
  '60.00/' || public.org_current_month('UTC', now())::text,
  'AC-PB-007 the latest assessment is this month at 60% (6 of 10 km)');                                        -- 8
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(public.get_project_billing('07660000-0000-0000-0000-0000000000c1'), null::jsonb,
  'AC-PB-007 another org reads nothing — null, never a zero summary');                                          -- 9
reset role;
select is(has_function_privilege('anon', 'public.get_project_billing(uuid)', 'EXECUTE'), false,
  'AC-PB-007 anon cannot read billing');                                                                        -- 10
select is((select prosecdef from pg_proc where oid = 'public.get_project_billing(uuid)'::regprocedure), false,
  'AC-PB-007 the summary is SECURITY INVOKER — RLS is its tenancy boundary');                                   -- 11
select ok((select coalesce(reloptions::text, '') from pg_class where oid = 'public.sales_invoice_work_billed'::regclass) ~ 'security_invoker=true',
  'AC-PB-007 the shared billed-work view runs with the caller''s RLS');                                         -- 12

select * from finish();
rollback;
