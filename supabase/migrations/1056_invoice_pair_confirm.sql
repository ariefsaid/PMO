-- Guard a reviewed invoice-pair undo with the pair and lifecycle the caller saw.
create function public.compare_and_unpair_invoice(
  p_pmo_id uuid,
  p_expected_erp_id uuid,
  p_expected_paired_at timestamptz,
  p_expected_docstatus integer,
  p_expected_cancelled_at timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  v_pmo public.sales_invoices%rowtype;
  v_erp public.sales_invoices%rowtype;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is null or public.auth_role() not in ('Admin', 'Finance') then
    raise exception 'only Finance or an Admin can unpair an invoice' using errcode = '42501';
  end if;
  select * into v_pmo from public.sales_invoices where id = p_pmo_id and org_id = v_org for update;
  if not found then
    raise exception 'invoice not found' using errcode = '23514', detail = 'pair-not-found';
  end if;
  if v_pmo.paired_erp_invoice_id is null
     or v_pmo.paired_erp_invoice_id is distinct from p_expected_erp_id
     or v_pmo.paired_at is distinct from p_expected_paired_at then
    raise exception 'pair changed; review it again' using errcode = '23514', detail = 'pair-changed';
  end if;
  select * into v_erp from public.sales_invoices where id = v_pmo.paired_erp_invoice_id and org_id = v_org for update;
  if not found or v_erp.erp_docstatus is distinct from p_expected_docstatus
     or v_erp.erp_cancelled_at is distinct from p_expected_cancelled_at then
    raise exception 'pair changed; review it again' using errcode = '23514', detail = 'pair-changed';
  end if;
  perform public.unpair_invoice(p_pmo_id);
end $$;
alter function public.compare_and_unpair_invoice(uuid, uuid, timestamptz, integer, timestamptz) owner to postgres;
revoke all on function public.compare_and_unpair_invoice(uuid, uuid, timestamptz, integer, timestamptz) from public, anon;
grant execute on function public.compare_and_unpair_invoice(uuid, uuid, timestamptz, integer, timestamptz) to authenticated;
