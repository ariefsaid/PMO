-- Reversible rollback for 0278. Export retained evidence operationally before any hosted reversal.
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
