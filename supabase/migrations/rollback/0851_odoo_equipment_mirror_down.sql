-- Reverses 0851_odoo_equipment_mirror.sql: 0421's page and census bodies return, the row writer and PMO-id helper go, and
-- rows of the seven asset kinds are removed first (the kind check could not be restored otherwise); the sweep refills them
-- if the migration is re-applied. PMO assets already renamed or archived from the feed keep that state (data).
delete from public.external_master_records where kind in ('vehicle','vehicle_model','equipment','maintenance_request','maintenance_stage','vehicle_service','service_type');
delete from public.external_sync_watermarks where external_tier = 'odoo' and domain in
  ('master:vehicle','master:vehicle_model','master:equipment','master:maintenance_request','master:maintenance_stage','master:vehicle_service','master:service_type');
drop index if exists public.external_master_records_parent_idx;

create or replace function public.apply_odoo_master_page(p_org_id uuid, p_kind text, p_rows jsonb, p_cursor text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  perform public.assert_odoo_master_kind(p_kind);
  insert into public.external_master_records as m
    (org_id, external_tier, kind, external_id, code, name, parent_external_id, active, attrs, source_write_date, as_of, tombstoned_at)
  select p_org_id, 'odoo', p_kind, r->>'external_id', r->>'code', r->>'name', r->>'parent_external_id',
         coalesce((r->>'active')::boolean, true), coalesce(r->'attrs', '{}'::jsonb), r->>'source_write_date', now(), null
    from jsonb_array_elements(p_rows) r
  on conflict (org_id, external_tier, kind, external_id) do update set
    code = excluded.code, name = excluded.name, parent_external_id = excluded.parent_external_id, active = excluded.active,
    attrs = excluded.attrs, source_write_date = excluded.source_write_date, as_of = now(), tombstoned_at = null
  where m.source_write_date <= excluded.source_write_date;
  get diagnostics v_n = row_count;
  insert into public.external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at)
  values (p_org_id, 'odoo', 'master:' || p_kind, p_cursor, now())
  on conflict (org_id, external_tier, domain) do update set watermark_cursor = excluded.watermark_cursor, updated_at = now();
  return v_n;
end $$;
revoke all on function public.apply_odoo_master_page(uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.apply_odoo_master_page(uuid,text,jsonb,text) to service_role;

create or replace function public.finish_odoo_census(p_org_id uuid, p_kind text, p_run timestamptz, p_cursor text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  perform public.assert_odoo_master_kind(p_kind);
  update public.external_master_records set tombstoned_at = now()
   where org_id = p_org_id and external_tier = 'odoo' and kind = p_kind and tombstoned_at is null
     and (census_seen_at is null or census_seen_at < p_run);
  get diagnostics v_n = row_count;
  update public.external_sync_watermarks set watermark_cursor = p_cursor, updated_at = now()
   where org_id = p_org_id and external_tier = 'odoo' and domain = 'master:' || p_kind;
  return v_n;
end $$;
revoke all on function public.finish_odoo_census(uuid,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.finish_odoo_census(uuid,text,timestamptz,text) to service_role;

drop function if exists public.apply_odoo_master_rows(uuid,text,jsonb);
drop function if exists public.odoo_pmo_id(text);

alter table public.external_master_records drop constraint external_master_records_kind_check;
alter table public.external_master_records add constraint external_master_records_kind_check
  check (kind in ('company','partner','product','uom','warehouse','location','account','tax','analytic_plan','analytic_account','journal'));
create or replace function public.assert_odoo_master_kind(p_kind text) returns void
language plpgsql immutable set search_path = public as $$
begin
  if p_kind is null or p_kind not in ('company','partner','product','uom','warehouse','location',
                                      'account','tax','analytic_plan','analytic_account','journal') then
    raise exception 'unknown Odoo kind' using errcode = '22023';
  end if;
end $$;
