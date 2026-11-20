-- invoice_pairs_erp_cancelled.test.sql — #1696 (AC-ECA-032): an accepted pair whose ERP invoice is later cancelled in the
-- ERP. Pins the project invoice bucket, the retained pair and the manual undo. The post-undo candidate
-- is an ordinary match, not proof of authoritative amendment identity.
-- Functions exercised (unchanged): accept_invoice_pairs, unpair_invoice, propose_invoice_pairs, get_project_finances.
begin;
select plan(12);

-- ── fixture (a server load: no JWT) ──────────────────────────────────────────────────────────────
insert into public.organizations (id, name) values ('16960000-0000-0000-0000-000000000001', 'Cancelled pair org');
insert into auth.users (id, email) values
  ('16960000-0000-0000-0000-0000000000a1', 'cpair-fin@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('16960000-0000-0000-0000-0000000000a1', '16960000-0000-0000-0000-000000000001', 'Cpair Finance', 'cpair-fin@example.test', 'Finance', 'active');
insert into public.companies (id, org_id, name, type) values
  ('16960000-0000-0000-0000-0000000000f1', '16960000-0000-0000-0000-000000000001', 'Cpair Client', 'Client');
insert into public.projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                             tax_base_numerator, tax_base_denominator, subject_to_vat, client_id, project_manager_id) values
  ('16960000-0000-0000-0000-0000000000c1', '16960000-0000-0000-0000-000000000001', 'Cpair P', 'Ongoing Project', 'USD',
   1000000, 'exclusive', 0, 0, 1, 1, false, '16960000-0000-0000-0000-0000000000f1', '16960000-0000-0000-0000-0000000000a1');
insert into public.external_domain_ownership (org_id, external_tier, domain) values
  ('16960000-0000-0000-0000-000000000001', 'erpnext', 'revenue');
-- N1: PMO-raised (10,000 + 1,100 tax, exclusive). E1: the same sale brought in from the ERP (11,100 inclusive).
insert into public.sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, erp_outstanding_amount,
                                   tax_treatment, tax_amount, currency, status, reference_number,
                                   native_lines, pmo_native, author_user_id, pmo_number) values
  ('16960000-0000-0000-0000-0000000005a1', '16960000-0000-0000-0000-000000000001', '16960000-0000-0000-0000-0000000000c1',
   '16960000-0000-0000-0000-0000000000f1', '2026-03-10', 10000, 11100, 'exclusive', 1100, 'USD', 'Unpaid', 'PO-7',
   '[{"description":"n1"}]', true, '16960000-0000-0000-0000-0000000000a1', 'PMO-N1');
insert into public.sales_invoices (id, org_id, project_id, customer_id, si_number, invoice_date, amount,
                                   erp_outstanding_amount, tax_treatment, tax_amount, currency, status, erp_docstatus, reference_number) values
  ('16960000-0000-0000-0000-0000000005e1', '16960000-0000-0000-0000-000000000001', null, '16960000-0000-0000-0000-0000000000f1',
   'SI-E1', '2026-03-20', 11100, 11100, 'inclusive', 1100, 'USD', 'Unpaid', 1, 'PO-7');

-- ── accept ──────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"16960000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.accept_invoice_pairs('[{"pmo":"16960000-0000-0000-0000-0000000005a1","erp":"16960000-0000-0000-0000-0000000005e1"}]'::jsonb), 1,
          'AC-ECA-032 Finance accepts the pair');
select is((public.get_project_finances('16960000-0000-0000-0000-0000000000c1') #>> '{invoices,0,invoiced}')::numeric, 11100::numeric,
          'AC-ECA-032 after accept the sale counts once, as the ERP invoice');

-- Separate projects isolate two otherwise countable ERP invoices, one cancellation signal on each.
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into public.projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                             tax_base_numerator, tax_base_denominator, subject_to_vat, client_id, project_manager_id)
select id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
       tax_base_numerator, tax_base_denominator, subject_to_vat, client_id, project_manager_id
from (values
  ('16960000-0000-0000-0000-0000000000c2'::uuid, 'Docstatus signal'),
  ('16960000-0000-0000-0000-0000000000c3'::uuid, 'Timestamp signal')
) as fixture(id, name)
cross join lateral (select org_id, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
  tax_base_numerator, tax_base_denominator, subject_to_vat, client_id, project_manager_id
  from public.projects where id = '16960000-0000-0000-0000-0000000000c1') as template;
insert into public.sales_invoices (id, org_id, project_id, customer_id, si_number, invoice_date, amount,
                                   erp_outstanding_amount, tax_treatment, tax_amount, currency, status, erp_docstatus, erp_cancelled_at)
