-- 0851_odoo_equipment_mirror.sql (#1511 F2): the Odoo fleet and maintenance kinds join the directory mirror (no new table).
--   1. kind check + assert_odoo_master_kind widened by seven kinds (0509 pattern).
--   2. apply_odoo_master_rows — the row half of apply_odoo_master_page, service-role only; a row may carry the PMO id
--      it was made under (a PMO-created record), and a vehicle / equipment row renames or archives the PMO asset linked
--      to it (name follows Odoo, archive is one way, the code never changes).
--   3. apply_odoo_master_page — same signature, now rows via apply_odoo_master_rows + the cursor.
--   4. finish_odoo_census — 0421 body, plus: a vehicle / equipment removed from Odoo archives its linked PMO asset.
--   5. parent index for the per-asset maintenance list.
-- Reversal: rollback/0851_odoo_equipment_mirror_down.sql.
-- ── REVERSE ─────────────────────────────────────────────────────────────────────────────────────────────
--   restore 0421's apply_odoo_master_page and finish_odoo_census bodies; drop apply_odoo_master_rows, odoo_pmo_id, the
--   parent index; delete the seven new kinds' rows and cursors; restore 0509's kind check and assert_odoo_master_kind.

alter table public.external_master_records drop constraint external_master_records_kind_check;
alter table public.external_master_records add constraint external_master_records_kind_check
  check (kind in ('company','partner','product','uom','warehouse','location','account','tax','analytic_plan','analytic_account','journal',
                  'vehicle','vehicle_model','equipment','maintenance_request','maintenance_stage','vehicle_service','service_type'));

-- Keep in step with the table's kind check, DIRECTORY_KINDS in adapterSeam/odoo/kinds.ts and ASSET_KINDS in odoo/assets/kinds.ts.
create or replace function public.assert_odoo_master_kind(p_kind text) returns void
language plpgsql immutable set search_path = public as $$
begin
  if p_kind is null or p_kind not in ('company','partner','product','uom','warehouse','location',
                                      'account','tax','analytic_plan','analytic_account','journal',
                                      'vehicle','vehicle_model','equipment','maintenance_request','maintenance_stage','vehicle_service','service_type') then
    raise exception 'unknown Odoo kind' using errcode = '22023';
  end if;
end $$;

create index external_master_records_parent_idx on public.external_master_records (org_id, kind, parent_external_id)
  where parent_external_id is not null;

create function public.odoo_pmo_id(p_text text) returns uuid
language plpgsql immutable set search_path = public as $$
begin
  if p_text is null or p_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'bad PMO id' using errcode = '22023';
  end if;
  return p_text::uuid;
end $$;
revoke all on function public.odoo_pmo_id(text) from public, anon, authenticated;

create function public.apply_odoo_master_rows(p_org_id uuid, p_kind text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  perform public.assert_odoo_master_kind(p_kind);
  insert into public.external_master_records as m
    (id, org_id, external_tier, kind, external_id, code, name, parent_external_id, active, attrs, source_write_date, as_of, tombstoned_at)
  select case when r ? 'pmo_id' then public.odoo_pmo_id(r->>'pmo_id') else gen_random_uuid() end,
         p_org_id, 'odoo', p_kind, r->>'external_id', r->>'code', r->>'name', r->>'parent_external_id',
         coalesce((r->>'active')::boolean, true), coalesce(r->'attrs', '{}'::jsonb), r->>'source_write_date', now(), null
    from jsonb_array_elements(p_rows) r
  on conflict (org_id, external_tier, kind, external_id) do update set
    code = excluded.code, name = excluded.name, parent_external_id = excluded.parent_external_id, active = excluded.active,
    attrs = excluded.attrs, source_write_date = excluded.source_write_date, as_of = now(), tombstoned_at = null
  where m.source_write_date <= excluded.source_write_date;   -- never older over newer (FR-ODC-042)
  get diagnostics v_n = row_count;
  if p_kind in ('vehicle', 'equipment') then
    -- FR-OFM-012 / D10: name follows Odoo; archived (or removed) in Odoo archives the PMO asset, never the reverse; the code is untouched.
    update public.equipment_assets a
       set name = left(btrim(m.name), 120),
           archived_at = case when m.active and m.tombstoned_at is null then a.archived_at else coalesce(a.archived_at, now()) end
      from public.external_master_records m
     where m.org_id = p_org_id and m.external_tier = 'odoo' and m.kind = p_kind
       and m.external_id in (select r->>'external_id' from jsonb_array_elements(p_rows) r)
       and a.org_id = p_org_id and a.external_tier = 'odoo' and a.external_ref = p_kind || ':' || m.external_id;
  end if;
  return v_n;
end $$;
revoke all on function public.apply_odoo_master_rows(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_odoo_master_rows(uuid,text,jsonb) to service_role;

create or replace function public.apply_odoo_master_page(p_org_id uuid, p_kind text, p_rows jsonb, p_cursor text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  v_n := public.apply_odoo_master_rows(p_org_id, p_kind, p_rows);
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
  if p_kind in ('vehicle', 'equipment') then
    -- FR-OFM-012: a record removed from Odoo archives its PMO asset.
    update public.equipment_assets a set archived_at = coalesce(a.archived_at, now())
      from public.external_master_records m
     where m.org_id = p_org_id and m.external_tier = 'odoo' and m.kind = p_kind and m.tombstoned_at is not null
       and a.org_id = p_org_id and a.external_tier = 'odoo' and a.external_ref = p_kind || ':' || m.external_id and a.archived_at is null;
  end if;
  update public.external_sync_watermarks set watermark_cursor = p_cursor, updated_at = now()
   where org_id = p_org_id and external_tier = 'odoo' and domain = 'master:' || p_kind;
  return v_n;
end $$;
revoke all on function public.finish_odoo_census(uuid,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.finish_odoo_census(uuid,text,timestamptz,text) to service_role;

do $$ begin
  if has_function_privilege('authenticated', 'public.apply_odoo_master_rows(uuid,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.apply_odoo_master_rows(uuid,text,jsonb)', 'execute') then
    raise exception 'apply_odoo_master_rows must be service-role only';
  end if;
end $$;
