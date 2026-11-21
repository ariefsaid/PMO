-- Reverse of 1164. Documents keep their text category column; only the rules and the category list are lost.
drop trigger if exists organizations_seed_document_categories on public.organizations;
drop function if exists public.seed_document_categories_trigger();
drop function if exists public.seed_document_categories(uuid);
drop table if exists public.document_category_roles;
drop table if exists public.document_categories;
