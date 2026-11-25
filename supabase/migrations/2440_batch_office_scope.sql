-- Batch integration: retain current bodies and apply office scope consistently.
-- Reverse: rollback/2440_batch_office_scope_down.sql.
do $$
declare
  v_names text[] := array['get_stock_movement_proof_status', 'get_work_order_material_completion', 'po_needed_by_required_from_of', 'set_po_needed_by_required', 'set_procurement_needed_by', 'set_stock_handover_scope', 'stock_handover_scope_of'];
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
        raise exception '2440: % has no source body, cannot guard', r.proname;
      end if;
      v_def := pg_get_functiondef(r.oid);
      if r.lanname = 'plpgsql' then
        v_body := regexp_replace(r.prosrc, '(^|\n)(\s*begin\s*)(\n|$)', E'\\1\\2\\3  perform public.assert_not_light();\n', 'i');
      elsif r.lanname = 'sql' then
        v_body := E'\n  select q.* from (' || regexp_replace(btrim(r.prosrc, E' \n\t\r;'), ';\s*$', '') ||
                  E'\n) q where public.assert_not_light()\n';
      else
        raise exception '2440: % is language %, cannot guard', r.proname, r.lanname;
      end if;
      if v_body = r.prosrc or position(r.prosrc in v_def) = 0 then
        raise exception '2440: % could not be rewritten', r.proname;
      end if;
      v_new := overlay(v_def placing v_body from position(r.prosrc in v_def) for length(r.prosrc));
      begin
        execute v_new;
      exception when others then
        raise exception '2440: rewriting % failed: %', r.proname, sqlerrm;
      end;
    end loop;
    if v_found = 0 then
      raise exception '2440: function % not found in public', v_n;
    end if;
  end loop;
end $$;

create policy light_account_deny_select on public.org_setup_workflow_settings
 as restrictive for select to authenticated using ((select public.actor_is_light()) is not true);
update public.record_history_config set captured = captured || '{"needed_by":"date"}'::jsonb where table_name = 'procurements';
