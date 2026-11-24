-- Receiving labels and required quality input travel with the addressed transfer.
create function public.stock_transfer_receiving_items(p_transfer uuid)
returns table(item_id uuid,item_code text,item_name text,needs_quality_check boolean,from_name text,to_name text,proof_rule text)
language sql stable security definer set search_path=public,pg_temp as $$
 select i.id,i.code,i.name,i.needs_quality_check,f.name,d.name,coalesce(g.proof_required,'none')
 from public.stock_transfers t join public.stock_transfer_lines l on l.transfer_id=t.id and l.org_id=t.org_id
 join public.stock_items i on i.id=l.item_id and i.org_id=t.org_id
 left join public.stock_tags g on g.id=i.tag_id and g.org_id=i.org_id
 join public.stock_warehouses f on f.id=t.from_warehouse_id and f.org_id=t.org_id
 join public.stock_warehouses d on d.id=t.to_warehouse_id and d.org_id=t.org_id
 where t.id=p_transfer and t.org_id=public.auth_org_id() and public.is_active_member() -- mut:receiver_org
 and (public.actor_is_light() is not true or t.to_user_id=auth.uid()) -- mut:receiver_address
$$;
revoke all on function public.stock_transfer_receiving_items(uuid) from public,anon;
grant execute on function public.stock_transfer_receiving_items(uuid) to authenticated,service_role;
