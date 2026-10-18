-- 0323_management_pack_invoice_presence.test.sql — #1083 AC-MIP-001/002.
-- Read the grouped earlier facts from the real reader RPC and the shared billed-work view.
begin;
create extension if not exists pgtap;
select plan(22);

insert into organizations (id, name, default_currency, default_timezone, down_payment_item) values
  ('10830000-0000-0000-0000-000000000001', 'MIP Org', 'IDR', 'UTC', 'DP-ITEM'),
  ('10830000-0000-0000-0000-000000000002', 'MIP Other Org', 'IDR', 'UTC', null);
insert into auth.users (id, email)
values ('10830000-0000-0000-0000-0000000000a1', 'mip-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status)
values ('10830000-0000-0000-0000-0000000000a1', '10830000-0000-0000-0000-000000000001',
        'MIP Finance', 'mip-fin@example.com', 'Finance', 'active');

insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency, archived_at) values
  ('10830000-0000-0000-0000-0000000000c1', '10830000-0000-0000-0000-000000000001', 'MIP Contract', 'Ongoing Project', 1000, 'exclusive', 0, 'IDR', null),
  ('10830000-0000-0000-0000-0000000000c2', '10830000-0000-0000-0000-000000000001', 'MIP Zero', 'Ongoing Project', 1000, 'exclusive', 0, 'EUR', null),
  ('10830000-0000-0000-0000-0000000000c3', '10830000-0000-0000-0000-000000000001', 'MIP Volume', 'Ongoing Project', 1000, 'exclusive', 0, 'CAD', null),
  ('10830000-0000-0000-0000-0000000000c4', '10830000-0000-0000-0000-000000000001', 'MIP Recovery', 'Ongoing Project', 1000, 'exclusive', 0, 'EUR', null),
  ('10830000-0000-0000-0000-0000000000c5', '10830000-0000-0000-0000-000000000001', 'MIP Archived', 'Close Out', 0, null, null, 'IDR', now()),
  ('10830000-0000-0000-0000-0000000000c6', '10830000-0000-0000-0000-000000000001', 'MIP Pipeline', 'Leads', 0, null, null, 'IDR', null),
  ('10830000-0000-0000-0000-0000000000c9', '10830000-0000-0000-0000-000000000002', 'MIP Other', 'Ongoing Project', 0, null, null, 'IDR', null);

insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('10830000-0000-0000-0000-0000000000b1', '10830000-0000-0000-0000-000000000001',
   '10830000-0000-0000-0000-0000000000c4', 'MIP-WORK', 'MIP work', 'unit', 1, 100);

-- Two earlier foreign invoices net to zero; a zero-valued invoice is a separate one-row group.
-- The selected range is Jan–Feb 2026: the Jan 1 row is in-window; Mar 1 is the exclusive end.
insert into sales_invoices (id, org_id, project_id, invoice_date, amount, tax_treatment, tax_amount, currency,
                            status, erp_docstatus, erp_cancelled_at) values
  ('10830000-0000-0000-0000-00000000e001', '10830000-0000-0000-0000-000000000001', '10830000-0000-0000-0000-0000000000c1', '2025-12-31',  100, 'exclusive', 0, 'USD', 'Paid', null, null),
  ('10830000-0000-0000-0000-00000000e002', '10830000-0000-0000-0000-000000000001', '10830000-0000-0000-0000-0000000000c1', '2025-12-31', -100, 'exclusive', 0, 'USD', 'Unpaid', null, null),
  ('10830000-0000-0000-0000-00000000e003', '10830000-0000-0000-0000-000000000001', '10830000-0000-0000-0000-0000000000c1', '2026-01-01',   25, 'exclusive', 0, 'USD', 'Paid', null, null),
  ('10830000-0000-0000-0000-00000000e004', '10830000-0000-0000-0000-000000000001', '10830000-0000-0000-0000-0000000000c1', '2025-12-31', 3000, 'exclusive', 0, 'USD', 'Draft', null, null),
  ('10830000-0000-0000-0000-00000000e005', '10830000-0000-0000-0000-000000000001', '10830000-0000-0000-0000-0000000000c1', '2025-12-31', 4000, 'exclusive', 0, 'USD', 'Cancelled', null, null),
  ('10830000-0000-0000-0000-00000000e006', '10830000-0000-0000-0000-000000000001', '10830000-0000-0000-0000-0000000000c1', '2026-03-01',   50, 'exclusive', 0, 'USD', 'Paid', null, null),
  ('10830000-0000-0000-0000-00000000e007', '10830000-0000-0000-0000-000000000001', '10830000-0000-0000-0000-0000000000c1', '2025-12-31', null, 'exclusive', 0, 'ZZZ', 'Paid', null, null),
  ('10830000-0000-0000-0000-00000000e008', '10830000-0000-0000-0000-000000000001', '10830000-0000-0000-0000-0000000000c1', null, 99, 'exclusive', 0, 'AUD', 'Paid', null, null),
  ('10830000-0000-0000-0000-00000000e009', '10830000-0000-0000-0000-000000000001', '10830000-0000-0000-0000-0000000000c1', '2025-12-31',   5, 'exclusive', 0, 'NOK', 'Paid', 2, now()),
  ('10830000-0000-0000-0000-00000000e00a', '10830000-0000-0000-0000-000000000001', '10830000-0000-0000-0000-0000000000c2', '2025-12-31',   0, 'exclusive', 0, 'EUR', 'Paid', null, null),
  ('10830000-0000-0000-0000-00000000e00b', '10830000-0000-0000-0000-000000000001', '10830000-0000-0000-0000-0000000000c5', '2025-12-31',   7, 'exclusive', 0, 'USD', 'Paid', null, null),
  ('10830000-0000-0000-0000-00000000e00c', '10830000-0000-0000-0000-000000000001', '10830000-0000-0000-0000-0000000000c6', '2025-12-31',   8, 'exclusive', 0, 'USD', 'Paid', null, null),
  ('10830000-0000-0000-0000-00000000e00d', '10830000-0000-0000-0000-000000000002', '10830000-0000-0000-0000-0000000000c9', '2025-12-31',   9, 'exclusive', 0, 'USD', 'Paid', null, null),
  ('10830000-0000-0000-0000-00000000e00e', '10830000-0000-0000-0000-000000000001', null, '2025-12-31', 75, 'exclusive', 0, 'GBP', 'Paid', null, null);

