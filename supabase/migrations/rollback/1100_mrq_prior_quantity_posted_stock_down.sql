-- Reverse of 1100: the 1001 definition.
create or replace function public.mrq_prior_quantity(p_work_order_id uuid, p_item_id uuid, p_exclude_request uuid) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(l.quantity), 0)
    from public.material_request_lines l
    join public.material_requests r on r.id = l.request_id
   where r.work_order_id = p_work_order_id and l.item_id = p_item_id and r.id <> p_exclude_request
     and r.status in ('pending','approved','fulfilled')
$$;
