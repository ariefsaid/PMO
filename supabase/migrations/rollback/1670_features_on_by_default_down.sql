-- Rollback of 1670_features_on_by_default.sql: restores the old defaults (off) and the old setter bodies. It does NOT restore
-- per-organisation values: organisations keep whatever each switch holds now. Settings rows and starter rows already written stay.
drop trigger if exists organizations_switch_defaults on public.organizations;
drop function if exists public.organizations_switch_defaults();
drop function if exists public.apply_org_switch_defaults(uuid);
drop function if exists public.backfill_org_modules(uuid);

alter table public.organizations
  alter column built_in_roles_enabled set default false, alter column clearance_checklist_enabled set default false,
  alter column leave_requests_enabled set default false, alter column crew_loans_enabled set default false,
  alter column discipline_profit_enabled set default false, alter column performance_indices_enabled set default false,
  alter column stock_wo_transfers set default false, alter column stock_reservations set default false,
  alter column purchase_line_planning set default false, alter column safety_records_enabled set default false;
alter table public.idle_cost_settings alter column enabled set default false;
alter table public.org_revenue_plan_settings alter column enabled set default false;
alter table public.org_purchase_type_settings alter column enabled set default false;
alter table public.org_payment_channel_settings alter column enabled set default false;
alter table public.issue_closing_report_settings alter column enabled set default false;
alter table public.purchase_order_settings alter column print_enabled set default false;
alter table public.material_request_settings alter column delivery_note_enabled set default false;
-- System rows have no person; the column wants one again, so those rows (the feature reads as off without a row) go.
delete from public.org_payment_channel_settings where updated_by is null;
alter table public.org_payment_channel_settings alter column updated_by set not null;

-- Old setter bodies (1345, 1350, 1356).
create or replace function public.set_purchase_line_planning(p_enabled boolean) returns boolean
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_old boolean;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'Only an Admin can change purchase rules.' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'The setting is on or off.' using errcode = '22023';
  end if;
  select purchase_line_planning into v_old from public.organizations where id = v_org for update;
  update public.organizations set purchase_line_planning = p_enabled where id = v_org;
  -- Starter rows only when the organisation has no category at all (idempotent; never after an Admin has edited the list).
  if p_enabled and not exists (select 1 from public.purchase_line_categories where org_id = v_org) then
    insert into public.purchase_line_categories (org_id, name, position) values (v_org, 'Project', 1), (v_org, 'Overhead', 2);
  end if;
  perform public.log_audit('organization.purchase_line_planning', v_org, auth.uid(), v_org,
    jsonb_build_object('from', v_old, 'to', p_enabled));
  return p_enabled;
end $$;
revoke all on function public.set_purchase_line_planning(boolean) from public, anon;
grant execute on function public.set_purchase_line_planning(boolean) to authenticated;
create or replace function public.set_purchase_types_enabled(p_enabled boolean) returns void
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.auth_org_id();
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'PTYPE_ADMIN_ONLY: only an Admin can change purchase types' using errcode = '42501';
  end if;
  if p_enabled is null then raise exception 'PTYPE_INVALID: enabled must be true or false' using errcode = '22023'; end if;
  insert into public.org_purchase_type_settings (org_id, enabled, updated_by, updated_at)
  values (v_org, p_enabled, auth.uid(), now())
  on conflict (org_id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();
  if p_enabled and not exists (select 1 from public.purchase_types where org_id = v_org) then
    insert into public.purchase_types (org_id, name, name_id, is_rental, position) values
      (v_org, 'Goods',   'Barang', false, 1),
      (v_org, 'Service', 'Jasa',   false, 2),
      (v_org, 'Rental',  'Sewa',   true,  3)
    on conflict do nothing;
  end if;
end $$;
create or replace function public.set_payment_channel_settings(p_enabled boolean)
  returns public.org_payment_channel_settings
  language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
        v_old public.org_payment_channel_settings; v_row public.org_payment_channel_settings;
begin
  perform public.assert_not_light();
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

drop function if exists public.seed_purchase_line_categories(uuid);
drop function if exists public.seed_purchase_types(uuid);
drop function if exists public.seed_payment_channels(uuid, uuid);

-- Audit function back to the 1510 body.
create or replace function public.audit_org_setting_change() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  c text;
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  n jsonb := to_jsonb(new);
  v_org uuid := coalesce((n ->> 'org_id')::uuid, (n ->> 'id')::uuid);
begin
  foreach c in array tg_argv loop
    if (o -> c) is distinct from (n -> c) then
      perform public.log_audit('org.setting.change', v_org, auth.uid(), v_org,
        jsonb_build_object('setting', tg_table_name || '.' || c, 'from', o -> c, 'to', n -> c)
          || case when n ? 'event_key' then jsonb_build_object('event_key', n -> 'event_key') else '{}'::jsonb end);
    end if;
  end loop;
  return new;
end; $$;

-- Audit trigger back to the 1510 column list, then the module columns go.
drop trigger zz_audit_org_setting_change on public.organizations;
create trigger zz_audit_org_setting_change after update on public.organizations for each row
  execute function public.audit_org_setting_change(
    'quantity_change_limit', 'built_in_roles_enabled', 'phone_check_in_supervisor_role', 'hide_prices_from_requesters',
    'clearance_checklist_enabled', 'leave_requests_enabled', 'leave_approver_role', 'crew_loans_enabled',
    'discipline_profit_enabled', 'performance_indices_enabled', 'performance_band_low', 'performance_band_high',
    'stock_transfer_mode', 'stock_proof_timing', 'stock_wo_transfers', 'stock_reservations', 'reservation_borrow_mode',
    'reservation_borrow_role', 'reservation_borrow_label', 'dsr_stock_issue', 'dsr_stock_issue_items',
    'purchase_line_planning', 'safety_records_enabled', 'equipment_availability_target_pct',
    'equipment_utilisation_target_pct', 'equipment_escalation_down_days', 'attendance_target_rate');
alter table public.organizations
  drop column module_people_crews, drop column module_site_day, drop column module_stock,
  drop column module_purchasing_extras, drop column module_billing_extras;
