-- #1504 S6 (Odoo O1): a PMO project links to one Odoo cost account (an analytic account of the chosen plan; the Project app is
-- not needed), and ECA-2's accept, decide and unlink reach that link for tier 'odoo'. Part 1 of the Odoo project-links and
-- config migration; S7 appends the config setter. Reversal: rollback/0486_odoo_project_links_config_down.sql.
--
-- One writer: `connect_link_odoo_project` is the only code that inserts an Odoo project binding. The actor-checked
-- `link_odoo_cost_account` (a person, service role) and ECA-2's setup paths (accept, decide, the sweep) all call it.
-- The in-use check on un-link is ECA-2's single `connect_link_in_use` (FR-ODC-073), not a copy.
-- One cost account per project and one project per account are already held by the unique (org, project, tier) constraint
-- (0093) and the active-container index (0122); the checks below only name the holder by project number first.

-- Internal writer. Raises plain-worded errors; the wrapper below turns them into the reason text the appliers return.
create or replace function public.odoo_link_cost_account_core(p_org_id uuid, p_actor_id uuid, p_project_id uuid, p_account_id text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_plan text; v_id uuid; v_holder text; v_have text;
begin
  perform public.assert_odoo_activated(p_org_id);
  perform 1 from public.projects where id = p_project_id and org_id = p_org_id for share;
  if not found then raise exception 'This project is no longer in PMO' using errcode = 'P0001'; end if;
  -- shared lock on the connection row: a plan change (set_odoo_analytic_plan, for update) waits for this link and then sees it
  select config ->> 'analytic_plan_id' into v_plan from public.external_org_bindings
   where org_id = p_org_id and external_tier = 'odoo' and status = 'active' for share;
  if v_plan is null then raise exception 'choose the analytic plan first' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.external_master_records
                  where org_id = p_org_id and external_tier = 'odoo' and kind = 'analytic_account' and external_id = p_account_id
                    and parent_external_id = v_plan and active and tombstoned_at is null) then
    raise exception 'not a cost account of the chosen plan' using errcode = 'P0001';
  end if;
  select external_container_id into v_have from public.external_project_bindings
   where org_id = p_org_id and project_id = p_project_id and external_tier = 'odoo';
  if v_have = p_account_id then
    select id into v_id from public.external_project_bindings where org_id = p_org_id and project_id = p_project_id and external_tier = 'odoo';
    return v_id;   -- the same pair again: reconciled
  end if;
  if v_have is not null then raise exception 'this project is already linked to a cost account' using errcode = 'P0001'; end if;
  select p.pmo_project_number into v_holder from public.external_project_bindings b join public.projects p on p.id = b.project_id
   where b.org_id = p_org_id and b.external_tier = 'odoo' and b.external_container_id = p_account_id;
  if found then raise exception 'cost account already linked to %', v_holder using errcode = '23505'; end if;
  begin
    insert into public.external_project_bindings (org_id, project_id, external_tier, external_container_id, config, linked_by, linked_at)
    values (p_org_id, p_project_id, 'odoo', p_account_id, jsonb_build_object('plan_id', v_plan), p_actor_id, now()) returning id into v_id;
  exception when unique_violation then
    raise exception 'cost account already linked to another project' using errcode = '23505';   -- lost a race: never name the winner
  end;
  perform public.log_audit('integration.odoo.link', p_org_id, p_actor_id, p_project_id, jsonb_build_object('account', p_account_id));
  return v_id;
end $$;

