-- Down for 0741: the 0494 body (the project link is read from the ERPNext map for every tier).
create or replace function public.connect_send_existing_link(p_org_id uuid, p_tier text, p_kind text, p_pmo text) returns text
language sql security definer set search_path = public, pg_temp as $$
  select case p_kind
    when 'party' then (select r.external_record_id from public.external_refs r
                        where r.org_id = p_org_id and r.domain = 'companies' and r.pmo_record_id = p_pmo)
    when 'project' then (select b.config->'project_map'->>p_pmo from public.external_org_bindings b
                          where b.org_id = p_org_id and b.external_tier = p_tier and b.status = 'active')
    when 'item' then (select b.config->'item_map'->>p_pmo from public.external_org_bindings b
                       where b.org_id = p_org_id and b.external_tier = p_tier and b.status = 'active')
  end
$$;
