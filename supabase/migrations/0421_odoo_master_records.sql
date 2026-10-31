-- 0421_odoo_master_records.sql (#1504 O1-S4)
-- The Odoo directory mirror and its sweep:
--   1. external_master_records   — machine-written mirror of Odoo directory kinds; own-org read, accounts / taxes /
--                                   partners for Admin, Executive and Finance only; no client write (FR-ODC-040/041).
--   2. apply_odoo_master_page    — upserts one page and writes that kind's cursor in the same transaction; never
--                                   older over newer (FR-ODC-042, PD-2). The only writer of a `master:*` cursor
--                                   besides the census finish and the reset.
--   3. mark_odoo_census_seen / finish_odoo_census — tombstone what Odoo no longer returns, never delete (FR-ODC-045).
--   4. reset_odoo_sync_kind      — Admin/Operator "resync from scratch" for one kind, audited (FR-ODC-048).
--   5. discard_odoo_mirror       — 0420 body plus the mirror table (PQ-9).
--   6. odoo_sweep_tick + cron    — 0102's Vault pattern for the odoo-sweep function (FR-ODC-047).
-- Reversal: rollback/0421_odoo_master_records_down.sql.

create table public.external_master_records (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                       references public.organizations(id) on delete cascade,
  external_tier      text not null,
  kind               text not null check (kind in ('company','partner','product','uom','warehouse','location',
                                                   'account','tax','analytic_plan','analytic_account')),
  external_id        text not null,
  code               text,
  name               text not null,
  parent_external_id text,
  active             boolean not null default true,
  tombstoned_at      timestamptz,
  census_seen_at     timestamptz,
  attrs              jsonb not null default '{}'::jsonb check (jsonb_typeof(attrs) = 'object'),
  source_write_date  text not null,     -- Odoo naive UTC 'YYYY-MM-DD HH:MM:SS' (fixed width, sorts as text)
  as_of              timestamptz not null default now(),
  unique (org_id, external_tier, kind, external_id)
);
create trigger external_master_records_stamp_org_id before insert or update on public.external_master_records
  for each row execute function public.stamp_org_id();
create index external_master_records_kind_idx on public.external_master_records (org_id, external_tier, kind, active);
create index external_master_records_code_idx on public.external_master_records (org_id, kind, code);
-- ponytail: no trigram name index; a directory is thousands of rows per org. Add one (pg_trgm) when search is slow.

alter table public.external_master_records enable row level security;
alter table public.external_master_records force row level security;
create policy external_master_records_select on public.external_master_records for select using (
  org_id = public.auth_org_id() and public.is_active_member()
  and (kind not in ('account','tax','partner') or public.auth_role() in ('Admin','Executive','Finance')));
-- WRITE: machine-only — no write policy and no client write grant.
revoke all on public.external_master_records from anon;
revoke insert, update, delete, truncate on public.external_master_records from authenticated;
grant select on public.external_master_records to authenticated;
grant all on public.external_master_records to service_role;

-- Keep in step with the table's kind check and MasterKind in adapterSeam/odoo/kinds.ts.
create or replace function public.assert_odoo_master_kind(p_kind text) returns void
language plpgsql immutable set search_path = public as $$
begin
  if p_kind is null or p_kind not in ('company','partner','product','uom','warehouse','location',
                                      'account','tax','analytic_plan','analytic_account') then
    raise exception 'unknown Odoo kind' using errcode = '22023';
  end if;
end $$;
revoke all on function public.assert_odoo_master_kind(text) from public, anon, authenticated;
grant execute on function public.assert_odoo_master_kind(text) to service_role;

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
  where m.source_write_date <= excluded.source_write_date;   -- never older over newer (FR-ODC-042)
  get diagnostics v_n = row_count;
  insert into public.external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at)
  values (p_org_id, 'odoo', 'master:' || p_kind, p_cursor, now())
  on conflict (org_id, external_tier, domain) do update set watermark_cursor = excluded.watermark_cursor, updated_at = now();
  return v_n;
end $$;
revoke all on function public.apply_odoo_master_page(uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.apply_odoo_master_page(uuid,text,jsonb,text) to service_role;

-- A row the census sees exists in Odoo, so seeing it also clears a tombstone (FR-ODC-045 "a returning id").
create or replace function public.mark_odoo_census_seen(p_org_id uuid, p_kind text, p_run timestamptz, p_ids text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  update public.external_master_records set census_seen_at = p_run, tombstoned_at = null
   where org_id = p_org_id and external_tier = 'odoo' and kind = p_kind and external_id = any (p_ids);
end $$;
revoke all on function public.mark_odoo_census_seen(uuid,text,timestamptz,text[]) from public, anon, authenticated;
grant execute on function public.mark_odoo_census_seen(uuid,text,timestamptz,text[]) to service_role;

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

create or replace function public.reset_odoo_sync_kind(p_org_id uuid, p_kind text, p_actor_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if p_actor_id is null or not public.is_active_member(p_actor_id) or not (
       exists (select 1 from public.profiles where id = p_actor_id and org_id = p_org_id and role = 'Admin')
       or exists (select 1 from public.platform_operators where user_id = p_actor_id)) then
    raise exception 'Admin or Operator required' using errcode = '42501';
  end if;
  perform public.assert_odoo_master_kind(p_kind);
  delete from public.external_sync_watermarks where org_id = p_org_id and external_tier = 'odoo' and domain = 'master:' || p_kind;
  perform public.log_audit('integration.odoo.reset', p_org_id, p_actor_id, null, jsonb_build_object('tier', 'odoo', 'kind', p_kind));
end $$;
revoke all on function public.reset_odoo_sync_kind(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.reset_odoo_sync_kind(uuid,text,uuid) to service_role;

-- 0420 body plus the mirror table. Callable only from finalize.
create or replace function public.discard_odoo_mirror(p_org_id uuid, p_actor_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.external_master_records where org_id = p_org_id and external_tier = 'odoo';
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

-- 0102's Vault pattern: per-environment secrets `odoo_sweep_url` + `odoo_sweep_secret` (never committed); a no-op
-- until both exist.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;
create or replace function public.odoo_sweep_tick()
returns void language plpgsql security definer set search_path = public, vault, net as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'odoo_sweep_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'odoo_sweep_secret';
  if v_url is not null and v_url <> '' and v_secret is not null and v_secret <> '' then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
      body := '{}'::jsonb
    );
  end if;
end $$;
revoke all on function public.odoo_sweep_tick() from public, anon, authenticated;
select cron.schedule('odoo-sweep-tick', '*/5 * * * *', 'select public.odoo_sweep_tick()');
