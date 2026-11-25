create or replace function public.extend_rental_procurement(p_id uuid, p_original uuid, p_from date, p_to date, p_items jsonb default null)
  returns public.procurements language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.auth_org_id(); v_o public.procurements%rowtype; v_items jsonb; v_header jsonb;
begin
  perform public.assert_not_light();
  if auth.uid() is null or v_org is null or not coalesce(public.is_active_member(), false) then
    raise exception 'Procurement creation is not permitted' using errcode = '42501';
  end if;
  if p_id is null or p_original is null or p_from is null or p_to is null then
    raise exception 'PTYPE_INVALID: an extension needs the rental and a new period' using errcode = '22023';
  end if;
  select * into v_o from public.procurements where id = p_original and org_id = v_org;
  if not found then raise exception 'PTYPE_EXT_NOT_FOUND: the rental to extend is not available' using errcode = '23503'; end if;
  v_items := coalesce(p_items, (
    select coalesce(jsonb_agg(jsonb_build_object('id', md5(p_id::text || i.id::text)::uuid, 'name', i.name,
                                                  'description', i.description, 'quantity', i.quantity, 'rate', i.rate)
                              order by i.id), '[]'::jsonb)
      from public.procurement_items i where i.procurement_id = p_original and i.org_id = v_org));
  v_header := jsonb_build_object('title', v_o.title || ' (' || p_from || ' – ' || p_to || ')', 'project_id', v_o.project_id,
      'vendor_id', v_o.vendor_id, 'budget_category', v_o.budget_category, 'is_subcontract', v_o.is_subcontract,
      'purchase_type_id', v_o.purchase_type_id, 'rental_from', p_from, 'rental_to', p_to, 'extends_procurement_id', p_original);
  return public.create_procurement_with_items(p_id, v_header, v_items);
end $$;
revoke all on function public.extend_rental_procurement(uuid, uuid, date, date, jsonb) from public, anon;
grant execute on function public.extend_rental_procurement(uuid, uuid, date, date, jsonb) to authenticated;
