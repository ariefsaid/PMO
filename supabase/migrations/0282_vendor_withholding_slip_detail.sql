-- Keep the invoker read projection stable while exposing retained void and live bill facts.
create or replace function public.get_vendor_withholding_slip(p_slip_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare h public.vendor_withholding_slip_register%rowtype; b jsonb; reason text;
begin
 select * into h from public.vendor_withholding_slip_register where slip_id=p_slip_id;
 if not found then raise exception using errcode='P0002',detail='bupot-not-found'; end if;
 select s.void_reason into reason from public.vendor_withholding_slips s where s.id=p_slip_id;
 select coalesce(jsonb_agg(jsonb_build_object(
   'invoice_id',r.invoice_id,'procurement_id',r.procurement_id,'vi_number',r.vi_number,
   'invoice_date',r.invoice_date,'currency',r.currency,'withheld_at_record',l.withheld_at_record::text,
   'withheld_current',r.withheld_amount::text,'difference',(l.withheld_at_record-r.withheld_amount)::text,
   'pph_type_at_record',l.pph_type_at_record,'type_source',l.type_source,'released_at',l.released_at,
   'coverage_state',r.coverage_state
 ) order by r.invoice_id),'[]'::jsonb)
 into b from public.vendor_withholding_slip_bills l
 left join public.vendor_withholding_bill_register r on r.invoice_id=l.invoice_id
 where l.slip_id=p_slip_id;
 return jsonb_build_object(
   'header',to_jsonb(h)-'tax_base'-'withheld_amount'||jsonb_build_object(
     'tax_base',h.tax_base::text,'withheld_amount',h.withheld_amount::text,'void_reason',reason
   ),
   'bills',b
 );
end $$;
revoke all on function public.get_vendor_withholding_slip(uuid) from public,anon;
grant execute on function public.get_vendor_withholding_slip(uuid) to authenticated;

do $$ begin
 if not has_function_privilege('authenticated','public.get_vendor_withholding_slip(uuid)','EXECUTE')
    or has_function_privilege('anon','public.get_vendor_withholding_slip(uuid)','EXECUTE') then
   raise exception '0282: unexpected get_vendor_withholding_slip grants';
 end if;
 if (select prosecdef from pg_proc where oid='public.get_vendor_withholding_slip(uuid)'::regprocedure) then
   raise exception '0282: detail read must remain SECURITY INVOKER';
 end if;
end $$;
