begin;
do $$ begin
  if exists (select 1 from public.external_refs where domain in ('stock_items','stock_warehouses'))
     or exists (select 1 from public.erp_connect_staged where kind in ('stock_item','stock_warehouse'))
     or exists (select 1 from public.erp_connect_proposals where kind in ('stock_item','stock_warehouse')) then
    raise exception 'stock connect rollback refused: stock links or setup rows exist' using errcode = 'P0001';
  end if;
end $$;
alter table public.erp_connect_staged drop constraint erp_connect_staged_kind_check;
alter table public.erp_connect_staged add constraint erp_connect_staged_kind_check check (kind in ('party','item','project','employee','account'));
alter table public.erp_connect_proposals drop constraint erp_connect_proposals_kind_check;
alter table public.erp_connect_proposals add constraint erp_connect_proposals_kind_check check (kind in ('party','item','project','employee','account'));
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
    -- FR-ODC-052 (#1691): an Internal company is PMO's own org marker, never an ERP party; the candidate
    -- lists keep it out and the link step itself refuses it, so the rule holds in one place for every tier.
    if exists (select 1 from public.companies where id = p_pmo::uuid and org_id = p_org and type = 'Internal') then
      return 'An internal company cannot take an ERP link';
    end if;
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
      -- #1607: re-read this tier's sales-invoice cursors when a copy still has no client. An Odoo copy names its partner, so only the
      -- partner just linked counts; an ERPNext copy keeps no customer name, so any client-less ERPNext copy counts (cost only: one
      -- bounded re-read). Receipts take their client from the invoice and are not re-read.
      if exists (select 1 from public.sales_invoices where org_id = p_org and not pmo_native and customer_id is null)
         or exists (select 1 from public.revenue_erp_mirror where org_id = p_org and customer_company_id is null
                      and customer_external_id is not null and 'Client:' || customer_external_id = p_ext) then
        update public.external_sync_watermarks set watermark_cursor = '', updated_at = now()
         where org_id = p_org and external_tier = p_tier and watermark_cursor <> ''
           and domain in ('revenue::Sales Invoice', 'revenue:sales-invoice', 'revenue:credit-note');
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

create or replace function public.accept_connect_proposals(p_tier text, p_kind text default null, p_ids uuid[] default null, p_batch int default 500, p_exclude uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_role text := public.auth_role()::text;
        r record; v_reason text; v_counts jsonb := '{}'::jsonb; v_k text; v_field text; v_binding uuid;
        v_links jsonb := '[]'::jsonb; v_errors jsonb := '[]'::jsonb; v_remaining int; v_state text; v_msg text;
        v_cfg jsonb; v_batch jsonb := '{}'::jsonb; v_mapkey text;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_role = 'Finance' and coalesce(p_kind, 'account') <> 'account' then raise exception 'not allowed' using errcode = '42501'; end if;
  -- the binding row is locked for the call: item and project links are checked against this snapshot and merged once at the end
  select id, coalesce(config, '{}'::jsonb) into v_binding, v_cfg from public.external_org_bindings
   where org_id = v_org and external_tier = p_tier and status = 'active' for update;
  if v_binding is null then raise exception 'no active connection for this ERP' using errcode = 'P0001'; end if;
  -- p_kind null = every kind the actor may accept; p_ids null = every open non-review row of the current connection (FR-ECA-012 "all").
  for r in select * from public.erp_connect_proposals
            where org_id = v_org and external_tier = p_tier and binding_id = v_binding and state = 'open' and outcome <> 'review'
              and (kind = p_kind or (p_kind is null and (v_role = 'Admin' or kind = 'account')))
              and (p_ids is null or id = any(p_ids))
              and (p_exclude is null or not (id = any(p_exclude)))
            order by (reason_text is not null), kind, id limit least(greatest(coalesce(p_batch, 500), 1), 500) for update loop
    v_reason := null;
    if r.outcome <> 'send' then
      begin   -- one bad row is left open with a reason and never aborts the batch; its partial writes roll back with it
        if r.outcome = 'link' and r.kind = 'project' and p_tier = 'odoo' then   -- odoo-arm
          -- an Odoo project link is a cost-account binding, written by the one Odoo writer, never a config map entry   -- odoo-arm
          v_reason := public.connect_link_odoo_project(v_org, r.pmo_ids[1], r.external_ids[1], v_actor);   -- odoo-arm
        elsif r.outcome = 'link' and r.kind in ('item', 'project') then
          v_mapkey := r.kind || '_map';
          v_reason := public.connect_map_link_check(v_org, p_tier, r.kind, r.pmo_ids[1], r.external_ids[1], v_cfg->v_mapkey, v_batch->v_mapkey);
          if v_reason is null then
            v_batch := jsonb_set(v_batch, array[v_mapkey], coalesce(v_batch->v_mapkey, '{}'::jsonb) || jsonb_build_object(r.pmo_ids[1], r.external_ids[1]));
          end if;
        elsif r.outcome = 'link' then
          v_reason := public.apply_connect_link(v_org, p_tier, r.kind, r.pmo_ids[1], r.external_ids[1],
                                                r.snapshot || jsonb_build_object('matchKey', r.match_key, 'reviewed', false), v_actor);
        else
          v_reason := public.apply_connect_bring_in(v_org, p_tier, r.kind, r.external_ids[1], r.snapshot);
        end if;
      exception when others then
        get stacked diagnostics v_msg = message_text;
        v_state := sqlstate;
        v_reason := 'This row could not be applied';   -- plain words for the screen; the audit row keeps the cause
        v_errors := v_errors || jsonb_build_object('proposalId', r.id, 'sqlstate', v_state, 'message', v_msg);
      end;
    end if;
    if r.outcome = 'send' then   -- queued for ECA-3's drain; nothing is reported done before the ERP confirms (NFR-ECA-004)
      update public.erp_connect_proposals set state = 'sending', decided_by = v_actor, decided_at = now() where id = r.id;
      v_field := 'send';
    elsif v_reason is null then
      update public.erp_connect_proposals set state = 'applied', decided_by = v_actor, decided_at = now(), reason_text = null where id = r.id;
      v_field := replace(r.outcome, '-', '_');
      if r.outcome = 'link' and r.kind in ('employee', 'account') then
        v_links := v_links || jsonb_build_object('kind', r.kind, 'pmoId', r.pmo_ids[1], 'externalId', r.external_ids[1]);
      end if;
    else
      update public.erp_connect_proposals set reason_text = v_reason where id = r.id;
      v_field := 'left_open';
    end if;
    v_counts := jsonb_set(v_counts, array[r.kind], coalesce(v_counts->r.kind, '{"link":0,"bring_in":0,"send":0,"left_open":0}'::jsonb));
    v_counts := jsonb_set(v_counts, array[r.kind, v_field], to_jsonb((v_counts #>> array[r.kind, v_field])::int + 1));
  end loop;
  if v_batch ? 'item_map' then
    update public.external_org_bindings set config = jsonb_set(config, '{item_map}', coalesce(config->'item_map', '{}'::jsonb) || (v_batch->'item_map')) where id = v_binding;
  end if;
  if v_batch ? 'project_map' then
    update public.external_org_bindings set config = jsonb_set(config, '{project_map}', coalesce(config->'project_map', '{}'::jsonb) || (v_batch->'project_map')) where id = v_binding;
  end if;
  -- "set up once" (PD-ECA-15) is stamped only for a kind where something was applied or queued
  for v_k in select jsonb_object_keys(v_counts) loop
    if (v_counts #>> array[v_k, 'link'])::int + (v_counts #>> array[v_k, 'bring_in'])::int + (v_counts #>> array[v_k, 'send'])::int > 0 then
      update public.erp_connect_census set accepted_at = coalesce(accepted_at, now())
       where org_id = v_org and external_tier = p_tier and kind = v_k;
    end if;
  end loop;
  if exists (select 1 from jsonb_each(v_counts) e where (e.value->>'send')::int > 0) then
    update public.erp_connect_runs set finished_at = null   -- only the latest run: older runs keep their end times
     where id = (select l.id from public.erp_connect_runs l where l.org_id = v_org and l.external_tier = p_tier order by l.started_at desc, l.id desc limit 1)
       and state = 'ready';
  end if;
  if v_counts <> '{}'::jsonb then
    perform public.log_audit('integration.connect_accept', v_org, v_actor, null,
      jsonb_build_object('tier', p_tier, 'kinds', v_counts, 'links', v_links, 'errors', v_errors));
  end if;
  select count(*) into v_remaining from public.erp_connect_proposals
   where org_id = v_org and external_tier = p_tier and binding_id = v_binding and state = 'open' and outcome <> 'review' and reason_text is null
     and (kind = p_kind or (p_kind is null and (v_role = 'Admin' or kind = 'account')))
     and (p_ids is null or id = any(p_ids))
     and (p_exclude is null or not (id = any(p_exclude)));
  return jsonb_build_object('counts', v_counts, 'remaining', v_remaining);
end $$;

create or replace function public.unlink_connect_match(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); r public.erp_connect_proposals%rowtype;
        v_domain text; v_pmo text; v_ext text; v_n int;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from public.erp_connect_proposals where id = p_id and org_id = v_org for update;
  if not found or r.outcome <> 'link' or r.state <> 'applied' then raise exception 'link not found' using errcode = 'P0002'; end if;
  v_pmo := r.pmo_ids[1]; v_ext := r.external_ids[1];
  v_domain := case r.kind when 'party' then 'companies' when 'project' then 'projects' when 'employee' then 'employees'
                          when 'account' then 'accounts' when 'item' then 'items' end;
  if public.connect_link_in_use(v_org, v_domain, v_pmo) then raise exception 'link in use' using errcode = 'P0001'; end if;
  if r.kind = 'party' then
    delete from public.external_refs where org_id = v_org and domain = 'companies' and pmo_record_id = v_pmo and external_record_id = v_ext;
  elsif r.kind = 'project' and r.external_tier = 'odoo' then   -- odoo-arm
    delete from public.external_project_bindings   -- odoo-arm
     where org_id = v_org and project_id = v_pmo::uuid and external_tier = 'odoo' and external_container_id = v_ext;   -- odoo-arm
  elsif r.kind in ('project', 'item') then
    update public.external_org_bindings
       set config = jsonb_set(config, array[case r.kind when 'project' then 'project_map' else 'item_map' end],
                              (config->(case r.kind when 'project' then 'project_map' else 'item_map' end)) - v_pmo)
     where org_id = v_org and external_tier = r.external_tier and status = 'active'
       and config->(case r.kind when 'project' then 'project_map' else 'item_map' end)->>v_pmo = v_ext;
  elsif r.kind = 'employee' then
    -- 'rejected' (0136): the feed and the applier both refuse a declined pairing, so it does not come back by itself
    update public.erp_employees set profile_id = null, link_state = 'rejected', linked_by = null, linked_at = null
     where org_id = v_org and employee_number = v_ext and profile_id = v_pmo::uuid and link_state = 'confirmed';
  elsif r.kind = 'account' then
    delete from public.budget_category_account_map where org_id = v_org and category = v_pmo::public.budget_category and erp_account = v_ext;
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'nothing to unlink' using errcode = 'P0001'; end if;
  -- dismissed, not open: an unlinked pairing was wrong, and an open row would be re-applied by the next accept-all
  update public.erp_connect_proposals set state = 'dismissed', decided_by = v_actor, decided_at = now() where id = p_id;
  perform public.log_audit('integration.connect_unlink', v_org, v_actor, p_id,
    jsonb_build_object('tier', r.external_tier, 'kind', r.kind, 'pmoId', v_pmo, 'externalId', v_ext, 'linkedBy', r.decided_by, 'linkedAt', r.decided_at));
end $$;

create or replace function public.list_unlinkable_connect_matches(p_ids uuid[]) returns uuid[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_ids uuid[];
begin
  if v_actor is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_ids), 0) > 200 then raise exception 'too many records' using errcode = '22023'; end if;
  select coalesce(array_agg(p.id order by p.id), '{}') into v_ids
    from public.erp_connect_proposals p
   where p.org_id = v_org and p.id = any(coalesce(p_ids, '{}')) and p.state = 'applied' and p.outcome = 'link'
     and not public.connect_link_in_use(v_org,
       case p.kind when 'party' then 'companies' when 'project' then 'projects' when 'employee' then 'employees'
                   when 'account' then 'accounts' when 'item' then 'items' end,
       p.pmo_ids[1])
     and case
       when p.kind = 'party' then exists (
         select 1 from public.external_refs r
          where r.org_id = v_org and r.domain = 'companies' and r.pmo_record_id = p.pmo_ids[1]
            and r.external_record_id = p.external_ids[1])
       when p.kind = 'project' and p.external_tier = 'odoo' then exists (
         select 1 from public.external_project_bindings b
          where b.org_id = v_org and b.project_id::text = p.pmo_ids[1] and b.external_tier = 'odoo'
            and b.external_container_id = p.external_ids[1])
       when p.kind in ('project', 'item') then exists (
         select 1 from public.external_org_bindings b
          where b.org_id = v_org and b.external_tier = p.external_tier and b.status = 'active'
            and b.config->(case p.kind when 'project' then 'project_map' else 'item_map' end)->>p.pmo_ids[1] = p.external_ids[1])
       when p.kind = 'employee' then exists (
         select 1 from public.erp_employees e
          where e.org_id = v_org and e.employee_number = p.external_ids[1]
            and e.profile_id::text = p.pmo_ids[1] and e.link_state = 'confirmed')
       when p.kind = 'account' then exists (
         select 1 from public.budget_category_account_map m
          where m.org_id = v_org and m.category::text = p.pmo_ids[1] and m.erp_account = p.external_ids[1])
       else false
     end;
  return v_ids;
end $$;

create or replace function public.decide_connect_review(p_id uuid, p_choice jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_role text := public.auth_role()::text;
        r public.erp_connect_proposals%rowtype; v_reason text; v_pmo text := p_choice->>'pmoId'; v_ext text := p_choice->>'externalId';
        v_action text := p_choice->>'action'; v_snapshot jsonb; v_apply_snapshot jsonb; v_accept jsonb;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from public.erp_connect_proposals where id = p_id and org_id = v_org for update;
  if not found or r.state <> 'open' then raise exception 'review not found' using errcode = 'P0002'; end if;
  if v_role = 'Finance' and r.kind <> 'account' then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.external_org_bindings where id = r.binding_id and org_id = v_org and external_tier = r.external_tier and status = 'active') then
    raise exception 'no active connection for this ERP' using errcode = 'P0001';
  end if;
  if v_action = 'dismiss' then
    if r.outcome <> 'review' then raise exception 'only unclear records can be dismissed' using errcode = '22023'; end if;
    update public.erp_connect_proposals set state = 'dismissed', decided_by = v_actor, decided_at = now() where id = p_id;
  elsif v_action = 'link' then
    if v_pmo is null or not (v_pmo = any(r.pmo_ids)) or coalesce(v_ext, '') = '' then raise exception 'That record is not available for this kind' using errcode = '22023'; end if;
    if v_ext = any(r.external_ids) then
      v_snapshot := r.snapshot;
      v_apply_snapshot := r.snapshot || jsonb_build_object('matchKey', r.match_key, 'reviewed', true);
    else
      select s.row into v_snapshot from public.erp_connect_staged s
       where s.org_id = v_org and s.run_id = (select x.id from public.erp_connect_runs x
         where x.org_id = v_org and x.binding_id = r.binding_id and x.external_tier = r.external_tier order by x.started_at desc, x.id desc limit 1)
         and s.kind = r.kind and s.external_id = v_ext;
      if not found then raise exception 'That record is not available for this kind' using errcode = '22023'; end if;
      v_apply_snapshot := coalesce(v_snapshot, '{}'::jsonb) || jsonb_build_object('reviewed', true);
    end if;
    v_reason := public.apply_connect_link(v_org, r.external_tier, r.kind, v_pmo, v_ext, v_apply_snapshot, v_actor);
    if v_reason is not null then raise exception '%', v_reason using errcode = 'P0001'; end if;
    update public.erp_connect_proposals set state = 'applied', outcome = 'link', pmo_ids = array[v_pmo], external_ids = array[v_ext],
      snapshot = coalesce(v_snapshot, '{}'::jsonb), reason_text = null, decided_by = v_actor, decided_at = now() where id = p_id;
  elsif v_action = 'bring-in' then
    if cardinality(r.pmo_ids) <> 0 or coalesce(v_ext, '') = '' then raise exception 'This row cannot be brought in' using errcode = '22023'; end if;
    if v_ext = any(r.external_ids) then
      v_snapshot := r.snapshot;
    else
      select s.row into v_snapshot from public.erp_connect_staged s
       where s.org_id = v_org and s.run_id = (select x.id from public.erp_connect_runs x
         where x.org_id = v_org and x.binding_id = r.binding_id and x.external_tier = r.external_tier order by x.started_at desc, x.id desc limit 1)
         and s.kind = r.kind and s.external_id = v_ext;
      if not found then raise exception 'That record is not available for this kind' using errcode = '22023'; end if;
    end if;
    v_reason := public.apply_connect_bring_in(v_org, r.external_tier, r.kind, v_ext, coalesce(v_snapshot, '{}'::jsonb));
    if v_reason is not null then raise exception '%', v_reason using errcode = 'P0001'; end if;
    update public.erp_connect_proposals set state = 'applied', outcome = 'bring-in', external_ids = array[v_ext],
      snapshot = coalesce(v_snapshot, '{}'::jsonb), reason_text = null, decided_by = v_actor, decided_at = now() where id = p_id;
  elsif v_action = 'send' then
    if cardinality(r.pmo_ids) = 0 or v_pmo is null or not (v_pmo = any(r.pmo_ids)) then raise exception 'This row cannot be sent' using errcode = '22023'; end if;
    update public.erp_connect_proposals set outcome = 'send', pmo_ids = array[v_pmo], external_ids = '{}', reason_text = null where id = p_id;
    v_accept := public.accept_connect_proposals(r.external_tier, r.kind, array[p_id], 500, null);
    if coalesce((v_accept #>> array['counts',r.kind,'send'])::int, 0) <> 1 then
      raise exception 'This row could not be sent' using errcode = 'P0001';
    end if;
  else
    raise exception 'unknown action' using errcode = '22023';
  end if;
  perform public.log_audit('integration.connect_review', v_org, v_actor, p_id,
    jsonb_build_object('tier', r.external_tier, 'kind', r.kind, 'action', v_action, 'pmoId', v_pmo, 'externalId', v_ext));
end $$;
revoke all on function public.apply_connect_link(uuid,text,text,text,text,jsonb,uuid) from public, anon, authenticated, service_role;
revoke all on function public.accept_connect_proposals(text,text,uuid[],integer,uuid[]), public.unlink_connect_match(uuid), public.list_unlinkable_connect_matches(uuid[]), public.decide_connect_review(uuid,jsonb) from public, anon;
grant execute on function public.accept_connect_proposals(text,text,uuid[],integer,uuid[]), public.unlink_connect_match(uuid), public.list_unlinkable_connect_matches(uuid[]), public.decide_connect_review(uuid,jsonb) to authenticated;
commit;
