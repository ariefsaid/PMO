-- 1345_purchase_line_categories_down.sql — reverses 1345. Run 1346's rollback first (lines reference the list).
drop function if exists public.archive_purchase_line_category(uuid);
drop function if exists public.set_purchase_line_category(uuid, text, integer);
drop function if exists public.set_purchase_line_planning(boolean);
drop function if exists public.get_purchase_line_planning();
drop table if exists public.purchase_line_categories;
alter table public.organizations drop column if exists purchase_line_planning;
