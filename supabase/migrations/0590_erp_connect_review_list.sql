-- ECA-2 per-row review: bounded exclusion accepts, staged-record search and safe link history.
-- The staged search is scoped to one run/kind and indexed for substring name/code lookup.
create extension if not exists pg_trgm;

create index erp_connect_staged_search on public.erp_connect_staged using gin (
  lower(coalesce(external_id, '') || ' ' || coalesce(row->>'name', '') || ' ' || coalesce(row->>'employeeName', '') || ' ' ||
        coalesce(row->>'accountName', '') || ' ' || coalesce(row->>'code', '') || ' ' || coalesce(row->>'number', '')) gin_trgm_ops
);

-- Preserve only the newest complete staged snapshot for the setup picker.
create or replace function public.replace_connect_proposals(p_org_id uuid, p_tier text, p_run_id uuid, p_kind text, p_rows jsonb, p_last boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.erp_connect_runs%rowtype;
begin
  select * into v_run from public.erp_connect_runs where id = p_run_id and org_id = p_org_id and external_tier = p_tier and state in ('staging','proposing') for update;
  if not found then raise exception 'no open run for this organisation'; end if;
  insert into public.erp_connect_proposals (org_id, binding_id, external_tier, run_id, kind, outcome, identity, pmo_ids, external_ids, match_key, reason, reason_text, snapshot)
    select p_org_id, v_run.binding_id, p_tier, p_run_id, p_kind, x.outcome,
           x.outcome || '|' || to_jsonb(x.pmo)::text || '|' || to_jsonb(x.ext)::text, x.pmo, x.ext, x.key, x.reason, x.reason_text, x.snapshot
      from (select r->>'outcome' as outcome,
                   array(select jsonb_array_elements_text(coalesce(r->'pmoIds','[]')) order by 1) as pmo,
                   array(select jsonb_array_elements_text(coalesce(r->'externalIds','[]')) order by 1) as ext,
                   r->>'key' as key, r->>'reason' as reason, r->>'reasonText' as reason_text,
                   coalesce(r->'snapshot','{}'::jsonb) as snapshot
              from jsonb_array_elements(p_rows) r) x
  on conflict (org_id, external_tier, kind, identity) do update
    set run_id = excluded.run_id, snapshot = excluded.snapshot, reason = excluded.reason, reason_text = excluded.reason_text
    where public.erp_connect_proposals.state = 'open';
  if p_last then
    delete from public.erp_connect_proposals
     where org_id = p_org_id and external_tier = p_tier and kind = p_kind and state = 'open' and run_id is not null and run_id <> p_run_id;
    update public.erp_connect_census c
       set linked_count = (select count(*) from public.erp_connect_proposals p
                            where p.org_id = p_org_id and p.external_tier = p_tier and p.kind = p_kind and p.outcome = 'link'),
           inactive_erp_count = (select count(*) from public.erp_connect_staged s
                                  where s.run_id = p_run_id and s.kind = p_kind and s.row->>'active' = 'false')
     where c.org_id = p_org_id and c.external_tier = p_tier and c.kind = p_kind;
    update public.erp_connect_runs
       set proposed_kinds = case when p_kind = any(proposed_kinds) then proposed_kinds else proposed_kinds || p_kind end,
           failed_ticks = 0
     where id = p_run_id;
    update public.erp_connect_runs set state = 'ready'
     where id = p_run_id and state in ('staging','proposing')
       and (select count(*) from unnest(array['party','item','project','employee','account']) k where k = any(proposed_kinds)) = 5;
    if found then
      delete from public.erp_connect_staged where org_id = p_org_id and run_id <> p_run_id;
      perform public.settle_connect_run(p_org_id, p_tier);
    end if;
  end if;
end $$;

-- The complete run now holds the current staged search source, so disconnect must purge ready-run pages too.
create or replace function public.purge_connect_setup_on_disconnect() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.erp_connect_proposals where org_id = new.org_id and external_tier = new.external_tier and state = 'open';
  delete from public.erp_connect_staged where run_id in (select id from public.erp_connect_runs
    where org_id = new.org_id and external_tier = new.external_tier);
  update public.erp_connect_runs set state = 'failed', error_class = 'disconnected', finished_at = now()
   where org_id = new.org_id and external_tier = new.external_tier and state in ('staging','proposing');
  delete from public.erp_connect_census where org_id = new.org_id and external_tier = new.external_tier;
  return null;
end $$;

drop function public.accept_connect_proposals(text, text, uuid[], int);
create function public.accept_connect_proposals(p_tier text, p_kind text default null, p_ids uuid[] default null, p_batch int default 500, p_exclude uuid[] default null)
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

create or replace function public.connect_proposal_counts(p_tier text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_role text := public.auth_role()::text; v_counts jsonb;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.external_org_bindings where org_id = v_org and external_tier = p_tier and status = 'active') then
    raise exception 'no active connection for this ERP' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_object_agg(k.kind, jsonb_build_object(
    'link', k.link, 'bring_in', k.bring_in, 'send', k.send, 'review', k.review, 'applied_link', k.applied_link
  )), '{}'::jsonb)
    into v_counts
    from (select kind,
                 count(*) filter (where state = 'open' and outcome = 'link') as link,
                 count(*) filter (where state = 'open' and outcome = 'bring-in') as bring_in,
                 count(*) filter (where state = 'open' and outcome = 'send') as send,
                 count(*) filter (where state = 'open' and outcome = 'review') as review,
                 count(*) filter (where state = 'applied' and outcome = 'link') as applied_link
            from public.erp_connect_proposals
           where org_id = v_org and external_tier = p_tier and (v_role = 'Admin' or kind = 'account')
           group by kind) k;
  return coalesce(v_counts, '{}'::jsonb);
