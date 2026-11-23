-- Reverses 1861_usage_installed_source_setting.sql (run 1862's rollback first: it reads the column).
drop function if exists public.set_usage_installed_source(text);
alter table public.material_request_settings drop column if exists usage_installed_source;
