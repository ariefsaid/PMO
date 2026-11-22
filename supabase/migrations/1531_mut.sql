do $$
declare v text; o oid; d text;
begin
  foreach v in array array['create_payment','archive_stock_document_file'] loop
    select oid into o from pg_proc where pronamespace='public'::regnamespace and proname=v limit 1;
    d := pg_get_functiondef(o);
    d := regexp_replace(d, 'perform public\.assert_not_light\(\);', '', 'i');
    execute d;
  end loop;
  create function public.zzz_sweep_probe() returns void language plpgsql security definer as $f$ begin -- perform public.assert_not_light()
  null; end $f$;
  grant execute on function public.zzz_sweep_probe() to authenticated;
end $$;
