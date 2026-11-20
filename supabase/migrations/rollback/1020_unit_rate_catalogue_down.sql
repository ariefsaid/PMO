-- 1020_unit_rate_catalogue_down.sql — reverses 1020. Refuses while a contract line is priced from the catalogue.
do $$ begin
  if exists (select 1 from public.boq_items where catalogue_item_id is not null) then
    raise exception 'contract lines priced from the catalogue exist; clear their catalogue link before rolling back 1020; rollback refused' using errcode = 'P0001';
  end if;
end $$;
drop trigger if exists boq_items_zz_catalogue_project on public.boq_items;
drop function if exists public.check_boq_catalogue_project();
drop function if exists public.save_boq_line_from_catalogue(uuid,uuid,jsonb,uuid,uuid,date);
drop function if exists public.price_boq_line_from_catalogue(uuid, uuid, uuid, date);
drop function if exists public.rate_catalogue_upsert_item(uuid, jsonb);
drop function if exists public.rate_catalogue_add_variants(uuid, text[]);
drop function if exists public.rate_catalogue_set_default_variant(uuid, uuid);
drop function if exists public.rate_catalogue_writer_check(uuid);
drop function if exists public.rate_catalogue_rate_at(uuid, uuid, date);
alter table public.boq_items drop constraint if exists boq_items_catalogue_trio,
  drop column if exists catalogue_priced_as_of, drop column if exists catalogue_variant_id, drop column if exists catalogue_item_id;
drop table if exists public.rate_catalogue_stage_weights;
drop table if exists public.rate_catalogue_rates;
drop table if exists public.rate_catalogue_items;
drop table if exists public.rate_catalogue_variants;
