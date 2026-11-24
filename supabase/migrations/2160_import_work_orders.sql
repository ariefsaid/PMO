-- 2160_import_work_orders.sql — import a project's work orders from a spreadsheet, all or nothing.
-- Spec: docs/specs/work-order-import.spec.md (FR-WOI-001..007). Proven by supabase/tests/2160_import_work_orders.test.sql.
-- SECURITY INVOKER on purpose: every insert runs under the caller's own row-level security. The importer adds its
-- narrower audience (Admin or the project's own Project Manager) and the Admin-controlled organisation opt-in; the
-- ordinary "New work order" create policy stays unchanged. Draft, area/group and allocation guards still fire unchanged.
-- A work order starts as a Draft (status is not sent); `wo_number` is minted at issue, never here (0193).
-- Reverse: supabase/migrations/rollback/2160_import_work_orders_down.sql.

create or replace function public.import_work_orders(p_project uuid, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r jsonb;
  s jsonb;
  n int := 0;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_lines int := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'IMPORT_EMPTY: there are no work orders to import' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'IMPORT_TOO_MANY: import at most 500 work orders at a time' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'IMPORT_PROJECT: the project was not found' using errcode = 'P0002';
  end if;
  if public.auth_role() not in ('Admin', 'Project Manager') then
    raise exception 'only the assigned Project Manager or an Admin may import work orders' using errcode = '42501';
  end if;
  if not coalesce((select s.enabled from public.org_setup_workflow_settings s where s.org_id = public.auth_org_id()), false) then
    raise exception 'setup workflows are disabled for this organisation' using errcode = '42501';
  end if;
  if public.auth_role() = 'Project Manager'
     and not exists (select 1 from public.projects p where p.id = p_project and p.org_id = public.auth_org_id()
       and p.project_manager_id = auth.uid()) then
    raise exception 'only the assigned Project Manager may import work orders for this project' using errcode = '42501';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    n := n + 1;
    begin
      insert into public.work_orders (project_id, title, client_po_number, description, order_value, tax_treatment, tax_amount,
                                      currency, start_date, end_date)
      values (p_project, r->>'title', nullif(btrim(r->>'client_po_number'), ''), nullif(btrim(r->>'description'), ''),
              (r->>'order_value')::numeric, r->>'tax_treatment', coalesce((r->>'tax_amount')::numeric, 0),
              coalesce(nullif(btrim(r->>'currency'), ''), 'XXX'),
              nullif(r->>'start_date', '')::date, nullif(r->>'end_date', '')::date)
      returning id into v_id;

      if nullif(r->>'area_id', '') is not null then
        perform public.set_work_order_area_group(v_id, (r->>'area_id')::uuid, null, true, false);
      end if;

      for s in select value from jsonb_array_elements(coalesce(r->'lines', '[]'::jsonb)) loop
        insert into public.work_order_lines (work_order_id, boq_item_id, quantity)
        values (v_id, (s->>'boq_item_id')::uuid, (s->>'quantity')::numeric);
        v_lines := v_lines + 1;
      end loop;
      v_ids := v_ids || v_id;
    exception when others then
      -- Name the row ("IMPORT_ROW: row 3: …"), keep the original error class: the whole call rolls back, so nothing is saved.
      raise exception 'IMPORT_ROW: row %: %', n, sqlerrm using errcode = sqlstate;
    end;
  end loop;

  return jsonb_build_object('created', n, 'lines', v_lines, 'ids', to_jsonb(v_ids));
end $$;

revoke all on function public.import_work_orders(uuid, jsonb) from public, anon;
grant execute on function public.import_work_orders(uuid, jsonb) to authenticated;
comment on function public.import_work_orders(uuid, jsonb) is
  'FR-WOI-003: creates Draft work orders (with optional area and scope lines) for one project in one transaction; any row''s failure rolls the whole batch back. SECURITY INVOKER: importer audience and opt-in are checked before writes, then caller RLS applies.';
