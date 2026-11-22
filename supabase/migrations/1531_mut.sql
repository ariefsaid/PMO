do $$ declare r record; v_def text; v_new text; begin
  for r in select p.oid, p.prosrc from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='create_payment' loop
    v_def := pg_get_functiondef(r.oid);
    v_new := overlay(v_def placing regexp_replace(r.prosrc, E'\n[ \t]*perform public[.]assert_not_light[(][)];\n', E'\n', 'g') from position(r.prosrc in v_def) for length(r.prosrc));
    if v_new = v_def then raise exception 'mut: nothing removed'; end if;
    execute v_new;
  end loop; end $$;