-- The appliers' contract (apply_connect_link): null when linked, else the plain reason the row stays open with.
create or replace function public.connect_link_odoo_project(p_org uuid, p_pmo text, p_ext text, p_actor uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.odoo_link_cost_account_core(p_org, p_actor, p_pmo::uuid, p_ext);
  return null;
exception when sqlstate 'P0001' or sqlstate '23505' then
  return sqlerrm;
end $$;

-- ECA-2's project-link writer, with the Odoo arm (the feed, decide-review and every other apply path reach it).
create or replace function public.connect_link_project(p_org uuid, p_tier text, p_pmo text, p_ext text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_tier = 'odoo' then return public.connect_link_odoo_project(p_org, p_pmo, p_ext, auth.uid()); end if;   -- odoo-arm (a decided link keeps its deciding Admin; the feed has none)
  if p_tier <> 'erpnext' then return 'Project links for this ERP are not available yet'; end if;
  if public.connect_config_map_link(p_org, p_tier, 'project_map', p_pmo, p_ext, true) then return null; end if;
  if exists (select 1 from public.external_org_bindings where org_id = p_org and external_tier = p_tier and status = 'active'
               and config->'project_map'->>p_pmo = p_ext) then return null; end if;
  return 'This project is already linked';
end $$;

-- FR-ODC-070: the Admin, an Operator or the project's own PM links a project to a mirrored cost account of the chosen plan.
create or replace function public.link_odoo_cost_account(p_org_id uuid, p_actor_id uuid, p_project_id uuid, p_account_id text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_integration_link_actor(p_org_id, p_actor_id, p_project_id);
  return public.odoo_link_cost_account_core(p_org_id, p_actor_id, p_project_id, p_account_id);
end $$;

-- FR-ODC-073: un-link is refused once any ERP document names the project (the one shared check); audited otherwise.
create or replace function public.unlink_odoo_cost_account(p_org_id uuid, p_actor_id uuid, p_project_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_integration_link_actor(p_org_id, p_actor_id, p_project_id);
  if public.connect_link_in_use(p_org_id, 'projects', p_project_id::text) then raise exception 'project link is in use' using errcode = 'P0001'; end if;
  delete from public.external_project_bindings where org_id = p_org_id and project_id = p_project_id and external_tier = 'odoo';
  if found then
    perform public.log_audit('integration.odoo.unlink', p_org_id, p_actor_id, p_project_id, '{}'::jsonb);
    -- the setup row that made this link is closed with it, so a later accept or un-link does not meet a stale 'applied' row
    update public.erp_connect_proposals set state = 'dismissed', decided_by = p_actor_id, decided_at = now()
     where org_id = p_org_id and external_tier = 'odoo' and kind = 'project' and outcome = 'link' and state = 'applied' and pmo_ids[1] = p_project_id::text;
  end if;
end $$;

-- FR-ODC-071: the plan whose accounts are PMO projects is chosen once from what Odoo reported, and stays while projects are linked.
create or replace function public.set_odoo_analytic_plan(p_org_id uuid, p_actor_id uuid, p_plan_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_integration_link_actor(p_org_id, p_actor_id, null);
  perform public.assert_odoo_activated(p_org_id);
  perform 1 from public.external_org_bindings where org_id = p_org_id and external_tier = 'odoo' and status = 'active' for update;   -- serialises with a link
  if p_plan_id !~ '^[0-9]{1,9}$' or not exists (select 1 from public.external_master_records
       where org_id = p_org_id and external_tier = 'odoo' and kind = 'analytic_plan' and external_id = p_plan_id and active and tombstoned_at is null) then
    raise exception 'not an analytic plan of this connection' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.external_project_bindings where org_id = p_org_id and external_tier = 'odoo'
              and coalesce(config ->> 'plan_id', '') <> p_plan_id) then
    raise exception 'unlink the projects before changing the plan' using errcode = 'P0001';
  end if;
  update public.external_org_bindings
     set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('analytic_plan_id', p_plan_id::int, 'analytic_plan_id_set_by', p_actor_id, 'analytic_plan_id_set_at', now())
   where org_id = p_org_id and external_tier = 'odoo' and status = 'active';
  perform public.log_audit('integration.odoo.plan', p_org_id, p_actor_id, null, jsonb_build_object('plan', p_plan_id));
end $$;

revoke all on function public.odoo_link_cost_account_core(uuid,uuid,uuid,text), public.connect_link_odoo_project(uuid,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.link_odoo_cost_account(uuid,uuid,uuid,text), public.unlink_odoo_cost_account(uuid,uuid,uuid),
  public.set_odoo_analytic_plan(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.link_odoo_cost_account(uuid,uuid,uuid,text), public.unlink_odoo_cost_account(uuid,uuid,uuid),
  public.set_odoo_analytic_plan(uuid,uuid,text) to service_role;

-- ECA-2's accept and unlink, with the Odoo project arm (the only change from migration 0480's bodies).
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

revoke all on function public.accept_connect_proposals(text,text,uuid[],int), public.unlink_connect_match(uuid) from public, anon;
grant execute on function public.accept_connect_proposals(text,text,uuid[],int), public.unlink_connect_match(uuid) to authenticated;

-- ===== Part 2 (#1504 S7): the one-time map. Three keys, each written whole by an Admin or Finance user. =====
-- The setter is the only writer of these binding-config keys (ids only: names come from the role-gated directory), and it is
-- an allow-list, not a patch: any other key is refused, so it cannot overwrite the connection's database, plan or company.
create or replace function public.set_odoo_org_config(p_org_id uuid, p_actor_id uuid, p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_state jsonb; v_kind text; v_ids text[];
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
    v_ids := array[p_value #>> '{}'];
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
    select array_agg(e.value #>> '{}') into v_ids from jsonb_each(p_value) e;
  end if;
  -- every id is a live record of the right kind in THIS org's mirror (accounts: not a group or off-balance account)
  if exists (select 1 from unnest(coalesce(v_ids, '{}'::text[])) v where not exists (
       select 1 from public.external_master_records m
        where m.org_id = p_org_id and m.external_tier = 'odoo' and m.kind = v_kind and m.external_id = v and m.active and m.tombstoned_at is null
          and (v_kind <> 'account' or coalesce(m.attrs ->> 'account_type', '') <> all (array['view', 'off_balance'])))) then
    raise exception 'not a usable %', v_kind using errcode = 'P0001';
  end if;
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
