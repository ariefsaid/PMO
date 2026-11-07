-- Rollback of 0706: restores apply_connect_link exactly as migration 0480 defined it.
create or replace function public.apply_connect_link(p_org uuid, p_tier text, p_kind text, p_pmo text, p_ext text, p_snapshot jsonb, p_actor uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uuid uuid; v_n int; v_ref public.external_refs%rowtype; v_emp public.erp_employees%rowtype; v_email text; v_emps int;
        v_key text := p_snapshot->>'matchKey'; v_reviewed boolean := coalesce((p_snapshot->>'reviewed')::boolean, false);
begin
  -- A person's cost identity and a budget account link only on their strong key (the work email, the category code) or after a
  -- person has looked at the pair (decide_connect_review). A name, or a key this function cannot recheck, never links.
  if p_kind in ('employee', 'account') and not v_reviewed and v_key is distinct from 'code' then return 'This pairing needs a person to confirm it'; end if;
  if p_kind = 'party' then
    if not exists (select 1 from public.companies where id = p_pmo::uuid and org_id = p_org) then return 'This company is no longer in PMO'; end if;
    -- a tax-keyed link is only as good as the tax id: it must still be the one that was proposed
    if v_key = 'tax' and not v_reviewed and regexp_replace(lower(coalesce((select erp_tax_id from public.companies where id = p_pmo::uuid), '')), '[^0-9a-z]', '', 'g')
         is distinct from regexp_replace(lower(coalesce(p_snapshot->>'taxId', '')), '[^0-9a-z]', '', 'g') then
      return 'The ERP record changed since this was proposed';
    end if;
    insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
      values (p_org, 'companies', p_pmo, p_tier, p_ext) on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then
      -- the tax id is filled, never overwritten; while companies belong to the ERP the feed owns the column
      if coalesce(p_snapshot->>'taxId', '') <> '' and not public.domain_externally_owned(p_org, 'companies') then
        update public.companies set erp_tax_id = coalesce(erp_tax_id, p_snapshot->>'taxId') where id = p_pmo::uuid and org_id = p_org;
      end if;
      return null;
    end if;
    select * into v_ref from public.external_refs where org_id = p_org and domain = 'companies' and pmo_record_id = p_pmo;
    if found and v_ref.external_record_id = p_ext then return null; end if;   -- reconciled
    return 'This record is already linked to another ERP record';
  elsif p_kind = 'project' then
    if not exists (select 1 from public.projects where id = p_pmo::uuid and org_id = p_org) then return 'This project is no longer in PMO'; end if;
    return public.connect_link_project(p_org, p_tier, p_pmo, p_ext);
  elsif p_kind = 'item' then
    if public.connect_config_map_link(p_org, p_tier, 'item_map', p_pmo, p_ext, false) then return null; end if;
    if exists (select 1 from public.external_org_bindings where org_id = p_org and external_tier = p_tier and status = 'active'
                 and config->'item_map'->>p_pmo = p_ext) then return null; end if;
    return 'This item is already linked';
  elsif p_kind = 'employee' then
    -- employee_number is display-only and not unique: never guess between two rows
    select count(*) into v_emps from public.erp_employees where org_id = p_org and employee_number = p_ext;
    if v_emps = 0 then return 'This person has not been read from the ERP yet'; end if;
    if v_emps > 1 then return 'More than one ERP person has this number'; end if;
    select * into v_emp from public.erp_employees where org_id = p_org and employee_number = p_ext for update;
    v_uuid := p_pmo::uuid;
    select lower(email) into v_email from public.profiles where id = v_uuid and org_id = p_org;
    if v_email is null then return 'This person is no longer in PMO'; end if;
    if v_emp.link_state = 'confirmed' then
      return case when v_emp.profile_id = v_uuid then null else 'This ERP employee is already linked to another person' end;
    end if;
    if v_emp.link_state = 'rejected' then return 'An administrator declined this pairing'; end if;
    -- an email-keyed match is only as good as the email: the Desk can edit it, so it must still be what was proposed
    if not v_reviewed and lower(coalesce(nullif(v_emp.work_email, ''), v_emp.erp_user_id, '')) is distinct from v_email then
      return 'The ERP record changed since this was proposed';
    end if;
    begin
      update public.erp_employees set profile_id = v_uuid, link_state = 'confirmed', linked_by = p_actor, linked_at = now()
       where id = v_emp.id;
    exception when unique_violation then
      return 'This person is already linked to another ERP employee';
    end;
    return null;
  elsif p_kind = 'account' then
    -- the category code the ERP account was proposed under must still be the category being linked
    if not v_reviewed and p_snapshot->>'code' is distinct from p_pmo then return 'The ERP account changed since this was proposed'; end if;
    insert into public.budget_category_account_map (org_id, category, erp_account, updated_by)
      values (p_org, p_pmo::public.budget_category, p_ext, p_actor) on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then return null; end if;
    if exists (select 1 from public.budget_category_account_map where org_id = p_org and category = p_pmo::public.budget_category and erp_account = p_ext) then
      return null;   -- reconciled
    end if;
    return 'This account is already used by another category';
  end if;
  return 'This kind cannot be linked';
end $$;
