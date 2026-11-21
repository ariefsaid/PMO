-- 1356_payment_channel_rpcs.sql — #2698: the only write paths for the payment channel feature. Tables in 1355.
-- Spec docs/specs/purchase-payment-channel.spec.md. Proven by supabase/tests/payment_channel.test.sql.
-- Does NOT touch create_procurement_with_items, update_procurement_header or transition_procurement.
-- Rollback: rollback/1356_payment_channel_rpcs_down.sql

-- Whether the caller's org has the feature on (internal helper; not client-callable).
create or replace function public.payment_channel_on(p_org uuid) returns boolean
  language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce((select enabled from public.org_payment_channel_settings where org_id = p_org), false)
$$;
revoke all on function public.payment_channel_on(uuid) from public, anon, authenticated;

-- Admin switch. First switch-on seeds general starter rows, only when the org has no channel row at all (live or archived).
create or replace function public.set_payment_channel_settings(p_enabled boolean)
  returns public.org_payment_channel_settings
  language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
        v_old public.org_payment_channel_settings; v_row public.org_payment_channel_settings;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin sets the payment channel feature' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'the payment channel feature needs on or off' using errcode = '22023';
  end if;
  select * into v_old from public.org_payment_channel_settings where org_id = v_org for update;
  insert into public.org_payment_channel_settings (org_id, enabled, enabled_at, updated_by, updated_at)
  values (v_org, p_enabled, case when p_enabled then now() end, v_uid, now())
  on conflict (org_id) do update set
    enabled = excluded.enabled,
    enabled_at = case when excluded.enabled and not org_payment_channel_settings.enabled then excluded.enabled_at
                      else org_payment_channel_settings.enabled_at end,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into v_row;
  if p_enabled and not exists (select 1 from public.org_payment_channels where org_id = v_org) then
    insert into public.org_payment_channels (org_id, name, sort_order, created_by)
    values (v_org, 'Bank transfer', 1, v_uid), (v_org, 'Cash', 2, v_uid), (v_org, 'Cheque', 3, v_uid), (v_org, 'Card', 4, v_uid);
  end if;
  perform public.log_audit('payment_channel.settings', v_org, v_uid, v_org, jsonb_build_object(
    'from', case when v_old.org_id is null then null else jsonb_build_object('enabled', v_old.enabled) end,
    'to', jsonb_build_object('enabled', v_row.enabled)));
  return v_row;
end $$;
revoke all on function public.set_payment_channel_settings(boolean) from public, anon;
grant execute on function public.set_payment_channel_settings(boolean) to authenticated;

-- Admin adds (null id) or renames a channel.
create or replace function public.save_payment_channel(p_id uuid, p_name text)
  returns public.org_payment_channels
  language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
        v_name text := btrim(coalesce(p_name, '')); v_row public.org_payment_channels;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' or not public.payment_channel_on(v_org) then
    raise exception 'only an Admin manages payment channels, and only while the feature is on' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'a payment channel name is 1 to 60 characters' using errcode = '22023';
  end if;
  if exists (select 1 from public.org_payment_channels
              where org_id = v_org and archived_at is null and lower(name) = lower(v_name) and id is distinct from p_id) then
    raise exception 'a payment channel with this name already exists' using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.org_payment_channels (org_id, name, sort_order, created_by)
    values (v_org, v_name, coalesce((select max(sort_order) from public.org_payment_channels where org_id = v_org), 0) + 1, v_uid)
    returning * into v_row;
  else
    update public.org_payment_channels set name = v_name where id = p_id and org_id = v_org returning * into v_row;
    if not found then raise exception 'payment channel not found' using errcode = '42501'; end if;
  end if;
  perform public.log_audit('payment_channel.saved', v_org, v_uid, v_row.id, jsonb_build_object('name', v_row.name));
  return v_row;
end $$;
revoke all on function public.save_payment_channel(uuid, text) from public, anon;
grant execute on function public.save_payment_channel(uuid, text) to authenticated;

-- Admin archives or restores a channel. Requests that carry it keep it.
create or replace function public.archive_payment_channel(p_id uuid, p_archived boolean)
  returns public.org_payment_channels
  language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_row public.org_payment_channels;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' or not public.payment_channel_on(v_org) then
    raise exception 'only an Admin manages payment channels, and only while the feature is on' using errcode = '42501';
  end if;
  if p_archived is null then raise exception 'archive needs true or false' using errcode = '22023'; end if;
  update public.org_payment_channels set archived_at = case when p_archived then coalesce(archived_at, now()) end
   where id = p_id and org_id = v_org returning * into v_row;
  if not found then raise exception 'payment channel not found' using errcode = '42501'; end if;
  perform public.log_audit('payment_channel.archived', v_org, v_uid, v_row.id, jsonb_build_object('archived', p_archived));
  return v_row;
end $$;
revoke all on function public.archive_payment_channel(uuid, boolean) from public, anon;
grant execute on function public.archive_payment_channel(uuid, boolean) to authenticated;

-- Set or clear the channel on a request. Who may (D-PCH-4, owner ruling 2026-11-21):
--   (a) the existing header-edit rule (0393): the requester or an Admin while the request is Draft or Rejected; or
--   (b) Finance or an Admin at any status until the request is Paid or Cancelled.
-- Not an amount, so no separation of duties. Every change is audited. Off while the feature is off.
create or replace function public.set_procurement_payment_channel(p_id uuid, p_channel_id uuid)
  returns boolean
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_role text := public.auth_role();
  v_case public.procurements%rowtype;
begin
  if v_uid is null or v_org is null or not public.is_active_member()
     or not public.org_feature_enabled(v_org, 'procurement')
     or not public.payment_channel_on(v_org) then
    raise exception 'Payment channel edit is not permitted' using errcode = '42501';
  end if;
  select * into v_case from public.procurements where id = p_id and org_id = v_org for update;
  if not found
     or not (
       (v_case.status in ('Draft', 'Rejected') and (v_case.requested_by_id is not distinct from v_uid or v_role = 'Admin'))
       or (v_role in ('Finance', 'Admin') and v_case.status not in ('Paid', 'Cancelled'))
     ) then
    raise exception 'Payment channel edit is not permitted' using errcode = '42501';
  end if;
  if p_channel_id is not null and not exists (
       select 1 from public.org_payment_channels c
        where c.id = p_channel_id and c.org_id = v_org and c.archived_at is null) then
    raise exception 'Payment channel is not available' using errcode = '42501';
  end if;
  if v_case.payment_channel_id is distinct from p_channel_id then
    update public.procurements set payment_channel_id = p_channel_id where id = v_case.id and org_id = v_org;
    perform public.log_audit('procurement.payment_channel', v_org, v_uid, v_case.id, jsonb_build_object(
      'from', v_case.payment_channel_id, 'to', p_channel_id));
  end if;
  return true;
end $$;
revoke all on function public.set_procurement_payment_channel(uuid, uuid) from public, anon;
grant execute on function public.set_procurement_payment_channel(uuid, uuid) to authenticated;