end $$;

create or replace function public.search_connect_staged(p_tier text, p_kind text, p_query text, p_limit int default 20)
returns table(external_id text, name text, code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_role text := public.auth_role()::text;
        v_binding uuid; v_run uuid; v_query text := lower(btrim(coalesce(p_query, ''))); v_pattern text;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('party','item','project','employee','account') then raise exception 'unknown kind' using errcode = '22023'; end if;
  if v_role = 'Finance' and p_kind <> 'account' then raise exception 'not allowed' using errcode = '42501'; end if;
  select id into v_binding from public.external_org_bindings where org_id = v_org and external_tier = p_tier and status = 'active';
  if v_binding is null then raise exception 'no active connection for this ERP' using errcode = 'P0001'; end if;
  select id into v_run from public.erp_connect_runs
   where org_id = v_org and binding_id = v_binding and external_tier = p_tier
   order by started_at desc, id desc limit 1;
  if v_run is null then return; end if;
  if length(v_query) < 2 then return; end if;
  v_pattern := '%' || replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  return query
    select s.external_id,
           coalesce(nullif(s.row->>'name', ''), nullif(s.row->>'employeeName', ''), nullif(s.row->>'accountName', ''), s.external_id),
           coalesce(nullif(s.row->>'code', ''), nullif(s.row->>'number', ''), s.external_id)
      from public.erp_connect_staged s
     where s.run_id = v_run and s.org_id = v_org and s.kind = p_kind
       and lower(coalesce(s.external_id, '') || ' ' || coalesce(s.row->>'name', '') || ' ' || coalesce(s.row->>'employeeName', '') || ' ' ||
                 coalesce(s.row->>'accountName', '') || ' ' || coalesce(s.row->>'code', '') || ' ' || coalesce(s.row->>'number', '')) like v_pattern escape E'\\'
     order by lower(coalesce(s.row->>'name', s.external_id)), s.external_id
     limit least(greatest(coalesce(p_limit, 20), 1), 20);
end $$;

create or replace function public.decide_connect_review(p_id uuid, p_choice jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_role text := public.auth_role()::text;
        r public.erp_connect_proposals%rowtype; v_reason text; v_pmo text := p_choice->>'pmoId'; v_ext text := p_choice->>'externalId';
        v_action text := p_choice->>'action'; v_snapshot jsonb; v_accept jsonb;
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
    select s.row into v_snapshot from public.erp_connect_staged s
     where s.org_id = v_org and s.run_id = (select x.id from public.erp_connect_runs x
       where x.org_id = v_org and x.binding_id = r.binding_id and x.external_tier = r.external_tier order by x.started_at desc, x.id desc limit 1)
       and s.kind = r.kind and s.external_id = v_ext;
    if not found then raise exception 'That record is not available for this kind' using errcode = '22023'; end if;
    v_reason := public.apply_connect_link(v_org, r.external_tier, r.kind, v_pmo, v_ext,
      coalesce(v_snapshot, '{}'::jsonb) || jsonb_build_object('reviewed', true), v_actor);
    if v_reason is not null then raise exception '%', v_reason using errcode = 'P0001'; end if;
    update public.erp_connect_proposals set state = 'applied', outcome = 'link', pmo_ids = array[v_pmo], external_ids = array[v_ext],
      snapshot = coalesce(v_snapshot, '{}'::jsonb), reason_text = null, decided_by = v_actor, decided_at = now() where id = p_id;
  elsif v_action = 'bring-in' then
    if cardinality(r.pmo_ids) <> 0 or coalesce(v_ext, '') = '' then raise exception 'This row cannot be brought in' using errcode = '22023'; end if;
    select s.row into v_snapshot from public.erp_connect_staged s
     where s.org_id = v_org and s.run_id = (select x.id from public.erp_connect_runs x
       where x.org_id = v_org and x.binding_id = r.binding_id and x.external_tier = r.external_tier order by x.started_at desc, x.id desc limit 1)
       and s.kind = r.kind and s.external_id = v_ext;
    if not found then raise exception 'That record is not available for this kind' using errcode = '22023'; end if;
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
       p.pmo_ids[1]);
  return v_ids;
end $$;

revoke all on function public.accept_connect_proposals(text,text,uuid[],int,uuid[]),
  public.connect_proposal_counts(text), public.search_connect_staged(text,text,text,int),
  public.list_unlinkable_connect_matches(uuid[]) from public, anon;
grant execute on function public.accept_connect_proposals(text,text,uuid[],int,uuid[]),
  public.connect_proposal_counts(text), public.search_connect_staged(text,text,text,int),
  public.list_unlinkable_connect_matches(uuid[]) to authenticated;
