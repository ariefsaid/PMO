alter table public.external_sync_watermarks
  add column last_error text,
  add column last_error_at timestamptz;
