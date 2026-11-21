-- 1219 (#2710): extends the light-account narrowing of 1206/1209 to the tables and read functions added by 1148-1187.
-- Rollback: supabase/migrations/rollback/1219_light_accounts_land_carry_down.sql
-- Tables: the same RESTRICTIVE `light_account_deny` policy as 1206 (every row and every write denied to a light account; for anyone
-- else `(select actor_is_light()) is not true` is true, so the outcome is unchanged).
-- Functions: the same mechanical rewrite as 1209 (plpgsql -> `perform public.assert_not_light();` first in the outer block;
-- sql -> `select q.* from (<body>) q where public.assert_not_light()`), keeping signature, language, volatility, search_path and
-- grants. An overload whose body already contains assert_not_light is left alone. A missing name, an unsupported language or a
-- failed rewrite RAISES: the migration fails, never skips.
do $$
declare t text;
begin
  foreach t in array array[
    'boq_quantity_versions',
    'client_requisition_events',
    'client_requisition_lines',
    'client_requisition_pickups',
    'client_requisitions',
    'consumable_usage_standards',
    'crew_tool_lines',
    'crew_tool_report_files',
    'crew_tool_reports',
    'document_categories',
    'document_category_roles',
    'org_crew_tool_settings',
    'quantity_change_request_events',
    'quantity_change_request_files',
    'quantity_change_request_lines',
    'quantity_change_requests',
    'quantity_forecasts',
    'quantity_overrun_notices',
    'subcontract_backcharges',
    'subcontract_certificate_backcharges',
    'subcontract_certificate_claims',
    'subcontract_certificate_deselections',
    'subcontract_certificate_lines',
    'subcontract_certificates',
    'subcontractor_rate_lines',
    'third_party_inspection_files',
    'third_party_inspections',
    'work_order_consumable_plan_lines',
    'work_order_section_material_plan',
    'work_order_section_readiness_events',
    'work_order_sections']
  loop
    execute format(
      'create policy light_account_deny on public.%I as restrictive for all to authenticated using ((select public.actor_is_light()) is not true)', t);
  end loop;
end $$;

do $$
declare
  v_names text[] := array[
    'bill_subcontract_certificate',
    'budget_attributed_year_sums',
    'cus_get_plan',
    'mrq_section_plan_for',
    'qcr_approval_state',
    'qcr_over_contract',
    'qcr_work_order_budget',
    'subcontract_certificate_view',
    'tpi_costs',
    'work_order_section_material_check'];
  v_n text; v_found int;
  r record; v_def text; v_new text; v_body text;
begin
  foreach v_n in array v_names loop
    v_found := 0;
    for r in
      select p.oid, p.proname, l.lanname, p.prosrc
        from pg_proc p join pg_language l on l.oid = p.prolang
       where p.pronamespace = 'public'::regnamespace and p.proname = v_n
    loop
      v_found := v_found + 1;
      if r.prosrc like '%assert_not_light%' then
        continue;
      end if;
      if coalesce(btrim(r.prosrc), '') = '' then
        raise exception '1219: % has no source body, cannot guard', r.proname;
      end if;
      v_def := pg_get_functiondef(r.oid);
      if r.lanname = 'plpgsql' then
        v_body := regexp_replace(r.prosrc, '(^|\n)(\s*begin\s*)(\n|$)', E'\\1\\2\\3  perform public.assert_not_light();\n', 'i');
      elsif r.lanname = 'sql' then
        v_body := E'\n  select q.* from (' || regexp_replace(btrim(r.prosrc, E' \n\t\r;'), ';\s*$', '') ||
                  E'\n) q where public.assert_not_light()\n';
      else
        raise exception '1219: % is language %, cannot guard', r.proname, r.lanname;
      end if;
      if v_body = r.prosrc or position(r.prosrc in v_def) = 0 then
        raise exception '1219: % could not be rewritten', r.proname;
      end if;
      v_new := overlay(v_def placing v_body from position(r.prosrc in v_def) for length(r.prosrc));
      begin
        execute v_new;
      exception when others then
        raise exception '1219: rewriting % failed: %', r.proname, sqlerrm;
      end;
    end loop;
    if v_found = 0 then
      raise exception '1219: function % not found in public', v_n;
    end if;
  end loop;
end $$;
