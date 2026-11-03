-- AC-PLN-005 reversal harness — the 0534 rollback must actually REMOVE the entitlement conjunct it
-- appended to live policies, and re-applying the migration must put it back. The runner
-- (scripts/test-plans-feature-enforcement-rollback.sh) expands the two markers in place and runs the
-- file transactionally, so the database is left at HEAD.
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap;
select plan(7);

-- @0534_DOWN@

select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename = 'incoming_payments'
              and cmd in ('INSERT','UPDATE','DELETE','ALL')
              and (coalesce(qual, '') like '%org_feature_enabled%'
                   or coalesce(with_check, '') like '%org_feature_enabled%')), 0,
  'AC-PLN-005 the rollback strips the appended conjunct from every incoming_payments write policy');

select is((select count(*)::int from pg_policies
            where schemaname = 'public'
              and tablename in ('sales_invoices','sales_invoice_authors','sales_invoice_submit_authorizations',
                                'progress_claims','progress_claim_lines','progress_claim_evidence',
                                'progress_assessment_quantities','boq_items','contract_rate_lines',
                                'contract_rate_assignees','tm_claims','tm_claim_lines','tm_claim_sources',
                                'imprest_plans','imprest_plan_lines','imprest_replenishments',
                                'imprest_cash_counts','stock_items','stock_units','stock_warehouses',
                                'budget_projections','project_progress_entries','fx_rates',
                                'procurement_import_runs','procurement_erp_links','vendor_withholding_slips',
                                'purchase_order_lines','purchase_order_revisions','po_variations',
                                'subcontract_acceptances','procurement_invoice_lines',
                                'erp_purchase_documents','erp_purchase_document_marks','ms_graph_connections')
              and cmd in ('INSERT','UPDATE','DELETE','ALL')
              and (coalesce(qual, '') like '%org_feature_enabled%'
                   or coalesce(with_check, '') like '%org_feature_enabled%')), 0,
  'AC-PLN-005 the rollback strips it across the whole newly-gated set');

select ok(to_regprocedure('public.assert_feature_on(uuid,text)') is null,
  'AC-PLN-005 the rollback drops the raising gate helper');
select ok(to_regprocedure('public.service_feature_enabled(uuid,text)') is null,
  'AC-PLN-005 the rollback drops the service twin');

-- 0081's five module families were outside this slice: their gates must SURVIVE (nothing over-stripped).
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename in ('procurement_receipts','procurement_receipt_files')
              and cmd in ('INSERT','UPDATE','DELETE','ALL')
              and (coalesce(qual, '') like '%org_feature_enabled%'
                   or coalesce(with_check, '') like '%org_feature_enabled%')), 2,
  'AC-PLN-005 the pre-existing module gates survive the rollback');

-- @0534_UP@

select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename = 'incoming_payments'
              and cmd in ('INSERT','UPDATE','DELETE','ALL')
              and (coalesce(qual, '') like '%org_feature_enabled%'
                   or coalesce(with_check, '') like '%org_feature_enabled%')), 3,
  'AC-PLN-005 re-applying the migration restores the conjunct (up after down is clean)');

select ok(to_regprocedure('public.assert_feature_on(uuid,text)') is not null,
  'AC-PLN-005 re-applying restores the raising gate helper');

select * from finish();
rollback;
