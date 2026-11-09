-- Rollback of 0742: restore the 0475 body (any issued revision passes).
create or replace function public.po_revision_push_refusal(p_org uuid, p_po_id uuid, p_revision integer, p_revise_cancels boolean)
  returns text language plpgsql stable security definer set search_path = public as $$
declare v_proc uuid;
begin
  select o.procurement_id into v_proc from public.purchase_orders o where o.id = p_po_id and o.org_id = p_org;
  if v_proc is null then return 'po_not_found'; end if;
  if p_revision is null or not exists (select 1 from public.purchase_order_revisions r
                                        where r.po_id = p_po_id and r.revision = p_revision and r.status = 'Issued') then
    return 'revision_not_issued';
  end if;
  if coalesce(p_revise_cancels, true) and (
       exists (select 1 from public.procurement_invoices i
                where i.procurement_id = v_proc and public.subcontract_bill_is_live(i.erp_docstatus, i.erp_cancelled_at))
       or exists (select 1 from public.procurement_erp_links k
                    join public.erp_purchase_documents d on d.id = k.erp_purchase_document_id
                   where k.procurement_id = v_proc and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1 and not d.pmo_owned)) then
    return 'po_has_submitted_bill';
  end if;
  return null;
end $$;
revoke all on function public.po_revision_push_refusal(uuid, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.po_revision_push_refusal(uuid, uuid, integer, boolean) to service_role;
