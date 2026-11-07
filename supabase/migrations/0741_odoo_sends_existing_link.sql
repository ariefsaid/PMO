-- #1504 S8-T5: `connect_send_existing_link` answered a project's link only from the ERPNext map (`config.project_map`). An Odoo project is linked
-- in `external_project_bindings`, so a project that was already linked to a cost account looked unlinked and a queued send could create a
-- second one. The Odoo arm reads that table; every other branch is byte for byte what 0494 shipped. Same signature, same grants (replace).
create or replace function public.connect_send_existing_link(p_org_id uuid, p_tier text, p_kind text, p_pmo text) returns text
language sql security definer set search_path = public, pg_temp as $$
  select case p_kind
    when 'party' then (select r.external_record_id from public.external_refs r
                        where r.org_id = p_org_id and r.domain = 'companies' and r.pmo_record_id = p_pmo)
    when 'project' then case when p_tier = 'odoo'
                          then (select b.external_container_id from public.external_project_bindings b
                                 where b.org_id = p_org_id and b.external_tier = 'odoo' and b.project_id::text = p_pmo)
                          else (select b.config->'project_map'->>p_pmo from public.external_org_bindings b
                                 where b.org_id = p_org_id and b.external_tier = p_tier and b.status = 'active')
                        end
    when 'item' then (select b.config->'item_map'->>p_pmo from public.external_org_bindings b
                       where b.org_id = p_org_id and b.external_tier = p_tier and b.status = 'active')
  end
$$;
