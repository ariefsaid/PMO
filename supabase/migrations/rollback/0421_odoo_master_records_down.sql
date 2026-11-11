-- Rolls back 0421. The mirror is machine-written from Odoo; a re-apply re-reads it.
select cron.unschedule('odoo-sweep-tick');
drop function if exists public.odoo_sweep_tick();
drop function if exists public.reset_odoo_sync_kind(uuid,text,uuid);
drop function if exists public.finish_odoo_census(uuid,text,timestamptz,text);
drop function if exists public.mark_odoo_census_seen(uuid,text,timestamptz,text[]);
drop function if exists public.apply_odoo_master_page(uuid,text,jsonb,text);
drop function if exists public.assert_odoo_master_kind(text);
drop table if exists public.external_master_records;

-- discard_odoo_mirror -> migration 0420's body.
create or replace function public.discard_odoo_mirror(p_org_id uuid, p_actor_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.external_sync_watermarks where org_id = p_org_id and external_tier = 'odoo';
  delete from public.external_project_bindings where org_id = p_org_id and external_tier = 'odoo';
  delete from public.external_refs where org_id = p_org_id and external_tier = 'odoo';
  update public.external_org_bindings
     set config = config - 'odoo_company_id' - 'odoo_company_name' - 'analytic_plan_id' - 'account_defaults'
                         - 'unit_map' - 'default_warehouse_id' - 'capabilities'
   where org_id = p_org_id and external_tier = 'odoo';
  perform public.log_audit('integration.odoo.discard', p_org_id, p_actor_id, null, jsonb_build_object('tier', 'odoo'));
end $$;
revoke all on function public.discard_odoo_mirror(uuid,uuid) from public, anon, authenticated, service_role;
