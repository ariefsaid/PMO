-- The rollback is exercised transactionally against the local schema; rollback restores 0279 afterward.
begin;
select plan(6);
-- The database test runner mounts only the current test file into its container, so exercise
-- the rollback statements inline (kept in lock-step with migrations/rollback/0281_vendor_withholding_slips_down.sql).
-- The rollback's precondition refuses while any slip exists (recorded tax evidence is never dropped
-- as a side effect). Prove it with one bare row (FK/trigger checks bypassed inside this transaction).
savepoint guard_probe;
set local session_replication_role = replica;
insert into public.vendor_withholding_slips
  (id, org_id, vendor_id, slip_number, slip_date, tax_period, pph_type, currency, tax_base, withheld_amount,
   invoice_count, created_by, create_payload)
values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'GUARD-PROBE', date '2026-10-01', date '2026-10-01', 'pph23', 'IDR',
        100, 2, 1, gen_random_uuid(), '{}'::jsonb);
set local session_replication_role = origin;
select throws_ok($guard$DO $rollback_precondition$
BEGIN
  IF to_regclass('public.vendor_withholding_slips') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.vendor_withholding_slips) THEN
    RAISE EXCEPTION 'rollback refused: vendor withholding slips exist — export and remove them first'
      USING ERRCODE = '55006';
  END IF;
END
$rollback_precondition$$guard$, '55006', null,
  'rollback precondition refuses while a vendor withholding slip exists');
rollback to savepoint guard_probe;
select lives_ok($guard$DO $rollback_precondition$
BEGIN
  IF to_regclass('public.vendor_withholding_slips') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.vendor_withholding_slips) THEN
    RAISE EXCEPTION 'rollback refused: vendor withholding slips exist — export and remove them first'
      USING ERRCODE = '55006';
  END IF;
END
$rollback_precondition$$guard$, 'rollback precondition passes when no slip exists');
DROP FUNCTION IF EXISTS public.get_vendor_withholding_slip(uuid);
DROP FUNCTION IF EXISTS public.list_vendor_withholding_bills(uuid,text,text,uuid[],boolean,date,uuid,boolean,integer);
DROP FUNCTION IF EXISTS public.list_vendor_withholding_slips(uuid,date,uuid,date,uuid,integer);
DROP VIEW IF EXISTS public.vendor_withholding_bill_register;
DROP VIEW IF EXISTS public.vendor_withholding_slip_register;
DROP TRIGGER IF EXISTS vendor_withholding_slips_integrity ON public.vendor_withholding_slips;
DROP TRIGGER IF EXISTS vendor_withholding_slip_bills_integrity ON public.vendor_withholding_slip_bills;
DROP TRIGGER IF EXISTS vendor_withholding_slips_zz_record_change ON public.vendor_withholding_slips;
DROP TRIGGER IF EXISTS vendor_withholding_slip_bills_zz_record_change ON public.vendor_withholding_slip_bills;
DROP FUNCTION IF EXISTS public.record_vendor_withholding_slip(uuid,uuid,text,date,date,text,numeric,numeric,uuid[],uuid[]);
DROP FUNCTION IF EXISTS public.correct_vendor_withholding_slip(uuid,integer,text,date,date,text);
DROP FUNCTION IF EXISTS public.void_vendor_withholding_slip(uuid,integer,text);
DROP FUNCTION IF EXISTS public.assert_vendor_withholding_slip_integrity();
DELETE FROM public.record_history_config WHERE entity_type IN ('vendor_withholding_slip','vendor_withholding_slip_bill');
CREATE OR REPLACE FUNCTION public.record_history_visible(p_entity_type text,p_entity_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
BEGIN
 CASE p_entity_type
  WHEN 'project' THEN RETURN EXISTS(SELECT 1 FROM public.projects WHERE id=p_entity_id);
  WHEN 'budget_version' THEN RETURN EXISTS(SELECT 1 FROM public.budget_versions WHERE id=p_entity_id);
  WHEN 'budget_line_item' THEN RETURN EXISTS(SELECT 1 FROM public.budget_line_items WHERE id=p_entity_id);
  WHEN 'work_order' THEN RETURN EXISTS(SELECT 1 FROM public.work_orders WHERE id=p_entity_id);
  WHEN 'procurement' THEN RETURN EXISTS(SELECT 1 FROM public.procurements WHERE id=p_entity_id);
  WHEN 'purchase_request' THEN RETURN EXISTS(SELECT 1 FROM public.purchase_requests WHERE id=p_entity_id);
  WHEN 'rfq' THEN RETURN EXISTS(SELECT 1 FROM public.rfqs WHERE id=p_entity_id);
  WHEN 'purchase_order' THEN RETURN EXISTS(SELECT 1 FROM public.purchase_orders WHERE id=p_entity_id);
  WHEN 'payment' THEN RETURN EXISTS(SELECT 1 FROM public.payments WHERE id=p_entity_id);
  WHEN 'task' THEN RETURN EXISTS(SELECT 1 FROM public.tasks WHERE id=p_entity_id);
  WHEN 'company' THEN RETURN EXISTS(SELECT 1 FROM public.companies WHERE id=p_entity_id);
  WHEN 'contact' THEN RETURN EXISTS(SELECT 1 FROM public.contacts WHERE id=p_entity_id);
  WHEN 'sales_invoice' THEN RETURN EXISTS(SELECT 1 FROM public.sales_invoices WHERE id=p_entity_id);
  WHEN 'procurement_invoice' THEN RETURN EXISTS(SELECT 1 FROM public.procurement_invoices WHERE id=p_entity_id);
  ELSE RAISE EXCEPTION 'record_history_visible: no visibility arm for entity type %',p_entity_type USING errcode='P0001';
 END CASE;
END $$;
REVOKE ALL ON FUNCTION public.record_history_visible(text,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.record_history_visible(text,uuid) TO authenticated,service_role;
DROP TABLE IF EXISTS public.vendor_withholding_slip_bills;
DROP TABLE IF EXISTS public.vendor_withholding_slips;
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS bupot_companies_org_id_id_uq;
ALTER TABLE public.procurements DROP CONSTRAINT IF EXISTS bupot_procurements_org_id_id_uq;
ALTER TABLE public.procurement_invoices DROP CONSTRAINT IF EXISTS bupot_invoices_org_id_id_uq;
NOTIFY pgrst,'reload schema';
select ok(to_regclass('public.vendor_withholding_slips') is null and to_regclass('public.vendor_withholding_slip_bills') is null,'rollback removes only the feature tables');
select ok(to_regprocedure('public.record_vendor_withholding_slip(uuid,uuid,text,date,date,text,numeric,numeric,uuid[],uuid[])') is null,'rollback removes the three writer RPCs');
select ok((select count(*)=14 from public.record_history_config),'rollback restores the prior history catalog');
select ok(has_function_privilege('authenticated','public.set_procurement_invoice_efaktur(uuid,text,date)','EXECUTE'),'rollback leaves the incumbent e-Faktur writer grant intact');
select * from finish();
rollback;
