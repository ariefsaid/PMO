-- Rollback of 1451: removes the light-account guard line it put at the top of each function's outer block, leaving the
-- rest of the body as shipped (CREATE OR REPLACE keeps signature, language, volatility, search_path and grants).
-- A listed function that no longer carries the guard, is not plpgsql or cannot be rewritten RAISES: the rollback fails,
-- never skips.
do $$
declare
  v_names text[] := array[
    'dsr_stock_status', 'get_reorder_suggestions', 'get_stock_free_reserved',
    'get_stock_movement_proof_status', 'get_stock_on_hand', 'get_work_order_material_vs_progress',
    'get_work_order_returnable', 'get_work_order_stock_balance', 'three_way_match_held_count'];
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
      if r.prosrc not like '%assert_not_light%' then
        raise exception '2710 rollback: % carries no guard, nothing to undo', r.proname;
      end if;
      if r.lanname <> 'plpgsql' then
        raise exception '2710 rollback: % is language %, cannot rewrite', r.proname, r.lanname;
      end if;
      v_def := pg_get_functiondef(r.oid);
      v_body := regexp_replace(r.prosrc, E'\n[ \t]*perform public[.]assert_not_light[(][)];\n', E'\n', 'g');
      if v_body = r.prosrc or position(r.prosrc in v_def) = 0 then
        raise exception '2710 rollback: % could not be rewritten', r.proname;
      end if;
      v_new := overlay(v_def placing v_body from position(r.prosrc in v_def) for length(r.prosrc));
      begin
        execute v_new;
      exception when others then
        raise exception '2710 rollback: rewriting % failed: %', r.proname, sqlerrm;
      end;
    end loop;
    if v_found = 0 then
      raise exception '2710 rollback: function % not found in public', v_n;
    end if;
  end loop;
end $$;
