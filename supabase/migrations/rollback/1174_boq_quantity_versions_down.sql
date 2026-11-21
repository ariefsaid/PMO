-- Reverses 1174_boq_quantity_versions.sql. Versions are history; the current quantity stays on boq_items.
drop trigger if exists boq_items_zz_quantity_setup_edit on public.boq_items;
drop trigger if exists boq_items_zz_quantity_guard on public.boq_items;
drop trigger if exists boq_items_zz_quantity_baseline on public.boq_items;
drop function if exists public.boq_quantity_setup_edit();
drop function if exists public.guard_boq_quantity_change();
drop function if exists public.boq_item_quantity_locked(uuid);
drop function if exists public.boq_quantity_baseline();
drop trigger if exists boq_quantity_versions_no_truncate on public.boq_quantity_versions;
drop trigger if exists boq_quantity_versions_immutable on public.boq_quantity_versions;
drop table if exists public.boq_quantity_versions;
drop function if exists public.refuse_boq_quantity_version_change();
