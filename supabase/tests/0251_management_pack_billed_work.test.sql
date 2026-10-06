-- 0251_management_pack_billed_work.test.sql — #766 AC-PB-010 (DD-PBL-9): the management pack's invoiced figure is
-- billed WORK from the shared view — a down-payment invoice is an advance, not work; a claim invoice counts at its
-- net plus the recovery its negative line removed. Migration under test: 0251_management_pack_billed_work.sql.
begin;
create extension if not exists pgtap;
select plan(3);

insert into organizations (id, name) values ('07660000-0000-0000-0000-000000000001', 'PB Org');
update organizations set down_payment_item = 'DP-ITEM' where id = '07660000-0000-0000-0000-000000000001';
insert into auth.users (id, email) values ('07660000-0000-0000-0000-0000000000a2', 'pb-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07660000-0000-0000-0000-0000000000a2', '07660000-0000-0000-0000-000000000001', 'PB Fin', 'pb-fin@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('07660000-0000-0000-0000-0000000000f1', '07660000-0000-0000-0000-000000000001', 'PB Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-000000000001', 'PB Project', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1'),
  ('07660000-0000-0000-0000-0000000000c2', '07660000-0000-0000-0000-000000000001', 'PB Project Two', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('07660000-0000-0000-0000-0000000000e1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'SURVEY', 'Route survey', 'km', 10, 50000);

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform set_config('pb.dp', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'down_payment', p_down_payment_amount => 200000, p_recovery_pct => 20)::text, true);
  perform set_config('pb.dp2', public.create_progress_claim('07660000-0000-0000-0000-0000000000c2', 'down_payment', p_down_payment_amount => 50000, p_recovery_pct => 10)::text, true);
end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  ('07660000-0000-0000-0000-00000000cc01', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-0000000000f1', '2026-03-05', 100000, 'exclusive', 0, 'USD', 'Paid'),
  (current_setting('pb.dp')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-0000000000f1', '2026-03-10', 200000, 'exclusive', 0, 'USD', 'Paid'),
  (current_setting('pb.dp2')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c2', '07660000-0000-0000-0000-0000000000f1', null, 50000, 'exclusive', 0, 'USD', 'Unpaid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('pb.pc', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":4}]'::jsonb)::text, true); end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  (current_setting('pb.pc')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-0000000000f1', '2026-04-10', 160000, 'exclusive', 0, 'USD', 'Unpaid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('pb.pack', public.get_management_pack('2026-03-01', '2026-04-01')::text, true); end $$;
reset role;

select is((select sum((x ->> 'net')::numeric) from jsonb_array_elements(current_setting('pb.pack')::jsonb -> 'invoiced') x
            where x ->> 'project_id' = '07660000-0000-0000-0000-0000000000c1' and x ->> 'month' = '2026-03-01'), 100000::numeric,
  'AC-PB-010 March counts the plain 100,000 invoice and not the 200,000 down payment');
select is((select sum((x ->> 'net')::numeric) from jsonb_array_elements(current_setting('pb.pack')::jsonb -> 'invoiced') x
            where x ->> 'project_id' = '07660000-0000-0000-0000-0000000000c1' and x ->> 'month' = '2026-04-01'), 200000::numeric,
  'AC-PB-010 April counts the claim invoice at its net 160,000 plus the 40,000 recovered');
select is((current_setting('pb.pack')::jsonb ->> 'undated_invoice_count')::int, 0,
  'AC-PB-010 an undated down-payment invoice is not an undated invoice of work');

select * from finish();
rollback;
