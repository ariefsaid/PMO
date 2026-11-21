-- 1444_purchase_order_print.sql — #2688 printable purchase order settings and collectors
-- Spec docs/specs/purchase-order-print.spec.md · plan docs/plans/2026-11-21-purchase-order-print.md.
--
-- Adds:
--   1. check_collector_names_bounded & check_signature_blocks_bounded validation helpers
--   2. purchase_order_settings table with RLS, triggers, and bounds constraints
--   3. po_set_print_settings security-definer RPC (Admin only)
--
-- Reversal: supabase/migrations/rollback/1444_purchase_order_print_down.sql

-- 1. Helper functions to enforce client-entered list bounds
create or replace function public.check_collector_names_bounded(names text[])
returns boolean language sql immutable as $$
  select names is null or (
    cardinality(names) <= 50
    and not exists (
      select 1
      from unnest(names) as n
      where n is null or length(btrim(n)) = 0 or length(n) > 100
    )
  );
$$;

create or replace function public.check_signature_blocks_bounded(blocks text[])
returns boolean language sql immutable as $$
  select blocks is null or (
    cardinality(blocks) <= 10
    and not exists (
      select 1
      from unnest(blocks) as b
      where b is null or length(btrim(b)) = 0 or length(b) > 80
    )
  );
$$;

-- 2. Create purchase_order_settings table
create table if not exists public.purchase_order_settings (
  org_id                 uuid primary key references public.organizations(id) on delete cascade default '00000000-0000-0000-0000-000000000001',
  print_enabled          boolean not null default false,
  signature_blocks       text[] not null default array['Prepared by', 'Approved by', 'Vendor acceptance'],
  authorised_collectors  text[] not null default array[]::text[],
  updated_by             uuid references public.profiles(id),
  updated_at             timestamptz not null default now(),
  constraint purchase_order_settings_collectors_check check (public.check_collector_names_bounded(authorised_collectors)),
  constraint purchase_order_settings_signature_blocks_check check (public.check_signature_blocks_bounded(signature_blocks))
);

comment on table public.purchase_order_settings is
  '#2688: client settings for printable purchase orders, including authorized collectors and signature blocks.';

-- RLS policies
alter table public.purchase_order_settings enable row level security;
alter table public.purchase_order_settings force row level security;

create policy purchase_order_settings_select on public.purchase_order_settings
  for select using (org_id = (select public.auth_org_id()));

create policy purchase_order_settings_insert on public.purchase_order_settings
  for insert with check (
    org_id = (select public.auth_org_id())
    and (select public.auth_role()) = 'Admin'
  );

create policy purchase_order_settings_update on public.purchase_order_settings
  for update using (
    org_id = (select public.auth_org_id())
    and (select public.auth_role()) = 'Admin'
  );

create policy purchase_order_settings_delete on public.purchase_order_settings
  for delete using (
    org_id = (select public.auth_org_id())
    and (select public.auth_role()) = 'Admin'
  );

-- Stamp org_id trigger
create trigger purchase_order_settings_stamp_org_id
  before insert on public.purchase_order_settings
  for each row execute function public.stamp_org_id();

grant select, insert, update, delete on public.purchase_order_settings to authenticated;
grant all on public.purchase_order_settings to service_role;

-- 3. Security-definer RPC for Admin to update purchase order print settings
create or replace function public.po_set_print_settings(
  p_enabled boolean,
  p_signature_blocks text[],
  p_authorised_collectors text[]
) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_uid uuid := auth.uid();
  v_blocks text[];
  v_collectors text[];
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'PO_ADMIN_ONLY: only an Admin can change purchase order print settings' using errcode = '42501';
  end if;

  if p_signature_blocks is null or cardinality(p_signature_blocks) = 0 then
    v_blocks := array['Prepared by', 'Approved by', 'Vendor acceptance'];
  else
    v_blocks := p_signature_blocks;
  end if;

  v_collectors := coalesce(p_authorised_collectors, array[]::text[]);

  if not public.check_collector_names_bounded(v_collectors) then
    raise exception 'PO_INVALID_COLLECTORS: collector names must not exceed 50 entries and each between 1 and 100 characters' using errcode = '22023';
  end if;

  if not public.check_signature_blocks_bounded(v_blocks) then
    raise exception 'PO_INVALID_SIGNATURE_BLOCKS: signature blocks must not exceed 10 entries and each between 1 and 80 characters' using errcode = '22023';
  end if;

  insert into public.purchase_order_settings (
    org_id, print_enabled, signature_blocks, authorised_collectors, updated_by, updated_at
  )
  values (v_org, coalesce(p_enabled, false), v_blocks, v_collectors, v_uid, now())
  on conflict (org_id) do update set
    print_enabled = excluded.print_enabled,
    signature_blocks = excluded.signature_blocks,
    authorised_collectors = excluded.authorised_collectors,
    updated_by = excluded.updated_by,
    updated_at = now();

  perform public.log_audit(
    'purchase_order.print_settings_set',
    v_org,
    v_uid,
    null,
    jsonb_build_object(
      'enabled', coalesce(p_enabled, false),
      'signature_blocks', to_jsonb(v_blocks),
      'authorised_collectors', to_jsonb(v_collectors)
    )
  );
end $$;

revoke all on function public.po_set_print_settings(boolean, text[], text[]) from public, anon, authenticated;
grant execute on function public.po_set_print_settings(boolean, text[], text[]) to authenticated;