-- A real progress claim recovers half of the down payment; counted work stays net + recovery.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10830000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
declare v_down_payment uuid;
begin
  v_down_payment := public.create_progress_claim(
    '10830000-0000-0000-0000-0000000000c4', 'down_payment',
    p_down_payment_amount => 200, p_recovery_pct => 50);
  perform set_config('mip.down_payment_id', v_down_payment::text, true);
end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('mip.down_payment_id')::uuid, '10830000-0000-0000-0000-000000000001',
        '10830000-0000-0000-0000-0000000000c4', '2025-12-31', 200, 'exclusive', 0, 'EUR', 'Unpaid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10830000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
declare v_progress uuid;
begin
  v_progress := public.create_progress_claim(
    '10830000-0000-0000-0000-0000000000c4', 'progress',
    p_lines => '[{"boq_item_id":"10830000-0000-0000-0000-0000000000b1","quantity":1}]'::jsonb);
  perform set_config('mip.progress_id', v_progress::text, true);
end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('mip.progress_id')::uuid, '10830000-0000-0000-0000-000000000001',
        '10830000-0000-0000-0000-0000000000c4', '2025-12-31', 50, 'exclusive', 0, 'EUR', 'Unpaid');

insert into sales_invoices (id, org_id, project_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
select ('10830000-0000-0000-0001-' || lpad(to_hex(n), 12, '0'))::uuid,
       '10830000-0000-0000-0000-000000000001', '10830000-0000-0000-0000-0000000000c3',
       '2025-12-31', 1, 'exclusive', 0, 'CAD', 'Paid'
  from generate_series(1, 1001) as n;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10830000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform set_config('mip.pack', public.get_management_pack('2026-01-01', '2026-02-01')::text, true);
end $$;

select is((select (x->>'net')::numeric from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->>'project_id' = '10830000-0000-0000-0000-0000000000c1' and x->>'currency' = 'USD'),
          0::numeric, 'AC-MIP-001 earlier +100 and -100 invoices keep their exact zero net');
select is((select (x->>'invoice_count')::int from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->>'project_id' = '10830000-0000-0000-0000-0000000000c1' and x->>'currency' = 'USD'),
          2, 'AC-MIP-001 earlier +100 and -100 invoices report count 2');
select is((select (x->>'net')::numeric from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->>'project_id' = '10830000-0000-0000-0000-0000000000c2' and x->>'currency' = 'EUR'),
          0::numeric, 'AC-MIP-001 an earlier zero-valued eligible invoice keeps zero net');
select is((select (x->>'invoice_count')::int from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->>'project_id' = '10830000-0000-0000-0000-0000000000c2' and x->>'currency' = 'EUR'),
          1, 'AC-MIP-001 an earlier zero-valued eligible invoice reports count 1');
select is((select (x->>'net')::numeric from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced') x
            where x->>'project_id' = '10830000-0000-0000-0000-0000000000c1' and x->>'currency' = 'USD' and x->>'month' = '2026-01-01'),
          25::numeric, 'AC-MIP-002 an invoice on the first selected day is in-window');
select is((select (x->>'invoice_count')::int from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced') x
            where x->>'project_id' = '10830000-0000-0000-0000-0000000000c1' and x->>'currency' = 'USD' and x->>'month' = '2026-01-01'),
          1, 'AC-MIP-002 the first-day in-window invoice count stays 1');
select is((select count(*)::int from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced') x
            where x->>'project_id' = '10830000-0000-0000-0000-0000000000c1' and x->>'currency' = 'USD' and x->>'month' = '2026-03-01'),
          0, 'AC-MIP-002 an invoice on the month after the as-at month is excluded');
select is((select (x->>'net')::numeric from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->>'project_id' = '10830000-0000-0000-0000-0000000000c4' and x->>'currency' = 'EUR'),
          100::numeric, 'AC-MIP-002 earlier progress work includes the positive down-payment recovery');
select is((select (x->>'invoice_count')::int from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->>'project_id' = '10830000-0000-0000-0000-0000000000c4' and x->>'currency' = 'EUR'),
          1, 'AC-MIP-002 the earlier down-payment invoice itself is excluded');
select is((select (x->>'invoice_count')::int from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->>'project_id' = '10830000-0000-0000-0000-0000000000c1' and x->>'currency' = 'USD'),
          2, 'AC-MIP-002 Draft and Cancelled statuses do not enter the counted relation');
select is((select count(*)::int from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->>'currency' = 'ZZZ'),
          0, 'AC-MIP-002 a null source net is not counted');
select is((current_setting('mip.pack')::jsonb->>'undated_invoice_count')::int,
          1, 'AC-MIP-002 an eligible undated invoice remains only in the undated count');
select is((select count(*)::int from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->>'currency' = 'AUD'),
          0, 'AC-MIP-002 an undated invoice is not in the earlier aggregate');
select is((select count(*)::int from jsonb_array_elements(current_setting('mip.pack')::jsonb->'projects') x
            where x->>'id' = '10830000-0000-0000-0000-0000000000c9'),
          0, 'AC-MIP-002 another organisation project stays outside the reader');
select is((select (x->>'net')::numeric from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->'project_id' = 'null'::jsonb and x->>'currency' = 'GBP'),
          75::numeric, 'AC-MIP-002 an eligible unassigned invoice remains in earlier facts');
select is((select (x->>'invoice_count')::int from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->'project_id' = 'null'::jsonb and x->>'currency' = 'GBP'),
          1, 'AC-MIP-002 the unassigned earlier group has one counted source row');
select ok(not exists (select 1 from jsonb_array_elements(current_setting('mip.pack')::jsonb->'projects') x
                       where x->>'id' = '10830000-0000-0000-0000-0000000000c5')
          and not exists (select 1 from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
                           where x->>'project_id' = '10830000-0000-0000-0000-0000000000c5'),
          'AC-MIP-002 an earlier invoice alone does not add an archived project');
select ok(not exists (select 1 from jsonb_array_elements(current_setting('mip.pack')::jsonb->'projects') x
                       where x->>'id' = '10830000-0000-0000-0000-0000000000c6')
          and not exists (select 1 from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
                           where x->>'project_id' = '10830000-0000-0000-0000-0000000000c6'),
          'AC-MIP-002 an earlier invoice alone does not add a pipeline project');
select is((select (x->>'net')::numeric from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->>'project_id' = '10830000-0000-0000-0000-0000000000c1' and x->>'currency' = 'NOK'),
          5::numeric, 'AC-MIP-002 the existing status and net relation does not add cancellation-stamp or docstatus predicates');
select is((select (x->>'invoice_count')::int from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->>'project_id' = '10830000-0000-0000-0000-0000000000c1' and x->>'currency' = 'NOK'),
          1, 'AC-MIP-002 a Paid source row stays counted despite its existing ERP stamps');
select is((select (x->>'invoice_count')::int from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->>'project_id' = '10830000-0000-0000-0000-0000000000c3' and x->>'currency' = 'CAD'),
          1001, 'AC-MIP-002 the server aggregation reports all 1001 eligible source rows');
select is((select (x->>'net')::numeric from jsonb_array_elements(current_setting('mip.pack')::jsonb->'invoiced_before') x
            where x->>'project_id' = '10830000-0000-0000-0000-0000000000c3' and x->>'currency' = 'CAD'),
          1001::numeric, 'AC-MIP-002 the server aggregation preserves the full 1001-row net');

reset role;
select * from finish();
rollback;
