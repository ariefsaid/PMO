-- 1670_features_on_by_default.sql: new features are ON by default for every organisation, grouped under five module switches
-- drops: set_purchase_types_enabled, set_payment_channel_settings and set_purchase_line_planning move their inline starter-row seeding into the seeder functions defined here and call them; the seeded rows and every guard stay.
-- an Admin can turn off (owner, 22 Nov 2026).
--
-- 1. The 17 "pile 1" switches become ON by default and ON for every existing organisation. Nothing is dropped: each switch, its
--    setter and its database guards stay.
--      organizations columns: built_in_roles_enabled, clearance_checklist_enabled, leave_requests_enabled, crew_loans_enabled,
--        discipline_profit_enabled, performance_indices_enabled, stock_wo_transfers, stock_reservations, purchase_line_planning,
--        safety_records_enabled
--      settings tables (a missing row read as off, so every organisation now gets a row): idle_cost_settings.enabled,
--        org_revenue_plan_settings.enabled, org_purchase_type_settings.enabled, org_payment_channel_settings.enabled,
--        issue_closing_report_settings.enabled, purchase_order_settings.print_enabled, material_request_settings.delivery_note_enabled
-- 2. Starter rows that turning a switch on seeds (2 line categories, 3 purchase types, 4 payment channels) now come from three
--    functions the setters call (the setters are restated to call them), and the same functions seed existing organisations here.
--    New organisations: an AFTER INSERT trigger on organizations writes the seven settings rows and calls the seeders.
-- 3. Five module switches on organizations: module_people_crews, module_site_day, module_stock, module_purchasing_extras,
--    module_billing_extras (default true; Admin writes them under the column grant). A module hides its screens (UI only, no database
--    guard). The "pile 2" settings are unchanged and stay off.
-- 4. Existing organisations at migration time: a module is turned OFF for an organisation with NO rows in any of the module's own tables
--    (listed below), ON otherwise. Worked out BEFORE the starter rows are seeded, so seeding cannot turn a module on.
--      module_people_crews:       crews, crew_loans, leave_types, leave_requests, clearance_items, person_clearances, phone_check_ins
--      module_site_day:          daily_site_reports, site_checkpoints, safety_days, safety_list_items
--      module_stock:             stock_documents, stock_transfers, stock_wo_transfers, stock_reservations, material_requests
--      module_purchasing_extras: purchase_types, purchase_line_categories, org_payment_channels
--      module_billing_extras:    work_order_revenue_plan, billing_plan_month_targets, done_not_claimed_notices, cost_disciplines
--    A fresh local database runs this with no rows, so seed.sql turns the modules on for its organisation.
-- The backfill writes no audit lines (it is a release change, not an Admin's); the audit trigger gains the five module columns.
-- 5. The new rows would block deleting an organisation, so the foreign keys from the settings and starter-row tables to organizations
--    become ON DELETE CASCADE (the rollback leaves them cascading).
-- Rollback: rollback/1670_features_on_by_default_down.sql restores the old defaults and the old setter bodies; it does not restore
-- per-organisation values.

-- ── module switches (computed first) ─────────────────────────────────────────────────────────────────────────────────────
alter table public.organizations
  add column module_people_crews boolean not null default true,
  add column module_site_day boolean not null default true,
  add column module_stock boolean not null default true,
  add column module_purchasing_extras boolean not null default true,
  add column module_billing_extras boolean not null default true;
grant update (module_people_crews, module_site_day, module_stock, module_purchasing_extras, module_billing_extras)
  on public.organizations to authenticated;

-- One organisation's five modules from its own rows (the lists in the header). Used once here, kept so a test can prove it.
create function public.backfill_org_modules(p_org uuid) returns void
  language sql security definer set search_path = public, pg_catalog as $$
  update public.organizations o set
    module_people_crews = exists (select 1 from public.crews x where x.org_id = o.id)
      or exists (select 1 from public.crew_loans x where x.org_id = o.id)
      or exists (select 1 from public.leave_types x where x.org_id = o.id)
      or exists (select 1 from public.leave_requests x where x.org_id = o.id)
      or exists (select 1 from public.clearance_items x where x.org_id = o.id)
      or exists (select 1 from public.person_clearances x where x.org_id = o.id)
      or exists (select 1 from public.phone_check_ins x where x.org_id = o.id),
    module_site_day = exists (select 1 from public.daily_site_reports x where x.org_id = o.id)
      or exists (select 1 from public.site_checkpoints x where x.org_id = o.id)
      or exists (select 1 from public.safety_days x where x.org_id = o.id)
      or exists (select 1 from public.safety_list_items x where x.org_id = o.id),
    module_stock = exists (select 1 from public.stock_documents x where x.org_id = o.id)
      or exists (select 1 from public.stock_transfers x where x.org_id = o.id)
      or exists (select 1 from public.stock_wo_transfers x where x.org_id = o.id)
      or exists (select 1 from public.stock_reservations x where x.org_id = o.id)
      or exists (select 1 from public.material_requests x where x.org_id = o.id),
    module_purchasing_extras = exists (select 1 from public.purchase_types x where x.org_id = o.id)
      or exists (select 1 from public.purchase_line_categories x where x.org_id = o.id)
      or exists (select 1 from public.org_payment_channels x where x.org_id = o.id),
    module_billing_extras = exists (select 1 from public.work_order_revenue_plan x where x.org_id = o.id)
      or exists (select 1 from public.billing_plan_month_targets x where x.org_id = o.id)
      or exists (select 1 from public.done_not_claimed_notices x where x.org_id = o.id)
      or exists (select 1 from public.cost_disciplines x where x.org_id = o.id)
  where o.id = p_org $$;
revoke all on function public.backfill_org_modules(uuid) from public, anon, authenticated;

alter table public.organizations disable trigger zz_audit_org_setting_change;
select public.backfill_org_modules(id) from public.organizations;

-- ── starter rows: one function each; the setters call them (restated below) ──────────────────────────────────────────────
create function public.seed_purchase_line_categories(p_org uuid) returns void
  language sql security definer set search_path = public, pg_catalog as $$
  -- Only when the organisation has no category at all (idempotent; never after an Admin has edited the list).
  insert into public.purchase_line_categories (org_id, name, position)
  select p_org, v.name, v.position from (values ('Project', 1), ('Overhead', 2)) v(name, position)
   where not exists (select 1 from public.purchase_line_categories where org_id = p_org) $$;

create function public.seed_purchase_types(p_org uuid) returns void
  language sql security definer set search_path = pg_catalog, public as $$
  insert into public.purchase_types (org_id, name, name_id, is_rental, position)
  select p_org, v.name, v.name_id, v.is_rental, v.position
    from (values ('Goods', 'Barang', false, 1), ('Service', 'Jasa', false, 2), ('Rental', 'Sewa', true, 3)) v(name, name_id, is_rental, position)
   where not exists (select 1 from public.purchase_types where org_id = p_org)
  on conflict do nothing $$;

create function public.seed_payment_channels(p_org uuid, p_by uuid default null) returns void
  language sql security definer set search_path = public, pg_catalog as $$
  insert into public.org_payment_channels (org_id, name, sort_order, created_by)
  select p_org, v.name, v.sort_order, p_by
    from (values ('Bank transfer', 1), ('Cash', 2), ('Cheque', 3), ('Card', 4)) v(name, sort_order)
   where not exists (select 1 from public.org_payment_channels where org_id = p_org) $$;
revoke all on function public.seed_purchase_line_categories(uuid), public.seed_purchase_types(uuid),
  public.seed_payment_channels(uuid, uuid) from public, anon, authenticated;

-- Setters restated from 1345 / 1350 / 1356 with the starter-row insert replaced by the seeder call. Nothing else changes.
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
  if p_enabled then perform public.seed_purchase_line_categories(v_org); end if;
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
  if p_enabled then perform public.seed_purchase_types(v_org); end if;
end $$;
revoke all on function public.set_purchase_types_enabled(boolean) from public, anon;
grant execute on function public.set_purchase_types_enabled(boolean) to authenticated;

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
  if p_enabled then perform public.seed_payment_channels(v_org, v_uid); end if;
  perform public.log_audit('payment_channel.settings', v_org, v_uid, v_org, jsonb_build_object(
    'from', case when v_old.org_id is null then null else jsonb_build_object('enabled', v_old.enabled) end,
    'to', jsonb_build_object('enabled', v_row.enabled)));
  return v_row;
end $$;
revoke all on function public.set_payment_channel_settings(boolean) from public, anon;
grant execute on function public.set_payment_channel_settings(boolean) to authenticated;

-- ── the 17 switches: default ON, and ON for every existing organisation ──────────────────────────────────────────────────
alter table public.organizations
  alter column built_in_roles_enabled set default true, alter column clearance_checklist_enabled set default true,
  alter column leave_requests_enabled set default true, alter column crew_loans_enabled set default true,
  alter column discipline_profit_enabled set default true, alter column performance_indices_enabled set default true,
  alter column stock_wo_transfers set default true, alter column stock_reservations set default true,
  alter column purchase_line_planning set default true, alter column safety_records_enabled set default true;
update public.organizations set
  built_in_roles_enabled = true, clearance_checklist_enabled = true, leave_requests_enabled = true, crew_loans_enabled = true,
  discipline_profit_enabled = true, performance_indices_enabled = true, stock_wo_transfers = true, stock_reservations = true,
  purchase_line_planning = true, safety_records_enabled = true;
alter table public.organizations enable trigger zz_audit_org_setting_change;

-- The payment-channel settings row had to name a person; a system row has none.
alter table public.org_payment_channel_settings alter column updated_by drop not null;

alter table public.idle_cost_settings alter column enabled set default true;
alter table public.org_revenue_plan_settings alter column enabled set default true;
alter table public.org_purchase_type_settings alter column enabled set default true;
alter table public.org_payment_channel_settings alter column enabled set default true;
alter table public.issue_closing_report_settings alter column enabled set default true;
alter table public.purchase_order_settings alter column print_enabled set default true;
alter table public.material_request_settings alter column delivery_note_enabled set default true;

-- Every organisation now owns rows in these tables from its first moment, so deleting an organisation must take them along:
-- their foreign keys to organizations become ON DELETE CASCADE (those that already cascade are left alone).
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname, a.attname
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.organizations'::regclass and array_length(c.conkey, 1) = 1 and c.confdeltype <> 'c'
       and c.conrelid in ('public.idle_cost_settings'::regclass, 'public.org_revenue_plan_settings'::regclass,
                          'public.org_purchase_type_settings'::regclass, 'public.org_payment_channel_settings'::regclass,
                          'public.issue_closing_report_settings'::regclass, 'public.purchase_order_settings'::regclass,
                          'public.material_request_settings'::regclass, 'public.purchase_line_categories'::regclass,
                          'public.purchase_types'::regclass, 'public.org_payment_channels'::regclass)
  loop
    execute format('alter table %s drop constraint %I, add constraint %I foreign key (%I) references public.organizations(id) on delete cascade',
                   r.tbl, r.conname, r.conname, r.attname);
  end loop;
end $$;

-- One function gives an organisation its seven settings rows (on) and its starter rows. Existing organisations below; new ones by trigger.
create function public.apply_org_switch_defaults(p_org uuid) returns void
  language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  insert into public.idle_cost_settings (org_id, enabled) values (p_org, true)
    on conflict (org_id) do update set enabled = true;
  insert into public.org_revenue_plan_settings (org_id, enabled) values (p_org, true)
    on conflict (org_id) do update set enabled = true;
  insert into public.org_purchase_type_settings (org_id, enabled) values (p_org, true)
    on conflict (org_id) do update set enabled = true;
  insert into public.org_payment_channel_settings (org_id, enabled, enabled_at) values (p_org, true, now())
    on conflict (org_id) do update set enabled = true, enabled_at = coalesce(org_payment_channel_settings.enabled_at, now());
  insert into public.issue_closing_report_settings (org_id, enabled) values (p_org, true)
    on conflict (org_id) do update set enabled = true;
  insert into public.purchase_order_settings (org_id, print_enabled) values (p_org, true)
    on conflict (org_id) do update set print_enabled = true;
  insert into public.material_request_settings (org_id, delivery_note_enabled) values (p_org, true)
    on conflict (org_id) do update set delivery_note_enabled = true;
  perform public.seed_purchase_line_categories(p_org);
  perform public.seed_purchase_types(p_org);
  perform public.seed_payment_channels(p_org);
end $$;
revoke all on function public.apply_org_switch_defaults(uuid) from public, anon, authenticated;

alter table public.org_revenue_plan_settings disable trigger zz_audit_org_setting_change;
alter table public.org_purchase_type_settings disable trigger zz_audit_org_setting_change;
alter table public.issue_closing_report_settings disable trigger zz_audit_org_setting_change;
alter table public.purchase_order_settings disable trigger zz_audit_org_setting_change;
select public.apply_org_switch_defaults(id) from public.organizations;
alter table public.org_revenue_plan_settings enable trigger zz_audit_org_setting_change;
alter table public.org_purchase_type_settings enable trigger zz_audit_org_setting_change;
alter table public.issue_closing_report_settings enable trigger zz_audit_org_setting_change;
alter table public.purchase_order_settings enable trigger zz_audit_org_setting_change;

-- A settings row written by the organisation trigger above is not an Admin's change: the audit trigger skips an INSERT made from
-- inside another trigger (depth above 1). Setter RPCs and column updates run at depth 1 and are audited as before.
create or replace function public.audit_org_setting_change() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  c text;
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  n jsonb := to_jsonb(new);
  v_org uuid := coalesce((n ->> 'org_id')::uuid, (n ->> 'id')::uuid);
begin
  if tg_op = 'INSERT' and pg_trigger_depth() > 1 then return new; end if;
  foreach c in array tg_argv loop
    if (o -> c) is distinct from (n -> c) then
      perform public.log_audit('org.setting.change', v_org, auth.uid(), v_org,
        jsonb_build_object('setting', tg_table_name || '.' || c, 'from', o -> c, 'to', n -> c)
          || case when n ? 'event_key' then jsonb_build_object('event_key', n -> 'event_key') else '{}'::jsonb end);
    end if;
  end loop;
  return new;
end; $$;

create function public.organizations_switch_defaults() returns trigger
  language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  perform public.apply_org_switch_defaults(new.id);
  return new;
end $$;
revoke all on function public.organizations_switch_defaults() from public, anon, authenticated;
create trigger organizations_switch_defaults after insert on public.organizations
  for each row execute function public.organizations_switch_defaults();

-- ── audit: the module columns join the organisation audit trigger (1510) ─────────────────────────────────────────────────
drop trigger zz_audit_org_setting_change on public.organizations;
create trigger zz_audit_org_setting_change after update on public.organizations for each row
  execute function public.audit_org_setting_change(
    'quantity_change_limit', 'built_in_roles_enabled', 'phone_check_in_supervisor_role', 'hide_prices_from_requesters',
    'clearance_checklist_enabled', 'leave_requests_enabled', 'leave_approver_role', 'crew_loans_enabled',
    'discipline_profit_enabled', 'performance_indices_enabled', 'performance_band_low', 'performance_band_high',
    'stock_transfer_mode', 'stock_proof_timing', 'stock_wo_transfers', 'stock_reservations', 'reservation_borrow_mode',
    'reservation_borrow_role', 'reservation_borrow_label', 'dsr_stock_issue', 'dsr_stock_issue_items',
    'purchase_line_planning', 'safety_records_enabled', 'equipment_availability_target_pct',
    'equipment_utilisation_target_pct', 'equipment_escalation_down_days', 'attendance_target_rate',
    'module_people_crews', 'module_site_day', 'module_stock', 'module_purchasing_extras', 'module_billing_extras');
