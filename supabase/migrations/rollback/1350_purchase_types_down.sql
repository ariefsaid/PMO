-- 1350_purchase_types_down.sql — reverses 1350 (#2697). Run 1351's rollback first. Refused while types exist (export and clear first).
do $$ begin
  if exists (select 1 from public.purchase_types) then
    raise exception 'rollback refused: purchase types exist — export and remove them first';
  end if;
end $$;
drop function if exists public.set_purchase_type_active(uuid, boolean);
drop function if exists public.upsert_purchase_type(uuid, text, text, boolean, integer);
drop function if exists public.set_purchase_types_enabled(boolean);
drop function if exists public.purchase_types_enabled(uuid);
drop table if exists public.purchase_types;
drop table if exists public.org_purchase_type_settings;