values
  ('16960000-0000-0000-0000-0000000005e3', '16960000-0000-0000-0000-000000000001', '16960000-0000-0000-0000-0000000000c2',
   '16960000-0000-0000-0000-0000000000f1', 'SI-DOCSTATUS', '2026-03-20', 11100, 11100, 'inclusive', 1100, 'USD', 'Unpaid', 2, null),
  ('16960000-0000-0000-0000-0000000005e4', '16960000-0000-0000-0000-000000000001', '16960000-0000-0000-0000-0000000000c3',
   '16960000-0000-0000-0000-0000000000f1', 'SI-TIMESTAMP', '2026-03-20', 11100, 11100, 'inclusive', 1100, 'USD', 'Unpaid', 1, now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"16960000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.get_project_finances('16960000-0000-0000-0000-0000000000c2')->'invoices', '[]'::jsonb,
          'AC-ECA-032 docstatus alone excludes the ERP invoice from the project invoice bucket');
select is(public.get_project_finances('16960000-0000-0000-0000-0000000000c3')->'invoices', '[]'::jsonb,
          'AC-ECA-032 cancellation timestamp alone excludes the ERP invoice from the project invoice bucket');

-- ── the ERP cancels E1 and raises the amendment E1-1 (the feed writes as the service role) ──────────
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
update public.sales_invoices set erp_docstatus = 2, erp_cancelled_at = now(), status = 'Cancelled'
 where id = '16960000-0000-0000-0000-0000000005e1';
insert into public.sales_invoices (id, org_id, project_id, customer_id, si_number, invoice_date, amount,
                                   erp_outstanding_amount, tax_treatment, tax_amount, currency, status, erp_docstatus,
                                   reference_number, erp_amended_from) values
  ('16960000-0000-0000-0000-0000000005e2', '16960000-0000-0000-0000-000000000001', null, '16960000-0000-0000-0000-0000000000f1',
   'SI-E1-1', '2026-03-20', 11100, 11100, 'inclusive', 1100, 'USD', 'Unpaid', 1, 'PO-7', 'SI-E1');
select is((select paired_erp_invoice_id from public.sales_invoices where id = '16960000-0000-0000-0000-0000000005a1'),
          '16960000-0000-0000-0000-0000000005e1'::uuid, 'AC-ECA-032 the cancel keeps the pair: nothing unpairs on its own');

set local role authenticated;
set local request.jwt.claims = '{"sub":"16960000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.get_project_finances('16960000-0000-0000-0000-0000000000c1')->'invoices', '[]'::jsonb,
          'AC-ECA-032 with the ERP invoice cancelled both copies are excluded from the project invoice bucket');
select is((select count(*)::int from public.sales_invoices
            where (id = '16960000-0000-0000-0000-0000000005e1' and erp_docstatus = 2 and erp_cancelled_at is not null)
               or (id = '16960000-0000-0000-0000-0000000005e2' and erp_amended_from = 'SI-E1' and erp_docstatus = 1)), 2,
          'AC-ECA-034 Finance can read the cancellation and amendment lifecycle fields');
select is((select count(*)::int from public.propose_invoice_pairs()
            where pmo_invoice_id = '16960000-0000-0000-0000-0000000005a1'), 0,
          'AC-ECA-032 a paired PMO invoice is not proposed again while it is paired');

-- ── undo, then re-pair with the amendment ────────────────────────────────────────────────────────
select lives_ok($$select public.unpair_invoice('16960000-0000-0000-0000-0000000005a1')$$,
                'AC-ECA-032 Finance can undo a pair whose ERP invoice is cancelled');
select is((public.get_project_finances('16960000-0000-0000-0000-0000000000c1') #>> '{invoices,0,invoiced}')::numeric, 10000::numeric,
          'AC-ECA-032 after undo the PMO invoice counts again');
select is((select count(*)::int from public.propose_invoice_pairs()
            where pmo_invoice_id = '16960000-0000-0000-0000-0000000005a1'
              and erp_invoice_id = '16960000-0000-0000-0000-0000000005e2' and not ambiguous), 1,
          'AC-ECA-032 after undo ordinary matching proposes the live invoice');
select is(public.accept_invoice_pairs('[{"pmo":"16960000-0000-0000-0000-0000000005a1","erp":"16960000-0000-0000-0000-0000000005e2"}]'::jsonb), 1,
          'AC-ECA-032 Finance accepts the ordinary match');

select * from finish();
rollback;
