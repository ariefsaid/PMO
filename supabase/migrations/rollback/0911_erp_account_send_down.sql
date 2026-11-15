-- Reverses 0911_erp_account_send.sql. Queued account sends are dismissed first so the drain never claims a kind it no longer links;
-- accounts already created in the ERP and their budget_category_account_map rows stay (they are ordinary mappings).
update public.erp_connect_proposals set state = 'dismissed' where kind = 'account' and outcome = 'send' and state = 'sending';
drop function if exists public.request_account_send(text, text, text, text);
drop function if exists public.account_send_groups(text);
-- connect_send_existing_link as 0741 shipped it
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
