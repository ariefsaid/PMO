-- Local-only restoration and additions; apply together in a single transaction.
insert into erp_actuals_snapshot
  (org_id, project_id, account, fiscal_year, debit, credit, net, as_of, snapshot_id)
values
  ('00000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001',
   'Cost of Goods Sold - PSC','2026',1300000.00,0,1300000.00, now() - interval '1 day',
   '5a000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001',
   'Salary - PSC','2026',180000.00,0,180000.00, now() - interval '1 day',
   '5a000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001',
   'Expenses Included In Asset Valuation - PSC','2026',300000.00,0,300000.00, now() - interval '1 day',
   '5a000000-0000-0000-0000-000000000001'),
  -- Synthetic mapped ledger Actual keeps SP-2402 above its Active-budget risk threshold for UXS-013.
  ('00000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000002',
   'Salary - PSC','2026',7000000.00,0,7000000.00, now() - interval '1 day',
   '5a000000-0000-0000-0000-000000000001'),
  -- SP-2402 has a complete mapped-category read; mapped accounts without spend
  -- are explicit synthetic zeroes so the PM at-risk signal remains actionable.
  ('00000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000002',
   'Cost of Goods Sold - PSC','2026',0,0,0, now() - interval '1 day',
   '5a000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000002',
   'Expenses Included In Asset Valuation - PSC','2026',0,0,0, now() - interval '1 day',
   '5a000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000002',
   'Entertainment Expenses - PSC','2026',0,0,0, now() - interval '1 day',
   '5a000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000002',
   'Subcontractor Costs - PSC','2026',100000.00,0,100000.00, now() - interval '1 day',
   '5a000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000002',
   'Contingency Costs - PSC','2026',100000.00,0,100000.00, now() - interval '1 day',
   '5a000000-0000-0000-0000-000000000001')
  -- ⚑ NOTE the deliberate absence: 'Entertainment Expenses - PSC' (Permits & Fees) is MAPPED but has no
  -- row here, so its actual is a real, computed 0 — the third state.
on conflict do nothing;

-- The first live ERP ledger refresh replaces the whole snapshot generation, so synthetic actuals vanish on a connected bench.
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, as_of, snapshot_id)
select '00000000-0000-0000-0000-000000000001'::uuid, project_id::uuid, 'Salary - PSC', '2026', amount, 0, amount, now() - interval '1 day', '5a000000-0000-0000-0000-000000000001'::uuid
from (values ('41000000-0000-0000-0000-000000000004',260000), ('40000000-0000-0000-0000-000000000001',2100000), ('41000000-0000-0000-0000-000000000003',2800000)) v(project_id,amount)
on conflict do nothing;

-- Monthly local-only demonstration facts; the newest invoice is unpaid, the next is partly paid and not due, and one older invoice is overdue.
with months as (
  select k, (public.org_current_month(o.default_timezone, now()) - make_interval(months => k))::date + 10 as issued,
         (120000 + 10000*k)::numeric as total
  from public.organizations o cross join generate_series(1,12) k
  where o.id = '00000000-0000-0000-0000-000000000001'
)
insert into sales_invoices (id, org_id, project_id, customer_id, si_number, invoice_date, erp_due_date, amount, tax_amount, tax_treatment, currency, status, erp_docstatus, erp_outstanding_amount, pmo_native)
select ('b5110000-0000-0000-0000-' || lpad(k::text,12,'0'))::uuid, '00000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002',
       'DEMO-SI-2401-' || lpad(k::text,3,'0'), issued, case when k <= 2 then current_date + 30 when k in (5,9) then issued + 7 else issued + 20 end,
       total, 0, 'exclusive', 'USD', case when k <= 3 then 'Unpaid' else 'Paid' end, 1,
       case when k = 1 then total when k = 2 then total / 2 when k = 3 then total / 4 else 0 end, false
from months on conflict (id) do nothing;

with months as (
  select k, (public.org_current_month(o.default_timezone, now()) - make_interval(months => k))::date + 10 as issued,
         (120000 + 10000*k)::numeric as total
  from public.organizations o cross join generate_series(1,12) k
  where o.id = '00000000-0000-0000-0000-000000000001'
), receipts as (
  select k, k as invoice_k, issued + 12 as paid_date,
         case when k = 2 then total / 4 when k = 3 then total * 3 / 4 else total end as paid
  from months where k >= 2
  union all
  select 1, 2, issued + 12, (120000 + 10000*2)::numeric / 4 from months where k = 1
)
insert into incoming_payments (id, org_id, customer_id, sales_invoice_id, ip_number, date, amount, received_amount, withheld_amount, currency, status, erp_docstatus, pmo_native)
select ('b5120000-0000-0000-0000-' || lpad(k::text,12,'0'))::uuid, '00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002',
       ('b5110000-0000-0000-0000-' || lpad(invoice_k::text,12,'0'))::uuid, 'DEMO-IP-2401-' || lpad(k::text,3,'0'), paid_date, paid, paid, 0, 'USD', 'Paid', 1, false
from receipts on conflict (id) do nothing;
