-- A full correcting movement, at the stock engine's moving average; the original receipt remains intact.
create function public.reverse_order_receiving(p_request uuid,p_reason text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.order_receiving_requests; source public.stock_documents; d public.stock_documents; ls jsonb;
begin
  perform public.assert_not_light(); perform public.assert_is_active_member();
  select * into r from public.order_receiving_requests where id=p_request and org_id=public.auth_org_id();
  if not found then raise exception 'Receipt not found.' using errcode='P0002'; end if;
  perform public.receiving_lock_order(r.po_id);
  select * into r from public.order_receiving_requests where id=p_request for update;
  if not public.order_receiving_purchaser() or r.receiver_id=auth.uid() then
    raise exception 'A different purchasing user must reverse this receipt.' using errcode='42501';
  end if;
  if r.stock_document_id is null then raise exception 'This receipt has not posted.' using errcode='23514'; end if;
  select stock_document_id into d.id from public.order_receiving_reversals where request_id=r.id;
  if found then return d.id; end if;
  if nullif(btrim(p_reason),'') is null or length(p_reason)>500 then raise exception 'Give a reason for reversing this receipt.' using errcode='22023'; end if;
  select * into source from public.stock_documents where id=r.stock_document_id;
  select jsonb_agg(jsonb_build_object('item_id',item_id,'quantity',quantity,'direction','out') order by line_no) into ls
    from public.stock_document_lines where document_id=source.id;
  perform public.stock_validate_payload(r.org_id,'adjustment',jsonb_build_object('warehouse_id',r.warehouse_id,'reason',p_reason),ls);
  -- The receiver authored the count being corrected; the purchasing caller posts its correction under the existing two-person stock rule.
  insert into public.stock_documents(org_id,number,kind,warehouse_id,occurred_on,reason,created_by)
    values(r.org_id,public.next_procurement_doc_number(r.org_id,'ADJ'),'adjustment',r.warehouse_id,public.stock_org_today(r.org_id),p_reason,r.receiver_id) returning * into d;
  perform public.stock_insert_lines(d,ls);
  perform public.stock_post_core(d.id);
  insert into public.order_receiving_reversals(request_id,stock_document_id,reason,reversed_by) values(r.id,d.id,p_reason,auth.uid());
  perform public.log_audit('order.receive_reverse',r.org_id,auth.uid(),r.id,jsonb_build_object('stock_document_id',d.id,'reason',p_reason));
  return d.id;
end $$;
revoke all on function public.reverse_order_receiving(uuid,text) from public,anon;
grant execute on function public.reverse_order_receiving(uuid,text) to authenticated;
