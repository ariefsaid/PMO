-- Read-model access paths and confirmation event timestamps.
-- Rollback: rollback/0339_read_model_access_and_confirmation_time_down.sql
begin;

create index erp_purchase_documents_visible_org_id_idx
  on public.erp_purchase_documents (org_id, id)
  where erp_docstatus = 1 and not pmo_owned;

create or replace function public.confirm_work_order_acceptance(p_id uuid) returns jsonb
 language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.auth_org_id(); v_wo uuid; v_project uuid; v_status public.work_order_status; v_preparer uuid; v_is_final boolean; v_doc uuid; v_basis text:='standard'; v_sole boolean:=false; v_net numeric; v_close numeric; v_currency text; v_dp numeric; v_doc_project uuid; v_billing jsonb;
begin
 perform public.assert_is_active_member();
 select work_order_id into v_wo from public.work_order_acceptances where id=p_id and org_id=v_org;
 if not found then raise exception 'acceptance not found' using errcode='P0002'; end if;
 perform public.lock_work_order_billing(v_wo);
 select project_id,status,org_id,currency,coalesce(closing_value,case when tax_treatment='inclusive' then order_value-tax_amount else order_value end)
   into v_project,v_status,v_org,v_currency,v_net from public.work_orders where id=v_wo for update;
 if not found or v_org is distinct from public.auth_org_id() then raise exception 'work order not found' using errcode='P0002'; end if;
 select prepared_by,is_final,document_id into v_preparer,v_is_final,v_doc from public.work_order_acceptances where id=p_id and org_id=v_org for update;
 if not found then raise exception 'acceptance not found' using errcode='P0002'; end if;
 if v_status<>'Issued' then raise exception 'only an issued work order can confirm an acceptance' using errcode='42501'; end if;
 if public.auth_role() not in ('Admin','Finance') then raise exception 'only Admin or Finance may confirm an acceptance' using errcode='42501'; end if;
 if v_preparer=auth.uid() then
   select count(*)=1 and bool_or(p.id=auth.uid()) into v_sole from public.profiles p where p.org_id=v_org and public.is_active_member(p.id);
   if not coalesce(v_sole,false) then raise exception 'separation of duties: the preparer cannot confirm this acceptance' using errcode='42501'; end if;
   v_basis:='sole_operator';
 end if;
 select project_id into v_doc_project from public.project_documents d where d.id=v_doc and d.org_id=v_org and d.project_id=v_project and d.status in ('Issued','Approved') and nullif(btrim(d.file_path),'') is not null for update;
 if v_doc is null or not found then raise exception 'confirmation requires an Issued or Approved project document with a file' using errcode='23514'; end if;
 if v_is_final and exists(select 1 from public.work_order_lines l where l.work_order_id=v_wo and not exists(select 1 from public.work_order_acceptance_lines x where x.acceptance_id=p_id and x.boq_item_id=l.boq_item_id)) then
   raise exception 'a final acceptance must include every allocated contract line' using errcode='23514'; end if;
 if exists(select 1 from public.work_order_acceptance_lines x where x.acceptance_id=p_id and not exists(select 1 from public.work_order_lines l where l.work_order_id=v_wo and l.boq_item_id=x.boq_item_id)) then
   raise exception 'an accepted contract line is no longer allocated to this work order' using errcode='23514'; end if;
 select coalesce(sum(round(x.quantity*b.rate,2)),0) into v_close from public.work_order_acceptance_lines x join public.boq_items b on b.id=x.boq_item_id where x.acceptance_id=p_id;
 update public.work_order_acceptances set status='Confirmed',confirmed_by=auth.uid(),confirmed_at=clock_timestamp(),confirm_basis=v_basis where id=p_id;
 if v_is_final then
   if v_close>v_net then
     raise exception 'closing value % exceeds work-order net %',round(v_close,2),round(v_net,2) using errcode='BW001'; end if;
   perform set_config('pmo.confirming_work_order_acceptance','on',true);
   update public.work_orders set closing_value=v_close,closing_acceptance_id=p_id,status='Closed',closed_at=clock_timestamp() where id=v_wo;
   perform set_config('pmo.confirming_work_order_acceptance','',true);
   begin
     perform public.assert_work_order_invoiceable(v_org,v_wo,v_project,p_id::text,0,v_currency);
   exception when sqlstate 'BW001' then raise exception 'closing value % cannot close: billed and pending work exceeds this accepted value; %',round(v_close,2),sqlerrm using errcode='BW001'; end;
 end if;
 v_billing:=public.get_project_billing(v_project);
 v_dp:=coalesce((v_billing->>'dp_billed')::numeric,0)-coalesce((v_billing->>'dp_recovered')::numeric,0);
 perform public.log_audit('work_order_acceptance.confirm',v_org,auth.uid(),p_id,jsonb_build_object('project_id',v_project,'work_order_id',v_wo,'basis',v_basis,'is_final',v_is_final,'closing_value',case when v_is_final then v_close end,'dp_held',v_dp));
 return jsonb_build_object('closing_value',case when v_is_final then v_close end,'dp_held',v_dp);
end; $$;
revoke all on function public.confirm_work_order_acceptance(uuid) from public,anon;
grant execute on function public.confirm_work_order_acceptance(uuid) to authenticated;

commit;
