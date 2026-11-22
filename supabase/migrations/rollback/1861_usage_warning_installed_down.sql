-- Reverses 1861_usage_warning_installed.sql (run 1862's rollback first). Alerts raised from site reports are removed: they have no request.
drop function if exists public.mrq_installed_for(uuid, uuid[]);
drop trigger if exists daily_site_reports_zz_usage_check on public.daily_site_reports;
drop function if exists public.usage_check_trigger();
drop function if exists public.usage_check_work_order(uuid);
drop function if exists public.usage_warning_recipient(uuid, uuid);
drop function if exists public.usage_installed_qty(uuid, uuid);
delete from public.material_request_usage_alerts;
drop index if exists public.material_request_usage_alerts_report_idx;
alter table public.material_request_usage_alerts
  drop constraint material_request_usage_alerts_once,
  drop column report_id,
  add column slot smallint not null default 1 check (slot in (1, 2)),
  add column request_id uuid references public.material_requests(id),
  add constraint material_request_usage_alerts_once unique (work_order_id, item_id, slot);
alter table public.material_request_usage_alerts alter column slot drop default;
create index material_request_usage_alerts_request_idx on public.material_request_usage_alerts (request_id);
