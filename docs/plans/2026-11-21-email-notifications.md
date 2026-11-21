# Plan: email notifications (#2711)

Spec: `docs/specs/email-notifications.spec.md`. Test-first throughout.

## Design
Notification row (existing) -> AFTER INSERT trigger -> `email_outbox` row (unique per notification) -> pg_cron tick (vault url + secret, same null-safe pattern as migration 0083) -> edge function `email-notify` claims rows, sends through Resend, marks sent. No double send: unique(notification_id), lease claim with `for update skip locked`, Idempotency-Key = outbox id.

## Migrations (range 1220-1224; rollbacks in `supabase/migrations/rollback/<n>_<slug>_down.sql`)
- `1220_email_notification_tables.sql` - `email_event_settings` (org_id, event_key check in the 4 keys, enabled default false, recipient_roles text[] default '{}', pk org_id+event_key), `email_org_settings` (org_id pk, locale 'en'|'id' default 'en'), `email_user_prefs` (user_id pk, opted_out), `email_outbox` (id, org_id, notification_id unique, owner_id, event_key, status pending|sending|sent|failed, attempts, lease_until, last_error, created_at, sent_at). RLS on all, forced; org_id stamped by default/trigger. Outbox: no policy (service only). Settings: Admin read/write via `(select ...)` helpers; prefs: own row.
- `1221_email_outbox_enqueue.sql` - `notify_workflow_user` gains optional `p_email_event` (old 8-arg dropped, new definer ACL kept revoked, rollback restores). A classifier stamps `metadata.email_event` for the existing producers by title/entity so no producer function is copied. AFTER INSERT trigger on `notifications` (invoker; refuses client roles) calls definer `enqueue_notification_email` per FR-EML-001..005.
- `1222_email_outbox_delivery.sql` - service-only `claim_email_outbox(p_limit, p_lease)`, `complete_email_outbox(id, ok, err)` (attempts, failed at 5), recipient address read from the auth user inside the claim; `email_notify_tick()` + `cron.schedule('email-notify-tick','*/5 * * * *')`, no-op until the vault url and secret exist.
- `1223_email_settings_rpcs.sql` - `set_email_event_setting(event, enabled, extra_roles)`, `set_email_locale(locale)` (Admin only, security definer), `set_my_email_opt_out(bool)`.
- `1224` reserved (unused unless review needs it).

## Edge function `supabase/functions/email-notify/`
`index.ts` (handler `handleEmailNotifyRequest`, `Deno.serve` guarded), `templates.ts` (en/id per event), `deno.json`, `index.test.ts` importing the shipped handler with `globalThis.fetch` mocked. Secrets read from function env (`RESEND_API_KEY`, sender address, tick bearer); never set or written by this ticket. Register in the isolation-denominator manifest fragment as the guard asks.

## Frontend (screen: new section on Administration, plus opt-out switch on the user's own profile page)
`pmo-portal/src/lib/db/emailNotifications.ts`, `src/lib/repositories/emailNotifications.ts`, `pages/AdministrationEmailNotifications.tsx` (+ route and nav entry, Admin only via `can()`), shared form primitives, tokens, en + id strings, screenshots `docs/evidence/1215/2711/{phone-390,desktop-1440}.png`. Glossary: add "email channel", "email outbox".

## Tests
pgTAP `supabase/tests/1220_email_notifications.test.sql` (AC-EML-001..007, 013, 015) with a mutation check (remove the opt-out / enabled / role filter; each test must go red); Deno `index.test.ts` (008..012); Vitest page + repository tests (014). Gates as in the cloud rules plus both isolation-denominator checks.

## Settings added (all default = unchanged)
Per org per event: on/off (OFF), extra roles to copy (empty = addressee only). Per org: email language (English). Per user: opt-out (off).
