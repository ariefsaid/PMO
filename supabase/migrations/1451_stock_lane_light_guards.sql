-- 1451 (#2710): the light-account guard on the stock-and-purchasing lane's data-returning read RPCs.
-- 1209 put `perform public.assert_not_light();` at the top of every data-returning security-definer RPC. Three of the
-- functions it lists are restated whole by the lane from bodies written before 1209 (1300 get_stock_on_hand; 1300 then
-- 1309 get_reorder_suggestions; 1313 get_work_order_stock_balance), so the injected guard no longer exists in the live
-- body. The lane's own data reads (1311, 1317, 1324, 1341, 1357) never had it.
-- Same mechanical rewrite as 1209/1219, against the function in place: plpgsql -> `perform public.assert_not_light();`
-- as the first statement of the outer block; sql -> `select q.* from (<body>) q where public.assert_not_light()`.
-- Signature, language, volatility, search_path and grants are kept (CREATE OR REPLACE). A body that already carries the
-- guard is skipped; a missing name or a body that cannot be rewritten RAISES, so the migration fails, never skips.
-- Not guarded on purpose: the lane's configuration predicates (dsr_stock_issue_on, stock_reservations_on,
-- stock_wo_transfers_on, stock_transfer_mode_of, stock_proof_timing_of, get_purchase_line_planning) return a setting,
-- the handover path (stock_can_handover, stock_handover_readable, record_stock_handover) stays open because a field
-- account receives deliveries, and the lane's write RPCs keep 0173's active-member gate plus the restrictive
-- light_account_deny policies of 1206/1219 instead of a second call in the body.
-- Proven by supabase/tests/2710_light_accounts.test.sql (AC-LA-013) and the lane's own suites.
-- Reversal: rollback/1451_stock_lane_light_guards_down.sql.
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
      if r.prosrc like '%assert_not_light%' then
        continue;
      end if;
      if coalesce(btrim(r.prosrc), '') = '' then
        raise exception '2710: % has no source body, cannot guard', r.proname;
      end if;
      v_def := pg_get_functiondef(r.oid);
      if r.lanname = 'plpgsql' then
        v_body := regexp_replace(r.prosrc, '(^|\n)(\s*begin\s*)(\n|$)', E'\\1\\2\\3  perform public.assert_not_light();\n', 'i');
      elsif r.lanname = 'sql' then
        v_body := E'\n  select q.* from (' || regexp_replace(btrim(r.prosrc, E' \n\t\r;'), ';\s*$', '') ||
                  E'\n) q where public.assert_not_light()\n';
      else
        raise exception '2710: % is language %, cannot guard', r.proname, r.lanname;
      end if;
      if v_body = r.prosrc or position(r.prosrc in v_def) = 0 then
        raise exception '2710: % could not be rewritten', r.proname;
      end if;
      v_new := overlay(v_def placing v_body from position(r.prosrc in v_def) for length(r.prosrc));
      begin
        execute v_new;
      exception when others then
        raise exception '2710: rewriting % failed: %', r.proname, sqlerrm;
      end;
    end loop;
    if v_found = 0 then
      raise exception '2710: function % not found in public', v_n;
    end if;
  end loop;
end $$;
