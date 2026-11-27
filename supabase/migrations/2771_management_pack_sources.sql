-- Batch transport for the existing plan-versus-actual readers; figures remain in rollupProject.
-- Rollback: rollback/2771_management_pack_sources_down.sql
begin;
create function public.project_plan_actual_sources(p_project_ids uuid[])
returns table(project_id uuid, sources jsonb)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_source text;
  v_data jsonb;
  v_sources jsonb;
  v_restricted boolean;
begin
  foreach v_id in array p_project_ids loop
    v_sources := '{}'::jsonb;
    v_restricted := false;
    foreach v_source in array array['orders','billing','money','finances','plans','split'] loop
      if v_restricted and v_source in ('plans','split') then
        v_sources := v_sources || jsonb_build_object(v_source, jsonb_build_object('data', '[]'::jsonb));
        continue;
      end if;
      begin
        case v_source
        when 'orders' then
          select coalesce(jsonb_agg(to_jsonb(q) order by q.id), '[]'::jsonb) into v_data
          from (select id, wo_number, title, status, currency from public.work_orders w where w.project_id = v_id) q;
        when 'billing' then
          select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_data
          from (select work_order_id, b.project_id, status, currency, order_net, invoiced, pending, paid,
                       remaining, figures_complete, line_count, unpaid_count
                  from public.work_order_billing b where b.project_id = v_id limit 501) q;
        when 'money' then
          select coalesce(jsonb_agg(to_jsonb(q) order by q.record_id, q.source), '[]'::jsonb) into v_data
            from public.work_order_cost_amounts(v_id) q;
        when 'finances' then
          v_data := public.get_project_finances(v_id);
        when 'plans' then
          select coalesce(jsonb_agg(to_jsonb(q) order by q.id), '[]'::jsonb) into v_data
          from (select id, work_order_id, section_id, discipline_id, kind, value::text, note
                  from public.work_order_plan_lines p where p.project_id = v_id) q;
        when 'split' then
          select coalesce(jsonb_agg(to_jsonb(q) order by q.work_order_id), '[]'::jsonb) into v_data
          from (select work_order_id, percent from public.project_shared_cost_splits s where s.project_id = v_id) q;
        end case;
        v_sources := v_sources || jsonb_build_object(v_source, jsonb_build_object('data', v_data));
      exception when others then
        v_sources := v_sources || jsonb_build_object(v_source,
          jsonb_build_object('error', jsonb_build_object('code', sqlstate, 'message', sqlerrm)));
        if v_source = 'money' and sqlstate = '42501' then v_restricted := true; end if;
      end;
    end loop;
    project_id := v_id;
    sources := v_sources;
    return next;
  end loop;
end;
$$;

-- One JSON value avoids the PostgREST row cap on both project and source cardinality.
create function public.get_projects_plan_actual_sources(p_project_ids uuid[]) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(project_id::text, sources), '{}'::jsonb)
    from public.project_plan_actual_sources(p_project_ids)
$$;
revoke all on function public.project_plan_actual_sources(uuid[]), public.get_projects_plan_actual_sources(uuid[]) from public, anon;
grant execute on function public.project_plan_actual_sources(uuid[]), public.get_projects_plan_actual_sources(uuid[]) to authenticated, service_role;
commit;
