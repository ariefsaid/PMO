-- drops: no validation removed; the hire category mapping predicate now applies to organizations reading a connected ledger.
-- Native hire rates use native categories; connected ledger costing retains account mapping.
create or replace function public.equipment_costing_normalize(p_org uuid, p_setting jsonb, p_check_accounts boolean default true)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_key uuid; v_asset uuid; v_from date; v_to date; v_ev int; v_basis text;
  v_work numeric; v_standby numeric; v_unit text; v_driver text; v_count_standby boolean; v_cat public.budget_category;
  v_account text; v_group text; v_cc text; v_ptype text; v_party text; v_spec int := 0; v_n numeric;
begin
  if p_setting is null or jsonb_typeof(p_setting) <> 'object' then
    raise exception 'setting must be a JSON object' using errcode = '22023';
  end if;
  begin
    v_key := nullif(p_setting->>'setting_key', '')::uuid;
    v_asset := (p_setting->>'asset_id')::uuid;
    v_from := (p_setting->>'effective_from')::date;
    v_to := nullif(p_setting->>'effective_to', '')::date;
    v_work := nullif(p_setting->>'work_rate', '')::numeric;
    v_standby := nullif(p_setting->>'standby_rate', '')::numeric;
    v_count_standby := coalesce(nullif(p_setting->>'count_standby', '')::boolean, false);
    v_cat := nullif(p_setting->>'charge_category', '')::public.budget_category;
  exception when others then
    raise exception 'setting_key, asset_id, effective dates, rates, count_standby or charge_category is malformed' using errcode = '22023';
  end;
  v_ev := case when (p_setting->>'expected_version') ~ '^\d{1,9}$' then (p_setting->>'expected_version')::int end;
  if v_from is null then raise exception 'effective_from is required' using errcode = '22023'; end if;
  if v_to is not null and v_to < v_from - 1 then
    raise exception 'effective_to is before effective_from' using errcode = '22023';
  end if;
  if not exists (select 1 from public.equipment_assets a where a.id = v_asset and a.org_id = p_org and a.archived_at is null) then
    raise exception 'asset not found' using errcode = 'P0002';   -- SECURITY: the org re-assertion MUST stay
  end if;
  v_basis := p_setting->>'basis';
  if v_basis is null or v_basis not in ('none','hire_rate','actual_cost') then
    raise exception 'basis must be none, hire_rate or actual_cost' using errcode = '22023';
  end if;
  foreach v_n in array array[v_work, v_standby] loop
    if v_n is not null and (v_n::text in ('NaN','Infinity','-Infinity') or v_n < 0 or v_n >= 1000000000000 or round(v_n, 2) <> v_n) then
      raise exception 'a rate must be zero or more, with at most 2 decimals' using errcode = '22023';
    end if;
  end loop;
  v_unit := nullif(btrim(coalesce(p_setting->>'rate_unit', '')), '');
  v_driver := nullif(btrim(coalesce(p_setting->>'driver', '')), '');
  v_account := nullif(btrim(coalesce(p_setting->>'account', '')), '');
  v_group := nullif(btrim(coalesce(p_setting->>'account_group', '')), '');
  v_cc := nullif(btrim(coalesce(p_setting->>'cost_center', '')), '');
  v_ptype := nullif(btrim(coalesce(p_setting->>'party_type', '')), '');
  v_party := nullif(btrim(coalesce(p_setting->>'party', '')), '');
  if v_unit is not null and v_unit not in ('hours','days') then raise exception 'rate_unit must be hours or days' using errcode = '22023'; end if;
  if v_driver is not null and v_driver not in ('units','fuel','trips') then raise exception 'driver must be units, fuel or trips' using errcode = '22023'; end if;
  if v_basis in ('none','hire_rate') and (v_driver is not null or v_account is not null or v_group is not null
       or v_cc is not null or v_ptype is not null or v_party is not null) then
    raise exception 'only an actual-cost setting carries a driver or a ledger match' using errcode = '22023';
  end if;
  if v_basis = 'none' then
    if v_work is not null or v_standby is not null or v_unit is not null or v_cat is not null then
      raise exception 'a setting with basis none carries no rates' using errcode = '22023';
    end if;
    v_count_standby := false;
  elsif v_basis = 'hire_rate' then
    if v_work is null or v_unit is null then raise exception 'a hire rate needs a work rate and a unit' using errcode = '22023'; end if;
    v_count_standby := false;
    v_cat := coalesce(v_cat, 'Equipment'::public.budget_category);
    if p_check_accounts and exists (
      -- Same accounting basis as org_reads_erp_ledger(), evaluated for the caller's named organization.
      select 1 from public.external_org_bindings b where b.org_id = p_org and b.status = 'active'
        and (b.external_tier = 'erpnext' or (b.external_tier = 'odoo' and b.activated_at is not null
          and nullif(b.config->>'ledger_basis_at', '') is not null))
    ) and not exists (select 1 from public.budget_category_account_map m where m.org_id = p_org and m.category = v_cat) then
      raise exception 'map an account to the % category first', v_cat using errcode = 'P0002';   -- PQ-3
    end if;
  else
    if v_work is not null or v_standby is not null then
      raise exception 'an actual-cost setting carries no rates' using errcode = '22023';
    end if;
    if v_driver is null then raise exception 'actual cost needs a driver' using errcode = '22023'; end if;
    if (v_account is null) = (v_group is null) then raise exception 'name exactly one of account or account_group' using errcode = '22023'; end if;
    if v_driver = 'units' and v_unit is null then raise exception 'actual cost by units needs a unit' using errcode = '22023'; end if;
    if v_driver <> 'units' then v_unit := null; end if;
    if v_ptype is not null and v_party is null then raise exception 'party_type needs a party' using errcode = '22023'; end if;
    v_cat := null;
    if p_check_accounts then   -- the 0376 account checks, same messages
      if v_account is not null and not exists (
           select 1 from public.erp_account_mirror a where a.org_id = p_org and a.erp_name = v_account and not a.is_group)
         and not exists (select 1 from public.erp_gl_entry_mirror l where l.org_id = p_org and l.account = v_account) then
        raise exception 'account not found: %', v_account using errcode = 'P0002';
      end if;
      if v_group is not null and not exists (
           select 1 from public.erp_account_mirror a where a.org_id = p_org and a.erp_name = v_group and a.is_group) then
        raise exception 'account group not found: %', v_group using errcode = 'P0002';
      end if;
    end if;
    v_spec := 10 * ((v_cc is not null)::int + (v_party is not null)::int) + case when v_account is not null then 2 else 1 end;   -- 0376 :171
  end if;
  return jsonb_build_object(
    'setting_key', v_key, 'expected_version', v_ev, 'asset_id', v_asset, 'basis', v_basis,
    'work_rate', v_work, 'standby_rate', v_standby, 'rate_unit', v_unit, 'driver', v_driver,
    'count_standby', v_count_standby, 'charge_category', v_cat,
    'account', v_account, 'account_group', v_group, 'cost_center', v_cc, 'party_type', v_ptype, 'party', v_party,
    'effective_from', v_from, 'effective_to', v_to, 'specificity', v_spec);
end $$;
