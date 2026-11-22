create or replace function public.zzz_helper_probe() returns boolean language sql as 'select true';
do $$
declare o oid; d text;
begin
  select oid into o from pg_proc where pronamespace='public'::regnamespace and proname='dsr_photo_stored' limit 1;
  d := pg_get_functiondef(o);
  execute format('drop function public.dsr_photo_stored(%s)', pg_get_function_identity_arguments(o));
  d := regexp_replace(d, 'RETURNS boolean', 'RETURNS SETOF boolean', 'i');
  execute d;
end $$;
