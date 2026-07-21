-- 0138_clickup_webhook_replay_guard.sql
-- Replay protection for the verified raw ClickUp request body. A global digest is intentional:
-- ClickUp retries the same signed delivery with the same body, and the envelope has no event id or
-- event timestamp that can safely distinguish a retry from a new identical delivery. The body includes
-- team_id/webhook_id, so a digest collision across workspaces is not a practical concern. Keeping the
-- digest unbounded also avoids expiring a delayed retry into a duplicate apply.

alter table public.clickup_webhook_inbox
  add column raw_body_sha256 text;

create unique index clickup_webhook_inbox_raw_body_sha256_uidx
  on public.clickup_webhook_inbox (raw_body_sha256)
  where raw_body_sha256 is not null;

comment on column public.clickup_webhook_inbox.raw_body_sha256 is
  'SHA-256 hex digest of the verified raw request body; unique replay key for ClickUp retries.';
