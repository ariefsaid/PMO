-- #1504 S7: the one-time map (set_odoo_org_config, odoo_pmo_units) and link reconciliation (reconcile_odoo_links).
-- Moved out of 0496, which shipped before S7 was built.

-- ===== Part 2 (#1504 S7): the one-time map. Three keys, each written whole by an Admin or Finance user. =====
-- The setter is the only writer of these binding-config keys (ids only: names come from the role-gated directory), and it is
-- an allow-list, not a patch: any other key is refused, so it cannot overwrite the connection's database, plan or company.
create or replace function public.set_odoo_org_config(p_org_id uuid, p_actor_id uuid, p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_state jsonb; v_kind text; v_old jsonb; v_pairs jsonb; v_key text; v_id text;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  v_state := public.actor_authorization_state(p_org_id, p_actor_id);
  if not coalesce((v_state ->> 'active')::boolean, false) or v_state ->> 'role' not in ('Admin', 'Finance') then
    raise exception 'Admin or Finance required' using errcode = '42501';
  end if;
  perform public.assert_odoo_activated(p_org_id);
  v_kind := case p_key when 'account_defaults' then 'account' when 'unit_map' then 'uom' when 'default_warehouse_id' then 'warehouse' end;
  if v_kind is null then raise exception 'unknown config key' using errcode = '22023'; end if;
  if p_key = 'default_warehouse_id' then
    if jsonb_typeof(p_value) <> 'string' then raise exception 'an Odoo id is required' using errcode = '22023'; end if;
  else
    if jsonb_typeof(p_value) <> 'object' then raise exception 'an object of Odoo ids is required' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_each(p_value) e where jsonb_typeof(e.value) <> 'string' or e.value #>> '{}' = '') then
      raise exception 'every value must be an Odoo id' using errcode = '22023';
    end if;
    if p_key = 'account_defaults' and exists (select 1 from jsonb_object_keys(p_value) k
         where k <> all (array['payable','receivable','expense','cash','bank','stock_valuation','stock_consumption'])) then
      raise exception 'unknown default' using errcode = '22023';
    end if;
    if p_key = 'unit_map' and exists (select 1 from jsonb_object_keys(p_value) k where length(k) not between 1 and 40) then
      raise exception 'unknown unit' using errcode = '22023';
    end if;
  end if;
  -- Only what this call changes is checked: a value saved earlier and sent back unchanged is not re-validated, so a mapping gone stale
  -- (its Odoo record archived, its PMO unit no longer used) can never block saving a different one. Every changed id is a live
  -- record of the right kind in THIS org's mirror; an account default also has a type that fits the default's name.
  select config -> p_key into v_old from public.external_org_bindings where org_id = p_org_id and external_tier = 'odoo' and status = 'active';
  if p_key = 'default_warehouse_id' then
    if p_value is distinct from v_old then v_pairs := jsonb_build_object('', p_value); end if;
  else
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_pairs from jsonb_each(p_value) e where (v_old -> e.key) is distinct from e.value;
  end if;
  for v_key, v_id in select e.key, e.value #>> '{}' from jsonb_each(coalesce(v_pairs, '{}'::jsonb)) e loop
    if not exists (
         select 1 from public.external_master_records m
          where m.org_id = p_org_id and m.external_tier = 'odoo' and m.kind = v_kind and m.external_id = v_id and m.active and m.tombstoned_at is null
            and (v_kind <> 'account' or coalesce(m.attrs ->> 'account_type', '') = any (case v_key
                   when 'payable' then array['liability_payable'] when 'receivable' then array['asset_receivable']
                   when 'bank' then array['asset_cash'] when 'cash' then array['asset_cash']
                   when 'expense' then array['expense', 'expense_direct_cost'] when 'stock_valuation' then array['asset_current']
                   when 'stock_consumption' then array['expense_direct_cost'] else array[]::text[] end))) then
      raise exception 'not a usable %: %', v_kind, v_key using errcode = 'P0001';
    end if;
  end loop;
  update public.external_org_bindings
     set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(p_key, p_value, p_key || '_set_by', p_actor_id, p_key || '_set_at', now()), updated_at = now()
   where org_id = p_org_id and external_tier = 'odoo' and status = 'active';
  perform public.log_audit('integration.odoo.config', p_org_id, p_actor_id, null, jsonb_build_object('key', p_key));   -- who set the value
end $$;

-- FR-ODC-061: the distinct unit texts PMO uses (work items and subcontract order lines), for the unit map. Bounded.
create or replace function public.odoo_pmo_units(p_org_id uuid) returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select u from (select btrim(unit) as u from public.boq_items where org_id = p_org_id
                 union select btrim(unit) from public.purchase_order_lines where org_id = p_org_id) x
   where u <> '' order by u limit 500
$$;

-- ===== Part 3 (#1504 S7): link reconciliation. Marks, never deletes: a link whose account was archived or deleted in Odoo, or
-- moved to another company, says why (`config.attention`); the mark clears itself once Odoo is right again. =====
create or replace function public.reconcile_odoo_links(p_org_id uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer; v_company text;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  select config ->> 'odoo_company_id' into v_company from public.external_org_bindings where org_id = p_org_id and external_tier = 'odoo';
  with calc as (
    select b.id,
           case when m.id is null or m.tombstoned_at is not null then 'tombstoned'
                when not m.active then 'archived'
                when coalesce(m.attrs ->> 'company_id', v_company) <> v_company then 'moved-company' end as att
      from public.external_project_bindings b
      left join public.external_master_records m on m.org_id = b.org_id and m.external_tier = 'odoo' and m.kind = 'analytic_account' and m.external_id = b.external_container_id
     where b.org_id = p_org_id and b.external_tier = 'odoo')
  update public.external_project_bindings b
     set config = case when c.att is null then b.config - 'attention' else b.config || jsonb_build_object('attention', c.att) end
    from calc c
   where b.id = c.id and (b.config ->> 'attention') is distinct from c.att;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.set_odoo_org_config(uuid,uuid,text,jsonb), public.reconcile_odoo_links(uuid), public.odoo_pmo_units(uuid) from public, anon, authenticated;
grant execute on function public.set_odoo_org_config(uuid,uuid,text,jsonb), public.reconcile_odoo_links(uuid), public.odoo_pmo_units(uuid) to service_role;
