alter table public.external_sync_watermarks
  drop column last_error,
  drop column last_error_at;
