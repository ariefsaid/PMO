-- Reverses 0486_odoo_project_links_config.sql: ECA-2's three bodies come back as migration 0480 wrote them; the Odoo writers go.
-- Odoo project bindings written meanwhile stay (they are data); only the functions are removed.
create or replace function public.connect_link_project(p_org uuid, p_tier text, p_pmo text, p_ext text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_tier <> 'erpnext' then return 'Project links for this ERP are not available yet'; end if;
  if public.connect_config_map_link(p_org, p_tier, 'project_map', p_pmo, p_ext, true) then return null; end if;
  if exists (select 1 from public.external_org_bindings where org_id = p_org and external_tier = p_tier and status = 'active'
               and config->'project_map'->>p_pmo = p_ext) then return null; end if;
  return 'This project is already linked';
end $$;

create or replace function public.accept_connect_proposals(p_tier text, p_kind text default null, p_ids uuid[] default null, p_batch int default 500)
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
            order by (reason_text is not null), kind, id limit least(greatest(coalesce(p_batch, 500), 1), 500) for update loop
    v_reason := null;
    if r.outcome <> 'send' then
      begin   -- one bad row is left open with a reason and never aborts the batch; its partial writes roll back with it
        if r.outcome = 'link' and r.kind in ('item', 'project') then
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
     and (p_ids is null or id = any(p_ids));
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

revoke all on function public.accept_connect_proposals(text,text,uuid[],int), public.unlink_connect_match(uuid) from public, anon;
grant execute on function public.accept_connect_proposals(text,text,uuid[],int), public.unlink_connect_match(uuid) to authenticated;
drop function if exists public.set_odoo_analytic_plan(uuid, uuid, text);
drop function if exists public.unlink_odoo_cost_account(uuid, uuid, uuid);
drop function if exists public.link_odoo_cost_account(uuid, uuid, uuid, text);
drop function if exists public.connect_link_odoo_project(uuid, text, text, uuid);
drop function if exists public.odoo_link_cost_account_core(uuid, uuid, uuid, text);
